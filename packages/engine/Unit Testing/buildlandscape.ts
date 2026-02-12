import { DateTime } from "luxon";
import { theEngines, theSetEngines } from "../Engines/engines";
import * as Constants from "../Models/Core/constants";
import {
  CTPAssignmentConstants,
  CTPDurationConstants,
  CTPResourceConstants,
  CTPScoreObjectiveConstants,
} from "../Models/Core/constants";
import * as fs from "fs";
import { CTPDuration, CTPInterval, CTPRunRate } from "../Models/Core/window";
import {
  CTPBaseResource,
  CTPResource,
  CTPResourcePreference,
  CTPResources,
} from "../Models/Entities/resource";
import { CTPHorizon } from "../Models/Entities/horizon";
import {
  CTPTask,
  CTPTaskResource,
  CTPTaskResourceList,
} from "../Models/Entities/task";
import { CTPDateTime } from "../Models/Core/date";
import { CTPAvailable, CTPIntervals } from "../Models/Intervals/intervals";
import { NameValue } from "../Models/Core/namevalue";
import {
  CTPScoring,
  CTPScoringConfiguration,
  CTPScorings,
} from "../Models/Entities/score";
import { SchedulingLandscape } from "../Models/Entities/landscape";
import { CTPAppSettings } from "../Models/Entities/appsettings";
import { CTPTimeline } from "../Models/Entities/timeline";
import { APIServiceFromFile } from "../Services/apiService";
import { CTPStateChange } from "../Models/Entities/statechange";

var path = "";
var resources: CTPResource[] = [];
var tasks: CTPTask[] = [];
var cos: CTPStateChange[] = [];
var scorings: CTPScoring[] = [];
var schedule_name = "";
var settings = new CTPAppSettings();

var rwData = new APIServiceFromFile(path);
var DAYS = 14;

var sDate = CTPDateTime.now().set({
  year: 2025,
  month: 5,
  day: 12,
  hour: 0,
  minute: 0,
  second: 0,
  millisecond: 0,
});
var eDate = sDate
  .plus({ days: DAYS })
  .set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

var horizon = new CTPHorizon(sDate, eDate);

export function createHorizon() {
  return horizon;
}

