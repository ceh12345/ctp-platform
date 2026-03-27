# Disjunctive Graph — Phase A Design & Phase B Architecture

## Overview

A disjunctive graph represents a schedule as a directed graph where the **critical path** (longest path) determines the makespan. Phase A builds the graph read-only from any solved schedule. Phase B (future) will use it as the foundation for metaheuristic improvement — tabu search, neighborhood moves, iterative local search.

Phase A powers four consumers at launch:
1. **AI diagnose** — "what's driving the makespan?"
2. **Gantt visualization** — highlight the critical path
3. **Analytics KPI** — critical path length, bottleneck resource, slack per task
4. **WhereTo** — prioritize moves that shorten the critical path

---

## Concepts

### What a disjunctive graph is

Every scheduling problem can be represented as a graph with three types of edges:

**Conjunctive arcs** — hard precedence. Task A must finish before Task B starts. These come from your `linkId.prevLink` chains and maxGap constraints. They are fixed — the solver can't change them.

**Disjunctive arcs** — resource sequencing. Two tasks share the same resource, so one must go before the other. The solver decides the direction. In a completed schedule, all disjunctive arcs are **oriented** — we know which task went first.

**The critical path** — the longest weighted path from the schedule start to the schedule end. Every task on this path has **zero slack** — if any of them slips, the makespan increases. Tasks NOT on the critical path have **positive slack** — they could shift without affecting the overall schedule length.

### Why this matters

Today, if a planner asks "why does the schedule take 14 hours?", there's no answer in the engine. The makespan is just `max(endW) - min(startW)` across all tasks. With the disjunctive graph, you can trace the exact chain of tasks and resource-sequencing decisions that creates the makespan, identify which resource is the bottleneck (most time spent on the critical path), and compute how much slack each non-critical task has.

For Phase B, the critical path is also the **only place where improvements are possible**. Swapping two tasks that aren't on the critical path can never reduce the makespan. This is the key insight that makes neighborhood search efficient — you only explore moves on the critical path instead of searching the entire solution space.

---

## Data Model

### DisjunctiveGraph

The primary data structure. Built once after any solve, queried by multiple consumers.

```typescript
export interface DisjunctiveNode {
  /** Task key */
  key: string;
  name: string;
  type: string;                       // PROCESS, SET_UP, TEAR_DOWN, etc.
  chainKey: string | null;            // linkId.name (order/case)

  /** Scheduled position */
  resourceKey: string;                // which resource this task is on
  startW: number;                     // engine time units
  endW: number;
  duration: number;                   // endW - startW (includes changeover if applicable)

  /** Graph edges (indices into the node array for fast traversal) */
  conjunctivePred: number | null;     // predecessor in chain (linkId.prevLink)
  conjunctiveSucc: number | null;     // successor in chain
  disjunctivePred: number | null;     // previous task on same resource (time-ordered)
  disjunctiveSucc: number | null;     // next task on same resource (time-ordered)

  /** Critical path analysis results */
  earliestStart: number;              // forward pass — earliest possible start
  latestStart: number;                // backward pass — latest start without delaying makespan
  totalSlack: number;                 // latestStart - earliestStart
  isOnCriticalPath: boolean;          // totalSlack === 0

  /** For Phase B: which "block" this node belongs to on the critical path */
  criticalBlockId: number | null;     // group of consecutive critical-path tasks on same resource
}

export interface DisjunctiveEdge {
  from: number;                       // node index
  to: number;                         // node index
  type: 'conjunctive' | 'disjunctive';
  weight: number;                     // duration of the "from" task (edge weight = processing time)
  resourceKey: string | null;         // which resource this disjunctive edge is on (null for conjunctive)
}

export interface CriticalPathSegment {
  /** A contiguous run of critical-path tasks on the same resource */
  resourceKey: string;
  resourceName: string;
  tasks: { key: string; name: string; startW: number; endW: number; duration: number }[];
  totalDuration: number;              // sum of task durations in this segment
}

export interface CriticalPathResult {
  /** The full critical path, ordered from start to end */
  path: DisjunctiveNode[];

  /** The critical path broken into segments by resource */
  segments: CriticalPathSegment[];

  /** Total critical path length (= makespan) */
  makespan: number;

  /** The resource with the most time on the critical path */
  bottleneckResource: { resourceKey: string; resourceName: string; totalCriticalTime: number };

  /** Summary stats */
  totalTasks: number;
  criticalTasks: number;
  avgSlack: number;                   // average slack across non-critical tasks
  minNonCriticalSlack: number;        // the near-critical task with least slack
}

export class DisjunctiveGraph {
  public nodes: DisjunctiveNode[];
  public edges: DisjunctiveEdge[];
  public criticalPath: CriticalPathResult | null;

  /** Node lookup by task key */
  private nodeIndex: Map<string, number>;

  /** Nodes grouped by resource key (for disjunctive arc construction) */
  private byResource: Map<string, number[]>;

  constructor() {
    this.nodes = [];
    this.edges = [];
    this.criticalPath = null;
    this.nodeIndex = new Map();
    this.byResource = new Map();
  }
}
```

