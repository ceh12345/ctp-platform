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

**Current working assumption:** OUTWORK tasks legitimately span calendar days, not machine hours. The mapping needs a different source field for this type.

**Defensive workaround shipped 2026-06-07** (pending Stafford confirmation):

We've extended the mapping engine with two small additions and updated the Stafford mapping to fall back to a date-range duration when `TotalPlannedMachineHours = 0`:

```jsonc
"durationSeconds": {
  "cascade": [
    { "from": "TotalPlannedMachineHours", "factor": 3600, "skipIfZero": true },
    { "dateRangeSeconds": { "from": "TaskStartDate", "to": "TaskEndDate" } }
  ]
}
```

- `factor.skipIfZero` — when the source field is 0, the rule returns undefined so the cascade can continue
- `dateRangeSeconds` — new rule type that returns `(EndDate − StartDate)` in seconds

This restores a non-zero duration for all 126 OUTWORK tasks in engineering-test and 7 in slim-100, unblocking downstream chain anchoring. Isolation test on WO 28482 (the chain that motivated this fix) confirms the chain now schedules end-to-end.

**Caveat:** the `TaskStartDate → TaskEndDate` window from Genius reflects the planned subcontract span. If Stafford operates with different vendor lead times in practice, this fallback may understate or overstate the real duration. Restore the original mapping or refine the fallback once Stafford confirms.

**Options once Stafford responds:**

- **Stafford confirms "TaskEndDate − TaskStartDate is the right subcontract duration"** → keep the cascade as-is, drop the `_note` flagging it as defensive
- **Stafford confirms "subcontracts have a specific field for day count"** → swap the second cascade branch to `{ from: "<that field>", factor: 86400 }`
- **Stafford prefers "treat as scheduling-skip"** → revert this change, add a new task type that the engine skips for chain ordering but tracks for KPIs

**Decision deadline:** Lower urgency now that the workaround is live, but worth resolving before the next data refresh so we know whether the fallback is the right answer or interim cover.

---

## Q4 — Engine bug: calendar interval shape sensitivity (NOT a Stafford question)

**Status: RESOLVED 2026-06-09 (commit `1611e65`).** Root cause found and fixed at the engine level. Notes below preserved for historical context.

**Not a Stafford question — engine bug.** Logged here because it surfaced during the same WO 28482 debug session and affected our ability to validate Stafford's data.

### Actual root cause (uncovered 2026-06-09)

The empirical pattern in the table below described the symptom but not the underlying cause. After deeper investigation: the bug was in `walkForward` / `walkBackward` in `packages/engine/Models/Core/interval-walker.ts`. The walker correctly accumulated **clipped** working time across intervals, but the running `start` / `end` cursor positions were initialised from **raw** interval bounds (interval start/end), not clipped to the scheduling window. When a calendar interval extended past the task window — either side — the walker returned cursor positions outside the window, and downstream `feasibleStartTimes` couldn't reconcile them with the task window so the placement was rejected.

The Q4 calendar workaround (single horizon-spanning interval) didn't actually fix the problem — it just changed the shape. The single mega-interval was wider than any task window, so the bug fired every time; the only reason it "worked" for the ingest pipeline was that ingest validation doesn't run the scheduler.

**Fix:** `Math.max(ptr.data.startW, rangeStart)` / `Math.min(ptr.data.endW, rangeEnd)` on the walker's start/end cursor at init, reset, and update — six lines across the two walker functions. Regression test in `packages/engine/tests/scheduling/continuous-calendar.test.ts`. Snapshot tests in `packages/engine/tests/models/range.refactor.test.ts` updated to reflect corrected behaviour.

**Impact:** slim-100 feasibility went from 69.7% to 89.9% (the 20 extra tasks were all on WOs that had OUTWORK tasks blocking their chains). WO 27978 — the canonical reproduction — now places all 12 tasks. The OUTWORK calendar workaround in `generate-stafford-calendar.py` is no longer needed and should be removed.

### Original notes (the symptom table that led us astray)

**The bug:** `CommonStartTimesAgent` in the engine silently fails to find scheduling slots when a resource's calendar has multiple contiguous 24-hour intervals — but the failure is shape-sensitive in ways that aren't fully characterized.

**Empirical findings from systematic testing (OUT-1 task, 1h duration, OUTWORK resource, slim-100 horizon):**

| Calendar shape | Result |
|---|---|
| 1 interval covering full horizon (52 days) | **Works** |
| 1 × 24h interval at 00:00 UTC | Works |
| 2 × 24h intervals at 00:00 UTC, contiguous | Works |
| 5 × 24h intervals at 00:00 UTC, contiguous | Works |
| 1 × 24h interval at 11:00 UTC (= NZ midnight) | Works |
| **2 × 24h intervals at 11:00 UTC, contiguous** | **FAILS** |
| **365 × 24h intervals at 11:00 UTC (original generated shape)** | **FAILS** |
| **3 × 8h intervals at 00:00 UTC covering full day** | **FAILS** |
| MURRAY-style 8h day-shift intervals starting 18:00 UTC | Works |

