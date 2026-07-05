import { describe, it, expect } from 'vitest';
import { DisjunctiveGraph } from '../../Engines/Optimization/disjunctivegraph';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPTask, CTPTasks } from '../../Models/Entities/task';
import { CTPResources } from '../../Models/Entities/resource';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPInterval } from '../../Models/Core/window';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPTaskStateConstants } from '../../Models/Core/constants';
import { DateTime } from 'luxon';

function schedTask(key: string, chain: string, prev: string, startW: number, endW: number): CTPTask {
  const t = new CTPTask('PROCESS', key, key);
  t.linkId = new CTPLinkId(chain, 'ES', prev, null);
  t.state = CTPTaskStateConstants.SCHEDULED;
  t.scheduled = new CTPInterval(startW, endW);
  t.wipstate = 0; // NOT_STARTED — eligible for optimization, not frozen
  return t;
}

/**
 * Cross-WO Enforcement — optimizer protection (Phase 0 finding).
 *
 * The Tabu/ILS optimizer works on a DisjunctiveGraph and only ever reorders
 * DISJUNCTIVE (resource-sequencing) arcs within critical blocks. CONJUNCTIVE
 * (precedence) arcs are inviolable. `DisjunctiveGraph.buildFromLandscape` builds
 * conjunctive arcs straight from `linkId.prevLink` with no same-chain guard, so a
 * cross-WO edge becomes a conjunctive arc — meaning cross-WO precedence survives
 * optimization for free, independent of the per-WO adjacency.
 */
describe('cross-WO precedence is a conjunctive (inviolable) arc in the optimizer graph', () => {
  it('builds a conjunctive arc from a cross-WO prevLink (not a disjunctive one)', () => {
    const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
    const ls = new SchedulingLandscape(st, st.plus({ days: 7 }), new CTPAppSettings());
    const tasks = new CTPTasks();
    const child = schedTask('CHILD-T', 'CHILD', '', 0, 100);
    const parent = schedTask('PARENT-A', 'PARENT-WO', 'CHILD-T', 100, 200); // cross-WO prevLink
    tasks.addEntity(child);
    tasks.addEntity(parent);
    ls.tasks = tasks;
    ls.resources = new CTPResources();

    const g = DisjunctiveGraph.buildFromLandscape(ls, 0);
    const ci = g.nodeIndex.get('CHILD-T');
    const pi = g.nodeIndex.get('PARENT-A');
    expect(ci).toBeDefined();
    expect(pi).toBeDefined();

    // The cross-WO edge is a CONJUNCTIVE predecessor arc → tabu never reorders it.
    expect(g.nodes[pi!].conjPredecessors).toContain(ci!);
    expect(g.edges.some(e => e.type === 'conjunctive' && e.from === ci && e.to === pi)).toBe(true);

    // And it is NOT a disjunctive (swappable) arc.
    expect(g.edges.some(e => e.type === 'disjunctive'
      && ((e.from === ci && e.to === pi) || (e.from === pi && e.to === ci)))).toBe(false);
  });
});

/**
 * Self-loop guard — regression for the makespan-0 optimizer failure.
 *
 * Some source feeds (e.g. Genius chain heads) emit `linkId.prevLink === own key`.
 * Left unguarded, `buildFromLandscape` turns that into a conjunctive self-loop,
 * which makes Kahn's topological sort in recomputeCriticalPath() report a cycle
 * and null the ENTIRE critical path (makespan 0 → the ILS/tabu optimizer bails
 * with `insufficient_critical_tasks`). One bad link poisons the whole graph.
 */
describe('self-referential chain link does not poison the critical path', () => {
  it('skips a prevLink === own key self-loop so the critical path still computes', () => {
    const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
    const ls = new SchedulingLandscape(st, st.plus({ days: 7 }), new CTPAppSettings());
    const tasks = new CTPTasks();
    // A normal 2-task chain — gives a real critical path (makespan 200).
    tasks.addEntity(schedTask('T1', 'C1', '', 0, 100));
    tasks.addEntity(schedTask('T2', 'C1', 'T1', 100, 200));
    // A task whose chain predecessor is ITSELF (malformed feed data).
    tasks.addEntity(schedTask('SELF', 'C2', 'SELF', 0, 150));
    ls.tasks = tasks;
    ls.resources = new CTPResources();

    const g = DisjunctiveGraph.buildFromLandscape(ls, 0);

    // The self-loop is dropped, not turned into an edge.
    const si = g.nodeIndex.get('SELF')!;
    expect(g.nodes[si].conjPredecessors).not.toContain(si);
    expect(g.edges.some(e => e.type === 'conjunctive' && e.from === si && e.to === si)).toBe(false);

    // The whole graph still has a valid critical path — not nulled by the bad link.
    expect(g.criticalPath).not.toBeNull();
    expect(g.criticalPath!.makespan).toBeGreaterThan(0);

    // The legitimate T1 → T2 arc is unaffected — the guard is surgical.
    const t1 = g.nodeIndex.get('T1')!;
    const t2 = g.nodeIndex.get('T2')!;
    expect(g.nodes[t2].conjPredecessors).toContain(t1);
  });
});