### Why node indices instead of pointers

The graph uses integer indices into the `nodes[]` array rather than object references. This is deliberate for Phase B — neighborhood moves need to swap edges efficiently, and index-based adjacency is faster to serialize, clone, and diff than pointer-based. It also makes the graph trivially serializable for the API response and solve replay.

---

## Phase A: Build & Analyze (Read-Only)

### Step 1: Build nodes from solved landscape

After any solve, construct the graph from the scheduled tasks:

```typescript
public static buildFromLandscape(landscape: SchedulingLandscape): DisjunctiveGraph {
  const graph = new DisjunctiveGraph();

  // 1. Create nodes for all scheduled tasks
  landscape.tasks.forEach(task => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;

    const primaryResource = task.capacityResources
      ?.find(tr => tr.isPrimary)?.scheduledResource ?? '';

    const nodeIdx = graph.nodes.length;
    graph.nodeIndex.set(task.key, nodeIdx);

    graph.nodes.push({
      key: task.key,
      name: task.name,
      type: task.type ?? 'PROCESS',
      chainKey: task.linkId?.name ?? null,
      resourceKey: primaryResource,
      startW: task.scheduled.startW,
      endW: task.scheduled.endW,
      duration: task.scheduled.endW - task.scheduled.startW,
      conjunctivePred: null,
      conjunctiveSucc: null,
      disjunctivePred: null,
      disjunctiveSucc: null,
      earliestStart: 0,
      latestStart: 0,
      totalSlack: 0,
      isOnCriticalPath: false,
      criticalBlockId: null,
    });

    // Group by resource
    if (!graph.byResource.has(primaryResource)) {
      graph.byResource.set(primaryResource, []);
    }
    graph.byResource.get(primaryResource)!.push(nodeIdx);
  });

  // 2. Build conjunctive arcs (chain precedence)
  for (const node of graph.nodes) {
    const task = landscape.tasks.getEntity(node.key);
    if (!task?.linkId?.prevLink) continue;

    const predIdx = graph.nodeIndex.get(task.linkId.prevLink);
    if (predIdx !== undefined) {
      node.conjunctivePred = predIdx;
      graph.nodes[predIdx].conjunctiveSucc = graph.nodeIndex.get(node.key)!;

      graph.edges.push({
        from: predIdx,
        to: graph.nodeIndex.get(node.key)!,
        type: 'conjunctive',
        weight: graph.nodes[predIdx].duration,
        resourceKey: null,
      });
    }
  }

  // 3. Build disjunctive arcs (resource sequencing)
  //    Sort tasks on each resource by start time, then link sequentially
  for (const [resourceKey, nodeIndices] of graph.byResource) {
    const sorted = [...nodeIndices].sort((a, b) => graph.nodes[a].startW - graph.nodes[b].startW);

    for (let i = 0; i < sorted.length - 1; i++) {
      const fromIdx = sorted[i];
      const toIdx = sorted[i + 1];

      graph.nodes[fromIdx].disjunctiveSucc = toIdx;
      graph.nodes[toIdx].disjunctivePred = fromIdx;

      graph.edges.push({
        from: fromIdx,
        to: toIdx,
        type: 'disjunctive',
        weight: graph.nodes[fromIdx].duration,
        resourceKey,
      });
    }
  }

  // 4. Compute critical path
  graph.computeCriticalPath();

  return graph;
}
```

### Step 2: Critical path computation (forward/backward pass)

Standard longest-path algorithm on a DAG — topological sort, then forward pass for earliest times, backward pass for latest times, slack = latest - earliest.

