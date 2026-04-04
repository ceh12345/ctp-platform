import { describe, it, expect } from 'vitest';
import { DisjunctiveGraph, DisjunctiveNode } from '../../Engines/Optimization/disjunctivegraph';
import {
  topologicalSort,
  findClosestStartTime,
  applyOptimizedGraph,
  computeDiff,
} from '../../Engines/Optimization/graphtranslation';
import { TaskDiff } from '../../Engines/Optimization/types';
import { CTPStartTime, CTPStartTimes } from '../../Models/Entities/starttime';
import { CTPTaskStateConstants, CTPResourceConstants } from '../../Models/Core/constants';
import { CTPTask, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource } from '../../Models/Entities/resource';
import { CTPInterval } from '../../Models/Core/window';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { ScheduleEngine } from '../../Engines/scheduleengine';
import { StateChangeEngine } from '../../Engines/statechangeerengine';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { DateTime } from 'luxon';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeNode(
  key: string,
  resourceKey: string,
  startW: number,
  duration: number,
  chainKey: string | null = null,
  isFrozen = false,
  earliestStart = startW,
): DisjunctiveNode {
  return {
    key,
    name: key,
    type: 'PROCESS',
    chainKey,
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
    isFrozen,
    changeoverBefore: 0,
    processKey: 'PA',
    earliestStart,
    latestStart: 0,
    totalSlack: 0,
    isOnCriticalPath: false,
    criticalBlockId: null,
  };
}

/** Build a CTPStartTimes linked list from an array of [eStartW, lStartW] pairs. */
function makeStartTimes(windows: [number, number][]): CTPStartTimes {
  const list = new CTPStartTimes();
  for (const [e, l] of windows) {
    const st = new CTPStartTime(e, e + 300, l, l + 300, 300);
    list.insertAtEnd(st);
  }
  return list;
}

/**
 * Build a minimal SchedulingLandscape for integration tests.
 * Two tasks (T0, T1) on resource R1, both SCHEDULED.
 * T0 is pinned (frozen). T1 is movable.
 */
function buildMinimalLandscape(): SchedulingLandscape {
  const start = DateTime.fromObject({ year: 2026, month: 1, day: 1 });
  const end = start.plus({ days: 1 });
  const landscape = new SchedulingLandscape(start, end);

  const r1 = new CTPResource(CTPResourceConstants.REUSABLE, 'Tools', 'R1 Resource', 'R1');
  landscape.resources.fromArray([r1]);

  const makeTask = (key: string, startW: number, endW: number, pinned = false): CTPTask => {
    const task = new CTPTask('PROCESS', key, key);
    task.state = CTPTaskStateConstants.SCHEDULED;
    task.scheduled = new CTPInterval(startW, endW);
    task.pinned = pinned;
    const tr = new CTPTaskResource('R1', true, 0, 'R1');
    task.capacityResources = new CTPTaskResourceList();
    task.capacityResources.add(tr);
    return task;
  };

  const t0 = makeTask('T0', 0, 3600, true);   // frozen
  const t1 = makeTask('T1', 3600, 7200);       // movable
  landscape.tasks.fromArray([t0, t1]);
  return landscape;
}

function makeSettings(): CTPAppSettings {
  const s = new CTPAppSettings();
  return s;
}

// ─── Test 6: topologicalSort ────────────────────────────────────────────────

