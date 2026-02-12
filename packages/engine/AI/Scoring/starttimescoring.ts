import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

export class EarliestStartTimeScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("EarliestStartTimeScoringRule", w, o, p);
  }
  public compute(schedule: ScheduleContext): IScore {
    var score: IScore = new CTPScore(this.name);
    score.score = Number.MAX_SAFE_INTEGER;

    if (schedule.slot.startTimes) {
      if (schedule.slot.startTimes.head)
        score.score = schedule.slot.startTimes.head.data.eStartW;
    }
    return score;
  }
}

export class LatestStartTimeScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("LatestStartTimeScoringRule", w, o, p);
  }
  public compute(schedule: ScheduleContext): IScore {
    var score: IScore = new CTPScore(this.name);
    score.score = Number.MAX_SAFE_INTEGER;
    if (schedule.slot.startTimes) {
      if (schedule.slot.startTimes.tail)
        score.score = schedule.slot.startTimes.tail.data.lStartW;
    }
    return score;
  }
}