```typescript
public computeCriticalPath(): void {
  const n = this.nodes.length;
  if (n === 0) { this.criticalPath = null; return; }

  // ─── Forward pass: earliest start times ───
  // Topological order (by startW is already valid since the schedule is feasible)
  const topoOrder = [...Array(n).keys()].sort((a, b) => this.nodes[a].startW - this.nodes[b].startW);

  // Initialize
  for (const node of this.nodes) {
    node.earliestStart = 0;
  }

  for (const idx of topoOrder) {
    const node = this.nodes[idx];
    const es = node.earliestStart + node.duration;

    // Propagate to conjunctive successor
    if (node.conjunctiveSucc !== null) {
      const succ = this.nodes[node.conjunctiveSucc];
      if (es > succ.earliestStart) succ.earliestStart = es;
    }
    // Propagate to disjunctive successor (next task on same resource)
    if (node.disjunctiveSucc !== null) {
      const succ = this.nodes[node.disjunctiveSucc];
      if (es > succ.earliestStart) succ.earliestStart = es;
    }
  }

  // Makespan = max(earliestStart + duration) across all nodes
  let makespan = 0;
  for (const node of this.nodes) {
    const finish = node.earliestStart + node.duration;
    if (finish > makespan) makespan = finish;
  }

  // ─── Backward pass: latest start times ───
  for (const node of this.nodes) {
    node.latestStart = makespan - node.duration;  // initialize to latest possible
  }

  // Reverse topological order
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const idx = topoOrder[i];
    const node = this.nodes[idx];

    // The latest start of this node is constrained by its successors
    if (node.conjunctiveSucc !== null) {
      const succLs = this.nodes[node.conjunctiveSucc].latestStart;
      if (succLs - node.duration < node.latestStart) {
        node.latestStart = succLs - node.duration;
      }
    }
    if (node.disjunctiveSucc !== null) {
      const succLs = this.nodes[node.disjunctiveSucc].latestStart;
      if (succLs - node.duration < node.latestStart) {
        node.latestStart = succLs - node.duration;
      }
    }
  }

  // ─── Compute slack and mark critical path ───
  for (const node of this.nodes) {
    node.totalSlack = node.latestStart - node.earliestStart;
    node.isOnCriticalPath = Math.abs(node.totalSlack) < 1;  // < 1 second tolerance
  }

  // ─── Extract critical path in order ───
  const criticalNodes = this.nodes
    .filter(n => n.isOnCriticalPath)
    .sort((a, b) => a.earliestStart - b.earliestStart);

  // ─── Build segments (contiguous critical-path tasks on same resource) ───
  const segments: CriticalPathSegment[] = [];
  let currentSegment: CriticalPathSegment | null = null;

  for (const node of criticalNodes) {
    if (!currentSegment || currentSegment.resourceKey !== node.resourceKey) {
      currentSegment = {
        resourceKey: node.resourceKey,
        resourceName: node.resourceKey,  // will be enriched from landscape
        tasks: [],
        totalDuration: 0,
      };
      segments.push(currentSegment);
    }
    currentSegment.tasks.push({
      key: node.key, name: node.name,
      startW: node.startW, endW: node.endW, duration: node.duration,
    });
    currentSegment.totalDuration += node.duration;
  }

  // ─── Identify bottleneck resource ───
  const resourceCriticalTime = new Map<string, number>();
  for (const node of criticalNodes) {
    const prev = resourceCriticalTime.get(node.resourceKey) ?? 0;
    resourceCriticalTime.set(node.resourceKey, prev + node.duration);
  }
  let bottleneckKey = '';
  let bottleneckTime = 0;
  for (const [key, time] of resourceCriticalTime) {
    if (time > bottleneckTime) { bottleneckKey = key; bottleneckTime = time; }
  }

  // ─── Non-critical task stats ───
  const nonCritical = this.nodes.filter(n => !n.isOnCriticalPath);
  const avgSlack = nonCritical.length > 0
    ? nonCritical.reduce((s, n) => s + n.totalSlack, 0) / nonCritical.length
    : 0;
  const minNonCriticalSlack = nonCritical.length > 0
    ? Math.min(...nonCritical.map(n => n.totalSlack))
    : 0;

  this.criticalPath = {
    path: criticalNodes,
    segments,
    makespan,
    bottleneckResource: { resourceKey: bottleneckKey, resourceName: bottleneckKey, totalCriticalTime: bottleneckTime },
    totalTasks: this.nodes.length,
    criticalTasks: criticalNodes.length,
    avgSlack,
    minNonCriticalSlack,
  };
}
```

### Step 3: Phase B-ready — Critical blocks

For future neighborhood search, identify **critical blocks** — consecutive critical-path tasks on the same resource. These are the units that tabu search operates on: swapping tasks within or between critical blocks is the neighborhood move.

