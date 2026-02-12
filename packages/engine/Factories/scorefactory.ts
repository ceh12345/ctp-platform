import { StateChangeScoringRule } from "../AI/Scoring/changeoverscoring";
import { IScoringRule } from "../AI/Scoring/scoringrule";
import {
  EarliestStartTimeScoringRule,
  LatestStartTimeScoringRule,
} from "../AI/Scoring/starttimescoring";
import { WhiteSpaceScoringRule } from "../AI/Scoring/whitespacescoring";

export class ScoringFactory {
  public static createScoringRule(
    name: string,
    w: number,
    o?: number,
    penalty?: number,
  ): IScoringRule {
    if (name.toLowerCase().trim() === "earlieststarttimescoringrule")
      return new EarliestStartTimeScoringRule(w, o, penalty);
    if (name.toLowerCase().trim() === "lateststarttimescoringrrule")
      return new LatestStartTimeScoringRule(w, o, penalty);
    if (name.toLowerCase().trim() === "whitespacescoringrule")
      return new WhiteSpaceScoringRule(w, o, penalty);
    if ((name = "changeoverscoringrule"))
      return new StateChangeScoringRule(w, o, penalty);

    throw new Error(name + " Scoring Rule not found");
  }
}
