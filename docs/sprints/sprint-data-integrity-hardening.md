# Sprint 1b: Data Integrity Bug Fixes — Consuming the Validation Scaffolding

**Status:** 📋 Ready (revised 2026-04-19 — reframed as bug-fix-only; scaffolding split into companion sprint)
**Size:** ~2-3 hours CC work (three bug fixes + fixture expansion + regression tests; shrunk from 4-5h because scaffolding is now its own sprint)
**Depends on:**
- **Sprint 1a — Entity Validation Errors scaffolding** (`sprint-entity-validation-errors.md`). That sprint MUST ship first; this one pushes concrete errors through the scaffolding it provides.
- MappingEngine `toUTC` sprint (`b2114b6`)
- RestAdapter error-paths sprint (`62a732d`)
- mock-genius Phase 2 + bad-data fixtures (`7e0157d`)

**Triggered by:** The bad-data walkthrough against the mock-genius fixtures surfaced four real bugs. Two are crash-class (`500` on unparseable date; silent scheduling of tasks referencing non-existent resources) and would fire on Stafford beta day one if their real data has any hiccup. A third bug (REST order data bypassed by `/ctp/state`) is thematically separate but bundled for scope cohesion; it needs shipping before beta regardless. With the scaffolding sprint handling type/field/SyncResult plumbing, this sprint is a focused bug-fix pass that populates concrete errors at the four known problem sites.

---

## Problem

Four bugs surfaced in yesterday's walkthrough (see `docs/testing/mock-genius-walkthrough.md`):

| # | Scenario | Severity | Symptom |
|---|---|---|---|
| **C** | `bad-data-unparseable-date` | HIGH | Two problems: (1) `toUTC` silently returns the invalid raw value when `DateTime.fromISO(...).isValid === false` (see `mapping-engine.ts:75`), and (2) the raw bad string then reaches the engine's `date.ts:21` (`this.baseDate.plus({ seconds: sec })`) where luxon throws `Invalid unit value NaN` — surfaces as 500 on `/ctp/state`. Both layers need defense. |
| **D** | `orphan-resource` | HIGH | Two paths to surface, one partially fixed: (1) **Solver path** — `0b98bd1` already marks the task `state: NOT_SCHEDULED, feasible: false` (good) but without any diagnostic signal (operator sees "can't schedule" with no reason); (2) **Where-To path** — `ScheduleEvaluator.whereTo` returns `options: [{resources: [], start, end, score}]` — a placement with no resource, inviting the operator to commit garbage. Sprint 1b fixes both: attaches `ORPHAN_RESOURCE` validation error (diagnostic signal), sets `includeInSolve=false` via Sprint 1a's piggyback (solver path — no behavior change since `0b98bd1` already handles), and adds a `schedulable` gate to `whereTo()` (closes Where-To hole). |
| **A** | (any REST tenant) | MEDIUM | `/ctp/state` reads orders from `configService.getOrders()` (file), not from the REST-hydrated landscape. Order priorities/dates returned to clients bypass MappingEngine entirely. |
| **B** | `bad-data-null-machine` | LOW (Sprint 2) | `MachineCode: null` → task silently becomes pure-duration. Probably a data-quality issue, silently masked. |
| — | `chain-cycle` | LOW (Sprint 2) | Two tasks sharing SequenceNumber silently linearize via stable sort. |

This sprint addresses **C**, **D**, and **A**. B and chain-cycle go to Sprint 2 (warning layer).

