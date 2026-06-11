import { describe, it, expect } from 'vitest';
import { IRollupEngineConfig, RollupEngine } from '../../Engines/rollupengine';
import { CTPOrder, CTPOrders } from '../../Models/Entities/order';
import { CTPTask, CTPTasks } from '../../Models/Entities/task';
import {
  CTPWorkOrderGroup,
  CTPWorkOrderGroups,
  WorkOrderGroupStatus,
} from '../../Models/Entities/workordergroup';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPInterval } from '../../Models/Core/window';
import { InfeasibilityReport } from '../../Models/Entities/infeasibilityreport';
import { NameValue } from '../../Models/Core/namevalue';

// ─── Helpers ──────────────────────────────────────────────────────────────

const T0 = 1700000000;   // base epoch seconds (~Nov 2023) — arbitrary anchor
const DAY = 86400;

const DEFAULT_CONFIG: IRollupEngineConfig = {
  bufferDays: 3,
  cancellationPredicate: { field: 'wostatus', values: [] },
};

function makeEngine(overrides: Partial<IRollupEngineConfig> = {}): RollupEngine {
  return new RollupEngine({ ...DEFAULT_CONFIG, ...overrides });
}

function makeOrder(
  key: string,
  groupKey: string | null = null,
  parentOrderKey: string | null = null,
  demandQty = 100,
  scheduledQty = 0,
): CTPOrder {
  const o = new CTPOrder('Order', `Order ${key}`, key);
  o.groupKey = groupKey;
  o.parentOrderKey = parentOrderKey;
  o.demandQty = demandQty;
  o.scheduledQty = scheduledQty;
  return o;
}

function makeTask(
  key: string,
  orderKey: string,
  scheduledStart?: number,
  scheduledEnd?: number,
): CTPTask {
  const t = new CTPTask('Task', `Task ${key}`, key);
  t.linkId = new CTPLinkId(orderKey);
  t.scheduled = (scheduledStart !== undefined && scheduledEnd !== undefined)
    ? new CTPInterval(scheduledStart, scheduledEnd)
    : null;
  return t;
}

function makeGroup(
  key: string,
  sourceStart: number | null = null,
  sourceEnd: number | null = null,
): CTPWorkOrderGroup {
  const g = new CTPWorkOrderGroup('Group', `Group ${key}`, key);
  g.sourceStart = sourceStart;
  g.sourceEnd = sourceEnd;
  return g;
}

// ─── rebuildGroups: membership ────────────────────────────────────────────

describe('RollupEngine.rebuildGroups — membership', () => {
  it('attaches orders to their groups by groupKey', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));
    orders.addEntity(makeOrder('WO3', 'G2', null));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));
    groups.addEntity(makeGroup('G2'));

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(groups.getEntity('G1')?.workOrderKeys.sort()).toEqual(['WO1', 'WO2']);
    expect(groups.getEntity('G2')?.workOrderKeys).toEqual(['WO3']);
  });

  it('ignores orders with null groupKey', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WOX', null));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(groups.getEntity('G1')?.workOrderKeys).toEqual(['WO1']);
  });

  it('sets headWorkOrderKey when exactly one order has null parent', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));
    orders.addEntity(makeOrder('WO3', 'G1', 'WO1'));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(groups.getEntity('G1')?.headWorkOrderKey).toBe('WO1');
  });

  it('treats self-parent as head — Stafford convention (ParentWorkOrder == WorkOrder)', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', 'WO1'));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));
    orders.addEntity(makeOrder('WO3', 'G1', 'WO1'));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(groups.getEntity('G1')?.headWorkOrderKey).toBe('WO1');
  });

  it('leaves headWorkOrderKey null when 2+ candidates exist (OI-2 fallback)', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G1', null));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(groups.getEntity('G1')?.headWorkOrderKey).toBeNull();
  });

  it('clears stale membership on repeated calls (idempotent)', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const groups = new CTPWorkOrderGroups();
    const g1 = makeGroup('G1');
    g1.workOrderKeys = ['STALE_KEY'];
    g1.headWorkOrderKey = 'STALE_HEAD';
    groups.addEntity(g1);

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(groups.getEntity('G1')?.workOrderKeys).toEqual(['WO1']);
    expect(groups.getEntity('G1')?.headWorkOrderKey).toBe('WO1');
  });
});

