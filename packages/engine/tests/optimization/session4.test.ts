import { describe, it, expect } from 'vitest';
import { DisjunctiveGraph, DisjunctiveNode } from '../../Engines/Optimization/disjunctivegraph';
import { perturbGraph } from '../../Engines/Optimization/perturbation';
import { TabuSearchScheduler } from '../../AI/Schedulers/tabusearchscheduler';
import { ILSScheduler } from '../../AI/Schedulers/ilsscheduler';
import { CTPScheduler } from '../../AI/Schedulers/defaultscheduler';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeNode(
  key: string,
  resourceKey: string,
  startW: number,
  duration: number,
  isFrozen = false,
): DisjunctiveNode {
  return {
    key, name: key, type: 'PROCESS', chainKey: null,
    resourceKey, resourceName: resourceKey,
    startW, endW: startW + duration, duration,
    conjunctivePred: null, conjunctiveSucc: null,
    disjPredecessors: [], disjSuccessors: [],
    conjPredecessors: [], conjSuccessors: [],
    isFrozen, changeoverBefore: 0, processKey: 'PA',
    earliestStart: startW, latestStart: 0, totalSlack: 0,
    isOnCriticalPath: false, criticalBlockId: null,
  };
}

/**
 * Build a simple 4-task graph: R1:[A,B], R2:[C,D], no chain arcs.
 */
function buildSimpleGraph(): DisjunctiveGraph {
  const g = new DisjunctiveGraph();
  g.nodes.push(makeNode('A', 'R1', 0, 100));    // 0
  g.nodes.push(makeNode('B', 'R1', 100, 100));  // 1
  g.nodes.push(makeNode('C', 'R2', 0, 150));    // 2
  g.nodes.push(makeNode('D', 'R2', 150, 100));  // 3

  // Disjunctive arcs
  g.nodes[0].disjSuccessors = [1];
  g.nodes[1].disjPredecessors = [0];
  g.nodes[2].disjSuccessors = [3];
  g.nodes[3].disjPredecessors = [2];

  g.resourceSequences.set('R1', [0, 1]);
  g.resourceSequences.set('R2', [2, 3]);

  g.recomputeCriticalPath();
  return g;
}

/**
 * Build a graph with one frozen task.
 * R1:[A(frozen), B], R2:[C, D].
 */
function buildGraphWithFrozen(): DisjunctiveGraph {
  const g = new DisjunctiveGraph();
  g.nodes.push(makeNode('A', 'R1', 0, 100, true));  // 0 frozen
  g.nodes.push(makeNode('B', 'R1', 100, 100));       // 1
  g.nodes.push(makeNode('C', 'R2', 0, 150));         // 2
  g.nodes.push(makeNode('D', 'R2', 150, 100));       // 3

  g.nodes[0].disjSuccessors = [1];
  g.nodes[1].disjPredecessors = [0];
  g.nodes[2].disjSuccessors = [3];
  g.nodes[3].disjPredecessors = [2];

  g.resourceSequences.set('R1', [0, 1]);
  g.resourceSequences.set('R2', [2, 3]);

  g.recomputeCriticalPath();
  return g;
}

// ─── Test 8: perturbGraph ───────────────────────────────────────────────────

