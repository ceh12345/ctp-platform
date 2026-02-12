import { ScoringEngine } from "../../Engines/scoringengine";
import { CTPInterval } from "../../Models/Core/window";
import {
  ScheduleContext,
  TaskScheduleContexts,
} from "../../Models/Entities/schedulecontext";
import { CTPScoring } from "../../Models/Entities/score";
import { AIAgent, IAIAgent } from "./agent";

interface IBestScoreForTaskAgent extends IAIAgent {
  solve(schedules: TaskScheduleContexts[]): void;
}

export class BestScoreForTaskAgent
  extends AIAgent
  implements IBestScoreForTaskAgent
{
  constructor() {
    super("BestScoreForTaskAgent");
  }

  public solve(schedules: TaskScheduleContexts[]): void {
    if (!schedules) return;

    // for each task that has schedules set earliest start , latest start and top score
    schedules.forEach((schedule) => {
      schedule.value.resetScore();
      let st: number | undefined = undefined;
      let et: number | undefined = undefined;
      if (schedule.contexts) {
        schedule.contexts.forEach((context) => {
          if (!schedule.value.hasScore()) {
            schedule.value.score = context.blendedScore.score;
            if (context.slot.hasStartTimes()) {
              st = context?.slot.startTimes?.head?.data.eStartW;
              et = context?.slot.startTimes?.tail?.data.lStartW;
            }
          } else {
            if (schedule.value.score > context.blendedScore.score) {
              schedule.value.score = context.blendedScore.score;
            }
            if (context.slot.hasStartTimes()) {
              if (
                context?.slot.startTimes?.head?.data.eStartW &&
                st &&
                context?.slot.startTimes?.head?.data.eStartW < st
              )
                st = context?.slot.startTimes?.head?.data.eStartW;
              if (
                context?.slot.startTimes?.tail?.data.lStartW &&
                et &&
                context?.slot.startTimes?.tail?.data.lStartW < et
              )
                et = context?.slot.startTimes?.tail?.data.lStartW;
            }
          }
        });
      }
      if (st !== undefined && et !== undefined) {
        schedule.value.feasible = new CTPInterval(st, et);
      }
    });
  }
}