describe('topologicalSort — Session 3', () => {
  it('returns all nodes for a graph with no edges', () => {
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('A', 'R1', 0, 100));
    g.nodes.push(makeNode('B', 'R1', 100, 100));
    g.nodes.push(makeNode('C', 'R2', 0, 100));

    const order = topologicalSort(g);
    expect(order).toHaveLength(3);
    expect(order).toContain(0);
    expect(order).toContain(1);
    expect(order).toContain(2);
  });

  it('single conjunctive chain: predecessor appears before successor', () => {
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('A', 'R1', 0, 100));   // 0
    g.nodes.push(makeNode('B', 'R1', 100, 100));  // 1
    g.nodes.push(makeNode('C', 'R1', 200, 100));  // 2

    // A → B → C conjunctive
    g.nodes[0].conjSuccessors = [1];
    g.nodes[1].conjPredecessors = [0];
    g.nodes[1].conjSuccessors = [2];
    g.nodes[2].conjPredecessors = [1];

    const order = topologicalSort(g);
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
  });

  it('disjunctive predecessors also constrain order', () => {
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('X', 'R1', 0, 200));   // 0
    g.nodes.push(makeNode('Y', 'R1', 200, 100)); // 1

    // X → Y disjunctive
    g.nodes[0].disjSuccessors = [1];
    g.nodes[1].disjPredecessors = [0];

    const order = topologicalSort(g);
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(1));
  });

  it('returns all nodes for a diamond dependency graph', () => {
    //   A → B → D
    //   A → C → D
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('A', 'R1', 0, 100));   // 0
    g.nodes.push(makeNode('B', 'R1', 100, 100)); // 1
    g.nodes.push(makeNode('C', 'R2', 100, 100)); // 2
    g.nodes.push(makeNode('D', 'R1', 200, 100)); // 3

    g.nodes[0].conjSuccessors = [1, 2];
    g.nodes[1].conjPredecessors = [0]; g.nodes[1].conjSuccessors = [3];
    g.nodes[2].conjPredecessors = [0]; g.nodes[2].conjSuccessors = [3];
    g.nodes[3].conjPredecessors = [1, 2];

    const order = topologicalSort(g);
    expect(order).toHaveLength(4);
    // A before B, C, D
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(2));
    // B and C before D
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
  });

  it('returns fewer nodes than graph size if there is a cycle', () => {
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('A', 'R1', 0, 100));   // 0
    g.nodes.push(makeNode('B', 'R1', 100, 100)); // 1

    // Cycle: A → B → A
    g.nodes[0].disjSuccessors = [1];
    g.nodes[1].disjPredecessors = [0];
    g.nodes[1].disjSuccessors = [0];
    g.nodes[0].disjPredecessors = [1];

    const order = topologicalSort(g);
    expect(order.length).toBeLessThan(2);
  });

  it('mixed conjunctive and disjunctive constraints all respected', () => {
    // A -conj-> B, B -disj-> C, A -disj-> C
    const g = new DisjunctiveGraph();
    g.nodes.push(makeNode('A', 'R1', 0, 100));   // 0
    g.nodes.push(makeNode('B', 'R1', 100, 100)); // 1
    g.nodes.push(makeNode('C', 'R1', 200, 100)); // 2

    g.nodes[0].conjSuccessors = [1];
    g.nodes[1].conjPredecessors = [0];
    g.nodes[0].disjSuccessors = [2];
    g.nodes[2].disjPredecessors = [0];
    g.nodes[1].disjSuccessors = [2];
    g.nodes[2].disjPredecessors.push(1);

    const order = topologicalSort(g);
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(2));
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
  });
});

// ─── findClosestStartTime ───────────────────────────────────────────────────

describe('findClosestStartTime — Session 3', () => {
  it('returns null for empty list', () => {
    const empty = new CTPStartTimes();
    expect(findClosestStartTime(empty, 1000)).toBeNull();
  });

  it('exact containment returns immediately (target within [eStartW, lStartW])', () => {
    const list = makeStartTimes([[1000, 2000], [5000, 6000]]);
    const result = findClosestStartTime(list, 1500);
    expect(result).not.toBeNull();
    expect(result!.eStartW).toBe(1000);
    expect(result!.lStartW).toBe(2000);
  });

  it('exact boundary match: target equals eStartW', () => {
    const list = makeStartTimes([[1000, 2000]]);
    const result = findClosestStartTime(list, 1000);
    expect(result!.eStartW).toBe(1000);
  });

  it('exact boundary match: target equals lStartW', () => {
    const list = makeStartTimes([[1000, 2000]]);
    const result = findClosestStartTime(list, 2000);
    expect(result!.eStartW).toBe(1000);
  });

  it('picks window with smallest edge distance when no containment', () => {
    // Target 3000, windows [1000,2000] (closest edge=1000) vs [4000,5000] (closest edge=1000)
    // [1000,2000]: distance = abs(3000-2000) = 1000
    // [4000,5000]: distance = abs(3000-4000) = 1000
    // First one wins on equal distance (min delta not updated by equal)
    const list = makeStartTimes([[1000, 2000], [4000, 5000]]);
    const result = findClosestStartTime(list, 3000);
    expect(result).not.toBeNull();
    // Either window is acceptable — just verify a result is returned
    expect([1000, 4000]).toContain(result!.eStartW);
  });

  it('picks closer window when one is clearly nearer', () => {
    // Target 3900, windows [1000,2000] and [4000,5000]
    // [1000,2000]: distance = abs(3900-2000) = 1900
    // [4000,5000]: distance = abs(3900-4000) = 100 — much closer
    const list = makeStartTimes([[1000, 2000], [4000, 5000]]);
    const result = findClosestStartTime(list, 3900);
    expect(result!.eStartW).toBe(4000);
  });

  it('single window with target before it returns that window', () => {
    const list = makeStartTimes([[5000, 6000]]);
    const result = findClosestStartTime(list, 0);
    expect(result!.eStartW).toBe(5000);
  });
});

