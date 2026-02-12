import { ILandscape } from "../../Models/Entities/landscape";
import { CTPResourceSlot } from "../../Models/Entities/slot";
import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { IScore, CTPScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

export class StateChangeScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("StateChangeScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    var score = new CTPScore(this.name);
    score.score = Number.MAX_SAFE_INTEGER;
    if (schedule.slot && schedule.slot.startTimes) {
      score.score = schedule.slot.startTimes.changeOver();
    }
    return score;
  }
}
