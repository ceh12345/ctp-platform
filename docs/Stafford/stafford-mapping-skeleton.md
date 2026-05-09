# Stafford WORK7 → CTP Data Mapping

**Working document for review — bring questions, scribble on it.**

---

## How data flows

```
┌──────────────────────┐         ┌──────────────────────┐
│   GENIUS (source)    │         │      CTP (us)        │
│                      │         │                      │
│  Sales Order Lines   │         │                      │
│  ─ JobCode           │ ──┐     │                      │
│  ─ JobPlanningStrat  │   │     │                      │
│  ─ DateDelivery      │   │     │                      │
│  ─ DateJobProdEnd    │   │     │                      │
│                      │   │     │                      │
│  Work Orders         │   ├──→  │   CTPOrder           │
│  ─ Job (=JobCode)    │   │     │   (1:1 with Work     │
│  ─ Strategy          │   │     │    Order today;      │
│  ─ JobEndDate        │   │     │    job-driven TBD)   │
│  ─ DeliveryDate      │ ──┘     │                      │
│  ─ Wostatus          │         │                      │
│                      │         │                      │
│  Production Tasks    │ ──────→ │   CTPTask            │
│  ─ TaskStartDate     │         │   ─ scheduled        │
│  ─ TotalPlanned...   │         │   ─ duration         │
│  ─ MachineCode       │         │   ─ resource ref     │
│  ─ Order             │         │                      │
│                      │         │                      │
│  Machines/Resources  │ ──────→ │   CTPResource        │
│  ─ Code              │         │   ─ key              │
│  ─ RessourceType     │         │   ─ type             │
│  ─ MachineRateCost   │         │   ─ rate             │
└──────────────────────┘         └──────────────────────┘
```

---

## Resources

77 records total. Three RessourceType values: R (44, named operators), W (31, work centres), S (2, placeholders).

| CTP field | Genius source | Sample (from slim) | ? |
|-----------|---------------|--------------------|---|
| key | `Id` (stringified) | `'2'` (ASSEMBLY & FITTING, W), `'37'` (D-02, R), `'69'` (ELIJAH, R) | switched from `Code` to `Id` — Id is stable, Code can be renamed in Genius |
| name | `Description1` | `'ASSEMBLY & FITTING'` (W), `'HAYDEN'` (R) | R rows are people's names — confirm? |
| type | `RessourceType` (R/W → MACHINE, S → SUBCONTRACT) | R: D-02→MACHINE, W: A→MACHINE, S: NA→SUBCONTRACT | per email: R+W = single capacity. Still right? |
| class | same lookup | identical to type | type and class collapsed; OK? |
| hourlyRate | `MachineRateCost` | W ASSEMBLY: `84.0` · R KATHRYN: `105.0` · S NA: `0.0` | NZD/hr — confirm |
| efficiency | `Efficiency` | W: `75.0` · R: `90.0` · S: `100.0` | what does the number mean? duration multiplier? scoring only? |
| parallelCapacity | `NumOfAvgResource` | W ASSEMBLY: `4.0` · R HAYDEN: `0.0` · S NA: `1.0` | **0 on R** — does that mean "single instance" or "unused"? |
| isFinite | `IsFinite` | W ASSEMBLY: `false` · R HAYDEN: `true` · S NA: `false` | a W with `IsFinite=false` AND `ParallelN=4` — capacity model? |
| calendarCode | `CalendarMspCode` | `'Standard'` (76 of 77) | calendar fetch deferred — confirm Standard default is OK |
| **hierarchy.level1** | `DepartmentCode` | `'FAB'`, `'MAC'`, `'ENG'`, `'OTH'`, `'FIT'`, `'PRE'`, `'QMS'`, `'NA'` (8 buckets) | UI groups resources by this — top-level shop departments |
| **hierarchy.level2** | `OperationsCode` | `'F'`, `'D'`, `'P'`, `'A'`, `'M'`, … (24 distinct) | second-level under department |

---

## Orders (currently sourced from Work Orders)

12 in slim. Sample row = WO `27187` (CHDV 3500 Body Assembly, 22 tasks — biggest chain).