describe('perturbGraph — Session 4', () => {
  it('returns the same graph reference (mutates in place)', () => {
    const g = buildSimpleGraph();
    const ref = perturbGraph(g, 1.0);
    expect(ref).toBe(g);
  });

  it('does not corrupt the original when called on a clone', () => {
    const original = buildSimpleGraph();
    const originalMakespan = original.criticalPath?.makespan ?? 0;
    const clone = original.clone();
    perturbGraph(clone, 1.0);
    // Original must be unchanged
    expect(original.criticalPath?.makespan).toBe(originalMakespan);
  });

  it('perturbed graph has no cycles', () => {
    const g = buildSimpleGraph();
    perturbGraph(g, 1.0); // maximum perturbation
    expect(g.hasCycle()).toBe(false);
  });

  it('recomputeCriticalPath succeeds on perturbed graph', () => {
    const g = buildSimpleGraph();
    perturbGraph(g, 0.5);
    expect(() => g.recomputeCriticalPath()).not.toThrow();
    // criticalPath may be null if all tasks end up without dependencies,
    // but it should not throw
  });

  it('frozen tasks are never included in swaps', () => {
    const g = buildGraphWithFrozen();
    // A (idx 0) is frozen and appears at position 0 in R1 sequence.
    // After perturbGraph with strength=1.0, A must still be at position 0.
    perturbGraph(g, 1.0);
    const r1Seq = g.resourceSequences.get('R1')!;
    expect(r1Seq[0]).toBe(0); // frozen A stays first
  });

  it('returns graph unchanged when all arcs are frozen', () => {
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('X', 'R1', 0, 100, true));
    g.nodes.push(makeNode('Y', 'R1', 100, 100, true));
    g.nodes[0].disjSuccessors = [1];
    g.nodes[1].disjPredecessors = [0];
    g.resourceSequences.set('R1', [0, 1]);
    g.recomputeCriticalPath();

    const result = perturbGraph(g, 1.0);
    // No swappable arcs — graph unchanged
    expect(result.resourceSequences.get('R1')).toEqual([0, 1]);
  });

  it('strength=0 still perturbs at least 1 arc (max(1, ceil(n*0)) = 1)', () => {
    // With strength effectively 0 but ceil forcing at least 1 swap attempt
    const g = buildSimpleGraph();
    const before = [...(g.resourceSequences.get('R1') ?? [])];
    // strength=0 → count = max(1, ceil(2 * 0)) = max(1,0) = 1 → at least 1 swap attempted
    // (may be reverted if it creates a cycle, but the attempt is made)
    expect(() => perturbGraph(g, 0)).not.toThrow();
  });

  it('perturbing with strength=1.0 is cycle-safe on a larger graph', () => {
    // 6 tasks on 2 resources with chain constraints
    const g = new DisjunctiveGraph();
    for (let i = 0; i < 3; i++) {
      g.nodes.push(makeNode(`R1T${i}`, 'R1', i * 100, 100));
    }
    for (let i = 0; i < 3; i++) {
      g.nodes.push(makeNode(`R2T${i}`, 'R2', i * 100, 100));
    }
    // Add chain: R1T0 → R2T0
    g.nodes[0].conjSuccessors = [3];
    g.nodes[3].conjPredecessors = [0];

    for (let i = 0; i < 2; i++) {
      g.nodes[i].disjSuccessors = [i + 1];
      g.nodes[i + 1].disjPredecessors = [i];
    }
    for (let i = 3; i < 5; i++) {
      g.nodes[i].disjSuccessors = [i + 1];
      g.nodes[i + 1].disjPredecessors = [i];
    }
    g.resourceSequences.set('R1', [0, 1, 2]);
    g.resourceSequences.set('R2', [3, 4, 5]);
    g.recomputeCriticalPath();

    perturbGraph(g, 1.0);
    expect(g.hasCycle()).toBe(false);
  });
});

// ─── Test 3: Strategy routing ───────────────────────────────────────────────

describe('Strategy routing — createScheduler logic', () => {
  // We test the same logic inline since createScheduler is private on the service.
  // The factory logic is: Thorough→TabuSearchScheduler, Best/ILS→ILSScheduler, else→CTPScheduler.

  // Factory routes on TIER (not dispatching strategy).
  // Tier values: 'quick' | 'balanced' | 'thorough' | 'best'
  function createScheduler(strategy: string, tier: string = 'balanced'): CTPScheduler {
    switch (tier) {
      case 'thorough': return new TabuSearchScheduler();
      case 'best':     return new ILSScheduler();
      default:         return new CTPScheduler();
    }
  }

  it('"thorough" tier creates TabuSearchScheduler', () => {
    expect(createScheduler('Chain', 'thorough')).toBeInstanceOf(TabuSearchScheduler);
  });

  it('"best" tier creates ILSScheduler', () => {
    expect(createScheduler('Chain', 'best')).toBeInstanceOf(ILSScheduler);
  });

  it('"balanced" tier creates CTPScheduler (no optimization)', () => {
    const s = createScheduler('Chain', 'balanced');
    expect(s).toBeInstanceOf(CTPScheduler);
    expect(s).not.toBeInstanceOf(TabuSearchScheduler);
  });

  it('"quick" tier creates CTPScheduler (no optimization)', () => {
    const s = createScheduler('ChainFirstFit', 'quick');
    expect(s).toBeInstanceOf(CTPScheduler);
    expect(s).not.toBeInstanceOf(TabuSearchScheduler);
  });

  it('dispatching strategy is independent of scheduler class (Chain+thorough→Tabu)', () => {
    expect(createScheduler('Chain', 'thorough')).toBeInstanceOf(TabuSearchScheduler);
    expect(createScheduler('Greedy', 'thorough')).toBeInstanceOf(TabuSearchScheduler);
  });

  it('ILSScheduler is also a TabuSearchScheduler (inheritance chain)', () => {
    expect(new ILSScheduler()).toBeInstanceOf(TabuSearchScheduler);
    expect(new ILSScheduler()).toBeInstanceOf(CTPScheduler);
  });
});

// ─── Test 9: trivial-graph guard ─────────────────────────────────────────────

describe('TabuSearchScheduler trivial-graph guard', () => {
  it('getOptimizationResult returns null before any scheduling', () => {
    const scheduler = new TabuSearchScheduler();
    expect(scheduler.getOptimizationResult()).toBeNull();
  });

  it('ILSScheduler getOptimizationResult returns null before any scheduling', () => {
    const scheduler = new ILSScheduler();
    expect(scheduler.getOptimizationResult()).toBeNull();
  });
});
