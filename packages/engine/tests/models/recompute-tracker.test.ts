import { describe, it, expect, beforeEach } from 'vitest';
import { RecomputeTracker } from '../../Models/Entities/recompute-tracker';
import {
  ScheduleContext,
  ScheduleContexts,
  TaskScheduleContexts,
  ResourceScheduleContexts,
} from '../../Models/Entities/schedulecontext';
import { CTPTask, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource } from '../../Models/Entities/resource';
import { CTPResourceSlots, CTPResourceSlot } from '../../Models/Entities/slot';
import { CTPStartTime } from '../../Models/Entities/starttime';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPResourceConstants } from '../../Models/Core/constants';
import { EntityHashMap } from '../../Models/Core/hashmap';
import { DateTime } from 'luxon';
import { CPTStartTimes } from '../../Models/Intervals/intervals';

function makeTask(name: string, key: string): CTPTask {
  const t = new CTPTask('PROCESS', name, key);
  t.capacityResources = new CTPTaskResourceList();
  return t;
}

function makeResource(name: string, key: string): CTPResource {
  return new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', name, key);
}

function makeLandscape(): SchedulingLandscape {
  const landscape = new SchedulingLandscape();
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  landscape.horizon = new CTPHorizon(st, st.plus({ days: 7 }));
  return landscape;
}

function makeSlotWithResource(resource: CTPResource): CTPResourceSlots {
  const slot = new CTPResourceSlots();
  slot.resources?.add(new CTPResourceSlot(resource, 0));
  // Add start times so hasStartTimes() returns true
  slot.startTimes = new CPTStartTimes();
  const stTime = new CTPStartTime();
  stTime.startW = 100;
  stTime.endW = 200;
  slot.startTimes.insertAtEnd(stTime);
  return slot;
}

