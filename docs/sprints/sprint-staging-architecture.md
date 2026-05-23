# Sprint — Staging Architecture for ETL Pipeline

**Status:** 📋 Ready
**Size:** ~1.5 days CC work (6 phases, ~14h total)
**Depends on:** Data Adapter Layer Phase 2 (in-tree — `RestAdapter`, `MappingEngine`, `SyncService` all exist)
**Companion design doc:** [`staging-architecture-design.md`](staging-architecture-design.md) — keep that for the "why"; this doc is the "what to build."

---

## Goal

Insert a **timestamped, symlink-promoted staging layer** between `SyncService.sync()` and the engine. The pipeline becomes:

```
Adapter.fetchRawData() → staging/{tenant}/{ts}.tmp/raw/ → validation
                                                       ↓ (pass)
                                                  rename to {ts}/
                                                       ↓
                                  atomic symlink: current → {ts}/
                                                       ↓
                                  MappingEngine reads from current/raw/
```

Today `SyncService` fetches and maps in-memory in one call — a sync failure mid-flight can taint engine state, and there is no audit trail of "what did Stafford's data look like last Tuesday." This sprint adds the storage layer, atomic promotion, validation gate, retention, and ops CLI.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Mapping placement | **Option A — stage raw, map at read time** | Mapping evolves during beta; re-mapping shouldn't require a re-sync. Matches design doc §"Where mapping runs." |
| Retry strategy | **Option B — retry in next scheduled sync** | Simpler, each sync independent. Failed snapshots stay on disk renamed `{ts}.failed/` for inspection. |
| Retention | **30 days, all snapshots, daily cleanup** | Spec default. `pruneOld` never deletes the snapshot `current` points at. |
| Tenant scoping | **Per-tenant root** | `staging/{tenant}/...` — matches design doc directory layout. |
| Pointer impl | **`IStagingPointer` abstraction; symlink on Linux, junction on Windows** | Prod is Docker/Linux; dev is Windows. Junction has the same atomicity properties as symlinks for directory pointers and needs no admin privilege. |
| Cleansing scope (v1) | **Phase 1 validation only** | Spec says "none required for v1; add as needed." Phases 2/3 (normalization, enrichment) deferred. |
| Staging root | **Config-driven** — `staging.rootDir` from `ConfigService` (default `/var/ctp/staging` on Linux, `%LOCALAPPDATA%\ctp\staging` on Windows) | Don't hardcode; multi-env will override per environment. |
| Multi-env integration | **Build staging now, integrate env-overlay when that sprint lands** | The `ConfigService.getStagingConfig()` seam is small and stable. No need to block on multi-env. |

## Architecture

```
packages/api/src/modules/integration/
├── sync.service.ts                        (modified — delegates to SyncOrchestrator when staging enabled)
├── adapter-factory.ts                     (modified — new "staging-read" type)
└── staging/                                ← all new
    ├── staging.service.ts                  lifecycle: createSnapshot, writeRaw, runCleansing, promote, current, listSnapshots, pruneOld
    ├── sync-orchestrator.ts                coordinates Adapter → StagingService → validation → promotion
    ├── staging-read.adapter.ts             IDataAdapter reading from current/raw/
    ├── staging-paths.ts                    pure path helpers (posix-internal; OS only at the pointer layer)
    ├── pointer/
    │   ├── staging-pointer.interface.ts    IStagingPointer { point(target), resolve(), exists() }
    │   ├── symlink-pointer.ts              Linux/Docker — fs.symlink + atomic rename
    │   └── junction-pointer.ts             Windows dev — fs.symlink(target, link, 'junction')
    └── validation/
        ├── validation-runner.ts            orchestrates rule pipeline, emits ValidationReport
        ├── types.ts                        Rule, RuleResult, ValidationReport
        └── rules/
            ├── record-count-plausibility.ts
            ├── required-fields.ts
            ├── date-parseability.ts
            └── cross-entity-refs.ts
```

## Directory contract

