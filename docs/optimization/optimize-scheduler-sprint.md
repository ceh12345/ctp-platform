# Engine Sprint: Optimization Scheduler (TabuSearchScheduler + ILSScheduler)

**What it does:** Extends the existing CTPScheduler with a post-solve optimization layer. After the constructive AbA solve completes (Passes 1-3), the optimization engine builds a disjunctive graph from the result, runs tabu search on critical-path neighborhoods to find a better task sequencing, and translates the improved solution back to the landscape. Two tiers: Thorough (single tabu pass, 5-30s) and Best/Overnight (ILS with multiple passes, minutes to hours).

**Size:** ~12-16 hours CC work across 5 sessions  
**Depends on:** DisjunctiveGraph (Phase A — complete), CTPBaseScheduler (complete), ChainContextEngine (complete)  
**Does not modify:** CTPBaseScheduler, CTPScheduler, ChainContextEngine, ScheduleEngine, ScoringEngine, any agents, any neighborhoods, any scoring rules — entirely additive

---

## Architecture Recap

```
Today:       Data → AbA constructive solve → feasible schedule → done
Thorough:    Data → AbA constructive solve → build graph → tabu search → translate back → better schedule
Best/Batch:  Data → AbA constructive solve → build graph → [tabu → perturb → tabu → ...] → translate back → best schedule
```

The constructive solve (CTPScheduler) runs unchanged. The optimization layer hooks into the existing empty `endScheduling()` method.

---

## File Organization

All new optimization code lives in a dedicated `Engines/Optimization/` folder. Scheduler subclasses live in `AI/Schedulers/` alongside the existing schedulers.

```
Engines/
  ├── scheduleengine.ts              ← existing (untouched)
  ├── scoringengine.ts               ← existing (untouched)
  ├── starttimeengine.ts             ← existing (untouched)
  ├── availableengine.ts             ← existing (untouched)
  ├── statechangeerengine.ts         ← existing (untouched)
  ├── setengine.ts                   ← existing (untouched)
  ├── combinationengine.ts           ← existing (untouched)
  ├── chaincontextengine.ts          ← existing (untouched)
  ├── baseengine.ts                  ← existing (untouched)
  │
  └── Optimization/                  ← NEW FOLDER
      ├── disjunctivegraph.ts        ← MOVED + EXTENDED (swap, clone, cycle, changeover)
      ├── tabusearch.ts              ← NEW (TabuList, neighborhood, evaluation, main loop)
      ├── perturbation.ts            ← NEW (perturbGraph, ILS perturbation strategies)
      ├── graphtranslation.ts        ← NEW (applyOptimizedGraph, topologicalSort, computeDiff)
      └── types.ts                   ← NEW (all optimization interfaces)

AI/
  ├── Agents/                        ← existing (untouched)
  ├── Neighborhoods/                 ← existing (untouched)
  ├── Scoring/                       ← existing (untouched)
  │
  └── Schedulers/
      ├── basescheduler.ts           ← existing (untouched)
      ├── defaultscheduler.ts        ← existing (untouched)
      ├── tabusearchscheduler.ts     ← NEW (Session 4)
      └── ilsscheduler.ts           ← NEW (Session 4)

ctp/
  ├── ctp.service.ts                 ← MODIFIED — createScheduler() factory (Session 4)
  ├── optimize.controller.ts         ← NEW (Session 5)
  └── optimize.service.ts            ← NEW (Session 5)

Models/Entities/
  ├── appsettings.ts                 ← MODIFIED — add tabu/ILS config fields (Session 4)
  └── solveresult.ts                 ← MODIFIED — add optimization result (Session 4)
```

**Design rationale:**
- `Engines/Optimization/` is the reusable optimization toolkit. Nothing here knows about CTPBaseScheduler — only about DisjunctiveGraph, SchedulingLandscape, and ScheduleEngine. Future techniques (simulated annealing, GRASP, CP-SAT) go here alongside tabu search, sharing the same graph infrastructure.
- `AI/Schedulers/` holds the thin orchestrator subclasses that call into Engines/Optimization/ from their endScheduling() override.
- `types.ts` centralizes all optimization-specific interfaces (TabuConfig, NeighborhoodMove, SwapRecord, TaskDiff, CriticalBlock) to avoid circular imports.

---

## Session Plan

| Session | Deliverable | Files | Effort | Depends On |
|---------|-------------|-------|--------|------------|
| 1 | Extend DisjunctiveGraph with swap operations + incremental critical path | `Engines/Optimization/disjunctivegraph.ts` (move + extend), `Engines/Optimization/types.ts` (new) | ~3h | Phase A graph (done) |
| 2 | Tabu search algorithm (core loop, neighborhood generation, tabu list) | `Engines/Optimization/tabusearch.ts` (new) | ~3h | Session 1 |
| 3 | Graph-to-landscape translation (apply improved solution back) | `Engines/Optimization/graphtranslation.ts` (new) | ~3h | Session 2 |
| 4 | TabuSearchScheduler + ILSScheduler subclasses, wire into ctp_service | `AI/Schedulers/tabusearchscheduler.ts` (new), `AI/Schedulers/ilsscheduler.ts` (new), `Engines/Optimization/perturbation.ts` (new), `Models/Entities/appsettings.ts` (modify), `Models/Entities/solveresult.ts` (modify), `ctp/ctp.service.ts` (modify) | ~2h | Session 3 |
| 5 | Batch optimization API (async job, polling, accept/reject) | `ctp/optimize.controller.ts` (new), `ctp/optimize.service.ts` (new) | ~2h | Session 4 |

---

## Session 1: Extend DisjunctiveGraph

