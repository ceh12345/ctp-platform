# CODE OPTIMIZATION SPRINT — SCHEDULING ENGINE RUNTIME

> **GOAL:** REMOVE QUADRATIC AND REDUNDANT WORK FROM THE SCHEDULING ENGINE HOT PATHS. EVERY ITEM BELOW IS A LOOP THAT CAN BE SHORT-CIRCUITED, A LOOKUP THAT CAN BE CACHED, OR A DATA STRUCTURE CHOICE THAT CAN BE TIGHTENED.

> **SCOPE:** ENGINE LAYER ONLY (`*engine.ts`, `interval-walker.ts`, `intervals.ts`, `availablematrix.ts`, `disjunctivegraph.ts`, `combinationengine.ts`).

> **OUT OF SCOPE:** API SURFACE, ETL MAPPING, DATA MODEL CHANGES, FORMAT/STYLE.

---

## SPRINT BACKLOG — RANKED BY IMPACT

| # | TICKET | FILE | EFFORT | IMPACT | PRIORITY |
|---|---|---|---|---|---|
| 1 | REPLACE `unionEngine.union` IN `feasibleStartTimes` WITH APPEND-WITH-MERGE | `starttimeengine.ts` | S | HIGH | 🔴 P0 |
| 2 | INDEX `addToFloat` RANGES BY QTY VIA `Map` | `availableengine.ts` | S | HIGH | 🔴 P0 |
| 3 | CACHE STARTTIMES NODES AS TYPED ARRAY + BINARY SEARCH | `chaincontextengine.ts` + `schedulecontext.ts` | M | HIGH | 🔴 P0 |
| 4 | SCORE EACH UNIQUE CONTEXT ONCE PER CHAIN EVAL | `chaincontextengine.ts` | S | HIGH | 🔴 P0 |
| 5 | INVERT `detectLanes` USING RESOURCE→TASKS INDEX | `chaincontextengine.ts` | S | HIGH | 🔴 P0 |
| 6 | REWRITE `crossProductContexts` USING BASEX COUNTER | `chaincontextengine.ts` | M | MED | 🟡 P1 |
| 7 | CACHE PER-CONTEXT RESOURCE-SET HASH | `chaincontextengine.ts` + `schedulecontext.ts` | S | MED | 🟡 P1 |
| 8 | HOIST CUMULATIVE DURATIONS IN `assignStartTimes` | `chaincontextengine.ts` | XS | MED | 🟡 P1 |
| 9 | TAIL-FIRST FAST PATH IN `CTPIntervals.add` | `intervals.ts` | XS | MED | 🟡 P1 |
| 10 | REMOVE `findByName` FROM SCORING INNER LOOP | `scoringengine.ts` | S | MED | 🟡 P1 |
| 11 | FIX `addRunRates` HEAD-ONLY GATE | `availableengine.ts` | XS | LOW (BUG) | 🟡 P1 |
| 12 | USE `avail` PARAM INSTEAD OF `list.index(c)` IN `mergeAvailables` | `availableengine.ts` | XS | MED | 🟡 P1 |
| 13 | VERSION-GATED `savOrig`/`resetOrig` IN SET ENGINE | `setengine.ts` | M | LOW | 🟢 P2 |
| 14 | REPLACE `str.includes` UNIQUENESS IN COMBINATION ENGINE | `combinationengine.ts` | XS | LOW (+BUG FIX) | 🟢 P2 |
| 15 | USE `Set<number>` IN `byResource` MAP IN DISJUNCTIVE GRAPH | `disjunctivegraph.ts` | XS | LOW | 🟢 P2 |
| 16 | CACHE `landscape.tasks.getEntity` IN `addToStateChange` | `availableengine.ts` | XS | COND | 🟢 P2 |

LEGEND — EFFORT: XS (<1HR), S (1–3HR), M (HALF DAY), L (FULL DAY)
LEGEND — IMPACT: HIGH = INNER LOOP / O(N²) REMOVAL, MED = WARM PATH, LOW = COLD PATH OR CONSTANT FACTOR
LEGEND — COND: CONDITIONAL ON `getEntity` BEING NON-O(1)

---

# 🔴 P0 — INNER LOOP / QUADRATIC FIXES

## TICKET 1 — `feasibleStartTimes` APPEND-WITH-MERGE (+ LATENT UNION BUG FIX)

**FILE:** `starttimeengine.ts` (LINES ~89–115), `setengine.ts` (LINES ~782–788)

**PROBLEM (PERF):**
```ts
if (st <= et)
  theEngines.unionEngine.union(results, new CTPInterval(st, et));
```
`union` WALKS `results` FROM HEAD ON EVERY CALL. INTERVALS ARE BUILT IN START-TIME ORDER ALREADY (THE OUTER WALK IS `iPtr = iPtr.next` THROUGH A SORTED LIST), SO THE GENERAL UNION IS WASTED WORK.

**COMPLEXITY:** O(M²) PER RANGE → O(R · M²) PER TASK CONTEXT → MULTIPLIED BY CONTEXTS PER SOLVE.

**PROBLEM (LATENT BUG IN `CTPUnionSetEngine.union`):**
THE PARTIAL-RIGHT-OVERLAP BRANCH AT `setengine.ts:782–788` SILENTLY DROPS DATA WHEN THE NEW INTERVAL HAS A RIGHT-OVERHANG PAST THE LAST EXISTING NODE:

```
input list: [10, 20]
new b:      [15, 30]
expected:   [10, 30]
actual:     [10, 20]      ← b's [20,30] remainder is lost
```

THE BRANCH ADVANCES `startW = aPtr.data.endW; aPtr = aPtr.next`. WHEN `aPtr.next` IS NULL THE LOOP EXITS WITHOUT INSERTING THE REMAINDER. SAME FOR ADJACENT-TOUCHING (`startW === aPtr.endW` AT TAIL) — IT FALLS THROUGH THE `else` AT LINE 801–803 AND IS DROPPED.

