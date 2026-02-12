import { CTPScoreObjectiveConstants } from "../../Models/Core/constants";
import { CTPEntity } from "../../Models/Core/entity";
import { List } from "../../Models/Core/list";
import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";

export interface IScoringRule {
  name: string;
  weight: number;
  objective: number;
  penaltyFactor: number;
  compute(schedule: ScheduleContext): IScore;
}

export class CTPScoringRule extends CTPEntity implements IScoringRule {
  name: string;
  score: IScore;
  weight: number;
  objective: number;
  penaltyFactor: number;

  constructor(n: string, w: number, o?: number, p?: number) {
    super("Score", n, "");
    this.name = n;
    this.score = new CTPScore(n);
    this.weight = w;
    this.objective = o !== undefined ? o : CTPScoreObjectiveConstants.MINIMIZE;
    this.penaltyFactor = p ?? 0.0;
  }

  public compute(schedule: ScheduleContext): IScore {
    return null as unknown as IScore;
  }
}

export class CTPScoringRules extends List<CTPScoringRule> {
  public name: string;

  constructor(n: string) {
    super();
    this.name = n;
  }
}
