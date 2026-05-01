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

These don't block v3.1 application. They drive the next round of mapping/architecture work.

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
