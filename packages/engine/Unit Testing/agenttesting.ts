import { CTPInterval, CTPDuration, CTPRunRate } from "../Models/Core/window";
import * as CTPLists from "../Models/Core/linklist";
import { CTPIntervals, CPTStartTimes } from "../Models/Intervals/intervals";
import { CTPDateTime } from "../Models/Core/date";
import { DateTime, Interval, Settings } from "luxon";

import { theEngines, theSetEngines } from "../Engines/engines";
import * as constants from "../Models/Core/constants";
import { CTPDurationConstants } from "../Models/Core/constants";

import { readFileSync } from "fs";
import { AvailableMatrix } from "../Models/Intervals/availablematrix";
import { CTPResource, CTPResources } from "../Models/Entities/resource";
import { CommonStartTimesAgent } from "../AI/Agents/commonstarttimes";
import { CTPHorizon } from "../Models/Entities/horizon";
import { CTPResourceSlot, CTPResourceSlots } from "../Models/Entities/slot";
import { CombinationEngine } from "../Engines/combinationengine";
import { SchedulingLandscape } from "../Models/Entities/landscape";
import { CTPTask } from "../Models/Entities/task";

export function buildAvailable(days: number): CTPIntervals {
  var a: CTPIntervals = new CTPIntervals();

  let d = CTPDateTime.dateNow();
  let day = 0;
  let qty = 1.0;
  let st = 8 * CTPDateTime.ONE_HOUR;
  let et = 17 * CTPDateTime.ONE_HOUR;
  let rr = 0;
  let offset = 0;

  for (let i = 0; i < days; i++) {
    qty = 3;
    rr = Math.random();
    day = CTPDateTime.fromDateTime(d);
    day = day - offset;

    st = 8 * CTPDateTime.ONE_HOUR;
    et = 12 * CTPDateTime.ONE_HOUR;
    a.add(new CTPRunRate(day + st, day + et, qty, rr));
    st = 13 * CTPDateTime.ONE_HOUR;
    et = 17 * CTPDateTime.ONE_HOUR;
    a.add(new CTPRunRate(day + st, day + et, qty, rr));
    d = d.plus({ days: 1 });
  }

  return a;
}

export function buildTestIntervals(days: number): CTPIntervals {
  var a: CTPIntervals = new CTPIntervals();

  let st = 0;
  let et = 0;

  st = 0;
  for (let i = 0; i < days; i++) {
    st = st + Math.floor(Math.random() * 10);
    et = st + Math.floor(Math.random() * 10);
    a.add(new CTPRunRate(st, et, 3));
    st = et;
  }

  return a;
}

export function buildAssignments(days: number): CTPIntervals {
  var a: CTPIntervals = new CTPIntervals();

  let d = CTPDateTime.dateNow();

  let day = 0;
  let qty = 1.0;

  let offset = 0;

  for (let i = 0; i < days; i++) {
    day = Math.floor(Math.random() * 10);
    qty = Math.floor(Math.random() * 3);
    if (!qty) qty = Math.floor(Math.random() * 3);
    if (!qty) qty = 1;
    let d1 = d.plus({ days: day });
    let st = Math.floor(Math.random() * 17) * CTPDateTime.ONE_HOUR;
    let et = st + CTPDateTime.ONE_MINUTE * 30;
    day = CTPDateTime.fromDateTime(d1);
    day = day - offset;

    a.add(new CTPInterval(day + st, day + et, qty));
  }

  return a;
}
export function testIntersectEngine(): number {
  var a: CTPIntervals = new CTPIntervals(); //Constants.CONSUMABLE);
  var b: CTPIntervals = new CTPIntervals(); //Constants.CONSUMABLE);

  console.log("Intersect Engine ");

  a = buildTestIntervals(10);
  b = buildTestIntervals(5);
  /*
  b.add(new CTPInterval(5, 100, 10));
  b.add(new CTPInterval(150, 199, 20));

  a.add(new CTPInterval(150, 180, 1));
  a.add(new CTPInterval(50, 70, 2));
  a.add(new CTPInterval(200, 201, 1));
  a.add(new CTPInterval(0, 5, 5));
 */

  a.debug(false);

  b.debug(false);

  let c = theSetEngines.intersectEngine.execute(a, b);
  c?.debug(false);

  console.log("Intersect Done ");
  console.log("");
  return 0;
}

export function testAgents(): number {
  var horizon = new CTPHorizon(
    CTPDateTime.now().set({ hour: 0, minute: 0, second: 0, millisecond: 0 }),
    CTPDateTime.now()
      .plus({ days: 11 })
      .set({ hour: 0, minute: 0, second: 0, millisecond: 0 }),
  );

  var orig = buildAvailable(5);
  //slots.debug(true);

  var assing = buildAssignments(10);
  //assing.debug(true);

  const res1 = new CTPResource(
    constants.CTPResourceConstants.REUSABLE,
    "Resource",
    "Resource One",
    "1",
  );
  const res2 = new CTPResource(
    constants.CTPResourceConstants.REUSABLE,
    "Resource",
    "Resource Two",
    "2",
  );
  const res3 = new CTPResource(
    constants.CTPResourceConstants.REUSABLE,
    "Resource",
    "Resource Three",
    "3",
  );

  res1.original = buildAvailable(5);
  res2.original = buildAvailable(3);
  res3.original = buildAvailable(1);

  let d = new CTPDuration(3600, 1, CTPDurationConstants.FIXED_DURATION);

  let agent = new CommonStartTimesAgent();
  var resourceSlots = new CTPResourceSlots();
  let l = new SchedulingLandscape();

  resourceSlots.resources?.add(new CTPResourceSlot(res1, 0));
  resourceSlots.resources?.add(new CTPResourceSlot(res2, 1));
  resourceSlots.resources?.add(new CTPResourceSlot(res3, 2));

  const task = new CTPTask();

  agent.solve(horizon.startW, horizon.endW, d, resourceSlots, l);

  const feasible = resourceSlots.startTimes;

  horizon.debug();

  feasible?.debug(task.name);

  console.log("Done ");
  return 0;
}