**File:** `Engines/Optimization/disjunctivegraph.ts` (moved from `Engines/disjunctivegraph.ts` and extended)  
**Also creates:** `Engines/Optimization/types.ts`

### Goal
Add mutable operations to the existing read-only DisjunctiveGraph. The graph needs to support arc reversal (swapping two tasks on a resource), incremental critical path recomputation, cloning for snapshot/restore, and cycle detection.

### 1a. Add Adjacency Arrays to DisjunctiveNode

The current graph stores edges in a flat `edges: DisjunctiveEdge[]` array. For tabu search we need O(1) swap operations, which means each node needs its own successor/predecessor lists.

Add to `DisjunctiveNode`:

```typescript
// Add to existing DisjunctiveNode interface
disjPredecessors: number[];    // node indices — resource sequencing predecessors
disjSuccessors: number[];      // node indices — resource sequencing successors
conjPredecessors: number[];    // node indices — chain predecessors (may be >1 for multi-pred)
conjSuccessors: number[];      // node indices — chain successors

// Freeze control (for optimization)
isFrozen: boolean;             // Cannot be moved by optimizer
```

Populate during `buildFromLandscape()`:
- conjPredecessors/conjSuccessors: from the existing conjunctivePred/conjunctiveSucc (expand single → array)
- disjPredecessors/disjSuccessors: from the existing byResource sorted sequences
- isFrozen: true if task.pinned, task.wipstate !== NOT_STARTED, or task.scheduled.startW < freezeHorizon

### 1b. Resource Sequence Map

Add a proper resource sequence structure:

```typescript
// Add to DisjunctiveGraph class
public resourceSequences: Map<string, number[]>;  // resourceKey → node indices in scheduled order
```

Build from the existing `byResource` map during construction. Each sequence is sorted by startW.

### 1c. Swap Operation

```typescript
public swapOnResource(resourceKey: string, nodeIdxA: number, nodeIdxB: number): SwapRecord {
  // nodeA is currently before nodeB on this resource
  // After swap: nodeB comes before nodeA
  
  // 1. Update disjunctive edges
  //    Remove A→B, Add B→A
  //    Reconnect A's predecessor to B, B's successor to A
  
  // 2. Update resourceSequences map
  //    Swap positions in the array
  
  // 3. Return a SwapRecord for undo
  return { resourceKey, nodeIdxA, nodeIdxB };
}

public reverseSwap(record: SwapRecord): void {
  // Undo: swap them back
  this.swapOnResource(record.resourceKey, record.nodeIdxB, record.nodeIdxA);
}
```

Key detail: when swapping A and B, also update edges to/from A's resource predecessor and B's resource successor. If A had a disjunctive predecessor P on this resource (P→A), it becomes P→B. If B had a disjunctive successor S (B→S), it becomes A→S.

### 1d. Incremental Critical Path Recomputation

The existing `computeCriticalPath()` is a full forward+backward pass. For tabu search we call this after every swap. At 1000 nodes and ~5000 edges, the full pass takes 2-5ms which is acceptable for 1000-3000 iterations.

Refactor the existing private `computeCriticalPath()` to be public and callable independently of construction:

```typescript
public recomputeCriticalPath(): void {
  // Same forward/backward pass logic as existing computeCriticalPath()
  // but callable after swap operations
  // Updates: earliestStart, latestStart, totalSlack, isOnCriticalPath on each node
  // Updates: this.criticalPath result object
}
```

### 1e. Critical Block Identification (Enhanced)

The existing `identifyCriticalBlocks()` assigns blockIds but doesn't return structured data. Enhance to return:

```typescript
public identifyCriticalBlocks(): CriticalBlock[] {
  // Walk each resource sequence
  // Group consecutive critical-path nodes into blocks
  // A block must have >= 2 nodes (single nodes can't be swapped)
  // Return: { id, resourceKey, nodeIndices[], firstIdx, lastIdx, totalDuration, percentOfMakespan }
}

interface CriticalBlock {
  id: number;
  resourceKey: string;
  nodeIndices: number[];
  firstIdx: number;
  lastIdx: number;
  totalDuration: number;
  percentOfMakespan: number;
}
```

### 1f. Clone

```typescript
public clone(): DisjunctiveGraph {
  // Deep copy nodes (timing fields, edge arrays, frozen flags)
  // Deep copy resourceSequences
  // Deep copy edges array
  // Rebuild nodeIndex map
  // Do NOT recompute critical path — caller does that if needed
}
```

### 1g. Cycle Detection

After a swap, verify the graph is still a DAG. A swap can create a cycle if the two tasks have an indirect chain relationship.

```typescript
public hasCycle(): boolean {
  // Kahn's algorithm: count in-degrees, BFS from zero-degree nodes
  // If processed count < total nodes, there's a cycle
  // Fast: O(T + E), same cost as critical path
}
```

### 1h. Changeover Recomputation

When tasks A and B are swapped on a resource, changeovers change for the affected neighbors:

```typescript
public recomputeChangeovers(
  resourceKey: string, 
  nodeIdxA: number, 
  nodeIdxB: number,
  stateChanges: CTPStateChanges
): void {
  // Look up the resource sequence for resourceKey
  // For each affected pair (new predecessor→B, B→A, A→new successor):
  //   Look up stateChange by resource type + fromProcess + toProcess
  //   Update the successor node's changeoverBefore field
  //   Include changeover weight in the edge weight for critical path
}
```

This requires adding `changeoverBefore: number` and `processKey: string` to DisjunctiveNode, and `weight` adjustments on disjunctive edges.

