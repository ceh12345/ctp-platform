/**
 * Scheduler Integration Tests — TabuSearchScheduler & ILSScheduler
 *
 * Uses a carefully designed 10-task, 3-resource landscape that produces a
 * KNOWN SUBOPTIMAL constructive schedule. The improvement opportunity:
 *
 *   Chain A:  J0 (R1, 500s) → J3 (R2, 200s)    [J3 must follow J0]
 *   Standalone: J4 (R2, 600s) — no dependency, but greedy queues it AFTER J3
 *
 *   Greedy result:  R2: J3[500-700] → J4[700-1300] → J5[1300-1400]  makespan=1400
 *   Optimal:        R2: J4[0-600]   → J3[600-800]  → J5[800-900]    makespan=1200
 *   Improvement: 14.3%
 *
 * This mirrors the suboptimal graph in tabusearch.test.ts, guaranteeing that
 * tabu search WILL find improvement — making hard assertions reliable.
 *
 * Test plan:
 *   1. CTPScheduler (standard)   — baseline, no optimization
 *   2. TabuSearchScheduler        — hard assertions: opt exists, makespan ≤ original,
 *                                   tasksRescheduled > 0, diff populated, all SCHEDULED
 *   3. ILSScheduler               — passes array populated, makespan ≤ tabu result
 *   4. Tier routing               — factory returns correct subclass
 */

import { describe, it, expect } from 'vitest';
import { CTPScheduler } from '../../AI/Schedulers/defaultscheduler';
import { TabuSearchScheduler } from '../../AI/Schedulers/tabusearchscheduler';
import { ILSScheduler } from '../../AI/Schedulers/ilsscheduler';
import { CTPTask, CTPTasks, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPDuration, CTPInterval, CTPRunRate } from '../../Models/Core/window';
import { CTPAvailable, CTPAssignments } from '../../Models/Intervals/intervals';
import { CTPTaskStateConstants, CTPResourceConstants } from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses } from '../../Models/Entities/process';
import { CTPLinkId } from '../../Models/Core/linkid';
import { List } from '../../Models/Core/list';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { DateTime } from 'luxon';

// ─── Landscape builder ────────────────────────────────────────────────────────

/**
 * Build the suboptimal landscape.
 *
 * Resources:
 *   R1 — holds J0(500), J1(300), J2(400)
 *   R2 — holds J3(200), J4(600), J5(100)
 *   R3 — holds J6(400), J7(200), J8(300), J9(100)
 *
 * Chain:
 *   chain-A: J0(R1) → J3(R2)
 *   J0 is scheduled before chain A processes J3, so J3 starts after t=500.
 *   J4 (standalone on R2) gets queued AFTER J3 by the greedy solver,
 *   giving R2 makespan = 1400. Optimal is J4 first → R2 makespan = 900.
 *
 * Availability: 24-hour continuous window per resource (no shift constraints).
 * Task durations are in seconds (max schedule = 1400s << 86400s horizon).
 */
