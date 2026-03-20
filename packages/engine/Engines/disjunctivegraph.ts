import { SchedulingLandscape } from '../Models/Entities/landscape';
import { CTPTaskStateConstants, CTPTaskTypeConstants } from '../Models/Core/constants';
import { CTPDateTime } from '../Models/Core/date';
import { CTPTaskResource } from '../Models/Entities/task';

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

      let primaryKey = '';
      task.capacityResources?.forEach((tr: CTPTaskResource) => {
        if (tr.isPrimary && tr.scheduledResource) primaryKey = tr.scheduledResource;
      });
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
    for (const [resourceKey, nodeIndices] of graph.byResource) {
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
    graph.computeCriticalPath();

    // ─── 5. Identify critical blocks (Phase B prep) ───
    graph.identifyCriticalBlocks();

    return graph;
  }

  /**
   * Compute critical path via forward/backward pass.
   * After this, every node has earliestStart, latestStart, totalSlack, isOnCriticalPath.
   */
  private computeCriticalPath(): void {
    const n = this.nodes.length;
    if (n === 0) { this.criticalPath = null; return; }

    // ─── Build adjacency from edges ───
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
    const SLACK_TOLERANCE = 1; // 1 second tolerance
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

  private identifyCriticalBlocks(): void {
    if (!this.criticalPath) return;

    let blockId = 0;
    let prevResource: string | null = null;

    for (const pathNode of this.criticalPath.path) {
      const idx = this.nodeIndex.get(pathNode.key);
      if (idx === undefined) continue;

      if (this.nodes[idx].resourceKey !== prevResource) {
        blockId++;
        prevResource = this.nodes[idx].resourceKey;
      }
      this.nodes[idx].criticalBlockId = blockId;
    }
  }
}
