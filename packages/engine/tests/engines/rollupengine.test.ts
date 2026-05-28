import { describe, it, expect } from 'vitest';
import { RollupEngine } from '../../Engines/rollupengine';
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

// ─── Helpers ──────────────────────────────────────────────────────────────

const T0 = 1700000000;   // base epoch seconds (~Nov 2023) — arbitrary anchor
const DAY = 86400;

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

// ─── rebuildGroups ────────────────────────────────────────────────────────

describe('RollupEngine.rebuildGroups', () => {
  it('attaches orders to their groups by groupKey', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));
    orders.addEntity(makeOrder('WO3', 'G2', null));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));
    groups.addEntity(makeGroup('G2'));

    engine.rebuildGroups(orders, groups);

    expect(groups.getEntity('G1')?.workOrderKeys.sort()).toEqual(['WO1', 'WO2']);
    expect(groups.getEntity('G2')?.workOrderKeys).toEqual(['WO3']);
  });

  it('ignores orders with null groupKey', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WOX', null));    // ungrouped

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, groups);

    expect(groups.getEntity('G1')?.workOrderKeys).toEqual(['WO1']);
  });

  it('sets headWorkOrderKey when exactly one order has null parent', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));        // head
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1'));
    orders.addEntity(makeOrder('WO3', 'G1', 'WO1'));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, groups);

    expect(groups.getEntity('G1')?.headWorkOrderKey).toBe('WO1');
  });

  it('leaves headWorkOrderKey null when 2+ candidates exist (OI-2 fallback)', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));        // candidate 1
    orders.addEntity(makeOrder('WO2', 'G1', null));        // candidate 2

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1'));

    engine.rebuildGroups(orders, groups);

    expect(groups.getEntity('G1')?.headWorkOrderKey).toBeNull();
  });

  it('clears stale membership on repeated calls (idempotent)', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const groups = new CTPWorkOrderGroups();
    const g1 = makeGroup('G1');
    g1.workOrderKeys = ['STALE_KEY'];
    g1.headWorkOrderKey = 'STALE_HEAD';
    groups.addEntity(g1);

    engine.rebuildGroups(orders, groups);

    expect(groups.getEntity('G1')?.workOrderKeys).toEqual(['WO1']);
    expect(groups.getEntity('G1')?.headWorkOrderKey).toBe('WO1');
  });
});

// ─── refreshRollups: timing + counts ──────────────────────────────────────

describe('RollupEngine.refreshRollups', () => {
  it('computes min start / max end across member tasks', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null, 50, 25));
    orders.addEntity(makeOrder('WO2', 'G1', 'WO1', 30, 15));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0 + DAY, T0 + 2 * DAY));
    tasks.addEntity(makeTask('T2', 'WO1', T0 + 3 * DAY, T0 + 5 * DAY));
    tasks.addEntity(makeTask('T3', 'WO2', T0, T0 + 4 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 30 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    const g = groups.getEntity('G1');
    expect(g?.computedStart).toBe(T0);                 // T3 earliest start
    expect(g?.computedEnd).toBe(T0 + 5 * DAY);         // T2 latest end
    expect(g?.totalWorkOrders).toBe(2);
    expect(g?.totalDemandQty).toBe(80);
    expect(g?.totalScheduledQty).toBe(40);
  });

  it('leaves computed dates null when no tasks are scheduled', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1'));   // unscheduled

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    const g = groups.getEntity('G1');
    expect(g?.computedStart).toBeNull();
    expect(g?.computedEnd).toBeNull();
  });
});

// ─── refreshRollups: deriveStatus ─────────────────────────────────────────

describe('RollupEngine.deriveStatus (via refreshRollups)', () => {
  it('LATE when computedEnd > sourceEnd', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 11 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.LATE);
  });

  it('AT_RISK when computedEnd within bufferDays of sourceEnd', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    // sourceEnd = T0+10d; default buffer = 3 days; AT_RISK if computedEnd > T0+7d
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 8 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.AT_RISK);
  });

  it('ON_TRACK when computedEnd safely within sourceEnd - bufferDays', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 5 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.ON_TRACK);
  });

  it('BLOCKED when any member task has an infeasibility report', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    const t = makeTask('T1', 'WO1', T0, T0 + 2 * DAY);
    // Stub — engine only checks for non-null, doesn't read contents
    t.infeasibilityReport = { slots: [] } as unknown as InfeasibilityReport;
    tasks.addEntity(t);

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.BLOCKED);
  });

  it('respects custom bufferDays', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));

    const tasks = new CTPTasks();
    // sourceEnd = T0+10d; buffer = 7 days; AT_RISK if computedEnd > T0+3d
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 5 * DAY));

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0, 7);   // 7-day buffer

    expect(groups.getEntity('G1')?.status).toBe(WorkOrderGroupStatus.AT_RISK);
  });
});

// ─── lateGroups (acceptance criterion #6) ─────────────────────────────────

describe('CTPWorkOrderGroups.lateGroups', () => {
  it('returns the groups whose computedEnd exceeds sourceEnd', () => {
    const engine = new RollupEngine();
    const orders = new CTPOrders();
    orders.addEntity(makeOrder('WO1', 'G1', null));
    orders.addEntity(makeOrder('WO2', 'G2', null));
    orders.addEntity(makeOrder('WO3', 'G3', null));

    const tasks = new CTPTasks();
    tasks.addEntity(makeTask('T1', 'WO1', T0, T0 + 5 * DAY));      // G1 on track
    tasks.addEntity(makeTask('T2', 'WO2', T0, T0 + 11 * DAY));     // G2 late
    tasks.addEntity(makeTask('T3', 'WO3', T0, T0 + 12 * DAY));     // G3 late

    const groups = new CTPWorkOrderGroups();
    groups.addEntity(makeGroup('G1', T0, T0 + 10 * DAY));
    groups.addEntity(makeGroup('G2', T0, T0 + 10 * DAY));
    groups.addEntity(makeGroup('G3', T0, T0 + 10 * DAY));

    engine.rebuildGroups(orders, groups);
    engine.refreshRollups(groups, orders, tasks, T0);

    const lateKeys = groups.lateGroups().map(g => g.key).sort();
    expect(lateKeys).toEqual(['G2', 'G3']);
  });
});
