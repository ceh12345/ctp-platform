import { describe, it, expect } from 'vitest';
import { CTPScheduler } from '../../AI/Schedulers/defaultscheduler';
import { CTPTask, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPTasks } from '../../Models/Entities/task';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPDuration, CTPInterval } from '../../Models/Core/window';
import { CTPAvailable } from '../../Models/Intervals/intervals';
import {
  CTPResourceModeConstants,
  CTPResourceConstants,
  CTPTaskStateConstants,
} from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses, CTPProcess } from '../../Models/Entities/process';
import { CTPLinkId } from '../../Models/Core/linkid';
import { List } from '../../Models/Core/list';
import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';

const ONE_HOUR = 3600;

function makeHorizon(): CTPHorizon {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  const et = st.plus({ days: 7 });
  return new CTPHorizon(st, et);
}

function makeResource8h(key: string, name: string, horizon: CTPHorizon): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', name, key);
  res.hierarchy.first = 'Machine';
  const avail = new CTPAvailable();
  // 8 hours/day for 7 days
  let d = horizon.startDate;
  for (let i = 0; i < 7; i++) {
    const day = CTPDateTime.fromDateTime(d);
    avail.add(new CTPInterval(day + 8 * ONE_HOUR, day + 16 * ONE_HOUR, 1));
    d = d.plus({ days: 1 });
  }
  res.original = avail;
  res.available.setOriginal(res.original);
  return res;
}

function makeScoring(): CTPScoring {
  const scoring = new CTPScoring('Test', 'test');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
  return scoring;
}

// ═══════════════════════════════════════════════════════════════
// Test 1 — Pure-duration task in a chain schedules at predecessor end
// ═══════════════════════════════════════════════════════════════

describe('pure-duration task scheduling', () => {
  it('schedules a pure-duration successor at predecessor end (maxGap=0)', () => {
    const horizon = makeHorizon();
    const resource = makeResource8h('M1', 'Machine 1', horizon);

    // STEP-1: resource task (2h), chain root
    const step1 = new CTPTask('PROCESS', 'Step 1', 'STEP-1');
    step1.duration = new CTPDuration(2 * ONE_HOUR, 1.0);
    step1.window = new CTPInterval(horizon.startW, horizon.endW);
    step1.linkId = new CTPLinkId('CHAIN-A', 'ES', '', null);
    step1.sequence = 1;
    step1.rank = 1;
    step1.capacityResources = new CTPTaskResourceList();
    const tr1 = new CTPTaskResource('Machine', true);
    tr1.preferences.push(new CTPResourcePreference('M1', 1));
    step1.capacityResources.add(tr1);

    // STEP-2: pure-duration (no capacityResources), 1h, successor to STEP-1, back-to-back
    const step2 = new CTPTask('PROCESS', 'Step 2', 'STEP-2');
    step2.duration = new CTPDuration(1 * ONE_HOUR, 1.0);
    step2.window = new CTPInterval(horizon.startW, horizon.endW);
    step2.linkId = new CTPLinkId('CHAIN-A', 'ES', 'STEP-1', 0); // maxGap=0 → back-to-back
    step2.sequence = 2;
    step2.rank = 2;
    // capacityResources intentionally left null — pure-duration task

    const ctpTasks = new CTPTasks();
    ctpTasks.addEntity(step1);
    ctpTasks.addEntity(step2);

    const ctpResources = new CTPResources();
    ctpResources.addEntity(resource);

    const chain = new CTPProcess('CHAIN-A');
    chain.tasks?.add(step1);
    chain.tasks?.add(step2);
    const processes = new CTPProcesses();
    processes.addEntity(chain);

    const settings = new CTPAppSettings();
    settings.scheduleDirection = 1; // FORWARD

    const scheduler = new CTPScheduler();
    scheduler.initLandscape(horizon, ctpTasks, ctpResources, new CTPStateChanges(), processes);
    scheduler.initScoring(makeScoring());
    scheduler.initSettings(settings);

    const tasksToSchedule = new List<CTPTask>();
    tasksToSchedule.add(step1);
    tasksToSchedule.add(step2);

    scheduler.schedule(tasksToSchedule);

    // STEP-1 must be scheduled
    expect(step1.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(step1.scheduled).not.toBeNull();

    // STEP-2 must be scheduled immediately after STEP-1 (back-to-back)
    expect(step2.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(step2.scheduled).not.toBeNull();
    expect(step2.scheduled!.startW).toBe(step1.scheduled!.endW);
    expect(step2.scheduled!.endW - step2.scheduled!.startW).toBe(1 * ONE_HOUR);
  });
});

// ═══════════════════════════════════════════════════════════════
// Test 2 — Task with all resources ignored → structured infeasibility
// ═══════════════════════════════════════════════════════════════

describe('all-filtered resource infeasibility', () => {
  it('surfaces a structured error when all declared resources are ignored', () => {
    const horizon = makeHorizon();

    // Task declares 2 capacity resources, both IGNORED
    const task = new CTPTask('PROCESS', 'Ignored Task', 'TASK-IGNORED');
    task.duration = new CTPDuration(1 * ONE_HOUR, 1.0);
    task.window = new CTPInterval(horizon.startW, horizon.endW);
    task.sequence = 1;
    task.rank = 1;
    task.capacityResources = new CTPTaskResourceList();

    const tr1 = new CTPTaskResource('Machine', true, 0, undefined, CTPResourceModeConstants.IGNORED);
    tr1.preferences.push(new CTPResourcePreference('M1', 1));
    task.capacityResources.add(tr1);

    const tr2 = new CTPTaskResource('Machine', false, 1, undefined, CTPResourceModeConstants.IGNORED);
    tr2.preferences.push(new CTPResourcePreference('M2', 1));
    task.capacityResources.add(tr2);

    const ctpTasks = new CTPTasks();
    ctpTasks.addEntity(task);

    const settings = new CTPAppSettings();
    settings.scheduleDirection = 1;

    const scheduler = new CTPScheduler();
    scheduler.initLandscape(horizon, ctpTasks, new CTPResources(), new CTPStateChanges(), new CTPProcesses());
    scheduler.initScoring(makeScoring());
    scheduler.initSettings(settings);

    const tasksToSchedule = new List<CTPTask>();
    tasksToSchedule.add(task);

    scheduler.schedule(tasksToSchedule);

    // Task must not be scheduled
    expect(task.scheduled).toBeNull();

    // Must have at least one error with the structured message
    expect(task.errors.length).toBeGreaterThan(0);
    const reason = task.errors[0].reason;
    expect(reason).toContain('declared 2 resource preference(s), all filtered out');
    expect(reason).toContain('2 ignored');
    expect(reason).toContain('0 unavailable');
  });
});
