import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

export class WhiteSpaceScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("WhiteSpaceScoringRule", w, o, p);
  }

  protected computeStdDeviation(schedule: ScheduleContext) : number
  {
    let StdDeviation = Number.MAX_SAFE_INTEGER;
    if (schedule.slot.startTimes ) {
      let mean = 0.0;
      let count = schedule.slot.startTimes.size();
      if (count <= 0) return StdDeviation;
      let ws = schedule.slot.startTimes.whiteSpace();
      //schedule.debug();
      mean = ws / count;
      let sum = 0.0;
      let dur = 0;
      let i = schedule.slot.startTimes.head;
      while (i) {
        dur = i.data.lStartW - i.data.eStartW;
        sum += ( (dur - mean) * (dur - mean));
        i = i.next;
      }
      StdDeviation = Math.sqrt(sum / count);
    }
    // Compute the standard deviation of the white space
    // This is a placeholder for the actual implementation
    return StdDeviation;
  }

  public compute(schedule: ScheduleContext): IScore {
    var score = new CTPScore(this.name);
    score.score = Number.MAX_SAFE_INTEGER;
    if (schedule.slot.startTimes) {
      score.score = this.computeStdDeviation(schedule); 
      // schedule.slot.startTimes.whiteSpace();
    }
   
    //console.log("WhiteSpace Score: " + score.score);
    return score;
  }
}
