import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * ResourcePreferenceScoringRule — MINIMIZE
 *
 * Rewards assigning tasks to preferred resources.
 * For each capacity resource requirement:
 *   - rank 1 (most preferred) = 0 penalty
 *   - rank N = (N - 1) penalty
 *   - not in list = maxRank + 1
 *   - excluded (include=false) = maxRank * 2
 *
 * Score = sum of penalties. Lower = better.
 * Tasks without preferences get score 0 (neutral).
 */
export class ResourcePreferenceScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("ResourcePreferenceScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const task = schedule.task;
    const slotResources = schedule.slot.resources;

    if (!task.capacityResources || !slotResources || slotResources.length === 0) {
      score.score = 0;
      return score;
    }

    let totalPenalty = 0;

    task.capacityResources.forEach((taskRes, index) => {
      if (!taskRes.preferences || taskRes.preferences.length === 0) return;

      // Match slot resource by index position
      const slotRes = slotResources[index];
      if (!slotRes || !slotRes.resource) return;

      const assignedKey = slotRes.resource.key;

      let maxRank = 1;
      for (const pref of taskRes.preferences) {
        if (pref.rank > maxRank) maxRank = pref.rank;
      }

      let found = false;
      for (const pref of taskRes.preferences) {
        if (pref.resourceKey === assignedKey) {
          found = true;
          if (!pref.include) {
            totalPenalty += maxRank * 2;
          } else {
            totalPenalty += (pref.rank - 1);
          }
          break;
        }
      }

      if (!found) {
        totalPenalty += maxRank + 1;
      }
    });

    score.score = totalPenalty;
    return score;
  }
}