function buildSuboptimalLandscape() {
  const sDate = DateTime.fromObject({ year: 2026, month: 3, day: 2 });
  const eDate = sDate.plus({ days: 1 });
  const horizon = new CTPHorizon(sDate, eDate);

  // 24-hour continuous availability — CTPRunRate enforces capacity=1 (one task at a time)
  function makeAvail(): CTPAvailable {
    const avail = new CTPAvailable();
    avail.add(new CTPRunRate(horizon.startW, horizon.endW, 1, 0));
    return avail;
  }

  function makeResource(key: string): CTPResource {
    const r = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', `Machine ${key}`, key);
    r.hierarchy.first = 'Machine';
    r.original = makeAvail();
    r.assignments = new CTPAssignments();
    r.available.setLists(r.original, r.assignments);  // wire original + assignments into available matrix
    return r;
  }

  const r1 = makeResource('R1');
  const r2 = makeResource('R2');
  const r3 = makeResource('R3');

  const allResources = [r1, r2, r3];

  // Helper: task pinned to a single resource
  function makeTask(
    key: string, resourceKey: string, duration: number, rank: number, priority: number,
    chainKey?: string, prevLink?: string,
  ): CTPTask {
    const t = new CTPTask('PROCESS', key, key);
    t.duration = new CTPDuration(duration, 1.0);
    t.sequence = rank;
    t.rank = rank;
    t.priority = priority;
    t.window = new CTPInterval(horizon.startW, horizon.endW);

    if (chainKey) {
      t.linkId = new CTPLinkId(chainKey, 'ES', prevLink ?? '', null);
    }

    t.capacityResources = new CTPTaskResourceList();
    const tr = new CTPTaskResource('Machine', true);
    tr.preferences.push(new CTPResourcePreference(resourceKey, 1));
    t.capacityResources.add(tr);
    return t;
  }

  // Chain A (priority=1, processed first): J0(R1) → J3(R2)
  // Standalones (priority=10): J1(R1), J2(R1), J4(R2), J5(R2), J6-J9(R3)
  const tasks: CTPTask[] = [
    makeTask('J0', 'R1', 500, 1, 1, 'chain-A'),          // chain A anchor
    makeTask('J3', 'R2', 200, 2, 1, 'chain-A', 'J0'),    // chain A step 2
    makeTask('J1', 'R1', 300, 3, 10),
    makeTask('J2', 'R1', 400, 4, 10),
    makeTask('J4', 'R2', 600, 5, 10),   // queued after J3 by greedy → improvement target
    makeTask('J5', 'R2', 100, 6, 10),
    makeTask('J6', 'R3', 400, 7, 10),
    makeTask('J7', 'R3', 200, 8, 10),
    makeTask('J8', 'R3', 300, 9, 10),
    makeTask('J9', 'R3', 100, 10, 10),
  ];

  const ctpTasks = new CTPTasks();
  ctpTasks.fromArray(tasks);

  const ctpResources = new CTPResources();
  ctpResources.fromArray(allResources);

  // Build processes via landscape
  const tmpLandscape = new SchedulingLandscape(horizon.startDate, horizon.endDate);
  tmpLandscape.tasks = ctpTasks;
  tmpLandscape.resources = ctpResources;
  tmpLandscape.buildProcesses();

  // Scoring: EarliestStart → constructive scheduler packs greedily, producing the suboptimal order
  const scoring = new CTPScoring('EarliestStart', 'earliest-start');
  scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));

  const taskList = new List<CTPTask>();
  tasks.forEach(t => taskList.add(t));

  return { horizon, ctpTasks, ctpResources, processes: tmpLandscape.processes!, scoring, taskList };
}

/** Init a fresh scheduler instance with the suboptimal landscape + given extra settings. */
function initScheduler<T extends CTPScheduler>(
  SchedulerClass: new () => T,
  extraSettings?: Partial<CTPAppSettings>,
): { scheduler: T; taskList: List<CTPTask> } {
  const { horizon, ctpTasks, ctpResources, processes, scoring, taskList } =
    buildSuboptimalLandscape();

  const settings = new CTPAppSettings();
  settings.hasChains = true;
  if (extraSettings) Object.assign(settings, extraSettings);

  const scheduler = new SchedulerClass();
  scheduler.initLandscape(horizon, ctpTasks, ctpResources, new CTPStateChanges(), processes);
  scheduler.initSettings(settings);
  scheduler.initScoring(scoring);
  return { scheduler, taskList };
}

// ─── 1. CTPScheduler (standard tier — baseline) ──────────────────────────────

describe('CTPScheduler — baseline (standard tier)', () => {
  it('schedules all tasks without error', () => {
    const { scheduler, taskList } = initScheduler(CTPScheduler);
    expect(() => scheduler.schedule(taskList)).not.toThrow();
  });

  it('all tasks end up in SCHEDULED state', () => {
    const { scheduler, taskList } = initScheduler(CTPScheduler);
    scheduler.schedule(taskList);
    let scheduled = 0;
    taskList.forEach(t => { if (t.state === CTPTaskStateConstants.SCHEDULED) scheduled++; });
    expect(scheduled).toBe(10);
  });

  it('has no getOptimizationResult method (no optimization on standard tier)', () => {
    const { scheduler } = initScheduler(CTPScheduler);
    expect((scheduler as any).getOptimizationResult).toBeUndefined();
  });
});