| CTP field | Genius source | Sample (from slim) | ? |
|-----------|---------------|--------------------|---|
| key | `WorkOrder` | `'27187'` | should this be `Job` instead? (some Jobs span multiple WOs) |
| name | `WorkOrder + ItemDescription1` | `'27187 — CHDV 3500 BODY ASSEMBLY'` | OK as display? |
| productKey | `ItemCode` | `'CHDV 3500 BODY ASSY'` | |
| demandQty | `QuantityPlanned` | `2.0` | |
| dueDate | `JobEndDate` | `'2026-04-28'` | production deadline (when work needs to be done) |
| lateDueDate | `DeliveryDate` | `'2026-04-29'` | customer commitment — buffer = 1 day |
| priority | `Strategy` lookup (JIT=10, ASAP=5) | `'JIT'` → `10` | **99.4% of WOs are JIT** — is there another priority signal? |
| jobCode | `Job` | `'17843'` | passthrough; UI may group on this |
| customerCode | `CustomerCode` | `'CEM'` | |
| customerName | `CustomerName` | `'CEM INTERNATIONAL P/L (NZ A/C)'` | |
| itemFamily | `ItemFamily` | `'S-ENG'` (production) vs `'NA'` (admin/breaktime) | use as filter? exclude `NA`? |
| wostatus | `Wostatus` | `'PRINTED'` | filter set: PRINTED + CREATED only? exclude PLANNED? |

---

## Tasks

101 tasks in slim (110 records dedupe to 101 — 9 byte-identical Genius dupes). Sample = `27187-F-1` (Finishing op, first in routing).

| CTP field | Genius source | Sample (from slim) | ? |
|-----------|---------------|--------------------|---|
| key | `WorkOrderCode + OperationCode + Order` | `'27187-F-1'` | unique with `Order` — old key without it collapsed 50% of tasks |
| name | `JobCode + OperationCode` | `'17843 — F'` | OK as display? |
| type | `Formula` (HR/UN → STANDARD, JR/DY → SUBCONTRACT_DAYS) | HR/UN: `'STANDARD'` (89), JR/DY: `'SUBCONTRACT_DAYS'` (12) | confirm JR/DY = subcontract calendar days |
| durationSeconds | `TotalPlannedMachineHours × 3600` | 8h task = `28800` | 14% of slim tasks have `Total=0` — mostly OUT (subcontract) ops |
| wipState | `WoStatusCode` lookup | `'PRINTED'` → `IN_PROCESS` (76 of 101) | **76% of landscape locks as IN_PROCESS** — is that right? gate on TaskStartDate populated? |
| scheduledStart | `TaskStartDate` | `'2026-03-26T09:34:58.800+13:00'` | Genius's planning — confirm |
| scheduledEnd | `TaskEndDate` | `'2026-03-26T11:09:43.200+13:00'` | Genius's planning — confirm |
| actualStart | `TaskStartDate` (placeholder) | same as scheduledStart for now | real actuals path TBD |
| actualEnd | _(unmapped)_ | candidates: `CompletionDate`, `JobClosingDate`, `WorkOrderClosingDate` | all are 100% populated but 0% completed in slim → **which is the real one?** |
| capacityResources | `MachineId` (stringified) | `'33'` → resource ADRIAN (Code FA-02) | switched from `MachineCode` to `MachineId` to match resource key choice |
| chain | `WorkOrderCode + Order` (linkId) | chain = `'27187'`, position 1, lag = `LagHours` | confirm `Order` is right (vs sentinel-laden `SequenceNumber`) |
| windowStart | _(engine default: horizon start)_ | `'2026-02-07T00:00:00Z'` | not in source — engine handles |
| windowEnd | _(engine default: horizon end)_ | `'2026-07-02T00:00:00Z'` | not in source — engine handles |

---

## What we know we don't know