```typescript
private identifyCriticalBlocks(): void {
  if (!this.criticalPath) return;

  let blockId = 0;
  let prevResource: string | null = null;

  for (const node of this.criticalPath.path) {
    if (node.resourceKey !== prevResource) {
      blockId++;
      prevResource = node.resourceKey;
    }
    node.criticalBlockId = blockId;
  }
}
```

Phase B's tabu search will use these blocks to generate moves:
- **Intra-block swap**: swap two adjacent tasks within a critical block
- **Inter-block move**: move the first or last task of a critical block to a different position

These are the classic Taillard/Nowicki-Smutnicki neighborhood operators. We don't implement them yet, but the block IDs are ready.

---

## Consumer Integration

### Consumer 1: AI Diagnose

The `POST /ctp/diagnose` endpoint gains a new root cause type and a new global recommendation:

```typescript
// New root cause type
type: 'critical_path_bottleneck'
summary: 'Makespan is driven by CNC-01 — 6.5h of the 14h critical path runs on this resource'

// New global recommendation
{
  id: 'global-critical-path',
  action: 'critical_path_insight',
  description: 'CNC-01 accounts for 46% of the critical path. Moving TASK-007 to CNC-02 would shorten the critical path by ~2h.',
  score: 15,
  tradeoffs: {
    gains: ['Makespan reduced by ~2h', 'CNC-01 utilization drops from 97% to 83%'],
    costs: ['CNC-02 utilization increases from 45% to 60%', 'Changeover added on CNC-02'],
  },
  commands: [{ type: 'move_to', taskKey: 'TASK-007', ... }],
}
```

The diagnose endpoint checks the critical path after running its existing analysis and adds insights for tasks that are both infeasible AND on the critical path (highest priority for resolution).

### Consumer 2: Gantt Visualization

The solve response includes the critical path data:

```typescript
// Added to CTPSolveResult
criticalPath?: {
  taskKeys: string[];                     // ordered list of task keys on the critical path
  makespan: number;
  bottleneckResource: string;
  segments: { resourceKey: string; taskKeys: string[]; totalDuration: number }[];
}
```

The Gantt renders critical-path tasks with a distinct visual treatment — a brighter border, a subtle glow, or a colored accent line along the top. A toggle ("Show Critical Path") enables/disables the highlighting. Critical-path segments on the same resource get a connecting line.

### Consumer 3: Analytics KPI

New KPIs for the Analytics tab:

| KPI | Value | Source |
|-----|-------|--------|
| Critical path length | 14.0h | `criticalPath.makespan` |
| Critical tasks | 8 of 42 | `criticalPath.criticalTasks` / `totalTasks` |
| Bottleneck resource | CNC-01 (6.5h / 46%) | `criticalPath.bottleneckResource` |
| Average slack | 3.2h | `criticalPath.avgSlack` |
| Near-critical tasks | 4 tasks with <30min slack | count where `totalSlack < 1800` |

A detail view shows the critical path as a horizontal strip (like a mini-Gantt), with segments colored by resource and durations labeled.

### Consumer 4: WhereTo Enhancement

When computing WhereTo options for a task, check whether the task is on the critical path. If it is, evaluate whether each option shortens the critical path:

```typescript
// In WhereTo option scoring, add:
if (graph.criticalPath && graph.isOnCriticalPath(taskKey)) {
  // For each option, estimate the critical path impact:
  // - If the option moves the task to a less-loaded resource, the critical path may shorten
  // - If the option moves it earlier on the same resource, the path length is unchanged
  // - If the option moves it to a more-loaded resource, the path may lengthen

  option.criticalPathImpact = estimateCriticalPathDelta(graph, taskKey, option);
  // Positive = worsens makespan, negative = improves makespan
}
```

For Phase A, this is an **estimate** — we don't rebuild the full graph for each option (that's Phase B's job). Instead, we use the slack values: if moving a task off the critical path frees the bottleneck resource, the makespan likely improves by roughly the freed duration. This heuristic is fast and usually directionally correct.

---

## API

### Endpoint: `GET /ctp/critical-path`

Returns the critical path analysis for the current schedule:

```typescript
@Get('critical-path')
@ApiOperation({ summary: 'Compute and return critical path analysis for the current schedule' })
@ApiResponse({ status: 200, description: 'Critical path result' })
getCriticalPath() {
  return this.ctpService.getCriticalPath();
}
```

