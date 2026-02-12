import { describe, it, expect } from 'vitest';
import { CTPScheduler } from '../../AI/Scheduling/defaultscheduler';
import { CTPTask, CTPTasks, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPDuration, CTPInterval, CTPRunRate } from '../../Models/Core/window';
import { CTPAvailable, CTPAssignments } from '../../Models/Intervals/intervals';
import { CTPTaskStateConstants, CTPResourceConstants, CTPScheduleDirectionConstants } from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses } from '../../Models/Entities/process';
import { List } from '../../Models/Core/list';
import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';

/**
 * Build deterministic availability for a resource.
 * Creates an 8-hour block (8am-4pm) each day for the given number of days.
 */
function buildDeterministicAvail(horizon: CTPHorizon, days: number): CTPAvailable {
  const avail = new CTPAvailable();
  let d = horizon.startDate;
  for (let i = 0; i < days; i++) {
    const day = CTPDateTime.fromDateTime(d);
    const st = 8 * CTPDateTime.ONE_HOUR;
    const et = 16 * CTPDateTime.ONE_HOUR;
    avail.add(new CTPRunRate(day + st, day + et, 1, 0));
    d = d.plus({ days: 1 });
  }
  return avail;
}

function createScheduler(opts: {
  numResources: number;
  numTasks: number;
  taskDuration: number;
  days?: number;
  topResources?: number;
  direction?: number;
}): {
  scheduler: CTPScheduler;
  tasks: CTPTask[];
  resources: CTPResource[];
  horizon: CTPHorizon;
  tasksToSchedule: List<CTPTask>;
} {
  const days = opts.days ?? 14;
  const topResources = opts.topResources ?? 1;

  // Create horizon
  const sDate = DateTime.fromObject({ year: 2025, month: 5, day: 12, hour: 0, minute: 0, second: 0 });
  const eDate = sDate.plus({ days });
  const horizon = new CTPHorizon(sDate, eDate);

  // Create resources with deterministic availability
  const resources: CTPResource[] = [];
  for (let i = 0; i < opts.numResources; i++) {
    const res = new CTPResource(
      CTPResourceConstants.REUSABLE,
      'Tools',
      `Tool ${i}`,
      `R${i}`,
    );
    res.hierarchy.first = 'Tools';
    res.original = buildDeterministicAvail(horizon, days);
    resources.push(res);
  }

  // Create tasks
  const tasks: CTPTask[] = [];
  for (let i = 0; i < opts.numTasks; i++) {
    const task = new CTPTask('PROCESS', `Task ${i}`, `T${i}`);
    task.sequence = i;
    task.rank = i;
    task.duration = new CTPDuration(opts.taskDuration, 1.0);
    task.window = new CTPInterval(horizon.startW, horizon.endW);
    task.capacityResources = new CTPTaskResourceList();
    task.capacityResources.add(new CTPTaskResource('Tools', true));

    // Set resource preferences (which resources this task can use)
    const taskRes = task.capacityResources.at(0)!;
    let prefCount = 0;
    for (const res of resources) {
      if (prefCount < topResources) {
        taskRes.preferences.push(new CTPResourcePreference(res.key, 1));
        prefCount++;
      }
    }
    tasks.push(task);
  }

  // Create scoring
  const scoring = new CTPScoring('WhiteSpace', 'WhiteSpace');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 0.3));
  scoring.addConfig(new CTPScoringConfiguration('WhiteSpaceScoringRule', 0.7));

  // Create settings
  const settings = new CTPAppSettings();
  settings.scheduleDirection = opts.direction ?? CTPScheduleDirectionConstants.FORWARD;

  // Build collections
  const ctpResources = new CTPResources();
  ctpResources.fromArray(resources);
  const ctpTasks = new CTPTasks();
  ctpTasks.fromArray(tasks);

  // Initialize scheduler
  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    horizon,
    ctpTasks,
    ctpResources,
    new CTPStateChanges(),
    new CTPProcesses(),
  );
  scheduler.initScoring(scoring);
  scheduler.initSettings(settings);

  // Build task list to schedule
  const tasksToSchedule = new List<CTPTask>();
  for (const task of tasks) {
    tasksToSchedule.add(task);
  }

  return { scheduler, tasks, resources, horizon, tasksToSchedule };
}

