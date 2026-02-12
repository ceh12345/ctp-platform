import { StateChangeEngine } from "../../Engines/statechangeerengine";
import { ScoringEngine } from "../../Engines/scoringengine";
import { CTPResourceConstants } from "../../Models/Core/constants";
import { CTPInterval } from "../../Models/Core/window";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import {
  ScheduleContext,
  TaskScheduleContexts,
} from "../../Models/Entities/schedulecontext";
import { CTPScoring } from "../../Models/Entities/score";
import { CTPTask } from "../../Models/Entities/task";
import { AIAgent, IAIAgent } from "./agent";

interface IStateChangeAgent extends IAIAgent {
  solve(
    st: number,
    et: number,
    schedule: ScheduleContext,
    landscape: SchedulingLandscape,
  ): void;
}

export class StateChangeAgent extends AIAgent implements IStateChangeAgent {
  public solve(
    st: number,
    et: number,
    schedule: ScheduleContext,
    landscape: SchedulingLandscape,
  ): void {
    if (
      schedule.slot &&
      schedule.slot.hasStartTimes() &&
      landscape.stateChanges &&
      landscape.stateChanges.size() > 0
    ) {
      let engine = new StateChangeEngine();
      engine.applyStateChangeToStartTimes(st, et, schedule, landscape);
    }
  }
}
