# Questions for Stafford — slim-100 (2026-06-07 capture)

Running list of questions raised while reviewing the new slim-100 dataset (10 multi-order Jobs sliced from the 2026-06-03 WORK7 capture). Each question carries enough context for Stafford to answer offline, plus a current working assumption + impact if we got it wrong.

Last updated: 2026-06-07.

---

## Q1 — `LagHours` field on `productionTaskWithAdvancedInfoViewEntity`

**The question:** What does `LagHours` represent in your scheduling? Is it a deliberate per-operation constraint, a fixed-everywhere default, or planning-side metadata that the engine should ignore?

**Why we're asking:**

In the 2026-06-03 capture, `LagHours` is 100% populated across all 2,563 tasks, but the distribution is heavily skewed:

| LagHours | Tasks | % |
|---|---|---|
| **4** | 2,404 | **94%** |
| 8 | 108 | 4.2% |
| 24 | 29 | 1.1% |
| 0 | 22 | 0.9% |

94% sharing the same value (`4`) reads like an unchanged default, not a per-operation scheduling rule. Mapping the value through to `maxGap` in the engine (we currently compute `maxGap = LagHours × 3600 seconds`) creates a hard chain constraint — "successor task must start within N hours after predecessor ends."

**Where this bites:** **401 of 1,844 chain links (22%) violate the maxGap constraint as currently scheduled in the source data.** Predecessor ends in the evening, successor starts the next morning, gap exceeds 4 hours. Genius's own scheduling lets this happen, but CTP refuses to solve it because the constraint is too tight.

**Concrete example from slim-100:**

```
27851-A-1   end:   2026-04-26 23:45   (HAYDEN, 40-hour assembly running through evening)
27851-QC-2  start: 2026-04-27 07:45   (MURRAY, day-shift QC the next morning)
            actual gap = 8 hours
            maxGap     = 4 hours      ← violation
```

QC follows day-shift hours; predecessor finishes after-hours; engine refuses to re-place QC because the 4-hour gap window (23:45→03:45) is entirely outside MURRAY's working calendar.

**Current working assumption:** `LagHours = 4` is a default Stafford never explicitly tuned. We're temporarily ignoring the field entirely (`maxGap: null` for all chain links) so the engine can actually solve. Real 8-hour and 24-hour cases are also being ignored as a side-effect.

**Impact if assumption is wrong:**
- If Stafford intends `LagHours` to be enforced: we're letting chains run too loose; the schedule will look optimistic
- If Stafford never enforces it themselves: we match Genius's behavior; safe to ignore

**Options once Stafford responds:**

- **Stafford confirms "default, ignore"** → drop `lagHoursField` from the mapping permanently
- **Stafford confirms "only enforce non-default values"** → map only `LagHours ≠ 4` (preserve the intentional 8/24-hour cases); requires engine support for "ignore these values" rule
- **Stafford confirms "enforce strictly per operation"** → restore current mapping; investigate why 22% of chain links violate Stafford's own rule

**Decision deadline:** Before any solver-correctness work for Stafford. Until resolved, slim-100 scheduling results carry an asterisk.

---

## Q2 — `IN_PROCESS` tasks block downstream scheduling

**The question:** When a task is `IN_PROCESS` (partial work logged, not yet completed) but its `scheduledEnd` is in the future, how do you expect downstream tasks in the chain to be scheduled? Should CTP trust `scheduledEnd` as the predicted completion, forward-roll based on remaining hours, or wait until the operator closes out the task?

**Why we're asking:**

Stafford's data has tasks marked `IN_PROCESS` with partial-progress signals (e.g., `CompletionPercentage > 0`, `TotalCumulativeMachineHours > 0`) but no `CompletionDate` set (it's the `1900-01-01` sentinel). Mapping correctly classifies these as `wipState: IN_PROCESS`. The CTP engine treats them as "still running" and refuses to schedule downstream tasks until the predecessor closes — even when `scheduledEnd` is well-defined and in the future.

**Where this bites — concrete example from slim-100:**

```
27851-A-1 (predecessor):
  wipState:                    IN_PROCESS
  scheduledEnd:                2026-04-26 23:45 UTC   (in the future per horizon NOW = 2026-04-25)
  CompletionPercentage:        14.76%
  TotalCumulativeMachineHours: 5.904 of 40 planned
  CompletionDate:              1900-01-01 (sentinel — not closed)
  actualEnd (mapped):          null   (no mapping rule for actualEnd today)

27851-QC-2 (successor):
  wipState:                    NOT_STARTED
  scheduledStart:              2026-04-27 07:45 UTC   (8 hours after predecessor's scheduledEnd)
  feasible:                    false  ← engine refuses to schedule
  errors:                      []  (no specific error surfaced)
```

