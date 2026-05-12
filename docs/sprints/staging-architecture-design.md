# Design — Staging Architecture for ETL Pipeline

**Status:** Design captured, not yet built
**Drafted:** 2026-04-26
**Build target:** TBD — likely after meeting with Allan and Kaleb, after Sprint 1-2 work lands
**Estimated effort when built:** 1-2 days

## Purpose of this document

Capture the staging architecture design while it's fresh, so when we eventually build it, we don't re-derive the reasoning. This is design-thinking, not a sprint specification — when we're ready to build, this doc becomes the input to a sprint draft.

## The core idea

> API endpoints sync on a timestamp folder. Data can be cleansed in the folder and the symlink controls when the data is live.

That's the whole architecture in one sentence. Everything else is just expansion.

## Why staging exists

The CTP system needs a layer between "what Genius API returned" and "what the scheduling engine consumes." Reasons:

1. **Cleansing happens before data is live.** Validation, normalization, derivation — all in a safe space that doesn't affect the running engine.
2. **Atomic promotion.** Either a sync succeeds completely and becomes live, or nothing changes. No half-updated landscape.
3. **Recoverability.** A bad sync can be rolled back instantly. Old snapshots stay on disk.
4. **Audit trail.** "What did Stafford's data look like last Tuesday?" is answerable.
5. **Multi-consumer support.** Same staged data feeds the scheduler, audit tools, debugging tools, future UI.
6. **Sync/process decoupling.** Sync at one cadence, process queries at another. Staging is the asynchrony point.
7. **Cheap at our scale.** WORK7 is 14.5 MB per snapshot. Storage and I/O concerns are negligible.

## The architecture

### Directory structure

```
/var/ctp/staging/
└── stafford-engineering-test/
    ├── current → 2026-04-26-1430/         (symlink to active snapshot)
    ├── 2026-04-26-1430/                   (most recent snapshot)
    │   ├── _metadata.json                 (capture time, source, record counts)
    │   ├── _validation-report.json        (what was checked, what passed/failed)
    │   ├── raw/                           (exactly what Genius returned)
    │   │   ├── machineAndRessourceEntity.json
    │   │   ├── salesOrderDetailEntity.json
    │   │   ├── workOrderWithAdvancedInformationViewEntity.json
    │   │   └── productionTaskWithAdvancedInfoViewEntity.json
    │   └── cleansed/                      (post-cleansing, ready for mapping)
    │       ├── resources.json
    │       ├── orders.json
    │       └── tasks.json
    ├── 2026-04-26-1330/                   (earlier snapshot)
    │   └── ...
    └── 2026-04-25-0900/                   (yesterday)
        └── ...
```

### The pipeline

```
Genius API → raw/ → cleansing/validation → cleansed/ → symlink promotion → engine reads from current/
```

Each step is independent. Cleansing failures don't promote. Engine never sees partial work.

### Symlink mechanics

The `current` symlink is the gate between "data exists on disk" and "data is live." Pattern:

1. Sync writes to `2026-04-26-1430.tmp/`
2. Cleansing runs against `.tmp/` directory
3. If validation passes, atomic rename: `.tmp/` → `2026-04-26-1430/`
4. Atomic symlink update: `current.new` → `2026-04-26-1430/`, then `mv -T current.new current`
5. Now the engine sees the new data

If anything fails before step 4, `current` still points at the previous good snapshot. The engine continues running on stale-but-valid data.

### Why symlinks specifically

- **Stable** — 50-year-old Unix infrastructure, used everywhere (Capistrano, package managers, version managers)
- **Efficient** — microseconds of overhead per read, dominated by file I/O anyway
- **Atomic** — symlink update via rename is filesystem-native atomic
- **Operationally transparent** — `ls -la` shows the active snapshot

Beta runs in Docker containers on client sites. Container = Linux semantics regardless of host OS. No Windows symlink-permission concerns. No need for pointer-file fallbacks.

## Cleansing pipeline

