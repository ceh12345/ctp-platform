import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * ResourceCostScoringRule — MINIMIZE
 *
 * Computes the dollar cost of running this task on the assigned resources
 * for its duration. Uses resource.hourlyRate × (durationSeconds / 3600).
 * Sums across all assigned resources (multi-resource tasks).
 *
 * Raw cost is stored in IScore.cost for reporting.
 * The normalized score is used for blending.
 */
export class ResourceCostScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("ResourceCostScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const resources = schedule.slot.resources;

    if (!resources || resources.length === 0) {
      score.score = 0;
      score.cost = 0;
      return score;
    }

    let totalCost = 0;
    const durationSec = schedule.task.duration
      ? schedule.task.duration.duration()
      : 0;
    const durationHrs = durationSec / 3600;

    resources.forEach((resSlot) => {
      const resource = resSlot.resource;
      if (!resource) return;
      const rate = resource.hourlyRate ?? 0;
      totalCost += rate * durationHrs;
    });

    score.score = totalCost;
    score.cost = totalCost;
    return score;
  }
}