// ─── rebuildGroups: denormalisation ───────────────────────────────────────

describe('RollupEngine.rebuildGroups — denormalisation', () => {
  it('copies group hierarchy reference onto each member order', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));

    const groups = new CTPWorkOrderGroups();
    const g1 = makeGroup('G1');
    g1.hierarchy.first = 'CEM International';
    g1.hierarchy.second = 'MI 252208';
    g1.hierarchy.third = '12118';
    groups.addEntity(g1);

    engine.rebuildGroups(orders, new CTPTasks(), groups);

    expect(orders.getEntity('WO1')?.hierarchy).toBe(g1.hierarchy);   // reference share
    expect(orders.getEntity('WO2')?.hierarchy).toBe(g1.hierarchy);
    expect(orders.getEntity('WO1')?.hierarchy.first).toBe('CEM International');
  });

  it('copies group hierarchy down to tasks via their linked order, sets task.groupKey', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1'));
    tasks.addEntity(makeTask('T2', 'WO1'));

    const groups = new CTPWorkOrderGroups();
    const g1 = makeGroup('G1');
    g1.hierarchy.first = 'CEM International';
    groups.addEntity(g1);

    engine.rebuildGroups(orders, tasks, groups);

    expect(tasks.getEntity('T1')?.groupKey).toBe('G1');
    expect(tasks.getEntity('T2')?.groupKey).toBe('G1');
    expect(tasks.getEntity('T1')?.hierarchy.first).toBe('CEM International');
  });

  it('does not crash for tasks whose linked order has no group', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WOX', null));    // ungrouped order

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('TX', 'WOX'));

    const groups = new CTPWorkOrderGroups();

    expect(() => engine.rebuildGroups(orders, tasks, groups)).not.toThrow();
    expect(tasks.getEntity('TX')?.groupKey).toBeNull();
  });
});

// ─── Hierarchy → attribute mirror + reference-share invariant ─────────────

