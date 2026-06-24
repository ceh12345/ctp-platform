/**
 * Cross-WO Linking — hydrator wiring + component derivation
 * (SPRINT-cross-wo-linking + SPRINT-cross-wo-enforcement-rev).
 *
 * Unit-tests the pure helpers StateHydratorService.deriveCrossWOLinks (wires the
 * cross-WO prevLink, nulls its maxGap, v1 single-edge) and deriveComponents
 * (componentKey / WO-topo position; throws on cycle / multi-sink). Adjacency is
 * NOT exercised here — under B+ the cross-WO edge is honoured by the window-floor
 * + ordering, not by per-WO preds/succs.
 */
import { describe, it, expect } from 'vitest';
import { StateHydratorService } from '../state-hydrator.service';
import {
  CTPTask, CTPTasks,
  CTPOrder, CTPOrders,
  CTPWorkOrderGroup, CTPWorkOrderGroups,
  CTPLinkId,
} from '@ctp/engine';

function mkTask(key: string, chain: string, prev: string, seq: number, group: string | null): CTPTask {
  const t = new CTPTask('PROCESS', key, key);
  t.linkId = new CTPLinkId(chain, 'ES', prev, 60); // intra-WO maxGap 60 → must NOT leak onto cross-WO edge
  t.sequence = seq;
  t.groupKey = group;
  return t;
}
function mkOrder(key: string, group: string | null, parent: string | null): CTPOrder {
  const o = new CTPOrder('Order', key, key);
  o.groupKey = group;
  o.parentOrderKey = parent;
  return o;
}

/** parent WO "PARENT" (head A-1, B-2), child WO "CHILD" (C-1, tail C-2), both in
 *  group G1; CHILD.parentOrderKey = PARENT. */
function makeFixture(opts: { childGroup?: string | null; extraChild?: boolean } = {}) {
  const tasks = new CTPTasks();
  [
    mkTask('PARENT-A-1', 'PARENT', '', 1, 'G1'),
    mkTask('PARENT-B-2', 'PARENT', 'PARENT-A-1', 2, 'G1'),
    mkTask('CHILD-C-1', 'CHILD', '', 1, opts.childGroup ?? 'G1'),
    mkTask('CHILD-C-2', 'CHILD', 'CHILD-C-1', 2, opts.childGroup ?? 'G1'),
  ].forEach(t => tasks.addEntity(t));

  const orders = new CTPOrders();
  orders.addEntity(mkOrder('PARENT', 'G1', null));
  orders.addEntity(mkOrder('CHILD', opts.childGroup ?? 'G1', 'PARENT'));

  const groups = new CTPWorkOrderGroups();
  const g = new CTPWorkOrderGroup('WorkOrderGroup', 'G1', 'G1');
  g.workOrderKeys = ['PARENT', 'CHILD'];

  if (opts.extraChild) {
    tasks.addEntity(mkTask('CHILD2-C-1', 'CHILD2', '', 1, 'G1'));
    tasks.addEntity(mkTask('CHILD2-C-2', 'CHILD2', 'CHILD2-C-1', 2, 'G1'));
    orders.addEntity(mkOrder('CHILD2', 'G1', 'PARENT'));
    g.workOrderKeys.push('CHILD2');
  }
  groups.addEntity(g);
  return { tasks, orders, groups };
}

