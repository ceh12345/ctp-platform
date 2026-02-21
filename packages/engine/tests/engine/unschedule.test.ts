import { describe, it, expect, beforeEach } from 'vitest';
import { CTPScheduler } from '../../AI/Scheduling/defaultscheduler';
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