describe('RollupEngine — hierarchy/attribute mirror', () => {
  function setUp() {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1'));
    tasks.addEntity(makeTask('T2', 'WO2'));

    const groups = new CTPWorkOrderGroups();
    const g1 = makeGroup('G1');
    g1.hierarchy.first  = 'CEM International';
    g1.hierarchy.second = 'MI 252208';
    g1.hierarchy.third  = '12118';
    // Hierarchy slot names default to "Hierarchy N" — rename to mimic
    // what the mapping engine does for real (e.g. "Customer", "Project").
    const n1 = g1.hierarchy.index(0); if (n1) n1.name = 'Customer';
    const n2 = g1.hierarchy.index(1); if (n2) n2.name = 'Project';
    const n3 = g1.hierarchy.index(2); if (n3) n3.name = 'SalesOrder';
    // Plus one pre-existing authored attribute.
    g1.attributes.add(new NameValue('Strategy', 'JIT'));
    groups.addEntity(g1);

    return { engine, orders, tasks, groups, g1 };
  }

  it('appends hierarchy slot names + values to group.attributes after rebuild', () => {
    const { engine, orders, tasks, groups, g1 } = setUp();
    engine.rebuildGroups(orders, tasks, groups);

    const names: string[] = [];
    g1.attributes.forEach((nv) => names.push(nv.name));
    expect(names).toContain('Strategy');     // authored, preserved
    expect(names).toContain('Customer');     // mirrored
    expect(names).toContain('Project');
    expect(names).toContain('SalesOrder');

    // Mirror values match hierarchy values
    let customerVal: string | null = null;
    g1.attributes.forEach((nv) => { if (nv.name === 'Customer') customerVal = nv.value; });
    expect(customerVal).toBe('CEM International');
  });

  it('regenerates mirror on a second rebuild — no duplicate entries', () => {
    const { engine, orders, tasks, groups, g1 } = setUp();
    engine.rebuildGroups(orders, tasks, groups);
    engine.rebuildGroups(orders, tasks, groups);

    const customerCount = countByName(g1.attributes, 'Customer');
    expect(customerCount).toBe(1);
    // And authored survives both passes
    expect(countByName(g1.attributes, 'Strategy')).toBe(1);
  });

  it('mirror is visible on member orders + tasks via reference share', () => {
    const { engine, orders, tasks, groups } = setUp();
    engine.rebuildGroups(orders, tasks, groups);

    for (const orderKey of ['WO1', 'WO2']) {
      const o = orders.getEntity(orderKey)!;
      const names: string[] = [];
      o.attributes.forEach((nv) => names.push(nv.name));
      expect(names).toContain('Customer');
      expect(names).toContain('Strategy');
    }
    for (const taskKey of ['T1', 'T2']) {
      const t = tasks.getEntity(taskKey)!;
      const names: string[] = [];
      t.attributes.forEach((nv) => names.push(nv.name));
      expect(names).toContain('Customer');
    }
  });

  // ─── Reference-share invariant ─────────────────────────────────────────
  //
  // The mirror only works because group + member orders + member tasks
  // share the same CTPAttributes (and CTPHierarchies) instance. If anyone
  // refactors that into a copy, these tests fail loudly — before subtle
  // aliasing bugs surface in distant code.

  it('reference-share invariant: order.attributes === group.attributes', () => {
    const { engine, orders, tasks, groups, g1 } = setUp();
    engine.rebuildGroups(orders, tasks, groups);
    expect(orders.getEntity('WO1')!.attributes).toBe(g1.attributes);
    expect(orders.getEntity('WO2')!.attributes).toBe(g1.attributes);
  });

  it('reference-share invariant: task.attributes === order.attributes === group.attributes', () => {
    const { engine, orders, tasks, groups, g1 } = setUp();
    engine.rebuildGroups(orders, tasks, groups);
    expect(tasks.getEntity('T1')!.attributes).toBe(g1.attributes);
    expect(tasks.getEntity('T2')!.attributes).toBe(g1.attributes);
    expect(tasks.getEntity('T1')!.attributes).toBe(orders.getEntity('WO1')!.attributes);
  });

  it('reference-share invariant: order.hierarchy === group.hierarchy', () => {
    const { engine, orders, tasks, groups, g1 } = setUp();
    engine.rebuildGroups(orders, tasks, groups);
    expect(orders.getEntity('WO1')!.hierarchy).toBe(g1.hierarchy);
    expect(orders.getEntity('WO2')!.hierarchy).toBe(g1.hierarchy);
  });

  it('reference-share invariant: task.hierarchy === order.hierarchy === group.hierarchy', () => {
    const { engine, orders, tasks, groups, g1 } = setUp();
    engine.rebuildGroups(orders, tasks, groups);
    expect(tasks.getEntity('T1')!.hierarchy).toBe(g1.hierarchy);
    expect(tasks.getEntity('T2')!.hierarchy).toBe(g1.hierarchy);
    expect(tasks.getEntity('T1')!.hierarchy).toBe(orders.getEntity('WO1')!.hierarchy);
  });
});

function countByName(list: { forEach: (cb: (nv: { name: string }) => void) => void }, name: string): number {
  let n = 0;
  list.forEach((nv) => { if (nv.name === name) n++; });
  return n;
}

// ─── refreshRollups: timing + counts ──────────────────────────────────────

describe('RollupEngine.refreshRollups', () => {
  it('computes min start / max end across member tasks', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null, 50, 25));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1', 30, 15));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0 + DAY, T0 + 2 * DAY));
    tasks.addEntity(makeTask('T2', 'WO1', T0 + 3 * DAY, T0 + 5 * DAY));
    tasks.addEntity(makeTask('T3', 'WO2', T0, T0 + 4 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 30 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    const g = groups.getEntity('G1');
    expect(g?.computedStart).toBe(T0);
    expect(g?.computedEnd).toBe(T0 + 5 * DAY);
    expect(g?.totalWorkOrders).toBe(2);
    expect(g?.totalDemandQty).toBe(80);
    expect(g?.totalScheduledQty).toBe(40);
  });

  it('leaves computed dates null when no tasks are scheduled', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1'));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    const g = groups.getEntity('G1');
    expect(g?.computedStart).toBeNull();
    expect(g?.computedEnd).toBeNull();
  });
});

