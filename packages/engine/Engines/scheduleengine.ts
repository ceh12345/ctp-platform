import { TaskFactory } from "../Factories/taskfactory";
import {
  CTPAssignmentConstants,
  CTPScheduleDirectionConstants,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
} from "../Models/Core/constants";
import { CTPAssignment, CTPInterval } from "../Models/Core/window";
import { ILandscape } from "../Models/Entities/landscape";
import { CTPResource } from "../Models/Entities/resource";
import {
  BestScheduleContext,
  ScheduleContext,
} from "../Models/Entities/schedulecontext";
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
    let et = st + task.duration.duration();

    task.state = CTPTaskStateConstants.SCHEDULED;

    if (task.scheduled === null) task.scheduled = new CTPInterval();
    task.scheduled.set(st, et, 1);

    console.log("SCHEDULED " + task.name);
    task.scheduled.debug(true);

    let index = 0;
    schedule.best.slot.resources?.forEach((res) => {
      this.addTaskToResource(res.resource, task, st, et, CTPAssignmentConstants.PROCESS, index, schedule.subType);
      index = index + 1;
    });
  }

  public unschedule(landscape: ILandscape, task: CTPTask): void {
   
    console.log("UNSCHEDULED " + task.name);
    task.scheduled?.debug(true);

    task.state = CTPTaskStateConstants.NOT_SCHEDULED;
    task.scheduled = null;
    if (task.capacityResources) {
      task.capacityResources.forEach((res) => {
        const r = this.findResource(res.scheduledResource, landscape);
        if (r) this.removeTaskFromResource(r, task);
        res.scheduledResource = "";
      });
    }
    if (task.materialsResources) {
      task.materialsResources.forEach((res) => {
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

    var capresource: CTPTaskResource | undefined;

    const capLen = task.capacityResources?.length ?? 0;
    if (index < capLen) {
      capresource = task.capacityResources?.at(index);
    } else {
      capresource = task.materialsResources?.at(index - capLen);
    }
    var t: CTPAssignment;

    if (capresource) {
      t = new CTPAssignment(st, et, capresource.qty);
      t.name = task.key;
      t.type = assType; 
      t.subType = subType ?? -1;
      resource.assignments?.add(t);
      resource.recompute = true;
      capresource.scheduledResource = resource.key;
      console.log(' Resource ' + resource.name);
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