**Architectural:**
- Is "Job" a separate Genius API entity or a conceptual aggregation of sales order line + matching work orders?
- For ~half of work orders that have no sales order parent (stock builds, internal work), where does job-level data live?
- Should CTPOrder represent a Job (potentially multiple work orders) or stay 1:1 with Work Order?
- **Scheduling source: Genius's plan, our solver, or both?** Concrete exhibit: `27187-PLL-5` has Genius's `TaskStartDate=2026-03-26T13:24` on `P-05` (ELIJAH) — Genius scheduled it. CTP loads that into `task.scheduled` but treats the task as `state=NOT_SCHEDULED, commitmentLevel='unscheduled', assignedResources=[]` — our solver disagreed (resource conflict) and produced no placement. UI shows the requirement only as a "preference," not as a committed assignment. Three options: **(A)** treat Genius's plan as the truth and visualize it as-is (hydrator translates scheduledStart + MachineCode → committed assignment); **(B)** treat Genius's data as a hint, let CTP re-solve from scratch (current behavior); **(C)** support both with a `scheduleSource: 'erp' | 'solver'` flag so the UI can distinguish "Genius's plan" from "CTP's optimization." Drives whether the demo shows their existing schedule, our optimization, or both side-by-side.

**Field-level:**
- Which Genius field captures execution end (`actualEnd`)? `CompletionDate` / `JobClosingDate` / `WorkOrderClosingDate` are all populated but 0 completed tasks in slim makes semantics indeterminate.
- What does `Efficiency` value (75/90/100) mean for capacity calculation?
- What does `IsFinite=false` mean — infinite capacity, no scheduling, or something else?
- How do parallel-capacity resources (`NumOfAvgResource > 1`) behave operationally?
- `JobType` = U / C / I / Q — what do these mean? (`U` appears on admin/breaktime WOs)
- `CompletionPercentage = 100.0` on tasks where `IsCompleted = false` — which is authoritative?
- Sentinel `1900-01-01` dates — confirm Genius's "no value" placeholder

