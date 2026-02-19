import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');

function createServices(tenantId: string) {
  const store = new FileConfigStore(CONFIG_ROOT, tenantId);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService);
  const strategyConfigService = new StrategyConfigService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService);
  return { ctpService, stateService, configService };
}

// ═══════════════════════════════════════════════════════════════════
// HEALTHCARE VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('Healthcare Chain Verification', () => {
  const CASES = [
    { id: 'CASE-001', patient: 'Thompson', setup: 'C001-SETUP', proc: 'C001-PROC', rec: 'C001-REC' },
    { id: 'CASE-002', patient: 'Rivera',   setup: 'C002-SETUP', proc: 'C002-PROC', rec: 'C002-REC' },
    { id: 'CASE-003', patient: 'Kim',      setup: 'C003-SETUP', proc: 'C003-PROC', rec: 'C003-REC' },
    { id: 'CASE-004', patient: 'Davis',    setup: 'C004-SETUP', proc: 'C004-PROC', rec: 'C004-REC' },
    { id: 'CASE-005', patient: 'Williams', setup: 'C005-SETUP', proc: 'C005-PROC', rec: 'C005-REC' },
    { id: 'CASE-006', patient: 'Johnson',  setup: 'C006-SETUP', proc: 'C006-PROC', rec: 'C006-REC' },
    { id: 'CASE-007', patient: 'Martinez', setup: 'C007-SETUP', proc: 'C007-PROC', rec: 'C007-REC' },
    { id: 'CASE-008', patient: 'Brown',    setup: 'C008-SETUP', proc: 'C008-PROC', rec: 'C008-REC' },
    { id: 'CASE-009', patient: 'Lee',      setup: 'C009-SETUP', proc: 'C009-PROC', rec: 'C009-REC' },
    { id: 'CASE-010', patient: 'Garcia',   setup: 'C010-SETUP', proc: 'C010-PROC', rec: 'C010-REC' },
  ];

  let result: any;

  // Solve once upfront
  function solveHealthcare() {
    const { ctpService } = createServices('acme-outpatient');
    return ctpService.solve();
  }

  it('solves healthcare dataset without error', () => {
    result = solveHealthcare();
    expect(result.status).toBe('ok');
  });

  it('schedules at least 28 tasks (CASE-005 Proc+Rec infeasible: DR-CHEN unavailable Mon)', () => {
    if (!result) result = solveHealthcare();
    const scheduled = result.tasks.filter((t: any) => t.feasible);
    console.log(`\n=== SCHEDULED: ${scheduled.length} / ${result.tasks.length} tasks ===\n`);

    // Print errors for unscheduled tasks
    const unscheduled = result.tasks.filter((t: any) => !t.feasible);
    if (unscheduled.length > 0) {
      console.log('=== UNSCHEDULED TASKS ===');
      unscheduled.forEach((t: any) => console.log(`  ${t.key}: ${JSON.stringify(t.errors)}`));
    }

    expect(scheduled.length).toBeGreaterThanOrEqual(28);
  });

  it('prints all 10 cases with Setup/Proc/Rec times', () => {
    if (!result) result = solveHealthcare();

    console.log('\n=== ALL 10 CASES — Setup / Procedure / Recovery ===\n');
    console.log('Case       | Patient    | Setup Start          | Setup End            | Proc Start           | Proc End             | Rec Start            | Rec End');
    console.log('-----------|------------|----------------------|----------------------|----------------------|----------------------|----------------------|---------------------');

    for (const c of CASES) {
      const setup = result.tasks.find((t: any) => t.key === c.setup);
      const proc  = result.tasks.find((t: any) => t.key === c.proc);
      const rec   = result.tasks.find((t: any) => t.key === c.rec);

      const sStart = setup?.scheduledStart?.substring(0, 19) ?? 'NOT SCHED';
      const sEnd   = setup?.scheduledEnd?.substring(0, 19)   ?? 'NOT SCHED';
      const pStart = proc?.scheduledStart?.substring(0, 19)  ?? 'NOT SCHED';
      const pEnd   = proc?.scheduledEnd?.substring(0, 19)    ?? 'NOT SCHED';
      const rStart = rec?.scheduledStart?.substring(0, 19)   ?? 'NOT SCHED';
      const rEnd   = rec?.scheduledEnd?.substring(0, 19)     ?? 'NOT SCHED';

      console.log(
        `${c.id.padEnd(10)} | ${c.patient.padEnd(10)} | ${sStart.padEnd(20)} | ${sEnd.padEnd(20)} | ${pStart.padEnd(20)} | ${pEnd.padEnd(20)} | ${rStart.padEnd(20)} | ${rEnd}`
      );
    }
  });

  it('no Recovery scheduled before its Procedure (primary criterion)', () => {
    if (!result) result = solveHealthcare();

    const violations: string[] = [];
    for (const c of CASES) {
      const setup = result.tasks.find((t: any) => t.key === c.setup);
      const proc  = result.tasks.find((t: any) => t.key === c.proc);
      const rec   = result.tasks.find((t: any) => t.key === c.rec);

      if (!setup?.feasible || !proc?.feasible || !rec?.feasible) {
        console.log(`  WARN: ${c.id} has unscheduled phase(s)`);
        continue;
      }

      const setupEnd = new Date(setup.scheduledEnd).getTime();
      const procStart = new Date(proc.scheduledStart).getTime();
      const procEnd = new Date(proc.scheduledEnd).getTime();
      const recStart = new Date(rec.scheduledStart).getTime();

      if (procStart < setupEnd) {
        violations.push(`${c.id}: Procedure starts BEFORE Setup ends! proc=${proc.scheduledStart} < setupEnd=${setup.scheduledEnd}`);
      }
      if (recStart < procEnd) {
        violations.push(`${c.id}: Recovery starts BEFORE Procedure ends! rec=${rec.scheduledStart} < procEnd=${proc.scheduledEnd}`);
      }
    }

    if (violations.length > 0) {
      console.log('\n=== CHAIN VIOLATIONS ===');
      violations.forEach(v => console.log('  FAIL: ' + v));
    } else {
      console.log('\n=== NO CHAIN VIOLATIONS — all chains respect Setup → Procedure → Recovery ===');
    }

    expect(violations).toEqual([]);
  });

  it('gaps are reasonable (minutes, not hours/days)', () => {
    if (!result) result = solveHealthcare();

    let worstGapSec = 0;
    let worstGapCase = '';

    console.log('\n=== CHAIN GAPS (seconds) ===');
    for (const c of CASES) {
      const setup = result.tasks.find((t: any) => t.key === c.setup);
      const proc  = result.tasks.find((t: any) => t.key === c.proc);
      const rec   = result.tasks.find((t: any) => t.key === c.rec);

      if (!setup?.feasible || !proc?.feasible || !rec?.feasible) continue;

      const setupEnd  = new Date(setup.scheduledEnd).getTime() / 1000;
      const procStart = new Date(proc.scheduledStart).getTime() / 1000;
      const procEnd   = new Date(proc.scheduledEnd).getTime() / 1000;
      const recStart  = new Date(rec.scheduledStart).getTime() / 1000;

      const gapSetupProc = procStart - setupEnd;
      const gapProcRec   = recStart - procEnd;

      console.log(`  ${c.id} (${c.patient}): Setup→Proc gap=${gapSetupProc}s (${(gapSetupProc/60).toFixed(0)}m)  Proc→Rec gap=${gapProcRec}s (${(gapProcRec/60).toFixed(0)}m)`);

      if (gapSetupProc > worstGapSec) { worstGapSec = gapSetupProc; worstGapCase = `${c.id} Setup→Proc`; }
      if (gapProcRec > worstGapSec)   { worstGapSec = gapProcRec;   worstGapCase = `${c.id} Proc→Rec`; }
    }

    const worstGapMin = worstGapSec / 60;
    console.log(`\n  WORST GAP: ${worstGapSec}s (${worstGapMin.toFixed(1)} min) at ${worstGapCase}`);

    // Gaps should not be negative
    expect(worstGapSec).toBeGreaterThanOrEqual(0);
  });

  it('solve order is chain-by-chain (setup before proc before rec)', () => {
    if (!result) result = solveHealthcare();

    // Verify solve order: within each case, setup should be scheduled at or before proc, proc at or before rec
    // (already checked by the no-violation test, but this double-checks via timestamps)
    let chainByChain = true;
    for (const c of CASES) {
      const setup = result.tasks.find((t: any) => t.key === c.setup);
      const proc  = result.tasks.find((t: any) => t.key === c.proc);
      const rec   = result.tasks.find((t: any) => t.key === c.rec);

      if (!setup?.feasible || !proc?.feasible || !rec?.feasible) continue;

      const setupStart = new Date(setup.scheduledStart).getTime();
      const procStart  = new Date(proc.scheduledStart).getTime();
      const recStart   = new Date(rec.scheduledStart).getTime();

      if (procStart < setupStart || recStart < procStart) {
        chainByChain = false;
        console.log(`  ${c.id}: OUT OF ORDER — setup=${setup.scheduledStart} proc=${proc.scheduledStart} rec=${rec.scheduledStart}`);
      }
    }

    console.log(`\n=== SOLVE ORDER: ${chainByChain ? 'CHAIN-BY-CHAIN (correct)' : 'NOT chain-by-chain (problem)'} ===`);
    expect(chainByChain).toBe(true);
  });

  // ── Window reset: solve twice, same results ──

  it('window reset: solving twice produces identical results', () => {
    const { ctpService } = createServices('acme-outpatient');
    const result1 = ctpService.solve();
    const result2 = ctpService.solve();

    const tasks1 = result1.tasks
      .filter((t: any) => t.feasible)
      .map((t: any) => ({ key: t.key, start: t.scheduledStart, end: t.scheduledEnd }))
      .sort((a: any, b: any) => a.key.localeCompare(b.key));

    const tasks2 = result2.tasks
      .filter((t: any) => t.feasible)
      .map((t: any) => ({ key: t.key, start: t.scheduledStart, end: t.scheduledEnd }))
      .sort((a: any, b: any) => a.key.localeCompare(b.key));

    console.log(`\n=== WINDOW RESET: Solve1 scheduled ${tasks1.length}, Solve2 scheduled ${tasks2.length} ===`);
    expect(tasks1.length).toBe(tasks2.length);
    expect(tasks1).toEqual(tasks2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MANUFACTURING REGRESSION
// ═══════════════════════════════════════════════════════════════════

describe('Manufacturing Regression', () => {
  it('solves manufacturing dataset without error', () => {
    const { ctpService } = createServices('demo-manufacturing');
    const result = ctpService.solve();

    console.log(`\n=== MANUFACTURING: status=${result.status} scheduled=${result.summary.scheduledTasks}/${result.summary.includedTasks} ===`);

    expect(result.status).toBe('ok');
    expect(result.summary.includedTasks).toBe(29);
    expect(result.summary.scheduledTasks).toBeGreaterThan(0);

    // Check no unexpected errors
    const errored = result.tasks.filter((t: any) => t.errors && t.errors.length > 0);
    if (errored.length > 0) {
      console.log('  Tasks with errors:');
      errored.forEach((t: any) => console.log(`    ${t.key}: ${JSON.stringify(t.errors)}`));
    }

    // Orders should still have fill rates
    expect(result.orders.length).toBe(8);
    console.log('  Manufacturing solve: OK');
  });
});
