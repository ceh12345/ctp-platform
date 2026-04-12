import { describe, it, expect, beforeEach } from 'vitest';
import { CTPScheduler } from '../../AI/Schedulers/defaultscheduler';
import {
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
} from '../../Models/Entities/task';
import {
  CTPResource,
  CTPResources,
  CTPResourcePreference,
} from '../../Models/Entities/resource';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPDuration, CTPInterval, CTPRunRate } from '../../Models/Core/window';
import { CTPAvailable, CTPAssignments } from '../../Models/Intervals/intervals';
import {
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  CTPResourceConstants,
  CTPScheduleDirectionConstants,
} from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses, CTPProcess } from '../../Models/Entities/process';
import { CTPLinkId } from '../../Models/Core/linkid';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { List } from '../../Models/Core/list';
import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';

// ═══════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════

const ONE_HOUR = CTPDateTime.ONE_HOUR;

function makeHorizon(days: number = 7): { horizon: CTPHorizon; start: DateTime } {
  const start = DateTime.fromObject({ year: 2025, month: 5, day: 12, hour: 0 });
  const end = start.plus({ days });
  return { horizon: new CTPHorizon(start, end), start };
}

/**
 * Build 8am-4pm (8h) availability blocks for N days.
 */
function buildAvail(horizon: CTPHorizon, days: number): CTPAvailable {
  const avail = new CTPAvailable();
  let d = horizon.startDate;
  for (let i = 0; i < days; i++) {
    const day = CTPDateTime.fromDateTime(d);
    const st = 8 * ONE_HOUR;
    const et = 16 * ONE_HOUR;
    avail.add(new CTPRunRate(day + st, day + et, 1, 0));
    d = d.plus({ days: 1 });
  }
  return avail;
}

function makeResource(name: string, key: string, horizon: CTPHorizon, days: number = 5): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', name, key);
  res.hierarchy.first = 'Machine';
  res.original = buildAvail(horizon, days);
  res.assignments = new CTPAssignments();
  return res;
}

function makeTask(
  name: string,
  key: string,
  durationSec: number,
  horizon: CTPHorizon,
  resourceType: string = 'Machine',
): CTPTask {
  const task = new CTPTask('PROCESS', name, key);
  task.duration = new CTPDuration(durationSec, 1.0);
  task.window = new CTPInterval(horizon.startW, horizon.endW);
  task.capacityResources = new CTPTaskResourceList();
  task.capacityResources.add(new CTPTaskResource(resourceType, true));
  return task;
}

function addPreference(task: CTPTask, resourceKey: string, rank: number = 1): void {
  const taskRes = task.capacityResources!.at(0)!;
  taskRes.preferences.push(new CTPResourcePreference(resourceKey, rank));
}

function solveAll(
  landscape: SchedulingLandscape,
  tasks: CTPTask[],
  strategy: string = 'Greedy',
): void {
  const scoring = new CTPScoring('test', 'test');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));

  const settings = new CTPAppSettings();
  settings.scheduleDirection = CTPScheduleDirectionConstants.FORWARD;
  settings.solverStrategy = strategy;

  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    landscape.horizon,
    landscape.tasks,
    landscape.resources,
    landscape.stateChanges,
    landscape.processes,
  );
  scheduler.initScoring(scoring);
  scheduler.initSettings(settings);

  const taskList = new List<CTPTask>();
  for (const t of tasks) taskList.add(t);
  scheduler.schedule(taskList);
}

function getTotalAssigned(resource: CTPResource): number {
  let total = 0;
  if (resource.assignments) {
    let node = resource.assignments.head;
    while (node) {
      total += node.data.duration();
      node = node.next;
    }
  }
  return total;
}

function getTotalAvailable(resource: CTPResource): number {
  let total = 0;
  if (resource.original) {
    let node = resource.original.head;
    while (node) {
      total += node.data.duration();
      node = node.next;
    }
  }
  return total;
}

function getNetAvailable(resource: CTPResource): number {
  return getTotalAvailable(resource) - getTotalAssigned(resource);
}

function getAssignmentCount(resource: CTPResource): number {
  let count = 0;
  if (resource.assignments) {
    let node = resource.assignments.head;
    while (node) {
      count++;
      node = node.next;
    }
  }
  return count;
}