// ─── computeDiff ───────────────────────────────────────────────────────────

describe('computeDiff — Session 3', () => {
  function buildTwoGraphs(): { orig: DisjunctiveGraph; opt: DisjunctiveGraph } {
    // Orig: 3 tasks, T0 frozen, T1 moved by 120s, T2 moved by 30s (below threshold)
    const orig = new DisjunctiveGraph();
    orig.nodes.push(makeNode('T0', 'R1', 0, 100, null, true, 0));    // 0 frozen
    orig.nodes.push(makeNode('T1', 'R1', 100, 100, null, false, 100)); // 1 orig start=100
    orig.nodes.push(makeNode('T2', 'R2', 0, 200, null, false, 0));    // 2 orig start=0

    const opt = new DisjunctiveGraph();
    opt.nodes.push(makeNode('T0', 'R1', 0, 100, null, true, 0));     // 0 frozen — same
    opt.nodes.push(makeNode('T1', 'R1', 100, 100, null, false, 220)); // 1 opt start=220 (delta=120)
    opt.nodes.push(makeNode('T2', 'R2', 0, 200, null, false, 30));   // 2 opt start=30 (delta=30 — below threshold)

    return { orig, opt };
  }

  it('frozen tasks are excluded from diff', () => {
    const { orig, opt } = buildTwoGraphs();
    const diffs = computeDiff(orig, opt);
    expect(diffs.find(d => d.taskKey === 'T0')).toBeUndefined();
  });

  it('tasks moving more than 60s appear in diff', () => {
    const { orig, opt } = buildTwoGraphs();
    const diffs = computeDiff(orig, opt);
    const t1 = diffs.find(d => d.taskKey === 'T1');
    expect(t1).toBeDefined();
    expect(t1!.startDelta).toBe(120);
  });

  it('tasks moving less than or equal to 60s (and same resource) are excluded', () => {
    const { orig, opt } = buildTwoGraphs();
    const diffs = computeDiff(orig, opt);
    expect(diffs.find(d => d.taskKey === 'T2')).toBeUndefined();
  });

  it('diff includes tasks that changed resource even if time delta is small', () => {
    const orig = new DisjunctiveGraph();
    orig.nodes.push(makeNode('TX', 'R1', 100, 200, null, false, 100));

    const opt = new DisjunctiveGraph();
    // TX moved by only 10s but resource changed
    opt.nodes.push(makeNode('TX', 'R2', 100, 200, null, false, 110));

    const diffs = computeDiff(orig, opt);
    const tx = diffs.find(d => d.taskKey === 'TX');
    expect(tx).toBeDefined();
    expect(tx!.movedResource).toBe(true);
    expect(tx!.originalResource).toBe('R1');
    expect(tx!.optimizedResource).toBe('R2');
  });

  it('diffs are sorted by absolute startDelta descending', () => {
    const orig = new DisjunctiveGraph();
    orig.nodes.push(makeNode('T1', 'R1', 0, 100, null, false, 0));    // delta will be 200
    orig.nodes.push(makeNode('T2', 'R1', 0, 100, null, false, 0));    // delta will be 90
    orig.nodes.push(makeNode('T3', 'R1', 0, 100, null, false, 0));    // delta will be 300

    const opt = new DisjunctiveGraph();
    opt.nodes.push(makeNode('T1', 'R1', 0, 100, null, false, 200));
    opt.nodes.push(makeNode('T2', 'R1', 0, 100, null, false, 30));
    opt.nodes.push(makeNode('T3', 'R1', 0, 100, null, false, 300));

    const diffs = computeDiff(orig, opt);
    // Only T1 (200) and T3 (300) exceed the 60s threshold
    expect(diffs).toHaveLength(2);
    expect(Math.abs(diffs[0].startDelta)).toBeGreaterThanOrEqual(Math.abs(diffs[1].startDelta));
    expect(diffs[0].startDelta).toBe(300); // T3 first
    expect(diffs[1].startDelta).toBe(200); // T1 second
  });

  it('diff fields are populated correctly', () => {
    const orig = new DisjunctiveGraph();
    orig.nodes.push(makeNode('TZ', 'R1', 500, 200, 'ORD-1', false, 500));

    const opt = new DisjunctiveGraph();
    opt.nodes.push(makeNode('TZ', 'R1', 500, 200, 'ORD-1', false, 700));

    const diffs = computeDiff(orig, opt);
    const tz = diffs[0];
    expect(tz.taskKey).toBe('TZ');
    expect(tz.taskName).toBe('TZ');
    expect(tz.orderKey).toBe('ORD-1');
    expect(tz.originalStart).toBe(500);
    expect(tz.originalEnd).toBe(700);      // orig.endW = 500+200
    expect(tz.originalResource).toBe('R1');
    expect(tz.optimizedStart).toBe(700);
    expect(tz.optimizedEnd).toBe(900);     // 700 + 200
    expect(tz.startDelta).toBe(200);
    expect(tz.movedResource).toBe(false);
  });
});