**Filtering questions:**
- How to exclude admin/overhead WOs from production scheduling? **Proposed filter (validated against full WORK7): `Job < 'SYST%'`** — passes 866 of 956 WOs (90.6%) and 3,060 of 3,118 tasks (98.1%); cleanly excludes all `ZCUS` (37), `ZWOR 24-25` / `ZWOR` (18), `ZTRA 24-25` (10), `ZSER 24-25` (7), `ZCON` (12), `SYST-01/02` (2), `Z-REPAIRS` / `Z-TRAINING` / `Z-VBREAK` / `Z-CLEANING` (4). Confirm this is correct, and decide where to apply: adapter-side (when filter support lands), mapping-side, or Stafford-side (Genius's own filter — cleanest). Alt candidates if Stafford's preferred axis differs: `ItemFamily = 'NA'`, `JobType = 'U'`, `ItemCode LIKE 'Z-%'`.
- Active `Wostatus` set: PRINTED + CREATED? Is PLANNED ready or premature?

**UX / workflow:**
- **Work order detail drill-in** — currently the Orders tab shows summary rows but no dedicated "view this WO's detail" action. Workaround: Tasks tab → click order ref → filter Schedule. What's the natural workflow Stafford expects? Tabular task list under each WO? Open the chain on the Gantt? Pop up the first task and navigate from there? (Quick-build option: order row click → opens first task's detail panel — ~30-60 min if that's the right UX.)

**Deferred (not for this meeting):**
- Calendar / availability data — Kaleb said ignore for now
- Subcontract task duration semantics (JR/DY = calendar days)
- Engine derive feature (only `actualStart` still needs it)

---

## Things to point at

Open these in the UI / JSON when each topic comes up.

**Resources — exhibits for the R/W/S conversation:**
- `'A'` — type W, "ASSEMBLY & FITTING", `IsFinite=false`, `ParallelN=4`, `Efficiency=75`. The "work centre with N workers" archetype.
- `'A-01'` — type R, "HAYDEN", `IsFinite=true`, `ParallelN=0`, `Efficiency=90`. The "named operator slot" archetype.
- `'NA'` — type S, "NOT APPLICABLE", `Rate=0`. The placeholder.
- `'D-03'` — type R, "KATHRYN" — another named-operator example, different rate (105.0).

**Work orders — exhibits:**
- `27187` — clean prod WO, 22 tasks, customer CEM. Use as "happy path" reference.
- `27164` — 15 tasks, Superior Ice Cream Equipment (we have repeat customer in slim).
- `25622` — **the duplicate-records WO**: 5 byte-identical task pairs (same `Id`, all fields). API quirk or parallel-resource encoding?
- `20540` — **admin/breaktime WO**: customer = STAFFORD ENGINEERING (themselves), Item = `Z-WSHOP BREAK`, ItemFamily = `NA`, JobType = `U`. Should this even be in CTP?
- `99500` — another admin: "VERIFIED BREAKTIMES APPLIED TO TIME". Same pattern as 20540.

**Tasks — exhibits:**
- `27187-F-1` — the one task our solver could "plan" freely (CREATED status, not locked).
- `27187-PLL-5` — **multi-shift duration exhibit**: 16h `TotalPlannedMachineHours` on operator `P-05` (ELIJAH), but `HourCapacityPerDay=8`. Engine reports infeasible because a 16h task can't fit in a single 8h shift block. **How does Stafford handle multi-shift work?** Pause/resume same operator across shifts? Different operator picks up next day? Current mapping hydrates every task as `durationType=FIXED_DURATION (0)` — the alternative is `FLOAT_DURATION (1)` which lets a task span calendar boundaries. Stafford's answer determines: switch all to FLOAT (uniform), conditional FLOAT (when duration > shift length, needs engine derive), or FLOAT-by-Formula (e.g., HR/UN=FIXED, JR/DY=FLOAT) via mapping lookup.
- `20540-L-6` — zero duration (every planned-hour field = 0), `CompletionPercentage=100` while `IsCompleted=false`, sentinel `1900-01-01` close dates. Concrete instance of the admin-WO problem.
- A `OUT` task (e.g. `27187-OUT-6`) — subcontract op with `Formula=JR/DY`, `TotalPlannedMachineHours=0`. Where should its duration come from?
- A task with `TaskStartDate == TaskEndDate` (zero-width, ~27 in slim) — confirms these are event timestamps not planning windows.

**Cross-field oddities:**
- `Strategy` distribution: 99.4% JIT, 6 ASAP — but all 6 ASAP are CANCELLED. **No working priority signal in active data.** What drives priority in production?
- `WoStatusCode` distribution: 92% PRINTED, ~8% CREATED, 1 PLANNED. With our PRINTED→IN_PROCESS mapping, that's 76% of landscape "running" — feels wrong.

**For the live UI walkthrough:**
- Right-click `27187-F-1` on the Gantt → see the chain context.
- Open `20540-L-6` task detail → "what would you do with this?"
- Filter to ItemFamily = `NA` → see how much is admin overhead.

---

## Decisions and notes from meeting

### Confirmed (from Kaleb)

- **Job = Work Orders** — keep CTPOrder 1:1 with Work Order; Job is just the WO grouping. (No separate Job entity.)
- **Earliest task drives priority** — order priority derives from the earliest task's start. (Not from `Strategy`.)
- **`TotalCumulativeMachineHours > 0` = running** — replaces `WoStatusCode=PRINTED` as the IN_PROCESS classifier. Real running rate ~9% (vs 92% under PRINTED).
- **`pinned` = `IsSchedulingLocked`** — boolean; when true, the task is locked at its planned position.
- **For pinned tasks** — use `TaskStartDate` / `TaskEndDate` as the authoritative scheduledStart/End (the locked schedule).
- **`CompletionPercentage >= 100`** = COMPLETED. (`IsCompleted` is **not reliable** — was the obvious choice but Kaleb confirmed `CompletionPercentage` is authoritative. Resolves the contradiction we'd flagged where `CompletionPercentage=100` and `IsCompleted=false` co-occurred.)
- **Cascade rule**: if a task is COMPLETED, **all its predecessor tasks in the chain are also assumed COMPLETED**. Engine should propagate the state backward through the linkId chain.
- **No `dispatched`** at this point — Stafford doesn't use the dispatched concept. Don't map.
- **Admin/overhead filter: `Job < 'SYST%'`** (validated 866 of 956 WOs / 3,060 of 3,118 tasks).
- **`JobType` enum**: `U` = maintenance, `C` = customer, `I` = inventory, `Q` = quality (rework).
- **Two-level scheduling model** — Stafford runs two layers:
  - **Detail** = R-type resources (`IsFinite=true`, `ParallelN=0`) — named operators/machines, individual time-precise calendars
  - **Aggregate / mid-range** = W-type resources (`IsFinite=false`, `ParallelN=4`) — work centres, capacity expressed via parallelN against a coarser work-centre calendar
  - Out-of-box CTP modeling: **two resource profiles** (detail + aggregate). Tasks attach to the appropriate profile based on the task's nature; both task types still request `qty=1`. Aggregate behavior comes from the W resource itself having `parallelN > 1`, allowing N simultaneous tasks.
- **Commit CTP dates back to Genius as locked** — write-back path is the future direction (CTP → Genius bi-directional). **Not for now** — flagged future-state only, not blocking current demo / mapping work.

### Applied (v3.2)

- [x] **`pinned` ← `IsSchedulingLocked`** — added to tasks.mappings. Boolean passes through; hydrator reads `item.pinned` and sets `task.pinned`.
- [x] **scheduledStart/End now gated on pinned=true** — hydrator only honors source-supplied scheduled values when the task is locked. Non-pinned: solver owns placement. New regression test added.
- [x] **`IN_PROCESS` classifier rewritten** — `wipState` is now a `cascade` of two threshold rules: `CompletionPercentage >= 99.99 → COMPLETED`, then `TotalCumulativeMachineHours > 0 → IN_PROCESS`, else `NOT_STARTED`. Replaces `WoStatusCode=PRINTED→IN_PROCESS` over-classifier.
- [x] **`COMPLETED` from `CompletionPercentage >= 99.99`** — same cascade; threshold of 99.99 (not exactly 100) handles floating-point quirks.
- [x] **Cascade COMPLETED backward through chain** — added in `state-hydrator.service.ts:hydrateTasks` post-build pass. Walks `linkId.prevLink` for each COMPLETED task and propagates state backward. Iterates until convergence (handles multi-hop chains).
- [x] **Mapping engine: new `threshold` rule type** — `{from, threshold, above, below}` with optional sides. Returns `above` if value > threshold, else `below`. Non-numeric / null → "below". Generic, any tenant.
- [x] **Mapping engine: new `cascade` rule type** — `{cascade: [sub-rules], default: x}` tries each sub-rule, returns first non-null, else default. Generic.
- [x] **R/W split** — `R→MACHINE` (detail), `W→WORK_CENTER` (aggregate), `S→SUBCONTRACT`. Reverted v3.1.1 collapse.
- [x] **`jobType` ← `JobType`** — passthrough on orders. UI/downstream can read U / C / I / Q. (Engine may not yet consume it; field is captured at mapping layer.)
- [x] **No `dispatched`** — already absent from mapping. Confirmed during implementation review.

### TODO — still pending

- [ ] **Apply `Job < 'SYST%'` filter** — adapter-side (when filter support lands) or Stafford-side (Genius API filter). Mapping config alone can't filter; needs adapter or upstream support.
- [ ] **Define aggregate-task time window** — engine-default `windowStart=horizon.start` is wrong for W-type aggregate tasks. Open design question: bucketing scheme (per-week / per-month / derived from JobEndDate). Needs a hydrator branch on resource type or a new mapping path.
- [ ] **Define FIXED vs FLOAT durationType per task** — current mapping hydrates every task as FIXED. Aggregate (W) tasks may always be FLOAT; detail tasks > shift length may need conditional FLOAT. Concrete exhibit: `27187-PLL-5` = 16h on 8h shift → infeasible under FIXED.
- [ ] **Slim slicer Phase 0.5 — bias toward at least one locked WO** — current slim has 0 pinned tasks because only 11 of 2,568 (0.4%) are locked. Demo loses the pinned-handling demonstration. Easy fix: add a phase to the slicer that picks 1-2 locked WOs if any exist.

### Open / pending discussion

- ~~**Finite Capacity** — vs Infinite vs "detail" (a third tier?). What's the operational difference?~~ **Resolved** — `IsFinite=true` is the **detail** layer (R-type, named operators), `IsFinite=false` is the **aggregate** layer (W-type, work centres with parallelN cap). See "Two-level scheduling model" above.
- **Cum Time > 0 AND task ___** — incomplete note; what's the second condition?
- **Created vs Printed** — operational distinction in the WO lifecycle; how should each map (now that PRINTED ≠ IN_PROCESS via cum-hours classifier)? 


