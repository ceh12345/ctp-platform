/**
 * Test helpers for FLOAT-duration scheduling scenarios.
 *
 * Goal: each test reads as a sentence about timing — "16h FLOAT task on
 * 8h shift ends Tuesday 15:00." These helpers absorb the CTPInterval /
 * CTPHorizon / CTPScheduler boilerplate so test bodies stay focused on
 * the timing assertion.
 *
 * Usage shape:
 *
 *   const horizon = makeHorizon(monday('2026-04-13'), 14);
 *   const r = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
 *   const t = makeFloatTask({ key: 'T1', durationHours: 16, resourceKey: 'M1', horizon });
 *   const result = solveScenario({ horizon, resources: [r], tasks: [t] });
 *   expect(result.get('T1')!.end).toEqual(tuesday('2026-04-14').set({ hour: 15 }));
 */

import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPTask, CTPTasks, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPDuration, CTPInterval } from '../../Models/Core/window';
import { CTPAssignments, CTPAvailable } from '../../Models/Intervals/intervals';
import { CTPDurationConstants, CTPResourceConstants } from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses } from '../../Models/Entities/process';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPScheduler } from '../../AI/Schedulers/defaultscheduler';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { List } from '../../Models/Core/list';

const ONE_HOUR = 3600;

/** Build a horizon starting at the given date for the given number of days. */
export function makeHorizon(startDate: DateTime, days: number = 30): CTPHorizon {
  return new CTPHorizon(startDate, startDate.plus({ days }));
}

/**
 * Add daily shift intervals to an existing CTPAvailable. Default: Mon-Fri.
 * Pass workdays=[1..7] for full week, e.g. [1,2,3,4,5,6,7].
 * Luxon convention: weekday 1=Mon, 7=Sun.
 */
export function addShifts(
  avail: CTPAvailable,
  startDate: DateTime,
  spanDays: number,
  startHour: number,
  endHour: number,
  workdays: number[] = [1, 2, 3, 4, 5],
): void {
  let d = startDate.startOf('day');
  for (let i = 0; i < spanDays; i++) {
    if (workdays.includes(d.weekday)) {
      const s = d.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
      const e = d.set({ hour: endHour, minute: 0, second: 0, millisecond: 0 });
      avail.add(new CTPInterval(CTPDateTime.fromDateTime(s), CTPDateTime.fromDateTime(e), 1));
    }
    d = d.plus({ days: 1 });
  }
}

/**
 * Build a resource with a daily shift calendar. Default Mon-Fri startHour..endHour.
 * Spans the full horizon by default; pass `weeks` to override.
 */
export function makeResourceWithShifts(
  key: string,
  horizon: CTPHorizon,
  shift: { startHour: number; endHour: number; workdays?: number[]; days?: number },
): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', key, key);
  res.hierarchy.first = 'Machine';
  const avail = new CTPAvailable();
  addShifts(
    avail,
    horizon.startDate,
    shift.days ?? Math.ceil(horizon.endDate.diff(horizon.startDate, 'days').days),
    shift.startHour,
    shift.endHour,
    shift.workdays,
  );
  res.original = avail;
  res.assignments = new CTPAssignments();
  res.available.setLists(res.original, res.assignments);
  return res;
}

/**
 * Build a FLOAT task. By default no scheduledStart (solver will place);
 * pass scheduledStart to simulate a pinned task.
 */
export function makeFloatTask(opts: {
  key: string;
  durationHours: number;
  resourceKey: string;
  horizon: CTPHorizon;
}): CTPTask {
  const t = new CTPTask('PROCESS', opts.key, opts.key);
  t.duration = new CTPDuration(opts.durationHours * ONE_HOUR, 1.0, CTPDurationConstants.FLOAT_DURATION);
  t.window = new CTPInterval(opts.horizon.startW, opts.horizon.endW);
  t.sequence = 1;
  t.rank = 1;
  t.capacityResources = new CTPTaskResourceList();
  const tr = new CTPTaskResource('Machine', true);
  tr.preferences.push(new CTPResourcePreference(opts.resourceKey, 1));
  t.capacityResources.add(tr);
  return t;
}

/** Same as makeFloatTask but with FIXED_DURATION — for control comparisons. */
export function makeFixedTask(opts: {
  key: string;
  durationHours: number;
  resourceKey: string;
  horizon: CTPHorizon;
}): CTPTask {
  const t = makeFloatTask(opts);
  t.duration!.durationType = CTPDurationConstants.FIXED_DURATION;
  return t;
}

/** Result row per task — readable times + raw numeric for arithmetic checks. */
export interface FloatPlacement {
  scheduled: boolean;
  startW: number;
  endW: number;
  start: DateTime | null;
  end: DateTime | null;
  errors: string[];
}

/**
 * Build a landscape, run the scheduler, return placements per task.
 * Compact wrapper around CTPScheduler for tests that only care about
 * placement timing.
 */
export function solveScenario(args: {
  horizon: CTPHorizon;
  resources: CTPResource[];
  tasks: CTPTask[];
}): Map<string, FloatPlacement> {
  const ctpTasks = new CTPTasks();
  args.tasks.forEach(t => ctpTasks.addEntity(t));

  const ctpResources = new CTPResources();
  args.resources.forEach(r => ctpResources.addEntity(r));

  const settings = new CTPAppSettings();
  settings.scheduleDirection = 1; // FORWARD

  const scheduler = new CTPScheduler();
  scheduler.initLandscape(args.horizon, ctpTasks, ctpResources, new CTPStateChanges(), new CTPProcesses());

  const scoring = new CTPScoring('Test', 'test');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
  scheduler.initScoring(scoring);
  scheduler.initSettings(settings);

  const taskList = new List<CTPTask>();
  args.tasks.forEach(t => taskList.add(t));
  scheduler.schedule(taskList);

  const results = new Map<string, FloatPlacement>();
  for (const t of args.tasks) {
    if (t.scheduled) {
      // Return placements in UTC so tests are timezone-stable. The engine's
      // CTPDateTime.toDateTime returns DateTimes in baseDate's zone (local),
      // which makes assertions zone-dependent. .toUTC() pins to UTC.
      results.set(t.key, {
        scheduled: true,
        startW: t.scheduled.startW,
        endW: t.scheduled.endW,
        start: t.scheduled.AbsoluteStartTime.toUTC(),
        end: t.scheduled.AbsoluteEndTime.toUTC(),
        errors: t.errors.map(e => e.reason),
      });
    } else {
      results.set(t.key, {
        scheduled: false,
        startW: 0,
        endW: 0,
        start: null,
        end: null,
        errors: t.errors.map(e => e.reason),
      });
    }
  }
  return results;
}

/** Convenience constructor for a Monday at midnight. */
export function monday(isoDate: string): DateTime {
  const d = DateTime.fromISO(isoDate, { zone: 'utc' });
  if (d.weekday !== 1) {
    throw new Error(`monday('${isoDate}') called with non-Monday date (weekday=${d.weekday})`);
  }
  return d;
}
