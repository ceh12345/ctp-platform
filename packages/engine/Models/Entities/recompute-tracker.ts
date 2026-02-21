import { ScheduleContext, TaskScheduleContexts, ResourceScheduleContexts } from './schedulecontext';
import { CTPTask } from './task';
import { EntityHashMap } from '../Core/hashmap';

/**
 * Manages dirty-flag cascading when tasks are scheduled or unscheduled.
 * Extracted from ScheduleContexts.updateRecompute / updateRecomputeByTask.
 */
export class RecomputeTracker {
  constructor(
    private byTask: EntityHashMap<TaskScheduleContexts>,
    private byResource: EntityHashMap<ResourceScheduleContexts>,
  ) {}

  /**
   * Mark a schedule context as processed and cascade recompute flags
   * to all sibling contexts sharing the same resources.
   * Called after a task is scheduled.
   */
  markScheduled(s: ScheduleContext): void {
    if (!s) return;
    if (!s.slot.hasStartTimes()) return;

    const task = this.byTask.getEntity(s.task.key);
    if (task) {
      s.recompute = false;
      s.task.processed = true;
      s.slot.resources?.forEach((res) => {
        const resource = this.byResource.getEntity(res.resource?.hashKey ?? '');
        if (resource) {
          resource.value.recompute = true;
          resource.contexts.forEach((schedule) => {
            if (schedule.task && !schedule.task.processed) {
              schedule.recompute = true;
              schedule.task.score = Number.MAX_VALUE;
            }
          });
        }
      });
    }
  }

  /**
   * Mark resource contexts stale for a task's capacity resources.
   * Called when a task is unscheduled to invalidate affected schedules.
   */
  markUnscheduled(t: CTPTask): void {
    if (!t) return;
    const task = this.byTask.getEntity(t.key);
    if (task) {
      t.capacityResources?.forEach((res) => {
        const resource = this.byResource.getEntity(res.scheduledResource ?? '');
        if (resource) {
          resource.value.recompute = true;
          resource.contexts.forEach((schedule) => {
            if (schedule.task && schedule.task.key !== t.key) {
              schedule.recompute = true;
              if (!schedule.task.processed)
                schedule.task.score = Number.MAX_VALUE;
            }
          });
        }
      });
    }
  }
}
