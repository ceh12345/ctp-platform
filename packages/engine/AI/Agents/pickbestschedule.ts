import "./agent";
import { AIAgent, IAIAgent } from "./agent";
import {
  BestScheduleContext,
  ScheduleContext,
  TaskScheduleContexts,
} from "../../Models/Entities/schedulecontext";
import { CTPScoring } from "../../Models/Entities/score";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPInterval } from "../../Models/Core/window";
import { ListNode } from "../../Models/Core/linklist";
import { CTPStartTime } from "../../Models/Entities/starttime";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPScheduleDirectionConstants } from "../../Models/Core/constants";
import { CTPTask } from "../../Models/Entities/task";

export interface IPickBestScheduleAgent extends IAIAgent {
  solve(
    landscape: SchedulingLandscape,
    task: CTPTask ,
    schedules: TaskScheduleContexts | null | undefined,
    scoring: CTPScoring | null | undefined,
    settings: CTPAppSettings | null| undefined
  ): BestScheduleContext | null;
}
///
//   Agent to find the common start times between a set  of resources
//
///
export class PickBestScheduleAgent
  extends AIAgent
  implements IPickBestScheduleAgent
{
  private NO_RESOURCES_TO_PROCESS = "No Common Resources to process ";
  private NO_RESOURCE_AVAILABILTY = "Could Not Find Availablity for ";
  private INVALID_WINDOW = "Duration is greater than window";
  private NO_SCHEDULES = "Could not find any feasible schedules";

  constructor() {
    super("PickBestScheduleAgent");
  }

  solve(
    landscape: SchedulingLandscape,
    task: CTPTask ,
    schedules: TaskScheduleContexts | null | undefined,
    scoring: CTPScoring | null | undefined,
    settings: CTPAppSettings | null| undefined
  ): BestScheduleContext | null {
    let best: BestScheduleContext | null = null;

    if (!schedules || !schedules.contexts || !scoring) {
      task.addError(this.name, this.NO_SCHEDULES);
      return best;
    }
    let st: number | undefined = undefined;
    let nodePtr: ListNode<CTPStartTime> | null | undefined = null;
    let bestStart : number | undefined = undefined;
    let direction = settings?.scheduleDirection ?? CTPScheduleDirectionConstants.FORWARD;

    for (let i = 0; i < schedules.contexts.length; i++) {
      const schedule = schedules.contexts.at(i);
      if (schedule?.slot.hasStartTimes()) {
        if (direction == CTPScheduleDirectionConstants.FORWARD )
          nodePtr = schedule?.slot.startTimes?.head;
        else nodePtr = schedule?.slot.startTimes?.tail;
        if (nodePtr && schedule.blendedScore.score == schedules.value.score) {
          if (scoring.scheduleEarliest()) 
            bestStart = nodePtr.data.eStartW;
          else bestStart = nodePtr.data.lStartW

          best = new BestScheduleContext(schedule, nodePtr.data, bestStart);
          break;
        }
      }
    }

    if (!best) task.addError(this.name, this.NO_SCHEDULES);
     
    return best;
  }
}