The bug isn't pure interval-length, isn't pure interval-count, isn't pure start-time — it's some interaction. Same effective coverage works as one big interval but fails when split into contiguous pieces, depending on the specific start-time × interval-length combo.

**Workaround shipped 2026-06-08:** `scripts/generate-stafford-calendar.py` now emits ONE horizon-spanning interval for subcontract resources (instead of 365 daily 24h intervals). The existing fixture calendars (`engineering-test`, `slim-100`, `wo28482-only`) were patched the same way — for each SUBCONTRACT-type resource, multiple intervals replaced with one interval `[min(start), max(end)]`.

This unblocks Stafford scheduling but doesn't actually fix the engine. **Real fix needed:**
- Engine team: write a unit test against `CommonStartTimesAgent` that exercises various interval shapes (the table above is the test matrix)
- Trace why specific combos return zero start-times
- Fix the interval-merging or boundary-handling logic

**Impact if not fixed (real-fix-needed deadline):**
- Day-shift resources work fine (current pattern is 8h at 18:00 UTC)
- Subcontract / 24h coverage resources are stuck with the workaround
- Any future tenant that wants a "24/7" resource modeled as daily intervals will hit the same wall
- The workaround obscures the bug — when someone tries to model an actual 24/7 resource with daily intervals "properly," it'll silently break their schedule

---

## Q5 — Platform-enforced state-coherence rule (not a Stafford question)

**Not a Stafford question — platform rule.** Logged here for visibility because it materially changes what we send to Stafford for review.

**The rule:** if task X precedes task Y in a chain, and Y is `IN_PROCESS` or `COMPLETED`, then X is `COMPLETED`. **There is no other possible state.** Y cannot be running or done without X having finished first. This is a derivation from the chain-precedence invariant the model already encodes — not an inference about source-data errors, not a correction we choose to apply.

**Why we need to enforce it:** Genius (and most source ERPs) doesn't enforce this invariant. Operators mark a task IN_PROCESS or COMPLETED in Genius without going back to update predecessors that they "must have" finished. The data is internally inconsistent against the chain model. The CTP platform enforces what the source doesn't.

**Implementation:** Sync-time pass walking chains backward from any task in IN_PROCESS or COMPLETED state, setting all ancestors to COMPLETED. Lives in the data-load pipeline (currently `scripts/dump-ctp-shape.js`; will move to API sync hydrator when feature-b ships).

**Validation surface (when later wired into the inspector / sync report):**

```
Task <X> source state was <NOT_STARTED|IN_PROCESS> but successor <Z>
is IN_PROCESS/COMPLETED. State corrected to COMPLETED per chain
precedence invariant.
```

Informational, not an error. Operators get told "the platform reconciled this for you" — they can update Genius or leave it.

**Impact in slim-100 (measured 2026-06-08):** the state-coherence pass upgrades a small number of NOT_STARTED tasks to COMPLETED (exact count surfaced in the dump script output). This is what unblocks chains where an in-process task is mid-chain — predecessors no longer need to be "placed forward" by the solver because they're already done.

**Why this isn't a Stafford question:**
The rule is a model invariant we enforce. We don't ask Stafford "is it OK if your IN_PROCESS task's predecessors are COMPLETED?" — they can't NOT be. The platform applying the rule is correct behavior; the data inconsistency it papers over is Stafford's to clean up at their own pace.

**Related engine concern (separate ticket):**
Even with state-coherence applied at sync time, the engine's strategy still appears to refuse to backward-place chain predecessors of a pinned task in some cases. That's an engine design issue — a properly-engineered solver should always try to place every included task, with anchors (pinning, IN_PROCESS state) as hard constraints that the solver works around, not as gates that prevent placement of upstream work. With state-coherence applied, the question becomes moot for the IN_PROCESS case (predecessors are COMPLETED so the solver no longer tries to place them at all), but the underlying engine behavior is worth fixing separately.

---

## Q6 — Very-long-duration tasks (e.g. 192h on a single resource)

**The question:** For tasks like `28482-F-9` (192h of `TotalPlannedMachineHours` on GRANT, a day-shift machinist), what's the operational truth? Is this genuinely a 5-week machining operation, an inflated estimate that operators haven't updated, or a unit/Formula misread?

**Why we're asking:**

