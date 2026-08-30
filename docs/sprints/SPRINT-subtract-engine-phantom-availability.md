# Sprint — Subtract Engine Fabricates Availability

**Status:** FIXED 2026-08-30 on `feature/subtract-engine-fix` (4 commits, pushed).
Three engine defects: two in the subtract engine fabricating availability, one
floating-point boundary in the walker. Every off-calendar placement the solver
was responsible for is gone, JIMMY's 13 over-capacity days are gone, the suite is
green and the parity gate shows 0 placement diffs.
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

Measured again with the guard disabled once both subtract defects were fixed:
the full book is **identical on every metric** (off-calendar 8, over-capacity
resources 8, over-capacity days 11, placed 1636). It fixes nothing measurable
today. Kept because `staticAvailable` still legitimately contains `q=0`
intervals for fully-consumed shifts, and a walker that counts those as free time
is wrong whether or not anything currently walks into them.

It also **amplified defect 3 below** — flat `cum` across consumed shifts made
that overshoot jump six intervals instead of one.

### Defect 3 — floating-point boundary in the walker (`23b477b`)

Separate bug, surfaced only once the phantoms were gone. A 30-minute task
consumed five days of JIMMY's shifts; a 36-minute task consumed fourteen. Both
claimed a full shift every day for the duration, which is what put JIMMY at 200%
on 13 days.

When `required` exactly exhausts the interval the walk starts in, `target`
(`base + required`) and the cumulative total are the same quantity reached by
different additions. With fractional seconds they differ:

```
base     = 4116945.600000024
target   = base + 1814.4 = 4118760.000000024
cum[160] =                 4118760.0          <- smaller by 2.4e-8
```

The `>=` test fails by 24 nanoseconds, so the walk skips to the next interval
with capacity — and then genuinely consumes it. Guarded both comparison sites
with `CUM_EPS = 1e-6`; durations are seconds, so sub-microsecond precision is
meaningless.

**Both sites were required.** The two production tasks take different tiers —
`30228-NT-1` the well-formed binary search, `30065-V-1` the overlap-tier
accumulation. Fixing one left the other untouched, which is how the second was
found.

Only **2 of 1,439** tasks hit it: the duration must *exactly* exhaust an interval
AND carry fractional seconds. Integer durations land cleanly, which is why it
survived this long.

```
tasks whose segments exceed their work    2 -> 0
JIMMY days over capacity                 13 -> 0
JIMMY reported utilization           13.38% -> 7.79%
```

`interval-walker-boundary.test.ts` covers both tiers, an integer control, and a
genuine shortfall the epsilon must not swallow. That last case returns the
walk's legacy `startW + required` fallback rather than spanning the gap —
pre-existing behaviour, noted in the test, unrelated to this fix.

## Results

Full `stafford-all` book, 1,660 tasks:

| | original | +qty guard | +defect 1 | +defect 2 | **+defect 3** |
|---|---|---|---|---|---|
| Off-calendar placements (solver) | 26 | 25 | 21 | **0** | **0** |
| Off-calendar (data-anchored, see below) | — | — | — | 5 | 5 |
| Tasks whose segments exceed their work | 2 | 2 | 2 | 2 | **0** |
| JIMMY days over capacity | 13 | 13 | 13 | 13 | **0** |
| Precedence violations (slim-500) | 4 | 4 | 5 ✗ | **4 ✓** | **4 ✓** |
| Full suite | 1393 ✓ | 1393 ✓ | 1 failed | 1408 ✓ | **1417 ✓** |
| Placement parity (3 goldens) | — | — | — | 0 diffs | **0 diffs** |
| Scheduled / unscheduled / infeasible | 1660/0/0 | 1660/0/0 | 1660/0/0 | 1660/0/0 | **1660/0/0** |
| Solve time | ~50s | ~50s | ~62s | ~35s | **~35–40s** |

The solve got **faster than before any of this** — the walker no longer searches
fabricated capacity that can never yield a placement.

### What it costs

Placements move on **999 of 1,660 tasks** (60% of the book) — that is the point,
not a side effect. The consequence to state plainly:

| | before | after |
|---|---|---|
| Late orders | 128 (27.1%) | **144 (30.5%)** |
| At-risk | 232 | 224 |
| On-track | 112 | 104 |
| Critical-path makespan | 42,931,501 | **40,993,261** (−4.5%) |
| Schedule span | 225.3 days | 225.3 days |
| On-time starts | 283 (17.1%) | 283 (17.1%) |

**16 more orders read as late, and that is the honest number.** Those orders were
never going to be on time; the schedule was hiding it by placing work in hours
nobody works. This matters directly for Stafford, whose stated value driver is
late-fee avoidance — a schedule under-reporting lateness by 12% produces
confident commitments the floor cannot keep.

Makespan improved 4.5% at the same time, so individual tasks move later while
the critical path shortens.

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

Defect 3 was found differently — by instrumenting `workingEndForwardW` for the
two affected durations and printing `first`, `j`, `base`, `total`, `more` and the
computed answer. Two calls 1,094 seconds apart, same `required`, produced
`j=160` (correct, span 1814.4) and `j=166` (wrong, span 414914.4). That pair made
the boundary comparison the only possible culprit.

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
- `packages/engine/tests/models/interval-walker-boundary.test.ts` — the float boundary, both tiers
- `packages/engine/AI/Schedulers/basescheduler.ts:1100` — `anchorCommittedTasks`, the remaining 5
- `docs/Stafford/QUESTIONS-actuals-mapping.md` — the `actualStart` mapping defect