describe('deriveCrossWOLinks (wiring)', () => {
  it("wires parent head prevLink → child tail, and nulls the cross-WO maxGap", () => {
    const ls = makeFixture();
    const s = StateHydratorService.deriveCrossWOLinks(ls, 'bomParentChild', true);

    expect(s.linksWired).toBe(1);
    const head = ls.tasks.getEntity('PARENT-A-1')!;
    expect(head.linkId!.prevLink).toBe('CHILD-C-2');
    // Flag #1: cross-WO edge is precedence-only — maxGap MUST be nulled, not the
    // incidental intra-WO 60 the head carried.
    expect(head.linkId!.maxGap).toBeNull();
    expect(head.groupKey).toBe('G1');
    expect(ls.tasks.getEntity('CHILD-C-2')!.groupKey).toBe('G1');
  });

  it('v1 single-edge: a second child of the same parent is skipped (counted)', () => {
    const ls = makeFixture({ extraChild: true });
    const s = StateHydratorService.deriveCrossWOLinks(ls, 'bomParentChild', true);
    expect(s.linksWired).toBe(1);
    expect(s.parentsAlreadyWired).toBe(1);
    expect(ls.tasks.getEntity('PARENT-A-1')!.linkId!.prevLink).toBe('CHILD-C-2'); // CHILD < CHILD2
  });

  it('does not wire across different groups', () => {
    const ls = makeFixture({ childGroup: 'G2' });
    const s = StateHydratorService.deriveCrossWOLinks(ls, 'bomParentChild', true);
    expect(s.linksWired).toBe(0);
    expect(s.crossGroup).toBe(1);
    expect(ls.tasks.getEntity('PARENT-A-1')!.linkId!.prevLink).toBe('');
  });

  it('throws on an unknown crossWOLinking mode', () => {
    const ls = makeFixture();
    expect(() => StateHydratorService.deriveCrossWOLinks(ls, 'bogus', true)).toThrow(/Unrecognised crossWOLinking/);
  });

  it('throws when bomParentChild is set but there is no group capability', () => {
    const ls = makeFixture();
    expect(() => StateHydratorService.deriveCrossWOLinks(ls, 'bomParentChild', false)).toThrow(/requires WorkOrderGroups/);
  });

  it('no-ops (skipped) when the landscape has no groups loaded', () => {
    const ls = makeFixture();
    const empty = { tasks: ls.tasks, orders: ls.orders, groups: new CTPWorkOrderGroups() };
    const s = StateHydratorService.deriveCrossWOLinks(empty, 'bomParentChild', true);
    expect(s.skipped).toBe('empty-groups');
  });
});

describe('deriveComponents (componentKey / topo / cycle / multi-sink)', () => {
  it('stamps componentKey = head WO and child WO precedes parent by topo position', () => {
    const ls = makeFixture();
    StateHydratorService.deriveCrossWOLinks(ls, 'bomParentChild', true);
    StateHydratorService.deriveComponents(ls);

    const head = ls.tasks.getEntity('PARENT-A-1')!;
    const childTail = ls.tasks.getEntity('CHILD-C-2')!;
    expect(head.componentKey).toBe('PARENT');      // sink = head WO
    expect(childTail.componentKey).toBe('PARENT');  // same component
    expect(childTail.componentTopoPos).toBeLessThan(head.componentTopoPos); // child before parent
  });

  it('single-WO chain is its own component (strict generalization)', () => {
    const tasks = new CTPTasks();
    tasks.addEntity(mkTask('SOLO-A-1', 'SOLO', '', 1, null));
    tasks.addEntity(mkTask('SOLO-B-2', 'SOLO', 'SOLO-A-1', 2, null));
    StateHydratorService.deriveComponents({ tasks } as any);
    expect(tasks.getEntity('SOLO-A-1')!.componentKey).toBe('SOLO');
    expect(tasks.getEntity('SOLO-A-1')!.componentTopoPos).toBe(0);
  });

  it('throws on a multi-sink component (no unique head)', () => {
    // Two parents share one child: child precedes BOTH → two sinks.
    const tasks = new CTPTasks();
    tasks.addEntity(mkTask('P1-A-1', 'P1', 'C-T-2', 1, 'G'));   // P1 head ← child tail
    tasks.addEntity(mkTask('P2-A-1', 'P2', 'C-T-2', 1, 'G'));   // P2 head ← child tail
    tasks.addEntity(mkTask('C-T-1', 'C', '', 1, 'G'));
    tasks.addEntity(mkTask('C-T-2', 'C', 'C-T-1', 2, 'G'));
    expect(() => StateHydratorService.deriveComponents({ tasks } as any)).toThrow(/terminal WOs|multi/i);
  });

  it('throws on a WO-level cycle', () => {
    // A head ← B tail, B head ← A tail → WO-level cycle A↔B.
    const tasks = new CTPTasks();
    tasks.addEntity(mkTask('A-1', 'A', 'B-2', 1, 'G'));
    tasks.addEntity(mkTask('A-2', 'A', 'A-1', 2, 'G'));
    tasks.addEntity(mkTask('B-1', 'B', 'A-2', 1, 'G'));
    tasks.addEntity(mkTask('B-2', 'B', 'B-1', 2, 'G'));
    expect(() => StateHydratorService.deriveComponents({ tasks } as any)).toThrow(/cycle/i);
  });
});