### Tests for Session 1
- Build graph from a 5-task, 2-resource landscape
- Swap two tasks on a resource, verify edges are correct
- Recompute critical path after swap, verify makespan changes
- Clone graph, swap on clone, verify original unchanged
- Swap that creates cycle is detected by hasCycle()
- Changeover recomputation produces correct durations

---

## Session 2: Tabu Search Algorithm

**File:** `Engines/Optimization/tabusearch.ts` (new)  
**Interfaces defined in:** `Engines/Optimization/types.ts` (from Session 1)

### Goal
Implement the core tabu search loop: neighborhood generation from critical blocks, move evaluation, tabu list management with aspiration criterion, and convergence detection.

### 2a. Interfaces

These go in `Engines/Optimization/types.ts`:

```typescript
interface TabuConfig {
  tenure: number;              // 15-25 for 1000 tasks (sqrt(N))
  maxIterations: number;       // 1000-3000 per pass
  stagnationLimit: number;     // 200-500 iterations without improvement → stop
  timeBudgetMs: number;        // Wall clock limit
  freezeHorizon: number;       // Epoch seconds — don't move tasks before this
}

interface TabuSearchResult {
  bestGraph: DisjunctiveGraph;
  bestMakespan: number;
  originalMakespan: number;
  improvementPercent: number;
  totalIterations: number;
  totalMovesEvaluated: number;
  convergenceReason: 'stagnation' | 'time_budget' | 'max_iterations';
}

interface NeighborhoodMove {
  resourceKey: string;
  nodeIdxA: number;            // Currently before B
  nodeIdxB: number;            // Currently after A
  blockId: number;
  moveType: 'block_first' | 'block_last' | 'internal';
}

interface MoveEvaluation {
  move: NeighborhoodMove;
  feasible: boolean;           // No cycle after swap
  newMakespan: number;         // Infinity if infeasible
  changeover Delta: number;    // Change in total changeover time
}
```

### 2b. Neighborhood Generation (Taillard N7)

```typescript
function generateNeighborhood(graph: DisjunctiveGraph): NeighborhoodMove[] {
  const moves: NeighborhoodMove[] = [];
  const blocks = graph.identifyCriticalBlocks();
  
  for (const block of blocks) {
    const seq = graph.resourceSequences.get(block.resourceKey)!;
    const firstNodeIdx = block.nodeIndices[0];
    const lastNodeIdx = block.nodeIndices[block.nodeIndices.length - 1];
    
    // Move 1: Swap first task in block with its resource predecessor
    const firstPosInSeq = seq.indexOf(firstNodeIdx);
    if (firstPosInSeq > 0) {
      const predIdx = seq[firstPosInSeq - 1];
      if (!graph.nodes[predIdx].isFrozen && !graph.nodes[firstNodeIdx].isFrozen) {
        moves.push({
          resourceKey: block.resourceKey,
          nodeIdxA: predIdx,        // predecessor (currently before)
          nodeIdxB: firstNodeIdx,   // first in block (currently after)
          blockId: block.id,
          moveType: 'block_first',
        });
      }
    }
    
    // Move 2: Swap last task in block with its resource successor
    const lastPosInSeq = seq.indexOf(lastNodeIdx);
    if (lastPosInSeq < seq.length - 1) {
      const succIdx = seq[lastPosInSeq + 1];
      if (!graph.nodes[lastNodeIdx].isFrozen && !graph.nodes[succIdx].isFrozen) {
        moves.push({
          resourceKey: block.resourceKey,
          nodeIdxA: lastNodeIdx,    // last in block (currently before)
          nodeIdxB: succIdx,        // successor (currently after)
          blockId: block.id,
          moveType: 'block_last',
        });
      }
    }
    
    // Move 3 (optional): Internal adjacent swaps within block
    for (let i = 0; i < block.nodeIndices.length - 1; i++) {
      const a = block.nodeIndices[i];
      const b = block.nodeIndices[i + 1];
      if (!graph.nodes[a].isFrozen && !graph.nodes[b].isFrozen) {
        moves.push({
          resourceKey: block.resourceKey,
          nodeIdxA: a,
          nodeIdxB: b,
          blockId: block.id,
          moveType: 'internal',
        });
      }
    }
  }
  
  return moves;
}
```

At 1000 tasks with 8-15 critical blocks of 3-12 tasks each, expect 20-80 moves per iteration.

### 2c. Move Evaluation

```typescript
function evaluateMove(
  graph: DisjunctiveGraph, 
  move: NeighborhoodMove,
  stateChanges: CTPStateChanges
): MoveEvaluation {
  // 1. Apply the swap
  graph.swapOnResource(move.resourceKey, move.nodeIdxA, move.nodeIdxB);
  
  // 2. Recompute changeovers for affected tasks
  graph.recomputeChangeovers(move.resourceKey, move.nodeIdxA, move.nodeIdxB, stateChanges);
  
  // 3. Check for cycles
  if (graph.hasCycle()) {
    graph.reverseSwap({ resourceKey: move.resourceKey, nodeIdxA: move.nodeIdxA, nodeIdxB: move.nodeIdxB });
    return { move, feasible: false, newMakespan: Infinity, changeoverDelta: 0 };
  }
  
  // 4. Recompute critical path
  graph.recomputeCriticalPath();
  const newMakespan = graph.criticalPath!.makespan;
  
  // 5. Reverse the swap (we're just evaluating)
  graph.reverseSwap({ resourceKey: move.resourceKey, nodeIdxA: move.nodeIdxA, nodeIdxB: move.nodeIdxB });
  graph.recomputeChangeovers(move.resourceKey, move.nodeIdxB, move.nodeIdxA, stateChanges);
  graph.recomputeCriticalPath();
  
  return { move, feasible: true, newMakespan, changeoverDelta: 0 };
}
```

