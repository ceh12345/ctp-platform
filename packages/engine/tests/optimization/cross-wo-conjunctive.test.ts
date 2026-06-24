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