Service implementation:
```typescript
getCriticalPath(): CriticalPathResult & { nodes: DisjunctiveNode[] } {
  const landscape = this.ensureLandscape();
  const graph = DisjunctiveGraph.buildFromLandscape(landscape);

  // Enrich resource names
  if (graph.criticalPath) {
    for (const segment of graph.criticalPath.segments) {
      const resource = landscape.resources.getEntity(segment.resourceKey);
      segment.resourceName = resource?.name ?? segment.resourceKey;
    }
    const bnResource = landscape.resources.getEntity(graph.criticalPath.bottleneckResource.resourceKey);
    graph.criticalPath.bottleneckResource.resourceName = bnResource?.name ?? graph.criticalPath.bottleneckResource.resourceKey;
  }

  return {
    ...graph.criticalPath!,
    nodes: graph.nodes,  // full node list with slack values for the UI
  };
}
```

### Include in solve response (optional, gated)

For the solve response, include a summary (not the full node list) to keep the payload small:

```typescript
// In extractResults(), after building the solve response:
if (detailLevel === 'expert' || detailLevel === 'diagnostic') {
  const graph = DisjunctiveGraph.buildFromLandscape(landscape);
  if (graph.criticalPath) {
    result.criticalPath = {
      taskKeys: graph.criticalPath.path.map(n => n.key),
      makespan: graph.criticalPath.makespan,
      bottleneckResource: graph.criticalPath.bottleneckResource.resourceKey,
      segments: graph.criticalPath.segments.map(s => ({
        resourceKey: s.resourceKey,
        taskKeys: s.tasks.map(t => t.key),
        totalDuration: s.totalDuration,
      })),
    };
  }
}
```

Gated to expert/diagnostic detail levels so it doesn't bloat the default response.

---

## Phase B Preview — What the Graph Enables

When you're ready for Phase B, the disjunctive graph becomes the improvement engine:

### Neighborhood moves (Taillard N7 / Nowicki-Smutnicki)

```
Current critical path on CNC-01: [TASK-003] → [TASK-007] → [TASK-012]
                                    block 1

Candidate move: swap TASK-007 and TASK-012 within block 1
  → Rebuild disjunctive arcs for CNC-01
  → Recompute critical path (O(n) — just forward/backward pass)
  → New makespan: 12.5h (was 14h) → accept!
```

### Tabu search skeleton (not implemented in Phase A)

```typescript
// Phase B pseudocode — NOT part of Phase A sprint
function tabuSearch(graph: DisjunctiveGraph, maxIterations: number, tabuTenure: number): DisjunctiveGraph {
  let best = graph.clone();
  let current = graph.clone();
  const tabuList: Map<string, number> = new Map();  // move hash → iteration expires

  for (let iter = 0; iter < maxIterations; iter++) {
    const moves = generateCriticalBlockMoves(current);

    let bestMove = null;
    let bestMakespan = Infinity;

    for (const move of moves) {
      if (tabuList.has(move.hash) && tabuList.get(move.hash)! > iter) {
        // Tabu — skip unless aspiration criterion (better than best known)
        if (move.estimatedMakespan >= best.criticalPath!.makespan) continue;
      }

      applyMove(current, move);
      current.computeCriticalPath();

      if (current.criticalPath!.makespan < bestMakespan) {
        bestMakespan = current.criticalPath!.makespan;
        bestMove = move;
      }

      reverseMove(current, move);  // undo for next candidate
    }

    if (bestMove) {
      applyMove(current, bestMove);
      current.computeCriticalPath();
      tabuList.set(bestMove.reverseHash, iter + tabuTenure);

      if (current.criticalPath!.makespan < best.criticalPath!.makespan) {
        best = current.clone();
      }
    }
  }

  return best;
}
```

The key Phase A deliverables that Phase B needs:
- `DisjunctiveGraph` with nodes, edges, and fast index lookups ✓
- `computeCriticalPath()` that runs in O(n) ✓
- Critical block identification ✓
- A `clone()` method for snapshot/restore during search (add in Phase A as a utility)

---

## Multi-Resource Consideration

Your healthcare tenant has tasks that require multiple resources simultaneously (surgeon + anesthesiologist + OR + nurse). In the classic job shop disjunctive graph, each task is on exactly one machine. For multi-resource tasks, the graph needs disjunctive arcs on **every** resource the task uses.

```
CASE-001 PROC uses: OR-01, Dr. Smith, AN-JONES, RN-01
  → disjunctive arcs on OR-01's timeline (between CASE-001 and other OR-01 tasks)
  → disjunctive arcs on Dr. Smith's timeline
  → disjunctive arcs on AN-JONES's timeline
  → disjunctive arcs on RN-01's timeline
```

