# Parking Lot — Deferred Items

## Timing Constraints
1. **Negative maxGap (overlap support)** — Allow successor to start BEFORE predecessor ends. `maxGap = -1800` means successor can start up to 30 minutes before predecessor completes. Use cases: QC sampling during production run, prepping recovery bay before procedure ends, starting concrete pour while final rebar is being tied. Requires two-value model (minGap + maxGap) or reinterpretation of negative values. V1 reserves negative values — treats them as null (unconstrained). Implementation: update propagation forward pass floor to `succ.start >= pred.end + maxGap` (negative maxGap allows starting before pred ends), update backward pass ceiling accordingly. Affects: chaincontextengine.ts propagation, assignStartTimes, truncation logic. **Do NOT implement until a customer needs it** — the propagation math is straightforward but testing overlap across all engine paths needs care.

## Neighborhood Strategies
2. **ProcessNeighborhood** — Schedule by process/work center across all orders. Group tasks by `task.process`, sort groups by priority, sort within group by due date/rank. Manufacturing pattern: "run all Milling first, then all Drilling." No new data fields needed — uses existing `task.process`, `task.rank`, `task.sequence`. Use with non-chain strategies.

3. **CTPNeighborhood** — Single chain, earliest feasible, fast exit. For `POST /v1/ctp/query`.

4. **BottleneckNeighborhood** — Schedule tasks on scarcest resource first. Requires resource availability check before sorting.

## Lane Enhancements
5. **Multi-lane support** — Allow `lane: true` on non-primary resources. Crane + Operator must stay paired across tasks. V1: isPrimary = lane. V2: explicit lane flag on any resource. Update `getLaneResources()` to check both.

6. **Soft affinity scoring rule** — "Prefer the same nurse across phases, but allow substitution." Scoring penalty for resource switches between chain phases, not a hard constraint.

## Error Reporting / Diagnostics
7. **Rich infeasibility messages** — When a task is infeasible, report the intersection failure: "OR-01 available at 7:15 ✓, AN-JONES booked 7:00-10:30 ✗ (conflict: CASE-002, CASE-001)." Currently reports per-resource independently without showing which combination failed.

## Performance / Monitoring
8. **Solve time in API response** — Return `solveTimeMs` and `strategy` name in the solve response. Useful for SLA monitoring, strategy comparison, and client-facing performance metrics.

## Future Solver
9. **Inter-chain optimization** — Chain 1 grabs a slot Chain 2 needed more. Tabu search / ILS across chains. Beyond Phase 3 bump-and-retry.

10. **AI Chat Assistant** — Natural language queries against analytics and scheduling endpoints.

11. **Constraint Propagation Visualization** — Show window tightening visually on Gantt as solver runs.

## Data Model
12. **requiresPreds deprecation** — No longer needed. Chain-aware strategies and linkId.prevLink handle predecessor ordering. Leave in appSettings for backward compatibility but stop checking it. The neighborhood strategy + linkId data handles everything.
