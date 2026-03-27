# Engine Sprint: Disjunctive Graph — Phase A Session 1

**What it does:** After any solve, build a disjunctive graph from the scheduled landscape and compute the critical path. Expose via `GET /ctp/critical-path` endpoint and include a summary in the solve response at expert+ detail levels. Handles multi-resource tasks (healthcare, sports).

**Size:** ~3 hours CC work (Steps 1-6 of the full Phase A)
**Depends on:** Working solve (any strategy). Purely additive — no existing code changes.
**Unlocks:** Session 2 (Analytics KPIs + AI diagnose), Session 3 (Gantt highlighting + WhereTo enhancement)

---

## Why

Today, if a planner asks "why does the schedule take 14 hours?", the engine has no answer. Makespan is just `max(endW) - min(startW)`. With a disjunctive graph, we can trace the exact chain of tasks and resource-sequencing decisions that creates the makespan, identify the bottleneck resource, and compute how much slack each non-critical task has.

This is also the foundation for future metaheuristic improvement (tabu search, ILS) — Phase B will use the graph's critical blocks to generate neighborhood moves. Phase A builds the data structure right so Phase B can extend it.

---

## Part 1: DisjunctiveGraph Class

Create: `Engines/disjunctivegraph.ts`

This is a standalone engine class — no dependencies on CTPService, no mutation of the landscape. Pure computation from a solved schedule.

```typescript
import { SchedulingLandscape } from '../Models/Entities/landscape';
import { CTPTaskStateConstants, CTPTaskTypeConstants } from '../Models/Core/constants';
import { CTPDateTime } from '../Models/Core/date';

// ─── Interfaces ───

export interface DisjunctiveNode {
  key: string;
  name: string;
  type: string;
  chainKey: string | null;

  /** Primary resource (for display). Disjunctive edges may exist on other resources too. */
  resourceKey: string;
  resourceName: string;
  startW: number;
  endW: number;
  duration: number;

  /** Graph edges (indices into nodes array) */
  conjunctivePred: number | null;
  conjunctiveSucc: number | null;
  /** Disjunctive edges are per-resource — stored in resourceEdges map */

  /** Critical path analysis */
  earliestStart: number;
  latestStart: number;
  totalSlack: number;
  isOnCriticalPath: boolean;
  criticalBlockId: number | null;
}

export interface DisjunctiveEdge {
  from: number;
  to: number;
  type: 'conjunctive' | 'disjunctive';
  weight: number;
  resourceKey: string | null;
}

export interface CriticalPathSegment {
  resourceKey: string;
  resourceName: string;
  tasks: { key: string; name: string; startW: number; endW: number; duration: number; start: string; end: string }[];
  totalDuration: number;
}

export interface CriticalPathResult {
  path: { key: string; name: string; type: string; chainKey: string | null; resourceKey: string; resourceName: string; duration: number; slack: number; start: string; end: string }[];
  segments: CriticalPathSegment[];
  makespan: number;
  makespanFormatted: string;
  bottleneckResource: { resourceKey: string; resourceName: string; totalCriticalTime: number; percentOfCriticalPath: number };
  totalTasks: number;
  criticalTasks: number;
  avgSlack: number;
  minNonCriticalSlack: number;
  nearCriticalTasks: number;
}
```

---

## Part 2: Graph Construction

