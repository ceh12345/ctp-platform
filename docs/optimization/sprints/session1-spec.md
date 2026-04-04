# Session 1 Spec: Extend DisjunctiveGraph

**Sprint:** Optimization Scheduler  
**Deliverables:** `Engines/Optimization/disjunctivegraph.ts` (move + extend), `Engines/Optimization/types.ts` (new)  
**Input:** `Engines/disjunctivegraph.ts` (Phase A, read-only graph — 341 lines)  
**Effort:** ~3h  
**Depends on:** Phase A DisjunctiveGraph (complete)  
**Modifies nothing else.** All changes are additive inside the new `Engines/Optimization/` folder.

---

## What This Session Does

Take the existing read-only DisjunctiveGraph and make it mutable so the tabu search (Session 2) can swap task orderings on resources, recompute the critical path after each swap, detect cycles, and snapshot/restore graph states.

---

## File 1: `Engines/Optimization/types.ts`

New file. All optimization-specific interfaces live here to avoid circular imports across sessions 1–4.

### Interfaces to Define

**TabuConfig** — Tabu search parameters. Fields: `tenure: number` (15–25, sqrt(N)), `maxIterations: number` (1000–3000), `stagnationLimit: number` (200–500), `timeBudgetMs: number`, `freezeHorizon: number` (epoch seconds, 0 = no freeze).

**TabuSearchResult** — Output of a tabu pass. Fields: `bestGraph: DisjunctiveGraph`, `bestMakespan: number`, `originalMakespan: number`, `improvementPercent: number`, `totalIterations: number`, `totalMovesEvaluated: number`, `convergenceReason: 'stagnation' | 'time_budget' | 'max_iterations'`.

**NeighborhoodMove** — A candidate swap. Fields: `resourceKey: string`, `nodeIdxA: number` (currently before B), `nodeIdxB: number` (currently after A), `blockId: number`, `moveType: 'block_first' | 'block_last' | 'internal'`.

**MoveEvaluation** — Result of evaluating a move. Fields: `move: NeighborhoodMove`, `feasible: boolean`, `newMakespan: number` (Infinity if infeasible), `changeoverDelta: number`.

**CriticalBlock** — A group of ≥2 consecutive critical-path tasks on one resource. Fields: `id: number`, `resourceKey: string`, `resourceName: string`, `nodeIndices: number[]`, `firstIdx: number`, `lastIdx: number`, `totalDuration: number`, `percentOfMakespan: number`.

**SwapRecord** — Undo token. Fields: `resourceKey: string`, `nodeIdxA: number`, `nodeIdxB: number`.

**TranslationResult** — Output of graph-to-landscape translation (Session 3). Fields: `tasksRescheduled: number`, `tasksFailed: number`, `failedTaskKeys: string[]`.

**TaskDiff** — One task's before/after comparison. Fields: `taskKey`, `taskName`, `orderKey: string | null`, `originalStart`, `originalEnd`, `originalResource`, `optimizedStart`, `optimizedEnd`, `optimizedResource`, `startDelta: number` (positive = moved later), `movedResource: boolean`.

---

## File 2: `Engines/Optimization/disjunctivegraph.ts`

Copy the existing `Engines/disjunctivegraph.ts` into `Engines/Optimization/disjunctivegraph.ts`. Then apply the changes below. The original file is left untouched (other code may still import it; a re-export or deprecation notice can happen later).

### Imports to Add

```
import { CTPStateChanges } from '../Models/Entities/statechanges';
import { CriticalBlock, SwapRecord } from './types';
```

---

### 1a. Extend DisjunctiveNode Interface

Add these fields to the existing `DisjunctiveNode` interface:

```typescript
// Adjacency arrays — O(1) traversal for swap + critical path
disjPredecessors: number[];    // resource sequencing predecessors (node indices)
disjSuccessors: number[];      // resource sequencing successors
conjPredecessors: number[];    // chain predecessors (may be >1 for multi-pred)
conjSuccessors: number[];      // chain successors

// Freeze control
isFrozen: boolean;             // true → optimizer cannot move this node

// Changeover support
changeoverBefore: number;      // changeover seconds before this task on its resource
processKey: string;            // for changeover lookups (fromProcess → toProcess)
```

Keep the existing `conjunctivePred` / `conjunctiveSucc` single-link fields for backward compatibility. The adjacency arrays are the authoritative source for the optimization layer.

---

### 1b. Add `resourceSequences` Class Property

```typescript
public resourceSequences = new Map<string, number[]>();
// resourceKey → node indices in scheduled order
```

Built from the existing `byResource` map during construction, sorted by `startW`.

---

### 1c. Modify `buildFromLandscape()`

**Signature change:** Add optional `freezeHorizon` parameter (default `0`).

```typescript
public static buildFromLandscape(
  landscape: SchedulingLandscape, 
  freezeHorizon = 0
): DisjunctiveGraph
```

**Node creation changes:**

1. Initialize new fields on every node: `disjPredecessors: []`, `disjSuccessors: []`, `conjPredecessors: []`, `conjSuccessors: []`, `isFrozen: false`, `changeoverBefore: 0`, `processKey: task.processKey ?? ''`.

