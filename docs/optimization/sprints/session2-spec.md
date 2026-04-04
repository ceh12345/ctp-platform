# Session 2 Spec: Tabu Search Algorithm

**Sprint:** Optimization Scheduler  
**Deliverable:** `Engines/Optimization/tabusearch.ts` (new)  
**Effort:** ~3h  
**Depends on:** Session 1 (DisjunctiveGraph with swap, cycle check, clone, recomputeCriticalPath, identifyCriticalBlocks, recomputeChangeovers)  
**Types from:** `Engines/Optimization/types.ts` (already created in Session 1 — TabuConfig, TabuSearchResult, NeighborhoodMove, MoveEvaluation)  
**Modifies nothing else.** Single new file.

---

## What This Session Does

Implement the core tabu search optimization loop. Takes a mutable DisjunctiveGraph, generates candidate swap moves from critical-path blocks, evaluates each move, manages a tabu list to prevent cycling, and returns the best graph found.

---

## File: `Engines/Optimization/tabusearch.ts`

### Imports

```typescript
import { DisjunctiveGraph } from './disjunctivegraph';
import { TabuConfig, TabuSearchResult, NeighborhoodMove, MoveEvaluation } from './types';
import { CTPStateChanges } from '../Models/Entities/statechanges';
```

### Exports