function isScheduled(task: CTPTask): boolean {
  return task.state === CTPTaskStateConstants.SCHEDULED && task.scheduled !== null;
}

function buildLandscape(horizon: CTPHorizon): SchedulingLandscape {
  const landscape = new SchedulingLandscape(horizon.startDate, horizon.endDate);
  return landscape;
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('SchedulingLandscape.unscheduleTask', () => {
  // ── Test 1: Task state resets after unschedule ──────────────

  it('resets task state after unschedule', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Machine Part A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    solveAll(landscape, [taskA]);

    // Verify scheduled
    expect(taskA.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(taskA.scheduled).not.toBeNull();
    expect(taskA.score).not.toBe(Number.MAX_VALUE);

    // Unschedule
    const result = landscape.unscheduleTask('TASK-A', true);

    expect(result).toBe(true);
    expect(taskA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(taskA.scheduled).toBeNull();
    expect(taskA.feasible).toBeNull();
    expect(taskA.processed).toBe(false);
    expect(taskA.score).toBe(Number.MAX_VALUE);

    // Each capacity resource should have scheduledResource cleared
    taskA.capacityResources!.forEach(tr => {
      expect(tr.scheduledResource).toBeUndefined();
    });
  });

  // ── Test 2: Resource availability restored ──────────────────

  it('restores resource availability after unschedule', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Machine Part A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    // Before solve: no assignments
    expect(getTotalAssigned(cnc01)).toBe(0);

    solveAll(landscape, [taskA]);

    // After solve: should have assignments
    const assignedAfterSolve = getTotalAssigned(cnc01);
    expect(assignedAfterSolve).toBeGreaterThan(0);

    // Unschedule
    landscape.unscheduleTask('TASK-A', true);

    // After unschedule: assignments should be removed
    expect(getTotalAssigned(cnc01)).toBe(0);
  });

  // ── Test 3: Assignment nodes removed from resource list ─────

  it('removes correct assignment nodes from resource linked list', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    const taskB = makeTask('Task B', 'TASK-B', 3 * ONE_HOUR, horizon);
    addPreference(taskB, 'CNC-01');
    landscape.tasks.addEntity(taskB);

    solveAll(landscape, [taskA, taskB]);

    expect(isScheduled(taskA)).toBe(true);
    expect(isScheduled(taskB)).toBe(true);
    expect(getAssignmentCount(cnc01)).toBeGreaterThanOrEqual(2);

    // Capture task B's assignment details
    const taskBStart = taskB.scheduled!.startW;
    const taskBEnd = taskB.scheduled!.endW;

    // Unschedule A only
    landscape.unscheduleTask('TASK-A', true);

    // Walk remaining assignments — none should belong to TASK-A
    let node = cnc01.assignments?.head ?? null;
    while (node) {
      expect(node.data.name).not.toBe('TASK-A');
      node = node.next;
    }

    // Task B's assignments should still exist
    let foundB = false;
    node = cnc01.assignments?.head ?? null;
    while (node) {
      if (node.data.name === 'TASK-B') foundB = true;
      node = node.next;
    }
    expect(foundB).toBe(true);

    // Task B still scheduled with same times
    expect(taskB.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(taskB.scheduled!.startW).toBe(taskBStart);
    expect(taskB.scheduled!.endW).toBe(taskBEnd);
  });

  // ── Test 4: Other tasks untouched ───────────────────────────

  it('leaves other tasks untouched after unschedule', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    const taskB = makeTask('Task B', 'TASK-B', 3 * ONE_HOUR, horizon);
    addPreference(taskB, 'CNC-01');
    landscape.tasks.addEntity(taskB);

    solveAll(landscape, [taskA, taskB]);

    // Snapshot task B state
    const bStart = taskB.scheduled!.startW;
    const bEnd = taskB.scheduled!.endW;
    const bState = taskB.state;
    const bScore = taskB.score;
    const bScheduledRes = taskB.capacityResources!.at(0)!.scheduledResource;

    // Unschedule A
    landscape.unscheduleTask('TASK-A', true);

    // Task B should be completely unchanged
    expect(taskB.state).toBe(bState);
    expect(taskB.scheduled!.startW).toBe(bStart);
    expect(taskB.scheduled!.endW).toBe(bEnd);
    expect(taskB.score).toBe(bScore);
    expect(taskB.capacityResources!.at(0)!.scheduledResource).toBe(bScheduledRes);
  });

  // ── Test 5: Re-solve after unschedule produces valid result ─

  it('re-solves correctly after unschedule', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    const taskB = makeTask('Task B', 'TASK-B', 3 * ONE_HOUR, horizon);
    addPreference(taskB, 'CNC-01');
    landscape.tasks.addEntity(taskB);

    // First solve
    solveAll(landscape, [taskA, taskB]);
    expect(isScheduled(taskA)).toBe(true);
    expect(isScheduled(taskB)).toBe(true);

    // Unschedule A only
    landscape.unscheduleTask('TASK-A', true);
    expect(isScheduled(taskA)).toBe(false);
    expect(isScheduled(taskB)).toBe(true);

    // Re-solve only task A on the same landscape
    solveAll(landscape, [taskA]);

    expect(isScheduled(taskA)).toBe(true);
    expect(isScheduled(taskB)).toBe(true);
  });

  // ── Test 6: Unschedule all then re-solve ────────────────────

  it('unschedules all tasks then re-solves successfully', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    const taskB = makeTask('Task B', 'TASK-B', 3 * ONE_HOUR, horizon);
    addPreference(taskB, 'CNC-01');
    landscape.tasks.addEntity(taskB);

    const taskC = makeTask('Task C', 'TASK-C', 1 * ONE_HOUR, horizon);
    addPreference(taskC, 'CNC-01');
    landscape.tasks.addEntity(taskC);

    const allTasks = [taskA, taskB, taskC];

    // First solve
    solveAll(landscape, allTasks);

    const scheduledFirst = allTasks.filter(t => isScheduled(t)).length;
    expect(scheduledFirst).toBe(3);

    const assignedFirst = getTotalAssigned(cnc01);
    expect(assignedFirst).toBeGreaterThan(0);

    // Unschedule all sequentially
    landscape.unscheduleTask('TASK-A', true);
    landscape.unscheduleTask('TASK-B', true);
    landscape.unscheduleTask('TASK-C', true);

    // All tasks should be NOT_SCHEDULED
    expect(getTotalAssigned(cnc01)).toBe(0);
    for (const t of allTasks) {
      expect(t.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
      expect(t.scheduled).toBeNull();
    }

    // Re-solve all
    solveAll(landscape, allTasks);

    const scheduledSecond = allTasks.filter(t => isScheduled(t)).length;
    expect(scheduledSecond).toBe(3);

    // Total assigned should be the same (same tasks, same durations)
    const assignedSecond = getTotalAssigned(cnc01);
    expect(assignedSecond).toBe(assignedFirst);
  });

  // ── Test 7: Unschedule with multiple resources ──────────────

  it('clears assignments from all resources when task uses multiple', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const assy01 = makeResource('ASSY-01', 'ASSY-01', horizon);
    assy01.hierarchy.first = 'Assembly';
    landscape.resources.addEntity(assy01);

    // Task requires BOTH resources
    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon, 'Machine');
    addPreference(taskA, 'CNC-01');
    // Add second resource requirement
    taskA.capacityResources!.add(new CTPTaskResource('Assembly', false, 1));
    const secondRes = taskA.capacityResources!.at(1)!;
    secondRes.preferences.push(new CTPResourcePreference('ASSY-01', 1));
    landscape.tasks.addEntity(taskA);

    solveAll(landscape, [taskA]);

    // Both resources should have assignments
    const cncAssigned = getTotalAssigned(cnc01);
    const assyAssigned = getTotalAssigned(assy01);
    expect(cncAssigned).toBeGreaterThan(0);
    expect(assyAssigned).toBeGreaterThan(0);

    // Unschedule
    landscape.unscheduleTask('TASK-A', true);

    expect(getTotalAssigned(cnc01)).toBe(0);
    expect(getTotalAssigned(assy01)).toBe(0);
  });

  // ── Test 8: Unschedule middle of chain ──────────────────────

  it('unschedules middle task in a chain without breaking others', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    // Chain: A → B → C (via linkId/prevLink)
    const taskA = makeTask('Step 1', 'TASK-A', 2 * ONE_HOUR, horizon);
    taskA.sequence = 0;
    taskA.linkId = new CTPLinkId('WO-001', 'PROCESS', '');
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    const taskB = makeTask('Step 2', 'TASK-B', 1 * ONE_HOUR, horizon);
    taskB.sequence = 1;
    taskB.linkId = new CTPLinkId('WO-001', 'PROCESS', 'TASK-A');
    addPreference(taskB, 'CNC-01');
    landscape.tasks.addEntity(taskB);

    const taskC = makeTask('Step 3', 'TASK-C', 1 * ONE_HOUR, horizon);
    taskC.sequence = 2;
    taskC.linkId = new CTPLinkId('WO-001', 'PROCESS', 'TASK-B');
    addPreference(taskC, 'CNC-01');
    landscape.tasks.addEntity(taskC);

    landscape.buildProcesses();
    solveAll(landscape, [taskA, taskB, taskC], 'Chain');

    // All should be scheduled
    expect(isScheduled(taskA)).toBe(true);
    expect(isScheduled(taskB)).toBe(true);
    expect(isScheduled(taskC)).toBe(true);

    // Capture A and C state
    const aStart = taskA.scheduled!.startW;
    const aEnd = taskA.scheduled!.endW;
    const cStart = taskC.scheduled!.startW;
    const cEnd = taskC.scheduled!.endW;

    // Unschedule B (middle)
    landscape.unscheduleTask('TASK-B', true);

    expect(taskB.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(taskB.scheduled).toBeNull();

    // A and C should remain scheduled with same times
    expect(taskA.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(taskA.scheduled!.startW).toBe(aStart);
    expect(taskA.scheduled!.endW).toBe(aEnd);

    expect(taskC.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(taskC.scheduled!.startW).toBe(cStart);
    expect(taskC.scheduled!.endW).toBe(cEnd);
  });

  // ── Test 9: Cannot unschedule an unscheduled task ───────────

  it('returns false when unscheduling a NOT_SCHEDULED task', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    // Do NOT solve — task is NOT_SCHEDULED
    expect(taskA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);

    const result = landscape.unscheduleTask('TASK-A', true);

    expect(result).toBe(false);
    expect(taskA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
  });

  it('returns false for nonexistent task key', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const result = landscape.unscheduleTask('DOES-NOT-EXIST', true);
    expect(result).toBe(false);
  });

  // ── Test 10: resetScore = false preserves score ─────────────

  it('preserves score when resetScore = false', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    solveAll(landscape, [taskA]);

    const scoreBeforeUnschedule = taskA.score;
    expect(scoreBeforeUnschedule).not.toBe(Number.MAX_VALUE);

    landscape.unscheduleTask('TASK-A', false);

    expect(taskA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(taskA.scheduled).toBeNull();
    // Score should be preserved
    expect(taskA.score).toBe(scoreBeforeUnschedule);
  });

  // ── Test 11: resetScore = true resets score to MAX_VALUE ────

  it('resets score to MAX_VALUE when resetScore = true', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    solveAll(landscape, [taskA]);

    expect(taskA.score).not.toBe(Number.MAX_VALUE);

    landscape.unscheduleTask('TASK-A', true);

    expect(taskA.score).toBe(Number.MAX_VALUE);
  });

  // ── Test 12: Availability accounting — total hours balance ──

  it('maintains availability accounting balance through incremental unschedules', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const totalAvail = getTotalAvailable(cnc01);
    expect(totalAvail).toBeGreaterThan(0);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    const taskB = makeTask('Task B', 'TASK-B', 3 * ONE_HOUR, horizon);
    addPreference(taskB, 'CNC-01');
    landscape.tasks.addEntity(taskB);

    const taskC = makeTask('Task C', 'TASK-C', 1 * ONE_HOUR, horizon);
    addPreference(taskC, 'CNC-01');
    landscape.tasks.addEntity(taskC);

    // Solve all 3
    solveAll(landscape, [taskA, taskB, taskC]);

    const assignedAll = getTotalAssigned(cnc01);
    expect(assignedAll).toBeGreaterThan(0);
    expect(getNetAvailable(cnc01)).toBe(totalAvail - assignedAll);

    // Unschedule B (3h)
    const assignedB = taskB.scheduled!.endW - taskB.scheduled!.startW;
    landscape.unscheduleTask('TASK-B', true);

    const assignedAfterB = getTotalAssigned(cnc01);
    expect(assignedAfterB).toBe(assignedAll - assignedB);
    expect(getNetAvailable(cnc01)).toBe(totalAvail - assignedAfterB);

    // Unschedule A (2h)
    const assignedA = taskA.scheduled!.endW - taskA.scheduled!.startW;
    landscape.unscheduleTask('TASK-A', true);

    const assignedAfterA = getTotalAssigned(cnc01);
    expect(assignedAfterA).toBe(assignedAfterB - assignedA);
    expect(getNetAvailable(cnc01)).toBe(totalAvail - assignedAfterA);

    // Unschedule C (1h)
    landscape.unscheduleTask('TASK-C', true);

    expect(getTotalAssigned(cnc01)).toBe(0);
    expect(getNetAvailable(cnc01)).toBe(totalAvail);
  });

  // ── Test: Pinned task cannot be unscheduled ─────────────────

  it('returns false for a pinned task', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc01 = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc01);

    const taskA = makeTask('Task A', 'TASK-A', 2 * ONE_HOUR, horizon);
    addPreference(taskA, 'CNC-01');
    landscape.tasks.addEntity(taskA);

    solveAll(landscape, [taskA]);

    taskA.pinned = true;

    const result = landscape.unscheduleTask('TASK-A', true);

    expect(result).toBe(false);
    expect(taskA.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(taskA.scheduled).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// BaseScheduler.unschedule — cascade sweep for route-defined SETUP/TEARDOWN
// ═══════════════════════════════════════════════════════════════

function makeTypedTask(
  type: string,
  name: string,
  key: string,
  durationSec: number,
  horizon: CTPHorizon,
): CTPTask {
  const task = new CTPTask(type, name, key);
  task.duration = new CTPDuration(durationSec, 1.0);
  task.window = new CTPInterval(horizon.startW, horizon.endW);
  task.capacityResources = new CTPTaskResourceList();
  task.capacityResources.add(new CTPTaskResource('Machine', true));
  return task;
}

function makeScheduler(landscape: SchedulingLandscape): CTPScheduler {
  const scoring = new CTPScoring('test', 'test');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
  const settings = new CTPAppSettings();
  settings.scheduleDirection = CTPScheduleDirectionConstants.FORWARD;
  settings.solverStrategy = 'Greedy';

  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    landscape.horizon,
    landscape.tasks,
    landscape.resources,
    landscape.stateChanges,
    landscape.processes,
  );
  scheduler.initScoring(scoring);
  scheduler.initSettings(settings);
  return scheduler;
}

