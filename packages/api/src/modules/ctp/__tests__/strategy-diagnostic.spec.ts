import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import {
  GreedyNeighborhood,
  ChainNeighborhood,
  DueDateNeighborhood,
  ShortestFirstNeighborhood,
  ChainFirstFitNeighborhood,
  INeighborhoodStrategy,
  CTPScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  List,
  CTPTask,
  CTPTaskStateConstants,
  CTPDateTime,
  CTPSolveResult,
} from '@ctp/engine';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');

interface TaskSnapshot {
  key: string;
  name: string;
  chain: string | null;
  sequence: number;
  solverSequence: number;
  startW: number;
  endW: number;
  startISO: string;
  endISO: string;
  predKey: string | null;
}

interface Violation {
  task: string;
  pred: string;
  chain: string;
  taskStart: string;
  predEnd: string;
  gapMinutes: number; // negative = overlap
}

async function solveManufacturing(strategy: INeighborhoodStrategy, opts?: { hasChains?: boolean }): Promise<{
  result: CTPSolveResult;
  tasks: TaskSnapshot[];
  violations: Violation[];
}> {
  const store = new FileConfigStore(CONFIG_ROOT, 'demo-manufacturing');
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  await stateService.syncFromAdapter();
  const landscape = stateService.getLandscape()!;

  // Override hasChains if requested
  if (opts?.hasChains !== undefined && landscape.appSettings) {
    landscape.appSettings.hasChains = opts.hasChains;
  }

  const scoringConfig = configService.getScoring()!;
  const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
  for (const rule of scoringConfig.rules) {
    const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
    config.includeInSolve = rule.includeInSolve;
    config.penaltyFactor = rule.penaltyFactor;
    scoring.addConfig(config);
  }

  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    landscape.horizon, landscape.tasks, landscape.resources,
    landscape.stateChanges, landscape.processes,
  );
  scheduler.initSettings(landscape.appSettings);
  scheduler.initScoring(scoring);

  // Inject strategy
  (scheduler as any).nextTasksToSchedule = function (
    tasks: List<CTPTask>, numOfTasks: number
  ) {
    if (!(this as any).neighborhoodAgent) {
      (this as any).neighborhoodAgent = (this as any).getNextNeighborhoodAgent();
      (this as any).neighborhoodAgent.setStrategy(strategy);
    }
    return (this as any).neighborhoodAgent.solve(tasks, numOfTasks, (this as any).settings, (this as any).landscape);
  };

  const taskList = new List<CTPTask>();
  landscape.tasks.forEach((t) => taskList.add(t));

  const solveResult = scheduler.schedule(taskList);

  // Collect snapshots
  const tasks: TaskSnapshot[] = [];
  const taskMap = new Map<string, CTPTask>();
  landscape.tasks.forEach((t) => {
    taskMap.set(t.key, t);
    if (t.state === CTPTaskStateConstants.SCHEDULED && t.scheduled) {
      tasks.push({
        key: t.key,
        name: t.name,
        chain: t.linkId?.name ?? null,
        sequence: t.sequence,
        solverSequence: t.solverSequence,
        startW: t.scheduled.startW,
        endW: t.scheduled.endW,
        startISO: CTPDateTime.toDateTime(t.scheduled.startW).toFormat('EEE HH:mm'),
        endISO: CTPDateTime.toDateTime(t.scheduled.endW).toFormat('EEE HH:mm'),
        predKey: t.linkId?.prevLink ?? null,
      });
    }
  });

  // Sort by solver sequence
  tasks.sort((a, b) => a.solverSequence - b.solverSequence);

  // Find violations
  const violations: Violation[] = [];
  landscape.tasks.forEach((task) => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED) return;
    if (!task.linkId?.prevLink) return;
    const pred = taskMap.get(task.linkId.prevLink);
    if (!pred || pred.state !== CTPTaskStateConstants.SCHEDULED) return;
    if (task.scheduled!.startW < pred.scheduled!.endW) {
      const gapSec = task.scheduled!.startW - pred.scheduled!.endW;
      violations.push({
        task: task.name,
        pred: pred.name,
        chain: task.linkId?.name ?? '?',
        taskStart: CTPDateTime.toDateTime(task.scheduled!.startW).toFormat('EEE HH:mm'),
        predEnd: CTPDateTime.toDateTime(pred.scheduled!.endW).toFormat('EEE HH:mm'),
        gapMinutes: Math.round(gapSec / 60),
      });
    }
  });

  return { result: solveResult, tasks, violations };
}