THE ONLY LIVE CALLER OF `union` IS `feasibleStartTimes` (THE CALL IN `statechangeerengine.ts:108` IS INSIDE A `/* */` BLOCK). WITHIN A SINGLE `aRangePtr` ITERATION INPUTS ARE NON-OVERLAPPING, BUT **ACROSS** OUTER ITERATIONS RANGES CAN PRODUCE OVERLAPPING SEGMENTS — SO THE BUG IS REACHABLE IN PRODUCTION.

**FIX (PERF) — INLINE TAIL-MERGE:**
```ts
const tail = results.tail;
if (tail && tail.data.endW >= st) {
  if (et > tail.data.endW) tail.data.endW = et;
} else {
  results.insertAtEnd(new CTPInterval(st, et));
}
```

**FIX (BUG) — EXTEND THE PARTIAL-OVERLAP BRANCH IN `CTPUnionSetEngine.union`:**
WHEN THE BRANCH FIRES AND `!aPtr.next && endW > aPtr.endW`, EXTEND `aPtr.endW = endW` AND TERMINATE THE LOOP INSTEAD OF ADVANCING. ALSO HANDLE ADJACENT-TOUCHING (`startW === aPtr.endW`) AT TAIL BY EXTENDING RATHER THAN FALLING THROUGH.

**ACCEPTANCE:**
- `feasibleStartTimes` OUTPUT IDENTICAL TO REGRESSION CASES (AFTER UNION BUG FIX) ON ALL FIXTURES INCLUDING OVERLAPPING-BOUNDARY SEGMENTS
- `CTPUnionSetEngine.union` ON `[10,20] + [15,30]` PRODUCES `[10,30]` (NEW VITEST TEST)
- `CTPUnionSetEngine.union` ON `[10,20] + [20,30]` PRODUCES `[10,30]` (ADJACENT-TOUCHING, NEW VITEST TEST)
- ALL EXISTING `setengine.test.ts` CASES STILL PASS, EXCEPT THREE CASES THAT PREVIOUSLY *CODIFIED* THE BUG AS EXPECTED BEHAVIOR (THE COMMENTS ON THOSE CASES ACKNOWLEDGED IT). THESE THREE ARE UPDATED IN THE SAME PR TO ASSERT THE CORRECT POST-FIX OUTPUT:
  - `absorbs overlap within existing interval`: was `[0,30]`, now `[0,50]`
  - `adjacent interval at boundary`: was `[0,20]` (not merged), now `[0,40]` (merged)
  - `interval containing existing — expands startW only`: was `[0,50]`, now `[0,100]`
- BENCHMARK: ≥ 5X SPEEDUP ON A TASK WITH 200+ FEASIBLE SEGMENTS
- THE HARNESS CORRECTNESS GATE PASSES ON A FIXTURE THAT EXERCISES THE OVERLAP BRANCH

---

## TICKET 2 — INDEX `addToFloat` RANGES BY QTY ⛔ INVESTIGATED, DISMISSED

**FILE:** `availableengine.ts` (LINES ~180–210)

**STATUS:** Investigated end-to-end with a sibling-method A/B bench against the existing implementation. No measurable speedup at any fixture scale tested; marginally *slower* at production-realistic K. Engine reverted in the same investigation cycle. See `packages/engine/benchmarks/results/ticket-02.json` and `ticket-02-stress.json` for the committed evidence.

**ORIGINAL PROBLEM (as written):**
```ts
for (let a of ranges) {
  if (a.qty == this.cPtr.data.qty) { found = true; break; }
}
```
Linear scan over `ranges[]` per position of `cPtr`. Estimated O(N · K) per `addToFloat`, claimed O(N² · K) per resource recalc.