### 2d. Tabu List

```typescript
class TabuList {
  private entries: { nodeA: number; nodeB: number; resourceKey: string; iteration: number }[] = [];
  private tenure: number;
  
  constructor(tenure: number) { this.tenure = tenure; }
  
  isTabu(move: NeighborhoodMove, currentIter: number): boolean {
    // A move is tabu if its REVERSE was recently performed
    return this.entries.some(e =>
      e.nodeA === move.nodeIdxB && e.nodeB === move.nodeIdxA &&
      e.resourceKey === move.resourceKey &&
      (currentIter - e.iteration) < this.tenure
    );
  }
  
  add(move: NeighborhoodMove, iteration: number): void {
    this.entries.push({
      nodeA: move.nodeIdxA, nodeB: move.nodeIdxB,
      resourceKey: move.resourceKey, iteration,
    });
    // Prune old entries
    if (this.entries.length > this.tenure * 3) {
      this.entries = this.entries.filter(e => (iteration - e.iteration) < this.tenure);
    }
  }
}
```

### 2e. Main Tabu Search Loop

```typescript
function tabuSearch(
  graph: DisjunctiveGraph, 
  config: TabuConfig,
  stateChanges: CTPStateChanges
): TabuSearchResult {
  const startMs = Date.now();
  const tabu = new TabuList(config.tenure);
  
  graph.recomputeCriticalPath();
  const originalMakespan = graph.criticalPath!.makespan;
  let bestMakespan = originalMakespan;
  let bestGraph = graph.clone();
  let noImproveCount = 0;
  let totalMoves = 0;
  let iter = 0;
  
  for (iter = 0; iter < config.maxIterations; iter++) {
    // Check time budget
    if (Date.now() - startMs > config.timeBudgetMs) break;
    
    // 1. Generate neighborhood from critical blocks
    const moves = generateNeighborhood(graph);
    if (moves.length === 0) break;
    
    // 2. Evaluate all candidate moves
    let bestMove: NeighborhoodMove | null = null;
    let bestMoveMakespan = Infinity;
    
    for (const move of moves) {
      const evaluation = evaluateMove(graph, move, stateChanges);
      totalMoves++;
      if (!evaluation.feasible) continue;
      
      const isTabu = tabu.isTabu(move, iter);
      const aspirationMet = evaluation.newMakespan < bestMakespan; // Global best override
      
      if (!isTabu || aspirationMet) {
        if (evaluation.newMakespan < bestMoveMakespan) {
          bestMoveMakespan = evaluation.newMakespan;
          bestMove = move;
        }
      }
    }
    
    // 3. Apply best move (even if it worsens current — escaping local optima)
    if (bestMove) {
      graph.swapOnResource(bestMove.resourceKey, bestMove.nodeIdxA, bestMove.nodeIdxB);
      graph.recomputeChangeovers(bestMove.resourceKey, bestMove.nodeIdxA, bestMove.nodeIdxB, stateChanges);
      graph.recomputeCriticalPath();
      tabu.add(bestMove, iter);
      
      if (graph.criticalPath!.makespan < bestMakespan) {
        bestMakespan = graph.criticalPath!.makespan;
        bestGraph = graph.clone();
        noImproveCount = 0;
      } else {
        noImproveCount++;
      }
    } else {
      noImproveCount++;
    }
    
    // 4. Stagnation check
    if (noImproveCount >= config.stagnationLimit) break;
  }
  
  let convergenceReason: 'stagnation' | 'time_budget' | 'max_iterations' = 'max_iterations';
  if (noImproveCount >= config.stagnationLimit) convergenceReason = 'stagnation';
  else if (Date.now() - startMs > config.timeBudgetMs) convergenceReason = 'time_budget';
  
  return {
    bestGraph,
    bestMakespan,
    originalMakespan,
    improvementPercent: ((originalMakespan - bestMakespan) / originalMakespan) * 100,
    totalIterations: iter,
    totalMovesEvaluated: totalMoves,
    convergenceReason,
  };
}
```

### Tests for Session 2
- 10-task, 3-resource landscape: tabu search finds improvement over constructive solve
- Tabu list prevents cycling: same swap not repeated within tenure window
- Aspiration criterion: tabu move accepted when it produces new global best
- Stagnation: search terminates when no improvement for N iterations
- Time budget: search terminates when wall clock exceeded
- Frozen tasks: never appear in generated neighborhood moves

---

## Session 3: Graph-to-Landscape Translation

**File:** `Engines/Optimization/graphtranslation.ts` (new)

### Goal
Translate an optimized DisjunctiveGraph back into a SchedulingLandscape so the result can be used by the existing API response pipeline.

### 3a. The Translation Challenge

The optimizer works in graph space (integer indices, arc orientations). The landscape works in engine space (CTPTask objects, CTPResource assignments, CTPInterval linked lists). Translation means: read the optimized task ordering from the graph, unschedule everything in the landscape, and reschedule in the new order using the existing ScheduleEngine.

### 3b. Translation Algorithm