```typescript
export class DisjunctiveGraph {
  public nodes: DisjunctiveNode[] = [];
  public edges: DisjunctiveEdge[] = [];
  public criticalPath: CriticalPathResult | null = null;

  private nodeIndex = new Map<string, number>();
  private byResource = new Map<string, number[]>();

  /**
   * Build the disjunctive graph from a solved landscape.
   * Only includes scheduled tasks.
   */
  public static buildFromLandscape(landscape: SchedulingLandscape): DisjunctiveGraph {
    const graph = new DisjunctiveGraph();

    // ─── 1. Create nodes for all scheduled tasks ───
    landscape.tasks.forEach(task => {
      if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;

      const primaryRes = task.capacityResources
        ?.toArray().find(tr => tr.isPrimary);
      const primaryKey = primaryRes?.scheduledResource ?? '';
      const primaryResource = landscape.resources?.getEntity(primaryKey);

      const nodeIdx = graph.nodes.length;
      graph.nodeIndex.set(task.key, nodeIdx);

      graph.nodes.push({
        key: task.key,
        name: task.name,
        type: task.type ?? CTPTaskTypeConstants.PROCESS,
        chainKey: task.linkId?.name ?? null,
        resourceKey: primaryKey,
        resourceName: primaryResource?.name ?? primaryKey,
        startW: task.scheduled.startW,
        endW: task.scheduled.endW,
        duration: task.scheduled.endW - task.scheduled.startW,
        conjunctivePred: null,
        conjunctiveSucc: null,
        earliestStart: 0,
        latestStart: 0,
        totalSlack: 0,
        isOnCriticalPath: false,
        criticalBlockId: null,
      });

      // ─── Group by EVERY assigned resource (multi-resource support) ───
      // A healthcare task assigned to OR-01 + Dr. Smith + AN-JONES
      // gets disjunctive edges on all three resource timelines
      task.capacityResources?.forEach(tr => {
        if (!tr.scheduledResource) return;
        const rk = tr.scheduledResource;
        if (!graph.byResource.has(rk)) graph.byResource.set(rk, []);
        graph.byResource.get(rk)!.push(nodeIdx);
      });
    });

    // ─── 2. Build conjunctive arcs (chain precedence) ───
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i];
      const task = landscape.tasks.getEntity(node.key);
      if (!task?.linkId?.prevLink) continue;

      const predIdx = graph.nodeIndex.get(task.linkId.prevLink);
      if (predIdx === undefined) continue;

      node.conjunctivePred = predIdx;
      graph.nodes[predIdx].conjunctiveSucc = i;

      graph.edges.push({
        from: predIdx,
        to: i,
        type: 'conjunctive',
        weight: graph.nodes[predIdx].duration,
        resourceKey: null,
      });
    }

    // ─── 3. Build disjunctive arcs (resource sequencing) ───
    // On each resource, sort tasks by startW and link sequentially
    for (const [resourceKey, nodeIndices] of graph.byResource) {
      // Deduplicate (a multi-resource task might appear multiple times)
      const unique = [...new Set(nodeIndices)];
      const sorted = unique.sort((a, b) => graph.nodes[a].startW - graph.nodes[b].startW);

      for (let i = 0; i < sorted.length - 1; i++) {
        graph.edges.push({
          from: sorted[i],
          to: sorted[i + 1],
          type: 'disjunctive',
          weight: graph.nodes[sorted[i]].duration,
          resourceKey,
        });
      }
    }

    // ─── 4. Compute critical path ───
    graph.computeCriticalPath(landscape);

    // ─── 5. Identify critical blocks (Phase B prep) ───
    graph.identifyCriticalBlocks();

    return graph;
  }
```

---

## Part 3: Critical Path Computation

Forward pass (earliest start) + backward pass (latest start) on the DAG. Uses the edge list, not node adjacency, to handle multi-resource edges correctly.