**WHY THE FIX DID NOT MOVE THE NEEDLE:**
1. **The spec's complexity model was wrong about call frequency.** `addToFloat` only fires when `aPtr.prev === null || aPtr.data.qty === null || (aPtr.data.qty <= 0 && !flowAround)`. In any realistic calendar (all qty>0, `flowAround()` hardcoded to `false` at `baseengine.ts:57`), `addToFloat` runs **once** per `calculate()` — not N times. So the spec's `O(N · K)` ceiling is **per resource recalc**, not per outer iteration. The outer `N` factor never materialized.
2. **Within `addToFloat`, the scan is not the bottleneck.** The dPtr inner loop walks the entire window once per fresh-`r` creation (= K times), giving O(K · W). The scan gives the same O(K · W). They are equal in complexity; the Map can at best ~halve `addToFloat`'s work, not 10× it.
3. **`addToFloat` is a small fraction of `calculate()` total.** Per-iteration timing is dominated by per-node `addToFixed`/`addToUntracked` calls + their `list.add` sorted-insertions (which are actually O(1) per call on sorted input — see `CTPIntervals.add` line 140 fast-path via `atOrAfterStartTime`'s tail-check at `intervals.ts:26`).
4. **Constant factors invert the win at production K.** Realistic per-resource cardinality is ~50–500 intervals × ~1–5 distinct qty levels. At K=5, a JIT'd `for...of` over 5 numbers is faster than `Map.get` + hash + bucket lookup. The Map *only starts to break even around K≈20-50*; below that it is consistently slower.

**MEASURED RESULTS** (committed JSON artifacts):

| Fixture | Scope | Speedup | Verdict |
|---|---|---|---|
| `ticket-02.json` (1000 × 40) | `calculate()` end-to-end, calendar-style | ×1.02 | Within run-to-run noise of ×1.0 |
| `ticket-02-stress.json` (3000 × 300) | `calculate()` end-to-end, deliberately scaled past realistic K | ×0.978 | Marginally *slower* (Map allocation + hash overhead) |

Both fixtures: correctness gate PASSed (Map and linear-scan produce deep-equal `FLOAT` ranges).

Earlier stress attempts: 10000×1000 OOM'd in the harness's 1000-iter heap-delta phase; 5000×500 was killed at ~25-min wall-clock projection.

**REALISTIC PRODUCTION SCALE** (Stafford-class workload, confirmed with stakeholder): 100 resources × 30 tasks avg × 2-week horizon → per-resource ~50–500 intervals × ~1–5 distinct qtys × 100 `calculate()` invocations totalling ~1–2 s. T2 would push this slightly upward, not down.

**DECISION:** Engine reverted to pre-T2 state. Bench files and JSON artifacts retained as evidence so a future contributor doesn't re-propose this optimization without first reading the analysis.

**NOT-INVALIDATED SUBSIDIARY FINDINGS** (still worth a follow-up, separate ticket if pursued):
- The existing `addToFloat` has a latent foot-gun where `r` stays as last-created-range when `found===true` (works by accident via the `r.processed` gate; the spec's proposed fix would have cleaned this up). Pure refactor, no perf benefit. Not in this sprint.
- `addToFixed`/`addToUntracked` together run N times per `calculate()` and consume the majority of wall-clock. If a real recalc-cycle speedup is wanted, that's where the budget actually is — but `list.add` is already O(1)-per-call on sorted input, so the win would come from a different shape entirely (e.g. batching the index population, or eliding the index when the matrix hasn't been mutated).

---

## TICKET 3 — STARTTIMES NODE CACHE WITH BINARY SEARCH ✅ SHIPPED (NARROWED SCOPE)

**FILE:** `chaincontextengine.ts` + `schedulecontext.ts`

**STATUS:** Shipped with **narrowed scope** — the 3 find-pattern helpers got the binary-search fast path; the 3 iterate-all helpers stayed on linked-list walks after measurement showed their typed-array branch added cache complexity without proportional return. Evidence: `packages/engine/benchmarks/results/ticket-03.json`.

**KEPT** (binary-search fast path):
- `isWithinStartTimeNode` — multiple calls per primary candidate
- `getAssignedProcessChangeDuration` — per successor per candidate
- `findStartTimeNode` — per task per commit

**REVERTED** (kept on linked-list walk):
- `computeContextFeasibleDuration` — sums all nodes (binary search doesn't apply)
- `findEarliestFeasibleStart` — iterates all nodes (typed-array win was ~×2 local, not worth cache surface area)
- `findLatestFeasibleStartForPred` — same as above

**FIX SHAPE:**
- `StartTimesCache` interface on `ScheduleContext` with 3 Float64Arrays: `eStart`, `lStart`, `pcd` (originally proposed 5 arrays + scalars; trimmed to what the 3 kept helpers actually read).
- `ChainContextEngine.getStCache(ctx)` lazily builds the cache on first access. Cache validity is checked via `ctx._stCacheVersion === cache.version`.
- A `useStartTimesCache` flag gates dispatch during the bench A/B window; the cleanup commit (separate, later) will remove it and replace the head-walk fallback with the cached-only path.

**INVALIDATION (single in-cycle mutation site):**
- `truncateContextStartTimes` (`chaincontextengine.ts:762`) bumps `ctx._stCacheVersion` before mutating. All other 5 mutation sites for `slot.startTimes` (`cadencefilter`, `computeschedulecontexts`, `commonstarttimes` × 2, `evaluator` unschedule) run outside the evaluate-chain window so cache stays trivially fresh from initial build.

**MEASURED SCALING** (synthetic ChainContextCombo, FIXED duration → calendar-independent, mutable-fixture reused across iterations so build cost ≈ 0):

| Chain length | N startTimes/ctx | Speedup |
|---|---|---|
| 5 | 50 | ×1.16 |
| 5 | 200 | ×1.49 |
| 5 | 500 | ×1.78 |
| 11 | 50 | ×1.20 |
| 11 | 200 | ×1.63 |
| 11 | 500 | **×1.75** ← committed artifact |

Realistic production read (per-context N typically 30-150 for Stafford-class): expected speedup **×1.2-1.5×**, scaling positively with workload size. Correctness gate (deep-equal on `assignedStart`/`assignedEnd` across all chain tasks): 6/6 PASS across the entire table.

**WHY THE SPEC'S ≥×3 TARGET WAS NOT MET:**
- The 3 find-pattern helpers gave ~×7 on individual lookups at N=50, but their share of `assignStartTimes` end-to-end wall-clock is bounded by other work (`workingEndForwardW` calls, candidate-set ops, placement loops). At N=50 the helpers are ~10% of total; at N=500 they reach ~50%.
- Removing the iterate-all branches gave up ~25% of the high-N gain (was ×2.30 with all 6 helpers at 5-step N=500) in exchange for 40% less cache memory and a simpler invalidation surface.

**ACCEPTANCE:**
- ✅ All 1063 vitest tests pass; no regressions from cache plumbing or dispatch branches.
- ✅ Strict engine `tsc --noEmit -p packages/engine/tsconfig.json` clean.
- ✅ Bench correctness gate PASS at every measured fixture (5-step & 11-step × N=50/200/500).
- ✅ Speedup ≥ ×1.5 met at N≥200 with 5-step or larger chains; below that at small N=50 (workload-conditional).
- ✅ Cache invalidation verified to fire at the single in-cycle mutation site.

---

## TICKET 4 — SCORE EACH UNIQUE CONTEXT ONCE PER CHAIN EVAL

**FILE:** `chaincontextengine.ts` (LINES 796–823, `scoreChainCombos`)

**PROBLEM:**
```ts
for (const combo of combos) {
  const savedScores = combo.contexts.map(ctx => ctx.blendedScore.score);
  scoringEngine.computeScores(landscape, combo.contexts, scoring);
  // ... sum, restore ...
}
```
IF A CONTEXT APPEARS IN N COMBOS, ITS SCORE IS COMPUTED N TIMES. CONTEXTS ARE FREELY SHARED ACROSS COMBOS BY DESIGN.

**COMPLEXITY:** O(COMBOS · CONTEXTS_PER_COMBO · SCORING_RULES). REDUCIBLE TO O(UNIQUE_CONTEXTS · SCORING_RULES + COMBOS · CONTEXTS_PER_COMBO).

**FIX:**
```ts
private scoreChainCombos(combos, landscape, scoring) {
  // Step 1: collect unique contexts
  const uniqueSet = new Set<ScheduleContext>();
  for (const c of combos) for (const ctx of c.contexts) uniqueSet.add(ctx);
  const unique = Array.from(uniqueSet);

  // Step 2: save originals so we can restore (contexts may live beyond this call)
  const saved = new Map<ScheduleContext, number>();
  for (const ctx of unique) saved.set(ctx, ctx.blendedScore.score);

  // Step 3: score once
  const engine = new ScoringEngine();
  engine.computeScores(landscape, unique, scoring);
  const scoreMap = new Map<ScheduleContext, number>();
  for (const ctx of unique) scoreMap.set(ctx, ctx.blendedScore.score);

  // Step 4: aggregate per combo (no recomputation)
  for (const combo of combos) {
    let chainScore = 0;
    for (const ctx of combo.contexts) chainScore += scoreMap.get(ctx) ?? 0;
    chainScore += (combo.totalGap / 60) * 0.1; // gap penalty
    combo.chainScore = chainScore;
  }

  // Step 5: restore
  for (const [ctx, s] of saved) ctx.blendedScore.score = s;
}
```

**ACCEPTANCE:**
- COMBO `chainScore` VALUES IDENTICAL TO PRIOR IMPLEMENTATION ON REGRESSION CASES
- BENCHMARK: ≥ 4X SPEEDUP ON A CHAIN WITH 500 COMBOS DRAWING FROM 20 UNIQUE CONTEXTS

---

## TICKET 5 — INVERT `detectLanes` WITH RESOURCE-INDEX

**FILE:** `chaincontextengine.ts` (LINES 313–376)

**PROBLEM:**
TRIPLE-NESTED LOOP O(T² · P²) PLUS A FULL TASK SCAN INSIDE EVERY OVERLAP. `Array.includes` ON `prefKeys`.

**COMPLEXITY:** O(T² · P² + T · OVERLAPS). EXAMPLE: 10-TASK CHAIN, 5 PREFS EACH = ~2,500 INCLUSION CHECKS.

**FIX — BUILD `Map<resourceKey, Set<taskKey>>` ONCE:**
```ts
public detectLanes(tasks: CTPTaskList): LaneDefinition[] {
  // PHASE A — collect primary prefs per task (unchanged)
  const primaryByTask = new Map<string, { index: number; prefKeys: string[] }[]>();
  tasks.forEach(task => {
    const primaries: { index: number; prefKeys: string[] }[] = [];
    task.capacityResources?.forEach((tr, idx) => {
      if (tr.isPrimary) {
        const prefKeys = tr.getEffectivePreferences().map(p => p.resourceKey);
        if (tr.resource && prefKeys.length === 0) prefKeys.push(tr.resource);
        primaries.push({ index: idx, prefKeys });
      }
    });
    primaryByTask.set(task.key, primaries);
  });

  // PHASE B — invert: resource → tasks that can use it (with which lane index)
  const resourceToTasks = new Map<string, { taskKey: string; index: number }[]>();
  for (const [taskKey, prims] of primaryByTask) {
    for (const p of prims) {
      for (const k of p.prefKeys) {
        let arr = resourceToTasks.get(k);
        if (!arr) { arr = []; resourceToTasks.set(k, arr); }
        arr.push({ taskKey, index: p.index });
      }
    }
  }

  // PHASE C — group resources whose task sets are equal (or overlap by policy)
  const lanes: LaneDefinition[] = [];
  const visited = new Set<string>();
  for (const [resourceKey, taskRefs] of resourceToTasks) {
    if (taskRefs.length < 2) continue; // not a lane unless 2+ tasks share it
    const taskKeys = taskRefs.map(r => r.taskKey).sort();
    const laneKey = taskKeys.join(',');
    if (visited.has(laneKey)) continue;
    visited.add(laneKey);

    // collect all resource keys those tasks share
    const sharedResources = new Set<string>([resourceKey]);
    // ... walk taskRefs to find other resources shared by the SAME taskKey set ...

    lanes.push({
      laneIndex: taskRefs[0].index,
      taskKeys,
      resourceKeys: Array.from(sharedResources),
    });
  }
  return lanes;
}
```

**ACCEPTANCE:**
- LANE DEFINITIONS EQUAL TO PRIOR IMPLEMENTATION ON 5+ TEST CHAINS
- BENCHMARK: ≥ 8X SPEEDUP ON A 10-TASK / 5-PREF CHAIN
- VERIFY MULTI-RESOURCE LANE GROUPING STILL WORKS (`resourceKeys` ARRAY MATCHES)

---

# 🟡 P1 — WARM PATH OPTIMIZATIONS

## TICKET 6 — REWRITE `crossProductContexts` WITH BASEX COUNTER

**FILE:** `chaincontextengine.ts` (LINES 554–571)

**PROBLEM:**
EVERY LEVEL ALLOCATES `[...existing, ctx]`. SPREAD IS O(I) PER COMBO. NO PRE-ALLOCATION.

**FIX — REUSE BASEX FROM `combinationengine.ts`:**
```ts
private crossProductContexts(sets: ScheduleContext[][]): ScheduleContext[][] {
  if (sets.length === 0) return [];
  let total = 1;
  for (const s of sets) {
    if (s.length === 0) return [];
    total *= s.length;
  }

  const out = new Array<ScheduleContext[]>(total);
  const counters = new Array<number>(sets.length).fill(0);

  for (let n = 0; n < total; n++) {
    const row = new Array<ScheduleContext>(sets.length);
    for (let i = 0; i < sets.length; i++) row[i] = sets[i][counters[i]];
    out[n] = row;

    // increment with carry
    for (let i = sets.length - 1; i >= 0; i--) {
      if (++counters[i] < sets[i].length) break;
      counters[i] = 0;
    }
  }
  return out;
}
```

**BONUS:** ALLOWS A LATER REFINEMENT — STREAMING ENUMERATION INSTEAD OF MATERIALIZING THE ARRAY (USEFUL IF `preCapContextSets` STILL UNDERSHOOTS).

**ACCEPTANCE:**
- IDENTICAL OUTPUT ON SETS OF SIZE [1..10] × [1..10] × [1..5]
- BENCHMARK: ≥ 2X SPEEDUP ON 4-SET CROSS-PRODUCT OF SIZE 8 EACH (4096 COMBOS)

---

## TICKET 7 — CACHE PER-CONTEXT RESOURCE-SET HASH

**FILE:** `chaincontextengine.ts` (LINES 269–277, dedup BLOCK IN `evaluateChainAll`)

**PROBLEM:**
```ts
const resourceHash = combo.contexts.map(ctx => {
  const keys: string[] = [];
  ctx.slot.resources?.forEach(r => { if (r.resource) keys.push(r.resource.key); });
  return keys.sort().join('+');
}).join('|');
```
RECOMPUTED PER COMBO. SORT IS THE OBVIOUS WASTE — RESOURCE SET IS FIXED PER CONTEXT.

**FIX — LAZY FIELD ON `ScheduleContext`:**
```ts
class ScheduleContext {
  private _resourceHash: string | null = null;
  get resourceHash(): string {
    if (this._resourceHash === null) {
      const keys: string[] = [];
      this.slot.resources?.forEach(r => { if (r.resource) keys.push(r.resource.key); });
      keys.sort();
      this._resourceHash = keys.join('+');
    }
    return this._resourceHash;
  }
}
```
THEN:
```ts
const resourceHash = combo.contexts.map(c => c.resourceHash).join('|');
```

**INVALIDATION:** RESET `_resourceHash = null` IF SLOT RESOURCES CHANGE (TIE TO RECOMPUTE PATH).

**ACCEPTANCE:**
- DEDUP RESULTS IDENTICAL
- BENCHMARK: ≥ 3X SPEEDUP IN DEDUP PHASE FOR LARGE COMBO SETS

---

## TICKET 8 — HOIST CUMULATIVE DURATIONS IN `assignStartTimes`

**FILE:** `chaincontextengine.ts` (LINES 859–896)

**PROBLEM:**
```ts
for (let p = 0; p < primaryIndex; p++) {
  while (pNode) {
    let targetStart = pNode.data.eStartW;
    for (let k = p; k < primaryIndex; k++) {
      const dur = combo.contexts[k].task.duration?.duration() ?? 0;  // RECOMPUTED PER pNode
      const offset = this.getAssignedProcessChangeDuration(combo.contexts[k], targetStart);
      targetStart = targetStart + dur + offset;
    }
  }
}
```

**FIX — PRECOMPUTE DURATIONS ONCE PER COMBO:**
```ts
// before predecessor walk
const durations = combo.contexts.map(c => c.task.duration?.duration() ?? 0);

for (let p = 0; p < primaryIndex; p++) {
  while (pNode) {
    let targetStart = pNode.data.eStartW;
    for (let k = p; k < primaryIndex; k++) {
      const offset = this.getAssignedProcessChangeDuration(combo.contexts[k], targetStart);
      targetStart += durations[k] + offset;
    }
  }
}
```
COMBINE WITH TICKET 3 SO `getAssignedProcessChangeDuration` IS O(LOG N) INSTEAD OF O(N).

**ACCEPTANCE:**
- IDENTICAL `assignedStart`/`assignedEnd` OUTPUT
- NO BENCHMARK NEEDED — CORRECTNESS-PRESERVING REFACTOR

---

## TICKET 9 — TAIL-FIRST FAST PATH IN `CTPIntervals.add` ⛔ INVESTIGATED, DISMISSED

**FILE:** `intervals.ts` (LINES 22–36, 140–146)

**STATUS:** Investigated via 15-min code read + 3-pattern probe bench. T9 is effectively a no-op for every production caller traced; the existing `atOrAfterStartTime` already has two fast-paths that together cover the input shapes those callers produce. The spec's proposed change as written also has a correctness bug on tied `startW`. No engine change landed.

**THE PREMISE WAS WRONG: TWO FAST-PATHS ALREADY EXIST**

Reading `intervals.ts:22–36`:

1. **Tail-disjoint fast-path** (line 26): `if (this.tail && startW > this.tail.data.endW) return null;` → caller does `insertAtEnd` in O(1). Fires when new interval is strictly after the tail.
2. **Head-side implicit exit** (lines 28–29): the walk `while (i && i.data.startW < startW) i = i.next` exits immediately when `new.startW <= head.data.startW`. Returns head; caller does `insertBefore(head)` in O(1). Fires when new interval starts at or before the current head.

Combined, these two fast-paths cover *both* monotone insertion orders: ascending non-overlapping (#1) and descending of any kind (#2).

**WHAT T9 ACTUALLY EXPANDS COVERAGE FOR**

T9's proposed `startW >= tail.startW` adds a *third* fast-path: `tail.startW <= startW <= tail.endW` (ascending with tail overlap). This is the only input shape the existing code walks from head for.

**MEASURED IMPACT** (3-pattern probe, N=1000 inserts × 200 iterations, current vs T9-with-strict-`>`):

| Input pattern | Production caller? | Old | New | Speedup |
|---|---|---|---|---|
| Ascending non-overlapping | `addToFloat` range push (line 284) | 8.52 ms | 8.58 ms | ×0.99 |
| Descending | `addToFixed` (line 164), `addToUntracked` (line 371) | 8.49 ms | 8.59 ms | ×0.99 |
| Ascending with tail overlap | None traced | 10.09 ms | 8.90 ms | **×1.13** |

All three correctness=PASS.

**CALLER SURVEY** (production paths grep'd via `\.add\(new CTP`):

- `availableengine.ts:164` (`addToFixed`): aPtr walks backward via `moveABackward` → descending startW → covered by head-side fast-path.
- `availableengine.ts:284` (`addToFloat` final `ranges.forEach`): ranges built during forward cPtr walk → ascending non-overlapping → covered by tail-disjoint fast-path.
- `availableengine.ts:312, 340` (`addToFloat1`, an alternate float method): same pattern as 284.
- `availableengine.ts:371` (`addToUntracked`): same as 164.
- `commonstarttimes.ts:229`: single-shot `feasible.startTimes?.add(...)` in the pure-duration branch — not a hot loop, perf irrelevant.

No production caller produces the ascending-with-tail-overlap pattern. The ×1.13 win T9 buys has no consumer.

**CORRECTNESS BUG IN THE SPEC'S `>=` FORMULATION**

The original spec wrote:
```ts
if (this.tail && node.startW >= this.tail.data.startW) { this.insertAtEnd(node); ... }
```

`atOrAfterStartTime` (lines 30–34) orders tied `startW` by ascending `endW`. The spec's `>=` would put a new node at the tail regardless of `endW`, breaking that ordering. The strict-`>` form (used in the probe above) is correctness-preserving but the spec needs amending if T9 is ever revisited.

**DECISION:** No engine change. Section retained as evidence so a future contributor doesn't reproduce the investigation. Revisit if a profile surfaces a caller producing ascending-with-tail-overlap input.

---

## TICKET 10 — REMOVE `findByName` FROM SCORING INNER LOOP

**FILE:** `scoringengine.ts` (LINE 75)

**PROBLEM:**
```ts
rulesToScore.forEach((rule) => {
  let i = schedule.scores.findByName(rule.name);  // O(R) per access if scores is a list
  // ...
});
```
INSIDE `schedules.forEach`. O(R²) PER SCHEDULE.

**FIX — POPULATE `Map<string, Score>` IN THE FIRST PASS:**
```ts
schedules.forEach((schedule) => {
  schedule.scores.clear();
  const lookup = new Map<string, IScore>();  // local map per schedule
  if (schedule.slot?.hasStartTimes()) {
    rulesToScore.forEach((rule) => {
      try {
        const score = rule.scoring.compute(schedule);
        schedule.scores.add(score);
        lookup.set(rule.name, score);
        if (score.score < rule.min) rule.min = score.score;
        if (score.score > rule.max) rule.max = score.score;
      } catch { /* skip */ }
    });
  }
  (schedule as any)._scoreLookup = lookup;  // or proper typed field
});

// blend phase uses the map
schedules.forEach((schedule) => {
  // ...
  rulesToScore.forEach((rule) => {
    const i = (schedule as any)._scoreLookup?.get(rule.name);
    // ...
  });
});
```

CLEANER OPTION: ADD A `findByName`-LIKE METHOD ON `CTPScores` THAT IS O(1) BY BACKING IT WITH A `Map`.

**ACCEPTANCE:**
- BLEND SCORES IDENTICAL
- BENCHMARK: ≥ 2X SPEEDUP ON SCHEDULES WITH 8+ SCORING RULES

---

## TICKET 11 — FIX `addRunRates` HEAD-ONLY GATE

**FILE:** `availableengine.ts` (LINES 432–445)

**PROBLEM (BUG, NOT JUST PERF):**
```ts
if (i && i.data.runRate !== null) {  // gates ENTIRE merge on first node only
  while (i && j) { ... }
}
```
IF THE FIRST `staticOriginal` NODE HAS NULL `runRate` BUT LATER NODES HAVE NON-NULL RUNRATES, THE WHOLE MERGE IS SKIPPED.

**FIX:**
```ts
addRunRates(): void {
  if (!this.matrix?.staticOriginal || !this.matrix.staticAvailable) return;
  let i = this.matrix.staticOriginal.head;
  let j = this.matrix.staticAvailable.head;
  while (j) {
    while (i && i.data.startW < j.data.startW) i = i.next;
    if (!i) return;
    if (i.data.startW <= j.data.endW && i.data.runRate !== null) {
      j.data.runRate = i.data.runRate;
    }
    j = j.next;
  }
}
```

**ACCEPTANCE:**
- WRITE A REGRESSION TEST: ORIGINAL WITH `[null, runRate=2, runRate=3]` AND VERIFY AVAILABLE PICKS UP `2` AND `3`

---

## TICKET 12 — USE `avail` PARAM IN `mergeAvailables`

**FILE:** `availableengine.ts` (LINES 522–534)

**PROBLEM:**
```ts
list.forEach(function (avail) {
  if (c == 0 && list.index(0) !== undefined) intermediateResult = list.index(0);
  else if (...) {
    results = theSetEngines.intersectEngine.execute(list.index(c), intermediateResult);
  }
  c = c + 1;
});
```
`list.index(c)` IS LIKELY O(N) FOR A LINKED LIST. THE LOOP IS O(N²).

**FIX:**
```ts
public mergeAvailables(list: List<CTPAvailable>): CTPAvailable | null {
  let intermediate: CTPAvailable | null = null;
  let results: CTPAvailable | null = null;
  let c = 0;
  list.forEach((avail) => {
    if (c === 0) {
      intermediate = avail;
    } else if (intermediate && intermediate.size() >= 1) {
      results = theSetEngines.intersectEngine.execute(avail, intermediate);
      intermediate = results;
    }
    c++;
  });
  return results;
}
```

**ACCEPTANCE:**
- IDENTICAL MERGE OUTPUT ON A 5+ AVAILABLE-LIST INPUT
- COMPLEXITY DROPS FROM O(N²) TO O(N)

---

# 🟢 P2 — CLEANUP / SMALLER WINS

## TICKET 13 — VERSION-GATED `savOrig`/`resetOrig` IN SET ENGINE

**FILE:** `setengine.ts` (LINES 51–75, 76–88, 666–668)

**PROBLEM:**
EVERY `execute()` CALL WALKS BOTH `a` AND `b` LISTS TWICE (SAVE BEFORE, RESET AFTER) JUST TO PRESERVE `origStartW`/`origEndW`/`origQty`. WHEN LISTS ARE NOT MUTATED IN THE CURRENT CALL, THIS IS PURE OVERHEAD.

**FIX — VERSION COUNTER ON `CTPIntervals` AND PER-NODE:**
```ts
class CTPIntervals { /* ... */ public version = 0; }
class CTPInterval { public origVersion = 0; }
```
- ON `savOrig`: ONLY SAVE NODES WHERE `node.origVersion !== list.version`. UPDATE `origVersion = list.version` AFTER SAVE.
- ON `resetOrig`: WALK ONLY DIRTY NODES. SET ENGINE BUMPS `list.version` IF IT MUTATED ANY NODE.

ALTERNATIVE (SIMPLER): IN OPERATIONS THAT DON'T MUTATE INPUTS (UNION, INTERSECT WHEN USED CORRECTLY), SKIP `savOrig` ALTOGETHER VIA A FLAG.

**ACCEPTANCE:**
- ALL EXISTING SET-ENGINE TESTS PASS
- BENCHMARK: NEUTRAL OR FASTER ON SMALL LISTS, ≥ 2X FASTER ON 1000+-NODE LISTS

---

## TICKET 14 — REPLACE `str.includes` UNIQUENESS

**FILE:** `combinationengine.ts` (`resourcecombinations` METHOD)

**PROBLEM (BUG + PERF):**
```ts
if (str.includes(combo[i].resourceKey)) { add = false; break; }
str = str + combo[i].resourceKey + ",";
```
- `"r1"` MATCHES INSIDE `"r10,r11"` — LATENT FALSE-POSITIVE BUG
- REPEATED STRING CONCAT IS O(N²) IN CHARACTERS

**FIX:**
```ts
const seen = new Set<string>();
let add = true;
for (let i = 0; i < combo.length; i++) {
  if (seen.has(combo[i].resourceKey)) { add = false; break; }
  seen.add(combo[i].resourceKey);
}
```

**ACCEPTANCE:**
- ADD TEST: `[["r1"], ["r10"]]` SHOULD PRODUCE `[["r1","r10"]]` AS UNIQUE (CURRENTLY DROPPED)
- ALL EXISTING UNIQUENESS TESTS STILL PASS

---

## TICKET 15 — `Set<number>` IN DISJUNCTIVE GRAPH `byResource`

**FILE:** `disjunctivegraph.ts` (LINES 80–88, 113–123)

**PROBLEM:**
```ts
graph.byResource.get(rk)!.push(nodeIdx);   // duplicates allowed
// later:
const unique = [...new Set(nodeIndices)];   // dedupe at use time
const sorted = unique.sort((a, b) => ...);
```

**FIX — DEDUPE AT INSERT TIME, OR USE TYPED ARRAY OF NODE INDICES + SORT ONCE:**
```ts
private byResource = new Map<string, Set<number>>();
// ...
if (!graph.byResource.has(rk)) graph.byResource.set(rk, new Set());
graph.byResource.get(rk)!.add(nodeIdx);
// ...
for (const [resourceKey, nodeIdxSet] of graph.byResource) {
  const sorted = Array.from(nodeIdxSet).sort((a, b) =>
    graph.nodes[a].startW - graph.nodes[b].startW
  );
  // ...
}
```

**ACCEPTANCE:**
- SAME EDGES PRODUCED, NO DUPLICATES
- MARGINAL SPEEDUP ON RESOURCES WITH MANY ASSIGNMENTS

---

## TICKET 16 — CACHE `getEntity` IN `addToStateChange`

**FILE:** `availableengine.ts` (LINES 102–108)

**CONDITIONAL — ONLY IF `landscape.tasks.getEntity` IS NOT O(1).**

**PROBLEM:**
```ts
const task = this.landscape.tasks.getEntity(aPtr.data.name);
const prevTask = this.landscape.tasks.getEntity(lastProcessPtr.data.name);
```
RUNS PER ASSIGNMENT IN THE OUTER WALK. IF `getEntity` IS HASHED, THIS IS FINE — IGNORE. IF IT'S A LIST SCAN, IT'S O(N²).

**ACTION:**
1. AUDIT `CTPTasks.getEntity` IN `task.ts` — CONFIRM IT'S `Map`-BACKED
2. IF YES: CLOSE TICKET AS NO-OP
3. IF NO: ESCALATE TO P1 — ADD `Map<string, CTPTask>` BACKING

**ACCEPTANCE:**
- AUDIT NOTE COMMITTED
- IF FIX NEEDED: BENCHMARK ≥ 5X SPEEDUP ON LANDSCAPES WITH 1000+ TASKS

---

# CACHE LAYER — UNIFIED INVALIDATION DESIGN

ACROSS THE TICKETS ABOVE, THE FOLLOWING CACHES SHARE A COMMON PATTERN. STANDARDIZE BEFORE LANDING TO AVOID DRIFT.

| CACHE | LIFETIME | KEY | VALUE | INVALIDATION TRIGGER |
|---|---|---|---|---|
| STARTTIMES NODE ARRAYS | UNTIL CONTEXT RECOMPUTE | `ScheduleContext` | TYPED ARRAYS | `updateRecomputeByTask` |
| RESOURCE-SET HASH | UNTIL `slot.resources` CHANGES | `ScheduleContext` | `string` | SLOT RECONFIGURATION |
| CUMULATIVE DURATIONS | PER-COMBO | INDEX `i` | `number[]` | END OF `assignStartTimes` |
| UNIQUE-CONTEXT SCORES | PER `evaluateChain` CALL | `ScheduleContext` | `number` | END OF `scoreChainCombos` |
| `FLOAT` RANGE BY QTY | PER `addToFloat` INVOCATION | `qty` | `CTPRange` | END OF `addToFloat` |
| RESOURCE→TASKS INDEX | PER `detectLanes` CALL | `resourceKey` | `Set<taskKey>` | END OF `detectLanes` |
| MATRIX RECALC FLAG | EXISTING | `AvailableMatrix` | `boolean` | EXTERNAL ✅ |

**CONVENTION:**
1. ALL PERSISTENT CACHES (FIRST TWO ROWS) USE A `version: number` FIELD ON THE OWNER + A `cacheVersion: number` ON THE CACHE ENTRY. CACHE IS STALE IFF VERSIONS DIFFER.
2. ALL EPHEMERAL CACHES (PER-CALL) ARE STACK-LOCAL — DO NOT STORE ON SHARED OBJECTS.
3. CACHE INVALIDATION IS PAIRED WITH MUTATION POINTS, NEVER LEFT TO TIME OR REFCOUNT.

---

# BENCHMARKING PROTOCOL

> **ALL P0 AND P1 TICKETS REQUIRE A BEFORE/AFTER BENCHMARK ON THE SAME LANDSCAPE.**

**REPRESENTATIVE LANDSCAPE FIXTURES TO STANDARDIZE:**

| FIXTURE | TASKS | RESOURCES | CALENDAR DAYS | TYPICAL CHAIN LENGTH | NOTES |
|---|---|---|---|---|---|
| `tiny.json` | 20 | 5 | 7 | 3 | SMOKE |
| `small.json` | 200 | 20 | 30 | 5 | UNIT-LIKE |
| `medium.json` | 1000 | 50 | 90 | 5 | TARGET |
| `large.json` | 5000 | 100 | 180 | 8 | STRESS |
| `wide-chain.json` | 500 | 20 | 30 | 15 | EXERCISES `detectLanes` AND CROSS-PRODUCT |

**METRICS TO RECORD PER TICKET:**
- WALL-CLOCK MS FOR THE TARGETED METHOD ONLY
- WALL-CLOCK MS FOR FULL `evaluateChain` ON THE FIXTURE
- ALLOCATIONS (NODE.JS `--inspect` HEAP DELTA OR `process.memoryUsage()`)
- CORRECTNESS DIFF VS. BASELINE (DEEP-EQUAL ON OUTPUT STRUCTURES)

**ACCEPTANCE GATE:**
- NO TICKET MERGES WITHOUT A BENCHMARK FILE COMMITTED ALONGSIDE
- NO REGRESSION > 5% ON ANY OTHER FIXTURE
- CORRECTNESS DIFFS MUST BE ZERO ON ALL FIXTURES

---

# SPRINT PHASING

**WEEK 1 — P0 INNER LOOP (5 TICKETS, ~2.5 DAYS WORK):**
- DAY 1: TICKETS 1, 2, 9 (LIST/RANGE INDEXING — ALL TOUCH SIMILAR PATTERN)
- DAY 2: TICKET 5 (DETECTLANES INVERSION — ISOLATED REWRITE)
- DAY 3: TICKETS 3, 4 (CACHE LAYER + UNIQUE-SCORE — INTRODUCE THE VERSION PATTERN)

**WEEK 2 — P1 WARM PATH (7 TICKETS, ~2 DAYS WORK):**
- DAY 4: TICKETS 6, 7, 8 (ALL IN `chaincontextengine` — BUNDLE)
- DAY 5: TICKETS 10, 11, 12 (SCORING + AVAILABLEENGINE FIXES)

**WEEK 3 — P2 + AUDIT + DOCS (~1 DAY):**
- TICKETS 13, 14, 15, 16
- AUDIT MEMO ON TICKET 16 (`getEntity` BACKING)
- UPDATED OPTIMIZATION NOTES IN `metaheuristic-scheduling-overview.docx`

---

# OUT-OF-SCOPE FOLLOW-UPS

LOGGED FOR LATER, NOT IN THIS SPRINT:

- **STREAMING CROSS-PRODUCT ENUMERATION** — IF `preCapContextSets` STILL UNDERSHOOTS ON LARGE INPUTS, SWITCH `crossProductContexts` TO A GENERATOR + EARLY ABORT WHEN VALID-COMBO COUNT REACHES `maxResults`
- **DAY-BUCKETED INTERVAL INDEX** — IF `atOrAfterStartTime` IS STILL HOT AFTER TICKET 9, BUILD A SECONDARY INDEX KEYED BY DAY-BUCKET
- **PARALLEL COMBO PROPAGATION** — `propagateCombo` IS PURE PER-COMBO; WORKER POOL OR `Promise.all` BATCHING POSSIBLE
- **DISJUNCTIVE GRAPH COUNTING SORT** — IF `buildFromLandscape` IS HOT ON 10K+ TASK LANDSCAPES
- **STRICT-MODE WALKERS** — `workingEndForwardW` / `workingStartBackwardW` SHOULD HAVE VARIANTS THAT RETURN `null` ON INFEASIBILITY INSTEAD OF FALLING BACK TO `startW + duration` (NOTED IN PRIOR REVIEW)

---

# DEFINITION OF DONE

A TICKET IS DONE WHEN:
1. ✅ CODE CHANGE LANDED
2. ✅ EXISTING TESTS PASS
3. ✅ NEW REGRESSION TEST ADDED FOR ANY CORRECTNESS-SENSITIVE CHANGE
4. ✅ BENCHMARK COMMITTED (P0/P1 ONLY)
5. ✅ NO REGRESSION > 5% ON ANY FIXTURE
6. ✅ CACHE INVALIDATION HOOKS WIRED IF APPLICABLE
7. ✅ TICKET CLOSED IN BACKLOG WITH BENCHMARK NUMBERS

---

*GENERATED FOR THE CTP PLATFORM TEAM. SEE `metaheuristic-scheduling-overview.docx` AND `CTP-Platform-Overview.docx` FOR ENGINE CONTEXT.*