describe('Manufacturing: Greedy vs ChainFirstFit diagnostic (auto-detect chains)', async () => {
  const greedy = await solveManufacturing(new GreedyNeighborhood());
  const cff = await solveManufacturing(new ChainFirstFitNeighborhood());

  it('prints solve order for Greedy', async () => {
    console.log('\n=== GREEDY — Solve Order (manufacturing) ===');
    console.log('#  | Task Name                          | Chain    | Seq | Start     | End');
    console.log('---|--------------------------------------|----------|-----|-----------|----------');
    greedy.tasks.forEach((t, i) => {
      const num = String(i + 1).padStart(2);
      const name = t.name.padEnd(36);
      const chain = (t.chain ?? '-').padEnd(8);
      const seq = String(t.sequence).padStart(3);
      console.log(`${num} | ${name} | ${chain} | ${seq} | ${t.startISO} | ${t.endISO}`);
    });
  });

  it('prints solve order for ChainFirstFit', async () => {
    console.log('\n=== CHAINFIRSTFIT — Solve Order (manufacturing) ===');
    console.log('#  | Task Name                          | Chain    | Seq | Start     | End');
    console.log('---|--------------------------------------|----------|-----|-----------|----------');
    cff.tasks.forEach((t, i) => {
      const num = String(i + 1).padStart(2);
      const name = t.name.padEnd(36);
      const chain = (t.chain ?? '-').padEnd(8);
      const seq = String(t.sequence).padStart(3);
      console.log(`${num} | ${name} | ${chain} | ${seq} | ${t.startISO} | ${t.endISO}`);
    });
  });

  it('Greedy has zero violations (chains auto-detected)', async () => {
    console.log('\n=== GREEDY VIOLATIONS ===');
    console.log('Task                              | Pred                              | Chain    | Task Start | Pred End  | Gap');
    console.log('----------------------------------|-----------------------------------|----------|------------|-----------|--------');
    for (const v of greedy.violations) {
      const task = v.task.padEnd(33);
      const pred = v.pred.padEnd(33);
      const chain = v.chain.padEnd(8);
      console.log(`${task} | ${pred} | ${chain} | ${v.taskStart}    | ${v.predEnd}    | ${v.gapMinutes}m`);
    }
    expect(greedy.violations.length).toBe(0);
  });

  it('ChainFirstFit has zero violations (chains auto-detected)', async () => {
    console.log('\n=== CHAINFIRSTFIT VIOLATIONS ===');
    console.log('Task                              | Pred                              | Chain    | Task Start | Pred End  | Gap');
    console.log('----------------------------------|-----------------------------------|----------|------------|-----------|--------');
    for (const v of cff.violations) {
      const task = v.task.padEnd(33);
      const pred = v.pred.padEnd(33);
      const chain = v.chain.padEnd(8);
      console.log(`${task} | ${pred} | ${chain} | ${v.taskStart}    | ${v.predEnd}    | ${v.gapMinutes}m`);
    }
    expect(cff.violations.length).toBe(0);
  });

  it('identifies violations unique to Greedy', async () => {
    const cffViolationKeys = new Set(cff.violations.map(v => v.task));
    const greedyOnly = greedy.violations.filter(v => !cffViolationKeys.has(v.task));

    console.log('\n=== VIOLATIONS IN GREEDY BUT NOT IN CHAINFIRSTFIT ===');
    for (const v of greedyOnly) {
      console.log(`  ${v.task} (chain: ${v.chain}) — starts ${v.taskStart}, pred ${v.pred} ends ${v.predEnd}, gap: ${v.gapMinutes}m`);
    }
    console.log(`\n  Greedy-only violations: ${greedyOnly.length}`);
    console.log(`  Shared violations: ${greedy.violations.length - greedyOnly.length}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MANUFACTURING WITH hasChains=true — ALL 5 STRATEGIES
// ═══════════════════════════════════════════════════════════════════

describe('Manufacturing with hasChains=true — all strategies', async () => {
  const strategies: INeighborhoodStrategy[] = [
    new GreedyNeighborhood(),
    new ChainNeighborhood(),
    new DueDateNeighborhood(),
    new ShortestFirstNeighborhood(),
    new ChainFirstFitNeighborhood(),
  ];

  interface StrategyRow {
    name: string;
    scheduled: number;
    total: number;
    infeasible: number;
    violations: number;
    worstGapMin: number;
    timeMs: number;
  }

  const rows: StrategyRow[] = [];

  it('runs all 5 strategies with hasChains=true', async () => {
    for (const strategy of strategies) {
      const { result, violations } = await solveManufacturing(strategy, { hasChains: true });

      let worstGap = 0;
      // recompute worst gap from the returned violations data isn't enough —
      // we need all gaps, not just violations. But for the table the solve
      // function already captures worst gap across all predecessor pairs.
      // Let's re-derive from the full task set via solveManufacturing return.

      rows.push({
        name: strategy.name,
        scheduled: result.scheduled,
        total: result.totalTasks,
        infeasible: result.infeasible,
        violations: violations.length,
        worstGapMin: 0, // filled below
        timeMs: result.solveTimeMs,
      });
    }

    // Re-run to also capture worst gap (positive gaps among scheduled chains)
    // Actually we can compute from a second pass, but let's just enhance:
    // Re-do with full gap tracking
    rows.length = 0;
    for (const strategy of strategies) {
      const s = await solveManufacturing(strategy, { hasChains: true });

      // Find worst positive gap across all predecessor pairs
      let worstGapSec = 0;
      const taskMap = new Map(s.tasks.map(t => [t.key, t]));
      for (const t of s.tasks) {
        if (!t.predKey) continue;
        const pred = taskMap.get(t.predKey);
        if (!pred) continue;
        const gap = t.startW - pred.endW;
        if (gap > worstGapSec) worstGapSec = gap;
      }

      rows.push({
        name: strategy.name,
        scheduled: s.result.scheduled,
        total: s.result.totalTasks,
        infeasible: s.result.infeasible,
        violations: s.violations.length,
        worstGapMin: Math.round(worstGapSec / 60),
        timeMs: s.result.solveTimeMs,
      });
    }

    // Print comparison table
    console.log('\n=== MANUFACTURING — hasChains=true ===\n');
    console.log('┌────────────────┬───────────┬──────────┬────────────┬──────────┬──────────┐');
    console.log('│ Strategy       │ Scheduled │ Infeas.  │ Violations │ Worst Gap│ Time(ms) │');
    console.log('├────────────────┼───────────┼──────────┼────────────┼──────────┼──────────┤');
    for (const r of rows) {
      const name = r.name.padEnd(14);
      const sched = `${r.scheduled}/${r.total}`.padStart(9);
      const inf = String(r.infeasible).padStart(8);
      const viol = String(r.violations).padStart(10);
      const gap = `${r.worstGapMin}m`.padStart(8);
      const time = `${r.timeMs.toFixed(0)}`.padStart(8);
      console.log(`│ ${name} │${sched} │${inf} │${viol} │${gap} │${time} │`);
    }
    console.log('└────────────────┴───────────┴──────────┴────────────┴──────────┴──────────┘');
    console.log('');

    // All strategies should schedule some tasks
    for (const r of rows) {
      expect(r.scheduled).toBeGreaterThan(0);
    }
  });

  it('ChainFirstFit has zero violations with hasChains=true', async () => {
    const cff = rows.find(r => r.name === 'ChainFirstFit');
    expect(cff).toBeDefined();
    expect(cff!.violations).toBe(0);
  });

  it('Chain has zero violations with hasChains=true', async () => {
    const chain = rows.find(r => r.name === 'Chain');
    expect(chain).toBeDefined();
    expect(chain!.violations).toBe(0);
  });
});