Four public exports:
- `class TabuList` — tabu list manager
- `function generateNeighborhood` — move generation from critical blocks
- `function evaluateMove` — single move evaluation (swap, check, reverse)
- `function tabuSearch` — main loop (the entry point for Session 4's scheduler)

---

## 2a. TabuList Class

```typescript
export class TabuList {
  constructor(tenure: number)
  isTabu(move: NeighborhoodMove, currentIter: number): boolean
  add(move: NeighborhoodMove, iteration: number): void
  get size(): number
}
```

**Internal storage:** An array of `{ nodeA, nodeB, resourceKey, iteration }` entries.

**`isTabu()` logic:** A move (swap A,B) is tabu if its REVERSE (swap B,A) was recently performed. Check: does any entry exist where `entry.nodeA === move.nodeIdxB && entry.nodeB === move.nodeIdxA && entry.resourceKey === move.resourceKey` and `(currentIter - entry.iteration) < tenure`?

Iterate **backwards** from the end of the array — recent entries are most likely to match and we can skip expired ones early.

**`add()` logic:** Push the entry. When the array exceeds `tenure * 3`, filter out expired entries (amortized O(1) cost per add).

**`size` getter:** Returns current entry count. Diagnostic only — not used in the hot path.

---

## 2b. Neighborhood Generation — `generateNeighborhood()`

```typescript
export function generateNeighborhood(graph: DisjunctiveGraph): NeighborhoodMove[]
```

**Algorithm (Taillard N7 neighborhood):**

1. Call `graph.identifyCriticalBlocks()` to get all critical blocks.
2. For each block, generate up to 3 types of moves:

**block_first:** Swap the first task in the block with its resource predecessor.
- Find `firstNodeIdx = block.nodeIndices[0]`.
- Find its position in the resource sequence: `firstPosInSeq = seq.indexOf(firstNodeIdx)`.
- If `firstPosInSeq > 0`, the predecessor is `seq[firstPosInSeq - 1]`.
- Skip if either node is frozen.
- Emit: `{ nodeIdxA: predIdx, nodeIdxB: firstNodeIdx, moveType: 'block_first' }`.

**block_last:** Swap the last task in the block with its resource successor.
- Find `lastNodeIdx = block.nodeIndices[block.nodeIndices.length - 1]`.
- Find its position: `lastPosInSeq = seq.indexOf(lastNodeIdx)`.
- If `lastPosInSeq < seq.length - 1`, the successor is `seq[lastPosInSeq + 1]`.
- Skip if either node is frozen.
- Emit: `{ nodeIdxA: lastNodeIdx, nodeIdxB: succIdx, moveType: 'block_last' }`.

**internal:** Swap each pair of adjacent tasks within the block.
- For `i = 0` to `block.nodeIndices.length - 2`: swap `block.nodeIndices[i]` with `block.nodeIndices[i + 1]`.
- Skip if either node is frozen.
- Emit: `{ nodeIdxA: a, nodeIdxB: b, moveType: 'internal' }`.

**Expected move count:** At 1000 tasks with 8–15 critical blocks of 3–12 tasks each, expect 20–80 moves per iteration. This is small enough to evaluate exhaustively.

**Frozen task guarantee:** No move is generated that involves a frozen node. This is checked per-move, not per-block — a block can contain a mix of frozen and non-frozen nodes.

---

## 2c. Move Evaluation — `evaluateMove()`

```typescript
export function evaluateMove(
  graph: DisjunctiveGraph,
  move: NeighborhoodMove,
  stateChanges?: CTPStateChanges,
): MoveEvaluation
```

Evaluates a move without committing it. The graph is returned to its original state after evaluation.

**Sequence:**

1. **Apply swap:** `graph.swapOnResource(move.resourceKey, move.nodeIdxA, move.nodeIdxB)`.
2. **Recompute changeovers:** `graph.recomputeChangeovers(move.resourceKey, move.nodeIdxA, move.nodeIdxB, stateChanges)`.
3. **Cycle check:** `graph.hasCycle()`.
   - If cyclic → reverse swap, reverse changeovers, return `{ feasible: false, newMakespan: Infinity, changeoverDelta: 0 }`.
4. **Recompute critical path:** `graph.recomputeCriticalPath()`. Read `graph.criticalPath.makespan`.
5. **Reverse everything:**
   - `graph.reverseSwap(...)` — note: after the original swap B is before A, so `reverseSwap` receives the original swap record.
   - `graph.recomputeChangeovers(...)` with nodeIdxB and nodeIdxA swapped (reversing the changeover recompute).
   - `graph.recomputeCriticalPath()` — restore to pre-evaluation state.
6. **Return:** `{ feasible: true, newMakespan, changeoverDelta: newMakespan - preMakespan }`.

**Performance:** 5–12ms per evaluation at 1000 nodes. The cycle check and critical path are the bottleneck (each is O(T+E) via Kahn's).

**`stateChanges` is optional.** Pass `undefined` if the landscape has no changeovers. The graph methods handle this gracefully (no-op if undefined).

**Null-safe critical path access:** Use `graph.criticalPath?.makespan ?? Infinity`. If `recomputeCriticalPath` returned null (shouldn't happen after cycle check passes, but defensive), treat as infeasible.

---

## 2d. Main Loop — `tabuSearch()`

```typescript
export function tabuSearch(
  graph: DisjunctiveGraph,
  config: TabuConfig,
  stateChanges?: CTPStateChanges,
): TabuSearchResult
```

**The graph is mutated.** Callers should clone before calling if they need the original. The returned `bestGraph` is an independent clone of the best state found.

**Degenerate case handling:** If `graph.criticalPath` is null after the initial `recomputeCriticalPath()` (empty graph, no scheduled tasks), return immediately with zeroed stats and `convergenceReason: 'stagnation'`.

**Main loop (pseudocode):**

```
bestMakespan = originalMakespan
bestGraph = graph.clone()
noImproveCount = 0

for iter = 0 to config.maxIterations:
    if elapsed > config.timeBudgetMs: break

    moves = generateNeighborhood(graph)
    if moves is empty: break

    // Evaluate all moves, pick best non-tabu (or aspiration override)
    bestMove = null
    bestMoveMakespan = Infinity

    for each move in moves:
        eval = evaluateMove(graph, move, stateChanges)
        if not eval.feasible: continue

        isTabu = tabu.isTabu(move, iter)
        aspirationMet = eval.newMakespan < bestMakespan  // global best

        if not isTabu OR aspirationMet:
            if eval.newMakespan < bestMoveMakespan:
                bestMoveMakespan = eval.newMakespan
                bestMove = move

    // Apply best move (even if worsening — this escapes local optima)
    if bestMove:
        graph.swapOnResource(...)
        graph.recomputeChangeovers(...)
        graph.recomputeCriticalPath()
        tabu.add(bestMove, iter)

        if currentMakespan < bestMakespan:
            bestMakespan = currentMakespan
            bestGraph = graph.clone()
            noImproveCount = 0
        else:
            noImproveCount++
    else:
        noImproveCount++

    if noImproveCount >= config.stagnationLimit: break
```

**Convergence reason determination (after loop exits):**
1. If `noImproveCount >= config.stagnationLimit` → `'stagnation'`
2. Else if `elapsed > config.timeBudgetMs` → `'time_budget'`
3. Else → `'max_iterations'`

**Division-by-zero guard:** `improvementPercent` calculation: if `originalMakespan === 0`, return `0` (not `NaN`).

---

## Behavioral Notes for CC

**Move evaluation is the hot path.** Each iteration evaluates 20–80 moves. Each evaluation does: swap + changeover + cycle check + critical path + reverse all. At 1000 nodes this is 5–12ms per evaluation → 200–500ms per iteration → 7–15 min for 2000 iterations.

**The tabu list checks the REVERSE move**, not the same move. If we just swapped A before B → B before A, the tabu entry records (A, B). When checking a future move to swap (B, A), we look for entries with `nodeA === B, nodeB === A` — which matches. This prevents immediately undoing the swap.

**Aspiration criterion:** A tabu move is accepted if it produces a new global best. This is the standard aspiration criterion — it prevents the tabu list from blocking genuinely good moves.

**Worsening moves are applied intentionally.** The algorithm picks the best available move even if it increases the makespan. This is fundamental to tabu search — it escapes local optima by allowing temporary worsening. The best-known solution is preserved via `bestGraph`.

**`stateChanges` parameter.** The sprint doc shows `CTPStateChanges` but some landscapes may not have changeovers defined. Make the parameter optional (`stateChanges?: CTPStateChanges`) and pass it through to the graph methods which already handle undefined gracefully.

**No `console.log` in production code.** If you want iteration logging, add a callback parameter in a future session — don't bake in logging.

---

## Tests (Session 2 Verification)

1. **Improvement found:** Build a 10-task, 3-resource landscape where the constructive solve is suboptimal. Run `tabuSearch` with 100 iterations. Verify `bestMakespan < originalMakespan` and `improvementPercent > 0`.

2. **Tabu list prevents cycling:** Run with `tenure = 5`. Record the moves applied over 20 iterations. Verify no move's reverse appears within the 5-iteration tenure window.

3. **Aspiration criterion:** Create a scenario where the only improving move is tabu. Verify it's still selected because `aspirationMet` is true (new makespan < global best).

4. **Stagnation termination:** Run with `stagnationLimit = 10`. Verify the search terminates after 10 iterations with no improvement. Verify `convergenceReason === 'stagnation'`.

5. **Time budget termination:** Run with `timeBudgetMs = 50` (very short). Verify the search terminates quickly. Verify `convergenceReason === 'time_budget'`.

6. **Frozen tasks excluded:** Freeze several tasks. Verify `generateNeighborhood` never returns a move involving a frozen node index.

7. **Empty neighborhood:** Create a graph where all critical-path tasks are frozen. Verify `generateNeighborhood` returns `[]` and `tabuSearch` terminates immediately.

8. **Graph restored after evaluation:** Call `evaluateMove` on a move, then verify the graph's `criticalPath.makespan`, `resourceSequences`, and node adjacency arrays are identical to before the call.