```typescript
  /**
   * Compute critical path via forward/backward pass.
   * After this, every node has earliestStart, latestStart, totalSlack, isOnCriticalPath.
   */
  private computeCriticalPath(landscape: SchedulingLandscape): void {
    const n = this.nodes.length;
    if (n === 0) { this.criticalPath = null; return; }

    // ─── Build adjacency from edges ───
    // successors[i] = list of node indices that i points to
    // predecessors[i] = list of node indices that point to i
    const successors: number[][] = Array.from({ length: n }, () => []);
    const predecessors: number[][] = Array.from({ length: n }, () => []);

    for (const edge of this.edges) {
      successors[edge.from].push(edge.to);
      predecessors[edge.to].push(edge.from);
    }

    // ─── Forward pass: earliest start ───
    // Topological order — sort by scheduled startW (valid for a feasible schedule)
    const topoOrder = [...Array(n).keys()].sort((a, b) => this.nodes[a].startW - this.nodes[b].startW);

    for (const node of this.nodes) {
      node.earliestStart = 0;
    }

    for (const idx of topoOrder) {
      const node = this.nodes[idx];
      const finishTime = node.earliestStart + node.duration;

      for (const succIdx of successors[idx]) {
        if (finishTime > this.nodes[succIdx].earliestStart) {
          this.nodes[succIdx].earliestStart = finishTime;
        }
      }
    }

    // Makespan = max(earliestStart + duration) across all nodes
    let makespan = 0;
    for (const node of this.nodes) {
      const finish = node.earliestStart + node.duration;
      if (finish > makespan) makespan = finish;
    }

    // ─── Backward pass: latest start ───
    for (const node of this.nodes) {
      node.latestStart = makespan - node.duration;
    }

    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const idx = topoOrder[i];
      const node = this.nodes[idx];

      for (const succIdx of successors[idx]) {
        const latestFinish = this.nodes[succIdx].latestStart;
        if (latestFinish - node.duration < node.latestStart) {
          node.latestStart = latestFinish - node.duration;
        }
      }
    }

    // ─── Slack and critical path marking ───
    const SLACK_TOLERANCE = 1; // 1 second tolerance for floating point
    for (const node of this.nodes) {
      node.totalSlack = node.latestStart - node.earliestStart;
      node.isOnCriticalPath = node.totalSlack < SLACK_TOLERANCE;
    }

    // ─── Build the result ───
    const criticalNodes = this.nodes
      .filter(nd => nd.isOnCriticalPath)
      .sort((a, b) => a.earliestStart - b.earliestStart);

    // Segments: group consecutive critical-path nodes by resource
    const segments: CriticalPathSegment[] = [];
    let currentSeg: CriticalPathSegment | null = null;

    for (const nd of criticalNodes) {
      if (!currentSeg || currentSeg.resourceKey !== nd.resourceKey) {
        currentSeg = {
          resourceKey: nd.resourceKey,
          resourceName: nd.resourceName,
          tasks: [],
          totalDuration: 0,
        };
        segments.push(currentSeg);
      }
      currentSeg.tasks.push({
        key: nd.key,
        name: nd.name,
        startW: nd.startW,
        endW: nd.endW,
        duration: nd.duration,
        start: CTPDateTime.toDateTime(nd.startW).toISO()!,
        end: CTPDateTime.toDateTime(nd.endW).toISO()!,
      });
      currentSeg.totalDuration += nd.duration;
    }

    // Bottleneck: resource with the most critical-path time
    const resCritTime = new Map<string, { time: number; name: string }>();
    for (const nd of criticalNodes) {
      const prev = resCritTime.get(nd.resourceKey);
      resCritTime.set(nd.resourceKey, {
        time: (prev?.time ?? 0) + nd.duration,
        name: nd.resourceName,
      });
    }
    let bnKey = '', bnTime = 0, bnName = '';
    for (const [key, val] of resCritTime) {
      if (val.time > bnTime) { bnKey = key; bnTime = val.time; bnName = val.name; }
    }

    // Non-critical stats
    const nonCritical = this.nodes.filter(nd => !nd.isOnCriticalPath);
    const avgSlack = nonCritical.length > 0
      ? Math.round(nonCritical.reduce((s, nd) => s + nd.totalSlack, 0) / nonCritical.length)
      : 0;
    const minNonCritSlack = nonCritical.length > 0
      ? Math.min(...nonCritical.map(nd => nd.totalSlack))
      : 0;
    const nearCriticalThreshold = 1800; // 30 minutes
    const nearCriticalCount = nonCritical.filter(nd => nd.totalSlack < nearCriticalThreshold).length;

    // Format makespan as human-readable
    const makespanHrs = Math.floor(makespan / 3600);
    const makespanMin = Math.floor((makespan % 3600) / 60);
    const makespanFormatted = makespanHrs > 0
      ? `${makespanHrs}h ${makespanMin}m`
      : `${makespanMin}m`;

    this.criticalPath = {
      path: criticalNodes.map(nd => ({
        key: nd.key,
        name: nd.name,
        type: nd.type,
        chainKey: nd.chainKey,
        resourceKey: nd.resourceKey,
        resourceName: nd.resourceName,
        duration: nd.duration,
        slack: nd.totalSlack,
        start: CTPDateTime.toDateTime(nd.startW).toISO()!,
        end: CTPDateTime.toDateTime(nd.endW).toISO()!,
      })),
      segments,
      makespan,
      makespanFormatted,
      bottleneckResource: {
        resourceKey: bnKey,
        resourceName: bnName,
        totalCriticalTime: bnTime,
        percentOfCriticalPath: makespan > 0 ? Math.round((bnTime / makespan) * 100) : 0,
      },
      totalTasks: this.nodes.length,
      criticalTasks: criticalNodes.length,
      avgSlack,
      minNonCriticalSlack: minNonCritSlack,
      nearCriticalTasks: nearCriticalCount,
    };
  }
```

---

## Part 4: Critical Block Identification (Phase B Prep)

