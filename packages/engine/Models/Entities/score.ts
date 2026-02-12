import { CTPScoreObjectiveConstants } from "../Core/constants";
import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";
import { List } from "../Core/list";

export interface IScore {
  score: number;
  cost: number;
  penaltyFactor: number;
  name: string;
}

export class CTPScore implements IScore {
  public score: number = 0.0;
  public cost: number = 0.0;
  public penaltyFactor: number = 1.0;
  public name: string;
  public tiebeaker: number = 0.0;

  constructor(name: string, s?: number, c?: number, p?: number) {
    this.score = s ?? 0.0;
    this.cost = c ?? 0.0;
    this.penaltyFactor = p ?? 0.0;
    this.name = name;
  }
}

export class CTPScores extends List<IScore> {
  public findByName(name: string): IScore {
    let i = null as unknown as IScore;
    this.forEach((score) => {
      if (score.name.toLowerCase() === name.toLowerCase()) {
        i = score;
      }
    });
    return i;
  }
}

export interface IScoringConfigurationDTO {
  ruleName: string;
  weight: number;
  objective: number;
  includeInSolve: boolean;
  penaltyFactor: number;
}

export class CTPScoringConfiguration implements IScoringConfigurationDTO {
  public ruleName: string;
  public weight: number;
  public objective: number;
  public includeInSolve: boolean;
  public penaltyFactor: number;

  constructor(n: string, w: number, o?: number) {
    this.ruleName = n;
    this.weight = w;
    this.objective = o === undefined ? CTPScoreObjectiveConstants.MINIMIZE : o;
    this.includeInSolve = true;
    this.penaltyFactor = 0.0;
  }
}

export interface IScoringDTO extends IKeyEntity {
  rules: List<CTPScoringConfiguration>;
}

export interface IScoring extends IScoringDTO {}
export class CTPScoring extends CTPKeyEntity implements IScoring {
  public rules: List<CTPScoringConfiguration>;

  constructor(name: string, key: string) {
    super("Scoring", name, key);
    this.rules = new List<CTPScoringConfiguration>();
  }

  addConfig(c: CTPScoringConfiguration) {
    this.rules.add(c);
  }

  public scheduleEarliest(): boolean {
    let earliest = true;
    this.rules.forEach((r) => {
      if ((r.ruleName === "LatestStartTimeScoringRule") && (r.weight > 0)) 
        earliest = false;
    });
    return earliest;
  }

}

export class CTPScorings extends EntityHashMap<CTPScoring> {
  public constructor() {
    super();
  }
  public override fromArray(arr: CTPScoring[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }
}
