import { describe, it, expect, beforeEach } from 'vitest';
import { ScheduleEvaluator, WhereToResult } from '../../Solvers/evaluator';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPTask, CTPTasks, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPDuration, CTPInterval, CTPRunRate } from '../../Models/Core/window';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPDateTime } from '../../Models/Core/date';
import { CTPAvailable } from '../../Models/Intervals/intervals';
import { CTPResourceConstants, CTPTaskStateConstants } from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses } from '../../Models/Entities/process';
import { CTPResourceSlots } from '../../Models/Entities/slot';
import { ScheduleContext } from '../../Models/Entities/schedulecontext';
import { DateTime } from 'luxon';

/**
 * Build deterministic 8-hour availability (08:00-16:00) each day.
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

function createTestFixture(opts?: {
  numResources?: number;
  topResources?: number;
}) {
  const numResources = opts?.numResources ?? 2;
  const topResources = opts?.topResources ?? numResources;
  const days = 7;

  // Create horizon: 1 week
  const sDate = DateTime.fromObject({ year: 2025, month: 5, day: 12, hour: 0, minute: 0, second: 0 });
  const eDate = sDate.plus({ days });
  const horizon = new CTPHorizon(sDate, eDate);

  // Create resources with 8h/day availability
  const resources: CTPResource[] = [];
  for (let i = 0; i < numResources; i++) {
    const res = new CTPResource(CTPResourceConstants.REUSABLE, 'CNC', `CNC Mill 0${i + 1}`, `CNC-0${i + 1}`);
    res.hierarchy.first = 'CNC';
    res.original = buildDeterministicAvail(horizon, days);
    resources.push(res);
  }

  // Create scoring: EarliestStart 30%, WhiteSpace 70%
  const scoring = new CTPScoring('WhiteSpace', 'WhiteSpace');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 0.3));
  scoring.addConfig(new CTPScoringConfiguration('WhiteSpaceScoringRule', 0.7));

  // Build landscape
  const ctpResources = new CTPResources();
  ctpResources.fromArray(resources);
  const ctpTasks = new CTPTasks();

  const landscape = new SchedulingLandscape();
  landscape.horizon = horizon;
  landscape.resources = ctpResources;
  landscape.tasks = ctpTasks;
  landscape.stateChanges = new CTPStateChanges();
  landscape.processes = new CTPProcesses();

  // Mark resources for recompute
  landscape.resources.forEach(r => r.recompute = true);

  // Helper: create a task linked to resources
  function createTask(
    key: string,
    name: string,
    durationSecs: number,
    resourceCount?: number,
  ): CTPTask {
    const task = new CTPTask('PROCESS', name, key);
    task.duration = new CTPDuration(durationSecs, 1.0);
    task.window = new CTPInterval(horizon.startW, horizon.endW);
    task.capacityResources = new CTPTaskResourceList();
    task.capacityResources.add(new CTPTaskResource('CNC', true));

    // Set resource preferences
    const taskRes = task.capacityResources.at(0)!;
    let prefCount = 0;
    for (const res of resources) {
      if (prefCount < (resourceCount ?? topResources)) {
        taskRes.preferences.push(new CTPResourcePreference(res.key, 1));
        prefCount++;
      }
    }

    landscape.tasks.addEntity(task);
    return task;
  }

  return { landscape, resources, scoring, horizon, createTask };
}

describe('ScheduleEvaluator', () => {
  let evaluator: ScheduleEvaluator;

  beforeEach(() => {
    evaluator = new ScheduleEvaluator();
  });

  describe('whereTo', () => {
    it('should return feasible options for a simple task', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600); // 4 hours

      const result = evaluator.whereTo(task, landscape, scoring);

      expect(result.taskKey).toBe('OP-001');
      expect(result.options.length).toBeGreaterThan(0);
      expect(result.stats.feasibleCount).toBeGreaterThan(0);
      expect(result.stats.timeMs).toBeGreaterThanOrEqual(0);

      // Options should be ranked starting from 1
      expect(result.options[0].rank).toBe(1);

      // Each option should have valid data
      result.options.forEach(opt => {
        expect(opt.startTime).toBeLessThan(opt.endTime);
        expect(opt.duration).toBeGreaterThan(0);
        expect(opt.resources.length).toBeGreaterThan(0);
        expect(opt.contextHash).toBeTruthy();
      });
    });

    it('should not mutate the landscape', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      // Snapshot state before
      const resourceCountBefore = landscape.resources.size();
      const taskCountBefore = landscape.tasks.size();
      const taskStateBefore = task.state;
      const taskScheduledBefore = task.scheduled?.startW;

      evaluator.whereTo(task, landscape, scoring);

      // Verify nothing structural changed
      expect(landscape.resources.size()).toBe(resourceCountBefore);
      expect(landscape.tasks.size()).toBe(taskCountBefore);
      expect(task.state).toBe(taskStateBefore);
      expect(task.scheduled?.startW).toBe(taskScheduledBefore);
    });

    it('should return same results on repeated calls (idempotent)', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      const result1 = evaluator.whereTo(task, landscape, scoring);
      const result2 = evaluator.whereTo(task, landscape, scoring);

      expect(result1.options.length).toBe(result2.options.length);
      for (let i = 0; i < result1.options.length; i++) {
        expect(result1.options[i].contextHash).toBe(result2.options[i].contextHash);
        expect(result1.options[i].startTime).toBe(result2.options[i].startTime);
        expect(result1.options[i].score).toBe(result2.options[i].score);
      }
    });

    it('should respect onlyResources constraint', () => {
      const { landscape, scoring, createTask } = createTestFixture({ numResources: 2 });
      const task = createTask('OP-001', 'Op 10', 4 * 3600, 2); // linked to both CNC-01 and CNC-02

      const result = evaluator.whereTo(task, landscape, scoring, {
        onlyResources: ['CNC-02'],
      });

      // All options should only use CNC-02
      result.options.forEach(opt => {
        const resourceKeys = opt.resources.map(r => r.resourceKey);
        expect(resourceKeys).toContain('CNC-02');
        expect(resourceKeys).not.toContain('CNC-01');
      });
    });

    it('should respect startAfter constraint', () => {
      const { landscape, scoring, horizon, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      // Start after day 3 (May 14)
      const startAfterDate = DateTime.fromObject({ year: 2025, month: 5, day: 14, hour: 0 });
      const startAfter = CTPDateTime.fromDateTime(startAfterDate);

      const result = evaluator.whereTo(task, landscape, scoring, { startAfter });

      result.options.forEach(opt => {
        expect(opt.startTime).toBeGreaterThanOrEqual(startAfter);
      });
    });

    it('should respect startBefore constraint', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      // Start before end of day 2 (May 13 17:00)
      const startBeforeDate = DateTime.fromObject({ year: 2025, month: 5, day: 13, hour: 17 });
      const startBefore = CTPDateTime.fromDateTime(startBeforeDate);

      const result = evaluator.whereTo(task, landscape, scoring, { startBefore });

      result.options.forEach(opt => {
        expect(opt.startTime).toBeLessThanOrEqual(startBefore);
      });
    });

    it('should respect maxResults constraint', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      const result = evaluator.whereTo(task, landscape, scoring, { maxResults: 3 });

      expect(result.options.length).toBeLessThanOrEqual(3);
    });

    it('should return empty options for infeasible task', () => {
      const { landscape, scoring, createTask } = createTestFixture({ numResources: 1 });
      // Task needs 100 hours but only 8 hours/day × 7 days = 56 hours available
      const task = createTask('OP-001', 'Op 10', 100 * 3600, 1);

      const result = evaluator.whereTo(task, landscape, scoring);

      expect(result.options.length).toBe(0);
      expect(result.stats.infeasibleCount).toBeGreaterThan(0);
    });

    it('should capture current assignment if task is scheduled', () => {
      const { landscape, scoring, horizon, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      // Simulate the task being already scheduled
      const startDate = DateTime.fromObject({ year: 2025, month: 5, day: 12, hour: 8 });
      const endDate = DateTime.fromObject({ year: 2025, month: 5, day: 12, hour: 12 });
      task.scheduled = new CTPInterval();
      task.scheduled.startW = CTPDateTime.fromDateTime(startDate);
      task.scheduled.endW = CTPDateTime.fromDateTime(endDate);
      task.state = CTPTaskStateConstants.SCHEDULED;
      task.capacityResources!.at(0)!.scheduledResource = 'CNC-01';

      const result = evaluator.whereTo(task, landscape, scoring);

      expect(result.currentAssignment).not.toBeNull();
      expect(result.currentAssignment!.resources).toContain('CNC-01');
      expect(result.currentAssignment!.start).toBeGreaterThan(0);
    });

    it('should return options sorted by score', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      const result = evaluator.whereTo(task, landscape, scoring);

      // Verify ascending sort
      for (let i = 1; i < result.options.length; i++) {
        expect(result.options[i].score).toBeGreaterThanOrEqual(result.options[i - 1].score);
      }
    });

    it('should return options with sequential ranks', () => {
      const { landscape, scoring, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      const result = evaluator.whereTo(task, landscape, scoring);

      result.options.forEach((opt, i) => {
        expect(opt.rank).toBe(i + 1);
      });
    });
  });

  describe('buildContexts', () => {
    it('should build contexts for a task with one resource requirement', () => {
      const { landscape, createTask } = createTestFixture({ numResources: 2 });
      const task = createTask('OP-001', 'Op 10', 4 * 3600, 2);

      const contexts = evaluator.buildContexts(task, landscape);

      // Task linked to 2 resources with 1 capacity requirement → 2 contexts
      expect(contexts.length).toBe(2);
      contexts.forEach(ctx => {
        expect(ctx.task.key).toBe('OP-001');
        expect(ctx.slot.resources).not.toBeNull();
      });
    });

    it('should not modify the landscape when building contexts', () => {
      const { landscape, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      const before = {
        resources: landscape.resources.size(),
        tasks: landscape.tasks.size(),
      };

      evaluator.buildContexts(task, landscape);

      expect(landscape.resources.size()).toBe(before.resources);
      expect(landscape.tasks.size()).toBe(before.tasks);
    });
  });

  describe('checkChangeover', () => {
    it('should return null when no state changes configured', () => {
      const { landscape, createTask } = createTestFixture();
      const task = createTask('OP-001', 'Op 10', 4 * 3600);

      // Create a minimal context
      const ctx = new ScheduleContext(landscape, task, new CTPResourceSlots());

      const result = evaluator.checkChangeover(task, ctx, landscape);

      expect(result).toBeNull();
    });
  });
});
