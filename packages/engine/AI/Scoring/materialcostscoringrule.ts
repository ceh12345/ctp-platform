import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * MaterialCostScoringRule — MINIMIZE
 *
 * Computes the cost of raw materials consumed by this task,
 * including waste from scrap rates. Uses unitCost on each
 * CTPTaskMaterialInput (hydrated from product/material config).
 */
export class MaterialCostScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("MaterialCostScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const task = schedule.task;
    let totalCost = 0;

    if (task.inputMaterials) {
      task.inputMaterials.forEach(input => {
        if (input.unitCost > 0) {
          const grossQty = input.grossQty();
          totalCost += grossQty * input.unitCost;
        }
      });
    }

    score.score = totalCost;
    score.cost = totalCost;
    return score;
  }
}