The chain ordering is fine in source data (successor starts after predecessor's `scheduledEnd`). But the engine sees:
- Predecessor still in progress, no `actualEnd` to anchor on
- Only 5.9 of 40 hours done — 34 hours of remaining work would need to be re-placed
- Engine can't fully place the 34-hour tail in the predecessor's calendar within the slim window → predecessor stays partial → successor never gets a feasible anchor

**Scale across the dataset:**

| Tenant | IN_PROCESS tasks | IN_PROCESS with successors | Successors potentially blocked |
|---|---|---|---|
| stafford-engineering-test | 170 | 163 | **183** |
| stafford-slim-100 | 13 | 12 | **12** |

In slim-100, the 12 blocked successors are about 11% of the 112-task fixture. In engineering-test, 183 blocked is ~7% of 2,511.

**Current working assumption:** This is operator workflow — tasks stay `IN_PROCESS` past their scheduled end because nobody closed them out in Genius. The CTP engine treats this strictly. We're not yet doing anything about it.

**Options once Stafford responds:**

- **Stafford confirms "operators close tasks promptly"** → encourage closeout discipline; map `CompletionDate` to `actualEnd` (with sentinel handling); engine behavior stays strict
- **Stafford confirms "tasks legitimately stay IN_PROCESS, scheduledEnd is the forecast"** → defensive mapping: when `wipState = IN_PROCESS` and `actualEnd` is null, use `scheduledEnd` as effective end for chain purposes; possibly add a mapping rule like `cascade: [{from: CompletionDate, lookup: {1900-01-01...: null}}, {from: TaskEndDate, toUTC: true}]`
- **Stafford confirms "forward-roll remaining hours from NOW"** → engine work: when `IN_PROCESS` and `scheduledEnd < NOW`, recompute effective end from `NOW + TotalRemainingMachineHours`; doesn't apply today (all `scheduledEnd` are in the future) but ready for future captures

**Decision deadline:** Same urgency as Q1 — until resolved, ~7-11% of tasks have no chance of scheduling regardless of LagHours.

---

## Q3 — Subcontract / OUTWORK tasks have `durationSeconds = 0`

**The question:** How should we model subcontract / OUTWORK tasks (Formula = `JR/DY`)? They have `TotalPlannedMachineHours = 0` because they're measured in calendar days, but the engine needs a duration to chain through them.

**Why we're asking:**

The mapping uses `TotalPlannedMachineHours × 3600` to compute `durationSeconds`. For Genius's `JR/DY` (Journey/Day) tasks — typically OUTWORK / subcontract operations — `TotalPlannedMachineHours = 0` because the work is measured in days at the vendor, not machine hours at Stafford. Result: every OUTWORK task has `durationSeconds: 0` in CTP.

When such a 0-duration task is a predecessor in a chain, the engine can't establish where it "ends," so downstream tasks can't anchor to it. The chain breaks.

This was already noted in `docs/Stafford/mapping-change-log-v3.1.md` as a v3.2 deferred question (*"Subcontract task duration | `JR/DY` tasks express calendar days, not machine hours. `TotalPlannedMachineHours = 0` for OUT ops. Engine handling TBD — may need a separate duration field for SUBCONTRACT_DAYS task type."*). This question reframes the same finding with concrete impact data and an example.

**Where this bites — concrete example from slim-100:**

```
28482-OUT-1 (predecessor — subcontract):
  type:                       SUBCONTRACT_DAYS (mapped from Formula = JR/DY)
  durationSeconds:            0                ← TotalPlannedMachineHours × 3600 = 0
  Genius TaskStartDate:       2026-05-06
  Genius TaskEndDate:         2026-05-10       ← 4 calendar days of subcontract
  capRes:                     OUTWORK (resource 25)

28482-QH-2 (successor — QC the QH-finished work):
  wipState:                   NOT_STARTED
  scheduledStart:             2026-05-09 20:00 UTC   (8 hours after predecessor's scheduledEnd)
  feasible:                   false  ← engine refuses
```

Subcontract was supposed to span 4 days at the vendor; the engine sees it as instant (0 seconds), so the chain has no anchor. Successor QH-2 stays unscheduled.

**Compound case — Q2 + Q3 cascade:**

`27978-OUT-4` hits both problems at once and propagates downstream:

```
27978-NM-3 → 27978-OUT-4 → 27978-LP-5
   (Q2)         (Q3)         (collateral damage)
   IN_PROCESS   duration=0
   no actualEnd OUTWORK
```

Predecessor is IN_PROCESS with no `actualEnd` (Q2). The OUT task itself is 0-duration (Q3). The downstream LP task can't anchor either. One operational workflow disables three CTP scheduling decisions.

**Scale across the dataset:**

| Tenant | Tasks with `durationSeconds = 0` | ...assigned to OUTWORK | ...with successors | Successors potentially blocked |
|---|---|---|---|---|
| stafford-engineering-test | 147 | 126 | 105 | **139** |
| stafford-slim-100 | 7 | 7 | 7 | **7** |

In slim-100, all 7 zero-duration tasks are OUTWORK. Combined Q2 + Q3 blocked successors: **19 of 112 tasks in slim (17%), 322 of 2,511 in engineering-test (13%).**

**Current working assumption:** OUTWORK tasks legitimately span calendar days, not machine hours. The mapping needs a different source field for this task type.

**Options once Stafford responds:**

- **Stafford confirms "use TaskEndDate − TaskStartDate as duration for subcontracts"** → mapping change: cascade rule that picks `(TaskEndDate − TaskStartDate)` in seconds when `Formula = JR/DY`, else `TotalPlannedMachineHours × 3600`. Requires either a new mapping rule type (e.g., `dateRangeToDuration`) or pre-computing the duration in the data load pipeline.
- **Stafford confirms "subcontracts have a specific field for day count"** → use that field × 86400. Need to identify which Genius field.
- **Stafford accepts "treat as no-op / skip in scheduling"** → mapping converts `JR/DY` to a special task type that the engine skips for chain ordering but still tracks for KPIs. Lossy but simple.

**Decision deadline:** Higher urgency than Q1 + Q2 — affects 13-17% of tasks across the dataset.

---

<!-- Add new questions below this line -->