What "cleansing" might include, as a layered set of phases. None required for v1; add as needed.

### Phase 1: Validation (always run)

- Record counts match Genius's `PagingInfos.TotalElementsFound` (catches truncated paginated fetches)
- Required fields populated where expected
- Date fields parseable
- Foreign key references resolve (task's `WorkOrderCode` exists in work order set)
- Status enum values are recognized

### Phase 2: Normalization (likely add early)

- Trim whitespace from string fields ("DAVE STUART" had a leading space)
- Normalize date timezones to UTC
- Standardize null/empty/missing representations
- Resolve `JobPlanningStrategyId` integers to strategy names if a lookup is available

### Phase 3: Enrichment (add when needed)

- Add derived fields (`wipState` from `IsCompleted` + status)
- Compute aggregates per work order
- Mark cancellation-cascade tasks
- Annotate validation issues for downstream visibility

### Promotion gate

- Phase 1 must fully pass
- Phases 2 and 3 produce warnings, not failures
- Record counts must be plausible (not zero, not orders-of-magnitude different from previous sync)
- Schema must be compatible with current mapping
- All cleansed files written successfully

If any required check fails: leave the snapshot directory in place for inspection, log the failure, do not promote.

## Two design decisions deferred

### Where mapping runs

Two options:

**Option A: Stage raw, map at read time.**
- `cleansed/` contains source-shape data with light cleanup
- Engine applies mapping when reading
- Mapping changes don't require re-sync
- Best for beta where mapping evolves

**Option B: Stage processed, read-only at consumption.**
- `cleansed/` contains CTP-shape data (already mapped)
- Engine just loads it
- Mapping changes require re-sync
- Best when mapping is stable

**Recommendation for beta:** Option A. Switch to B (or hybrid) when mapping stabilizes.

### Retry strategy

Two options:

**Option A: Retry inline.** Sync logic retries cleansing within the same snapshot directory.

**Option B: Retry in next scheduled sync.** Failed snapshots stay on disk for inspection; next sync creates a fresh attempt.

**Recommendation:** Option B. Simpler. Each sync independent. Failed snapshots visible by absence-of-symlink-pointing-at-them.

## Manual override capability

A useful operational capability: operators manually re-point the symlink. Reasons:

- Roll back to yesterday's snapshot when today's looks wrong
- Force-promote a snapshot that failed validation but was manually approved after inspection
- Switch to a frozen snapshot for a specific test scenario
- Pin to a specific snapshot during incident investigation

Just `ln -sfn target_dir/ current` from the command line. No special tooling needed. Document as a runbook capability.

## Retention

At 14.5 MB per snapshot:

- Last 30 days, hourly: ~10 GB (probably more retention than needed)
- Last 30 days, daily: ~450 MB (reasonable default)
- Last 90 days, daily: ~1.4 GB (also reasonable)

Default suggested: keep last 30 days, all snapshots. Cleanup runs daily, deletes anything older than 30 days, never deletes the snapshot `current` points at (paranoia check).

Retention is configurable per tenant if needed later.

## Container deployment notes

Beta runs as Docker container on client site. Implications:

- Staging directory is a Docker volume or bind-mount (`/var/ctp/staging`)
- Volume must persist across container restarts
- Backup is a host concern (back up the volume)
- Container user (non-root) creates symlinks freely — Linux permissions, not Windows admin-privilege concern
- Container startup runs cleanup of orphaned `.tmp/` and `.new` directories left from unclean shutdowns

Don't put staging inside the image. Image is code, staging is data. Mount at runtime.

## How this fits with multi-environment config

The four-environment design (local / fixtures / dev / prod) maps cleanly:

- `env.local.json`: container's mock-genius writes to staging too. Same architecture, fake source.
- `env.fixtures.json`: staging directory pre-populated with captured WORK7 data. No sync runs; symlink points at static dir.
- `env.dev.json`: live sync from Stafford's WORK7 to staging.
- `env.prod.json`: same as dev but pointed at STAFFO when prod arrives.

The engine's data access layer doesn't care which environment. Always reads from `current/`. Environment determines what fills `current/`.

## How this relates to existing work

What we already have that's effectively staging:

- **Recording mode** writes API responses to disk → staging-write logic for prod
- **Recorded fixtures** (`tools/mock-genius/recorded/stafford-work7-2026-04-23/`) → first staging snapshot
- **Slim scenarios** (`stafford-work7-slim-100`) → staging snapshots tuned for fast iteration
- **`fixture-replay` adapter type** (in multi-env sprint) → staging-read logic

The staging concept is already present; it just isn't named. Formalizing means standardizing the language and adding the orchestration (timestamps, symlinks, atomic promotion).

## What we'd build when ready

Roughly 1-2 days of work:

### Components

1. **StagingService** — new module managing the staging directory lifecycle
   - `createSnapshot()` — creates `{timestamp}.tmp/` directory
   - `writeRaw(entity, data)` — writes API response to `raw/`
   - `runCleansing()` — runs validation/normalization/enrichment
   - `promote()` — atomic rename + symlink update
   - `current()` — returns path to active snapshot
   - `listSnapshots()` — returns timestamps available
   - `pruneOld(retentionDays)` — retention cleanup

2. **SyncOrchestrator** — coordinates fetcher + StagingService
   - Pulls all four entities from API
   - Writes each to staging raw/
   - Runs cleansing
   - Promotes if successful
   - Logs failure modes clearly

3. **Adapter integration** — adapter reads from `staging/{tenant}/current/` instead of fetching directly
   - `fixture-replay` adapter generalizes to "staging-read" adapter
   - Live sync mode is StagingService + adapter writing to staging

4. **Validation rules** — initial set
   - Record-count plausibility
   - Required-field checks
   - Date parseability
   - Cross-entity reference integrity (basic)

5. **Operational tooling**
   - CLI to list snapshots
   - CLI to manually promote a specific snapshot
   - CLI to inspect validation report
   - CLI to roll back to previous snapshot

### Acceptance criteria

- Sync produces a timestamped snapshot directory
- Cleansing runs and produces validation report
- Symlink promotion is atomic (no half-state visible to engine)
- Failed cleansing leaves snapshot in place but doesn't promote
- Engine reads from `current/` regardless of environment
- Existing tests pass (no regression)
- Container restart doesn't corrupt staging
- Retention cleanup respects active snapshot

## Risks to consider when building

- **Atomicity bugs.** Easy to write code that's atomic in the happy path but not under concurrent reads or crashes. Test with kill-9 mid-sync.
- **Disk filling up.** Pruning needs to actually run. Monitor disk usage.
- **Validation too strict.** Early validation rules might reject legitimate Stafford data quirks. Lean toward warnings over hard failures during beta.
- **Staging in image vs volume confusion.** Easy to accidentally bake staging into the Docker image. Reviewer needs to check.
- **Cross-platform paths.** Staging logic uses Unix-style paths. Don't accidentally use `path.win32`.

## When this becomes urgent

Build this when:

- Sprint 1 (resources mapping) is done
- Sprint 2 (multi-env config) is done — provides the environment selection
- We're ready to demo end-to-end Stafford data flowing through CTP
- Or when the absence of staging causes a concrete pain (e.g., a sync failure corrupts the running engine state)

Don't build it before. Premature staging adds complexity without solving a felt problem.

## Document maintenance

When we eventually build this:

1. This doc gets converted into a sprint draft
2. Sprint draft references this doc for design rationale
3. After implementation, this doc becomes historical (ADR-style record of why we built it this way)

Keep this doc in `docs/architecture/` or wherever ADRs live. Don't delete it after implementation — it's the reasoning behind the system, useful when someone asks "why did we do X" three months from now.

---

*Captured 2026-04-26 to preserve design thinking before priorities shift. Read this when ready to formalize staging — likely after the Stafford kickoff meeting and the multi-environment config sprint.*
