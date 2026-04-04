import { describe, it, expect } from 'vitest';
import { DisjunctiveGraph, DisjunctiveNode } from '../../Engines/Optimization/disjunctivegraph';
import {
  CTPTaskStateConstants,
  CTPResourceConstants,
} from '../../Models/Core/constants';
import { CTPTask, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource } from '../../Models/Entities/resource';
import { CTPStateChange, CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPInterval } from '../../Models/Core/window';
import { CTPLinkId } from '../../Models/Core/linkid';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { DateTime } from 'luxon';

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a DisjunctiveNode stub directly (bypasses buildFromLandscape).
 * Used for tests 2–7 to keep fixtures fast and independent of the landscape model.
 */
function makeNode(
  key: string,
  resourceKey: string,
  startW: number,
  duration: number,
  processKey = 'PA',
): DisjunctiveNode {
  return {
    key,
    name: key,
    type: 'PROCESS',
    chainKey: null,
    resourceKey,
    resourceName: resourceKey,
    startW,
    endW: startW + duration,
    duration,
    conjunctivePred: null,
    conjunctiveSucc: null,
    disjPredecessors: [],
    disjSuccessors: [],
    conjPredecessors: [],
    conjSuccessors: [],
    isFrozen: false,
    changeoverBefore: 0,
    processKey,
    earliestStart: 0,
    latestStart: 0,
    totalSlack: 0,
    isOnCriticalPath: false,
    criticalBlockId: null,
  };
}

/**
 * Main test graph — 5 tasks, 2 resources, chain of 3.
 *
 * Topology:
 *   R1: T0(dur=100) → T1(dur=50)           [disjunctive only]
 *   R2: T2(dur=100) → T3(dur=100) → T4(dur=100) [disjunctive]
 *   Conjunctive: T0→T2, T2→T4             [chain of 3: T0,T2,T4]
 *
 * Critical path BEFORE any swap: T0→T2→T3→T4 (makespan=400).
 * T1 is non-critical (slack=250).
 *
 * Node indices: T0=0, T1=1, T2=2, T3=3, T4=4
 * Process keys: T0=PA, T1=PB, T2=PA, T3=PB, T4=PA
 */
function buildGraph(): DisjunctiveGraph {
  const g = new DisjunctiveGraph();

  g.nodes.push(makeNode('T0', 'R1', 0, 100, 'PA'));    // 0
  g.nodes.push(makeNode('T1', 'R1', 100, 50, 'PB'));   // 1
  g.nodes.push(makeNode('T2', 'R2', 100, 100, 'PA'));  // 2
  g.nodes.push(makeNode('T3', 'R2', 200, 100, 'PB')); // 3
  g.nodes.push(makeNode('T4', 'R2', 300, 100, 'PA')); // 4

  // Chain T0→T2 (conjunctive)
  g.nodes[0].conjSuccessors.push(2);
  g.nodes[2].conjPredecessors.push(0);

  // Chain T2→T4 (conjunctive)
  g.nodes[2].conjSuccessors.push(4);
  g.nodes[4].conjPredecessors.push(2);

  // Disjunctive R1: T0→T1
  g.nodes[0].disjSuccessors.push(1);
  g.nodes[1].disjPredecessors.push(0);

  // Disjunctive R2: T2→T3→T4
  g.nodes[2].disjSuccessors.push(3);
  g.nodes[3].disjPredecessors.push(2);
  g.nodes[3].disjSuccessors.push(4);
  g.nodes[4].disjPredecessors.push(3);

  g.resourceSequences.set('R1', [0, 1]);
  g.resourceSequences.set('R2', [2, 3, 4]);

  g.edges.push({ from: 0, to: 2, type: 'conjunctive', weight: 100, resourceKey: null });
  g.edges.push({ from: 2, to: 4, type: 'conjunctive', weight: 100, resourceKey: null });
  g.edges.push({ from: 0, to: 1, type: 'disjunctive', weight: 100, resourceKey: 'R1' });
  g.edges.push({ from: 2, to: 3, type: 'disjunctive', weight: 100, resourceKey: 'R2' });
  g.edges.push({ from: 3, to: 4, type: 'disjunctive', weight: 100, resourceKey: 'R2' });

  g.recomputeCriticalPath();
  return g;
}