describe('RecomputeTracker', () => {
  let byTask: EntityHashMap<TaskScheduleContexts>;
  let byResource: EntityHashMap<ResourceScheduleContexts>;
  let tracker: RecomputeTracker;

  beforeEach(() => {
    byTask = new EntityHashMap<TaskScheduleContexts>();
    byResource = new EntityHashMap<ResourceScheduleContexts>();
    tracker = new RecomputeTracker(byTask, byResource);
  });

  describe('markScheduled', () => {
    it('marks context as not needing recompute and task as processed', () => {
      const landscape = makeLandscape();
      const task = makeTask('TaskA', 'task-a');
      const resource = makeResource('Res1', 'res-1');
      const slot = makeSlotWithResource(resource);
      const ctx = new ScheduleContext(landscape, task, slot);
      ctx.recompute = true;

      // Register in byTask/byResource
      const tc = new TaskScheduleContexts(task);
      tc.contexts.add(ctx);
      byTask.addEntity(tc);
      const rc = new ResourceScheduleContexts(resource);
      rc.contexts.add(ctx);
      byResource.addEntity(rc);

      tracker.markScheduled(ctx);

      expect(ctx.recompute).toBe(false);
      expect(task.processed).toBe(true);
    });

    it('cascades recompute to sibling contexts on shared resource', () => {
      const landscape = makeLandscape();
      const taskA = makeTask('TaskA', 'task-a');
      const taskB = makeTask('TaskB', 'task-b');
      const resource = makeResource('Res1', 'res-1');

      const slotA = makeSlotWithResource(resource);
      const slotB = makeSlotWithResource(resource);

      const ctxA = new ScheduleContext(landscape, taskA, slotA);
      const ctxB = new ScheduleContext(landscape, taskB, slotB);
      ctxA.recompute = true;
      ctxB.recompute = false;

      // Register both in byTask
      const tcA = new TaskScheduleContexts(taskA);
      tcA.contexts.add(ctxA);
      byTask.addEntity(tcA);
      const tcB = new TaskScheduleContexts(taskB);
      tcB.contexts.add(ctxB);
      byTask.addEntity(tcB);

      // Register both in byResource (shared resource)
      const rc = new ResourceScheduleContexts(resource);
      rc.contexts.add(ctxA);
      rc.contexts.add(ctxB);
      byResource.addEntity(rc);

      tracker.markScheduled(ctxA);

      expect(ctxA.recompute).toBe(false);
      expect(ctxB.recompute).toBe(true); // cascaded
      expect(resource.recompute).toBe(true);
      expect(taskB.score).toBe(Number.MAX_VALUE);
    });

    it('does not cascade to already-processed sibling tasks', () => {
      const landscape = makeLandscape();
      const taskA = makeTask('TaskA', 'task-a');
      const taskB = makeTask('TaskB', 'task-b');
      taskB.processed = true; // already processed
      const resource = makeResource('Res1', 'res-1');

      const slotA = makeSlotWithResource(resource);
      const slotB = makeSlotWithResource(resource);

      const ctxA = new ScheduleContext(landscape, taskA, slotA);
      const ctxB = new ScheduleContext(landscape, taskB, slotB);
      ctxB.recompute = false; // explicitly set to false

      const tcA = new TaskScheduleContexts(taskA);
      tcA.contexts.add(ctxA);
      byTask.addEntity(tcA);
      const tcB = new TaskScheduleContexts(taskB);
      tcB.contexts.add(ctxB);
      byTask.addEntity(tcB);

      const rc = new ResourceScheduleContexts(resource);
      rc.contexts.add(ctxA);
      rc.contexts.add(ctxB);
      byResource.addEntity(rc);

      const origScore = taskB.score;
      tracker.markScheduled(ctxA);

      // taskB was already processed, so cascade should NOT flip recompute
      expect(ctxB.recompute).toBe(false);
      expect(taskB.score).toBe(origScore);
    });

    it('skips when slot has no start times', () => {
      const landscape = makeLandscape();
      const task = makeTask('TaskA', 'task-a');
      const resource = makeResource('Res1', 'res-1');
      const slot = new CTPResourceSlots(); // no start times
      slot.resources?.add(new CTPResourceSlot(resource, 0));
      const ctx = new ScheduleContext(landscape, task, slot);
      ctx.recompute = true;

      const tc = new TaskScheduleContexts(task);
      tc.contexts.add(ctx);
      byTask.addEntity(tc);

      tracker.markScheduled(ctx);

      // Should have returned early — recompute still true
      expect(ctx.recompute).toBe(true);
    });

    it('handles null input gracefully', () => {
      expect(() => tracker.markScheduled(null as any)).not.toThrow();
    });
  });

  describe('markUnscheduled', () => {
    it('marks resource contexts stale for task capacity resources', () => {
      const landscape = makeLandscape();
      const taskA = makeTask('TaskA', 'task-a');
      const taskB = makeTask('TaskB', 'task-b');
      const resource = makeResource('Res1', 'res-1');

      // TaskA has capacity resource pointing to res-1
      const tr = new CTPTaskResource('Machine', true);
      tr.scheduledResource = 'res-1';
      taskA.capacityResources!.add(tr);

      const slotA = makeSlotWithResource(resource);
      const slotB = makeSlotWithResource(resource);

      const ctxA = new ScheduleContext(landscape, taskA, slotA);
      const ctxB = new ScheduleContext(landscape, taskB, slotB);
      ctxB.recompute = false;

      const tcA = new TaskScheduleContexts(taskA);
      tcA.contexts.add(ctxA);
      byTask.addEntity(tcA);
      const tcB = new TaskScheduleContexts(taskB);
      tcB.contexts.add(ctxB);
      byTask.addEntity(tcB);

      const rc = new ResourceScheduleContexts(resource);
      rc.contexts.add(ctxA);
      rc.contexts.add(ctxB);
      byResource.addEntity(rc);

      tracker.markUnscheduled(taskA);

      expect(resource.recompute).toBe(true);
      expect(ctxB.recompute).toBe(true); // sibling on same resource
    });

    it('does not mark own context stale (filters by task key)', () => {
      const landscape = makeLandscape();
      const taskA = makeTask('TaskA', 'task-a');
      const resource = makeResource('Res1', 'res-1');

      const tr = new CTPTaskResource('Machine', true);
      tr.scheduledResource = 'res-1';
      taskA.capacityResources!.add(tr);

      const slotA = makeSlotWithResource(resource);
      const ctxA = new ScheduleContext(landscape, taskA, slotA);
      ctxA.recompute = false;

      const tcA = new TaskScheduleContexts(taskA);
      tcA.contexts.add(ctxA);
      byTask.addEntity(tcA);

      const rc = new ResourceScheduleContexts(resource);
      rc.contexts.add(ctxA);
      byResource.addEntity(rc);

      tracker.markUnscheduled(taskA);

      // Should NOT mark its own context — key check filters it out
      expect(ctxA.recompute).toBe(false);
    });

    it('handles null input gracefully', () => {
      expect(() => tracker.markUnscheduled(null as any)).not.toThrow();
    });
  });
});
