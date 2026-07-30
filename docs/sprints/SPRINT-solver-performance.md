# Sprint — Solver Performance under Preference Pools

**Date opened:** 2026-07-29
**Branch:** `feature/solver-performance` (worktree `ctp-platform-optimization`)
**Baseline commit:** `225617a` (dispatch preference pass + July-16 data refresh)
**Status:** IN PROGRESS — P2 first cut + P1 landed 2026-07-29 (5.5× on slim-100); P4 closed not-reproducible; P3/P5 + scale measurement open

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

## Results so far (2026-07-29, slim-100)

| stage | solve (median of 3) | notes |
| --- | --- | --- |
| baseline (flags off) | 9.9 s | 324 assignStartTimes / 1.74M findEarliest / 1.83M getPCD |
| + ticket-03/04 flags on (`fc1b7c9`) | 8.7 s | never-enabled CODE-OPTIMIZATION-SPRINT fast paths |
| + P1 bound prune (`8be6ee6`) | **1.8 s** | 78 assignStartTimes (8-chain: 192→1 combo), 18K findEarliest (96×), 105K getPCD (17×) |

Placement parity 118/118 identical at every stage; committed parity golden
passes; full suite 1288 green each commit.

P1 landed as an **admissible bound prune**, not the dedup/beam options
below: `startTimes[0].eStartW` is a proven lower bound on a combo's
assigned start (both placement passes floor at the propagated windows), so
with score-ascending iteration, any candidate whose bound >= current best
start can never win the final (assignedStart, chainScore) sort. Exact —
no heuristic. Symmetric pools propagate identical bounds, so the first
unconstrained placement prunes all sibling combos. `evaluateChainAll`
(CTP Query top-K) deliberately untouched. Dedup/beam (below) remain
available if heterogeneous pools ever blunt the bound prune.

**Follow-up:** measure at Stafford scale — stafford-engineering-test is a
REST tenant (needs mock-genius up + real SyncService; the standalone
runner only hydrates file tenants) and solves at the optimizer tier
(non-deterministic), so it's a timing measurement, not a parity gate.

## Tickets (ranked)

### P1 — Combo symmetry pruning — ✅ DONE via bound prune (`8be6ee6`, see above)
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

### P4 — Warm re-solve regression — ✅ CLOSED 2026-07-30: not reproducible
The original observation (solve #1 10.6 s → solve #2 17.4 s, +65%) was a
single run taken under `--cpu-prof` while builds/tests were running
concurrently. Re-measured 2026-07-30 across configs:
- baseline, no profiler, 4 warm solves: 12.7/11.7/12.5/13.0 s (flat)
- baseline, WITH `--cpu-prof`, 3 warm solves: 13.3/12.9/11.9 s (flat)
- P1 build, no profiler, 6 warm solves: 2.29 → 2.02 s (improving, stable)
No accumulation exists; in-process re-solve loops (bake-off harness, daily
replan) are safe. Lesson recorded: never conclude from a single profiled
run — the original spec text drew a +65% claim from one `--cpu-prof`
sample under machine contention.

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