With Sprint 1a's scaffolding in place (`IValidationError` on entities, `schedulable` getter on `CTPTask`, `MappingError` channel on `MappingEngine.transform()`, empty `validation-pass.ts` and landscape-invariant hook, `SyncResult.validationSummary`, scheduler respects `schedulable`), this sprint's work collapses to:
- **Bug C (transform half):** `toUTC` pushes a `MappingError` into the accumulator when `DateTime.fromISO(...).isValid === false`.
- **Bug C (hydrator half):** add `parseIsoDateOrRecord` helper; attach `EntityValidationError` with code `UNPARSEABLE_DATE` when an ingested date can't be parsed. Defense in depth for flat-file tenants and fields that bypass `toUTC`.
- **Bug C (arithmetic guard):** defensive check at `packages/engine/Models/Core/date.ts:21` so a NaN or invalid base date throws a structured error with context, not luxon's opaque `Invalid unit value NaN`.
- **Bug D:** populate the `ORPHAN_RESOURCE` check in `validation-pass.ts` (which Sprint 1a created empty).
- **Bug A:** `/ctp/state` reads orders from `landscape.orders`, not `configService.getOrders()`.
- **Fixture expansion:** add `"2026-02-31"` and `""` variants to `bad-data-unparseable-date` so tests cover the full shape of "luxon says !isValid."

## Non-problem (do not change)

- **Solver behavior.** The scheduler, chain propagation, and scoring are untouched. Sprint 1a already taught the scheduler to skip `schedulable:false`; this sprint doesn't add new solver branches.
- **Scaffolding types and shapes.** `IValidationError`, `MappingError`, entity fields, `schedulable` getter, `SyncResult.validationSummary` are all Sprint 1a's output. This sprint consumes them as-is — do NOT modify shapes here.
- **Full field-level `onError` policy engine (strict / skip / default / annotate).** Sprint 1a introduces the `annotate` policy as the default for this sprint's bug-fix work (records still load, but are marked unschedulable). A full *configurable* per-field policy pipeline where mapping profiles choose strict/skip/default/annotate per field is Sprint 2+ and depends on the transform audit.
- **Sprint 2+ scope.** We explicitly do NOT audit `concat`, `lookup`, `factor`, `durationCalc` for the same pattern yet; only `toUTC`. Sprint 2 does that sweep.

---

## Design

### Core principle

Invalid data becomes visibly invalid data. Sprint 1a put the data structures in place; this sprint makes them carry content. After this sprint, every entity with a data-quality problem has a structured explanation attached; the scheduler already knows to skip `schedulable:false` tasks (Sprint 1a wiring); the API already exposes the errors in its DTOs (Sprint 1a wiring).

### Two-layer defense for Bug C

Bug C is fixed at both the transform layer (MappingEngine) and the hydrator layer (`StateHydratorService`) on purpose:

1. **Transform layer — `toUTC` validates.** Today `toUTC` returns the raw invalid value when luxon's `DateTime.fromISO(...).isValid === false` (`mapping-engine.ts:75`). That silent pass-through is the root of the 500. The fix: detect `!isValid` and push a `MappingError` into the accumulator Sprint 1a threaded through `transform()`. The raw value still flows downstream (so the hydrator's defensive parse is what ultimately keeps NaN out of arithmetic); the transform's job is to flag the source field clearly in the sync result.
2. **Hydrator layer — defensive parse on all ingested dates.** Dates can reach the hydrator from flat-file tenants (which bypass MappingEngine entirely) and from fields not mapped via `toUTC`. The hydrator's `parseIsoDateOrRecord` helper validates every date at ingestion and attaches an `EntityValidationError` (code `UNPARSEABLE_DATE`) if the parse fails. Returning `null` instead of the bad string is what keeps `date.ts:21`'s arithmetic from ever seeing NaN.
3. **Arithmetic guard — `date.ts:21`.** Even with (1) and (2), the engine's own math should not trust its inputs. A single `if (!this.baseDate.isValid || !Number.isFinite(sec)) throw new Error(...)` at the top of the `plus({ seconds })` call swaps luxon's opaque "Invalid unit value NaN" for a structured error that identifies *which* task and field caused it. Third layer of defense.

### Error codes populated by this sprint

All codes/types are already defined by Sprint 1a; this sprint is the first to actually emit them.