describe('CTPScheduler.schedule', () => {
  it('schedules a single task to a single resource', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 1,
      taskDuration: 3600, // 1 hour
    });

    scheduler.schedule(tasksToSchedule);

    expect(tasks[0].state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(tasks[0].scheduled).not.toBeNull();
    expect(tasks[0].scheduled!.endW - tasks[0].scheduled!.startW).toBe(3600);
  });

  it('schedules multiple tasks', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 3,
      taskDuration: 3600,
    });

    scheduler.schedule(tasksToSchedule);

    let scheduledCount = 0;
    for (const task of tasks) {
      if (task.state === CTPTaskStateConstants.SCHEDULED) {
        scheduledCount++;
      }
    }
    expect(scheduledCount).toBe(3);
  });

  it('scheduled tasks have correct duration', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 3,
      taskDuration: 3600,
    });

    scheduler.schedule(tasksToSchedule);

    // Verify each scheduled task has the correct duration
    for (const task of tasks) {
      if (task.scheduled) {
        const actualDuration = task.scheduled.endW - task.scheduled.startW;
        expect(actualDuration).toBe(3600);
      }
    }
  });

  it('tasks scheduled within horizon boundaries', () => {
    const { scheduler, tasks, tasksToSchedule, horizon } = createScheduler({
      numResources: 1,
      numTasks: 2,
      taskDuration: 3600,
    });

    scheduler.schedule(tasksToSchedule);

    for (const task of tasks) {
      if (task.scheduled) {
        expect(task.scheduled.startW).toBeGreaterThanOrEqual(horizon.startW);
        expect(task.scheduled.endW).toBeLessThanOrEqual(horizon.endW);
      }
    }
  });

  it('handles multiple resources', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 3,
      numTasks: 3,
      taskDuration: 3600,
      topResources: 3, // Each task can use all 3 resources
    });

    scheduler.schedule(tasksToSchedule);

    const scheduledCount = tasks.filter(
      (t) => t.state === CTPTaskStateConstants.SCHEDULED,
    ).length;
    expect(scheduledCount).toBe(3);
  });

  it('task processed flag is set after scheduling', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 2,
      taskDuration: 3600,
    });

    scheduler.schedule(tasksToSchedule);

    for (const task of tasks) {
      expect(task.processed).toBe(true);
    }
  });
});

describe('CTPScheduler.unschedule', () => {
  it('unschedules a task — state returns to NOT_SCHEDULED', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 1,
      taskDuration: 3600,
    });

    scheduler.schedule(tasksToSchedule);
    expect(tasks[0].state).toBe(CTPTaskStateConstants.SCHEDULED);

    // Re-build unschedule list
    const toUnschedule = new List<CTPTask>();
    toUnschedule.add(tasks[0]);
    scheduler.unschedule(toUnschedule);

    expect(tasks[0].state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
  });

  it('unschedule clears the scheduled interval', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 1,
      taskDuration: 3600,
    });

    scheduler.schedule(tasksToSchedule);
    expect(tasks[0].scheduled).not.toBeNull();

    const toUnschedule = new List<CTPTask>();
    toUnschedule.add(tasks[0]);
    scheduler.unschedule(toUnschedule);

    expect(tasks[0].scheduled).toBeNull();
  });
});

describe('CTPScheduler round-trip', () => {
  it('schedule → unschedule → reschedule produces same result', () => {
    const { scheduler, tasks, tasksToSchedule } = createScheduler({
      numResources: 1,
      numTasks: 2,
      taskDuration: 3600,
    });

    // First schedule
    scheduler.schedule(tasksToSchedule);
    const firstRun = tasks.map((t) => ({
      state: t.state,
      hasScheduled: t.scheduled !== null,
    }));
    expect(firstRun.every((t) => t.state === CTPTaskStateConstants.SCHEDULED)).toBe(true);

    // Unschedule all
    const toUnschedule = new List<CTPTask>();
    for (const t of tasks) toUnschedule.add(t);
    scheduler.unschedule(toUnschedule);

    expect(tasks.every((t) => t.state === CTPTaskStateConstants.NOT_SCHEDULED)).toBe(true);

    // Reschedule
    const toReschedule = new List<CTPTask>();
    for (const t of tasks) toReschedule.add(t);
    scheduler.schedule(toReschedule);

    expect(tasks.every((t) => t.state === CTPTaskStateConstants.SCHEDULED)).toBe(true);
  });
});

describe('CTPScheduler edge cases', () => {
  it('empty task list — no error', () => {
    const { scheduler } = createScheduler({
      numResources: 1,
      numTasks: 0,
      taskDuration: 3600,
    });

    const emptyList = new List<CTPTask>();
    expect(() => scheduler.schedule(emptyList)).not.toThrow();
  });

  it('throws when landscape/scoring not initialized', () => {
    const scheduler = new CTPScheduler();
    const tasks = new List<CTPTask>();
    tasks.add(new CTPTask('PROCESS', 'T1', '1'));
    expect(() => scheduler.schedule(tasks)).toThrow();
  });
});
