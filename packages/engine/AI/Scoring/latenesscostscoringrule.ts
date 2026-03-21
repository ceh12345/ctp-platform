import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * LatenessCostScoringRule — MINIMIZE
 *
 * Computes the dollar penalty for delivering past the due date.
 * Only affects chain-terminal tasks with dueDate and latenessPenaltyPerDay > 0.
 * Cost = ceil(daysLate) × latenessPenaltyPerDay.
 */
export class LatenessCostScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("LatenessCostScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const task = schedule.task;

    if (!task.dueDate || task.dueDate === 0 || !task.latenessPenaltyPerDay || task.latenessPenaltyPerDay === 0) {
      score.score = 0;
      score.cost = 0;
      return score;
    }

    if (!schedule.slot.startTimes || !schedule.slot.startTimes.head) {
      score.score = 0;
      score.cost = 0;
      return score;
    }

    const earliestStart = schedule.slot.startTimes.head.data.eStartW;
    const duration = task.duration?.duration() ?? 0;
    const completionTime = earliestStart + duration;

    if (completionTime > task.dueDate) {
      const daysLate = Math.ceil((completionTime - task.dueDate) / 86400);
      const lateCost = daysLate * task.latenessPenaltyPerDay;
      score.score = lateCost;
      score.cost = lateCost;
    } else {
      score.score = 0;
      score.cost = 0;
    }

    return score;
  }
}
