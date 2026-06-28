import { describe, it, expect } from 'vitest';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPTask, CTPTasks } from '../../Models/Entities/task';
import { CTPResource, CTPResources } from '../../Models/Entities/resource';
import { CTPOrder, CTPOrders } from '../../Models/Entities/order';
import { CTPInterval } from '../../Models/Core/window';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPAvailable, CTPAssignments } from '../../Models/Intervals/intervals';
import { summarizeLandscape } from '../../Snapshot/summary';
import { makeDuration, makeHorizon } from '../helpers/builders';

function scheduledTask(key: string, startW: number, endW: number, chain?: string): CTPTask {
  const t = new CTPTask('PROCESS', key, key);
  t.duration = makeDuration(endW - startW);
  t.state = 1;
  t.scheduled = new CTPInterval(startW, endW);
  t.includeInSolve = false;
  if (chain) t.linkId = new CTPLinkId(chain, 'ES', '', null);
  return t;
}

describe('summarizeLandscape (P6)', () => {
  it('computes headline counts, weekly buckets, bottleneck, and injected shortages', () => {
    const horizon = makeHorizon(14);          // 2 weeks → 2 buckets
    const s = horizon.startW;
    const wk = 7 * 86_400;

    const ls = new SchedulingLandscape();
    ls.horizon = horizon;

    // resources: BUSY fully booked in week 1; IDLE no bookings
    const busy = new CTPResource('REUSABLE', 'Machine', 'Busy', 'BUSY');
    busy.hierarchy.first = 'Machining';
    busy.original = new CTPAvailable();
    busy.original.add(new CTPInterval(s, s + 2 * wk));   // available both weeks
    busy.assignments = new CTPAssignments();
    busy.assignments.add(new CTPInterval(s, s + wk));    // booked all of week 1
    const idle = new CTPResource('REUSABLE', 'Machine', 'Idle', 'IDLE');
    idle.original = new CTPAvailable();
    idle.original.add(new CTPInterval(s, s + 2 * wk));
    idle.assignments = new CTPAssignments();
    ls.resources = new CTPResources();
    ls.resources.addEntity(busy);
    ls.resources.addEntity(idle);

    // tasks: 2 scheduled (one late chain), 1 included-but-unscheduled (conflict)
    ls.tasks = new CTPTasks();
    ls.tasks.addEntity(scheduledTask('T1', s, s + 3600, 'O1'));
    ls.tasks.addEntity(scheduledTask('T2', s + 3600, s + 7200, 'O2'));
    const conflict = new CTPTask('PROCESS', 'T3', 'T3');
    conflict.duration = makeDuration(3600);
    conflict.includeInSolve = true;   // wanted but not scheduled
    ls.tasks.addEntity(conflict);

    // orders: O1 due before its chain end (LATE), O2 due after (on time)
    ls.orders = new CTPOrders();
    const o1 = new CTPOrder('Order', 'O1', 'O1'); o1.dueDate = s + 1800;    // chain end s+3600 > due → late
    const o2 = new CTPOrder('Order', 'O2', 'O2'); o2.dueDate = s + 999_999; // generous
    ls.orders.addEntity(o1);
    ls.orders.addEntity(o2);

    const doc = summarizeLandscape(ls, { materialShortages: 2 });

    // headline
    expect(doc.headline.totalTasks).toBe(3);
    expect(doc.headline.scheduledTasks).toBe(2);
    expect(doc.headline.conflicts).toBe(1);          // T3 included, unscheduled
    expect(doc.headline.includedTasks).toBe(3);      // 2 scheduled + 1 includeInSolve
    expect(doc.headline.feasibilityRate).toBeCloseTo(2 / 3, 4);
    expect(doc.headline.totalOrders).toBe(2);
    expect(doc.headline.lateOrders).toBe(1);         // O1
    expect(doc.headline.shortages).toBe(2);
    expect(doc.headline.makespanSeconds).toBe(7200);

    // bucketMeta + bare-number buckets indexed to it
    expect(doc.bucketMeta.granularity).toBe('week');
    expect(doc.bucketMeta.count).toBe(2);
    const busyLoad = doc.resourceLoad.find(r => r.resourceKey === 'BUSY')!;
    expect(busyLoad.buckets).toHaveLength(doc.bucketMeta.count);
    expect(busyLoad.buckets.every(b => typeof b === 'number')).toBe(true);
    expect(busyLoad.buckets[0]).toBeCloseTo(1, 4);   // fully booked week 1
    expect(busyLoad.buckets[1]).toBeCloseTo(0, 4);   // idle week 2
    expect(busyLoad.workCenter).toBe('Machining');

    // bottleneck = the most-utilized resource
    expect(doc.headline.bottleneck?.resourceKey).toBe('BUSY');
    expect(doc.headline.bottleneck?.pct).toBeCloseTo(0.5, 4); // booked 1 of 2 weeks overall

    // alerts mirror counts
    expect(doc.alerts.conflicts.count).toBe(1);
    expect(doc.alerts.materials.count).toBe(2);
  });

  it('handles an empty / unsolved landscape without throwing', () => {
    const ls = new SchedulingLandscape();
    ls.horizon = makeHorizon(7);
    const doc = summarizeLandscape(ls);
    expect(doc.headline.scheduledTasks).toBe(0);
    expect(doc.headline.feasibilityRate).toBe(0);
    expect(doc.headline.bottleneck).toBeNull();
    expect(doc.resourceLoad).toEqual([]);
  });
});