2. Compute `isFrozen`:
   - `true` if `task.pinned` is truthy
   - `true` if `task.wipstate` exists AND is not `CTPWipStateConstants.NOT_STARTED`
   - `true` if `freezeHorizon > 0` AND `task.scheduled.startW < freezeHorizon`

**Conjunctive arc changes (step 2):**

After setting the legacy `conjunctivePred` / `conjunctiveSucc`, also push into the adjacency arrays:
```
node.conjPredecessors.push(predIdx);
graph.nodes[predIdx].conjSuccessors.push(i);
```

**Disjunctive arc changes (step 3):**

After sorting the resource sequence:
1. Store it: `graph.resourceSequences.set(resourceKey, [...sorted]);`
2. For each consecutive pair, push into adjacency arrays:
   ```
   graph.nodes[fromIdx].disjSuccessors.push(toIdx);
   graph.nodes[toIdx].disjPredecessors.push(fromIdx);
   ```

**Step 4:** Call `graph.recomputeCriticalPath()` (renamed from `computeCriticalPath` — see 1d).

**Step 5:** Call `graph.identifyCriticalBlocks()` (enhanced — see 1e).

---

### 1d. Refactor Critical Path to Public `recomputeCriticalPath()`

Rename the existing private `computeCriticalPath()` to public `recomputeCriticalPath()`.

**Key algorithm change:** Replace the `startW`-based topological sort with **Kahn's algorithm** using the adjacency arrays. This is required because after a swap, `startW` values are stale but the adjacency arrays are correct.

Implementation:

1. Compute in-degrees from `conjPredecessors.length + disjPredecessors.length` for each node.
2. Seed a queue with all zero-in-degree nodes.
3. Process: dequeue → add to `topoOrder` → decrement successors' in-degree → enqueue if zero.
4. **If `topoOrder.length < n`**, the graph has a cycle. Set `this.criticalPath = null` and return. (This is a safety net — `hasCycle()` should be called first, but recomputeCriticalPath should not crash on cycles.)

**Forward pass:** Include `changeoverBefore` in the edge weight:
```typescript
const finishTime = node.earliestStart + node.duration + node.changeoverBefore;
```

**Backward pass and slack:** Same logic as original. Slack tolerance remains 1 second.

**Result building:** Extract into a private helper `buildCriticalPathResult(makespan: number)` to keep the method readable. Logic is identical to the original.

---

### 1e. Enhance `identifyCriticalBlocks()`

Change return type from `void` to `CriticalBlock[]`.

**Algorithm:**

1. Build a `Set<string>` of critical-path node keys from `this.criticalPath.path`.
2. Walk each resource sequence (`this.resourceSequences`).
3. Find runs of consecutive nodes whose keys are in the critical set.
4. Emit a `CriticalBlock` for runs of ≥2 nodes. Set `criticalBlockId` on each node.
5. Compute `totalDuration` (sum of node durations) and `percentOfMakespan`.

Single-node "blocks" are skipped — you can't swap a single task with itself.

---

### 1f. Add `swapOnResource()`

```typescript
public swapOnResource(
  resourceKey: string, 
  nodeIdxA: number, 
  nodeIdxB: number
): SwapRecord
```

**Preconditions (throw if violated):**
- `resourceSequences` has the key
- Both node indices exist in that sequence
- `posA < posB` (A is before B)

**Steps:**

1. Find positions: `posA = seq.indexOf(nodeIdxA)`, `posB = seq.indexOf(nodeIdxB)`.
2. Find neighbors: `predIdx = seq[posA - 1]` (or -1), `succIdx = seq[posB + 1]` (or -1).
3. **Remove old adjacency** on `disjPredecessors` / `disjSuccessors`:
   - `pred → A` (if pred exists)
   - `A → B`
   - `B → succ` (if succ exists)
4. **Add new adjacency:**
   - `pred → B` (if pred exists)
   - `B → A`
   - `A → succ` (if succ exists)
5. **Swap in resource sequence:** `seq[posA] = nodeIdxB; seq[posB] = nodeIdxA;`
6. **Rebuild flat edges** for this resource (helper: `rebuildDisjunctiveEdgesForResource`). Filter out old disjunctive edges for this `resourceKey`, re-add from the current sequence. Edge weight = `node.duration + successor.changeoverBefore`.
7. Return `{ resourceKey, nodeIdxA, nodeIdxB }`.

**Helper `removeFromArray(arr, value)`:** Find index with `indexOf`, splice if found. Module-level function, not a method.

---

### 1g. Add `reverseSwap()`

```typescript
public reverseSwap(record: SwapRecord): void
```

After the original swap, B is before A. To undo: call `swapOnResource(record.resourceKey, record.nodeIdxB, record.nodeIdxA)`.

---

### 1h. Add `recomputeChangeovers()`

```typescript
public recomputeChangeovers(
  resourceKey: string,
  nodeIdxA: number,
  nodeIdxB: number,
  stateChanges?: CTPStateChanges
): void
```

