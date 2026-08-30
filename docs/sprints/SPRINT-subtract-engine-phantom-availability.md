# Sprint — Subtract Engine Fabricates Availability

**Status:** root cause found and traced 2026-08-30. Partial fix landed (walker
`qty` guard); the dominant defect is unfixed.
**Severity:** the solver places work into hours a resource does not work.

## Symptom

26 tasks in `stafford-all` are scheduled entirely outside their resource's
calendar. Most start at **21:00 — the exact minute a shift ends** — and run
continuously through the night.

```
JACK R shifts:  19 Jul 13:00–21:00,  20 Jul 13:00–21:00

25512-F-1    8.00h occupied   ON-SHIFT  8.00h   OFF-SHIFT  0.00h   ✓
28372-F-2   15.00h occupied   ON-SHIFT  0.00h   OFF-SHIFT 15.00h   ✗
28384-F-6   11.25h occupied   ON-SHIFT  0.00h   OFF-SHIFT 11.25h   ✗
```

Spread across 9 resources; MURRAY carries 9 of them (all 15-minute QC checks
chained behind a predecessor that ends at shift close).

The engine already records the failure: these tasks come back with
`segments: []`. `segmentsFromCalendar` intersects the placement with the real
calendar and finds nothing. **An empty segments array is a ready-made detector
for this class.**

## Root cause

`setengine.ts:163` implements subtraction as *adding a negated quantity*:

```ts
if (this.mode == this.SUBTRACT_MODE && bq > 0) bq = bq * -1;
```

Where an assignment overlaps a real shift, the arithmetic cancels correctly.
Where it falls **outside any shift there is nothing to cancel against**, so the
negated interval survives as positive capacity. Booking work *creates*
availability that never existed.

Captured live at the moment of placement (`28372-F-2`, resource 49 = JACK R,
`st=522187200`, `required=54000`):

```
original        : [522158400,522187200)q=1 [522244800,522273600)q=1 [522331200,522360000)q=1
staticOriginal  : [522158400,522187200)q=1 [522244800,522273600)q=1 [522331200,522360000)q=1
staticAssign    : [522158400,522187200)q=1 [522187200,523548000)q=1
staticAvailable : [522158400,522187200)q=0 [522187200,523548000)q=1 [522244800,...)q=1 [...]
                   ^^^^^^^^^^ correct        ^^^^^^^^^^ FABRICATED
sameRef(original, staticOriginal) = true
```

`[522187200,523548000)` is a **booking** — 15.7 days, almost certainly
`28371-F-4`'s 378-hour envelope — appearing in `staticAvailable` at `q=1`.
`original` has no shift there at all.

Tell-tale signs of the corruption elsewhere in the same dumps: intervals with
non-shift boundaries (`522632247`, `522763200`), overlapping ranges, and blocks
far longer than any shift. `original` is always clean 28,800s shifts.

## How it produces the placement

1. `scheduleengine.ts:56` → `computeFloatEndW` → `workingEndForwardW`, walking
   **`available.staticAvailable`**
2. The walk finds 15 contiguous hours inside the phantom block → returns
   `st + 54000`
3. `scheduleengine.ts:161` → `segmentsFromCalendar` checks the same span against
   **`resource.original`** → zero overlap → `segments: []`
4. Task is placed, `state = SCHEDULED`, `feasible: true`, errors cleared

Note the two functions read **different structures** — the placement is decided
against `staticAvailable` and validated against `original`.

Self-reinforcing: the phantom is created *by* bookings, so the busier the
resource the more fake capacity it accumulates.

## What was ruled out along the way

- **Not** the `startW + required` fallbacks in `workingEndForwardW`. Only path F
  (`walkForward` infeasible) fires — 2,134 times per solve — and no fallback
  event carries `required=54000`, so it does not explain these placements.
  `envelope == duration` is *not* a reliable fingerprint of the fallback: a walk
  that succeeds over contiguous availability produces the same equality.
- **Not** FIXED-vs-FLOAT. These are FLOAT (the engine attempted segments).
  `segments: null` (213 tasks) is the legitimate FIXED case.
- **Not** the optimizer. The stack shows the normal path:
  `CTPScheduler.scheduleTask → scheduleATask → ScheduleEngine.schedule →
  addTaskToResource`.
- **Not** `staticOriginal` corruption — it is the same object as
  `resource.original` (`sameRef = true`) and is clean.

## Landed: walker `qty` guard (partial)

`interval-walker.ts` never inspected `qty`, so a consumed shift at `q=0` still
counted its full span as free. Now guarded in all three tiers: the index builder
excludes `qty <= 0` from `cumDur`/`cumRR`, the overlap tier skips them, and
`clipDuration` returns 0.

Measured effect on the full book:

| | before | after |
|---|---|---|
| tasks with empty segments | 29 | **28** |
| off-calendar placements caught | 21 | 20 |
| scheduled / unscheduled / infeasible | 1660 / 0 / 0 | 1660 / 0 / 0 |
| onTimeStarts | 17.1% | 17.4% |
| solve time | ~50s | ~50s |

Tests: 1393 passed, 10 skipped, 0 failed.

**It is nearly inert** — correct, safe, and it addresses only the minor half.
The phantom interval carries `q=1`, not `q=0`, so the guard cannot suppress it.

## The real fix (not attempted)

**Subtraction must not emit intervals outside the minuend's support.**
`A − B` should never produce a positive-quantity interval where `A` has none.

Not a quick patch. `CTPSubtractSetEngine` shares its accumulation with
`CTPAddSetEngine` and siblings (`union`, `intersect`, `compliment`), and the
result feeds `mergeAvailable`, `recomputeAvailable`, and every placement
decision. Changing the interval algebra needs its own sprint plus the
placement-parity harness from the solver-performance work to prove placements
do not shift unexpectedly.

Worth adding regardless of the fix: a **post-solve assertion** that no scheduled
task has `segments: []`. It is free, and it would have caught this class the day
it appeared.

## Reproduce

```
POST /v1/state/reload   { }        X-Tenant-Id: stafford-all
POST /v1/ctp/solve      { }        X-Tenant-Id: stafford-all
GET  /v1/ctp/results
# tasks where segments !== null && segments.length === 0
```

## References

- `packages/engine/Engines/setengine.ts:163` — the negated-quantity subtraction
- `packages/engine/Engines/availableengine.ts:456` — `computeAvailable()`
- `packages/engine/Engines/scheduleengine.ts:56,161` — the two-structure mismatch
- `packages/engine/Models/Core/interval-walker.ts` — the `qty` guard
- `packages/engine/Models/Core/window.ts:195` — `segmentsFromCalendar`