/**
 * Build a SchedulingLandscape matching the same 5-task topology.
 * Used exclusively for Test 1 (buildFromLandscape validation).
 *
 * Task keys match buildGraph(): T0, T1, T2, T3, T4.
 * T0 is pinned → isFrozen=true.
 * Chain: T2.linkId.prevLink='T0', T4.linkId.prevLink='T2'.
 */
function buildLandscape(): SchedulingLandscape {
  const start = DateTime.fromObject({ year: 2026, month: 1, day: 1 });
  const end = start.plus({ days: 7 });
  const landscape = new SchedulingLandscape(start, end);

  const r1 = new CTPResource(CTPResourceConstants.REUSABLE, 'Tools', 'R1 Resource', 'R1');
  const r2 = new CTPResource(CTPResourceConstants.REUSABLE, 'Tools', 'R2 Resource', 'R2');
  landscape.resources.fromArray([r1, r2]);

  const makeTask = (
    key: string,
    resKey: string,
    startW: number,
    endW: number,
  ): CTPTask => {
    const task = new CTPTask('PROCESS', key, key);
    task.state = CTPTaskStateConstants.SCHEDULED;
    task.scheduled = new CTPInterval(startW, endW);
    const tr = new CTPTaskResource(resKey, true, 0, resKey);
    task.capacityResources = new CTPTaskResourceList();
    task.capacityResources.add(tr);
    return task;
  };

  const t0 = makeTask('T0', 'R1', 0, 100);
  t0.pinned = true; // isFrozen

  const t1 = makeTask('T1', 'R1', 100, 150);
  const t2 = makeTask('T2', 'R2', 100, 200);
  const t3 = makeTask('T3', 'R2', 200, 300);
  const t4 = makeTask('T4', 'R2', 300, 400);

  // Chain T0→T2→T4
  t2.linkId = new CTPLinkId('CHAIN-1', 'chain', 'T0');
  t4.linkId = new CTPLinkId('CHAIN-1', 'chain', 'T2');

  landscape.tasks.fromArray([t0, t1, t2, t3, t4]);
  return landscape;
}

/**
 * Build a small state-changes collection for changeover tests.
 * R2: PA→PB = 600s, PB→PA = 300s.
 */
