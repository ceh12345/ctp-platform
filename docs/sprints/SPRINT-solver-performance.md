# Sprint — Solver Performance under Preference Pools

**Date opened:** 2026-07-29
**Branch:** `feature/solver-performance` (worktree `ctp-platform-optimization`)
**Baseline commit:** `225617a` (dispatch preference pass + July-16 data refresh)
**Status:** ANALYSIS COMPLETE — tickets scoped, implementation not started

## Why now

The dispatch preference pass (`feature/dispatch-strategy`) changed the solver
workload shape: tasks went from exactly one resource each to preference pools
of up to 12 candidates (group members). slim-100 solves went from sub-second
to **9–25 s**. Stafford engineering-test has 1,019 distributable tasks with
the same pool structure — this cost scales with exactly the feature we just
shipped, and the daily replan loop Stafford wants runs a solve every morning.

## Profile evidence (slim-100, 2026-07-29, commit 225617a)

CPU profile (`node --cpu-prof`, 2 solves, 29.3 s wall / 18,362 samples)
through the real service path (StateHydrator → CTPService.solve):

| self% | function | file |
| --- | --- | --- |
| 34.05 | `assignStartTimes` | chaincontextengine.ts |
| 21.19 | `findEarliestFeasibleStart` | chaincontextengine.ts |
| 9.81 | `getAssignedProcessChangeDuration` | chaincontextengine.ts |
| 9.20 | `workingEndForwardW` | interval-walker.ts |
| 5.84 | `workingStartBackwardW` | interval-walker.ts |
| 3.50 | `findLatestFeasibleStartForPred` | chaincontextengine.ts |
| ~3 | luxon date ops (scattered) | luxon |

~85% of solve time is inside `evaluateChain → assignStartTimes`.

Instrumented call counts (one 10 s solve, monkey-patched prototypes):

| counter | value |
| --- | --- |
| `assignStartTimes` calls | 324 |
| `findEarliestFeasibleStart` calls | **1,739,023** |
| `getAssignedProcessChangeDuration` calls | **1,827,061** |
| combo-size histogram | 2→23, 3→56, 4→1, 5→52, **8→192** |

Reading: one 8-task chain is evaluated as **192 resource combinations**
(cross-product of preference pool sizes along the chain). Per combo,
candidate starts × outward simulation × per-step feasibility scans yields
~5,400 `findEarliestFeasibleStart` calls per `assignStartTimes` invocation.
Cost model: `combos × candidates × chain-length × scan-cost`. Before the
dispatch pass every chain had exactly 1 combo.

Additional finding: **warm re-solve regression** — solving the same hydrated
landscape twice in-process: solve #1 10.6 s, solve #2 17.4 s (+65%). The API
path re-hydrates per request and does not show this; something accumulates on
the landscape between solves.

## Tickets (ranked)

### P1 — Combo symmetry pruning (changes the complexity class)
The 192 combos are mostly time-identical: pool members within a group share
the same calendar (`Standard`) and efficiency (e.g. all 12 F-welders at 90%),
so swapping members changes nothing about feasible timing — only existing
load differs. Options, cheapest first:
- (a) **Canonical dedup:** evaluate one representative per identical
  (calendar, efficiency) class per slot; assign the least-loaded member of
  the class at placement time. Expected ~10–20× fewer combos on affected
  chains.
- (b) **Beam search:** rank members by availability, evaluate only top-K
  combos instead of the full cross-product. Tunable, works even when pools
  are heterogeneous.
Gate: schedule parity on slim-100 KPIs (or strictly-better), all pins
honored, assignments in-pool. Note dedup interacts with `RankedScheduleContexts`
and usage accounting — least-loaded selection must see intra-solve bookings.

### P2 — Memoize `getAssignedProcessChangeDuration` (1.8M calls, ~10%)
Called per intermediate task per candidate walk. `chaincontextengine.ts:118`
comment already contemplates a `pcd` precompute for the binary search —
extend to the candidate walks: per-context cache keyed on start-time-node
bucket (targetStart values are monotone within a walk).

### P3 — Working-time prefix index for interval-walker (~15%)
`workingEndForwardW`/`workingStartBackwardW` walk calendar intervals linearly
per call. Precompute cumulative working-seconds prefix array per (calendar,
horizon) → binary search + arithmetic per call. slim-100 effectively has one
shared calendar, so precompute cost is trivial.

### P4 — Warm re-solve regression (investigate before daily-replan builds on it)
Reproduce: hydrate once, solve twice in-process (see
`profile-solve.js` pattern below). Find what grows: startTimes lists, ranked
contexts, usage/state-change accumulation. Fix or document the required
reset. This blocks any in-process re-solve loop (bake-off harness, replan).

### P5 — slim-100 horizon trim (config-only)
The 2026-07-29 re-slice wrote a 228-day horizon (Phase-2 pickup group
extended the range); candidate lists scale with horizon. Cap via
`HORIZON_FIXED_DAYS ≈ 120` in `scripts/slice-stafford-slim.js` or drop the
Phase-2 group. Demo-latency win only — not an engine fix.

## Method notes (reproduce the numbers)

- Profile runner: standalone script wiring FileConfigStore → ConfigService →
  StateHydratorService → StateService → CTPService (mirror of
  `strategy-comparison.spec.ts::createServices`), run under
  `node --cpu-prof`. Exits naturally so the profile flushes. Session copy:
  scratchpad `profile-solve.js` / `instrument-solve.js` / `analyze-profile.py`
  — recreate under `packages/engine/benchmarks/` as a committed harness if
  the sprint proceeds (bench-harness.ts conventions: correctness gate,
  median/p95, warm-up).
- Correctness gates for every ticket: 48/48 pins honored, 118/118
  assignments in preference pools, 83/83 scheduled on slim-100, chain-order
  violations only on COMPLETED+pinned actuals (10 known, source-data).
- Per CLAUDE.md: clean-build engine before benchmarking (stale dist
  artifacts), full regression suite before any commit.

## Non-goals

- ILS/Tabu optimizer tuning (that's the solver-comparison bake-off sprint).
- Distribution *quality* (load balance across members) — this sprint is
  about time-to-solve at parity, not better schedules.
