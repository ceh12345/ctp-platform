import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPTaskStateConstants, CTPTaskTypeConstants, CTPWipStateConstants } from '../../Models/Core/constants';
import { CTPDateTime } from '../../Models/Core/date';
import { CTPTaskResource } from '../../Models/Entities/task';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CriticalBlock, SwapRecord } from './types';

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

  /** Legacy single-link fields — kept for backward compatibility. */
  conjunctivePred: number | null;
  conjunctiveSucc: number | null;

  /** Adjacency arrays — authoritative source for optimization. O(1) traversal. */
  disjPredecessors: number[];    // resource sequencing predecessors (node indices)
  disjSuccessors: number[];      // resource sequencing successors
  conjPredecessors: number[];    // chain predecessors (may be >1 for multi-pred)
  conjSuccessors: number[];      // chain successors

  /** Freeze control — optimizer cannot move frozen nodes. */
  isFrozen: boolean;

  /** Changeover support. */
  changeoverBefore: number;      // changeover seconds before this task on its resource
  processKey: string;            // for changeover lookups (fromProcess → toProcess)

  /** Critical path analysis. */
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

// ─── Utility ───

function removeFromArray(arr: number[], value: number): void {
  const idx = arr.indexOf(value);
  if (idx !== -1) arr.splice(idx, 1);
}

// ─── DisjunctiveGraph ───

export class DisjunctiveGraph {
  public nodes: DisjunctiveNode[] = [];
  public edges: DisjunctiveEdge[] = [];
  public criticalPath: CriticalPathResult | null = null;

  /** resourceKey → node indices in scheduled order */
  public resourceSequences = new Map<string, number[]>();

  private nodeIndex = new Map<string, number>();
  private byResource = new Map<string, number[]>();

  /**
   * Build the disjunctive graph from a solved landscape.
   * Only includes scheduled tasks.
   */
  public static buildFromLandscape(
    landscape: SchedulingLandscape,
    freezeHorizon = 0,
  ): DisjunctiveGraph {
    const graph = new DisjunctiveGraph();

    // ─── 1. Create nodes for all scheduled tasks ───
    landscape.tasks.forEach(task => {
      if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;
      if (task.wipstate === CTPWipStateConstants.COMPLETED) return;

      let primaryKey = '';
      task.capacityResources?.forEach((tr: CTPTaskResource) => {
        if (tr.isPrimary && tr.scheduledResource) primaryKey = tr.scheduledResource;
      });
      const primaryResource = landscape.resources?.getEntity(primaryKey);

      const nodeIdx = graph.nodes.length;
      graph.nodeIndex.set(task.key, nodeIdx);

      const isFrozen =
        !!task.pinned ||
        (task.wipstate !== undefined && task.wipstate !== CTPWipStateConstants.NOT_STARTED) ||
        (freezeHorizon > 0 && task.scheduled.startW < freezeHorizon);

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
        disjPredecessors: [],
        disjSuccessors: [],
        conjPredecessors: [],
        conjSuccessors: [],
        isFrozen,
        changeoverBefore: 0,
        processKey: task.process ?? '',
        earliestStart: 0,
        latestStart: 0,
        totalSlack: 0,
        isOnCriticalPath: false,
        criticalBlockId: null,
      });

      // Group by EVERY assigned resource (multi-resource support)
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
      // Guard against a self-referential chain link (prevLink === own key). Some
      // source feeds emit these on chain heads; left unguarded they create a
      // conjunctive self-loop, which makes the topological sort in
      // recomputeCriticalPath() report a cycle and null the entire critical path
      // (makespan 0 → optimizer bails with insufficient_critical_tasks).
      if (predIdx === i) continue;

      // Time-contradicted precedence guard (2026-08-04 full-book finding):
      // historical actuals can record a predecessor ENDING after its
      // successor STARTED (overlapping completed/pinned pairs, e.g. Stafford
      // 29634/29425 — the shop's own recorded reality). Such an arc runs
      // backward against the time-oriented disjunctive chains; a handful of
      // them cycle the graph and trapped 1,047 of 1,447 nodes, nulling the
      // critical path and silently disabling the tabu/ILS tier. Recorded
      // times win — skip the contradicted arc (feasibly-scheduled arcs
      // always satisfy predEnd <= succStart, so live precedence is kept).
      if (graph.nodes[predIdx].endW > node.startW) continue;

      // Legacy single-link fields
      node.conjunctivePred = predIdx;
      graph.nodes[predIdx].conjunctiveSucc = i;

      // Adjacency arrays
      node.conjPredecessors.push(predIdx);
      graph.nodes[predIdx].conjSuccessors.push(i);

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

      // Store resource sequence
      graph.resourceSequences.set(resourceKey, [...sorted]);

      for (let i = 0; i < sorted.length - 1; i++) {
        const fromIdx = sorted[i];
        const toIdx = sorted[i + 1];

        // Adjacency arrays
        graph.nodes[fromIdx].disjSuccessors.push(toIdx);
        graph.nodes[toIdx].disjPredecessors.push(fromIdx);

        graph.edges.push({
          from: fromIdx,
          to: toIdx,
          type: 'disjunctive',
          weight: graph.nodes[fromIdx].duration + graph.nodes[toIdx].changeoverBefore,
          resourceKey,
        });
      }
    }

