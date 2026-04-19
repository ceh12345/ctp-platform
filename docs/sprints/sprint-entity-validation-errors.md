# Sprint: Entity Validation Errors — Scaffolding for Data-Quality Visibility

**Status:** 📋 Ready (revised 2026-04-19 — path corrections, byEntity fix, scope clarifications)
**Size:** ~3-4 hours CC work (Session 1: type extensions + StateService integration, Session 2: MappingEngine hook-points + schedulable flag, Session 3: SyncResult aggregation + tests)
**Depends on:** Data Adapter Layer sprint (Phases 1 and 2 — MappingEngine, SyncService exist). **Note: `SyncResult` as a structured type does NOT exist in the codebase today** (grep confirms); this sprint creates it or extends whatever shape `/v1/state/sync` returns today. Either way, shape is defined here.
**Scope discipline:** This sprint builds *capability only*. The specific site-level fixes (`toUTC` actually throws on `!isValid`, orphan-resource check actually runs over tasks, hydrator's date helper catches NaN before it reaches `date.ts:21`) land in the companion **bug-fix sprint** (`sprint-data-integrity-hardening.md`). Verification gate for this sprint: all existing tests pass; zero user-visible behavior change.
**Triggered by:** CC's five-bug audit against the mock's bad-data scenarios surfaced a class problem: the engine accepts bad or ambiguous input and produces plausible-looking but wrong output. Three of those bugs (C: unparseable date crash, D: orphan resource silently scheduled, B: null machine code silently becomes dwell task) share a root cause — there's nowhere to *record* that a record had an issue, so issues are either swallowed silently or escalated to crashes. This sprint builds the data structure and plumbing; subsequent sprints use it to fix the bugs.

---

## Problem

Today, when the ETL pipeline encounters a questionable record, it has three options:

1. **Silently accept it** — the record loads into the landscape with bad/defaulted data. No trace. (Bugs B, chain-cycle.)
2. **Silently drop it** — the record is skipped. Counted in `SyncResult.recordCounts.skipped` as a number, but the *why* is only visible in logs.
3. **Crash** — downstream code blows up because earlier code passed garbage through. (Bug C.)

None of these is right. The planner needs to see *which records had issues, what those issues were, and whether the engine should still try to schedule them*. Today that information is either lost, aggregated into a count, or crashes the server.

We also have an existing weak pattern: `CTPTask.errors: IError[]` already exists with `addError(agent, reason)` and `clearErrors()`. Nothing systematically populates it. The engines occasionally push to it; the MappingEngine never does. It's a stub that nobody uses.

This sprint turns that stub into the real mechanism: every entity that survives ETL carries an explicit record of what went wrong during its construction, who detected it, and how it was handled.

---

## Design

### Core principle

**Errors belong on the record that caused them.** Not in a separate log file, not in an aggregate counter, not in a message that scrolls past. If task `T-123` has a field that failed to parse, task `T-123` carries the error. If resource `R-5` is referenced by a task but doesn't exist, the *task* carries that error (the resource is fine; the reference is wrong).

This is the "validated record" pattern common in data pipelines — records flow through the pipeline with their provenance and quality metadata attached, so any downstream consumer can inspect both the data and its pedigree.

### What it replaces

The existing `CTPTask.errors: IError[]` pattern stays but is extended. Current shape:

```typescript
interface IError {
  agent: string;   // who detected it
  type: string;    // usually empty
  reason: string;  // free-form message
}
```

New shape is a superset — existing `agent` / `type` / `reason` preserved, new fields added. Existing `addError(agent, reason)` calls keep working; they just populate the new fields with sensible defaults.

### Extended error structure

```typescript
interface IValidationError extends IError {
  // existing fields
  agent: string;       // who detected: "MappingEngine" | "StateService" | "SchedulingEngine" | etc.
  type: string;        // machine-readable code: "UNPARSEABLE_DATE" | "ORPHAN_REFERENCE" | ...
  reason: string;      // human-readable message

  // new fields
  severity: "error" | "warning" | "info";
  field?: string;               // which field, if field-specific
  source: "mapping" | "validation" | "engine" | "adapter";
  policy?: "strict" | "skip" | "default" | "annotate";
  detectedAt: string;           // ISO 8601 timestamp — useful for debugging stale errors
  rawValue?: unknown;           // the bad value, if safe to include (never for sensitive fields)
}
```

Sensitive-field handling: if the mapping profile marks a field as `sensitive: true`, `rawValue` is omitted from the error to avoid leaking customer data, PII, or pricing into error dumps.

### Which entities carry errors

All three primary entities:

- **`CTPTask`** — **keep the field name `errors`**. Today at `packages/engine/Models/Entities/task.ts:221` it's `public errors: IError[]`. The type widens to `IValidationError[]` (superset — every `IError` is a valid `IValidationError` with default severity `"error"`). Existing `addError(agent, reason)` at line 334 keeps working; it internally populates the new fields with sensible defaults. **Do NOT rename the field** — the solver and scheduler already read `task.errors` in multiple places; renaming would ripple.
- **`CTPOrder`** — new field, name is **`validationErrors`** (orders have no existing `errors` field; pick the more descriptive name for the greenfield case).
- **`CTPResource`** — new field **`validationErrors`** (same reasoning as orders).

Secondary entities (calendars, changeovers, products) don't get this for now. Their errors surface on the task or resource that referenced them. Revisit if needed.

### Why not a separate error store?

Considered and rejected. The alternatives:

1. **Side-channel: `landscape.validationErrors: Map<entityKey, error[]>`.**
   Pro: keeps entity types clean. Con: every consumer now needs two lookups to know if an entity is valid. The UI has to join the map against the entity list. The scheduler has to check before every placement. Lookup-heavy and error-prone.

2. **Inline on every entity (chosen).**
   Pro: entity-local queries stay entity-local. `task.validationErrors.length > 0` is self-contained. UI renders straight from the entity. Con: slight memory overhead for the empty-array case.

The lookup cost of option 1 dominates for the use cases that actually matter (UI rendering, solver decisions), so inline wins.

### The `schedulable` flag

Critical derived field on `CTPTask`:

```typescript
class CTPTask {
  // ... existing fields
  validationErrors: IValidationError[];

  get schedulable(): boolean {
    return !this.validationErrors.some(e => e.severity === "error");
  }
}
```

This is what the scheduler reads. `schedulable: false` means "we know this task can't be placed, don't try." The scheduler skips unschedulable tasks with a clear reason. This is what lets the bug-fix sprint clean up Bug D cleanly — orphan resource reference → error severity → `schedulable: false` → scheduler ignores → no fake "successful" schedule with empty assignments.

**Perf note on the getter.** Current scale (<1000 tasks) makes the `.some()` scan trivial — the solver runs this once per skip check. If solver iteration counts grow (backtracking, bump, or Stafford's full day hits 10K+ tasks), revisit as a stored flag invalidated on `addValidationError` / `clearValidationErrors`. Not a Sprint 1 concern.

**Warnings do not affect schedulability.** A warning is "this is suspicious but we're proceeding." A null-MachineCode task that got defaulted to a dwell task is schedulable; it just has a warning attached so the planner knows it was a defaulted judgment.

### How errors get populated

Four sources, in the order they fire during a sync:

**1. Field-level mapping errors (MappingEngine)**
Populated as each record is transformed. Triggered by:
- Transform failures (`toUTC` on unparseable input, `lookup` with no match and no `_default`)
- Missing required fields when policy is `default` (record loads with defaulted value + warning)
- Field-level policy application — every time `default` substitutes, log a warning

**2. Cross-entity validation (after mapping, before landscape replace)**
Runs after MappingEngine has produced DTOs *and* after those DTOs have been hydrated into `CTPTask` / `CTPOrder` / `CTPResource` instances, but **before** the new landscape replaces the current one. Rationale: the check needs `.addValidationError(...)` on entity instances, and it needs the full landscape entity maps built out to do cross-reference lookups. So the timing is: DTO → entity construction → cross-entity pass (mutates `validationErrors` on instances) → landscape replace.

Checks (only the plumbing lives in this sprint; populating them at each site is the bug-fix sprint's job):
- Orphan resource references (task's `capacityResources[i].resource` not in resources map) — Bug D
- Orphan order references (task's `orderKey` not in orders map) — placeholder, not currently a known bug
- Duplicate sequence numbers within a chain — Sprint 2 (`chain-cycle` warning)

**3. Landscape construction validation (StateService.applyTransformed)**
Populated when hydrating the landscape. Checks engine-level invariants:
- Task has at least one valid window
- Task's duration is a positive number (not 0, not negative, not NaN)
- Resource's calendar is resolvable
- `actualStart` present when `wipState === IN_PROCESS` (ties into the earlier scheduler fix)

**4. Solve-time infeasibility (optional, defer)**
Could attach scheduler failures ("no feasible slots found") to the task for UI display. Out of scope for this sprint — see "Future phases" below.

### Interaction with existing `onError` policies

The `onError` policy in `mapping.json` still controls *what happens to the sync*. The validation-error array controls *what gets recorded on the entity*. They coexist:

| Policy | Sync behavior | Validation error attached |
|--------|---------------|---------------------------|
| `strict` | Sync aborts | N/A — record never reaches landscape |
| `skip` | Record dropped | N/A — record never reaches landscape, but logged in `SyncResult.skippedRecords[]` with same error shape |
| `default` | Default substituted, record loads | Warning attached to record |
| `annotate` (new) | Record loads, marked unschedulable if severity is error | Error or warning attached |

`annotate` is new. It's the policy that says "load this record anyway, even if it's broken, so the planner can see it exists and knows why it won't schedule." Use sparingly — only for fields where visibility of the broken record is more valuable than silence. Orphan resource references are the canonical `annotate` case: you want the planner to see the task exists and needs a resource fixed, not to make it invisible.

### Sync-level vs. record-level errors

Some errors belong at the sync level, not on records:

- "Upstream returned 401" — `SyncResult.errors`, not per-record
- "More than maxRecordErrorsBeforeAbort records failed" — `SyncResult.errors`
- "Required endpoint returned empty array" — `SyncResult.errors`

Rule: if the error is about a specific entity, it goes on the entity. If it's about the sync as a whole, it goes in `SyncResult`. Field-level errors appear in *both* — attached to the record, and counted in `SyncResult.warnings` for aggregate visibility.

### SyncResult aggregation

Extend `SyncResult` with a summary view of record-level errors:

```typescript
interface SyncResult {
  // ... existing fields
  validationSummary: {
    recordsWithErrors: number;           // entities with severity: "error"
    recordsWithWarnings: number;         // entities with severity: "warning" only
    unschedulableTasks: number;          // tasks where schedulable === false
    byCode: Record<string, number>;      // { UNPARSEABLE_DATE: 3, ORPHAN_REFERENCE: 1 }
    byEntity: Record<string, number>;    // { tasks: 4, orders: 0, resources: 0 }
  };
}
```

This is the dashboard-level rollup. The UI uses it to show "12 tasks with validation issues" and drill down to specific ones.

---

## Deliverables

### 1. Extended `IValidationError` type

**Location:** `packages/engine/Models/Core/error.ts` (extend the existing file)

Add `IValidationError` extending `IError`. Keep `IError` backward-compatible. Add a factory helper:

```typescript
export function makeValidationError(params: {
  agent: string;
  type: string;
  severity: "error" | "warning" | "info";
  reason: string;
  field?: string;
  source: "mapping" | "validation" | "engine" | "adapter";
  policy?: "strict" | "skip" | "default" | "annotate";
  rawValue?: unknown;
}): IValidationError;
```

Handles `detectedAt` timestamp generation and sensible defaults for optional fields.

### 2. `validationErrors` on primary entities

**Locations:**
- `packages/engine/Models/Entities/task.ts` — rename `errors` to keep backward compat; type becomes `IValidationError[]`
- `packages/engine/Models/Entities/order.ts` — new `validationErrors: IValidationError[]`
- `packages/engine/Models/Entities/resource.ts` — new `validationErrors: IValidationError[]`

Each entity gets:

```typescript
validationErrors: IValidationError[];

addValidationError(err: IValidationError): void;
clearValidationErrors(): void;
hasErrors(): boolean;              // any severity: "error"
hasWarnings(): boolean;            // any severity: "warning"
```

`CTPTask` also gets the `schedulable` getter.

Backward compat: the existing `addError(agent, reason)` method on `CTPTask` stays, and internally calls `addValidationError` with `severity: "error"`, `type: "LEGACY"`, `source: "engine"`. Existing call sites don't break.

### 3. MappingEngine gains an errors channel (plumbing only — no transform changes)

**Location:** `packages/api/src/modules/integration/mapping-engine.ts` (note: currently at `.../integration/mapping-engine.ts`, not `.../integration/mapping/mapping-engine.ts` — no nested `mapping/` directory today)

Change the shape of `MappingEngine.transform()` so it can report errors without throwing:

```ts
// Before
transform(raw: IRawDataPayload, profile: IMappingProfile | null): IRawDataPayload

// After
transform(raw: IRawDataPayload, profile: IMappingProfile | null): {
  payload: IRawDataPayload;
  errors: MappingError[];
}
```

Add a `MappingError` type (new file `packages/api/src/modules/integration/mapping-error.ts` — kept adjacent to the engine, not in `packages/engine/`, because it's API-layer concern tied to mapping profiles):

```ts
export interface MappingError {
  code: string;                   // e.g. 'UNPARSEABLE_DATE'
  entity: 'orders' | 'resources' | 'tasks';
  targetField: string;
  sourceField?: string;
  rawValue?: unknown;
  message: string;
  recordIndex?: number;
  severity: 'error' | 'warning';  // symmetry with IValidationError
}
```

Thread a per-call accumulator through `mapEntities` / `mapTasks` and return it alongside the payload. Update callers (search `this.mappingEngine.transform(` in `packages/api/src/modules/state/`) to consume the new shape.

**No transform bodies change in this sprint.** `toUTC` still does what it does today. The bug-fix sprint updates `toUTC` (and any later-identified transforms) to push into the accumulator when they detect bad input. This sprint only gives them the pipe to push into.

### 4. Cross-entity validation pass (framework only — no checks populated)

**Location:** `packages/api/src/modules/integration/validation-pass.ts` (new)

Create the module and export an entry point that the sync flow can call. No concrete checks populated in this sprint — the function exists with its signature and composition but iterates zero rules:

```ts
export function validateReferences(
  tasks: CTPTask[],
  orders: CTPOrder[],
  resources: CTPResource[],
): void {
  const orderKeys    = new Set(orders.map(o => o.key));
  const resourceKeys = new Set(resources.map(r => r.key));

  for (const task of tasks) {
    // Checks are registered here by the bug-fix sprint and beyond:
    //   - ORPHAN_RESOURCE  (Bug D, bug-fix sprint)
    //   - ORPHAN_ORDER     (placeholder; register if/when needed)
    //   - Chain integrity  (Sprint 2+)
  }
}
```

Wire it into `SyncService.sync()` (or whatever the current sync orchestrator is called): call after entity instances are built, before the landscape replace. Verification for this sprint is just "the function exists, runs without errors on clean data, and is invoked exactly once per sync." Populating the checks is the bug-fix sprint's job.

### 5. Landscape construction validation (hook only)

**Location:** The current hydrator is `packages/api/src/modules/state/state-hydrator.service.ts` (confirm path before coding — there's no `state.service.ts` today; the sync/state flow lives in `state-hydrator.service.ts` and callers).

Add a hook point at the end of landscape construction where invariant checks can be registered. No concrete checks in this sprint — just the hook. The bug-fix sprint adds the first real check (`parseIsoDateOrRecord` helper, which raises UNPARSEABLE_DATE on `!isValid`). Later sprints add:

- Task has a non-null `window` with positive duration
- Task's `duration` is a positive finite number
- `actualStart` present when `wipState === IN_PROCESS`

Verification for this sprint: hook exists, runs, no checks populated, tests still green.

### 6. SyncResult aggregation

**Location:** The sync orchestrator currently lives at `packages/api/src/modules/state/state.service.ts` (or whichever module owns `/v1/state/sync`; grep for the route handler to confirm). There is no structured `SyncResult` type today — this sprint introduces it. If an envelope already exists in the response path, extend it; otherwise define a minimal shape and thread it through.

After validation passes complete, compute `validationSummary`:

```typescript
function summarizeValidation(transformed: TransformedDataSet): ValidationSummary {
  const byCode: Record<string, number> = {};
  const byEntity: Record<string, number> = { tasks: 0, orders: 0, resources: 0 };
  let recordsWithErrors = 0;
  let recordsWithWarnings = 0;

  const tally = (entity: { validationErrors?: IValidationError[] }, kind: 'tasks' | 'orders' | 'resources') => {
    if (!entity.validationErrors?.length) return;

    const hasError = entity.validationErrors.some(e => e.severity === "error");
    const hasWarning = !hasError && entity.validationErrors.some(e => e.severity === "warning");

    if (hasError)        { recordsWithErrors++;   byEntity[kind]++; }
    else if (hasWarning) { recordsWithWarnings++; byEntity[kind]++; }

    for (const err of entity.validationErrors) {
      byCode[err.type] = (byCode[err.type] || 0) + 1;
    }
  };

  transformed.tasks.forEach(t     => tally(t, 'tasks'));
  transformed.orders.forEach(o    => tally(o, 'orders'));
  transformed.resources.forEach(r => tally(r, 'resources'));

  const unschedulableTasks = transformed.tasks.filter(t => !t.schedulable).length;

  return { recordsWithErrors, recordsWithWarnings, unschedulableTasks, byCode, byEntity };
}
```

Attach to `SyncResult`. Include in the response body of `/v1/state/sync`.

### 7. Scheduler respects `schedulable`

**Location:** `packages/engine/AI/Schedulers/basescheduler.ts` (and related per-scheduler files under `packages/engine/AI/Schedulers/`). The existing `includeInSolve=false` skip path is the simplest place to hook in — set `task.includeInSolve = false` whenever `schedulable === false` so the solver's existing user-excluded branch handles it without a new conditional. Alternately, add a direct `if (!task.schedulable) continue;` at the top of the schedule loop; both are fine, pick the one that matches style in that file.

When iterating tasks to schedule:

```typescript
if (!task.schedulable) {
  stats.skippedUnschedulable++;
  continue;
}
```

Attach a summary to the solve result: "N tasks skipped due to validation errors." Don't repeat the individual errors in the solve result — they're already on the tasks themselves.

### 8. API surface

`/v1/state` returns the landscape with `validationErrors` populated per entity. No new endpoint needed — the UI reads existing endpoints and gets the enriched data for free.

`/v1/state/sync` response includes `validationSummary` in the `SyncResult`.

---

## Migration Path

### Phase 1: Types and entity integration

- Extend `IError` → `IValidationError` (additive, non-breaking)
- Add `validationErrors` field to `CTPOrder` and `CTPResource` (renamed-compatible on `CTPTask`)
- Add `addValidationError`, `clearValidationErrors`, `hasErrors`, `hasWarnings` helpers
- Add `schedulable` getter to `CTPTask`
- Keep existing `addError(agent, reason)` working — it populates the new structure with defaults

Verification gate: all existing tests pass. No behavior change yet — just the data model is ready.

### Phase 2: MappingEngine and cross-entity population

- MappingEngine populates `validationErrors` for transform failures under `default` / `annotate` policies
- New `validation-pass.ts` with orphan-reference and chain-integrity checks
- SyncService calls the validation pass, then `applyTransformed`
- Scheduler reads `schedulable` and skips unschedulable tasks
- SyncResult includes `validationSummary`

Verification gate: bad-data-null-machine scenario now produces a task with a warning (not a silent dwell). orphan-resource scenario now produces a task with `schedulable: false` and a clear error (not a fake successful schedule).

### Phase 3: Landscape construction validation

- StateService checks window/duration invariants at landscape build
- `actualStart` check for `IN_PROCESS` tasks
- (Future: more invariants as they become obvious)

Verification gate: Bug C data (unparseable date) produces a task with a validation error — and never a 500.

---

## Testing Scenarios

| # | Scenario | What to verify |
|---|----------|----------------|
| 1 | Clean sync | All entities load with `validationErrors: []` and `schedulable: true` |
| 2 | bad-data-null-machine, policy `default` | Task loads with warning attached, `schedulable: true`, warning visible in `validationSummary.byCode` |
| 3 | bad-data-null-machine, policy `annotate` | Task loads with warning, same outcome as above (documenting the policy equivalence for warnings) |
| 4 | bad-data-unparseable-date, policy `annotate` | Task loads with `schedulable: false`, error type `UNPARSEABLE_DATE`, no 500 |
| 5 | orphan-resource scenario | Task loads with `schedulable: false`, error type `ORPHAN_RESOURCE`, `validationSummary.unschedulableTasks` incremented |
| 6 | Orphan order reference | Task loads with `schedulable: false`, error type `ORPHAN_ORDER` |
| 7 | chain-cycle scenario (duplicate sequence) | Tasks load with warnings, `schedulable: true` (warnings don't block scheduling) |
| 8 | Scheduler skips unschedulable tasks | Solve with orphan-resource data: unschedulable task is skipped, solve completes, result includes `skippedUnschedulable: 1` |
| 9 | SyncResult summary | Multiple bad records: `validationSummary.byCode` has correct counts per error type |
| 10 | Sensitive field masking | Field marked `sensitive: true` in mapping: error has no `rawValue` populated |
| 11 | Backward compat | Existing code calling `task.addError(agent, reason)` still works; error appears in `validationErrors` with severity "error" |
| 12 | Clear errors on re-sync | After a sync that attached errors, re-sync with clean data: errors are cleared on rebuilt entities |
| 13 | API response shape | `/v1/state` response includes `validationErrors` per entity; `/v1/state/sync` response includes `validationSummary` |

---

## Stafford-Specific Notes

This sprint lands before the first real Stafford capture. That timing matters:

- Real Genius data will almost certainly trigger Bug C (unparseable date) and probably Bug D (orphan resource). The infrastructure needs to exist *before* those bugs fire, so their fixes can plug into structured error reporting rather than hacky log messages.
- The first Stafford capture will produce a real number for `validationSummary.recordsWithErrors`. That number is the first data-quality metric the planner gets from CTP. It should be a useful number, not a scary one — which means the infrastructure has to exist *and* the fixes for bugs C and D have to use it properly.

Once real Stafford data is loaded and the summary shows (say) "4 tasks with validation errors, all UNPARSEABLE_DATE", that's a conversation starter with Stafford: "here are the records with data issues, can you confirm these are known bad rows in your ERP or should we adjust our parsing?"

---

## Files Changed

| File | Change |
|------|--------|
| `packages/engine/Models/Core/error.ts` | **MODIFIED** — Extend `IError` with `IValidationError` (additive superset). Add `makeValidationError` factory. |
| `packages/engine/Models/Entities/task.ts` | **MODIFIED** — Widen `errors: IError[]` to `IValidationError[]` (field name unchanged). Add `addValidationError`, `clearValidationErrors`, `hasErrors`, `hasWarnings`, `schedulable` getter. Existing `addError` delegates to new method with default severity. |
| `packages/engine/Models/Entities/order.ts` | **MODIFIED** — Add new `validationErrors: IValidationError[]` field + helpers. |
| `packages/engine/Models/Entities/resource.ts` | **MODIFIED** — Add new `validationErrors: IValidationError[]` field + helpers. |
| `packages/api/src/modules/integration/mapping-error.ts` | **NEW** — `MappingError` interface. |
| `packages/api/src/modules/integration/mapping-engine.ts` | **MODIFIED** — `transform()` returns `{payload, errors}`. Thread per-call error accumulator through `mapEntities`/`mapTasks`. **Transform bodies unchanged.** |
| `packages/api/src/modules/integration/validation-pass.ts` | **NEW** — Empty framework for cross-entity checks. |
| `packages/api/src/modules/state/state-hydrator.service.ts` (or whichever owns `/v1/state/sync`) | **MODIFIED** — Consume new `MappingEngine.transform()` shape. Call `validateReferences(...)` after entity construction, before landscape replace. Introduce `SyncResult` shape (or extend existing response envelope) with `validationSummary`. Add landscape-invariant hook point. |
| `packages/engine/AI/Schedulers/basescheduler.ts` | **MODIFIED** — Respect `schedulable === false` (reuse `includeInSolve=false` branch or add top-of-loop guard). Report `skippedUnschedulable` in solve stats. |
| Tests — multiple files | **NEW/MODIFIED** — 13 scenarios (note: scenarios requiring actual bug fixes — e.g. 4 bad-data-unparseable-date — assert "scaffolding ready, no behavior change yet"; they become real assertions in the bug-fix sprint). |

---

## Key Design Decisions

**Why extend `IError` rather than create a parallel type?**
`CTPTask.errors` already exists and is used by engine code. A parallel type would mean two arrays on tasks, two sets of helpers, and confusion about which to use when. Extending `IError` backward-compatibly means existing callers keep working; new callers get the richer shape.

**Why inline on entities, not side-channel?**
Already covered in the design section. The summary: entity-local queries stay entity-local, UI rendering is direct, and scheduler decisions don't need a lookup dance.

**Why `schedulable` as a getter, not a stored field?**
Keeps it honest. Every time the scheduler checks it, it reflects the current state of `validationErrors`. If errors get added or cleared, `schedulable` updates automatically. A stored field could go stale.

**Why the new `annotate` policy?**
`default` says "substitute a value and proceed as normal." `annotate` says "keep the record but mark it suspect." These are genuinely different intents. For orphan resource references, there's no sensible default — you can't invent a resource. But you *can* keep the task in the landscape with an error so the planner sees it needs attention. `annotate` is the policy for that case.

**Why populate errors on warnings too, not just errors?**
Warnings are the data-quality signal the planner uses to spot drift. "This task had a default applied" is information; hiding it makes the planner blind to ERP data issues. Warnings don't affect `schedulable`, so they don't block operations — they just show up in the dashboard.

**Why not add solver-time errors in this sprint?**
Scope control. Solve-time infeasibility is a different category — the data was fine, the *constraints* made the task unschedulable. Mixing that into the same array as ETL errors makes the UI harder to design ("why can't I schedule this task? bad data or tight constraints?"). Defer to a follow-up when the UI design is clearer.

**Why is sensitive-field handling part of this sprint?**
Because the moment real Stafford data is loaded, customer names and prices flow through the error path. A data-quality error that leaks "CustomerName: Acme Corp, Price: $47,293" into a log file or API response is a compliance problem. Design the masking in from the start.

---

## What This Sprint Does NOT Do

- **Fix Bug C, D, or B directly.** This is the infrastructure. The bug-fix sprint (`sprint-data-integrity-hardening.md`) uses this infrastructure to land clean, traceable fixes. Tightly coupled, separate sprints.
- **Populate any concrete check at the new hook points.** `validation-pass.ts` is empty; the hydrator's landscape-invariant hook is empty; `toUTC` is unchanged. This sprint is purely the pipe — bug-fix sprint is the first sprint that pushes anything through it.
- **Chain predecessor / chain-integrity checks.** Deferred. Sprint 2 adds `chain-cycle` warnings; Sprint 3 or later extends to predecessor validity once `linkId` semantics stabilize.
- **Build UI for validation errors.** No icons on tasks, no filter panel, no dashboard widget. Those land in a UI sprint. The API returns the data; the UI consumes it when ready.
- **Solve-time error attachment.** Out of scope. Future sprint.
- **Per-warning severity levels (info vs warning vs notice vs etc.).** Three levels is enough. Don't add more without a concrete use case.
- **Historical error tracking.** Each sync rebuilds the landscape, errors are derived fresh. No time-series of "this task has had 3 validation errors over 5 syncs." Separate concern.
- **Error suppression / allowlisting.** "Ignore all UNPARSEABLE_DATE errors on tasks in project X." Not needed until it's actually needed.

---

## Success Metric

When the first Stafford capture runs through a sync, the response to `/v1/state/sync` contains a `validationSummary` that tells you, in one glance, how clean the data is and what kinds of problems exist. If `validationSummary.recordsWithErrors === 0` and `recordsWithWarnings === 0`, Stafford's data is clean. If numbers are non-zero, you know exactly what to look into — by error type, by entity type, by count.

That metric becomes the baseline for every subsequent sync: is the data getting cleaner or drifting? Are new error types appearing (schema changes)? Are error counts trending up (ERP hygiene declining)?

This is the data-quality feedback loop the integration needs to scale beyond one tenant.

---

*This sprint is scaffolding. Its value is unlocked by the bug fixes that land on top of it, and by the UI affordances that come later. Standalone, it changes no user-visible behavior. With the bug-fix sprint, it transforms silent failures into actionable diagnostics. With the UI sprint, it becomes a data-quality dashboard. Build it now; reap the returns across three downstream sprints.*