Critical blocks are groups of consecutive critical-path tasks on the same resource. Phase B's tabu search will swap tasks within/between these blocks. We assign the IDs now so the data structure is ready.

```typescript
  private identifyCriticalBlocks(): void {
    if (!this.criticalPath) return;

    let blockId = 0;
    let prevResource: string | null = null;

    for (const pathNode of this.criticalPath.path) {
      // Find the actual graph node and set blockId
      const idx = this.nodeIndex.get(pathNode.key);
      if (idx === undefined) continue;

      if (this.nodes[idx].resourceKey !== prevResource) {
        blockId++;
        prevResource = this.nodes[idx].resourceKey;
      }
      this.nodes[idx].criticalBlockId = blockId;
    }
  }
```

---

## Part 5: Per-Task Slack in Solve Response

Add `slack` and `isOnCriticalPath` to each task in the solve response. This lets the UI and AI reference slack without a separate API call.

In `ctp_service.ts`, in the `extractResults` method, after building the task results array, compute the graph and annotate:

```typescript
// At the end of extractResults(), before the return:

// ─── Critical path analysis (expert+ or when any tasks are scheduled) ───
if (scheduledCount > 0) {
  const { DisjunctiveGraph } = require('../engines/disjunctivegraph');
  const graph = DisjunctiveGraph.buildFromLandscape(landscape);

  // Annotate per-task slack and critical path status
  if (graph.criticalPath) {
    for (const node of graph.nodes) {
      const taskResult = tasks.find((t: any) => t.key === node.key);
      if (taskResult) {
        taskResult.slack = node.totalSlack;
        taskResult.isOnCriticalPath = node.isOnCriticalPath;
        taskResult.criticalBlockId = node.criticalBlockId;
      }
    }
  }

  // Include critical path summary at intermediate+ detail level
  if (detailLevel !== 'novice' && graph.criticalPath) {
    (result as any).criticalPath = {
      taskKeys: graph.criticalPath.path.map((p: any) => p.key),
      makespan: graph.criticalPath.makespan,
      makespanFormatted: graph.criticalPath.makespanFormatted,
      bottleneckResource: graph.criticalPath.bottleneckResource,
      criticalTasks: graph.criticalPath.criticalTasks,
      totalTasks: graph.criticalPath.totalTasks,
      avgSlack: graph.criticalPath.avgSlack,
      nearCriticalTasks: graph.criticalPath.nearCriticalTasks,
      segments: graph.criticalPath.segments.map((s: any) => ({
        resourceKey: s.resourceKey,
        resourceName: s.resourceName,
        taskKeys: s.tasks.map((t: any) => t.key),
        totalDuration: s.totalDuration,
      })),
    };
  }
}
```

**Note on the `result as any` cast:** The `CTPSolveResult` interface will need `criticalPath?: any` added. Do this alongside the code.

---

## Part 6: API Endpoint

### 6a. Controller

Add to `ctp_controller.ts`:

```typescript
// ─── Endpoint 10: Critical Path Analysis ───

@Get('critical-path')
@ApiOperation({
  summary: 'Compute critical path analysis for the current schedule',
  description: 'Builds a disjunctive graph from the scheduled landscape and returns the critical path, bottleneck resource, per-task slack, and critical-path segments by resource. Read-only — does not modify the schedule.',
})
@ApiResponse({ status: 200, description: 'Critical path analysis' })
@ApiResponse({ status: 400, description: 'No scheduled tasks' })
getCriticalPath() {
  return this.ctpService.getCriticalPath();
}
```

### 6b. Service

Add to `ctp_service.ts`:

```typescript
// ═══════════════════════════════════════
// Endpoint 10: Critical Path Analysis
// ═══════════════════════════════════════

getCriticalPath(): any {
  const landscape = this.ensureLandscape();

  // Check that there are scheduled tasks
  let scheduledCount = 0;
  landscape.tasks.forEach(t => {
    if (t.state === CTPTaskStateConstants.SCHEDULED) scheduledCount++;
  });

  if (scheduledCount === 0) {
    throw new HttpException('No scheduled tasks — solve first', HttpStatus.BAD_REQUEST);
  }

  const graph = DisjunctiveGraph.buildFromLandscape(landscape);

  if (!graph.criticalPath) {
    return { status: 'no_critical_path', message: 'Could not compute critical path' };
  }

  return {
    status: 'ok',
    ...graph.criticalPath,
    // Include full node list with slack values for detailed analysis
    nodes: graph.nodes.map(nd => ({
      key: nd.key,
      name: nd.name,
      type: nd.type,
      chainKey: nd.chainKey,
      resourceKey: nd.resourceKey,
      resourceName: nd.resourceName,
      start: CTPDateTime.toDateTime(nd.startW).toISO()!,
      end: CTPDateTime.toDateTime(nd.endW).toISO()!,
      duration: nd.duration,
      slack: nd.totalSlack,
      isOnCriticalPath: nd.isOnCriticalPath,
      criticalBlockId: nd.criticalBlockId,
    })),
  };
}
```