```typescript
function applyOptimizedGraph(
  optimizedGraph: DisjunctiveGraph,
  landscape: SchedulingLandscape,
  scheduleEngine: ScheduleEngine,
  stateChangeEngine: StateChangeEngine,
  scoring: CTPScoring,
  settings: CTPAppSettings,
): TranslationResult {
  const result: TranslationResult = { 
    tasksRescheduled: 0, tasksFailed: 0, failedTaskKeys: [] 
  };
  
  // 1. Identify tasks that moved (diff between original and optimized positions)
  const movedNodes = optimizedGraph.nodes.filter(n => !n.isFrozen);
  
  // 2. Unschedule all non-frozen tasks (reverse order to avoid dependency issues)
  //    Use existing ScheduleEngine.unschedule() + state change cleanup
  const tasksToReschedule: CTPTask[] = [];
  for (const node of movedNodes) {
    const task = landscape.tasks.getEntity(node.key);
    if (!task) continue;
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      // Remove state change tasks first (same as basescheduler.unScheduleStateChanges)
      const stTasks = stateChangeEngine.getUnScheduleStateChangeTasks(task, landscape);
      for (const st of stTasks) {
        scheduleEngine.unschedule(landscape, st);
        landscape.tasks.removeEntity(st);
      }
      scheduleEngine.unschedule(landscape, task);
    }
    tasksToReschedule.push(task);
  }
  
  // 3. Topological sort of optimized graph nodes
  //    Process in the order the optimizer determined
  const topoOrder = topologicalSort(optimizedGraph);
  
  // 4. For each task in topological order, schedule at the optimized position
  for (const nodeIdx of topoOrder) {
    const node = optimizedGraph.nodes[nodeIdx];
    if (node.isFrozen) continue;
    
    const task = landscape.tasks.getEntity(node.key);
    if (!task) continue;
    
    // Build a minimal ScheduleContext for the target resource
    const targetResourceKey = node.resourceKey;
    const resource = landscape.resources.getEntity(targetResourceKey);
    if (!resource) { result.tasksFailed++; result.failedTaskKeys.push(node.key); continue; }
    
    // Force resource recompute (availability changed after unschedules)
    resource.recompute = true;
    
    // Use ScheduleEvaluator to find start times for this specific resource
    const evaluator = new ScheduleEvaluator();
    const contexts = evaluator.buildContexts(task, landscape);
    
    // Find the context matching the optimized resource assignment
    const matchingCtx = contexts.find(ctx => {
      let match = false;
      ctx.slot.resources?.forEach(r => {
        if (r.resource?.key === targetResourceKey) match = true;
      });
      return match;
    });
    
    if (!matchingCtx) { result.tasksFailed++; result.failedTaskKeys.push(node.key); continue; }
    
    // Compute start times
    const startTimes = evaluator.computeStartTimes(matchingCtx, landscape);
    if (!startTimes || !startTimes.atleastOne()) {
      result.tasksFailed++; result.failedTaskKeys.push(node.key); continue;
    }
    
    // Pick the start time closest to the graph's optimized position
    const targetStart = node.earliestStart;  // From optimized graph
    const startTimeNode = findClosestStartTime(startTimes, targetStart);
    if (!startTimeNode) { result.tasksFailed++; result.failedTaskKeys.push(node.key); continue; }
    
    // Build BestScheduleContext and schedule
    const best = new BestScheduleContext(matchingCtx, startTimeNode, startTimeNode.eStartW);
    scheduleEngine.schedule(landscape, task, best, settings.scheduleDirection);
    
    // Create state change tasks (changeovers)
    const scTasks = stateChangeEngine.getScheduleStateChangeTasks(task, best, landscape);
    for (const st of scTasks) {
      // Same logic as basescheduler.scheduleAStateChangeTask
      scheduleStateChangeTask(st, task, landscape, scheduleEngine, best);
    }
    
    result.tasksRescheduled++;
  }
  
  return result;
}
```

### 3c. Finding Closest Start Time

```typescript
function findClosestStartTime(startTimes: CTPStartTimes, targetStart: number): CTPStartTime | null {
  let best: CTPStartTime | null = null;
  let bestDelta = Infinity;
  
  let node = startTimes.head;
  while (node) {
    // Target might fall within this node's [eStartW, lStartW] range
    if (targetStart >= node.data.eStartW && targetStart <= node.data.lStartW) {
      return node.data;  // Exact match — target falls within this window
    }
    
    // Otherwise find closest
    const delta = Math.min(
      Math.abs(targetStart - node.data.eStartW),
      Math.abs(targetStart - node.data.lStartW)
    );
    if (delta < bestDelta) {
      bestDelta = delta;
      best = node.data;
    }
    node = node.next;
  }
  
  return best;
}
```

### 3d. Topological Sort for Scheduling Order

```typescript
function topologicalSort(graph: DisjunctiveGraph): number[] {
  const n = graph.nodes.length;
  const inDegree = new Int32Array(n);
  
  for (const node of graph.nodes) {
    for (const succ of [...node.conjSuccessors, ...node.disjSuccessors]) {
      inDegree[succ]++;
    }
  }
  
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }
  
  const order: number[] = [];
  while (queue.length > 0) {
    const idx = queue.shift()!;
    order.push(idx);
    const node = graph.nodes[idx];
    for (const succ of [...node.conjSuccessors, ...node.disjSuccessors]) {
      if (--inDegree[succ] === 0) queue.push(succ);
    }
  }
  
  return order;
}
```

### 3e. TranslationResult and Diff

