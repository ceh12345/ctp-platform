import { ScoringEngine } from "../../Engines/scoringengine";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScoring } from "../../Models/Entities/score";
import { AIAgent, IAIAgent } from "./agent";

interface IComputeScoreAgent extends IAIAgent {
  solve(
    landscape: SchedulingLandscape,
    schedules: ScheduleContext[],
    scoring: CTPScoring,
  ): void;
}

export class ComputeScoreAgent extends AIAgent implements IComputeScoreAgent {
  constructor() {
    super("ComputeScoreAgent");
  }

  public solve(
    landscape: SchedulingLandscape,
    schedules: ScheduleContext[],
    scoring: CTPScoring,
  ): void {
    let engine = new ScoringEngine();
    engine.computeScores(landscape, schedules, scoring);
  }
}
