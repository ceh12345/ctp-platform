"strict";
import {
  CTPAssignmentConstants,
  CTPDurationConstants,
  CTPResourceConstants,
  CTPScheduleDirectionConstants,
  CTPStateChangeConstants,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
} from "../Models/Core/constants";
import { CTPInterval } from "../Models/Core/window";
import { CTPIntervals, CTPAvailableTimes } from "../Models/Intervals/intervals";

import { AvailableMatrix } from "../Models/Intervals/availablematrix";
import { CTPBaseEngine, IBaseEngine } from "./baseengine";
import { CTPTask, CTPTaskResource, CTPTasks } from "../Models/Entities/task";
import { SchedulingLandscape } from "../Models/Entities/landscape";
import { BestScheduleContext, ScheduleContext } from "../Models/Entities/schedulecontext";
import { CTPStartTime } from "../Models/Entities/starttime";
import { CTPStateChangeResource } from "../Models/Entities/statechange";
import { TaskFactory } from "../Factories/taskfactory";

interface IStateChangeEngine extends IBaseEngine {
  getScheduleStateChangeTasks(
    task: CTPTask,
    bestSchedule: BestScheduleContext,
    landscape: SchedulingLandscape):  CTPTask[];
  getUnScheduleStateChangeTasks(
    task: CTPTask,
    landscape: SchedulingLandscape):  CTPTask[];
  applyStateChangeToStartTimes(
    st: number,
    et: number,
    schedule: ScheduleContext,
    landscape: SchedulingLandscape,
  ): void;

