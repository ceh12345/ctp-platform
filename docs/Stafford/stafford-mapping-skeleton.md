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
| key | `Code` | `'A'` (W), `'D-02'` (R), `'NA'` (S) | confirm Code is the join key — tasks reference via `MachineCode` |
| name | `Description1` | `'ASSEMBLY & FITTING'` (W), `'HAYDEN'` (R) | R rows are people's names — confirm? |
| type | `RessourceType` (R/W → MACHINE, S → SUBCONTRACT) | R: `'D-02'`→MACHINE, W: `'A'`→MACHINE, S: `'NA'`→SUBCONTRACT | per email: R+W = single capacity. Still right? |
| class | same lookup | identical to type | type and class collapsed; OK? |
| hourlyRate | `MachineRateCost` | W `'A'`: `84.0` · R `'D-03'` (KATHRYN): `105.0` · S `'NA'`: `0.0` | NZD/hr — confirm |
| efficiency | `Efficiency` | W: `75.0` · R: `90.0` · S: `100.0` | what does the number mean? duration multiplier? scoring only? |
| parallelCapacity | `NumOfAvgResource` | W ASSEMBLY: `4.0` · R HAYDEN: `0.0` · S NA: `1.0` | **0 on R** — does that mean "single instance" or "unused"? |
| isFinite | `IsFinite` | W ASSEMBLY: `false` · R HAYDEN: `true` · S NA: `false` | a W with `IsFinite=false` AND `ParallelN=4` — capacity model? |
| calendarCode | `CalendarMspCode` | `'Standard'` (76 of 77) | calendar fetch deferred — confirm Standard default is OK |

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
| capacityResources | `MachineCode` | `'FA-02'` (resource Code = ADRIAN) | |
| chain | `WorkOrderCode + Order` (linkId) | chain = `'27187'`, position 1, lag = `LagHours` | confirm `Order` is right (vs sentinel-laden `SequenceNumber`) |
| windowStart | _(engine default: horizon start)_ | `'2026-02-07T00:00:00Z'` | not in source — engine handles |
| windowEnd | _(engine default: horizon end)_ | `'2026-07-02T00:00:00Z'` | not in source — engine handles |

---

## What we know we don't know

**Architectural:**
- Is "Job" a separate Genius API entity or a conceptual aggregation of sales order line + matching work orders?
- For ~half of work orders that have no sales order parent (stock builds, internal work), where does job-level data live?
- Should CTPOrder represent a Job (potentially multiple work orders) or stay 1:1 with Work Order?

**Field-level:**
- Which Genius field captures execution end (`actualEnd`)? `CompletionDate` / `JobClosingDate` / `WorkOrderClosingDate` are all populated but 0 completed tasks in slim makes semantics indeterminate.
- What does `Efficiency` value (75/90/100) mean for capacity calculation?
- What does `IsFinite=false` mean — infinite capacity, no scheduling, or something else?
- How do parallel-capacity resources (`NumOfAvgResource > 1`) behave operationally?
- `JobType` = U / C / I / Q — what do these mean? (`U` appears on admin/breaktime WOs)
- `CompletionPercentage = 100.0` on tasks where `IsCompleted = false` — which is authoritative?
- Sentinel `1900-01-01` dates — confirm Genius's "no value" placeholder

**Filtering questions:**
- How to exclude admin/overhead WOs from production scheduling? Candidates: `ItemFamily = 'NA'`, `JobType = 'U'`, `ItemCode LIKE 'Z-%'`, `JobCode LIKE 'ZWOR%'`.
- Active `Wostatus` set: PRINTED + CREATED? Is PLANNED ready or premature?

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

_(blank section — fill in during/after the meeting)_

