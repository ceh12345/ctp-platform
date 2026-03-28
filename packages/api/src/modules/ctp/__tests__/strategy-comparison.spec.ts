import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';
import { ScheduleConfigurationService } from '../../../config/schedule-configuration.service';
import { LoggerService } from '../../../logging/logger.service';
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

function createServices(tenantId: string) {
  const store = new FileConfigStore(CONFIG_ROOT, tenantId);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService);
  const strategyConfigService = new StrategyConfigService(configService);
  const logger = new LoggerService();
  const schedConfigService = new ScheduleConfigurationService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService, logger, schedConfigService);
  return { ctpService, stateService, configService };
}

interface StrategyResult {
  name: string;
  scheduled: number;
  notScheduled: number;
  infeasible: number;
  totalTasks: number;
  contexts: number;
  timeMs: number;
  chainViolations: number;
  worstGapMinutes: number;
}

function solveWithStrategy(
  tenantId: string,
  strategy: INeighborhoodStrategy
): StrategyResult {
  const { stateService, configService } = createServices(tenantId);

  // Load fresh landscape
  stateService.syncFromConfig();
  const landscape = stateService.getLandscape()!;

  // Build scoring
  const scoringConfig = configService.getScoring()!;
  const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
  for (const rule of scoringConfig.rules) {
    const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
    config.includeInSolve = rule.includeInSolve;
    config.penaltyFactor = rule.penaltyFactor;
    scoring.addConfig(config);
  }

  // Build scheduler with explicit strategy
  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    landscape.horizon, landscape.tasks, landscape.resources,
    landscape.stateChanges, landscape.processes,
  );
  scheduler.initSettings(landscape.appSettings);
  scheduler.initScoring(scoring);

  // Override strategy
  (scheduler as any).neighborhoodAgent = null;
  const origNextTasks = (scheduler as any).__proto__.nextTasksToSchedule;
  // We override by setting the strategy after the agent is created
  const originalMethod = scheduler['nextTasksToSchedule'].bind(scheduler);

  // Monkey-patch to inject our strategy
  (scheduler as any).nextTasksToSchedule = function (
    tasks: List<CTPTask>,
    numOfTasks: number
  ) {
    if (!(this as any).neighborhoodAgent) {
      (this as any).neighborhoodAgent = (this as any).getNextNeighborhoodAgent();
      (this as any).neighborhoodAgent.setStrategy(strategy);
    }
    return (this as any).neighborhoodAgent.solve(tasks, numOfTasks, (this as any).settings, (this as any).landscape);
  };

  // Build task list
  const taskList = new List<CTPTask>();
  landscape.tasks.forEach((t) => taskList.add(t));

  // Solve
  const solveResult = scheduler.schedule(taskList);

  // Analyze chain violations and worst gap
  let chainViolations = 0;
  let worstGapSeconds = 0;

  const taskMap = new Map<string, any>();
  landscape.tasks.forEach((t) => taskMap.set(t.key, t));

  landscape.tasks.forEach((task) => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED) return;
    if (!task.linkId?.prevLink) return;

    const pred = taskMap.get(task.linkId.prevLink);
    if (!pred || pred.state !== CTPTaskStateConstants.SCHEDULED) return;

    // Chain violation: task starts before predecessor ends
    if (task.scheduled!.startW < pred.scheduled!.endW) {
      chainViolations++;
    }

    // Gap measurement
    const gap = task.scheduled!.startW - pred.scheduled!.endW;
    if (gap > worstGapSeconds) {
      worstGapSeconds = gap;
    }
  });

  return {
    name: strategy.name,
    scheduled: solveResult.scheduled,
    notScheduled: solveResult.notScheduled,
    infeasible: solveResult.infeasible,
    totalTasks: solveResult.totalTasks,
    contexts: solveResult.contextsEvaluated,
    timeMs: solveResult.solveTimeMs,
    chainViolations,
    worstGapMinutes: Math.round(worstGapSeconds / 60),
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY COMPARISON — HEALTHCARE
// ═══════════════════════════════════════════════════════════════════

describe('Strategy Comparison — Healthcare', () => {
  const strategies: INeighborhoodStrategy[] = [
    new GreedyNeighborhood(),
    new ChainNeighborhood(),
    new DueDateNeighborhood(),
    new ShortestFirstNeighborhood(),
    new ChainFirstFitNeighborhood(),
  ];

  const results: StrategyResult[] = [];

  it('runs all 5 strategies against healthcare', () => {
    for (const strategy of strategies) {
      const result = solveWithStrategy('acme-outpatient', strategy);
      results.push(result);
    }

    // Print comparison table
    console.log('\n');
    console.log('┌────────────────┬───────────┬──────────┬────────────┬──────────┬──────────┐');
    console.log('│ Strategy       │ Scheduled │ Infeas.  │ Violations │ Worst Gap│ Time(ms) │');
    console.log('├────────────────┼───────────┼──────────┼────────────┼──────────┼──────────┤');
    for (const r of results) {
      const name = r.name.padEnd(14);
      const sched = `${r.scheduled}/${r.totalTasks}`.padStart(9);
      const inf = String(r.infeasible).padStart(8);
      const viol = String(r.chainViolations).padStart(10);
      const gap = `${r.worstGapMinutes}m`.padStart(8);
      const time = `${r.timeMs.toFixed(0)}`.padStart(8);
      console.log(`│ ${name} │${sched} │${inf} │${viol} │${gap} │${time} │`);
    }
    console.log('└────────────────┴───────────┴──────────┴────────────┴──────────┴──────────┘');
    console.log('\n');

    // All strategies should schedule at least some tasks
    for (const r of results) {
      expect(r.scheduled).toBeGreaterThan(0);
    }
  });

  it('Chain strategy produces zero chain violations', () => {
    const chain = results.find(r => r.name === 'Chain');
    expect(chain).toBeDefined();
    expect(chain!.chainViolations).toBe(0);
  });

  it('Chain strategy schedules at least 28 tasks', () => {
    const chain = results.find(r => r.name === 'Chain');
    expect(chain).toBeDefined();
    expect(chain!.scheduled).toBeGreaterThanOrEqual(28);
  });
});

// ═══════════════════════════════════════════════════════════════════
// STRATEGY COMPARISON — MANUFACTURING
// ═══════════════════════════════════════════════════════════════════

describe('Strategy Comparison — Manufacturing', () => {
  const strategies: INeighborhoodStrategy[] = [
    new GreedyNeighborhood(),
    new ChainNeighborhood(),
    new DueDateNeighborhood(),
    new ShortestFirstNeighborhood(),
    new ChainFirstFitNeighborhood(),
  ];

  const results: StrategyResult[] = [];

  it('runs all 5 strategies against manufacturing', () => {
    for (const strategy of strategies) {
      const result = solveWithStrategy('demo-manufacturing', strategy);
      results.push(result);
    }

    // Print comparison table
    console.log('\n');
    console.log('┌────────────────┬───────────┬──────────┬────────────┬──────────┬──────────┐');
    console.log('│ Strategy       │ Scheduled │ Infeas.  │ Violations │ Worst Gap│ Time(ms) │');
    console.log('├────────────────┼───────────┼──────────┼────────────┼──────────┼──────────┤');
    for (const r of results) {
      const name = r.name.padEnd(14);
      const sched = `${r.scheduled}/${r.totalTasks}`.padStart(9);
      const inf = String(r.infeasible).padStart(8);
      const viol = String(r.chainViolations).padStart(10);
      const gap = `${r.worstGapMinutes}m`.padStart(8);
      const time = `${r.timeMs.toFixed(0)}`.padStart(8);
      console.log(`│ ${name} │${sched} │${inf} │${viol} │${gap} │${time} │`);
    }
    console.log('└────────────────┴───────────┴──────────┴────────────┴──────────┴──────────┘');
    console.log('\n');

    // All strategies should schedule something for manufacturing
    for (const r of results) {
      expect(r.scheduled).toBeGreaterThan(0);
    }
  });

  it('Chain-compatible strategies schedule most manufacturing tasks', () => {
    const chain = results.find(r => r.name === 'Chain');
    expect(chain).toBeDefined();
    // 25/29 with commitment data (completed + running + dispatched + pinned anchored)
    expect(chain!.scheduled).toBeGreaterThanOrEqual(25);

    const cff = results.find(r => r.name === 'ChainFirstFit');
    expect(cff).toBeDefined();
    expect(cff!.scheduled).toBeGreaterThanOrEqual(25);
  });
});