  computeStateChangeWindows(
    s?: number,
    e?: number,
    t?: CTPTask,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPIntervals | null;
}
export class StateChangeEngine
  extends CTPBaseEngine
  implements IStateChangeEngine
{
  public matrix: AvailableMatrix | null = null;
  public task: CTPTask | null = null;

  protected availStartTimes: CTPAvailableTimes | null = null;

  // all valid
  protected valid: boolean = false;
  protected listIndex: number = 0;
  protected debug: CTPInterval = new CTPInterval();

  protected assertLists(): boolean {
    if (!this.matrix) return false;
    if (!this.task) return false;
    if (this.endW - this.startW <= 0) return false;

    return true;
  }

  public setLists(
    s: number,
    e: number,
    t: CTPTask,
    a: AvailableMatrix,
    l: SchedulingLandscape,
  ): void {
    this.task = t;
    this.matrix = a;
    this.setHorizon(s, e);
    this.landscape = l;
  }

  protected init(): boolean {
    if (this.matrix && this.landscape && this.matrix.recalc) {
      let a = this.appSettings || undefined;
    }

    return true;
  }

  protected stateChangeStartTimes(): CTPIntervals {
    let st = 0;
    let et = 0;

    var results = new CTPIntervals();
    /*
    if (this.valid && this.matrix?.stateChangeAssignments) {
        this.matrix?.stateChangeAssignments.forEach(co => {
            let st = co.startW;
            let et = co.endW;
            if (st < this.startW)  st = this.startW;
            if (et > this.endW)  st = this.endW;
            if ((et-st > 0) && (this.task?.requiresChangeoverValue))
            {
                const key = co.getHash(co.leftValue, this.task.requiresChangeoverValue);
                const coTask = this.landscape?.stateChanges.getEntity(key);
                if (coTask && coTask.duration)
                {
                    et = st + coTask.duration?.duration();
                    theEngines.unionEngine.union(results, new CTPStartTime(st, et));
                }
               
            }
        });
        // if results set qty =1 
        
    }
        */
    return results;
  }

  public computeChangeoverTimes(
    s?: number,
    e?: number,
    t?: CTPTask,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPIntervals | null {
    if (s && e && a && t && l) this.setLists(s, e, t, a, l);

    let rc = this.assertLists();
    var startTimes: CTPIntervals | null = null;
    if (rc) {
      this.init();
      startTimes = this.stateChangeStartTimes();
    }

    return startTimes;
  }

  public computeStateChangeWindows(
    s?: number,
    e?: number,
    t?: CTPTask,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPIntervals | null {
    if (s && e && a && t && l) this.setLists(s, e, t, a, l);

    let rc = this.assertLists();
    var startTimes: CTPIntervals | null = null;
    if (rc) {
      this.init();
      startTimes = this.computeChangeoverTimes();
    }

    return startTimes;
  }

  protected applyStateChangeToInterval(
    st: number,
    et: number,
    i: CTPStartTime,
    schedule: ScheduleContext,
    landscape: SchedulingLandscape,
  ) {
    i.processChangeDuration = 0;
    i.states = [];
    // Loop through capcaity Resources
    // Determine if State Change is required
    if (schedule.slot.resources) {
      schedule.slot.resources.forEach((resSlot) => {
        if (
          resSlot.resource &&
          resSlot.resource.available.stateChanges &&
          landscape.stateChanges.hasStateChangeForType(resSlot.resource.type)
        ) {
          let fromChange = "";
          let toChange = (schedule.task && schedule.task.process ) ? schedule.task.process : CTPStateChangeConstants.DEFAULT_PROCESS;
        
          let duration = 0;
          resSlot.resource.available.stateChanges.forEach((sc) => {
            if (i.eStartW >= sc.st && i.lStartW <= sc.et) {
              fromChange = sc.fromState;
            }
          });

          if (fromChange) {
            if (fromChange != toChange) {
              // Find the State Chane Task
              const coTask = landscape.stateChanges.getOrDefaultProcessChange(
                resSlot.resource.type,
                fromChange,
                toChange,
              );
              if (coTask && coTask.duration) {
                if (i.processChangeDuration == 0)
                  i.processChangeDuration = coTask.duration;
                else if (i.processChangeDuration < coTask.duration)
                  i.processChangeDuration = coTask.duration;

                // Set the overall feasiblity of the slot if this startTime segment 
                // is now infeasible becuase change over is longer than segment
                schedule.slot.hasInfeasibleDueToChangeOver = !i.stillFeasible();

                i.states.push(new CTPStateChangeResource(resSlot.resource, 
                                                        CTPStateChangeConstants.PROCESS_CHANGE, 
                                                        fromChange, 
                                                        toChange,
                                                        coTask.duration));
              }
            }
          }
        }
      });
    }
  }
  public applyStateChangeToStartTimes(
    st: number,
    et: number,
    schedule: ScheduleContext,
    landscape: SchedulingLandscape,
  ): void {
    if (!landscape.stateChanges || landscape.stateChanges.size() == 0) return;
    schedule.slot.hasInfeasibleDueToChangeOver = false;
    this.listIndex = 0;
    if (schedule.slot && schedule.slot.hasStartTimes()) {
      schedule.slot.startTimes?.toArray().forEach((i) => {
        this.applyStateChangeToInterval(st, et, i, schedule, landscape);
      });
    }
  }

  public getScheduleStateChangeTasks(
    task: CTPTask,
    bestSchedule: BestScheduleContext,
    landscape: SchedulingLandscape) : CTPTask[]
    {
      let tasks : CTPTask[] = []
      if ( bestSchedule.startTimes.states && task.state === CTPTaskStateConstants.SCHEDULED ) {
        
        bestSchedule.startTimes.states.forEach((state) => {
          const coTask = TaskFactory.createStateTask(task, state.type, state.getName(), state.duration);
          if (state.resource) 
              coTask.capacityResources?.add(new CTPTaskResource(state.resource.key, true,0,state.resource.key));
            tasks.push(coTask);
        });
      }
      return tasks;
    };

    public getUnScheduleStateChangeTasks(
      task: CTPTask,
      landscape: SchedulingLandscape) : CTPTask[]
    {
        let tasks : CTPTask[] = [];
        let prevName = "";
        if ( task.state === CTPTaskStateConstants.SCHEDULED && landscape?.stateChanges && landscape?.stateChanges.size() > 0) {
         if (task.capacityResources) {
            task.capacityResources.forEach((resSlot) => {
              if (resSlot.scheduledResource) {
                let found = landscape?.resources.getEntity(resSlot.scheduledResource);
                if (found) 
                {
                   let i = found.assignments?.head;
                   while (i) {
                     if (i.data.name == task.key)  {
                       const coTask = landscape?.tasks.getEntity(prevName);
                       if (coTask && coTask?.process == task.process)
                          tasks.push(coTask);
                       break;
                     }
                     if (i.data.name && (i.data.subType == CTPAssignmentConstants.CHANGE_OVER ) ) 
                      prevName = i.data.name;
                     i = i.next;
                   }
                }
              }
            });
          }
        }
        return tasks;
      }
}
