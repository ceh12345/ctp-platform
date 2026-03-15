import { StateChangeScoringRule } from "../AI/Scoring/changeoverscoring";
import { DueDateScoringRule } from "../AI/Scoring/duedatescoringrule";
import { ResourcePreferenceScoringRule } from "../AI/Scoring/resourcepreferencescoringrule";
import { ResourceUtilizationScoringRule } from "../AI/Scoring/resourceutilizationscoringrule";
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
    const key = name.toLowerCase().trim();
    if (key === "earlieststarttimescoringrule")
      return new EarliestStartTimeScoringRule(w, o, penalty);
    if (key === "lateststarttimescoringrule" || key === "lateststarttimescoringrrule")
      return new LatestStartTimeScoringRule(w, o, penalty);
    if (key === "whitespacescoringrule")
      return new WhiteSpaceScoringRule(w, o, penalty);
    if (key === "changeoverscoringrule" || key === "statechangescoringrule")
      return new StateChangeScoringRule(w, o, penalty);
    if (key === "duedatescoringrule")
      return new DueDateScoringRule(w, o, penalty);
    if (key === "resourceutilizationscoringrule")
      return new ResourceUtilizationScoringRule(w, o, penalty);
    if (key === "resourcepreferencescoringrule")
      return new ResourcePreferenceScoringRule(w, o, penalty);

    throw new Error(name + " Scoring Rule not found");
  }
}