function buildStateChanges(): CTPStateChanges {
  const sc1 = new CTPStateChange('R2', undefined, 'PA', 'PB');
  sc1.duration = 600;
  const sc2 = new CTPStateChange('R2', undefined, 'PB', 'PA');
  sc2.duration = 300;
  const stateChanges = new CTPStateChanges();
  stateChanges.addEntity(sc1);
  stateChanges.addEntity(sc2);
  return stateChanges;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('DisjunctiveGraph (Optimization) — Session 1', () => {

  // ── Test 1: Graph construction via buildFromLandscape ───────────────────

  describe('1. buildFromLandscape — graph construction', () => {
    it('creates correct node count', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      expect(g.nodes.length).toBe(5);
    });

    it('populates resourceSequences for both resources', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      expect(g.getResourceNodes('R1').length).toBe(2);
      expect(g.getResourceNodes('R2').length).toBe(3);
    });

    it('nodes are sorted by startW within each resource sequence', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      const r1 = g.getResourceNodes('R1').map(i => g.nodes[i].startW);
      const r2 = g.getResourceNodes('R2').map(i => g.nodes[i].startW);
      expect(r1[0]).toBeLessThan(r1[1]);
      expect(r2[0]).toBeLessThan(r2[1]);
      expect(r2[1]).toBeLessThan(r2[2]);
    });

    it('adjacency arrays are populated for disjunctive edges', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      const t0idx = g.getNodeIndex('T0')!;
      const t1idx = g.getNodeIndex('T1')!;
      expect(g.nodes[t0idx].disjSuccessors).toContain(t1idx);
      expect(g.nodes[t1idx].disjPredecessors).toContain(t0idx);
    });

    it('conjunctive adjacency arrays are populated for chain arcs', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      const t0idx = g.getNodeIndex('T0')!;
      const t2idx = g.getNodeIndex('T2')!;
      expect(g.nodes[t0idx].conjSuccessors).toContain(t2idx);
      expect(g.nodes[t2idx].conjPredecessors).toContain(t0idx);
    });

    it('pinned task has isFrozen=true', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      const t0idx = g.getNodeIndex('T0')!;
      expect(g.nodes[t0idx].isFrozen).toBe(true);
    });

    it('unpinned task has isFrozen=false', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      const t1idx = g.getNodeIndex('T1')!;
      expect(g.nodes[t1idx].isFrozen).toBe(false);
    });

    it('freezeHorizon freezes tasks starting before the horizon', () => {
      const landscape = buildLandscape();
      // T0 startW=0, T1 startW=100 → freeze horizon at 50 freezes T0 only
      const g = DisjunctiveGraph.buildFromLandscape(landscape, 50);
      const t0idx = g.getNodeIndex('T0')!;
      const t1idx = g.getNodeIndex('T1')!;
      expect(g.nodes[t0idx].isFrozen).toBe(true);
      expect(g.nodes[t1idx].isFrozen).toBe(false);
    });

    it('critical path is computed on construction', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      expect(g.criticalPath).not.toBeNull();
      expect(g.criticalPath!.makespan).toBe(400);
    });

    it('has correct number of disjunctive edges', () => {
      const g = DisjunctiveGraph.buildFromLandscape(buildLandscape());
      const disjEdges = g.edges.filter(e => e.type === 'disjunctive');
      // R1: 1 edge (T0→T1), R2: 2 edges (T2→T3, T3→T4)
      expect(disjEdges.length).toBe(3);
    });
  });

  // ── Test 2: Swap correctness ─────────────────────────────────────────────

  describe('2. swapOnResource — adjacency and sequence correctness', () => {
    it('resource sequence reflects swapped order', () => {
      const g = buildGraph();
      // Swap T2 (idx=2) and T3 (idx=3) on R2: [2,3,4] → [3,2,4]
      g.swapOnResource('R2', 2, 3);
      expect(g.getResourceNodes('R2')).toEqual([3, 2, 4]);
    });

    it('disjSuccessors updated on predecessor of swapped pair', () => {
      const g = buildGraph();
      // R2 sequence before: [2,3,4]. T2 has no disj predecessor (pos=0).
      // Swap T3 (idx=3) and T4 (idx=4): [2,3,4] → [2,4,3]
      g.swapOnResource('R2', 3, 4);
      // T3 should now have disjPred T4; T4 should have disjPred T2
      expect(g.nodes[4].disjSuccessors).toContain(3);
      expect(g.nodes[3].disjPredecessors).toContain(4);
    });

    it('old adjacency links are removed after swap', () => {
      const g = buildGraph();
      // Before: T3→T4 on R2
      expect(g.nodes[3].disjSuccessors).toContain(4);
      g.swapOnResource('R2', 3, 4); // → [2,4,3]
      // T3 should no longer point to T4 disjunctively
      expect(g.nodes[3].disjSuccessors).not.toContain(4);
      expect(g.nodes[4].disjPredecessors).not.toContain(3);
    });

    it('new adjacency: B→A after swap', () => {
      const g = buildGraph();
      g.swapOnResource('R2', 2, 3); // [2,3,4] → [3,2,4]
      // T3 (now first) → T2 (now second)
      expect(g.nodes[3].disjSuccessors).toContain(2);
      expect(g.nodes[2].disjPredecessors).toContain(3);
    });

    it('flat edges are rebuilt to match new sequence', () => {
      const g = buildGraph();
      g.swapOnResource('R2', 2, 3); // [3,2,4]
      const r2Edges = g.edges.filter(e => e.type === 'disjunctive' && e.resourceKey === 'R2');
      // Should have: 3→2 and 2→4
      expect(r2Edges.some(e => e.from === 3 && e.to === 2)).toBe(true);
      expect(r2Edges.some(e => e.from === 2 && e.to === 4)).toBe(true);
      // Old edge 3→4 should be gone
      expect(r2Edges.some(e => e.from === 3 && e.to === 4)).toBe(false);
    });

    it('throws when resource key not found', () => {
      const g = buildGraph();
      expect(() => g.swapOnResource('R99', 0, 1)).toThrow();
    });

    it('throws when nodeIdxA is not before nodeIdxB', () => {
      const g = buildGraph();
      expect(() => g.swapOnResource('R2', 3, 2)).toThrow();
    });

    it('returns a SwapRecord with correct fields', () => {
      const g = buildGraph();
      const record = g.swapOnResource('R2', 2, 3);
      expect(record.resourceKey).toBe('R2');
      expect(record.nodeIdxA).toBe(2);
      expect(record.nodeIdxB).toBe(3);
    });
  });

  // ── Test 3: Critical path after swap ─────────────────────────────────────

  describe('3. recomputeCriticalPath after swap', () => {
    it('makespan decreases after beneficial swap', () => {
      const g = buildGraph();
      expect(g.criticalPath!.makespan).toBe(400);

      // Swap T2 and T3 on R2: T3 moves before T2, breaking the bottleneck chain
      g.swapOnResource('R2', 2, 3);
      g.recomputeCriticalPath();

      // New makespan: T3 (no preds, dur=100 finishes at 100) → T2 starts at
      // max(100 from disj T3, 100 from conj T0) = 100, finishes 200 →
      // T4: conjPred T2 finishes 200, disjPred T2 finishes 200 → makespan=300
      expect(g.criticalPath!.makespan).toBe(300);
    });

    it('earliestStart values are updated after swap + recompute', () => {
      const g = buildGraph();
      g.swapOnResource('R2', 2, 3);
      g.recomputeCriticalPath();

      // T3 is now first on R2 (no predecessors) → earliestStart=0
      expect(g.nodes[3].earliestStart).toBe(0);
      // T4: conjPred T2 (finishes at 200) + disjPred T2 (finishes at 200) → 200
      expect(g.nodes[4].earliestStart).toBe(200);
    });

    it('T1 remains non-critical after swap', () => {
      const g = buildGraph();
      g.swapOnResource('R2', 2, 3);
      g.recomputeCriticalPath();

      expect(g.nodes[1].isOnCriticalPath).toBe(false);
    });

    it('criticalPath is non-null after a valid swap', () => {
      const g = buildGraph();
      g.swapOnResource('R2', 2, 3);
      g.recomputeCriticalPath();
      expect(g.criticalPath).not.toBeNull();
    });
  });

  // ── Test 4: Clone isolation ───────────────────────────────────────────────

  describe('4. clone — deep isolation', () => {
    it('clone has same node count and structure', () => {
      const g = buildGraph();
      const c = g.clone();
      expect(c.nodes.length).toBe(g.nodes.length);
      expect(c.criticalPath?.makespan).toBe(g.criticalPath?.makespan);
    });

    it('swap on clone does not affect original resourceSequences', () => {
      const g = buildGraph();
      const c = g.clone();

      c.swapOnResource('R2', 2, 3);

      // Original R2 sequence must be unchanged
      expect(g.getResourceNodes('R2')).toEqual([2, 3, 4]);
    });

    it('swap on clone does not affect original node adjacency', () => {
      const g = buildGraph();
      const c = g.clone();

      c.swapOnResource('R2', 2, 3);

      // Original T2 still points to T3 disjunctively
      expect(g.nodes[2].disjSuccessors).toContain(3);
      expect(g.nodes[3].disjPredecessors).toContain(2);
    });

    it('swap on clone changes clone resourceSequences', () => {
      const g = buildGraph();
      const c = g.clone();

      c.swapOnResource('R2', 2, 3);

      expect(c.getResourceNodes('R2')).toEqual([3, 2, 4]);
    });

    it('clone adjacency arrays are independent (modifying one does not bleed)', () => {
      const g = buildGraph();
      const c = g.clone();

      // Push garbage into clone's array
      c.nodes[2].disjSuccessors.push(99);

      // Original should be unaffected
      expect(g.nodes[2].disjSuccessors).not.toContain(99);
    });
  });

  // ── Test 5: Cycle detection ───────────────────────────────────────────────

  describe('5. hasCycle — cycle detection after swap', () => {
    it('no cycle on valid acyclic graph', () => {
      const g = buildGraph();
      expect(g.hasCycle()).toBe(false);
    });

    it('detects cycle: chain A→B conj + B→A disj after swap', () => {
      // Minimal cycle graph: TA→TB conjunctive AND disjunctive
      // Swapping TA and TB creates B→A disjunctive + A→B conjunctive = cycle
      const g = new DisjunctiveGraph();
      g.nodes.push(makeNode('TA', 'R1', 0, 100));   // idx 0
      g.nodes.push(makeNode('TB', 'R1', 100, 100));  // idx 1

      // Conjunctive TA→TB
      g.nodes[0].conjSuccessors.push(1);
      g.nodes[1].conjPredecessors.push(0);

      // Disjunctive TA→TB
      g.nodes[0].disjSuccessors.push(1);
      g.nodes[1].disjPredecessors.push(0);

      g.resourceSequences.set('R1', [0, 1]);
      g.recomputeCriticalPath();

      expect(g.hasCycle()).toBe(false);

      // Swap creates TB→TA disjunctive + TA→TB conjunctive = cycle
      g.swapOnResource('R1', 0, 1);
      expect(g.hasCycle()).toBe(true);
    });

    it('recomputeCriticalPath sets criticalPath=null on cyclic graph', () => {
      const g = new DisjunctiveGraph();
      g.nodes.push(makeNode('TA', 'R1', 0, 100));
      g.nodes.push(makeNode('TB', 'R1', 100, 100));

      g.nodes[0].conjSuccessors.push(1);
      g.nodes[1].conjPredecessors.push(0);
      g.nodes[0].disjSuccessors.push(1);
      g.nodes[1].disjPredecessors.push(0);

      g.resourceSequences.set('R1', [0, 1]);
      g.swapOnResource('R1', 0, 1);
      g.recomputeCriticalPath();

      expect(g.criticalPath).toBeNull();
    });
  });

  // ── Test 6: Changeover recomputation ─────────────────────────────────────

  describe('6. recomputeChangeovers', () => {
    it('is a no-op when stateChanges is undefined', () => {
      const g = buildGraph();
      g.nodes[3].changeoverBefore = 999;
      // Should not throw and should not change anything
      g.recomputeChangeovers('R2', 2, 3, undefined);
      expect(g.nodes[3].changeoverBefore).toBe(999);
    });

    it('updates changeoverBefore on affected nodes after swap', () => {
      const g = buildGraph();
      const sc = buildStateChanges();

      // Set initial changeovers consistent with original sequence [T2/PA, T3/PB, T4/PA]
      // T3 is preceded by T2 (PA→PB): 600
      // T4 is preceded by T3 (PB→PA): 300
      g.nodes[3].changeoverBefore = 600;
      g.nodes[4].changeoverBefore = 300;

      // Swap T2 (idx=2, PA) and T3 (idx=3, PB) → new sequence [T3/PB, T2/PA, T4/PA]
      g.swapOnResource('R2', 2, 3);
      g.recomputeChangeovers('R2', 2, 3, sc);

      // pos(nodeIdxA=2) = 1: pred is T3 (PB), curr is T2 (PA) → PB→PA = 300
      expect(g.nodes[2].changeoverBefore).toBe(300);
      // pos(nodeIdxA+1 = 2, T4/PA): pred is T2 (PA) → PA→PA = 0
      expect(g.nodes[4].changeoverBefore).toBe(0);
    });

    it('edge weights reflect changeovers after rebuild', () => {
      const g = buildGraph();
      const sc = buildStateChanges();

      g.nodes[3].changeoverBefore = 600;
      g.nodes[4].changeoverBefore = 300;

      g.swapOnResource('R2', 2, 3);
      g.recomputeChangeovers('R2', 2, 3, sc);

      // T3→T2 edge weight = T3.duration + T2.changeoverBefore = 100 + 300 = 400
      const t3t2 = g.edges.find(e => e.from === 3 && e.to === 2 && e.type === 'disjunctive');
      expect(t3t2).toBeDefined();
      expect(t3t2!.weight).toBe(100 + 300);
    });
  });

  // ── Test 7: Reverse swap ──────────────────────────────────────────────────

  describe('7. reverseSwap — restores original graph state', () => {
    it('resource sequence is restored after swap + reverse', () => {
      const g = buildGraph();
      const original = [...g.getResourceNodes('R2')];

      const record = g.swapOnResource('R2', 2, 3);
      g.reverseSwap(record);

      expect(g.getResourceNodes('R2')).toEqual(original);
    });

    it('adjacency arrays are restored after swap + reverse', () => {
      const g = buildGraph();
      const record = g.swapOnResource('R2', 2, 3);
      g.reverseSwap(record);

      // T2 should point to T3 disjunctively again
      expect(g.nodes[2].disjSuccessors).toContain(3);
      expect(g.nodes[3].disjPredecessors).toContain(2);
      // T3 should point to T4
      expect(g.nodes[3].disjSuccessors).toContain(4);
      expect(g.nodes[4].disjPredecessors).toContain(3);
    });

    it('T2→T3 adjacency from original is not in T3 predecessors after forward swap', () => {
      const g = buildGraph();
      const record = g.swapOnResource('R2', 2, 3);
      // After forward swap: T3 before T2, so T2 should NOT have T3 predecessor
      expect(g.nodes[2].disjPredecessors).not.toContain(2);
    });

    it('critical path is restored after swap + reverse + recompute', () => {
      const g = buildGraph();
      const originalMakespan = g.criticalPath!.makespan;

      const record = g.swapOnResource('R2', 2, 3);
      g.reverseSwap(record);
      g.recomputeCriticalPath();

      expect(g.criticalPath!.makespan).toBe(originalMakespan);
    });

    it('flat edges are restored after swap + reverse', () => {
      const g = buildGraph();
      const record = g.swapOnResource('R2', 2, 3);
      g.reverseSwap(record);

      const r2Edges = g.edges.filter(e => e.type === 'disjunctive' && e.resourceKey === 'R2');
      expect(r2Edges.some(e => e.from === 2 && e.to === 3)).toBe(true);
      expect(r2Edges.some(e => e.from === 3 && e.to === 4)).toBe(true);
    });

    it('changeovers are restored after swap + recompute + reverse + recompute', () => {
      const g = buildGraph();
      const sc = buildStateChanges();

      g.nodes[3].changeoverBefore = 600;
      g.nodes[4].changeoverBefore = 300;

      const record = g.swapOnResource('R2', 2, 3);
      g.recomputeChangeovers('R2', 2, 3, sc);

      g.reverseSwap(record);
      // After reverse: sequence is [T2/PA, T3/PB, T4/PA] again
      // recomputeChangeovers for the reverse swap (nodeIdxB=3 now back to A position, nodeIdxA=2 back to B)
      // After reverseSwap(record), internally swapOnResource is called with (R2, nodeIdxB=3, nodeIdxA=2)
      // But wait — after forward swap seq=[3,2,4], then reverseSwap calls swapOnResource(R2, 3, 2)
      // which makes seq=[2,3,4] again. nodeIdxA=3, nodeIdxB=2 in the reverse call.
      g.recomputeChangeovers('R2', 3, 2, sc);

      // Back to original: T3 (pos 1, pred T2/PA→PB) = 600
      expect(g.nodes[3].changeoverBefore).toBe(600);
      // T4 (pos 2, pred T3/PB→PA) = 300
      expect(g.nodes[4].changeoverBefore).toBe(300);
    });
  });

  // ── Utility methods ───────────────────────────────────────────────────────

  describe('utility methods', () => {
    it('getResourceNodes returns empty array for unknown resource', () => {
      const g = buildGraph();
      expect(g.getResourceNodes('UNKNOWN')).toEqual([]);
    });

    it('identifyCriticalBlocks returns blocks of ≥2 consecutive critical nodes', () => {
      const g = buildGraph();
      // Critical path: T0, T2, T3, T4.  T2/T3/T4 are consecutive on R2.
      const blocks = g.identifyCriticalBlocks();
      const r2Block = blocks.find(b => b.resourceKey === 'R2');
      expect(r2Block).toBeDefined();
      expect(r2Block!.nodeIndices.length).toBeGreaterThanOrEqual(2);
    });

    it('identifyCriticalBlocks sets criticalBlockId on critical nodes', () => {
      const g = buildGraph();
      g.identifyCriticalBlocks();
      // T2, T3, T4 are on R2 critical block
      expect(g.nodes[2].criticalBlockId).not.toBeNull();
      expect(g.nodes[3].criticalBlockId).not.toBeNull();
      expect(g.nodes[4].criticalBlockId).not.toBeNull();
    });

    it('non-critical T1 is not in any critical block', () => {
      const g = buildGraph();
      g.identifyCriticalBlocks();
      expect(g.nodes[1].criticalBlockId).toBeNull();
    });
  });
});
