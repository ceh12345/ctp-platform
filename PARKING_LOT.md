# Parking Lot — Deferred Items

## Error Reporting / Diagnostics
1. **Bottleneck resource identification** — When a task is infeasible, report the resource with the least available capacity (duration × qty) in the window, not just whichever resource fails the intersection last. Includes pooled resource qty in the calculation.

2. **Multi-resource infeasibility report** — Show ALL resources below demand threshold, not just the worst one. "DR-CHEN: 0h, Nurse Charlie: 2h (need 0.5h)"

## Seed Data
3. **Williams CASE-005** — 28/30 scheduled. Real bottleneck is DR-CHEN (no Monday calendar) + Tuesday contention. Could widen window or add fallback surgeon. Not a bug.

## Phase 1/2 Observations
4. **Kim CASE-003 cross-day gap** — Setup Feb 17, Procedure Feb 18 (24.5h gap). Phase 3 chain context engine would place Setup on Feb 18 instead. Known Phase 2 limitation.

5. **Setup→Proc gaps 30-80 min** — Driven by surgeon/anesthesiologist availability. Phase 3 would reduce these by evaluating the whole chain.
