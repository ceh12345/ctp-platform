import { ScheduleContext } from "../Models/Entities/schedulecontext";
import { ScoringFactory } from "../Factories/scorefactory";
import { IScoringRule } from "../AI/Scoring/scoringrule";
import { CTPScoring } from "../Models/Entities/score";
import { SchedulingLandscape } from "../Models/Entities/landscape";
import { CTPScoreObjectiveConstants } from "../Models/Core/constants";

export interface IScoringEngine {
  computeScores(
    landscape: SchedulingLandscape,
    schedules: ScheduleContext[],
    rules: CTPScoring,
  ): void;
}
interface minmax {
  name: string;
  min: number;
  max: number;
  scoring: IScoringRule;
}
export class ScoringEngine implements IScoringEngine {
  public computeScores(
    landscape: SchedulingLandscape,
    schedules: ScheduleContext[],
    scoring: CTPScoring,
  ): void {
    // Loop throuh each rule
    let rulesToScore: minmax[] = [];

    let cum = 0.0;
    // create temp array by rule name with min and max values
    scoring.rules.forEach((rule) => {
      if (rule.includeInSolve) {
        try {
          let i = ScoringFactory.createScoringRule(
            rule.ruleName,
            rule.weight,
            rule.objective,
            rule.penaltyFactor,
          );
          rulesToScore.push({
            name: rule.ruleName,
            min: Number.MAX_SAFE_INTEGER,
            max: Number.MIN_SAFE_INTEGER,
            scoring: i,
          });
          cum += i.weight;
        } catch {}
      }
    });

    // verify 100 %
    if (cum <= 0.99 || cum > 1.0) throw "Scoring Rules must sum to 100 %";

    // Now add in a set of scoreing rules
    schedules.forEach((schedule) => {
      schedule.scores.clear();
      if (schedule.slot?.hasStartTimes()) {
        // Add in a rule to score. Add score
        rulesToScore.forEach((rule) => {
          try {
            let score = rule.scoring.compute(schedule);
            schedule.scores.add(score);
            if (score.score < rule.min) rule.min = score.score;
            if (score.score > rule.max) rule.max = score.score;
          } catch {}
        });
      }
    });

    // Now Blend Score
    schedules.forEach((schedule) => {
      let n = 0.0;
      let s = 0.0;

      schedule.blendedScore.score = Number.MAX_VALUE;
      if (schedule.slot?.hasStartTimes()) {
        rulesToScore.forEach((rule) => {
          let i = schedule.scores.findByName(rule.name);
          // Find score in schedule
          s = 1.0;
          if (i && rule.max - rule.min !== 0.0)
            s = (i.score - rule.min) / (rule.max - rule.min);

          s = s * rule.scoring.weight;

          if (rule.scoring.objective == CTPScoreObjectiveConstants.MAXIMIZE)
            s *= -1.0;
          if (rule.scoring.penaltyFactor) s += s * rule.scoring.penaltyFactor;
          n += s;
        });
        schedule.blendedScore.score = n;
      }
    });
  }
}