```typescript
interface TranslationResult {
  tasksRescheduled: number;
  tasksFailed: number;
  failedTaskKeys: string[];
}

interface TaskDiff {
  taskKey: string;
  taskName: string;
  orderKey: string | null;
  originalStart: number;
  originalEnd: number;
  originalResource: string;
  optimizedStart: number;
  optimizedEnd: number;
  optimizedResource: string;
  startDelta: number;     // seconds (positive = moved later)
  movedResource: boolean; // resource changed
}

function computeDiff(
  originalGraph: DisjunctiveGraph,
  optimizedGraph: DisjunctiveGraph
): TaskDiff[] {
  const diffs: TaskDiff[] = [];
  
  for (let i = 0; i < originalGraph.nodes.length; i++) {
    const orig = originalGraph.nodes[i];
    const opt = optimizedGraph.nodes[i];
    
    if (orig.isFrozen) continue;
    
    const startDelta = opt.earliestStart - orig.earliestStart;
    const movedResource = opt.resourceKey !== orig.resourceKey;
    
    if (Math.abs(startDelta) > 60 || movedResource) {  // Only report moves > 1 min
      diffs.push({
        taskKey: orig.key,
        taskName: orig.name,
        orderKey: orig.chainKey,
        originalStart: orig.startW,
        originalEnd: orig.endW,
        originalResource: orig.resourceKey,
        optimizedStart: opt.earliestStart,
        optimizedEnd: opt.earliestStart + opt.duration,
        optimizedResource: opt.resourceKey,
        startDelta,
        movedResource,
      });
    }
  }
  
  // Sort by absolute impact (largest moves first)
  diffs.sort((a, b) => Math.abs(b.startDelta) - Math.abs(a.startDelta));
  return diffs;
}
```

### Tests for Session 3
- Optimize a 10-task landscape, translate back, verify all tasks still scheduled
- Verify changeover tasks are correctly recreated after translation
- Verify frozen/pinned tasks were not moved
- Verify resource assignments match the graph's optimized sequencing
- Verify diff correctly identifies which tasks moved and by how much
- Stress test: translate a 100-task optimization result, confirm no orphaned assignments

---

## Session 4: Scheduler Subclasses + Service Wiring

**New files:**
- `AI/Schedulers/tabusearchscheduler.ts`
- `AI/Schedulers/ilsscheduler.ts`
- `Engines/Optimization/perturbation.ts`

**Modified files:**
- `Models/Entities/appsettings.ts` — add tabu/ILS config fields
- `Models/Entities/solveresult.ts` — add optimization result
- `ctp/ctp.service.ts` — createScheduler() factory method

### Goal
Create TabuSearchScheduler and ILSScheduler subclasses. Wire into ctp_service.ts so strategy selection instantiates the right scheduler.

### 4a. TabuSearchScheduler

File: `AI/Schedulers/tabusearchscheduler.ts`

```typescript
import { CTPScheduler } from './defaultscheduler';
import { DisjunctiveGraph } from '../../Engines/Optimization/disjunctivegraph';
import { tabuSearch } from '../../Engines/Optimization/tabusearch';
import { TabuConfig } from '../../Engines/Optimization/types';
import { applyOptimizedGraph, computeDiff } from '../../Engines/Optimization/graphtranslation';
import { ScheduleEngine } from '../../Engines/scheduleengine';
import { StateChangeEngine } from '../../Engines/statechangeerengine';

export class TabuSearchScheduler extends CTPScheduler {

  protected endScheduling(): void {
    // Build graph from the constructive solution
    const graph = DisjunctiveGraph.buildFromLandscape(this.landscape);
    if (!graph.criticalPath || graph.criticalPath.criticalTasks < 3) return;
    
    const config = this.buildTabuConfig();
    const originalMakespan = graph.criticalPath.makespan;
    
    // Run tabu search
    const result = tabuSearch(graph, config, this.landscape.stateChanges);
    
    if (result.bestMakespan < originalMakespan) {
      // Translate improved graph back to landscape
      const originalGraph = DisjunctiveGraph.buildFromLandscape(this.landscape);
      const translation = applyOptimizedGraph(
        result.bestGraph,
        this.landscape,
        new ScheduleEngine(),
        new StateChangeEngine(),
        this.scoring!,
        this.settings!,
      );
      
      // Store optimization stats for the solve result
      this.optimizationResult = {
        originalMakespan,
        optimizedMakespan: result.bestMakespan,
        improvementPercent: result.improvementPercent,
        iterations: result.totalIterations,
        movesEvaluated: result.totalMovesEvaluated,
        convergenceReason: result.convergenceReason,
        tasksRescheduled: translation.tasksRescheduled,
        tasksFailed: translation.tasksFailed,
        diff: computeDiff(originalGraph, result.bestGraph),
      };
    }
  }
  
  private buildTabuConfig(): TabuConfig {
    const taskCount = this.landscape.tasks.size();
    return {
      tenure: Math.min(25, Math.max(10, Math.floor(Math.sqrt(taskCount)))),
      maxIterations: this.settings?.tabuIterations ?? 2000,
      stagnationLimit: this.settings?.tabuStagnation ?? 300,
      timeBudgetMs: this.settings?.tabuTimeBudgetMs ?? 30000,
      freezeHorizon: this.settings?.freezeHorizon ?? 0,
    };
  }
}
```

### 4b. ILSScheduler

File: `AI/Schedulers/ilsscheduler.ts`