If `stateChanges` is undefined/null, return immediately (no changeovers to compute).

**Affected positions after swap (B now before A):**
- Position of B (was A's position) — predecessor changed
- Position of A (was B's position) — predecessor changed
- Position after A (if exists) — predecessor changed from B to A

For each affected position `pos` (skip pos ≤ 0):
1. Look up `predNode = nodes[seq[pos - 1]]`, `currNode = nodes[seq[pos]]`.
2. Call `lookupChangeover(resourceKey, predNode.processKey, currNode.processKey, stateChanges)`.
3. Set `currNode.changeoverBefore = result`.

Then call `rebuildDisjunctiveEdgesForResource(resourceKey)` so edge weights reflect new changeovers.

**`lookupChangeover()` (private):** Iterate `stateChanges` looking for a match on `resourceKey + fromProcess + toProcess`. Return the `duration` or 0 if not found. If `fromProcess === toProcess` or either is empty, return 0 (no changeover for same-process transitions).

---

### 1i. Add `hasCycle()`

```typescript
public hasCycle(): boolean
```

Kahn's algorithm:

1. Compute in-degrees: `conjPredecessors.length + disjPredecessors.length` per node.
2. Queue all zero-in-degree nodes.
3. BFS: dequeue → increment processed → decrement successors' in-degree → enqueue if zero.
4. Return `processed < n`.

Use `Int32Array(n)` for in-degrees (cache-friendly). Use array-as-queue with a `head` pointer (avoid `shift()` which is O(n)).

---

### 1j. Add `clone()`

```typescript
public clone(): DisjunctiveGraph
```

Deep copies:
- `nodes` — spread each node, but **copy all arrays**: `disjPredecessors: [...]`, `disjSuccessors: [...]`, `conjPredecessors: [...]`, `conjSuccessors: [...]`.
- `edges` — spread each edge.
- `nodeIndex` — rebuild from cloned nodes.
- `resourceSequences` — copy each array.
- `byResource` — copy each array.
- `criticalPath` — shallow copy (read-only snapshot). `null` if null.

Does NOT recompute critical path. Caller does that if needed.

---

### 1k. Add Utility Methods

```typescript
public getNodeIndex(taskKey: string): number | undefined
// Delegates to this.nodeIndex.get(taskKey)

public getResourceNodes(resourceKey: string): number[]
// Returns this.resourceSequences.get(resourceKey) ?? []
```

---

## Behavioral Notes for CC

**Do not modify any existing files.** The original `Engines/disjunctivegraph.ts` stays in place. This session creates two new files in `Engines/Optimization/`.

**Performance targets at 1000 nodes:**
- `recomputeCriticalPath()`: 2–5ms (Kahn's + forward/backward pass)
- `hasCycle()`: 2–5ms (same Kahn's approach)
- `swapOnResource()`: <0.1ms (array splicing only)
- `clone()`: <1ms (spread + array copy)

**The queue pattern** used in `hasCycle()` and `recomputeCriticalPath()` should use an array with a `head` pointer (`queue[head++]`) instead of `.shift()` — `.shift()` is O(n) on each call and degrades performance at scale.

**Edge weight for disjunctive edges** after a swap is `predecessorNode.duration + successorNode.changeoverBefore`. This ensures the critical path pass accounts for changeover time between tasks.

**`recomputeCriticalPath()` must not throw on a cyclic graph.** If the topological sort is incomplete (processed < n), set `this.criticalPath = null` and return. The caller uses `hasCycle()` before committing a swap and uses `criticalPath === null` as a fallback safety check.

---

## Tests (Session 1 Verification)

Build a test landscape with 5 tasks across 2 resources, with at least one chain of 3 tasks.

1. **Graph construction:** Build graph, verify node count, edge count, `resourceSequences` populated, adjacency arrays populated, `isFrozen` set correctly for a pinned task.

2. **Swap correctness:** Swap two adjacent tasks on a resource. Verify: `resourceSequences` reflects new order, `disjPredecessors`/`disjSuccessors` updated on all 4 affected nodes (pred, B, A, succ), flat edges rebuilt.

3. **Critical path after swap:** Recompute critical path after swap. Verify `makespan` changed (or didn't, depending on whether the swap affects the critical path). Verify `earliestStart`/`latestStart` updated.

4. **Clone isolation:** Clone graph, swap on the clone, verify original graph's `resourceSequences` and node adjacency arrays are unchanged.

5. **Cycle detection:** Create a scenario where two tasks have both a chain relationship (A→B conjunctive) and are on the same resource (A before B disjunctive). Swapping them creates a cycle (B→A disjunctive + A→B conjunctive). Verify `hasCycle()` returns `true`.

6. **Changeover recomputation:** Set up tasks with different `processKey` values and a `stateChanges` collection with defined changeover durations. Swap two tasks, call `recomputeChangeovers()`, verify `changeoverBefore` updated on affected nodes and edge weights include changeover.

7. **Reverse swap:** Swap then reverse. Verify graph state matches the original (adjacency arrays, resource sequences, changeovers all restored).