| Code | Source | Layer | Carrier |
|---|---|---|---|
| `UNPARSEABLE_DATE` | `toUTC` transform | MappingEngine | `SyncResult.mappingErrors[]` (via accumulator) |
| `UNPARSEABLE_DATE` | hydrator `parseIsoDateOrRecord` | hydrator | `entity.validationErrors[]` (Sprint 1a field) |
| `ORPHAN_RESOURCE` | `validation-pass.ts` | validation pass | `task.validationErrors[]` (Sprint 1a field) |

Same code at two layers is deliberate — they describe the same data-quality problem; the carrier differs.

---

## Deliverables

*All shape/type/entity-field work is Sprint 1a. This sprint starts at "the pipes are in, fill them."*

### 1. `toUTC` validates and emits MappingError (Bug C — transform layer)

**Location:** `packages/api/src/modules/integration/mapping-engine.ts`

Sprint 1a changed `transform()` to return `{ payload, errors }` and threads an accumulator through the call graph. This sprint updates the `toUTC` branch at `mapping-engine.ts:68-77` to push into that accumulator.

Current body (for reference):
```ts
if (rule.toUTC && val !== undefined && val !== null && val !== '') {
  const s = String(val);
  const hasEmbeddedZone = HAS_TZ_DESIGNATOR.test(s);
  if (!hasEmbeddedZone && !rule.fromTimezone) return val;
  const dt = DateTime.fromISO(s, {
    zone: hasEmbeddedZone ? undefined : rule.fromTimezone,
  });
  if (!dt.isValid) return val;          // ← silent pass-through today
  return dt.toUTC().toISO();
}
```

Change the `if (!dt.isValid) return val;` line: instead of silently passing through, call `this.accumulator.push({...})` with a MappingError carrying `code: 'UNPARSEABLE_DATE'`, the target/source field names, the raw value, and `recordIndex`. Still return `val` (preserve pass-through behavior for downstream). The hydrator catches the raw value on ingest.

Also capture luxon's `dt.invalidReason` in the message when available (e.g. "unparsable", "invalid time" for `"2026-02-31"`) — gives ops clear signal without needing to reproduce.

### 2. Hydrator validation helpers (Bug C — hydrator layer)

**Location:** `packages/api/src/modules/state/state-hydrator.service.ts`

Add a private helper that's used everywhere a date is parsed into the landscape:

```ts
private parseIsoDateOrRecord(
  raw: unknown,
  target: { validationErrors: EntityValidationError[] },
  field: string,
): DateTime | null {
  if (raw === undefined || raw === null || raw === '') return null;   // silently missing
  const dt = DateTime.fromISO(String(raw));
  if (dt.isValid) return dt;
  target.validationErrors.push({
    code: 'UNPARSEABLE_DATE',
    field,
    message: `Field '${field}' is not a valid ISO date: ${JSON.stringify(raw)}`,
    severity: 'error',
    rawValue: raw,
  });
  return null;
}
```

Replace every `DateTime.fromISO(item.someField)` call site with this helper. Sites to update (confirm with grep; at minimum):

- `hydrateOrders`: `item.dueDate`, `item.lateDueDate`
- `hydrateTasks` / `buildTask` (wherever it lives): `item.windowStart`, `item.windowEnd`, `item.actualStart`, `item.actualEnd`

If any of these are required for a task to be schedulable (e.g. windowEnd is used in solve logic), the helper returning null also triggers `schedulable: false` at the end of the hydration path for that entity.

### 3. Orphan-resource check (Bug D)

**Location:** `packages/api/src/modules/integration/validation-pass.ts` (file exists from Sprint 1a with empty framework; this sprint populates the first check).

Inside the existing `validateReferences(tasks, orders, resources)` function, add the orphan-resource check body:

```ts
for (const task of tasks) {
  task.capacityResources?.forEach((cr, idx) => {
    if (!cr.resource) return;                // null/empty handled separately in Sprint 2 (Bug B)
    if (!resourceKeys.has(cr.resource)) {
      task.addValidationError(makeValidationError({
        agent: 'CrossEntityValidation',
        type: 'ORPHAN_RESOURCE',
        severity: 'error',
        reason: `Task '${task.key}' references resource '${cr.resource}' which does not exist in the landscape`,
        field: `capacityResources[${idx}].resource`,
        source: 'validation',
        policy: 'annotate',
        rawValue: cr.resource,
      }));
    }
  });
}
```

