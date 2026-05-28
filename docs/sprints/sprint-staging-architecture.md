# Sprint — Staging Architecture (as-built)

**Status:** ✅ Beta architecture shipped
**Branch:** `feature/staging-architecture`
**Design rationale:** [`staging-architecture-design.md`](staging-architecture-design.md)

This doc records what was actually built and why the design evolved. Granular
milestone history is in the git log (`git log --oneline feature/staging-architecture`).

## What shipped (beta)

The engine reads **validated CTP-shape data** through a per-tenant `data/current`
symlink. All source→CTP transformation happens **upstream of the engine** — the
engine never transforms data. Every tenant looks identical from the engine's
perspective regardless of where its data originated.

### On-disk layout (in repo, committed)

```
config/tenants/<tenant>/
├── tenant.json
├── locale.json, scoring.json, settings.json, ...   (tenant config)
└── data/
    ├── current → initial-fixture/                  (symlink/junction, created at boot, NOT committed)
    └── initial-fixture/                            (committed CTP-shape data)
        ├── resources.json
        ├── tasks.json
        ├── orders.json
        ├── calendars.json
        ├── state-changes.json
        ├── products.json
        ├── materials.json
        ├── processes.json
        └── uom-conversions.json
```

- **`data/initial-fixture/`** — committed CTP-shape data. The source of truth during beta.
- **`data/current`** — symlink/junction generated at API boot by `StagingLifecycleService`. Points at `initial-fixture/` (or the most recent timestamped snapshot if the cleanse tool has produced any). NOT committed — created locally on first boot (Windows + git symlinks don't mix).
- The engine reads through `data/current/<entity>.json` via `FileConfigStore`, with automatic fallback to `data/initial-fixture/` if the symlink hasn't materialized.

### Read path

```
UI → API → StateService → FileConfigStore.getX()
                            → reads data/current/<entity>.json
                            → StateHydrator builds SchedulingLandscape
```

No `MappingEngine` anywhere in this path (grep-verified: zero imports under
`packages/api/src/config` or `packages/api/src/modules/state`).

### Health verification

`GET /v1/health/tenant` reports config presence, data-layout (symlink resolves /
fallback in use / snapshot count), per-entity file presence + record counts, and
engine landscape state. Single curl confirms a deploy is serving correctly —
designed for Azure where filesystem inspection is limited.

## How the design evolved

The original design doc offered two options for where mapping runs:
- **Option A** — stage raw, map at read time (engine reads raw + transforms)
- **Option B** — stage processed, engine reads pre-mapped CTP-shape

The first implementation (milestones M1–M4, in git history) built **Option A**:
`StagingReadAdapter` read raw Genius-shape data from a staging directory and
`MappingEngine` transformed it at sync time. The symlink/atomic-promotion
discipline was sound, but the mapping-at-read placement was wrong for this codebase.

**The pivot:** the engine must never transform data — all ETL is upstream, even in
beta (see [[feedback-etl-transforms-upstream]]). This collapsed Option A into the
shipped design: committed CTP-shape fixtures, engine reads them directly, mapping
becomes an offline/upstream concern.

### Retired in the pivot (deleted, not stubbed)

- `StagingReadAdapter` + `staging-read` adapter type
- `SyncOrchestrator` (adapter-driven runtime sync)
- `staging.enabled` flag + `SyncService.sync()` flag-gated branch
- `IStagingConfig` / `getStagingConfig()` / `integration/staging.json`
- `stafford-slim-100-staging-test` tenant (folded into `stafford-slim-100`)

### Kept as substrate for the future cleanse tool

- `IStagingPointer` + `SymlinkPointer` + `JunctionPointer` (atomic pointer flip)
- `StagingService` lifecycle methods (createSnapshot / writeRaw / promote / markFailed / pruneOld / cleanupOrphans / repointAt)
- `ValidationRunner` + 4 rules (record-count, required-fields, date-parseability, cross-entity-refs)
- `_history.log` JSONL audit primitives
- CLI: `list` / `inspect` / `promote` / `rollback` / `seed` / `history` (operate on tenant data dirs)

## Deferred (post-beta, not blocking)

- **`npm run cleanse` tool** — offline/background operation: pull raw source data
  (Genius), map via `MappingEngine`, validate, write a new timestamped
  CTP-shape snapshot under the tenant's `data/`. Needed only when onboarding a
  tenant whose source isn't already pre-cleansed, or refreshing a capture. Every
  current tenant already has committed cleansed fixtures, so nothing is blocked.
- **Decoupled promote-as-job** — cleanse produces a snapshot; a separate promote
  step flips `data/current`. Blue/green for ETL. CLI `promote`/`rollback` exist
  as the manual form.
- **Live Genius sync** — the `RestAdapter` remains in the codebase but is not
  wired into beta startup. Future work wraps the same `MappingEngine` in a live
  ingest service that writes cleansed snapshots; the engine read path is unchanged.

## Production vs. beta

Beta keeps tenant data **in the repo** (committed fixtures). Production will
separate code and data paths: data lives in a runtime volume (`CTP_DATA_ROOT`),
populated by the live ingest/cleanse pipeline, not committed. The engine read
path is identical in both — it always reads `current/<entity>.json`.
