# Sprint — Subtract Engine Fabricates Availability

**Status:** FIXED 2026-08-30 on `feature/subtract-engine-fix`. Every off-calendar
placement the solver was responsible for is gone, the suite is green, and the
solve is ~30% faster than before the work started.
**Severity (before):** the solver placed work into hours a resource does not work.

## Symptom

26 tasks in `stafford-all` were scheduled entirely outside their resource's
calendar. Most started at **21:00 — the exact minute a shift ends** — and ran
continuously through the night.

```
JACK R shifts:  19 Jul 13:00–21:00,  20 Jul 13:00–21:00

25512-F-1    8.00h occupied   ON-SHIFT  8.00h   OFF-SHIFT  0.00h   ✓
28372-F-2   15.00h occupied   ON-SHIFT  0.00h   OFF-SHIFT 15.00h   ✗
28384-F-6   11.25h occupied   ON-SHIFT  0.00h   OFF-SHIFT 11.25h   ✗
```

The engine already recorded the failure: those tasks came back with
`segments: []`. `segmentsFromCalendar` intersects the placement with the real
calendar and found nothing. **An empty segments array is a ready-made detector
for this class.**

## Root cause

`setengine.ts` implements subtraction as *adding a negated quantity*
(`if (mode == SUBTRACT_MODE && bq > 0) bq = bq * -1`). Two branches of
`setOperation` then emitted A's positive quantity over spans A does not cover.

Captured live at the moment `28372-F-2` was placed (resource 49 = JACK R):

```
original        : [522158400,522187200)q=1 [522244800,522273600)q=1 ...
staticOriginal  : [522158400,522187200)q=1 [522244800,522273600)q=1 ...   (same object)
staticAssign    : [522158400,522187200)q=1 [522187200,523548000)q=1
staticAvailable : [522158400,522187200)q=0 [522187200,523548000)q=1 ...
                   ^^^^^^^^^^ correct        ^^^^^^^^^^ FABRICATED
```

`[522187200,523548000)` is a **booking** — 15.7 days — appearing in
`staticAvailable` at `q=1`. `original` has no shift there at all.
`workingEndForwardW` walked it, found contiguous "working time", and returned an
end straight through the night.

### Defect 1 — adjacent-equal-quantity merge ran for SUBTRACT

In the `A.endW == B.startW` branch:

```ts
if (a.qty == b.qty && (mode == ADD_MODE || mode == SUBTRACT_MODE)) {
  a.endW = b.endW;   // absorbs B's region into A as POSITIVE capacity
  moveB();
}
```

Merging adjacent equal-quantity intervals is correct for ADD, where both
operands contribute positively. Under SUBTRACT it swallowed the subtrahend
instead of negating it. **Restricted to `ADD_MODE`.**

### Defect 2 — A-only prefix emitted through B's end

In the `B.endW >= A.endW && B.startW >= A.startW` branch:

```ts
updateResult(a.startW, b.endW, a.qty, 0);   // A's qty across the B-only tail
```

For `A=[100,200)`, `B=[150,300)` this produced `[100,300)q=1`. The two statements
after it already handle the overlap (`q=0`) and the B-only remainder (negated),
so the prefix emit must stop at `B.start`. **Changed to `b.startW`.**

The two interact: fixing only the first left placements moving onto ground that
was still wrong, which produced a precedence regression (4 → 5 on slim-500).
With both fixed, that regression disappears.

## Also landed — interval-walker `qty` guard

`interval-walker.ts` never inspected `qty`, so a consumed shift at `q=0` still
counted its full span as free time. Guarded in all three tiers: the index
builder excludes `qty <= 0` from `cumDur`/`cumRR`, the overlap tier skips them,
and `clipDuration` returns 0.

Correct and worth keeping, but **nearly inert on its own** (26 → 25) — the
phantom carried `q=1`, not `q=0`.

## Results

Full `stafford-all` book, 1,660 tasks:

| | original | +qty guard | +defect 1 | **+defect 2** |
|---|---|---|---|---|
| Off-calendar placements (solver) | 26 | 25 | 21 | **0** |
| Off-calendar (data-anchored, see below) | — | — | — | 5 |
| Precedence violations (slim-500) | 4 | 4 | 5 ✗ | **4 ✓** |
| Full suite | 1393 ✓ | 1393 ✓ | 1 failed | **1408 ✓** |
| Scheduled / unscheduled / infeasible | 1660/0/0 | 1660/0/0 | 1660/0/0 | **1660/0/0** |
| Solve time | ~50s | ~50s | ~62s | **~35s** |

The solve got **faster than before any of this** — the walker no longer searches
fabricated capacity that can never yield a placement.

## The 5 remaining are NOT an engine defect

All five are `wipState: IN_PROCESS`, anchored by `anchorCommittedTasks` at their
`actualStart`. Running work cannot be rescheduled, so the engine correctly pins
it where the data says it started.

```
28260-F-1   actualStart 2026-07-21T03:13  == scheduledStart
28346-NT-1  actualStart 2026-07-17T03:01  == scheduledStart
28380-F-2   actualStart 2026-07-24T03:54  == scheduledStart
29977-M-4   actualStart 2026-09-24T03:42  == scheduledStart
30005-M-4   actualStart 2026-09-24T03:42  == scheduledStart
```

`actualStart == scheduledStart` on every one, because **both map from
`TaskStartDate`** — Genius's *planned* date read as an actual. That anchors
"running" work at 03:13 in the morning. Tracked in
`docs/Stafford/QUESTIONS-actuals-mapping.md` (Q1–Q3); it needs Stafford's answer
on which field carries a real actual start, not an engine change.

Confirmed by instrumentation: the scheduling path produced **zero** empty-segment
placements in the final run, and `workingEndForwardW` took **zero** fallbacks
across the entire solve.

## How it was found

An invariant, not case-chasing: **no result interval with real duration may
carry positive capacity outside A's support.**
`setengine-subtract-invariant.test.ts` runs it over 20 geometries —
before/after/adjacent/overlapping/containing, multi-interval B sequences, gap
overhangs, pooled quantities. Fourteen passed after defect 1; the fifteenth
pinned defect 2 exactly.

Ruled out along the way, recorded so nobody re-treads it:

- **Not** the `startW + required` fallbacks in `workingEndForwardW`. Before the
  fix only path F fired (2,134× per solve) and never for the affected tasks;
  after the fix, none fire at all. `envelope == duration` is *not* a reliable
  fingerprint of the fallback — a successful walk over contiguous availability
  produces the same equality.
- **Not** FIXED-vs-FLOAT. These were FLOAT. `segments: null` (213 tasks) is the
  legitimate FIXED case.
- **Not** the optimizer — the stack showed the normal path
  `CTPScheduler.scheduleTask → scheduleATask → ScheduleEngine.schedule`.
- **Not** `staticOriginal` corruption — same object as `resource.original`.
- **Not** multi-resource slots — every affected task had a single resource.

## Recommended follow-up

**Assert no scheduled task has `segments: []` after a solve.** It is free, uses
the engine's own signal, and would have caught this class the day it appeared.
It would also surface the `IN_PROCESS` anchoring cases as a data alert rather
than a silent oddity.

Before landing on the integration line, run the placement-parity harness from
the solver-performance sprint: placements change (that is the point), and the
harness is the tool for judging whether they change only where expected.

## Reproduce

```
POST /v1/state/reload   { }   X-Tenant-Id: stafford-all
POST /v1/ctp/solve      { }   X-Tenant-Id: stafford-all
GET  /v1/ctp/results
# tasks where segments !== null && segments.length === 0
```

## References

- `packages/engine/Engines/setengine.ts` — both fixed branches
- `packages/engine/Models/Core/interval-walker.ts` — the `qty` guard
- `packages/engine/tests/engines/setengine-subtract-invariant.test.ts` — 20 geometries
- `packages/engine/tests/engines/setengine-phantom-availability.test.ts` — the production case
- `packages/engine/AI/Schedulers/basescheduler.ts:1100` — `anchorCommittedTasks`, the remaining 5
- `docs/Stafford/QUESTIONS-actuals-mapping.md` — the `actualStart` mapping defect