function scheduleList(scheduler: CTPScheduler, tasks: CTPTask[]): void {
  const list = new List<CTPTask>();
  for (const t of tasks) list.add(t);
  scheduler.schedule(list);
}

function unscheduleList(scheduler: CTPScheduler, tasks: CTPTask[]): void {
  const list = new List<CTPTask>();
  for (const t of tasks) list.add(t);
  scheduler.unschedule(list);
}

describe('BaseScheduler.unschedule — route-defined SETUP/TEARDOWN cascade sweep', () => {

  // ── Scenario 1: single process with own setup/teardown ───────

  it('removes setup and teardown when the only process in the chain is unscheduled', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const setup = makeTypedTask('SETUP', 'WO-001 Setup', 'SETUP-WO001', ONE_HOUR, horizon);
    setup.linkId = new CTPLinkId('WO-001', 'SETUP', '');
    addPreference(setup, 'CNC-01');
    landscape.tasks.addEntity(setup);

    const proc = makeTypedTask('PROCESS', 'WO-001 Process', 'PROC-WO001', 2 * ONE_HOUR, horizon);
    proc.linkId = new CTPLinkId('WO-001', 'PROCESS', 'SETUP-WO001');
    addPreference(proc, 'CNC-01');
    landscape.tasks.addEntity(proc);

    const teardown = makeTypedTask('TEARDOWN', 'WO-001 Teardown', 'TEAR-WO001', ONE_HOUR, horizon);
    teardown.linkId = new CTPLinkId('WO-001', 'TEARDOWN', 'PROC-WO001');
    addPreference(teardown, 'CNC-01');
    landscape.tasks.addEntity(teardown);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [setup, proc, teardown]);

    expect(setup.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(proc.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.SCHEDULED);

    // Unschedule only the process — sweep must cascade to setup + teardown
    unscheduleList(scheduler, [proc]);

    expect(proc.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(setup.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
  });

  // ── Scenario 2: process with no route setup/teardown — no-op ─

  it('is a no-op when the chain has no route-defined setup or teardown', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const proc = makeTypedTask('PROCESS', 'WO-001 Process', 'PROC-WO001', 2 * ONE_HOUR, horizon);
    proc.linkId = new CTPLinkId('WO-001', 'PROCESS', '');
    addPreference(proc, 'CNC-01');
    landscape.tasks.addEntity(proc);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [proc]);

    expect(proc.state).toBe(CTPTaskStateConstants.SCHEDULED);

    unscheduleList(scheduler, [proc]);

    expect(proc.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    // No crash, no orphan cleanup needed — landscape is clean
  });

  // ── Scenario 3: 3 separate chains, all processes unscheduled ─

  it('sweeps all three chains independently when processes from three chains are unscheduled', () => {
    const { horizon } = makeHorizon(21);
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon, 21);
    landscape.resources.addEntity(cnc);

    const chains = ['WO-001', 'WO-002', 'WO-003'];
    const procs: CTPTask[] = [];
    const setups: CTPTask[] = [];
    const tears: CTPTask[] = [];

    for (const wo of chains) {
      const s = makeTypedTask('SETUP', `${wo} Setup`, `SETUP-${wo}`, ONE_HOUR, horizon);
      s.linkId = new CTPLinkId(wo, 'SETUP', '');
      addPreference(s, 'CNC-01');
      landscape.tasks.addEntity(s);
      setups.push(s);

      const p = makeTypedTask('PROCESS', `${wo} Process`, `PROC-${wo}`, 2 * ONE_HOUR, horizon);
      p.linkId = new CTPLinkId(wo, 'PROCESS', `SETUP-${wo}`);
      addPreference(p, 'CNC-01');
      landscape.tasks.addEntity(p);
      procs.push(p);

      const t = makeTypedTask('TEARDOWN', `${wo} Teardown`, `TEAR-${wo}`, ONE_HOUR, horizon);
      t.linkId = new CTPLinkId(wo, 'TEARDOWN', `PROC-${wo}`);
      addPreference(t, 'CNC-01');
      landscape.tasks.addEntity(t);
      tears.push(t);
    }

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [...setups, ...procs, ...tears]);

    for (const p of procs) expect(p.state).toBe(CTPTaskStateConstants.SCHEDULED);

    // Unschedule all 3 processes in one call
    unscheduleList(scheduler, procs);

    for (const p of procs) expect(p.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    for (const s of setups) expect(s.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    for (const t of tears) expect(t.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
  });

  // ── Scenario 4: shared setup, unschedule 1 of 3 — sweep leaves setup ─

  it('leaves setup/teardown when the chain still has scheduled process tasks', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const setup = makeTypedTask('SETUP', 'WO-001 Setup', 'SETUP-WO001', ONE_HOUR, horizon);
    setup.linkId = new CTPLinkId('WO-001', 'SETUP', '');
    addPreference(setup, 'CNC-01');
    landscape.tasks.addEntity(setup);

    const procA = makeTypedTask('PROCESS', 'WO-001 Proc A', 'PROC-A', 2 * ONE_HOUR, horizon);
    procA.linkId = new CTPLinkId('WO-001', 'PROCESS', 'SETUP-WO001');
    addPreference(procA, 'CNC-01');
    landscape.tasks.addEntity(procA);

    const procB = makeTypedTask('PROCESS', 'WO-001 Proc B', 'PROC-B', 2 * ONE_HOUR, horizon);
    procB.linkId = new CTPLinkId('WO-001', 'PROCESS', 'PROC-A');
    addPreference(procB, 'CNC-01');
    landscape.tasks.addEntity(procB);

    const procC = makeTypedTask('PROCESS', 'WO-001 Proc C', 'PROC-C', 2 * ONE_HOUR, horizon);
    procC.linkId = new CTPLinkId('WO-001', 'PROCESS', 'PROC-B');
    addPreference(procC, 'CNC-01');
    landscape.tasks.addEntity(procC);

    const teardown = makeTypedTask('TEARDOWN', 'WO-001 Teardown', 'TEAR-WO001', ONE_HOUR, horizon);
    teardown.linkId = new CTPLinkId('WO-001', 'TEARDOWN', 'PROC-C');
    addPreference(teardown, 'CNC-01');
    landscape.tasks.addEntity(teardown);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [setup, procA, procB, procC, teardown]);

    // Unschedule only procA — chain still has procB and procC scheduled
    unscheduleList(scheduler, [procA]);

    expect(procA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(procB.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(procC.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(setup.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.SCHEDULED);
  });

  // ── Scenario 5: shared setup, unschedule all 3 in one call ───

  it('removes shared setup/teardown when all processes in the chain are unscheduled in one call', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const setup = makeTypedTask('SETUP', 'WO-001 Setup', 'SETUP-WO001', ONE_HOUR, horizon);
    setup.linkId = new CTPLinkId('WO-001', 'SETUP', '');
    addPreference(setup, 'CNC-01');
    landscape.tasks.addEntity(setup);

    const procA = makeTypedTask('PROCESS', 'WO-001 Proc A', 'PROC-A', 2 * ONE_HOUR, horizon);
    procA.linkId = new CTPLinkId('WO-001', 'PROCESS', 'SETUP-WO001');
    addPreference(procA, 'CNC-01');
    landscape.tasks.addEntity(procA);

    const procB = makeTypedTask('PROCESS', 'WO-001 Proc B', 'PROC-B', 2 * ONE_HOUR, horizon);
    procB.linkId = new CTPLinkId('WO-001', 'PROCESS', 'PROC-A');
    addPreference(procB, 'CNC-01');
    landscape.tasks.addEntity(procB);

    const procC = makeTypedTask('PROCESS', 'WO-001 Proc C', 'PROC-C', 2 * ONE_HOUR, horizon);
    procC.linkId = new CTPLinkId('WO-001', 'PROCESS', 'PROC-B');
    addPreference(procC, 'CNC-01');
    landscape.tasks.addEntity(procC);

    const teardown = makeTypedTask('TEARDOWN', 'WO-001 Teardown', 'TEAR-WO001', ONE_HOUR, horizon);
    teardown.linkId = new CTPLinkId('WO-001', 'TEARDOWN', 'PROC-C');
    addPreference(teardown, 'CNC-01');
    landscape.tasks.addEntity(teardown);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [setup, procA, procB, procC, teardown]);

    // Unschedule all 3 processes in a single call — post-loop sweep fires once
    unscheduleList(scheduler, [procA, procB, procC]);

    expect(procA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(procB.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(procC.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(setup.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
  });

  // ── Scenario 6: shared setup, unschedule 2 of 3 ─────────────

  it('leaves setup/teardown when one of three processes remains scheduled', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const setup = makeTypedTask('SETUP', 'WO-001 Setup', 'SETUP-WO001', ONE_HOUR, horizon);
    setup.linkId = new CTPLinkId('WO-001', 'SETUP', '');
    addPreference(setup, 'CNC-01');
    landscape.tasks.addEntity(setup);

    const procA = makeTypedTask('PROCESS', 'WO-001 Proc A', 'PROC-A', 2 * ONE_HOUR, horizon);
    procA.linkId = new CTPLinkId('WO-001', 'PROCESS', 'SETUP-WO001');
    addPreference(procA, 'CNC-01');
    landscape.tasks.addEntity(procA);

    const procB = makeTypedTask('PROCESS', 'WO-001 Proc B', 'PROC-B', 2 * ONE_HOUR, horizon);
    procB.linkId = new CTPLinkId('WO-001', 'PROCESS', 'PROC-A');
    addPreference(procB, 'CNC-01');
    landscape.tasks.addEntity(procB);

    const procC = makeTypedTask('PROCESS', 'WO-001 Proc C', 'PROC-C', 2 * ONE_HOUR, horizon);
    procC.linkId = new CTPLinkId('WO-001', 'PROCESS', 'PROC-B');
    addPreference(procC, 'CNC-01');
    landscape.tasks.addEntity(procC);

    const teardown = makeTypedTask('TEARDOWN', 'WO-001 Teardown', 'TEAR-WO001', ONE_HOUR, horizon);
    teardown.linkId = new CTPLinkId('WO-001', 'TEARDOWN', 'PROC-C');
    addPreference(teardown, 'CNC-01');
    landscape.tasks.addEntity(teardown);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [setup, procA, procB, procC, teardown]);

    // Unschedule A and B — procC still scheduled, so sweep leaves setup/teardown
    unscheduleList(scheduler, [procA, procB]);

    expect(procA.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(procB.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(procC.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(setup.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.SCHEDULED);
  });

  // ── Scenario 7: task with no linkId — not swept ──────────────

  it('unschedules tasks with no linkId without triggering the sweep', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const standalone = makeTask('Standalone', 'SA', 2 * ONE_HOUR, horizon);
    // no linkId set
    addPreference(standalone, 'CNC-01');
    landscape.tasks.addEntity(standalone);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [standalone]);

    expect(standalone.state).toBe(CTPTaskStateConstants.SCHEDULED);

    unscheduleList(scheduler, [standalone]);

    expect(standalone.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
  });

  // ── Scenario 8: pinned setup/teardown survives the sweep ─────

  it('does not remove a pinned setup or teardown even when the chain has no scheduled process', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const setup = makeTypedTask('SETUP', 'WO-001 Setup', 'SETUP-WO001', ONE_HOUR, horizon);
    setup.linkId = new CTPLinkId('WO-001', 'SETUP', '');
    addPreference(setup, 'CNC-01');
    landscape.tasks.addEntity(setup);

    const proc = makeTypedTask('PROCESS', 'WO-001 Process', 'PROC-WO001', 2 * ONE_HOUR, horizon);
    proc.linkId = new CTPLinkId('WO-001', 'PROCESS', 'SETUP-WO001');
    addPreference(proc, 'CNC-01');
    landscape.tasks.addEntity(proc);

    const teardown = makeTypedTask('TEARDOWN', 'WO-001 Teardown', 'TEAR-WO001', ONE_HOUR, horizon);
    teardown.linkId = new CTPLinkId('WO-001', 'TEARDOWN', 'PROC-WO001');
    addPreference(teardown, 'CNC-01');
    landscape.tasks.addEntity(teardown);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [setup, proc, teardown]);

    // Pin the setup before unscheduling
    setup.pinned = true;

    unscheduleList(scheduler, [proc]);

    // Process and teardown should be unscheduled
    expect(proc.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    // Pinned setup must survive
    expect(setup.state).toBe(CTPTaskStateConstants.SCHEDULED);
  });

  // ── Scenario 9: landscape is consistent after sweep for re-solve ─

  it('produces a consistent landscape after cascade so a subsequent solve succeeds', () => {
    const { horizon } = makeHorizon();
    const landscape = buildLandscape(horizon);

    const cnc = makeResource('CNC-01', 'CNC-01', horizon);
    landscape.resources.addEntity(cnc);

    const setup = makeTypedTask('SETUP', 'WO-001 Setup', 'SETUP-WO001', ONE_HOUR, horizon);
    setup.linkId = new CTPLinkId('WO-001', 'SETUP', '');
    addPreference(setup, 'CNC-01');
    landscape.tasks.addEntity(setup);

    const proc = makeTypedTask('PROCESS', 'WO-001 Process', 'PROC-WO001', 2 * ONE_HOUR, horizon);
    proc.linkId = new CTPLinkId('WO-001', 'PROCESS', 'SETUP-WO001');
    addPreference(proc, 'CNC-01');
    landscape.tasks.addEntity(proc);

    const teardown = makeTypedTask('TEARDOWN', 'WO-001 Teardown', 'TEAR-WO001', ONE_HOUR, horizon);
    teardown.linkId = new CTPLinkId('WO-001', 'TEARDOWN', 'PROC-WO001');
    addPreference(teardown, 'CNC-01');
    landscape.tasks.addEntity(teardown);

    const scheduler = makeScheduler(landscape);
    scheduleList(scheduler, [setup, proc, teardown]);

    // Cascade unschedule
    unscheduleList(scheduler, [proc]);

    expect(proc.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(setup.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);

    // Re-solve all three — should succeed without errors
    scheduleList(scheduler, [setup, proc, teardown]);

    expect(setup.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(proc.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(teardown.state).toBe(CTPTaskStateConstants.SCHEDULED);
  });
});