For critical path analysis, this means a task can be critical due to **any** of its resources. The forward/backward pass handles this naturally — the earliest start is constrained by the latest-finishing predecessor across ALL resources, not just one.

In the `buildFromLandscape` method, change to iterate over all capacity resources, not just the primary:

```typescript
// For each task, create disjunctive arcs on EVERY assigned resource
task.capacityResources?.forEach(tr => {
  if (!tr.scheduledResource) return;
  const resKey = tr.scheduledResource;

  if (!graph.byResource.has(resKey)) {
    graph.byResource.set(resKey, []);
  }
  graph.byResource.get(resKey)!.push(nodeIdx);
});
```

The node still has a single `resourceKey` (the primary), but disjunctive edges exist on all assigned resources. The critical path computation considers all of them.

---

## Verification Checklist

### Graph construction
- [ ] Every scheduled task becomes a node
- [ ] Unscheduled/excluded/pinned tasks are included if scheduled, excluded if not
- [ ] Conjunctive arcs match `linkId.prevLink` chains
- [ ] Disjunctive arcs exist for every resource a task is assigned to (multi-resource)
- [ ] Disjunctive arcs are ordered by startW on each resource
- [ ] No cycles in the graph (should be guaranteed by a feasible schedule)

### Critical path
- [ ] Forward pass computes correct earliest start times
- [ ] Backward pass computes correct latest start times
- [ ] Slack = latest - earliest, correct for all nodes
- [ ] Critical path nodes have slack ≈ 0 (within 1s tolerance)
- [ ] Makespan from critical path matches `max(endW) - min(startW)` from the solve
- [ ] Critical path is contiguous (no gaps — every critical node connects to the next via a conjunctive or disjunctive arc)

### Segments and bottleneck
- [ ] Segments correctly group consecutive critical-path tasks on the same resource
- [ ] Bottleneck resource is the one with the most critical-path time
- [ ] Segment durations sum to ≤ makespan (can be less due to conjunctive arcs between segments)

### Consumers
- [ ] `GET /ctp/critical-path` returns complete analysis
- [ ] Solve response includes `criticalPath` summary at expert/diagnostic level
- [ ] Gantt can highlight critical-path tasks from the task key list
- [ ] Analytics KPI shows critical path length, bottleneck resource, and task count
- [ ] AI diagnose references critical path when explaining makespan
- [ ] WhereTo annotates options with critical path impact estimate

### Cross-tenant
- [ ] Manufacturing (Stafford): job shop with single-resource tasks → classic disjunctive graph
- [ ] Healthcare (Acme): multi-resource chains → disjunctive arcs on all assigned resources
- [ ] Sports (HRMD): field + equipment → multi-resource, cadence boundaries respected
- [ ] Empty schedule (no tasks scheduled) → null critical path, no errors

### Phase B readiness
- [ ] Critical block IDs assigned
- [ ] Graph is cloneable (for snapshot during search)
- [ ] Node indices are stable (no object references — index-based adjacency)
- [ ] `computeCriticalPath()` runs in O(n) — fast enough for iterative re-evaluation

---

## Size Estimate

- Data model + graph construction: ~1.5 hours
- Critical path computation (forward/backward pass): ~1 hour
- API endpoint + solve response integration: ~30 min
- Multi-resource edge handling: ~30 min
- Consumer wiring (AI diagnose, analytics KPI): ~1 hour
- Gantt critical path highlighting: ~1 hour (frontend)
- WhereTo impact estimate: ~1 hour
- Testing across tenants: ~30 min
- **Total: ~7-8 hours** (can be split across sessions)

---

## Build Order

1. **Data model** — `DisjunctiveGraph`, `DisjunctiveNode`, edges, indices
2. **buildFromLandscape** — construct graph from solved schedule, single-resource first
3. **computeCriticalPath** — forward/backward pass, slack, bottleneck
4. **API endpoint** — `GET /ctp/critical-path`
5. **Solve response integration** — summary at expert+ level
6. **Multi-resource edges** — extend to all assigned resources
7. **Critical block identification** — Phase B prep
8. **Consumer wiring** — AI diagnose, analytics KPI, Gantt, WhereTo

Test after steps 3 and 6. Steps 7-8 can be incremental.

---

*Depends on: Working solve (any strategy). No engine changes required — purely additive.*
*Phase B depends on: Phase A complete, `preserveLandscape` (for live graph mutations), solver tier infrastructure.*