export function buildAvailable(days: number): CTPIntervals {
  var a: CTPIntervals = new CTPIntervals();

  let d = horizon.startDate;
  let day = 0;
  let qty = 1.0;
  let st = 8 * CTPDateTime.ONE_HOUR;
  let et = 17 * CTPDateTime.ONE_HOUR;
  let rr = 0;
  let offset = 0;

  for (let i = 0; i < days; i++) {
    qty = 1;
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

export function buildAssignments(days: number): CTPIntervals {
  var a: CTPIntervals = new CTPIntervals();

  let d = horizon.startDate;

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

    let a1 = new CTPInterval(day + st, day + et, qty);
    a1.name = "Unavailable";
    a.add(a1);
  }

  return a;
}

export function createResources(): CTPResource[] {
  resources = [];
  let key = 0;
  for (let i = 0; i < 5; i++) {
    key += 1;
    const res = new CTPResource(
      CTPResourceConstants.REUSABLE,
      "Tools",
      "Tool " + i.toString(),
      key.toString(),
    );
    res.hierarchy.first = "Tools";
    res.original = buildAvailable(DAYS);
    res.assignments = buildAssignments(3);
    res.attributes.add(new NameValue("PROCESS", "PROC" + res.key));
    resources.push(res);
  }

  for (let i = 0; i < 5; i++) {
    key += 1;
    const res = new CTPResource(
      CTPResourceConstants.REUSABLE,
      "Durable",
      "Durable " + i.toString(),
      key.toString(),
    );
    res.hierarchy.first = "Durable";

    res.attributes.add(new NameValue("PROCESS", "PROC" + res.key));
    resources.push(res);
  }
  return resources;
}
export function createScorings() {
  scorings = [];
  let c = new CTPScoring("WhiteSpace", "WhiteSpace");
  c.addConfig(new CTPScoringConfiguration("EarliestStartTimeScoringRule", 0.3));
  c.addConfig(new CTPScoringConfiguration("WhiteSpaceScoringRule", 0.7));
  scorings.push(c);

  let c1 = new CTPScoring("Fair Share", "Fair Share");
  c1.addConfig(
    new CTPScoringConfiguration("EarliestStartTimeScoringRule", 0.3),
  );
  c1.addConfig(
    new CTPScoringConfiguration(
      "WhiteSpaceScoringRule",
      0.7,
      CTPScoreObjectiveConstants.MAXIMIZE,
    ),
  );
  scorings.push(c1);
}
export function createTasks(): CTPTask[] {
  tasks = [];
  for (let i = 0; i < 10; i++) {
    const res = new CTPTask(
      "PROCESS",
      "Activity " + i.toString(),
      i.toString(),
    );
    res.sequence = i;
    res.rank = i;
    res.duration = new CTPDuration(900 * (i + 1), 1.0);
    res.window = new CTPInterval(horizon.startW, horizon.endW);
    res.capacityResources = new CTPTaskResourceList();
    res.capacityResources?.add(new CTPTaskResource("Tools", true));
    tasks.push(res);
  }
  return tasks;
}

function createDirectory(path: string) {
  rwData.setbaseURL(path);
  fs.mkdir(path, { recursive: true }, (err) => {
    if (err) throw err;
  });
}

export function writeLandscape(p: string, name: string) {
  path = p;
  schedule_name = name;
  if (schedule_name) path = path + "/";

  createDirectory(path);
  rwData.updateResources(name, resources);
  rwData.updateHorizon(name, horizon);
  rwData.updateTasks(name, tasks);
  rwData.updateScorings(name, scorings);
  rwData.updateTimeline(new CTPTimeline(name, name));
  rwData.updateAppSettings(name, settings);
}

export function createLandscape() {
  createResources();
  createTasks();
  createScorings();
}
export function buildAScoring(): CTPScorings {
  createScorings();
  let s = new CTPScorings();
  scorings.forEach((res) => {
    s.add(res.key, res);
  });
  return s;
}
export function createStateChanges(): CTPStateChange[] {
  cos = [];
  let co = new CTPStateChange(
    "Tools",
    Constants.CTPStateChangeConstants.PROCESS_CHANGE,
    "BLUE",
    Constants.CTPStateChangeConstants.DEFAULT_PROCESS,
  );
  co.duration = 900;
  co.cost = 50;
  co.name = "Blue to Default";
  cos.push(co);

  co = new CTPStateChange(
    "Tools",
    Constants.CTPStateChangeConstants.PROCESS_CHANGE,
    Constants.CTPStateChangeConstants.DEFAULT_PROCESS,
    "RED",
  );
  co.duration = 900;
  co.cost = 50;
  co.name = "Default to Red";
  cos.push(co);

  co = new CTPStateChange(
    "Tools",
    Constants.CTPStateChangeConstants.PROCESS_CHANGE,
    "BLUE",
    "RED",
  );
  co.duration = 1800;
  co.cost = 25;
  co.penalty = 100;
  co.name = "Blue to Red";
  cos.push(co);

  co = new CTPStateChange(
    "Tools",
    Constants.CTPStateChangeConstants.PROCESS_CHANGE,
    "GREEN",
    "BLUE",
  );
  co.duration = 600;
  co.cost = 100;
  co.name = "Green to Blue";
  cos.push(co);

  return cos;
}
export function buildALandscape(): SchedulingLandscape {
  let l = new SchedulingLandscape();

  createResources();
  createTasks();
  createStateChanges();

  l.horizon = horizon;
  l.resources.fromArray(resources);
  l.tasks.fromArray(tasks);
  l.stateChanges.fromArray(cos);
  l.appSettings = new CTPAppSettings();
  buildResourcePreferences(l, 1);
  return l;
}

export function buildResourcePreferences(
  l: SchedulingLandscape,
  topXResources: number,
) {
  if (l.tasks) {
    l.tasks.forEach((t) => {
      t.capacityResources?.forEach((res) => {
        const isATool = (key: string, value: CTPResource): boolean =>
          value.hierarchy.first === res.resource;
        let resources = l.resources.filterMap(isATool);
        let i = 0;
        resources.forEach((pref) => {
          if (i < topXResources)
            res.preferences.push(new CTPResourcePreference(pref.key, 1)),
              (i += 1);
        });
      });
    });
  }
}
