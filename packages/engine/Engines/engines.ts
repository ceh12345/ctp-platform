"strict";
import {
  CTPAddSetEngine,
  CTPUnionSetEngine,
  CTPSubtractSetEngine,
  CTPIntersectSetEngine,
  CTPComplimentSetEngine,
} from "./setengine";
import { CTPAvailableEngine } from "./availableengine";
import { CTPStartTimeEngine } from "./starttimeengine";
import { CPTStartTimes } from "../Models/Intervals/intervals";
import { CombinationEngine } from "./combinationengine";

export class theSetEngines {
  public static addEngine: CTPAddSetEngine = new CTPAddSetEngine();
  public static unionEngine: CTPUnionSetEngine = new CTPUnionSetEngine();
  public static subtractEngine: CTPSubtractSetEngine =
    new CTPSubtractSetEngine();
  public static intersectEngine: CTPIntersectSetEngine =
    new CTPIntersectSetEngine();
  public static complimentEngine: CTPComplimentSetEngine =
    new CTPComplimentSetEngine();
}

export class theEngines extends theSetEngines {
  public static availableEngine: CTPAvailableEngine = new CTPAvailableEngine();
  public static startTimeEngine: CTPStartTimeEngine = new CTPStartTimeEngine();
  public static combinationEngine: CombinationEngine = new CombinationEngine();
}
