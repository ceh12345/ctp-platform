# Sprint — Job Shop Technique Bake-off (v1)

**Status:** ✅ v1 code complete on `feature/jobshop-technique-bakeoff` (branched from `feature/dispatch-strategy`, which carries the dispatch plugs; `main` does not)
**Scope:** measurement only — **no new algorithms**
**Consumer:** `SPRINT-solver-comparison.md` (the KPI bake-off). This harness shares that sprint's `deliveryGap.*` contract so research output and the client-facing comparison produce the same numbers.

---

## Why

`strategy-comparison.spec.ts` has been green in CI while printing five identical rows on both demo tenants. It compares `INeighborhoodStrategy` instances by monkey-patching `nextTasksToSchedule` — but `CTPBaseScheduler.schedule()` (`basescheduler.ts:884`) routes to `scheduleChainPass` whenever `hasChains && strategy.chainCompatible`, and the chain pass never calls `nextTasksToSchedule`. The patch is dead code on any tenant with chain data.

The harness wasn't missing. It existed, produced the signal, and nothing consumed it — its assertions check floors ("Chain schedules at least 28 tasks"), not differences.

**Design principle for v1: assert on discrimination, not on thresholds.** A technique set that collapses to one outcome is a finding — either the techniques are equivalent, or the seam meant to differentiate them is broken. It must never pass silently.

---

## The three contracts

**1. Determinism.** A technique must reproduce its schedule byte-for-byte across two runs. Compared via a placement fingerprint. A technique that cannot reproduce itself cannot have a KPI delta attributed to it, so this gates everything else.

**2. Feasibility is a gate, not a metric.** A run that places fewer tasks than the baseline is disqualified before its delivery-gap numbers are compared. Without this a technique "wins" by declining to schedule the hard work — which is exactly what task-level decomposition does on `stafford-slim-100` (see results).

**3. Discrimination.** The harness reports how many distinct schedules the technique set produced, and which techniques are identical to each other.

---

## Design

### Seam: the scheduler, not the neighborhood

A technique sets `appSettings.solverStrategy` and lets the engine route itself, exactly as production does. Nothing is patched, so what the harness measures is what a tenant would get. This is also why the collapse is now visible: the harness records `CTPSolveResult.strategy` (what the engine *says* it ran) next to the requested technique, and on chained data the engine overwrites it to `'Chain'` at `basescheduler.ts:928`.

Techniques with a different loop shape (parallel SGS, shifting bottleneck, two-phase FJSP assignment) will need a scheduler factory rather than a strategy string. `Technique` in `harness/techniques.ts` is the extension point.

### Fingerprint

SHA1 over sorted `(identity, resources, startW, endW)` rows for every scheduled task.

Synthesized tasks (setup / teardown / changeover) are identified **positionally**, not by key. `IdFactory.generateUniqueKey()` (`Factories/uniqueidfactory.ts`) builds keys from `Date.now()` and `Math.random()`, so a key-based fingerprint reports every run as different even when the schedule is identical. Type, resource and times still enter the hash, so a changeover that moves is still detected.

### Chain-violation counting

Pairs where either task is **anchored** (pinned, or `wipstate !== NOT_STARTED`) are excluded. Pass 1 places committed work at its actual position; real shop floors do start operations out of order, so an overlap between two committed tasks is a historical fact, not a scheduling defect. Counting it would blame every technique equally for something none of them decided. On `stafford-slim-100` this took the count from 8 to 1 — 7 were anchored, 1 is genuine and present in every technique including the baseline (**open item**).

### Determinism primitive

`Models/Core/rng.ts` adds `createSeededRandom(seed)` (mulberry32) and a `RandomSource` type. `perturbGraph` now takes an optional `rng`, defaulting to `Math.random` so production behaviour is unchanged. This is groundwork — v1 has no optimizer techniques, but the determinism contract will bind the moment ILS or tabu enters the set.

---

## Files

| File | Role |
|---|---|
| `packages/engine/Models/Core/rng.ts` | **NEW** — seeded RNG (`createSeededRandom`, `RandomSource`) |
| `packages/engine/Engines/Optimization/perturbation.ts` | modified — `perturbGraph(graph, strength, rng?)` |
| `packages/engine/index.ts` | modified — export `Models/Core/rng` |
| `packages/api/src/modules/ctp/__tests__/harness/technique-harness.ts` | **NEW** — run, KPIs, fingerprint, compare, report |
| `packages/api/src/modules/ctp/__tests__/harness/techniques.ts` | **NEW** — v1 technique registry + instance ladder |
| `packages/api/src/modules/ctp/__tests__/technique-bakeoff.spec.ts` | **NEW** — the three contracts, 9 tests |

Run: `npx vitest run packages/api/src/modules/ctp/__tests__/technique-bakeoff.spec.ts` (~58s)

---

## v1 technique set

All eight are production code paths reachable via `solverStrategy`.

**Chain-routed** (`chainCompatible = true` → `scheduleChainPass`): `chain` (baseline), `chain-atc`, `chain-dbr`, `chain-slack`, `chain-duedate`, `chain-firstfit`.

**Task-routed** (`chainCompatible = false` → per-task serial SGS): `task-greedy`, `task-shortest`. Note `basescheduler.ts:396-398` swaps both to `StaticRankPriority` when chains exist, so they share an ordering rule and are expected to match each other.

---

## Results

Measured after merging `main` (solver-performance) into this branch.

