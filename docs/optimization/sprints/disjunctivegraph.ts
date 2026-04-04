import { SchedulingLandscape } from '../Models/Entities/landscape';
import { CTPTaskStateConstants, CTPTaskTypeConstants, CTPWipStateConstants } from '../Models/Core/constants';
import { CTPDateTime } from '../Models/Core/date';
import { CTPTaskResource } from '../Models/Entities/task';
import { CTPStateChanges } from '../Models/Entities/statechanges';
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

  /** Graph edges (indices into nodes array) — legacy single-link */
  conjunctivePred: number | null;
  conjunctiveSucc: number | null;

  /** Adjacency arrays for O(1) swap operations */
  disjPredecessors: number[];   // resource sequencing predecessors
  disjSuccessors: number[];     // resource sequencing successors
  conjPredecessors: number[];   // chain predecessors
  conjSuccessors: number[];     // chain successors

  /** Freeze control — frozen nodes cannot be moved by the optimizer */
  isFrozen: boolean;

  /** Changeover time before this task on its primary resource (seconds) */
  changeoverBefore: number;

  /** Process key for changeover lookups */
  processKey: string;

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

  /** Resource key → node indices in scheduled order */
  public resourceSequences = new Map<string, number[]>();

  private nodeIndex = new Map<string, number>();
  private byResource = new Map<string, number[]>();

  // ═══════════════════════════════════════════════════════════════
  //  Construction
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build the disjunctive graph from a solved landscape.
   * Only includes scheduled, non-completed tasks.
   *
   * @param freezeHorizon  Epoch seconds — tasks starting before this are frozen. 0 = no freeze.
   */
  public static buildFromLandscape(landscape: SchedulingLandscape, freezeHorizon = 0): DisjunctiveGraph {
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

      // Determine frozen status
      const isFrozen = !!(
        task.pinned ||
        (task.wipstate && task.wipstate !== CTPWipStateConstants.NOT_STARTED) ||
        (freezeHorizon > 0 && task.scheduled.startW < freezeHorizon)
      );

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
        processKey: task.processKey ?? '',
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

      // Legacy single-link
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

    // ─── 3. Build disjunctive arcs (resource sequencing) + adjacency arrays ───
    for (const [resourceKey, nodeIndices] of graph.byResource) {
      const unique = [...new Set(nodeIndices)];
      const sorted = unique.sort((a, b) => graph.nodes[a].startW - graph.nodes[b].startW);

      // Store as the canonical resource sequence
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
          weight: graph.nodes[fromIdx].duration,
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

  // ═══════════════════════════════════════════════════════════════
  //  Swap Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Swap two adjacent tasks on a resource.
   * nodeIdxA is currently scheduled BEFORE nodeIdxB on resourceKey.
   * After the swap: nodeIdxB comes before nodeIdxA.
   *
   * Updates: disjPredecessors/disjSuccessors on all affected nodes,
   * resourceSequences map, and edges array.
   *
   * @returns A SwapRecord that can be passed to reverseSwap() to undo.
   */
  public swapOnResource(resourceKey: string, nodeIdxA: number, nodeIdxB: number): SwapRecord {
    const seq = this.resourceSequences.get(resourceKey);
    if (!seq) throw new Error(`No resource sequence for ${resourceKey}`);

    const posA = seq.indexOf(nodeIdxA);
    const posB = seq.indexOf(nodeIdxB);
    if (posA < 0 || posB < 0) throw new Error(`Nodes not found in resource sequence for ${resourceKey}`);
    if (posA >= posB) throw new Error(`nodeIdxA (pos ${posA}) must be before nodeIdxB (pos ${posB})`);

    const nodeA = this.nodes[nodeIdxA];
    const nodeB = this.nodes[nodeIdxB];

    // ─── 1. Update adjacency arrays ───

    // Predecessor of A on this resource (if any)
    const predIdx = posA > 0 ? seq[posA - 1] : -1;
    // Successor of B on this resource (if any)
    const succIdx = posB < seq.length - 1 ? seq[posB + 1] : -1;

    // Remove old adjacency: pred→A, A→B, B→succ
    if (predIdx >= 0) {
      removeFromArray(this.nodes[predIdx].disjSuccessors, nodeIdxA);
      removeFromArray(nodeA.disjPredecessors, predIdx);
    }
    removeFromArray(nodeA.disjSuccessors, nodeIdxB);
    removeFromArray(nodeB.disjPredecessors, nodeIdxA);
    if (succIdx >= 0) {
      removeFromArray(nodeB.disjSuccessors, succIdx);
      removeFromArray(this.nodes[succIdx].disjPredecessors, nodeIdxB);
    }

    // Add new adjacency: pred→B, B→A, A→succ
    if (predIdx >= 0) {
      this.nodes[predIdx].disjSuccessors.push(nodeIdxB);
      nodeB.disjPredecessors.push(predIdx);
    }
    nodeB.disjSuccessors.push(nodeIdxA);
    nodeA.disjPredecessors.push(nodeIdxB);
    if (succIdx >= 0) {
      nodeA.disjSuccessors.push(succIdx);
      this.nodes[succIdx].disjPredecessors.push(nodeIdxA);
    }

    // ─── 2. Update resource sequence ───
    seq[posA] = nodeIdxB;
    seq[posB] = nodeIdxA;

    // ─── 3. Update flat edges array ───
    this.rebuildDisjunctiveEdgesForResource(resourceKey);

    return { resourceKey, nodeIdxA, nodeIdxB };
  }

  /**
   * Undo a swap by reversing the two nodes.
   */
  public reverseSwap(record: SwapRecord): void {
    // After the original swap, B is before A. Swapping B,A puts A back before B.
    this.swapOnResource(record.resourceKey, record.nodeIdxB, record.nodeIdxA);
  }

  /**
   * Rebuild the flat edges array for disjunctive edges on a specific resource.
   * Called after a swap to keep edges consistent (used by some analysis paths).
   */
  private rebuildDisjunctiveEdgesForResource(resourceKey: string): void {
    // Remove old disjunctive edges for this resource
    this.edges = this.edges.filter(e => !(e.type === 'disjunctive' && e.resourceKey === resourceKey));

    // Re-add from the current sequence
    const seq = this.resourceSequences.get(resourceKey);
    if (!seq) return;

    for (let i = 0; i < seq.length - 1; i++) {
      this.edges.push({
        from: seq[i],
        to: seq[i + 1],
        type: 'disjunctive',
        weight: this.nodes[seq[i]].duration + this.nodes[seq[i + 1]].changeoverBefore,
        resourceKey,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Changeover Recomputation
  // ═══════════════════════════════════════════════════════════════

  /**
   * After swapping nodeIdxA and nodeIdxB on resourceKey, recompute changeover
   * durations for the affected task pairs.
   *
   * Affected pairs after swap (B now before A):
   *   predecessor → B  (was predecessor → A)
   *   B → A            (was A → B)
   *   A → successor    (was B → successor)
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

    // After the swap, B is in A's old position, A is in B's old position
    const posB = seq.indexOf(nodeIdxB);
    const posA = seq.indexOf(nodeIdxA);

    // Recompute changeover for each affected node and its predecessor
    const affectedPositions = new Set<number>();
    if (posB >= 0) affectedPositions.add(posB);
    if (posA >= 0) affectedPositions.add(posA);
    // Also the node after A (if any), since its predecessor changed
    if (posA >= 0 && posA < seq.length - 1) affectedPositions.add(posA + 1);

    for (const pos of affectedPositions) {
      if (pos <= 0 || pos >= seq.length) continue;

      const predNode = this.nodes[seq[pos - 1]];
      const currNode = this.nodes[seq[pos]];

      const changeover = this.lookupChangeover(
        resourceKey,
        predNode.processKey,
        currNode.processKey,
        stateChanges,
      );
      currNode.changeoverBefore = changeover;
    }

    // Rebuild edges for this resource so weights reflect new changeovers
    this.rebuildDisjunctiveEdgesForResource(resourceKey);
  }

  /**
   * Look up the changeover time between two processes on a resource.
   * Returns 0 if no changeover is defined.
   */
  private lookupChangeover(
    resourceKey: string,
    fromProcess: string,
    toProcess: string,
    stateChanges: CTPStateChanges,
  ): number {
    if (!fromProcess || !toProcess || fromProcess === toProcess) return 0;

    // Iterate over state changes to find matching changeover
    let changeover = 0;
    stateChanges?.forEach?.((sc: any) => {
      if (
        sc.resourceKey === resourceKey &&
        sc.fromProcess === fromProcess &&
        sc.toProcess === toProcess
      ) {
        changeover = sc.duration ?? 0;
      }
    });
    return changeover;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Critical Path (Forward/Backward Pass)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Recompute critical path via forward/backward pass.
   * Updates every node's earliestStart, latestStart, totalSlack, isOnCriticalPath.
   * Updates this.criticalPath result object.
   *
   * Public so it can be called after swap operations.
   */
  public recomputeCriticalPath(): void {
    const n = this.nodes.length;
    if (n === 0) { this.criticalPath = null; return; }

    // ─── Build full adjacency from node arrays ───
    // (Avoids scanning the flat edges array — O(N) from adjacency lists)
    const successors: number[][] = new Array(n);
    const predecessors: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      successors[i] = [...node.conjSuccessors, ...node.disjSuccessors];
      predecessors[i] = [...node.conjPredecessors, ...node.disjPredecessors];
    }

    // ─── Topological order via Kahn's algorithm ───
    const inDegree = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      inDegree[i] = predecessors[i].length;
    }

    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    const topoOrder: number[] = [];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      topoOrder.push(idx);
      for (const succIdx of successors[idx]) {
        if (--inDegree[succIdx] === 0) {
          queue.push(succIdx);
        }
      }
    }

    // If topoOrder is incomplete, we have a cycle — bail out gracefully
    if (topoOrder.length < n) {
      // Graph has a cycle — critical path is invalid
      this.criticalPath = null;
      return;
    }

    // ─── Forward pass: earliest start ───
    for (const node of this.nodes) {
      node.earliestStart = 0;
    }

    for (const idx of topoOrder) {
      const node = this.nodes[idx];
      const finishTime = node.earliestStart + node.duration + node.changeoverBefore;

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
    this.buildCriticalPathResult(makespan);
  }

  /**
   * Build the CriticalPathResult object from the current node state.
   * Separated from recomputeCriticalPath to keep the method readable.
   */
  private buildCriticalPathResult(makespan: number): void {
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

    // Format makespan
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

  // ═══════════════════════════════════════════════════════════════
  //  Critical Block Identification
  // ═══════════════════════════════════════════════════════════════

  /**
   * Identify critical blocks: groups of ≥2 consecutive critical-path tasks
   * on the same resource. These are the neighborhoods for tabu search.
   *
   * Updates criticalBlockId on each node and returns structured blocks.
   */
  public identifyCriticalBlocks(): CriticalBlock[] {
    const blocks: CriticalBlock[] = [];
    if (!this.criticalPath) return blocks;

    const makespan = this.criticalPath.makespan;

    // Build a set of critical-path node keys for fast lookup
    const criticalKeys = new Set(this.criticalPath.path.map(p => p.key));

    // Walk each resource sequence and find runs of critical-path nodes
    let blockId = 0;

    for (const [resourceKey, seq] of this.resourceSequences) {
      let runStart = -1;

      for (let i = 0; i <= seq.length; i++) {
        const inRun = i < seq.length && criticalKeys.has(this.nodes[seq[i]].key);

        if (inRun && runStart < 0) {
          // Start a new run
          runStart = i;
        } else if (!inRun && runStart >= 0) {
          // End of a run — emit block if ≥2 nodes
          const runEnd = i - 1;
          if (runEnd > runStart) {
            blockId++;
            const nodeIndices = seq.slice(runStart, runEnd + 1);
            let totalDuration = 0;

            for (const ni of nodeIndices) {
              this.nodes[ni].criticalBlockId = blockId;
              totalDuration += this.nodes[ni].duration;
            }

            blocks.push({
              id: blockId,
              resourceKey,
              resourceName: this.nodes[nodeIndices[0]].resourceName,
              nodeIndices,
              firstIdx: nodeIndices[0],
              lastIdx: nodeIndices[nodeIndices.length - 1],
              totalDuration,
              percentOfMakespan: makespan > 0 ? Math.round((totalDuration / makespan) * 100) : 0,
            });
          }
          runStart = -1;
        }
      }
    }

    return blocks;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Cycle Detection
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check if the graph contains a cycle using Kahn's algorithm.
   * O(T + E) — same cost as a critical path pass.
   *
   * Call after a swap to verify the graph is still a valid DAG.
   */
  public hasCycle(): boolean {
    const n = this.nodes.length;
    if (n === 0) return false;

    const inDegree = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      inDegree[i] = node.conjPredecessors.length + node.disjPredecessors.length;
    }

    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    let processed = 0;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      processed++;
      const node = this.nodes[idx];

      for (const succIdx of node.conjSuccessors) {
        if (--inDegree[succIdx] === 0) queue.push(succIdx);
      }
      for (const succIdx of node.disjSuccessors) {
        if (--inDegree[succIdx] === 0) queue.push(succIdx);
      }
    }

    return processed < n;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Clone
  // ═══════════════════════════════════════════════════════════════

  /**
   * Deep-copy the graph. The clone is independent — swaps on one don't affect the other.
   * Does NOT recompute critical path — caller does that if needed.
   */
  public clone(): DisjunctiveGraph {
    const copy = new DisjunctiveGraph();

    // Deep copy nodes
    copy.nodes = this.nodes.map(node => ({
      ...node,
      disjPredecessors: [...node.disjPredecessors],
      disjSuccessors: [...node.disjSuccessors],
      conjPredecessors: [...node.conjPredecessors],
      conjSuccessors: [...node.conjSuccessors],
    }));

    // Deep copy edges
    copy.edges = this.edges.map(e => ({ ...e }));

    // Rebuild nodeIndex
    for (let i = 0; i < copy.nodes.length; i++) {
      copy.nodeIndex.set(copy.nodes[i].key, i);
    }

    // Deep copy resource sequences
    for (const [key, seq] of this.resourceSequences) {
      copy.resourceSequences.set(key, [...seq]);
    }

    // Deep copy byResource
    for (const [key, indices] of this.byResource) {
      copy.byResource.set(key, [...indices]);
    }

    // Copy critical path result (shallow copy — it's a read-only snapshot)
    copy.criticalPath = this.criticalPath ? { ...this.criticalPath } : null;

    return copy;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Utility: Node Lookup
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get node index by task key. Returns undefined if not in graph.
   */
  public getNodeIndex(taskKey: string): number | undefined {
    return this.nodeIndex.get(taskKey);
  }

  /**
   * Get node indices for a resource.
   */
  public getResourceNodes(resourceKey: string): number[] {
    return this.resourceSequences.get(resourceKey) ?? [];
  }
}

// ─── Helpers ───

function removeFromArray(arr: number[], value: number): void {
  const idx = arr.indexOf(value);
  if (idx >= 0) arr.splice(idx, 1);
}