```typescript
import { TabuSearchScheduler } from './tabusearchscheduler';
import { DisjunctiveGraph } from '../../Engines/Optimization/disjunctivegraph';
import { tabuSearch } from '../../Engines/Optimization/tabusearch';
import { TabuConfig } from '../../Engines/Optimization/types';
import { perturbGraph } from '../../Engines/Optimization/perturbation';
import { applyOptimizedGraph, computeDiff } from '../../Engines/Optimization/graphtranslation';

export class ILSScheduler extends TabuSearchScheduler {
  
  protected endScheduling(): void {
    const graph = DisjunctiveGraph.buildFromLandscape(this.landscape);
    if (!graph.criticalPath || graph.criticalPath.criticalTasks < 3) return;
    
    const config = this.buildTabuConfig();
    const passes = this.settings?.ilsPasses ?? 5;
    const perturbStrength = this.settings?.ilsPerturbStrength ?? 0.07;
    const totalBudgetMs = this.settings?.ilsTimeBudgetMs ?? 300000; // 5 min default
    const startMs = Date.now();
    
    const originalMakespan = graph.criticalPath.makespan;
    let globalBest = graph.clone();
    let globalBestMakespan = originalMakespan;
    const passResults: { pass: number; makespan: number; improvement: number; iterations: number }[] = [];
    
    for (let pass = 0; pass < passes; pass++) {
      // Perturb (except first pass — use constructive solution)
      const working = (pass === 0) ? graph.clone() : perturbGraph(globalBest.clone(), perturbStrength);
      
      // Run tabu search with per-pass budget
      const perPassBudget = Math.floor((totalBudgetMs - (Date.now() - startMs)) / (passes - pass));
      config.timeBudgetMs = Math.max(5000, perPassBudget);
      
      const result = tabuSearch(working, config, this.landscape.stateChanges);
      
      passResults.push({
        pass: pass + 1,
        makespan: result.bestMakespan,
        improvement: ((originalMakespan - result.bestMakespan) / originalMakespan) * 100,
        iterations: result.totalIterations,
      });
      
      if (result.bestMakespan < globalBestMakespan) {
        globalBestMakespan = result.bestMakespan;
        globalBest = result.bestGraph;
      }
      
      // Check total time budget
      if (Date.now() - startMs > totalBudgetMs) break;
    }
    
    if (globalBestMakespan < originalMakespan) {
      const originalGraph = DisjunctiveGraph.buildFromLandscape(this.landscape);
      const translation = applyOptimizedGraph(
        globalBest, this.landscape,
        new ScheduleEngine(), new StateChangeEngine(),
        this.scoring!, this.settings!,
      );
      
      this.optimizationResult = {
        originalMakespan,
        optimizedMakespan: globalBestMakespan,
        improvementPercent: ((originalMakespan - globalBestMakespan) / originalMakespan) * 100,
        iterations: passResults.reduce((s, p) => s + p.iterations, 0),
        passes: passResults,
        convergenceReason: 'ils_complete',
        tasksRescheduled: translation.tasksRescheduled,
        tasksFailed: translation.tasksFailed,
        diff: computeDiff(originalGraph, globalBest),
      };
    }
  }
}
```

### 4c. Perturbation Function

File: `Engines/Optimization/perturbation.ts`

```typescript
function perturbGraph(graph: DisjunctiveGraph, strength: number): DisjunctiveGraph {
  // Collect all non-frozen disjunctive arcs
  const swappableArcs: { resourceKey: string; nodeA: number; nodeB: number }[] = [];
  
  for (const [resourceKey, seq] of graph.resourceSequences) {
    for (let i = 0; i < seq.length - 1; i++) {
      if (!graph.nodes[seq[i]].isFrozen && !graph.nodes[seq[i + 1]].isFrozen) {
        swappableArcs.push({ resourceKey, nodeA: seq[i], nodeB: seq[i + 1] });
      }
    }
  }
  
  // Randomly reverse a fraction of arcs
  const count = Math.ceil(swappableArcs.length * strength);
  const shuffled = [...swappableArcs].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < count; i++) {
    const arc = shuffled[i];
    graph.swapOnResource(arc.resourceKey, arc.nodeA, arc.nodeB);
    // Skip if creates cycle
    if (graph.hasCycle()) {
      graph.reverseSwap({ resourceKey: arc.resourceKey, nodeIdxA: arc.nodeA, nodeIdxB: arc.nodeB });
    }
  }
  
  graph.recomputeCriticalPath();
  return graph;
}
```

### 4d. Wire into ctp_service.ts

The `solve()` method in ctp_service.ts currently does:

```typescript
const scheduler = new CTPScheduler();
```

Change to:

```typescript
private createScheduler(strategy: string): CTPBaseScheduler {
  switch (strategy) {
    case 'Thorough':
      return new TabuSearchScheduler();
    case 'Best':
    case 'ILS':
      return new ILSScheduler();
    default:
      return new CTPScheduler();
  }
}
```

The existing interface (`initLandscape`, `initSettings`, `initScoring`, `schedule`) is identical across all three. No other changes to ctp_service.ts needed.

### 4e. CTPAppSettings Extensions

Add to CTPAppSettings:

```typescript
// Tabu search settings
tabuIterations?: number;         // Default: 2000
tabuStagnation?: number;         // Default: 300
tabuTimeBudgetMs?: number;       // Default: 30000 (30s for Thorough)
freezeHorizon?: number;          // Epoch seconds — don't move tasks before this

// ILS settings  
ilsPasses?: number;              // Default: 5
ilsPerturbStrength?: number;     // Default: 0.07
ilsTimeBudgetMs?: number;        // Default: 300000 (5 min)
```

### 4f. CTPSolveResult Extensions

Add to CTPSolveResult:

```typescript
optimization?: {
  originalMakespan: number;
  optimizedMakespan: number;
  improvementPercent: number;
  iterations: number;
  movesEvaluated?: number;
  passes?: { pass: number; makespan: number; improvement: number; iterations: number }[];
  convergenceReason: string;
  tasksRescheduled: number;
  tasksFailed: number;
  diff: TaskDiff[];
};
```

### Tests for Session 4
- TabuSearchScheduler produces a better makespan than CTPScheduler on a 50-task landscape
- ILSScheduler with 3 passes produces a better makespan than single tabu pass
- Strategy selection in ctp_service correctly instantiates the right scheduler
- CTPSolveResult includes optimization stats when Thorough/Best strategy used
- Frozen tasks are respected during optimization
- Setting tabuTimeBudgetMs = 1000 causes early termination