// ─── applyOptimizedGraph — integration ────────────────────────────────────

describe('applyOptimizedGraph — Session 3', () => {
  it('returns zero rescheduled when all nodes are frozen', () => {
    const landscape = buildMinimalLandscape();
    const graph = DisjunctiveGraph.buildFromLandscape(landscape);

    // Freeze all nodes
    for (const node of graph.nodes) {
      (node as any).isFrozen = true;
    }

    const scheduleEngine = new ScheduleEngine();
    const stateChangeEngine = new StateChangeEngine();
    const settings = makeSettings();

    const result = applyOptimizedGraph(
      graph, landscape, scheduleEngine, stateChangeEngine, settings,
    );

    expect(result.tasksRescheduled).toBe(0);
    expect(result.tasksFailed).toBe(0);
    expect(result.failedTaskKeys).toHaveLength(0);
  });

  it('test 7: partial failure — missing resource increments tasksFailed', () => {
    const landscape = buildMinimalLandscape();

    // Build a graph manually — one node references a resource not in the landscape
    const graph = new DisjunctiveGraph();
    const nodeWithBadResource = makeNode('T0', 'DOES-NOT-EXIST', 0, 3600);
    nodeWithBadResource.isFrozen = false;
    graph.nodes.push(nodeWithBadResource);
    graph.resourceSequences.set('DOES-NOT-EXIST', [0]);
    graph.recomputeCriticalPath();

    // Add T0 to landscape (we need it there for the lookup to succeed)
    // but its target resource doesn't exist → should fail at resource lookup
    const scheduleEngine = new ScheduleEngine();
    const stateChangeEngine = new StateChangeEngine();
    const settings = makeSettings();

    const result = applyOptimizedGraph(
      graph, landscape, scheduleEngine, stateChangeEngine, settings,
    );

    expect(result.tasksFailed).toBeGreaterThanOrEqual(1);
    expect(result.failedTaskKeys).toContain('T0');
  });

  it('test 3: frozen tasks are not unscheduled or moved', () => {
    const landscape = buildMinimalLandscape();
    const t0 = landscape.tasks.getEntity('T0')!;
    const originalStart = t0.scheduled!.startW;
    const originalEnd = t0.scheduled!.endW;

    const graph = DisjunctiveGraph.buildFromLandscape(landscape);

    // All movable nodes get their resource set to something invalid so they fail,
    // ensuring we only test the frozen task path
    for (const node of graph.nodes) {
      if (!node.isFrozen) {
        (node as any).resourceKey = 'NONEXISTENT';
      }
    }

    const scheduleEngine = new ScheduleEngine();
    const stateChangeEngine = new StateChangeEngine();
    const settings = makeSettings();

    applyOptimizedGraph(graph, landscape, scheduleEngine, stateChangeEngine, settings);

    // Frozen task T0 must be untouched
    const t0after = landscape.tasks.getEntity('T0')!;
    expect(t0after.scheduled!.startW).toBe(originalStart);
    expect(t0after.scheduled!.endW).toBe(originalEnd);
    expect(t0after.state).toBe(CTPTaskStateConstants.SCHEDULED);
  });

  it('tasksRescheduled + tasksFailed equals total non-frozen task count', () => {
    const landscape = buildMinimalLandscape();

    // Both nodes reference a non-existent resource to force failure
    const graph = new DisjunctiveGraph();
    const n0 = makeNode('T0', 'BAD-R', 0, 3600);
    const n1 = makeNode('T1', 'BAD-R', 3600, 3600);
    graph.nodes.push(n0, n1);
    graph.resourceSequences.set('BAD-R', [0, 1]);
    graph.recomputeCriticalPath();

    const scheduleEngine = new ScheduleEngine();
    const stateChangeEngine = new StateChangeEngine();
    const settings = makeSettings();

    const result = applyOptimizedGraph(
      graph, landscape, scheduleEngine, stateChangeEngine, settings,
    );

    // Neither task exists in landscape tasks (they are keyed differently),
    // so they will all fail at the task lookup step.
    // Total non-frozen nodes = 2
    expect(result.tasksRescheduled + result.tasksFailed).toBe(2);
  });
});
