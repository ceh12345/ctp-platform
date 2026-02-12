import { CTPInterval } from "../Models/Core/window";
import * as CTPLists from "../Models/Core/linklist";
import { CTPIntervals, CPTStartTimes } from "../Models/Intervals/intervals";
import { CTPDateTime } from "../Models/Core/date";
import { theSetEngines } from "../Engines/engines";

import * as Constants from "../Models/Core/constants";
import { readFileSync } from "fs";

export function testSetEngines(): number {
  var a: CTPIntervals = new CTPIntervals(); //Constants.CONSUMABLE);
  var b: CTPIntervals = new CTPIntervals(); //Constants.CONSUMABLE);

  const file = readFileSync("./app/Unit Testing/test_data.json", "utf8");
  const config = JSON.parse(file);

  a.add(new CTPInterval(5, 100, 10));
  a.add(new CTPInterval(150, 199, 10));

  b.add(new CTPInterval(150, 180, 10));
  b.add(new CTPInterval(50, 70, 20));
  b.add(new CTPInterval(200, 201, 1));
  b.add(new CTPInterval(0, 5, 5));

  //b.debug(false);

  let r = theSetEngines.subtractEngine.execute(a, b);

  if (r) r.debug(false);

  console.log("Done ");
  return 0;
}
