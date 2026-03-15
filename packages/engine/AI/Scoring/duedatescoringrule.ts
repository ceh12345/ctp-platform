import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * DueDateScoringRule — MINIMIZE
 *
 * Measures how close a task's completion time is to (or past) its due date.
 * Only affects chain-terminal tasks (dueDate > 0).
 * Intermediate tasks (dueDate === 0) get neutral score 0.
 *
 * Score:
 *   slack = dueDate - completionTime
 *   On time (slack >= 0):  score = -slack  (more buffer = more negative = better)
 *   Late (slack < 0):      score = |slack| * (1 + penaltyFactor)
 */
export class DueDateScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("DueDateScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const task = schedule.task;

    if (!task.dueDate || task.dueDate === 0) {
      score.score = 0;
      return score;
    }

    if (!schedule.slot.startTimes || !schedule.slot.startTimes.head) {
      score.score = 0;
      return score;
    }

    const earliestStart = schedule.slot.startTimes.head.data.eStartW;
    const duration = task.duration?.duration() ?? 0;
    const completionTime = earliestStart + duration;
    const slack = task.dueDate - completionTime;

    if (slack >= 0) {
      score.score = -slack;
    } else {
      score.score = Math.abs(slack) * (1 + this.penaltyFactor);
    }

    return score;
  }
}
