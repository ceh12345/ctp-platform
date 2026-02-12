import * as fs from "./buildlandscape";
import { CTPScheduler } from "../AI/Scheduling/defaultscheduler";
import { List } from "../Models/Core/list";
import { CTPTask } from "../Models/Entities/task";
import { CTPAppSettings } from "../Models/Entities/appsettings";
import { APIServiceFromFile } from "../Services/apiService";
import { CTPTimeline } from "../Models/Entities/timeline";
import { SchedulingLandscape } from "../Models/Entities/landscape";
import { CTPScorings } from "../Models/Entities/score";
import { CTPTaskStateConstants, CTPTaskTypeConstants } from "../Models/Core/constants";

export function testScheduler(
  numToSchedule: number,
  land: SchedulingLandscape,
  scores: CTPScorings,
): void {
  let l = land; //fs.buildALandscape();
  let s = scores; //fs.buildAScoring();
  let scoring = s.getEntity("WhiteSpace");
  let settings = l.appSettings;

  //fs.buildResourcePreferences(l, 1);

  let tasktoschedule = new List<CTPTask>();

  let scheduler = new CTPScheduler();

  scheduler.initLandscape(l.horizon, l.tasks, l.resources, l.stateChanges,l.processes);
  if (scoring) scheduler.initScoring(scoring);
  scheduler.initSettings(settings);

  const count = numToSchedule;

  const tasks = l.tasks.toArray().filter((task) =>
    (task.state === CTPTaskStateConstants.NOT_SCHEDULED)
    && (task.type === CTPTaskTypeConstants.PROCESS)
    ).sort((a, b) => a.rank-b.rank);

  //tasktoschedule.add(tasks[1]);
  for (let i = 0; i < count; i++) {
    if (i < tasks.length) tasktoschedule.add(tasks[i]);
  }

  scheduler.schedule(tasktoschedule);
}

export function testUnScheduler(
  numToSchedule: number,
  land: SchedulingLandscape,
  scores: CTPScorings,
): void {
  let l = land; //fs.buildALandscape();
  let s = scores; //fs.buildAScoring();
  let scoring = s.getEntity("WhiteSpace");
  let settings = l.appSettings;

  //fs.buildResourcePreferences(l, 1);

  let tasktoschedule = new List<CTPTask>();

  let scheduler = new CTPScheduler();

  scheduler.initLandscape(l.horizon, l.tasks, l.resources, l.stateChanges,l.processes);
  if (scoring) scheduler.initScoring(scoring);
  scheduler.initSettings(settings);

  const count = numToSchedule;

  const tasks = l.tasks.toArray().filter((task) => 
    (task.state === CTPTaskStateConstants.SCHEDULED)
    && (task.type === CTPTaskTypeConstants.PROCESS)
    ).sort((a, b) => a.rank-b.rank);

  //tasktoschedule.add(tasks[1]);
  for (let i = 0; i < count; i++) {
    if (i < tasks.length) {
      tasktoschedule.add(tasks[i]);
    }
  }

  scheduler.unschedule(tasktoschedule);
}
