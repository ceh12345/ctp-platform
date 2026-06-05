# Mapping Change Log — v3.1 (incremental update)

Builds on `mapping-change-log-v3.md` (v3). v3.1 applies refinements from Kaleb's email (April 2026) and findings from the slim-100 end-to-end validation test. Larger SO/JOB/WO architectural questions are deferred to v3.2 pending domain clarification.

---

## Why v3.1 exists

Two sources of input drove this update:

1. **Kaleb's email** answered five mapping questions concretely (R/W/S meanings, Formula HR/UN vs JR/DY, WoStatusCode lifecycle, late-tolerance concept, default calendar handling).
2. **The slim-100 end-to-end test** (against captured WORK7 fixtures) surfaced a critical task-key collision bug and a duration-source field gap. Both shipped in commit `b27fe99` ahead of this v3.1 doc.

v3.1 captures the Kaleb-driven refinements and folds the slim-test fixes into a single coherent change log entry.

---

## Changes from v3

### Tasks

#### `wipState` — derive placeholder → direct lookup ✓

**Before (v3):**
```json
"wipState": { "from": "WipState" }
```
(targeting a field that doesn't exist in real Genius — falls through silently)

**After (v3.1):**
```json
"wipState": {
  "from": "WoStatusCode",
  "lookup": {
    "CREATED": "NOT_STARTED",
    "PRINTED": "IN_PROCESS",
    "CLOSED": "COMPLETED",
    "_default": "NOT_STARTED"
  }
}
```

**Source:** Kaleb confirmed CREATED / PRINTED / CLOSED on `WoStatusCode` map directly to NOT_STARTED / IN_PROCESS / COMPLETED. No engine derive feature needed.

**Data note:** `CLOSED` never appears in adapter-fetched data because we filter `Wostatus != CLOSED` upstream — the lookup entry is defensive. `PLANNED` (1 record observed) falls to `_default → NOT_STARTED` per Kaleb's note that PLANNED is "currently inactive but you may see traces in WORK7."

**Caveat to monitor:** ~92% of active task records carry `WoStatusCode = PRINTED` regardless of whether `TaskStartDate` is populated. This means most of the loaded landscape will be tagged `IN_PROCESS` even for tasks that haven't physically begun. If the engine treats `IN_PROCESS` as "do not reschedule," scheduling could lock up. Behavior to be observed post-apply; escalate to Kaleb if it breaks scheduling.

#### `tasks.key` — collision fix ✓ (already shipped in `b27fe99`)

**Before (v3):**
```json
"key": { "from": ["JobCode", "OperationCode"], "sep": "-" }
```

**After (v3.1):**
```json
"key": { "from": ["WorkOrderCode", "OperationCode", "Order"], "sep": "-" }
```

**Source:** slim-100 test showed silent ~50% dedup. In the full WORK7 capture, the v3 key produces 211 cross-WO collisions (same triplet appearing across different work orders); the v3.1 key reduces collisions to exactly 51 — all byte-identical Genius source duplicates that *should* dedupe.

#### `tasks.durationSeconds` — CycleTime → TotalPlannedMachineHours ✓ (already shipped in `b27fe99`)

**Before (v3):**
```json
"durationSeconds": { "from": "CycleTime", "factor": 3600 },
"durationQty":     { "from": "WoPlannedQuantity" },
"durationType":    { "value": 0 }
```

**After (v3.1):**
```json
"durationSeconds": { "from": "TotalPlannedMachineHours", "factor": 3600 },
"durationQty":     { "value": 1 },
"durationType":    { "value": 0 }
```

**Source:** slim-100 test revealed 37% of tasks have `CycleTime=0`. `TotalPlannedMachineHours` is Genius's pre-computed total: equals `CycleTime × Qty` for normal tasks, includes setup hours for setup-heavy tasks, and is correctly populated for fixed-duration tasks. Coverage: 92.7% of tasks have non-zero `TotalPlannedMachineHours` vs ~63% under the old calculation.

**Residual zero-duration cases:** 12 of 14 zero-duration tasks in slim are `OUT` (outsource) operations — Kaleb's `JR/DY = calendar days for subcontract`. These genuinely have 0 machine-hours; their duration semantics belong to the SUBCONTRACT_DAYS task type and require separate handling. See "v3.2 deferred" below.

#### `tasks.type` — JR/DY → SUBCONTRACT_DAYS

**Before (v3):**
```json
"type": { "from": "Formula", "lookup": { "HR/UN": "STANDARD", "JR/DY": "DAILY", "_default": "STANDARD" } }
```

**After (v3.1):**
```json
"type": { "from": "Formula", "lookup": { "HR/UN": "STANDARD", "JR/DY": "SUBCONTRACT_DAYS", "_default": "STANDARD" } }
```

**Source:** Kaleb explained `JR/DY = calendar days for subcontract operations` (vs `HR/UN = hours per part for internal work`). Renamed from generic `DAILY` to make the operational meaning explicit. If the engine doesn't yet recognize `SUBCONTRACT_DAYS` as a task type, that's an engine concern — the mapping correctly reflects the source semantics regardless.

#### `tasks.actualStart` — kept as v3 simple form (deviation from v3.1 prompt)

The v3.1 prompt instructed *"keep TODO as in v3."* Our committed v3 (per `mapping-change-log-v3.md` section 3) had already simplified `actualStart` from a `_derive` placeholder to:

```json
"actualStart": { "from": "TaskStartDate", "toUTC": true }
```

The simple form produces identical output to the prompt's proposed conditional `_derive`, because `applyMappings` skips fields whose source resolves to null/undefined. We retained the simple form. **Net effect on engine-derive scope:** v3.1 reduces engine-derive dependencies from 1 (`actualStart`) to 0. The conditional logic is no longer needed anywhere in the mapping.

### Resources

#### `type` and `class` — collapse R + W to MACHINE

**Before (v3):**
```json
"type":  { "from": "RessourceType", "lookup": { "R": "MACHINE", "W": "WORKCENTER", "S": "SUBCONTRACT", "_default": "MACHINE" } },
"class": { "from": "RessourceType", "lookup": { "R": "MACHINE", "W": "LABOR_POOL", "S": "SUBCONTRACT", "_default": "MACHINE" } }
```

**After (v3.1):**
```json
"type":  { "from": "RessourceType", "lookup": { "R": "MACHINE", "W": "MACHINE", "S": "SUBCONTRACT", "_default": "MACHINE" } },
"class": { "from": "RessourceType", "lookup": { "R": "MACHINE", "W": "MACHINE", "S": "SUBCONTRACT", "_default": "MACHINE" } }
```

**Source:** Kaleb said *"treat R and W as the same for now (single capacity)."*

**What's preserved:** `parallelCapacity` from `NumOfAvgResource` still differentiates W (multi-resource pools, e.g. `ASSEMBLY & FITTING` ParallelN=4) from R (single named operators, ParallelN=0). The mathematical capacity model still distinguishes them; only the type/class label is collapsed.

**Tradeoff:** CTP UI loses the operator-vs-work-center label distinction. For beta this is acceptable; if Stafford reintroduces work-centre semantics later, the lookup splits back out.

### Orders

#### `dueDate` / `lateDueDate` — swap

**Before (v3):**
```json
"dueDate":     { "from": "DeliveryDate", "toUTC": true },
"lateDueDate": { "_TODO": "...", "_default": "@dueDate" }
```

**After (v3.1):**
```json
"dueDate":     { "from": "JobEndDate",   "toUTC": true },
"lateDueDate": { "from": "DeliveryDate", "toUTC": true }
```

**Source:** Kaleb described tolerance as *"the shipping buffer (the difference between the job end date and the job delivery date)."* In the CTP model:
- `dueDate` = production target = `JobEndDate` (when work must be off the floor)
- `lateDueDate` = absolute customer-facing limit = `DeliveryDate`

**Verification (against full WORK7 capture, n=956):**
- `JobEndDate` populated: 100%
- `DeliveryDate` populated: 100%
- `JobEndDate ≤ DeliveryDate`: 98.6% (matches the shipping-buffer model)

**Removes the engine `@-reference` capability gap** — this rule no longer needs cross-field syntax.

#### `jobCode` — passthrough field

**Added to orders.mappings:**
```json
"jobCode": { "from": "Job" }
```

**Source:** Kaleb's email indicated jobs are central to Stafford's planning model. Visualization will group orders by JobCode. Captured here as a passthrough for downstream UI use; engine doesn't currently consume it.

**Field name note:** the work-order entity uses `Job` as the field name (sales-order entity uses `JobCode`). Since orders are now sourced from the work-order entity, we read `Job`.

### LinkId

No change from v3:
```json
"linkId": {
  "chainKey":     "WorkOrderCode",
  "orderKey":     "Order",
  "lagHoursField": "LagHours"
}
```

Confirms Kaleb's *"Work order > task order should give the requisite chain."*

---

## Engine capability gaps after v3.1

**Down to zero.** The remaining gap from v3 (conditional derive for `actualStart`) was already eliminated by the v3 simplification, and `wipState` collapses to a regular lookup. v3.1 introduces no new engine work.

| v2 listed | v3 listed | v3.1 listed |
|---|---|---|
| 5 gaps | 2 gaps | **0 gaps** |

---

## Escalations resolved (since v3 master list)

| # | Question | Status |
|---:|---|---|
| 1 | RessourceType R / W / S meanings | ✅ R+W = single capacity (treat as MACHINE); S = subcontract |
| 5 | Formula HR/UN vs JR/DY | ✅ HR/UN = hours per unit (internal); JR/DY = calendar days (subcontract) |
| 6 | Late-tolerance concept | ✅ Shipping buffer between JobEndDate (production) and DeliveryDate (customer) |
| 8 | `Wostatus` operational filter | ✅ PRINTED + CREATED active; CLOSED filtered upstream |
| 13 | `WoStatusCode` as wipState source | ✅ Direct lookup: CREATED→NOT_STARTED, PRINTED→IN_PROCESS, CLOSED→COMPLETED |
| Calendar | Calendar endpoint requirement | ✅ Deferred — use `Standard` default |

---

## Still pending (deferred to v3.2)

| Topic | Question |
|---|---|
| **Job model** | Is "job" a separate API entity or a conceptual aggregation of sales-order-line + work-orders sharing JobCode? |
| **Internal-work job-level data** | For work orders without sales-order parents (~half of open WOs), where does job-level data live? On the WO itself or via a synthetic SO? |
| **CTPOrder unit** | Should it represent a job (potentially multi-WO) or remain 1:1 with work order as currently mapped? |
| **Subcontract task duration** | `JR/DY` tasks express calendar days, not machine hours. `TotalPlannedMachineHours = 0` for OUT ops. Engine handling TBD — may need a separate duration field for SUBCONTRACT_DAYS task type. |
| **PRINTED → IN_PROCESS impact** | Observe whether the engine treats IN_PROCESS as immutable; if so, escalate (most active tasks would lock). |
| **Float-vs-fixed duration** | Which OperationCodes (if any) name operations that physically cannot be interrupted mid-run by a shift break or planned maintenance without ruining the part? Typical examples elsewhere: heat-treat, curing, paint-bake, certain CNC autonomous cycles. Default for everything else will be FLOAT (engine is free to slice the duration around downtime). If Stafford names specific codes, we convert the `tasks.durationType` rule from `value: 1` to a `lookup` keyed on `OperationCode` — skeleton drafted below. Note: this is NOT the same question as `Formula` (HR/UN vs HR/OP), which is about *how* duration is computed, not whether the run can be paused. |

These don't block v3.1 application. They drive the next round of mapping/architecture work.

### Derive-rule skeleton — `tasks.durationType` keyed on `OperationCode`

Activates if Stafford answers the float-vs-fixed question above with a list of FIXED operation codes. Until then the mapping ships `{ "value": 1 }` (FLOAT for all tasks).

```jsonc
"durationType": {
  "from": "OperationCode",
  "lookup": {
    "OP_HEATTREAT": 0,   // placeholder — replace with real Stafford codes
    "OP_CURE":      0,
    "OP_BAKE":      0,
    "_default": 1
  }
}
```

Constants: `0 = FIXED_DURATION` (engine treats as uninterruptible block), `1 = FLOAT_DURATION` (engine may slice around downtime). Defined in `packages/engine/CTPTask.ts`.

Why this lives in mapping, not a global tenant flag: `durationType` is a per-task field in the engine model — the engine reads it off each task on every solve. Mapping has to resolve a value for it on every task it produces, so the float-vs-fixed *rule* belongs in `tasks.durationType` alongside `durationSeconds` and `durationQty`. Switching from constant-value to lookup is a config edit only — no adapter, hydrator, or engine work.

Why this is NOT a `from` passthrough: no field in the 2026-04-23 or 2026-06-03 WORK7 captures distinguishes continuous-block operations from interruptible ones. `Formula` (HR/UN vs HR/OP vs JR/DY) describes the duration math, not the interruptibility. If a future Genius pull surfaces such a field, the rule collapses back to a single `from`.

---

## Findings introduced by v3.1 validation

The slim-100 end-to-end test surfaced two issues NOT addressed by v3.1 alone:

1. **Genius returns byte-identical duplicate task records** — 51 collisions in the full WORK7 capture, 9 in the slim. Same `Id`, same all fields. Either a Genius API quirk or a parallel-resource representation. **Stafford question.**
2. **No resource-availability source** — `CalendarMspCode` is captured but no calendar source feeds availability windows. Scheduling can't run end-to-end without this. **Architectural work, not a mapping issue.**

These remain on the open issue list independent of v3.1.

---

## Migration

Apply directly to live `config/tenants/stafford-engineering-test/integration/mapping.json`. No coordinated changes to adapter or engine required for v3.1 — this is mapping config only.

After applying:
1. Reload the API tenant config (`POST /v1/state/reload` with `x-tenant-id`)
2. Re-run the slim-100 scenario test
3. Verify: 101 tasks load, wipState distributes by WO status, jobCode visible on orders, dueDate values shift to JobEndDate
4. Run full test suite (`npx vitest run`) and strict tsc (`npx tsc --noEmit -p packages/api/tsconfig.json`) per CLAUDE.md

---

## v3.1.1 architectural correction — three-window model

Added later in the v3.1 cycle after the slim end-to-end test exposed a conflation: v3 had been putting Genius's planning dates into solver-window slots. Wrong slot. CTPTask has three pairs of date fields with distinct meanings:

| Pair | Meaning | Source for Stafford |
|---|---|---|
| `windowStart` / `windowEnd` | Solver constraint — where placement is *allowed* | NOT in source. Engine defaults to horizon bounds. |
| `scheduledStart` / `scheduledEnd` | Schedule output — where Genius (or our solver) *placed* the task | `TaskStartDate` / `TaskEndDate` from Genius |
| `actualStart` / `actualEnd` | Execution reality — when work *actually* ran | `TaskStartDate` (placeholder for actualStart); `actualEnd` deferred (no completed tasks in current capture) |

### Mapping changes (v3.1.1)

**Removed from mapping:**
```json
// removed — these were silently mapped to TaskStartDate/EndDate (zero-width and wrong slot)
"windowStart": ...,
"windowEnd":   ...
```

**Added to mapping:**
```json
"scheduledStart": { "from": "TaskStartDate", "toUTC": true },
"scheduledEnd":   { "from": "TaskEndDate",   "toUTC": true }
```

`actualStart` retained as the v3-simplified `{ "from": "TaskStartDate", "toUTC": true }` form (deviation from prompt #6 noted; behaviorally identical via engine null-handling — drops engine-derive scope to zero rules).

### Engine layer — default-windows-to-horizon

The prompt asked for an engine-side default: tasks without explicit windowStart/End should default to horizon bounds. **Investigation found this default already exists** in `state-hydrator.service.ts` at lines 332-341:

```typescript
if (ws && we) { window.fromDates(ws, we, 1); }
else { window.set(horizon.startW, horizon.endW, 1); }
```

The hydrator IS the engine-side layer for translating API DTO → engine landscape model. The behavior the prompt requires was already in place. v3.1.1 added an explanatory code comment documenting the layering decision (default lives here, not in mapping config).

### Engine wiring for scheduledStart/End

`CTPTask.scheduled` (CTPInterval slot) already existed but no hydrator path populated it from string source fields. v3.1.1 adds:

1. `ITaskData.scheduledStart`/`scheduledEnd` interface fields (`config-store.interface.ts`)
2. Hydrator block parallel to the window block — parses scheduled string fields into `task.scheduled` CTPInterval
3. Five new tests covering: window from source, window default to horizon, null window same as missing, scheduled populated, scheduled absent stays null

### `actualEnd` — deferred to v3.2

All four Genius candidate fields (`CompletionDate`, `JobClosingDate`, `JobProductionEndDate`, `WorkOrderClosingDate`) are 100% populated on every task, but **0% of tasks in the slim are completed** (we filter `IsCompleted=false` upstream). Without completion data we can't tell which field semantically represents *actual* end vs a planning-side date. Documented as v3.2 deferred question.

### Validation — slim-100 post-v3.1.1

| Check | Result |
|---|---|
| Sync clean (0 mapping errors) | ✓ |
| `windowStart` populated on all 101 tasks (= horizon default 2026-02-07) | ✓ |
| `scheduledStart` populated on 98/101 tasks (from `TaskStartDate`) | ✓ |
| `commitmentLevel`: 76 running / 25 unscheduled (per Kaleb full lookup) | ✓ |
| Full test suite green (1038 tests, +5 from v3.1.1) | ✓ |
| Strict tsc clean | ✓ |

### v3.2 deferred questions added

- `actualEnd` field — which Genius field captures execution end? Investigation needs completed-task data.
- IN_PROCESS solver behavior — 76% of landscape now classified IN_PROCESS via PRINTED→IN_PROCESS. Solver locks them at `actualStart` (= TaskStartDate). Should this be gated on `TaskStartDate` populated AND not in the future? Engine derive question.

---

## v3.1.2 — resource hierarchy + Id-based FK

Two related changes that together let the slim render with proper resource grouping AND a stable foreign-key.

### 1. Resource hierarchy mapping

The UI groups resources by `workCenter` → `line` → resource. That projection comes from `CTPResource.hierarchy.first` / `.second` in the engine model (= `hierarchy.level1` / `level2` on the source side).

Mapping addition (resources block):
```json
"hierarchy": {
  "level1": { "from": "DepartmentCode" },
  "level2": { "from": "OperationsCode" }
}
```

**Engine work to enable nested rules.** The mapping engine previously only handled flat rules. v3.1.2 extends `applyMappings` to recurse on nested rule objects via a new `isNestedRule` predicate. Generic — any tenant can use nested mappings.

**DTO fix (ctp.service.ts:3402).** The DTO was reading `workCenter`/`line` only from `resourceConfigMap` (file-based). Now prefers `resource.hierarchy.first`/`.second` (engine-state, set by hydrator from adapter mapping), falls back to file config.

**Result on slim:** 77 resources now render in 8 department buckets (FAB 22, MAC 23, ENG 11, OTH 7, FIT 5, PRE 5, QMS 3, NA 1) instead of one flat "Other" group.

### 2. Resource FK switched from Code to Id

Previously:
```json
"resources": { "key": { "from": "Code" } }
"tasks":     { "capacityResources": { "from": "MachineCode" } }
```

Now:
```json
"resources": { "key": { "from": "Id", "toString": true } }
"tasks":     { "capacityResources": { "from": "MachineId" } }
```

**Why:** Genius's `Code` is the operator-facing label and could in principle be renamed. `Id` is the internal stable primary key. Foreign-key joins should bind to the stable identifier; readability comes from `Description1` which still shows in the UI.

**Engine work to enable.** Two mapping-engine additions:

- New `toString: true` rule flag — coerces a numeric source value to a string. General-purpose; any tenant can use it for similar conversions.
- `mapTasks` now auto-stringifies `capacityResources[i].resource` regardless of source type. The CTP engine uses string keys for resource lookups; numeric values would silently break joins.

**The `isNestedRule` gotcha (worth noting).** Initial implementation used `rule.toString === undefined` to detect nested rules — but every JavaScript object inherits `toString` from `Object.prototype`, so the check always failed and broke nested rule detection. Fixed by using `Object.prototype.hasOwnProperty.call(rule, k)` against an explicit list of rule keys.

**Calendar regenerated.** `data/calendars.json` (and `scripts/generate-stafford-calendar.py`) now use `Id` (stringified) as the resource key, matching the new mapping.

### Validation — post-v3.1.2

| Check | Result |
|---|---|
| Resources keyed by Id (stringified) — `'2'`, `'37'`, `'69'` | ✓ |
| Names still display via `Description1` — `'ASSEMBLY & FITTING'`, `'ELIJAH'` | ✓ |
| Tasks reference resources by Id-string — `27187-PLL-5.compatibleResources[0].resourceKey = '69'` | ✓ |
| Hierarchy buckets render — 8 departments, 24 line codes | ✓ |
| Calendar matches new keys (totalAvailable populated) | ✓ |
| Full test suite green (1041 tests; +3 from v3.1.2 for nested-mapping + toString) | ✓ |
| Strict tsc clean | ✓ |

### Why this matters operationally

For Stafford to use CTP long-term: **renaming a resource Code in Genius should not break CTP's history.** Joining on `Id` decouples internal scheduling-history from user-facing label changes. Same reasoning applies to any future Genius FK we surface (JobId, OperationId, etc.) — start with Id, accept the readability hit, surface human labels via name fields.