192 hours on a single day-shift resource = 24 working days = ~5 weeks of GRANT's calendar capacity. In the slim-100 fixture, F-9 sits mid-chain in WO 28482 — its predecessor K-8 ends around 2026-05-26, so F-9 would need to extend from late May to early July. The slim's horizon (auto-derived from group sourceStart/sourceEnd) ended 2026-06-27 before adding a buffer.

This caused chain cascade failure: F-9 didn't fit → all 14 downstream tasks (PR-10, K-11, F-12, ..., PM-24) marked infeasible.

**Workaround shipped 2026-06-08:** `slice-stafford-slim.js` now adds a `HORIZON_BUFFER_DAYS = 30` constant past `max(sourceEnd)`. Long-duration tasks get runway past their group's nominal end. Auto-derived horizons no longer cut chains short at the boundary.

**Scale of the pattern:** F-9 isn't unique. Across the 2026-06-03 capture, several tasks exceed 100h on individual day-shift resources. Worth knowing what Stafford's operational expectation is for these — does GRANT really spend 5 consecutive weeks on one task, or is the 192h estimate stale?

**Options once Stafford responds:**

- **Stafford confirms "192h is real, just plan around it"** → keep the horizon buffer, no further action
- **Stafford confirms "estimates are inflated, operators rarely update them"** → flag long-duration tasks (>40h on a finite resource?) in the inspector export as `requires-review` so operators can update Genius before sync
- **Stafford confirms "this should split across resources"** → mapping change: detect long-duration tasks and split into multiple sub-tasks. Probably out of scope for v1.

**Decision deadline:** Lower urgency — the buffer unblocks scheduling today. The real question is data-quality, not engine.

---

## Q7 — WO 28482 chain doesn't fit the window: are the durations real?

**The question:** WO 28482's chain has 22 tasks totalling **~2,400 hours of TotalPlannedMachineHours**. With the calendar bug now fixed (Q4 RESOLVED), 13 of 22 still schedule but 9 in the tail don't — because the engine's wall-clock placement for the chain runs to ~**2026-09-29**, but the WO's own `sourceEnd` is **2026-06-27** (and `promiseDate` is 2026-06-29). The engine's elapsed-time math diverges from Stafford's source-tagged `scheduledEnd` by ~**3 months**.

Is the source data's hours-per-task semantically what we think it is, or is there a unit / Formula misinterpretation behind the divergence?

**Why we're asking:**

Concrete reproduction on stafford-slim-100 (2026-06-09, post engine fix):

| Task | TotalPlannedMachineHours | Resource | Engine wall-clock | Stafford source-tagged `scheduledEnd` |
|---|---:|---|---:|---|
| 28482-F-6 | 384h | GRANT (day-shift machinist) | 16 days continuous | (within chain ending 2026-06-26) |
| 28482-F-9 | 816h | GRANT | 34 days continuous | (within chain ending 2026-06-26) |
| 28482-F-12 | 312h | GRANT | 13 days continuous | (within chain ending 2026-06-26) |
| 28482-K-11 | 120h | WERNER | 5 days continuous | (within chain ending 2026-06-26) |
| 28482-OUT-21 | 168h | OUTWORK | 7 days continuous | (within chain ending 2026-06-26) |

**Stafford's source-tagged `scheduledEnd` on the last task (PM-24) is 2026-06-26** — implying Stafford's Genius scheduler believes the whole 22-task chain finishes by then. The engine schedules just the first 13 tasks running to **2026-07-23**, leaving 9 tasks unable to fit before the horizon ends (2026-07-28).

**On Q6's chord — long-duration tasks:** F-9 at 192h was already flagged in Q6; F-6 (384h), F-9 (816h), F-12 (312h) on the same WO add weight to that. The current Q6 working assumption was "horizon buffer unblocks scheduling, leave data quality to Stafford." With the engine bug fixed and 28482 still failing on chain length, Q6's data-quality question becomes blocking, not deferred.

**What's discrepant:**

1. **Unit possibility:** is `TotalPlannedMachineHours` actually hours of work, or some other unit (days, person-hours, calendar-hours)? Genius's `Formula` column distinguishes `HR/UN` (hours per unit) from `JR/DY` (days per day, subcontract semantics). Are some F-* tasks using `JR/DY` or another formula we're misinterpreting as hours?
2. **Capacity / parallelism possibility:** is GRANT supposed to run in parallel (multiple workers on one task), or with a different shift pattern than the 5d/wk we've assumed? An 816h task taking 34 days continuous (engine) vs ~7 weeks if split over normal shifts could just mean GRANT is meant to be modelled as multiple resources or as 24/7.
3. **Engine's elapsed-time math possibility:** the engine is placing 384h as 16 continuous wall-clock days (24h/day). For a normal day-shift resource that should be ~67 calendar days (8h × 5d/wk). Either GRANT's calendar is wrong (we should check) or the engine is treating FLOAT_DURATION as continuous when it shouldn't.

