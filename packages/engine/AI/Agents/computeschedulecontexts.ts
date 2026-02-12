import { Duration } from "luxon";
import {
  ILandscape,
  SchedulingLandscape,
} from "../../Models/Entities/landscape";
import {
  ScheduleContext,
  ScheduleContexts,
} from "../../Models/Entities/schedulecontext";
import { CTPScoring } from "../../Models/Entities/score";
import { AIAgent, IAIAgent } from "./agent";
import { CommonStartTimesAgent } from "./commonstarttimes";
import { ComputeScoreAgent } from "./computescores";
import { StateChangeAgent } from "./statechangeagent";

interface IComputeScheduleContextsAgent extends IAIAgent {
  solve(
    landscape: SchedulingLandscape,
    scheduleContexts: ScheduleContext[],
    scoring: CTPScoring,
  ): void;
}

export class ComputeScheduleContextsAgent extends AIAgent {
  constructor() {
    super("ComputeScheduleContextsAgent");
  }

  // Remove StartTimes where Changeover invalidates the Start Time Window
  protected removeInvalidStartTimes(schedule : ScheduleContext) {
    if (schedule.slot && schedule.slot.startTimes && (schedule.slot.hasInfeasibleDueToChangeOver || !schedule.task?.requiresSetup) ) {
      let i = schedule.slot.startTimes.head;
      while (i) {
        if (i.data.stillFeasible() || !schedule.task?.requiresSetup) {
          if (!schedule.task?.requiresSetup) i.data.processChangeDuration = 0;
           i = i.next;
        } else {
          let st = i;
          i = i.next;
          schedule.slot.startTimes.deleteNode(st);
         
        }
      }
    }
  }



  public solve(
    landscape: SchedulingLandscape,
    scheduleContexts: ScheduleContext[],
    scoring: CTPScoring | null,
  ) {
    if (!landscape || !landscape.horizon || !scoring) return;

    let agent = new CommonStartTimesAgent();
    let scAgent = new StateChangeAgent();

    let st = landscape!.horizon.startW;
    let et = landscape!.horizon.endW;

    let computescores: ScheduleContext[] = [];

    scheduleContexts.forEach((schedule) => {
      if (
        schedule.recompute &&
        schedule.task &&
        schedule.task.duration &&
        !schedule.task.processed
      ) {
        agent.solve(st, et, schedule.task.duration, schedule.slot, landscape);

        // Apply state change results results
        scAgent.solve(st, et, schedule, landscape);

        // Remove invalid
        this.removeInvalidStartTimes(schedule);

        if (schedule.slot && schedule.slot.hasStartTimes()) 
          computescores.push(schedule);

        const durationStr = Duration.fromObject({
          second: schedule.task.duration.duration(),
        }).toFormat("T hh:mm:ss");
        let header =
          schedule.task.name +
          " D : " +
          durationStr +
          " R: " +
          (schedule?.slot?.resources?.at(0)?.resource?.name ?? "");

        if (schedule.slot.startTimes) {
          console.log("FEASIBLE for Task " + header);
          schedule.slot.startTimes?.debug(schedule?.slot?.resources?.at(0)?.resource?.name ?? "Missing Resource");
        } else console.log("NOT FEASIBLE for Task " + " " + header);
      }
      schedule.recompute = false;
    });

    // Recompute scores
    let agentScores = new ComputeScoreAgent();
    agentScores.solve(landscape, computescores, scoring);
  }
}