Don't forget to add the import at the top of `ctp_service.ts`:

```typescript
import { DisjunctiveGraph } from '../engines/disjunctivegraph';
```

And the import + endpoint in the controller.

---

## Part 7: Add to CTPSolveResult Interface

In `ctp_service.ts`, extend the `CTPSolveResult` interface:

```typescript
export interface CTPSolveResult {
  // ... existing fields ...

  /** Critical path analysis (included at intermediate+ detail level) */
  criticalPath?: {
    taskKeys: string[];
    makespan: number;
    makespanFormatted: string;
    bottleneckResource: { resourceKey: string; resourceName: string; totalCriticalTime: number; percentOfCriticalPath: number };
    criticalTasks: number;
    totalTasks: number;
    avgSlack: number;
    nearCriticalTasks: number;
    segments: { resourceKey: string; resourceName: string; taskKeys: string[]; totalDuration: number }[];
  };
}
```

---

## Verification

### Graph construction
- [ ] Every scheduled PROCESS, SETUP, TEARDOWN task becomes a node
- [ ] Unscheduled tasks are NOT in the graph
- [ ] Conjunctive arcs match `linkId.prevLink` — verify with Acme healthcare chains (SETUP → PROC → RECOVERY)
- [ ] Disjunctive arcs exist for ALL assigned resources (not just primary) — verify with Acme (OR + surgeon + anesthesiologist)
- [ ] Disjunctive arcs are sorted by startW per resource — no inversions
- [ ] No duplicate edges (deduplicate multi-resource node indices per resource)

### Critical path
- [ ] Makespan from critical path ≈ `summary.makespan` from solve (may differ slightly due to time unit granularity)
- [ ] All critical-path nodes have slack < 1 second
- [ ] Non-critical nodes have positive slack
- [ ] Forward pass: no node has `earliestStart` earlier than its predecessors' finish
- [ ] Backward pass: no node has `latestStart` later than would delay its successors

### Multi-resource (Acme Healthcare)
- [ ] A case PROC task using OR-01 + Dr. Smith has disjunctive edges on both resource timelines
- [ ] Critical path correctly identifies multi-resource bottleneck (e.g., anesthesiologist is the scarcest)
- [ ] Slack reflects the tightest constraint across all assigned resources

### Segments and bottleneck
- [ ] Segments correctly group consecutive critical-path tasks by resource
- [ ] Bottleneck resource has the highest `totalCriticalTime`
- [ ] `percentOfCriticalPath` is correct (totalCriticalTime / makespan × 100)

### API
- [ ] `GET /ctp/critical-path` returns full analysis with nodes, path, segments, bottleneck
- [ ] `GET /ctp/critical-path` returns 400 if no tasks are scheduled
- [ ] Solve response includes `criticalPath` summary at intermediate+ detail level
- [ ] Solve response at novice level does NOT include `criticalPath` (keep payload small)
- [ ] Per-task `slack` and `isOnCriticalPath` fields present on every scheduled task in solve response

### Cross-tenant
- [ ] Willoughby Manufacturing: single-resource tasks, chain precedence
- [ ] Acme Healthcare: multi-resource tasks, 5-resource chains
- [ ] HRMD Sports: multi-resource with cadence, 3-phase chains
- [ ] Stafford Engineering: job shop, greedy strategy, some standalone tasks
- [ ] Summit Pharma: chain tasks with changeovers

### Phase B readiness
- [ ] Critical block IDs assigned on graph nodes
- [ ] Block boundaries change when resource changes on the critical path

---

*After this session: `GET /ctp/critical-path` works, solve response includes per-task slack + critical path summary. Ready for Session 2 (Analytics KPIs + AI diagnose) and Session 3 (Gantt highlighting + WhereTo enhancement).*