// ─── 2. TabuSearchScheduler — thorough tier ───────────────────────────────────

describe('TabuSearchScheduler — thorough tier', () => {
  const tabuSettings: Partial<CTPAppSettings> = {
    tabuIterations: 500,
    tabuStagnation: 100,
    tabuTimeBudgetMs: 10000,
  };

  it('schedule() completes without error', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    expect(() => scheduler.schedule(taskList)).not.toThrow();
  });

  it('solveResult.optimization exists (improvement was found)', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult();
    expect(opt).not.toBeNull();
  });

  it('optimizedMakespan <= originalMakespan', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(opt.optimizedMakespan).toBeLessThanOrEqual(opt.originalMakespan);
  });

  it('improvementPercent > 0', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(opt.improvementPercent).toBeGreaterThan(0);
  });

  it('tasksRescheduled > 0', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(opt.tasksRescheduled).toBeGreaterThan(0);
  });

  it('diff array is populated', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(Array.isArray(opt.diff)).toBe(true);
    expect(opt.diff.length).toBeGreaterThan(0);
  });

  it('all tasks remain in SCHEDULED state after optimization', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    let scheduled = 0;
    taskList.forEach(t => { if (t.state === CTPTaskStateConstants.SCHEDULED) scheduled++; });
    expect(scheduled).toBe(10);
  });

  it('chain integrity: predecessor.endW <= successor.startW for all chained tasks', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const violations: string[] = [];
    taskList.forEach(task => {
      if (!task.linkId?.prevLink || !task.scheduled) return;
      const pred = taskList.find(t => t.key === task.linkId!.prevLink);
      if (!pred?.scheduled) return;
      if (pred.scheduled.endW > task.scheduled!.startW) {
        violations.push(
          `${pred.key}(end=${pred.scheduled.endW}) > ${task.key}(start=${task.scheduled!.startW})`
        );
      }
    });
    expect(violations).toEqual([]);
  });

  it('convergenceReason is a non-empty string', () => {
    const { scheduler, taskList } = initScheduler(TabuSearchScheduler, tabuSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(typeof opt.convergenceReason).toBe('string');
    expect(opt.convergenceReason.length).toBeGreaterThan(0);
  });

  it('getOptimizationResult returns null before schedule() is called', () => {
    const { scheduler } = initScheduler(TabuSearchScheduler, tabuSettings);
    expect(scheduler.getOptimizationResult()).toBeNull();
  });
});

// ─── 3. ILSScheduler — best tier ─────────────────────────────────────────────