    // ─── 4. Compute critical path ───
    graph.recomputeCriticalPath();

    // ─── 5. Identify critical blocks ───
    graph.identifyCriticalBlocks();

    return graph;
  }

  /**
   * Compute (or recompute) critical path using Kahn's topological sort on adjacency arrays.
   * Safe to call after swap operations when startW values are stale.
   * Sets criticalPath = null if a cycle is detected.
   */
  public recomputeCriticalPath(): void {
    const n = this.nodes.length;
    if (n === 0) { this.criticalPath = null; return; }

    // ─── Kahn's topological sort via in-degrees ───
    const inDegree = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      for (const s of this.nodes[i].conjSuccessors) inDegree[s]++;
      for (const s of this.nodes[i].disjSuccessors) inDegree[s]++;
    }

    const queue: number[] = [];
    let head = 0;
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    const topoOrder: number[] = [];
    while (head < queue.length) {
      const idx = queue[head++];
      topoOrder.push(idx);
      for (const s of this.nodes[idx].conjSuccessors) {
        if (--inDegree[s] === 0) queue.push(s);
      }
      for (const s of this.nodes[idx].disjSuccessors) {
        if (--inDegree[s] === 0) queue.push(s);
      }
    }

    // Cycle detected — safety net (hasCycle() should be called before committing swaps)
    if (topoOrder.length < n) {
      this.criticalPath = null;
      return;
    }

    // ─── Forward pass: earliest start ───
    for (const node of this.nodes) node.earliestStart = 0;

    for (const idx of topoOrder) {
      const node = this.nodes[idx];
      const finishTime = node.earliestStart + node.duration;

      for (const succIdx of node.conjSuccessors) {
        if (finishTime > this.nodes[succIdx].earliestStart) {
          this.nodes[succIdx].earliestStart = finishTime;
        }
      }
      for (const succIdx of node.disjSuccessors) {
        const arrival = finishTime + this.nodes[succIdx].changeoverBefore;
        if (arrival > this.nodes[succIdx].earliestStart) {
          this.nodes[succIdx].earliestStart = arrival;
        }
      }
    }

    // Makespan
    let makespan = 0;
    for (const node of this.nodes) {
      const finish = node.earliestStart + node.duration;
      if (finish > makespan) makespan = finish;
    }

    // ─── Backward pass: latest start ───
    for (const node of this.nodes) node.latestStart = makespan - node.duration;

    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const idx = topoOrder[i];
      const node = this.nodes[idx];

      for (const succIdx of node.conjSuccessors) {
        const latestFinish = this.nodes[succIdx].latestStart;
        if (latestFinish - node.duration < node.latestStart) {
          node.latestStart = latestFinish - node.duration;
        }
      }
      for (const succIdx of node.disjSuccessors) {
        const latestFinish = this.nodes[succIdx].latestStart - this.nodes[succIdx].changeoverBefore;
        if (latestFinish - node.duration < node.latestStart) {
          node.latestStart = latestFinish - node.duration;
        }
      }
    }

    // ─── Slack and critical path marking ───
    const SLACK_TOLERANCE = 1;
    for (const node of this.nodes) {
      node.totalSlack = node.latestStart - node.earliestStart;
      node.isOnCriticalPath = node.totalSlack < SLACK_TOLERANCE;
    }

    this.criticalPath = this.buildCriticalPathResult(makespan);
  }

  /**
   * Identify critical blocks (runs of ≥2 consecutive critical-path tasks on one resource).
   * Returns the blocks and sets criticalBlockId on each node.
   */
  public identifyCriticalBlocks(): CriticalBlock[] {
    const blocks: CriticalBlock[] = [];
    if (!this.criticalPath) return blocks;

    const makespan = this.criticalPath.makespan;
    const criticalKeys = new Set<string>(this.criticalPath.path.map(p => p.key));

    let blockId = 0;

    for (const [resourceKey, seq] of this.resourceSequences) {
      let runNodes: number[] = [];

      const flush = () => {
        if (runNodes.length >= 2) {
          blockId++;
          const totalDuration = runNodes.reduce((s, idx) => s + this.nodes[idx].duration, 0);
          const resourceName = this.nodes[runNodes[0]].resourceName;
          const block: CriticalBlock = {
            id: blockId,
            resourceKey,
            resourceName,
            nodeIndices: [...runNodes],
            firstIdx: runNodes[0],
            lastIdx: runNodes[runNodes.length - 1],
            totalDuration,
            percentOfMakespan: makespan > 0 ? Math.round((totalDuration / makespan) * 100) : 0,
          };
          blocks.push(block);
          for (const idx of runNodes) {
            this.nodes[idx].criticalBlockId = blockId;
          }
        }
        runNodes = [];
      };

      for (const nodeIdx of seq) {
        if (criticalKeys.has(this.nodes[nodeIdx].key)) {
          runNodes.push(nodeIdx);
        } else {
          flush();
        }
      }
      flush();
    }

    return blocks;
  }

  /**
   * Swap two tasks on a resource. nodeIdxA must currently be before nodeIdxB.
   * Updates adjacency arrays, resource sequence, and flat edges.
   * Returns a SwapRecord for reversal.
   */
  public swapOnResource(
    resourceKey: string,
    nodeIdxA: number,
    nodeIdxB: number,
  ): SwapRecord {
    const seq = this.resourceSequences.get(resourceKey);
    if (!seq) throw new Error(`swapOnResource: resource '${resourceKey}' not found`);

    const posA = seq.indexOf(nodeIdxA);
    const posB = seq.indexOf(nodeIdxB);
    if (posA === -1 || posB === -1) throw new Error(`swapOnResource: node indices not found in sequence`);
    if (posA >= posB) throw new Error(`swapOnResource: nodeIdxA (pos ${posA}) must be before nodeIdxB (pos ${posB})`);

    const predIdx = posA > 0 ? seq[posA - 1] : -1;
    const succIdx = posB < seq.length - 1 ? seq[posB + 1] : -1;

    // ─── Remove old disjunctive adjacency ───
    // pred → A (if pred exists)
    if (predIdx !== -1) {
      removeFromArray(this.nodes[predIdx].disjSuccessors, nodeIdxA);
      removeFromArray(this.nodes[nodeIdxA].disjPredecessors, predIdx);
    }
    // A → B
    removeFromArray(this.nodes[nodeIdxA].disjSuccessors, nodeIdxB);
    removeFromArray(this.nodes[nodeIdxB].disjPredecessors, nodeIdxA);
    // B → succ (if succ exists)
    if (succIdx !== -1) {
      removeFromArray(this.nodes[nodeIdxB].disjSuccessors, succIdx);
      removeFromArray(this.nodes[succIdx].disjPredecessors, nodeIdxB);
    }

    // ─── Add new disjunctive adjacency ───
    // pred → B
    if (predIdx !== -1) {
      this.nodes[predIdx].disjSuccessors.push(nodeIdxB);
      this.nodes[nodeIdxB].disjPredecessors.push(predIdx);
    }
    // B → A
    this.nodes[nodeIdxB].disjSuccessors.push(nodeIdxA);
    this.nodes[nodeIdxA].disjPredecessors.push(nodeIdxB);
    // A → succ
    if (succIdx !== -1) {
      this.nodes[nodeIdxA].disjSuccessors.push(succIdx);
      this.nodes[succIdx].disjPredecessors.push(nodeIdxA);
    }

    // ─── Swap in resource sequence ───
    seq[posA] = nodeIdxB;
    seq[posB] = nodeIdxA;

    // ─── Rebuild flat disjunctive edges for this resource ───
    this.rebuildDisjunctiveEdgesForResource(resourceKey);

    return { resourceKey, nodeIdxA, nodeIdxB };
  }

  /**
   * Reverse a swap. After swapOnResource(A, B), B is before A.
   * Calling reverseSwap restores A before B.
   */
  public reverseSwap(record: SwapRecord): void {
    // After the original swap, B is at posA and A is at posB
    this.swapOnResource(record.resourceKey, record.nodeIdxB, record.nodeIdxA);
  }

  /**
   * Recompute changeover durations for nodes affected by a swap on a resource.
   * No-op if stateChanges is undefined.
   */
  public recomputeChangeovers(
    resourceKey: string,
    nodeIdxA: number,
    nodeIdxB: number,
    stateChanges?: CTPStateChanges,
  ): void {
    if (!stateChanges) return;

    const seq = this.resourceSequences.get(resourceKey);
    if (!seq) return;

    // After swap: B is before A. Affected positions: pos(B), pos(A), pos(A)+1
    const posB = seq.indexOf(nodeIdxB); // B is now at what was posA
    const posA = seq.indexOf(nodeIdxA); // A is now at what was posB

    const affectedPositions = [posB, posA];
    if (posA + 1 < seq.length) affectedPositions.push(posA + 1);

    for (const pos of affectedPositions) {
      if (pos <= 0) continue; // no predecessor → no changeover
      const predNode = this.nodes[seq[pos - 1]];
      const currNode = this.nodes[seq[pos]];
      currNode.changeoverBefore = this.lookupChangeover(resourceKey, predNode.processKey, currNode.processKey, stateChanges);
    }

    this.rebuildDisjunctiveEdgesForResource(resourceKey);
  }

  /**
   * Detect cycles using Kahn's algorithm on the adjacency arrays.
   * O(T + E) — same cost as critical path.
   */
  public hasCycle(): boolean {
    const n = this.nodes.length;
    const inDegree = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      for (const s of this.nodes[i].conjSuccessors) inDegree[s]++;
      for (const s of this.nodes[i].disjSuccessors) inDegree[s]++;
    }

    const queue: number[] = [];
    let head = 0;
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    let processed = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      processed++;
      for (const s of this.nodes[idx].conjSuccessors) {
        if (--inDegree[s] === 0) queue.push(s);
      }
      for (const s of this.nodes[idx].disjSuccessors) {
        if (--inDegree[s] === 0) queue.push(s);
      }
    }

    return processed < n;
  }

  /**
   * Deep clone the graph. Does NOT recompute critical path — caller does that if needed.
   */
  public clone(): DisjunctiveGraph {
    const c = new DisjunctiveGraph();

    c.nodes = this.nodes.map(n => ({
      ...n,
      disjPredecessors: [...n.disjPredecessors],
      disjSuccessors: [...n.disjSuccessors],
      conjPredecessors: [...n.conjPredecessors],
      conjSuccessors: [...n.conjSuccessors],
    }));

    c.edges = this.edges.map(e => ({ ...e }));

    // Rebuild nodeIndex from cloned nodes
    for (let i = 0; i < c.nodes.length; i++) {
      c.nodeIndex.set(c.nodes[i].key, i);
    }

    for (const [rk, seq] of this.resourceSequences) {
      c.resourceSequences.set(rk, [...seq]);
    }
    for (const [rk, seq] of this.byResource) {
      c.byResource.set(rk, [...seq]);
    }

    c.criticalPath = this.criticalPath ? { ...this.criticalPath } : null;

    return c;
  }

  // ─── Utility Methods ───

  public getNodeIndex(taskKey: string): number | undefined {
    return this.nodeIndex.get(taskKey);
  }

  public getResourceNodes(resourceKey: string): number[] {
    return this.resourceSequences.get(resourceKey) ?? [];
  }

  // ─── Private Helpers ───

  private rebuildDisjunctiveEdgesForResource(resourceKey: string): void {
    // Remove all existing disjunctive edges for this resource
    this.edges = this.edges.filter(e => !(e.type === 'disjunctive' && e.resourceKey === resourceKey));

    // Re-add from current sequence
    const seq = this.resourceSequences.get(resourceKey);
    if (!seq) return;

    for (let i = 0; i < seq.length - 1; i++) {
      const fromIdx = seq[i];
      const toIdx = seq[i + 1];
      this.edges.push({
        from: fromIdx,
        to: toIdx,
        type: 'disjunctive',
        weight: this.nodes[fromIdx].duration + this.nodes[toIdx].changeoverBefore,
        resourceKey,
      });
    }
  }

  private lookupChangeover(
    resourceKey: string,
    fromProcess: string,
    toProcess: string,
    stateChanges: CTPStateChanges,
  ): number {
    if (!fromProcess || !toProcess || fromProcess === toProcess) return 0;
    let found = 0;
    stateChanges.forEach(sc => {
      if (
        sc.resourceType === resourceKey &&
        sc.fromState === fromProcess &&
        sc.toState === toProcess
      ) {
        found = sc.duration;
      }
    });
    return found;
  }

  private buildCriticalPathResult(makespan: number): CriticalPathResult {
    const criticalNodes = this.nodes
      .filter(nd => nd.isOnCriticalPath)
      .sort((a, b) => a.earliestStart - b.earliestStart);

    // Segments: group consecutive critical-path nodes by resource
    const segments: CriticalPathSegment[] = [];
    let currentSeg: CriticalPathSegment | null = null;
    for (const nd of criticalNodes) {
      if (!currentSeg || currentSeg.resourceKey !== nd.resourceKey) {
        currentSeg = { resourceKey: nd.resourceKey, resourceName: nd.resourceName, tasks: [], totalDuration: 0 };
        segments.push(currentSeg);
      }
      currentSeg.tasks.push({
        key: nd.key, name: nd.name,
        startW: nd.startW, endW: nd.endW, duration: nd.duration,
        start: CTPDateTime.toDateTime(nd.startW).toISO()!,
        end: CTPDateTime.toDateTime(nd.endW).toISO()!,
      });
      currentSeg.totalDuration += nd.duration;
    }

    // Bottleneck resource
    const resCritTime = new Map<string, { time: number; name: string }>();
    for (const nd of criticalNodes) {
      const prev = resCritTime.get(nd.resourceKey);
      resCritTime.set(nd.resourceKey, { time: (prev?.time ?? 0) + nd.duration, name: nd.resourceName });
    }
    let bnKey = '', bnTime = 0, bnName = '';
    for (const [key, val] of resCritTime) {
      if (val.time > bnTime) { bnKey = key; bnTime = val.time; bnName = val.name; }
    }

    const nonCritical = this.nodes.filter(nd => !nd.isOnCriticalPath);
    const avgSlack = nonCritical.length > 0
      ? Math.round(nonCritical.reduce((s, nd) => s + nd.totalSlack, 0) / nonCritical.length) : 0;
    const minNonCritSlack = nonCritical.length > 0 ? Math.min(...nonCritical.map(nd => nd.totalSlack)) : 0;
    const nearCriticalCount = nonCritical.filter(nd => nd.totalSlack < 1800).length;

    const makespanHrs = Math.floor(makespan / 3600);
    const makespanMin = Math.floor((makespan % 3600) / 60);
    const makespanFormatted = makespanHrs > 0 ? `${makespanHrs}h ${makespanMin}m` : `${makespanMin}m`;

    return {
      path: criticalNodes.map(nd => ({
        key: nd.key, name: nd.name, type: nd.type, chainKey: nd.chainKey,
        resourceKey: nd.resourceKey, resourceName: nd.resourceName,
        duration: nd.duration, slack: nd.totalSlack,
        start: CTPDateTime.toDateTime(nd.startW).toISO()!,
        end: CTPDateTime.toDateTime(nd.endW).toISO()!,
      })),
      segments,
      makespan,
      makespanFormatted,
      bottleneckResource: {
        resourceKey: bnKey, resourceName: bnName,
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
}
