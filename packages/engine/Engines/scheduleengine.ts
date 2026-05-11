import { TaskFactory } from "../Factories/taskfactory";
import {
  CTPAssignmentConstants,
  CTPDurationConstants,
  CTPScheduleDirectionConstants,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
} from "../Models/Core/constants";
import { CTPAssignment, CTPDuration, CTPInterval } from "../Models/Core/window";
import { workingEndForwardW } from "../Models/Core/interval-walker";
import { ILandscape } from "../Models/Entities/landscape";
import { CTPResource } from "../Models/Entities/resource";
import {
  BestScheduleContext,
  ScheduleContext,
} from "../Models/Entities/schedulecontext";
import { CTPResourceSlots } from "../Models/Entities/slot";
import { CTPTask, CTPTaskResource } from "../Models/Entities/task";

export interface IScheduleEngine {
  schedule(
    landscape: ILandscape,
    task: CTPTask,
    schedule: BestScheduleContext,
    direction: number 
  ): void;
  unschedule(landscape: ILandscape, task: CTPTask): void;


}

export class ScheduleEngine implements IScheduleEngine {
  public schedule(
    landscape: ILandscape,
    task: CTPTask,
    schedule: BestScheduleContext,
    direction: number = CTPScheduleDirectionConstants.FORWARD
  ): void {

    if (!schedule || !schedule.best || !schedule.best.slot || !task.duration)
      return;

    let offset = (direction === CTPScheduleDirectionConstants.FORWARD)
                  ? schedule.startTimes.processChangeDuration
                  : -schedule.startTimes.processChangeDuration;

    let st = schedule.startTime + offset;
    let et: number;

    // FLOAT: end time is the wall-clock moment when accumulated working
    // time across the resource's available shifts equals task.duration.
    // FIXED: end = start + duration (single contiguous slot, by definition).
    if (this.isFloat(task.duration)) {
      et = this.computeFloatEndW(schedule.best.slot, st, task.duration);
    } else {
      et = st + task.duration.duration();
    }

    task.state = CTPTaskStateConstants.SCHEDULED;

    if (task.scheduled === null) task.scheduled = new CTPInterval();
    task.scheduled.set(st, et, 1);

    let index = 0;
    schedule.best.slot.resources?.forEach((res) => {
      this.addTaskToResource(res.resource, task, st, et, CTPAssignmentConstants.PROCESS, index, schedule.subType);
      index = index + 1;
    });
  }

  private isFloat(d: CTPDuration): boolean {
    return d.durationType === CTPDurationConstants.FLOAT_DURATION
        || d.durationType === CTPDurationConstants.FLOAT_RUN_RATE;
  }

  // Walk the canonical resource's calendar from startW for `duration` working
  // seconds and return the wall-clock end. Delegates to the shared helper so
  // ChainContextEngine, CommonStartTimesAgent, and ScheduleEngine all derive
  // FLOAT end times the same way.
  private computeFloatEndW(
    slot: CTPResourceSlots,
    startW: number,
    duration: CTPDuration,
  ): number {
    const list = slot.resources?.at(0)?.resource?.available?.staticAvailable;
    return workingEndForwardW(list, startW, duration);
  }

  public unschedule(landscape: ILandscape, task: CTPTask): void {
    task.state = CTPTaskStateConstants.NOT_SCHEDULED;
    task.scheduled = null;
    if (task.capacityResources) {
      task.capacityResources.forEach((res) => {
        if (res.isIgnored()) { res.scheduledResource = ""; return; }
        const r = this.findResource(res.scheduledResource, landscape);
        if (r) this.removeTaskFromResource(r, task);
        res.scheduledResource = "";
      });
    }
    if (task.materialsResources) {
      task.materialsResources.forEach((res) => {
        if (res.isIgnored()) { res.scheduledResource = ""; return; }
        const r = this.findResource(res.scheduledResource, landscape);
        if (r) this.removeTaskFromResource(r, task);
        res.scheduledResource = "";
      });
    }

  }

  

  private findResource(
    key: string | undefined,
    landscape: ILandscape,
  ): CTPResource | null {
    let r: CTPResource | undefined = undefined;
    if (landscape && landscape.resources && key)
      r = landscape.resources.getEntity(key);

    if (r === undefined) return null;
    return r;
  }

  public addTaskToResource(
    resource: CTPResource | null,
    task: CTPTask | null,
    st: number,
    et: number,
    assType: number,
    index: number,
    subType? : number 
  ) {
    if (!resource || !task) return;

    let capresource: CTPTaskResource | undefined;

    const capLen = task.capacityResources?.length ?? 0;
    if (index < capLen) {
      capresource = task.capacityResources?.at(index);
    } else {
      capresource = task.materialsResources?.at(index - capLen);
    }
    let t: CTPAssignment;

    if (capresource) {
      t = new CTPAssignment(st, et, capresource.qty);
      t.name = task.key;
      t.type = assType;
      t.subType = subType ?? -1;
      // Compute working-time segments only for FLOAT — FIXED's envelope IS work time.
      if (task.duration && this.isFloat(task.duration)) {
        t.segments = CTPAssignment.segmentsFromCalendar(resource.original, st, et);
      }
      resource.assignments?.add(t);
      resource.recompute = true;
      capresource.scheduledResource = resource.key;
    }
  }

  public removeTaskFromResource(resource: CTPResource, task: CTPTask) {
    if (!resource || !task) return;
    if (resource.assignments) {
      let i = resource.assignments.head;
      while (i) {
        let a = i.data;
        if (a && a?.name == task.key) {
          let d = i;
          i = i.next;
          resource.assignments.deleteNode(d);
        } else i = i.next;
      }
    }
    resource.recompute = true;
  }
}