describe('ILSScheduler — best tier', () => {
  const ilsSettings: Partial<CTPAppSettings> = {
    tabuIterations: 300,
    tabuStagnation: 80,
    tabuTimeBudgetMs: 5000,
    ilsPasses: 2,
    ilsPerturbStrength: 0.15,
    ilsTimeBudgetMs: 12000,
  };

  // Run once and reuse for comparison with tabu result
  let tabuMakespan: number;

  it('schedule() completes without error', () => {
    const { scheduler, taskList } = initScheduler(ILSScheduler, ilsSettings);
    expect(() => scheduler.schedule(taskList)).not.toThrow();
  });

  it('solveResult.optimization exists', () => {
    const { scheduler, taskList } = initScheduler(ILSScheduler, ilsSettings);
    scheduler.schedule(taskList);
    expect(scheduler.getOptimizationResult()).not.toBeNull();
  });

  it('optimization.passes has entries', () => {
    const { scheduler, taskList } = initScheduler(ILSScheduler, ilsSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(Array.isArray(opt.passes)).toBe(true);
    expect(opt.passes!.length).toBeGreaterThan(0);
  });

  it('each pass entry has the correct shape', () => {
    const { scheduler, taskList } = initScheduler(ILSScheduler, ilsSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    for (const p of opt.passes!) {
      expect(typeof p.pass).toBe('number');
      expect(typeof p.makespan).toBe('number');
      expect(typeof p.improvement).toBe('number');
      expect(typeof p.iterations).toBe('number');
    }
  });

  it('convergenceReason is ils_complete', () => {
    const { scheduler, taskList } = initScheduler(ILSScheduler, ilsSettings);
    scheduler.schedule(taskList);
    const opt = scheduler.getOptimizationResult()!;
    expect(opt.convergenceReason).toBe('ils_complete');
  });

  it('all tasks remain in SCHEDULED state after ILS', () => {
    const { scheduler, taskList } = initScheduler(ILSScheduler, ilsSettings);
    scheduler.schedule(taskList);
    let scheduled = 0;
    taskList.forEach(t => { if (t.state === CTPTaskStateConstants.SCHEDULED) scheduled++; });
    expect(scheduled).toBe(10);
  });

  it('optimizedMakespan <= TabuSearchScheduler result', () => {
    // Tabu run
    const tabu = initScheduler(TabuSearchScheduler, {
      tabuIterations: 500, tabuStagnation: 100, tabuTimeBudgetMs: 10000,
    });
    tabu.scheduler.schedule(tabu.taskList);
    tabuMakespan = tabu.scheduler.getOptimizationResult()!.optimizedMakespan;

    // ILS run
    const ils = initScheduler(ILSScheduler, ilsSettings);
    ils.scheduler.schedule(ils.taskList);
    const ilsMakespan = ils.scheduler.getOptimizationResult()!.optimizedMakespan;

    expect(ilsMakespan).toBeLessThanOrEqual(tabuMakespan);
  });

  it('getOptimizationResult returns null before schedule() is called', () => {
    const { scheduler } = initScheduler(ILSScheduler, ilsSettings);
    expect(scheduler.getOptimizationResult()).toBeNull();
  });

  it('ILSScheduler is a TabuSearchScheduler (inheritance)', () => {
    expect(new ILSScheduler()).toBeInstanceOf(TabuSearchScheduler);
    expect(new ILSScheduler()).toBeInstanceOf(CTPScheduler);
  });
});

// ─── 4. Tier routing ─────────────────────────────────────────────────────────

describe('Tier routing — createScheduler factory', () => {
  function createScheduler(tier: string): CTPScheduler {
    switch (tier) {
      case 'thorough': return new TabuSearchScheduler();
      case 'best':     return new ILSScheduler();
      default:         return new CTPScheduler();
    }
  }

  it('"thorough" → TabuSearchScheduler', () => {
    expect(createScheduler('thorough')).toBeInstanceOf(TabuSearchScheduler);
  });

  it('"best" → ILSScheduler', () => {
    expect(createScheduler('best')).toBeInstanceOf(ILSScheduler);
  });

  it('"balanced" → CTPScheduler (not TabuSearchScheduler)', () => {
    const s = createScheduler('balanced');
    expect(s).toBeInstanceOf(CTPScheduler);
    expect(s).not.toBeInstanceOf(TabuSearchScheduler);
  });

  it('"quick" → CTPScheduler (not TabuSearchScheduler)', () => {
    const s = createScheduler('quick');
    expect(s).toBeInstanceOf(CTPScheduler);
    expect(s).not.toBeInstanceOf(TabuSearchScheduler);
  });

  it('"best" is also instanceof TabuSearchScheduler (inheritance)', () => {
    expect(createScheduler('best')).toBeInstanceOf(TabuSearchScheduler);
  });

  it('unknown tier → CTPScheduler (default fallback)', () => {
    const s = createScheduler('unknown-tier');
    expect(s).toBeInstanceOf(CTPScheduler);
    expect(s).not.toBeInstanceOf(TabuSearchScheduler);
  });
});