No other wiring needed for the solver — Sprint 1a already invokes `validateReferences(...)` from the sync orchestrator, and the scheduler already respects `schedulable:false` (via Sprint 1a's `includeInSolve` piggyback).

### 3b. Where-To respects `schedulable` (Bug D, API layer)

**Location:** `packages/api/src/modules/ctp/ctp.service.ts:656` — the `whereTo()` method.

**Context discovered during Sprint 1a manual testing:** `0b98bd1`'s all-filtered infeasibility guard protects the solver path — for an orphan-resource task, `/solve-and-sync` now correctly returns `state: NOT_SCHEDULED, feasible: false`. But `/where-to` bypasses the solver and uses a different code path (`ScheduleEvaluator.whereTo`) whose `canMove()` gate only checks `wipstate === NOT_STARTED`. It does NOT check `includeInSolve` or `schedulable`.

Result today (verified against `orphan-resource` fixture with active orphan task): Where-To returns `options: [{ resources: [], start, end, score, ... }]` — a "valid" placement with no resource. The UI's "Where to?" feature effectively invites the operator to commit an invalid schedule.

**Fix:** add a `schedulable` gate alongside the existing early-out blocks. After `canMove()`:

```ts
if (!task.schedulable) {
  return this.formatWhereToResponse({
    taskKey, taskName: task.name, currentAssignment: null, options: [],
    stats: { contextsEvaluated: 0, feasibleCount: 0, infeasibleCount: 0, timeMs: 0 },
  }, `Task has validation errors: ${task.validationErrors.map(e => e.type).join(', ')}`);
}
```

Pure defensive check against Sprint 1a's scaffolding. No new validation codes, no new infrastructure. Closes the Where-To hole using the same `schedulable` signal the solver already respects.

**Acceptance (verified against `orphan-resource` active-task fixture):**
- `POST /v1/ctp/tasks/PV-001-FLANGE/where-to` returns `options: []` with reason `"Task has validation errors: ORPHAN_RESOURCE"`
- Stats show `contextsEvaluated: 0, feasibleCount: 0, infeasibleCount: 0`
- UI "Where to?" panel renders the reason instead of a placement

### 4. Bug A fix — `/ctp/state` reads orders from landscape

**Location:** `packages/api/src/modules/ctp/ctp.service.ts:3385`

Change:
```ts
const orderData = this.configService.getOrders();
const orders = orderData.map((order) => { ... });
```

To:
```ts
const orders = landscape.orders?.toArray().map((order) => { ... }) ?? [];
```

The shape mapping is the same; only the source changes. Fields like `scheduledQty` (computed from task state) and `fillRate` already require the landscape, so this unifies the data source.

Also audit — grep for other `configService.getOrders()` / `configService.getResources()` / `configService.getTasks()` calls in response-building paths. If any are in a response builder (not in hydration), swap them to landscape-sourced.

### 5. Arithmetic guard at `date.ts:21` (Bug C — third layer)

**Location:** `packages/engine/Models/Core/date.ts:21`

Current body:
```ts
return this.baseDate.plus({ seconds: sec });
```

Replace with:
```ts
if (!this.baseDate.isValid) {
  throw new Error(
    `CTPDate.plus: baseDate is invalid (reason: ${this.baseDate.invalidReason ?? 'unknown'}). ` +
    `This indicates upstream data validation was bypassed. Caller: ${<caller context if available>}`
  );
}
if (!Number.isFinite(sec)) {
  throw new Error(`CTPDate.plus: seconds must be finite, got ${sec}.`);
}
return this.baseDate.plus({ seconds: sec });
```

Rationale: after deliverables 1 and 2, a bad date should never reach this method. But the method's input trust boundary is "anyone in the engine can call me." A structured error with `invalidReason` is massively more debuggable than luxon's opaque "Invalid unit value NaN" when something slips through.

### 6. Fixture expansion — `bad-data-unparseable-date`

**Location:** `tools/mock-genius/fixtures/bad-data-unparseable-date/productionTaskWithAdvancedInfoViewEntity.json`

Current fixture covers two variants: `"not-a-date"` (line 16) and `null` (multiple records). Add two more in place of two currently-null records:

| Variant | Raw value | Expected behavior |
|---|---|---|
| Garbage string | `"TaskStartDate": "not-a-date"` (already present) | MappingError, validationError on task, `schedulable: false` |
| Invalid calendar | `"TaskStartDate": "2026-02-31"` (NEW) | Same — luxon `!isValid` for impossible dates. `invalidReason` should be `"unit out of range"` or similar |
| Empty string | `"TaskStartDate": ""` (NEW) | No error — treated as silently missing, task stays schedulable |
| Null | `"TaskStartDate": null` (multiple present) | No error, silently missing |
| Valid w/ offset | `"TaskStartDate": "2026-03-15T08:00:00+13:00"` (present on later records) | No error, UTC-normalized |

---

## Testing scenarios

*Scaffolding tests (entity field defaults, type shapes, empty `validateReferences` no-op) are Sprint 1a's responsibility. This sprint's tests assert that concrete bugs are actually fixed.*

### MappingEngine unit tests

**Location:** `packages/api/src/modules/integration/__tests__/mapping-engine.test.ts` (MODIFY — add toUTC validation cases to existing file)

| # | Input | Expected |
|---|---|---|
| M1 | Record with `TaskStartDate: "not-a-date"`, profile maps it via `toUTC` to `windowStart` | `result.errors` contains one `MappingError` `{code: UNPARSEABLE_DATE, targetField: 'windowStart', sourceField: 'TaskStartDate', rawValue: 'not-a-date'}`; `result.payload.tasks[0].windowStart === 'not-a-date'` (pass-through preserved) |
| M2 | Record with `TaskStartDate: "2026-02-31"` (valid shape, invalid calendar date) | One MappingError (luxon marks `!isValid` for impossible dates); pass-through preserves raw value |
| M3 | Record with `TaskStartDate: ""` | No MappingError (empty string is "silently missing," not "unparseable") |
| M4 | Record with `TaskStartDate: null` | No MappingError |
| M5 | Record with `TaskStartDate: "2026-03-15T08:00:00+13:00"` | No MappingError; `windowStart` is UTC-normalized ISO string |
| M6 | Three records, middle one has bad date | `errors.length === 1`, `errors[0].recordIndex === 1`, other two records map successfully |

### Hydrator tests

**Location:** `packages/api/src/modules/state/__tests__/validation.spec.ts` (NEW)

Direct tests against `StateHydratorService.buildLandscape()` with crafted `IRawDataPayload` inputs. No mock-genius server needed.

| # | Input | Expected |
|---|---|---|
| 1 | Task with `windowStart: "not-a-date"` | Task has 1 validation error `{code: UNPARSEABLE_DATE, field: 'windowStart'}`, `schedulable: false`, `includeInSolve: false` |
| 2 | Task with `windowStart: null` | No validation error (silently missing), `schedulable: true` |
| 3 | Task with `windowStart: undefined` | No validation error, `schedulable: true` |
| 4 | Task with valid `windowStart: "2026-03-15T00:00:00Z"` | No validation error, `schedulable: true` |
| 5 | Order with `dueDate: "garbage"` | Order has UNPARSEABLE_DATE validation error |
| 6 | Task references resource `"MISSING-M1"` not in landscape | Task has 1 validation error `{code: ORPHAN_RESOURCE, field: 'capacityResources[0].resource'}`, `schedulable: false` |
| 7 | Task references valid resource | No ORPHAN_RESOURCE error |
| 8 | Task with both unparseable date AND orphan resource | Two errors; `schedulable: false` |
| 9 | Task with only severity:warning errors (none in this sprint but verify scaffolding) | `schedulable: true`, errors present |

### End-to-end scenarios (via mock-genius)

Prerequisite: mock running, API running, stack wired per `docs/testing/mock-genius-walkthrough.md`.

| # | Scenario | Before fix (today, after Sprint 1a) | After fix (Sprint 1b) |
|---|---|---|---|
| E1 | `bad-data-unparseable-date` sync | Sync 201; `/ctp/state` returns **500** from luxon `Invalid unit value NaN` at `date.ts:20` called from `extractResults` | Sync 201; `/ctp/state` 200; affected task has `validationErrors: [{code: UNPARSEABLE_DATE, field: 'windowStart', rawValue: 'not-a-date', ...}]`, `schedulable: false`; sync response's `mappingErrors` contains matching transform-layer entry |
| E2a | `orphan-resource` sync + solve | Solver already correct: `state: NOT_SCHEDULED, feasible: false` — but **no diagnostic signal** (validationErrors, errors, infeasibilityReport all empty, even at detailLevel=diagnostic) | Task has `validationErrors: [{code: ORPHAN_RESOURCE, field: 'capacityResources[0].resource', rawValue: 'MACHINE-DOES-NOT-EXIST-999', ...}]`, `schedulable: false` — operator sees WHY it can't schedule |
| E2b | `orphan-resource` + `POST /v1/ctp/tasks/PV-001-FLANGE/where-to` | Returns `options: [{resources: [], start, end, score, ...}]` — silent pure-duration placement with no resource | Returns `options: []` with reason `"Task has validation errors: ORPHAN_RESOURCE"` |
| E3 | `stafford-engineering-test` happy path | Works — `mappingErrors: []`, all validationSummary counters zero, DTOs carry empty-default new fields | Still works — same shape, still all-zero counters, zero validation errors on any entity |
| E4 | Bug A — REST sync produces orders with MappingEngine-transformed fields | Orders in `/ctp/state` response come from file `data/orders.json` (bypasses MappingEngine) | Orders come from landscape.orders; fields reflect MappingEngine output (verifiable by temporarily setting Strategy-to-priority in mapping.json and observing the response) |

### Regression check for deferred scenarios

| Scenario | Sprint 1 acceptable behavior |
|---|---|
| `bad-data-null-machine` | Still silently becomes pure-duration (Sprint 2 addresses). Confirm via walkthrough that the behavior is unchanged — this sprint should NOT accidentally change it. |
| `chain-cycle` | Still silently linearizes (Sprint 2 addresses). Same — confirm unchanged. |

**Clarification on the yesterday-review bullet "Verify bad-data-null-machine and orphan-resource scenarios now fail loudly":** this is a *verification* bullet, not a fix bullet. After Sprint 1:
- `orphan-resource` **fails loudly** (Bug D fix — entity has `ORPHAN_RESOURCE` validationError, `schedulable: false`)
- `bad-data-null-machine` **does NOT fail loudly yet** — this is Sprint 2's work. Sprint 1's verification is that the scenario still produces its pre-sprint behavior (pure-duration task, no error). If Sprint 1 *inadvertently* changed this, that's a regression to fix before shipping.

---

## Files changed

*Scaffolding-owned files (validation.ts, entity-field additions, MappingError type, empty validation-pass.ts, SyncResult shape, scheduler `schedulable` respect) are listed in Sprint 1a's Files Changed table, not here.*

| File | Change |
|---|---|
| `packages/engine/Models/Core/date.ts` | **MODIFIED** — defensive `isValid` / `Number.isFinite` guard on `plus({ seconds })` so a bad base date or NaN arg throws a clear structured error rather than luxon's opaque "Invalid unit value NaN" |
| `packages/api/src/modules/integration/mapping-engine.ts` | **MODIFIED** — `toUTC` branch pushes `MappingError` (UNPARSEABLE_DATE) into the Sprint-1a-provided accumulator when `!dt.isValid`; still returns raw value for pass-through |
| `packages/api/src/modules/integration/__tests__/mapping-engine.test.ts` | **MODIFIED** — add M1-M6 cases |
| `packages/api/src/modules/integration/validation-pass.ts` | **MODIFIED** — populate the orphan-resource check inside the existing (Sprint 1a) framework |
| `packages/api/src/modules/state/state-hydrator.service.ts` | **MODIFIED** — add `parseIsoDateOrRecord` helper; replace every `DateTime.fromISO(...)` call site that mutates an entity field; on `!isValid` attach `EntityValidationError` via `entity.addValidationError(...)` |
| `packages/api/src/modules/state/__tests__/validation.spec.ts` | **NEW** — 9 hydrator validation scenarios |
| `packages/api/src/modules/ctp/ctp.service.ts` | **MODIFIED** — Bug A fix (`/ctp/state` reads orders from landscape); Bug D Where-To gate (`whereTo()` returns empty options when `!task.schedulable`). DTO enrichment with validationErrors/schedulable is Sprint 1a's work. |
| `packages/api/src/modules/ctp/__tests__/validation-e2e.spec.ts` | **NEW** — 4 end-to-end scenarios (E1-E4) |
| `tools/mock-genius/fixtures/bad-data-unparseable-date/productionTaskWithAdvancedInfoViewEntity.json` | **MODIFIED** — add `"2026-02-31"` and `""` variants |
| `docs/testing/mock-genius-walkthrough.md` | **MODIFIED** — update expected outcomes for 3c and 3e to reflect new behavior; note 3a and chain-cycle remain Sprint-2-deferred |

---

## Verification

Before committing:

1. `rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine && npm run build --workspace=@ctp/api`
2. `npx vitest run` — all existing tests still pass; new tests (6 MappingEngine + 9 hydrator + 4 e2e) pass.
3. Full stack walkthrough per `docs/testing/mock-genius-walkthrough.md`:
   - Scenario 3c (`bad-data-unparseable-date`) — sync returns 201 (not 500); response contains `validationErrors` on the affected task
   - Scenario 3e (`orphan-resource`) — task is not in infeasible list; has `ORPHAN_RESOURCE` validation error
   - Scenario 3a (`bad-data-null-machine`) — behavior unchanged (Sprint 2 target)
4. UI smoke: open `http://localhost:3001/?tenant=stafford-engineering-test` against each of the 9 scenarios. No new React errors in console; tasks render. The UI will NOT visibly indicate validation errors yet — that's Sprint 2.

---

## Out of scope

- **UI affordance for validation errors and mapping errors.** No icons, no filters, no details panel. Sprint 2.
- **Auditing `concat`, `lookup`, `factor`, `durationCalc` for the same class of silent failure.** Only `toUTC` is hardened in this sprint. Sprint 2 does the sweep.
- **Configurable field-level `onError` policy (strict / skip / default).** This sprint records transform errors and passes raw values through. A configurable policy engine depends on the transform audit and is Sprint 2+.
- **Cross-entity validation beyond the one orphan-resource check.** Things like "order references a product that doesn't exist," "chain has no START," "duplicate task keys" wait for Sprint 3's `validateLandscape()` design.
- **Warnings** (severity:warning). The type allows them, but this sprint emits only errors. Warnings are a Sprint 2 concern (e.g. null MachineCode → warning, chain-cycle → warning).
- **Data-quality dashboard.** Sprint 2.
- **The catalog of engine's implicit data-shape assumptions.** Sprint 3 — we deliberately don't do that audit yet; this sprint fixes the known-critical sites and lays scaffolding.

---

*Bounded sprint with two layers of defense for Bug C, single-layer fixes for Bug D and Bug A. Invalid data is now honestly invalid at both the transform and hydrator layers — it's flagged, excluded from the solver, and carries a machine-readable reason. UI and comprehensive transform coverage come in Sprint 2; the validateLandscape() contract comes in Sprint 3. This sprint's value proposition: "The day-one Stafford beta won't 500 on a malformed date or silently schedule on a typo'd machine."*