---

## Session 5: Batch Optimization API

**New files:**
- `ctp/optimize.controller.ts`
- `ctp/optimize.service.ts`

### Goal
Add async job endpoints for overnight/2-3x daily optimization runs. The batch API kicks off an ILS optimization in the background and lets the planner poll for progress and accept/reject the result.

### 5a. New Endpoints

```
POST /v1/ctp/optimize           → kick off background optimization job
GET  /v1/ctp/optimize/:jobId    → poll status + results
POST /v1/ctp/optimize/:jobId/accept  → commit optimized schedule
POST /v1/ctp/optimize/:jobId/reject  → discard and keep original
```

### 5b. Optimize Controller

File: `ctp/optimize.controller.ts`

Add to the existing CTP module. The POST /optimize endpoint:
1. Snapshots the current landscape state
2. Queues an ILS optimization job (Redis or in-process for v1)
3. Returns a jobId immediately

The GET /optimize/:jobId endpoint:
1. Checks job status (queued, running, complete, failed)
2. While running: returns progress (current pass, iterations, best makespan so far)
3. When complete: returns full result with diff, pass results, stats

The POST /optimize/:jobId/accept endpoint:
1. Takes the optimized landscape snapshot and replaces the current landscape
2. Returns the new solve state

The POST /optimize/:jobId/reject endpoint:
1. Discards the optimization result
2. Returns confirmation

### 5c. Job Store

For v1, use an in-memory map. For production, use Redis or Azure Service Bus.

```typescript
interface OptimizeJob {
  jobId: string;
  tenantId: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  config: { timeBudgetSeconds: number; passes: number; freezeHorizon?: string };
  progress?: { currentPass: number; totalPasses: number; bestMakespanSoFar: number; improvementPercent: number; elapsedSeconds: number };
  result?: OptimizationResult;
  landscapeSnapshot?: SchedulingLandscape;  // Frozen copy of the optimized state
  error?: string;
}
```

### 5d. Async Execution

For v1 (single-process NestJS), use a setTimeout/setImmediate to run the ILS in the background without blocking the event loop. The optimization runs on the snapshotted landscape, not the live one.

For production: Azure Service Bus queue → worker process.

### Tests for Session 5
- POST /optimize returns jobId immediately
- GET /optimize/:jobId returns running status with progress
- GET /optimize/:jobId returns complete status with diff
- POST /optimize/:jobId/accept replaces landscape state
- POST /optimize/:jobId/reject leaves landscape unchanged
- Concurrent requests to the same tenant are rejected (one job at a time)

---

## Performance Budget at 1000 Tasks

| Operation | Time | Notes |
|-----------|------|-------|
| Graph construction | 5-10ms | O(T+E), one-time |
| Critical path (full pass) | 2-5ms | O(T+E), per iteration |
| Neighborhood generation | <1ms | Scan critical blocks |
| Single move evaluation | 5-12ms | Swap + changeover + cycle check + critical path + restore |
| Full iteration (40-80 moves) | 200-500ms | Evaluate all + apply best |
| One tabu pass (2000 iter) | 7-15 min | May terminate early |
| Five ILS passes | 10-30 min | Depends on time budget |
| Graph-to-landscape translation | 500ms-2s | Unschedule + reschedule all moved tasks |

---

## Files Created/Modified

| File | Action | Session |
|------|--------|---------|
| `Engines/Optimization/types.ts` | **New** — TabuConfig, TabuSearchResult, NeighborhoodMove, MoveEvaluation, CriticalBlock, SwapRecord, TaskDiff | 1 |
| `Engines/Optimization/disjunctivegraph.ts` | **Moved + Extended** — add adjacency arrays, swap, clone, cycle check, changeover recompute, public recomputeCriticalPath | 1 |
| `Engines/Optimization/tabusearch.ts` | **New** — TabuList, generateNeighborhood, evaluateMove, tabuSearch main loop | 2 |
| `Engines/Optimization/graphtranslation.ts` | **New** — applyOptimizedGraph, findClosestStartTime, topologicalSort, computeDiff | 3 |
| `Engines/Optimization/perturbation.ts` | **New** — perturbGraph (random arc reversal for ILS restarts) | 4 |
| `AI/Schedulers/tabusearchscheduler.ts` | **New** — TabuSearchScheduler extends CTPScheduler, overrides endScheduling() | 4 |
| `AI/Schedulers/ilsscheduler.ts` | **New** — ILSScheduler extends TabuSearchScheduler, multi-pass with perturbation | 4 |
| `Models/Entities/appsettings.ts` | **Modified** — add tabuIterations, tabuStagnation, tabuTimeBudgetMs, freezeHorizon, ilsPasses, ilsPerturbStrength, ilsTimeBudgetMs | 4 |
| `Models/Entities/solveresult.ts` | **Modified** — add optimization result with diff, pass results, convergence stats | 4 |
| `ctp/ctp.service.ts` | **Modified** — createScheduler() factory method for strategy routing | 4 |
| `ctp/optimize.controller.ts` | **New** — POST /optimize, GET /optimize/:jobId, POST accept/reject | 5 |
| `ctp/optimize.service.ts` | **New** — job store, async execution, landscape snapshot management | 5 |

**Not modified:** CTPBaseScheduler, CTPScheduler, ChainContextEngine, ScheduleEngine, ScoringEngine, StartTimeEngine, AvailableEngine, StateChangeEngine, SetEngine, CombinationEngine, any agents, any neighborhoods, any scoring rules.