**Why we want Stafford's word before we change anything:** we don't know which of those three is the real explanation, and each has a different fix. Guessing risks a fake-correctness deploy where the schedule "looks right" because we adjusted a number, not because we understood the source semantics.

**Current state:** **WO 28482 left unscheduled** in slim-100 — 9 of 22 tasks remain infeasible. We are deliberately not bandaiding (no horizon extension, no duration override) until Stafford clarifies.

**Concrete asks for Stafford:**

1. For task `28482-F-6` (TotalPlannedMachineHours = 384, Formula = `HR/UN`, Resource = GRANT):
   - Is 384 hours of GRANT's working time the right interpretation?
   - If yes — what calendar pattern does GRANT actually follow? Single shift / multiple shifts / 24/7 / overlapping workers?
   - If no — what's the right interpretation (and what does the field actually mean)?
2. For 28482's whole chain — Stafford's Genius scheduler shows it finishing **2026-06-26**. Is that based on the same `TotalPlannedMachineHours` values we're reading, or is Genius applying some transformation we don't have visibility into?
3. Is there an operational pattern where Stafford operators inflate `TotalPlannedMachineHours` as a planning-buffer / sandbag, and the real expected time is much shorter?

**Impact if assumption is wrong:**
- If we misread the unit: every WO with a long-duration task will have inflated placements, schedule will look catastrophic vs. Stafford's reality
- If GRANT is meant to be 24/7 or parallel: same — placements will be 3-6x longer than reality
- If we read it right and the data is just inflated: we're stuck reporting infeasible schedules until Stafford updates Genius

**Decision:** **Blocking.** We can't get past 89.9% scheduling on slim-100 without a Stafford answer here. WO 28482 cannot be confidently scheduled with the data as-is — and any code change to make it schedule would be a guess, not a fix.

---

## Q8 — Self-referencing `prevLink` on production tasks

**The question:** Several production tasks in WORK7 have `prevLink` pointing at the task's own key (`prevLink === taskKey`). Some ERP systems use this idiom as a sentinel meaning "no predecessor — this is a chain head"; others use blank/null. Which is Genius's convention, and are these records flagging anything operational?

**Why we're asking:**

In the 2026-06-03 WORK7 capture (engineering-test, 2,511 tasks):

| Stat | Value |
|---|---|
| Self-referencing tasks | **102 / 2,511 (4.1%)** |
| Affected work orders | **24** |
| Most-affected operation types | OUT (26), QC (22), D (18), A (14), PM (6) |

Concrete example — chain 25760:

```
key=25760-OUT-9    prevLink="25760-OUT-9"   ← self-reference
key=25760-QC-10    prevLink="25760-QC-10"   ← self-reference
key=25760-PM-1     prevLink="25760-PM-1"    ← self-reference
```

The concentration on OUT (outsource), QC (quality check), PM (project management) — operations that are often "appended-to-end" or "added-outside-standard-routing" — suggests this might be intentional Genius behaviour for tasks that aren't part of the main BOR sequence.

**Three possible readings:**

1. **Genius sentinel for "no predecessor"** — some ERPs do this; the value is structurally non-null but semantically empty. CTP treats it the same as `prevLink: ''` (chain head). Schedule works fine.
2. **Operator workflow artifact** — operators added these operations after the main routing was set up, and the form auto-populated `prevLink` with the task's own key as a default. Functional but not strictly correct.
3. **Genuine data quality issue** — operator typo or sync glitch; the operation should have had a real predecessor that got lost. Schedule may run but the chain ordering is wrong.

**Current working assumption (shipped 2026-06-09 in commit `[next]`):** treat `prevLink === key` as equivalent to "no predecessor." The hydrator's `deriveSequencesFromLinkId` skips self-references when building the chain head set; the assertion skips them when verifying topology. WO 28687 (the bug that surfaced this) schedules end-to-end. No code change needed if Stafford confirms reading #1 or #2.

**Impact if assumption is wrong:**
- If Stafford confirms #1 or #2: keep current behaviour, document the platform interpretation
- If #3 (data quality): we should surface these in the inspector export as `requires-review` so operators can re-link them to their proper predecessor in Genius. The 102-task footprint is small enough to clean up manually.

**Asks for Stafford:**

1. Is `prevLink === task's own key` a sentinel for "no predecessor in this chain" in Genius?
2. Why does the pattern concentrate on OUT / QC / D / A operations? Is there a workflow where these operations get added separately from the main routing?
3. Do you want CTP to flag these as `requires-review` for source cleanup, or is the current "treat as no-predecessor" interpretation correct?

**Decision urgency:** **Low.** Schedule works either way. The question is whether the platform should help Stafford spot and clean these records, or just absorb them silently.

---

<!-- Add new questions below this line -->