```
TENANT: demo-manufacturing            placed  late  lateTot(h)  slack(h)  mkspan(h)  viol    ms
  chain / atc / dbr / slack / dd / cff  25/29     0         0.0    1466.0      21.3     0   2-4
  task-greedy / task-shortest           25/29     0         0.0    1452.5      19.0     0     2

TENANT: acme-outpatient
  chain / atc / dbr / slack / dd / cff  30/39     0         0.0     807.3     193.8     0 25-90
  task-greedy / task-shortest           34/39     0         0.0     826.5     194.5     0 11-12

TENANT: stafford-slim-100
  chain / atc / dbr / slack / dd / cff 115/118    5      5196.2   57046.4    4582.8     1   470
  task-greedy / task-shortest          97/118     4      4598.4   45252.8    4836.0     1   375  DQ

TENANT: stafford-slim-500  (opt-in: HARNESS_SCALE=1)   — 10 techniques
  chain + atc/dbr/slack/dd/cff + edd/woprio  486/495   28   17438.0  483240.6  9511.0  13  5900
  task-greedy / task-shortest                429/495   28   17438.0  397116.2  9511.0   3  1750  DQ

TENANT: stafford-slim-1000  (opt-in)                   — 10 techniques
  chain + atc/dbr/slack/dd/cff + edd/woprio  959/1002  31   21213.9  867443.0  9511.0  27 36000
  task-greedy / task-shortest                819/1002  31   21213.9  710151.2  9511.0   8  3950  DQ
```

**Every tenant: 2 distinct outcomes, regardless of how many techniques are run.**

The `chain-edd` / `chain-woprio` rows are the processing-sequence axis, the one
selection lever that *does* reach `scheduleChainPass` (via `getChainPriority` →
`order.processingRanks[activeSequence]`). Ranks are computed at hydrate and
`group.promiseDate` is populated on every group — the sequence is genuinely
applied, and it changes nothing.

1. **The dispatch plugs are inert on chained data — confirmed on three tenants.** ATC, DBR and Slack produce byte-identical schedules to the baseline, and the engine reports all six as `'Chain'`. The seam sprint shipped a working plug architecture wired to a code path chained tenants never take.

2. **The chain-vs-task answer is data-dependent, not universal.** On `acme-outpatient` task-level places **four more tasks** (34 vs 30) with more slack and is 10–20× faster. On `stafford-slim-100` it places **18 fewer** (97 vs 115) and is disqualified. Chain-atomic earns its cost on real Stafford data and does not on the healthcare tenant.

3. **The feasibility gate did its job on the first run.** On `stafford-slim-100` task-level shows *fewer* late orders (4 vs 5) and less total lateness (4598h vs 5196h) — while placing 18 fewer tasks. Ranked on delivery gap alone it would have looked like a win. That is precisely the failure mode contract 2 exists to prevent.

4. **`IdFactory` is nondeterministic.** Synthesized task keys mix `Date.now()` with `Math.random()`, so solve results are not diffable run-to-run. Worked around in the fingerprint; the underlying issue is untouched and affects anything that wants to compare two landscapes (**open item** — likely relevant to the snapshot sprint).

5. **The solver-performance work is behaviour-preserving — independently confirmed.** Re-running the harness after merging `main` produced *byte-identical fingerprints* on all three original tenants (`4a88073f8254`, `098a520849b4`, `7228c07fd2fd`). The perf branch claimed zero placement diffs; this is a second, independent check via a hash over every `(task, resource, start, end)`. Speed at slim-100 went ~8,500ms → ~470ms per technique (≈18×), which is what made the slim-500 rung practical.

6. **The chain baseline carries 13 precedence violations at slim-500**, against 3 for task-level, both after excluding anchored pairs. Deterministic and identical across all six chain techniques, so structural rather than incidental. Not introduced by this work — surfaced by it (**open item**).

---

## Open items

- **`IdFactory.generateUniqueKey()` nondeterminism** — worked around here, not fixed. Decide whether synthesized keys should be derived from the parent task + type + sequence instead.
- **One genuine chain violation on `stafford-slim-100`**, present in every technique including the baseline. Not introduced by this work; surfaced by it.
- ~~`stafford-slim-500` is in the ladder but not in the spec~~ **RESOLVED** — `main` (solver-performance) merged in. `slim-500` (~6s/technique) and `slim-1000` (~36s/technique) both run as opt-in scale rungs (`HARNESS_SCALE=1`), announced rather than silently skipped.
- **`stafford-engineering-test` (1722 tasks) cannot run yet.** Its data arrives through a live adapter, so with the harness's stub sync it hydrates to ZERO tasks. Gated behind its own `HARNESS_LIVE=1` and left in the spec rather than deleted, so the ladder shows what it cannot yet cover. Needs mock-genius + the real `SyncService`.
- Delivery-gap numbers on `stafford-slim-100` fall back to `lateDueDate`/`dueDate` where `customerDeliveryDate` is unmapped. The fallback chain is documented in `resolveCustomerDate`; commit `8654591` on `feature/solver-performance` re-points this and would change the measured date.

---

## Not in v1 (deliberate)

No new algorithms. No parallel SGS, shifting bottleneck, two-phase FJSP, LNS or CP. v1's job is to tell the truth about what the engine already does — which, per the results above, was more surprising than expected.

Natural next steps, in order: wire the dispatch plugs into chain ordering and watch the collapse test fail (it is the regression net for that fix); then decide score-first vs earliest-start-first combo selection; then add standard benchmark instances (Taillard / Lawrence) for an absolute calibration point.