```
{staging.rootDir}/{tenant}/
├── current → {ts}/                     symlink/junction; the engine reads through this
├── {ts}/                               promoted snapshot
│   ├── _metadata.json                  capture time, source adapter, record counts per entity
│   ├── _validation-report.json         rules run, passes/failures/warnings
│   ├── raw/                            exactly what adapter returned (one JSON per entity)
│   └── cleansed/                       reserved for Phase 2/3; empty in v1
├── {ts}.tmp/                           in-flight; renamed to {ts}/ only after validation passes
└── {ts}.failed/                        cleansing failed; left for inspection (next sync = fresh attempt)
```

`{ts}` format: `YYYY-MM-DD-HHMM` (local time; consistent with the design doc's examples).

## Changes by area

### 1. New module: `StagingService`

**`packages/api/src/modules/integration/staging/staging.service.ts`** — Nest-injectable. Public surface:

```typescript
createSnapshot(tenant: string): SnapshotHandle              // creates {ts}.tmp/raw/ + {ts}.tmp/cleansed/
writeRaw(handle: SnapshotHandle, entity: string, data: unknown[]): Promise<void>
runValidation(handle: SnapshotHandle): Promise<ValidationReport>
promote(handle: SnapshotHandle, report: ValidationReport): Promise<void>  // rename tmp→final, flip pointer
markFailed(handle: SnapshotHandle, report: ValidationReport): Promise<void>  // rename to {ts}.failed/
current(tenant: string): string | null                       // resolved path to active snapshot
listSnapshots(tenant: string): SnapshotInfo[]                // promoted only, descending
pruneOld(tenant: string, retentionDays: number): Promise<PruneResult>  // skips current target
cleanupOrphans(tenant: string): Promise<void>                // removes *.tmp/, *.new from unclean shutdowns
```

`SnapshotHandle` is `{ tenant, ts, tmpDir, rawDir, cleansedDir }`. All file I/O goes through here.

### 2. New module: `SyncOrchestrator`

**`packages/api/src/modules/integration/staging/sync-orchestrator.ts`** — coordinates the pipeline.

```typescript
async runSync(tenant: string): Promise<SyncResult> {
  const adapter = this.adapterFactory.create();
  const handle = this.staging.createSnapshot(tenant);
  const raw = await adapter.fetchRawData();
  await this.writeAllEntities(handle, raw);
  const report = await this.staging.runValidation(handle);
  if (!report.passed) {
    await this.staging.markFailed(handle, report);
    return { ok: false, report };
  }
  await this.staging.promote(handle, report);
  return { ok: true, report, snapshotTs: handle.ts };
}
```

### 3. New adapter: `StagingReadAdapter`

**`packages/api/src/modules/integration/staging/staging-read.adapter.ts`** — implements `IDataAdapter`. `fetchRawData()` reads the four entity JSONs from `staging.current(tenant)/raw/`. Distinct from `FileAdapter` (which keeps loading from `tools/mock-genius/fixtures/`).

### 4. Modified: `SyncService`

**`packages/api/src/modules/integration/sync.service.ts`** lines 18–23 — `sync()` checks a `staging.enabled` config flag. If on, delegate to `SyncOrchestrator.runSync()` then map from `current/raw/` via `StagingReadAdapter`. If off, existing direct path stays — zero-impact for tenants not yet migrated.

### 5. Modified: `AdapterFactory`

**`packages/api/src/modules/integration/adapter-factory.ts`** lines 11–17 — add `adapterType === 'staging-read'` branch returning `StagingReadAdapter`. Existing `rest` and default `FileAdapter` branches unchanged.

### 6. New: `ConfigService.getStagingConfig()`

**`packages/api/src/config/config.service.ts`** — new getter. Returns:

```typescript
interface StagingConfig {
  enabled: boolean;
  rootDir: string;                          // platform-defaulted if unset
  retentionDays: number;                    // default 30
  validation: { strictRequiredFields: boolean };
}
```

Read from `staging.json` in the tenant config dir, with sensible defaults when the file is absent. (Multi-env will overlay this later without touching the API.)

### 7. Validation rules (Phase 1 only)

Each rule implements `Rule { name; check(snapshot): RuleResult }`. Initial set:

| Rule | Behavior |
|---|---|
| `record-count-plausibility` | Counts not zero; within 10x of previous promoted snapshot (skip on first sync). Fails on zero, warns on out-of-range. |
| `required-fields` | Per-entity required-key table (e.g. tasks need `WorkOrderCode`, `TaskCode`). Fails if any record missing required key. |
| `date-parseability` | Every key matching `*Date`/`*Time` parses via `Date.parse`. Warns; doesn't fail. |
| `cross-entity-refs` | Every task's `WorkOrderCode` exists in the order set. Fails on dangling refs. |

Promotion gate: any **fail** ⇒ `markFailed`. Warnings ⇒ promote, annotated in report.

### 8. CLI: `packages/api/src/cli/staging.ts`

Plain Node entry; not a long-running Nest server. Standalone Nest context bootstrap is enough.

```
npm run staging -- list <tenant>
npm run staging -- promote <tenant> <ts> [--yes]
npm run staging -- inspect <tenant> <ts>
npm run staging -- rollback <tenant>
```

Each subcommand calls `StagingService` directly. `--yes` skips the paranoia confirm prompt on `promote` / `rollback`.

Add `"staging": "node dist/src/cli/staging.js"` to `packages/api/package.json` scripts.

### 9. Retention scheduling

Use `@nestjs/schedule` (verify present in deps; if not, add). Cron `0 3 * * *` daily — iterate tenants with staging enabled, call `pruneOld(tenant, retentionDays)`. Paranoia: `pruneOld` re-resolves the `current` pointer right before each delete.

### 10. Startup orphan cleanup

`StagingService.onModuleInit()` for each enabled tenant calls `cleanupOrphans` — removes any `*.tmp/` and `*.new` directories left from kill-9 / unclean shutdowns. Does not touch `*.failed/` (those are intentional).

## Acceptance criteria

Lifted verbatim from design doc §"Acceptance criteria," each mapped to a test:

1. **Sync produces a timestamped snapshot directory** → orchestrator integration test asserts `{ts}/raw/*.json` exists post-run.
2. **Cleansing runs and produces validation report** → assert `_validation-report.json` written; assert all four rules ran.
3. **Symlink promotion is atomic** → mid-promotion observation of `current` always resolves; never to a half-built dir. Test by injecting a delay between rename and pointer flip and reading `current` from a parallel task.
4. **Failed cleansing leaves snapshot in place but doesn't promote** → induce a `required-fields` failure; assert `{ts}.failed/` exists and `current` still points to prior.
5. **Engine reads from `current/` regardless of environment** → e2e test with `staging.enabled=true` confirms `SyncService.sync()` returns the same `MappingResult` shape as the direct path.
6. **Existing tests pass** → `npx vitest run` green. `npx tsc --noEmit -p packages/api/tsconfig.json` green (the strict-check from CLAUDE.md).
7. **Container restart doesn't corrupt staging** → simulate by creating `{ts}.tmp/` and `{ts}.new` manually, boot the module, assert they're gone.
8. **Retention respects active snapshot** → unit test where `current` points to a snapshot older than retention window; `pruneOld` leaves it.

Bonus: **kill-9 mid-sync test** — abort `runSync` between `writeRaw` and `promote`; assert next startup cleans the orphan; assert `current` still resolves to the prior good snapshot.

## Milestone breakdown

Sprint ships as **4 independently mergeable milestones**, each landing behind a flag with no behavior change until the final one flips it on.

| Milestone | Scope | Est. | Runtime impact |
|---|---|---|---|
| **M1 — Foundation (dormant)** | StagingService + pointer abstraction (both impls) + ValidationRunner + 4 rules + tests | ~5h | None (no imports outside `staging/`) |
| **M2 — Wire, flag-gated off** | SyncOrchestrator + StagingReadAdapter + `ConfigService.getStagingConfig()` + `SyncService.sync()` delegation + AdapterFactory branch | ~3h | None (default `staging.enabled=false`) |
| **M3 — Ops surface** | CLI (list/promote/inspect/rollback) + retention cron + `onModuleInit` orphan cleanup + Docker volume doc | ~4h | None until a tenant opts in |
| **M4 — Activation** | Convert one fixture to a pre-populated snapshot, flip `staging.enabled=true` for a dev tenant, kill-9 test, full regression | ~2h | First behavioral change — dev tenant only |

Total: ~14h. Each milestone is a single PR, fully green tests, no half-states on `main`.

---

### Milestone 1 — Foundation (Dormant Code) — detailed spec

**Acceptance gate:** all existing tests still pass, all new tests pass, dormancy-assertion test confirms zero imports of `staging/` from outside `staging/`.

#### File inventory (all new)

```
packages/api/src/modules/integration/staging/
├── staging.service.ts                              StagingService (Nest @Injectable)
├── staging.module.ts                               StagingModule (defined, NOT imported into IntegrationModule)
├── staging-paths.ts                                pure path helpers
├── staging-types.ts                                shared types
├── pointer/
│   ├── staging-pointer.interface.ts                IStagingPointer
│   ├── symlink-pointer.ts                          Linux/Docker impl
│   ├── junction-pointer.ts                         Windows dev impl
│   └── create-pointer.ts                           factory: picks impl by process.platform
└── validation/
    ├── validation-runner.ts                        ValidationRunner
    ├── validation-types.ts                         Rule, RuleResult, ValidationReport
    └── rules/
        ├── record-count-plausibility.ts
        ├── required-fields.ts
        ├── date-parseability.ts
        ├── cross-entity-refs.ts
        └── index.ts                                exports defaultRules

packages/api/src/modules/integration/staging/__tests__/
├── staging.service.spec.ts
├── dormancy.spec.ts
├── pointer/symlink-pointer.spec.ts                 skipped when platform === 'win32'
├── pointer/junction-pointer.spec.ts                skipped when platform !== 'win32'
├── pointer/shared-pointer-tests.ts                 parameterized test bed
├── validation/validation-runner.spec.ts
└── validation/rules/*.spec.ts                      one per rule
```

#### Pointer abstraction

```typescript
export interface IStagingPointer {
  /** Atomically point at `targetDir`. Replaces any existing pointer. */
  point(targetDir: string): Promise<void>;
  /** Absolute resolved path, or null if pointer doesn't exist. */
  resolve(): Promise<string | null>;
  exists(): Promise<boolean>;
}
```

- **`SymlinkPointer`** (Linux/Docker): `fs.symlink(target, link+'.new')` → `fs.rename(link+'.new', link)`. Atomic on POSIX. `resolve` uses `fs.realpath`.
- **`JunctionPointer`** (Windows dev): same two-step using `fs.symlink(target, link, 'junction')`. No admin/Developer-Mode requirement. `fs.rename` over existing junction is atomic on same volume.
- **`createPointer(linkPath)`**: factory picks impl by `process.platform === 'win32'`.

#### Path helpers — `staging-paths.ts`

Pure functions; all path manipulation in the staging module goes through here:

```typescript
tenantRoot(rootDir, tenant)
pointerPath(rootDir, tenant)                  // {root}/{tenant}/current
snapshotDir(rootDir, tenant, ts)              // {root}/{tenant}/{ts}
tmpDir(rootDir, tenant, ts)                   // {root}/{tenant}/{ts}.tmp
failedDir(rootDir, tenant, ts)                // {root}/{tenant}/{ts}.failed
rawDir(snapshotPath)                          // {snapshot}/raw
cleansedDir(snapshotPath)                     // {snapshot}/cleansed
metadataPath(snapshotPath)                    // {snapshot}/_metadata.json
reportPath(snapshotPath)                      // {snapshot}/_validation-report.json
formatTimestamp(d: Date): string              // YYYY-MM-DD-HHMM
parseTimestamp(ts: string): Date | null
```

#### Shared types — `staging-types.ts`

```typescript
interface SnapshotHandle {
  tenant: string; ts: string; tmpDir: string; rawDir: string; cleansedDir: string;
  metadataPath: string; reportPath: string;
}
interface SnapshotMetadata { capturedAt: string; adapterType: string; recordCounts: Record<string, number>; }
interface SnapshotInfo { tenant: string; ts: string; fullPath: string; isCurrent: boolean; metadata: SnapshotMetadata | null; }
interface PruneResult { deleted: string[]; skipped: { ts: string; reason: 'current' | 'within-retention' }[]; }
```

#### `StagingService` public surface

```typescript
@Injectable()
export class StagingService {
  constructor(@Inject('STAGING_ROOT_DIR') private readonly rootDir: string) {}

  createSnapshot(tenant: string, now?: Date): SnapshotHandle
  writeRaw(handle: SnapshotHandle, entity: string, data: unknown[]): Promise<void>
  writeMetadata(handle: SnapshotHandle, meta: SnapshotMetadata): Promise<void>
  writeReport(handle: SnapshotHandle, report: ValidationReport): Promise<void>
  promote(handle: SnapshotHandle): Promise<void>          // fs.rename(tmp → final), then pointer.point(final)
  markFailed(handle: SnapshotHandle): Promise<void>       // fs.rename(tmp → failed); does NOT touch pointer
  current(tenant: string): Promise<string | null>
  listSnapshots(tenant: string): Promise<SnapshotInfo[]>  // promoted only, descending
  pruneOld(tenant: string, retentionDays: number, now?: Date): Promise<PruneResult>
  cleanupOrphans(tenant: string): Promise<void>           // removes *.tmp/ and *.new; NOT *.failed/
}
```

Reports + metadata are written into the **tmp** dir so promotion's atomic rename carries both into the final snapshot.

`StagingModule` provides `StagingService` and `STAGING_ROOT_DIR` (platform-defaulted) but is **not** imported into `IntegrationModule` in M1.

#### Validation

```typescript
type RuleSeverity = 'fail' | 'warn';
type RuleOutcome = 'pass' | 'warn' | 'fail';
interface Rule { name: string; severity: RuleSeverity; check(ctx: RuleContext): Promise<{ok: boolean; message?: string; details?: unknown}>; }
interface RuleContext { rawDir: string; previousRawDir: string | null; }
interface ValidationReport { ranAt: string; rules: RuleResult[]; passed: boolean; failedRules: string[]; warningRules: string[]; }
```

`ValidationRunner.run(ctx)` calls each rule, translates `{ok:false}` to `outcome = severity`, sets `passed = !rules.some(r => r.outcome === 'fail')`.

Initial rule set (`validation/rules/index.ts` exports as `defaultRules`):

| Rule | Severity | Check |
|---|---|---|
| `record-count-plausibility` | `fail` | Fail if any entity has 0 records AND previous snapshot was non-zero. First-ever sync: pass automatically. Annotates `>10x` differences in `details` (without failing). |
| `required-fields` | `fail` | Per-entity required-key table (initial Stafford-shape defaults, tunable in M4). Fail if any record missing any required key. |
| `date-parseability` | `warn` | Scan every key matching `/Date$\|Time$/`, try `Date.parse`. Annotates unparseable values; never hard-fails. |
| `cross-entity-refs` | `fail` | Build set of order codes from `salesOrderDetailEntity`; every task's `WorkOrderCode` must exist in it. Fail on dangling refs. |

Each rule reads inputs via `fs.readFile(path.join(rawDir, '{entity}.json'))`, tolerates missing entity files (counts as zero records).

#### Tests

- **Pointer:** shared parameterized test bed, instantiated by each platform-specific suite. Asserts `point→resolve` round-trip, replacement-of-existing, `exists()` semantics, null on missing, concurrency safety.
- **StagingService:** uses `os.tmpdir()/staging-test-{uuid}/` per test, cleaned in `afterEach`. Covers each public method including `pruneOld` skipping the `current` target and `cleanupOrphans` leaving `*.failed/` alone.
- **Validation:** per-rule pass/fail/warn cases + missing-entity-file edge cases. `ValidationRunner` test feeds three stub rules (one of each outcome) and asserts report structure.
- **Dormancy:** grep-based test asserts no production file outside `staging/` imports from `staging/`.

#### Acceptance criteria (M1 only)

1. `npx tsc --noEmit -p packages/api/tsconfig.json` green.
2. `npx vitest run` green — existing tests untouched, new tests pass.
3. Dormancy assertion test passes.
4. `JunctionPointer` works on Windows dev without admin elevation (verified once during dev).
5. No `path.win32` or `path.posix` references outside pointer impls.

#### Risks specific to M1

- **Concurrent `point` on Windows.** If junction-rename races, fall back to `try { rename } catch { unlink; rename }` with a documented microsecond gap.
- **Tmp dir cleanup.** Vitest crashes can leak `staging-test-*` dirs; add a global `beforeAll` sweep of `os.tmpdir()`.
- **`fs.rm({recursive:true})` flakiness on Windows.** Antivirus/Explorer can lock dirs; `pruneOld` retries once with short backoff.

---

### Milestones 2–4 — to be detailed when M1 lands

Each will get its own sub-section like the above before implementation starts. See parent milestone table for scope summary.

## Risks

- **Atomicity bugs.** Symlink rename is atomic; the `.tmp → final` rename is atomic; but writing `_metadata.json` and `_validation-report.json` is not. Write report **before** the rename, or write to `.tmp/` so the rename carries it.
- **Junction vs symlink quirks.** Windows junctions resolve transparently for `fs.readdir` but some Node APIs report them as files-of-type-junction. The `IStagingPointer.resolve()` impl must use `fs.realpath`, not `fs.readlink`.
- **Disk fill.** If `pruneOld` cron silently fails (e.g., schedule package not registered), snapshots accumulate indefinitely. Wire the prune step into a log event and add a metric.
- **Validation false positives.** Stafford data has known quirks (leading-space names, integer strategy IDs). Lean toward warnings; only `required-fields` and `cross-entity-refs` are hard fails in v1.
- **Cross-platform paths.** Internals use `path.posix`; only the pointer impls touch native `path`. Reviewer must check no `path.win32` leaks.
- **Staging baked into image.** Easy to accidentally include `staging/` in a Docker image layer. The Dockerfile must `VOLUME /var/ctp/staging` and the image build must not write there.

## Out of scope

- **Cleansing Phase 2 (normalization)** and **Phase 3 (enrichment)**. Hooks exist (the `cleansed/` directory and `runValidation` seam), but rules are not implemented. Add when first concrete need surfaces.
- **Multi-tenant orchestration.** Sync runs per current tenant, same as today. Multi-tenant batched sync is a future sprint.
- **Live multi-environment switching.** `staging.rootDir` is config-driven so multi-env will overlay it cleanly later, but this sprint doesn't ship the env-overlay loader.
- **Admin UI for staging.** CLI only in v1. UI listing/rollback/promotion is a later UX sprint.

## Files touched

**New:**
- `packages/api/src/modules/integration/staging/staging.service.ts`
- `packages/api/src/modules/integration/staging/sync-orchestrator.ts`
- `packages/api/src/modules/integration/staging/staging-read.adapter.ts`
- `packages/api/src/modules/integration/staging/staging-paths.ts`
- `packages/api/src/modules/integration/staging/pointer/staging-pointer.interface.ts`
- `packages/api/src/modules/integration/staging/pointer/symlink-pointer.ts`
- `packages/api/src/modules/integration/staging/pointer/junction-pointer.ts`
- `packages/api/src/modules/integration/staging/validation/validation-runner.ts`
- `packages/api/src/modules/integration/staging/validation/types.ts`
- `packages/api/src/modules/integration/staging/validation/rules/{record-count-plausibility,required-fields,date-parseability,cross-entity-refs}.ts`
- `packages/api/src/cli/staging.ts`
- `docs/deployment/docker-staging-volume.md`
- Test files alongside each new module.

**Modified:**
- `packages/api/src/modules/integration/sync.service.ts` (lines 18–23 — delegate to orchestrator when enabled)
- `packages/api/src/modules/integration/adapter-factory.ts` (lines 11–17 — add `staging-read` branch)
- `packages/api/src/modules/integration/integration.module.ts` (register new providers)
- `packages/api/src/config/config.service.ts` (add `getStagingConfig()`)
- `packages/api/package.json` (add `staging` script + `@nestjs/schedule` if absent)

## Open questions

1. **Build multi-env config sprint before this, or after?** Spec says "after." Recommend after — staging's config seam is stable.
2. **Should `pruneOld` archive to cold storage** (e.g., gzip + move to `archive/`) **rather than delete?** Defaulting to delete in v1 per the design doc; revisit if anyone asks for historic recovery beyond 30 days.

---

*Sprint draft converted from [`staging-architecture-design.md`](staging-architecture-design.md). Per CLAUDE.md, remember to `git add docs/sprints/` when committing.*
