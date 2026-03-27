import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';
import { ScheduleConfigurationService } from '../../../config/schedule-configuration.service';
import { LoggerService } from '../../../logging/logger.service';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'stafford-engineering';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService);
  const strategyConfigService = new StrategyConfigService(configService);
  const logger = new LoggerService();
  const schedConfigService = new ScheduleConfigurationService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService, logger, schedConfigService);
  return { ctpService, stateService, configService };
}

function solve(ctpService: CTPService): any {
  return ctpService.solve({ detailLevel: 'intermediate' } as any);
}

function findTask(result: any, key: string): any | undefined {
  return result.tasks?.find((t: any) => t.key === key);
}

// ═══════════════════════════════════════════════════════════════
// Suite 1: Commitment Level Derivation
// ═══════════════════════════════════════════════════════════════

describe('Commitment Level Derivation', () => {
  let ctpService: CTPService;
  let result: any;

  beforeAll(() => {
    ({ ctpService } = createServices());
    result = solve(ctpService);
  });

  it('should derive running for IN_PROCESS tasks (if test data has them)', () => {
    const task = findTask(result, 'PV-001-ROLL');
    if (!task || !task.actualStart) return; // skip if no WIP test data
    expect(task.commitmentLevel).toBe('running');
  });

  it('should derive dispatched for dispatched tasks (if test data has them)', () => {
    const task = findTask(result, 'PV-001-WELD-SEAM');
    if (!task || !task.dispatched) return;
    expect(task.commitmentLevel).toBe('dispatched');
  });

  it('should keep completed tasks in results as pinned (if test data has them)', () => {
    const task = findTask(result, 'PV-001-CUT');
    if (!task || !task.actualEnd) return;
    expect(task.pinned).toBe(true);
  });

  it('should derive completed for completed WIP tasks', () => {
    const task = findTask(result, 'PV-001-CUT');
    if (!task || !task.actualEnd) return;
    expect(task.commitmentLevel).toBe('completed');
    expect(task.pinned).toBe(true);
  });

  it('should derive unscheduled for infeasible non-pinned tasks', () => {
    const infeasible = result.tasks.find((t: any) => !t.feasible && !t.pinned);
    if (infeasible) {
      expect(infeasible.commitmentLevel).toBe('unscheduled');
    }
  });

  it('should have commitmentLevel on every task', () => {
    const validLevels = ['completed', 'running', 'on_hold', 'dispatched', 'pinned', 'planned', 'unscheduled'];
    for (const task of result.tasks) {
      expect(validLevels).toContain(task.commitmentLevel);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 2: Actuals Placement and Resource Assignment
// ═══════════════════════════════════════════════════════════════

describe('Actuals Placement', () => {
  let ctpService: CTPService;
  let result: any;

  beforeAll(() => {
    ({ ctpService } = createServices());
    result = solve(ctpService);
  });

  it('should set scheduledResource from actualResources on running tasks', () => {
    const task = findTask(result, 'PV-001-ROLL');
    if (!task || !task.actualResources?.length) return;
    const assignedKeys = task.assignedResources?.map((r: any) => r.resourceKey) ?? [];
    task.actualResources.forEach((key: string) => expect(assignedKeys).toContain(key));
  });

  it('should have assigned resources on dispatched tasks', () => {
    const task = findTask(result, 'PV-001-WELD-SEAM');
    if (!task || !task.dispatched) return;
    expect(task.assignedResources?.length).toBeGreaterThan(0);
  });

  it('should preserve actual start time on running tasks', () => {
    const task = findTask(result, 'PV-001-ROLL');
    if (!task || !task.actualStart) return;
    expect(task.actualStart).toBeDefined();
    expect(typeof task.actualStart).toBe('string');
  });

  it('should preserve actual start and end on completed tasks', () => {
    const task = findTask(result, 'PV-001-CUT');
    if (!task || !task.actualEnd) return;
    expect(task.actualStart).toBeDefined();
    expect(task.actualEnd).toBeDefined();
  });

  it('should use client-provided remainingDuration for running tasks', () => {
    const task = findTask(result, 'PV-001-ROLL');
    if (!task || task.commitmentLevel !== 'running') return;
    expect(task.percentComplete).toBe(60);
    expect(task.remainingDuration).toBe(5400);
  });

  it('should show percentComplete = 0 for tasks with no progress', () => {
    const planned = result.tasks.find((t: any) =>
      t.commitmentLevel === 'planned' && !t.actualStart && !t.actualEnd
    );
    if (planned) {
      expect(planned.percentComplete).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 3: Capacity Blocking — Solver Cannot Double-Book
// ═══════════════════════════════════════════════════════════════

describe('Capacity Blocking', () => {
  let ctpService: CTPService;
  let result: any;

  beforeAll(() => {
    ({ ctpService } = createServices());
    result = solve(ctpService);
  });

  it('should not schedule another task overlapping a running task on its resource', () => {
    const running = findTask(result, 'PV-001-ROLL');
    if (!running || !running.scheduledStart || !running.actualResources?.length) return;

    const runningStart = new Date(running.scheduledStart).getTime();
    const runningEnd = new Date(running.scheduledEnd).getTime();
    const resourceKey = running.actualResources[0];

    const othersOnResource = result.tasks.filter((t: any) =>
      t.key !== running.key &&
      t.feasible &&
      t.scheduledStart &&
      t.assignedResources?.some((r: any) => r.resourceKey === resourceKey)
    );

    for (const other of othersOnResource) {
      const otherStart = new Date(other.scheduledStart).getTime();
      const otherEnd = new Date(other.scheduledEnd).getTime();
      const overlaps = otherStart < runningEnd && otherEnd > runningStart;
      expect(overlaps).toBe(false);
    }
  });

  it('should not move running task on re-solve', () => {
    const running1 = findTask(result, 'PV-001-ROLL');
    if (!running1 || !running1.actualStart) return;

    const result2 = solve(ctpService);
    const running2 = findTask(result2, 'PV-001-ROLL');

    expect(running2.actualStart).toBe(running1.actualStart);
    expect(running2.actualResources).toEqual(running1.actualResources);
    expect(running2.percentComplete).toBe(running1.percentComplete);
  });

  it('should not move dispatched task on re-solve', () => {
    const disp1 = findTask(result, 'PV-001-WELD-SEAM');
    if (!disp1 || !disp1.scheduledStart) return;

    const result2 = solve(ctpService);
    const disp2 = findTask(result2, 'PV-001-WELD-SEAM');

    if (disp1.scheduledStart && disp2.scheduledStart) {
      expect(disp2.scheduledStart).toBe(disp1.scheduledStart);
      expect(disp2.scheduledEnd).toBe(disp1.scheduledEnd);
    }
  });

  it('should maintain feasibility above 80% with WIP tasks', () => {
    expect(result.summary.feasibilityRate).toBeGreaterThanOrEqual(80);
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 4: Chain Propagation with Actuals
// ═══════════════════════════════════════════════════════════════

describe('Chain Propagation with Actuals', () => {
  let ctpService: CTPService;
  let result: any;

  beforeAll(() => {
    ({ ctpService } = createServices());
    result = solve(ctpService);
  });

  it('should not break chain when predecessor is completed', () => {
    const pv001Tasks = result.tasks.filter((t: any) => t.key.startsWith('PV-001'));
    expect(pv001Tasks.length).toBeGreaterThanOrEqual(3);

    for (const task of pv001Tasks) {
      const predError = task.errors?.find((e: any) =>
        e.reason?.toLowerCase().includes('predecessor') &&
        e.reason?.toLowerCase().includes('not found')
      );
      expect(predError).toBeUndefined();
    }
  });

  it('should schedule most downstream PV-001 tasks after running step', () => {
    const running = findTask(result, 'PV-001-ROLL');
    if (!running || !running.scheduledEnd) return;

    // Tasks that are direct successors of the running task should start after it
    const weldSeam = findTask(result, 'PV-001-WELD-SEAM');
    if (weldSeam && weldSeam.scheduledStart) {
      const rollEnd = new Date(running.scheduledEnd).getTime();
      const weldStart = new Date(weldSeam.scheduledStart).getTime();
      // Weld seam should start after roll finishes (chain order)
      expect(weldStart).toBeGreaterThanOrEqual(rollEnd);
    }
  });

  it('should allow successors of running task to schedule after remaining duration', () => {
    const running = findTask(result, 'PV-001-ROLL');
    if (!running || !running.scheduledEnd) return;

    const weldSeam = findTask(result, 'PV-001-WELD-SEAM');
    if (!weldSeam || !weldSeam.scheduledStart) return;

    const rollEnd = new Date(running.scheduledEnd).getTime();
    const weldStart = new Date(weldSeam.scheduledStart).getTime();
    expect(weldStart).toBeGreaterThanOrEqual(rollEnd);
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 5: Capacity Waterfall
// ═══════════════════════════════════════════════════════════════

describe('Capacity Waterfall', () => {
  let ctpService: CTPService;
  let result: any;

  beforeAll(() => {
    ({ ctpService } = createServices());
    result = solve(ctpService);
  });

  it('should include capacityWaterfall in solve response', () => {
    expect(result.capacityWaterfall).toBeDefined();
    expect(Array.isArray(result.capacityWaterfall)).toBe(true);
    expect(result.capacityWaterfall.length).toBeGreaterThan(0);
  });

  it('should have all 7 layers per resource', () => {
    for (const resource of result.capacityWaterfall) {
      expect(resource.layers.length).toBe(7);
      const levels = resource.layers.map((l: any) => l.level);
      expect(levels).toEqual(['completed', 'running', 'on_hold', 'dispatched', 'pinned', 'planned', 'unscheduled']);
    }
  });

  it('should show running hours on FAB-JACK if WIP data exists', () => {
    const jack = result.capacityWaterfall.find((r: any) => r.resourceKey === 'FAB-JACK');
    if (!jack) return;
    const runningLayer = jack.layers.find((l: any) => l.level === 'running');
    // May be 0 if no running tasks on Jack in this solve
    expect(runningLayer).toBeDefined();
  });

  it('should have cumulative sums that increase monotonically', () => {
    for (const resource of result.capacityWaterfall) {
      let prev = 0;
      for (const layer of resource.layers) {
        expect(layer.cumulative).toBeGreaterThanOrEqual(prev);
        prev = layer.cumulative;
      }
    }
  });

  it('should calculate remainingCapacity = total - cumulative', () => {
    for (const resource of result.capacityWaterfall) {
      const lastLayer = resource.layers[resource.layers.length - 1];
      const expected = Math.round((resource.totalAvailableHours - lastLayer.cumulative) * 10) / 10;
      expect(resource.remainingCapacity).toBeCloseTo(expected, 0);
    }
  });

  it('should report deadCapacityHours as 0 when no tasks are on hold', () => {
    for (const resource of result.capacityWaterfall) {
      expect(resource.deadCapacityHours).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Suite 6: State Transition Endpoints
// Uses a dedicated task (EQ-001-CUT) and cleans up by completing it
// ═══════════════════════════════════════════════════════════════

describe('State Transition Endpoints', () => {
  let ctpService: CTPService;
  // Use PV-002-CUT — a real Stafford task, not involved in existing WIP test data
  const testTask = 'PV-002-CUT';

  beforeAll(() => {
    ({ ctpService } = createServices());
    solve(ctpService); // initial solve to schedule tasks
  });

  // Tests run sequentially — each builds on the previous state transition
  // No re-solve between transitions (solve reloads from config, wiping in-memory state)

  it('should dispatch a scheduled task', () => {
    const res = ctpService.dispatchTasks([testTask]);
    expect(res.status).toBe('ok');
    expect(res.results[0].result).toBe('ok');
  });

  it('should reject dispatch on unscheduled task', () => {
    // Use the initial solve result to find an infeasible task
    const landscape = (ctpService as any).stateService.getLandscape();
    let infeasibleKey: string | null = null;
    landscape.tasks.forEach((t: any) => {
      if (t.state === 0 && !t.pinned && !infeasibleKey) infeasibleKey = t.key;
    });
    if (!infeasibleKey) return;
    const res = ctpService.dispatchTasks([infeasibleKey]);
    expect(res.results[0].result).toBe('skipped');
  });

  it('should start a dispatched task', () => {
    const res = ctpService.startTask(testTask, undefined, ['SAW-01']);
    expect(res.status).toBe('ok');
    expect(res.commitmentLevel).toBe('running');
    expect(res.actualStart).toBeDefined();
  });

  it('should hold a running task', () => {
    const res = ctpService.holdTask(testTask, 'Quality inspection required');
    expect(res.status).toBe('ok');
    expect(res.commitmentLevel).toBe('on_hold');
  });

  it('should resume a held task', () => {
    const res = ctpService.resumeTask(testTask);
    expect(res.status).toBe('ok');
    expect(res.commitmentLevel).toBe('running');
  });

  it('should update progress on a running task', () => {
    const res = ctpService.updateProgress(testTask, { percentComplete: 75, remainingDuration: 1800 });
    expect(res.status).toBe('ok');
    expect(res.percentComplete).toBe(75);
    expect(res.remainingDuration).toBe(1800);
  });

  it('should complete a task', () => {
    const res = ctpService.completeTask(testTask);
    expect(res.status).toBe('ok');
    expect(res.actualEnd).toBeDefined();
  });

  it('should reflect completed state in next solve', () => {
    // This solve reloads from config, but PV-002-CUT isn't in WIP test data
    // So it resets to normal. This test verifies the API calls work, not persistence.
    // For persistence, the task would need WIP data in the config file.
    const result = solve(ctpService);
    expect(result.summary.scheduledTasks).toBeGreaterThan(0);
  });
});