// ─── deriveStatus ─────────────────────────────────────────────────────────

describe('RollupEngine.deriveStatus (via refreshRollups)', () => {
  it('LATE when computedEnd > sourceEnd', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 11 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.LATE);
  });

  it('AT_RISK when computedEnd within bufferDays of sourceEnd', () => {
    const engine = makeEngine();   // default bufferDays = 3
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 8 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.AT_RISK);
  });

  it('ON_TRACK when computedEnd safely within sourceEnd - bufferDays', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 5 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.ON_TRACK);
  });

  it('BLOCKED when any member task has an infeasibility report', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    const t = makeTask('T1', 'WO1', T0, T0 + 2 * DAY);
    t.infeasibilityReport = { slots: [] } as unknown as InfeasibilityReport;
    tasks.addEntity(t);

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.BLOCKED);
  });

  it('respects custom bufferDays via injected config', () => {
    const engine = makeEngine({ bufferDays: 7 });
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 5 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.AT_RISK);
  });
});

// ─── cancellation predicate ───────────────────────────────────────────────

describe('RollupEngine — cancellation predicate', () => {
  it('does not count any orders cancelled when values is empty (Stafford default)', () => {
    const engine = makeEngine();   // empty predicate values
    const orders = new CTPOrders();
    const o1 = makeOrder('WO1', 'G1', null);
    o1.rawFields = { wostatus: 'CANCELLED' };
    orders.addEntity(o1);

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, new CTPTasks(), groups);
    engine.refreshRollups(groups, orders, new CTPTasks(), T0);

    expect(groups.getEntity('G1')?.cancelledWorkOrders).toBe(0);
  });

  it('counts orders whose rawFields field matches a predicate value', () => {
    const engine = makeEngine({
      cancellationPredicate: { field: 'wostatus', values: ['CANCELLED'] },
    });
    const orders = new CTPOrders();
    const o1 = makeOrder('WO1', 'G1', null);
    o1.rawFields = { wostatus: 'CANCELLED' };
    const o2 = makeOrder('WO2', 'G1', 'WO1');
    o2.rawFields = { wostatus: 'IN_PROCESS' };
    orders.addEntity(o1);
    orders.addEntity(o2);

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, new CTPTasks(), groups);
    engine.refreshRollups(groups, orders, new CTPTasks(), T0);

    expect(groups.getEntity('G1')?.cancelledWorkOrders).toBe(1);
  });

  it('returns CANCELLED status when every member matches the predicate', () => {
    const engine = makeEngine({
      cancellationPredicate: { field: 'wostatus', values: ['CANCELLED', 'VOID'] },
    });
    const orders = new CTPOrders();
    const o1 = makeOrder('WO1', 'G1', null);
    o1.rawFields = { wostatus: 'CANCELLED' };
    const o2 = makeOrder('WO2', 'G1', 'WO1');
    o2.rawFields = { wostatus: 'VOID' };
    orders.addEntity(o1);
    orders.addEntity(o2);

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, new CTPTasks(), groups);
    engine.refreshRollups(groups, orders, new CTPTasks(), T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.CANCELLED);
  });
});

// ─── lateGroups (acceptance criterion #6) ─────────────────────────────────

describe('CTPWorkOrderGroups.lateGroups', () => {
  it('returns the groups whose computedEnd exceeds sourceEnd', () => {
    const engine = makeEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G2', null));
    orders.addEntity(makeOrder('WO3', 'G3', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 5 * DAY));
    tasks.addEntity(makeTask('T2', 'WO2', T0, T0 + 11 * DAY));
    tasks.addEntity(makeTask('T3', 'WO3', T0, T0 + 12 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));
    groups.addEntity(makeGroup('G2', T0, T0 + 10 * DAY));
    groups.addEntity(makeGroup('G3', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, tasks, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    const lateKeys = groups.lateGroups().map(g => g.key).sort();
    expect(lateKeys).toEqual(['G2', 'G3']);
  });
});
