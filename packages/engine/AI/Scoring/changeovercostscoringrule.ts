import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * ChangeoverCostScoringRule — MINIMIZE
 *
 * Computes the dollar cost of changeovers/setups required when switching
 * products on a resource. Uses the cost field on CTPStateChangeResource.
 * Separate from ChangeoverScoringRule which only considers changeover time.
 */
export class ChangeoverCostScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("ChangeoverCostScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    let totalCost = 0;

    if (schedule.slot && schedule.slot.startTimes) {
      let node = schedule.slot.startTimes.head;
      while (node) {
        if (node.data.states) {
          for (const state of node.data.states) {
            totalCost += state.cost ?? 0;
          }
        }
        node = node.next;
      }
    }

    score.score = totalCost;
    score.cost = totalCost;
    return score;
  }
}
