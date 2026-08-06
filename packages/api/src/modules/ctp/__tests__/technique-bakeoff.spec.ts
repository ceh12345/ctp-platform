/**
 * Technique bake-off — v1.
 *
 * Compares scheduling techniques against the Chain baseline on fixed demand.
 * See `harness/technique-harness.ts` for the three contracts this enforces
 * (determinism, feasibility-as-gate, discrimination).
 *
 * These tests assert on DIFFERENCES, not floors. `strategy-comparison.spec.ts`
 * asserted "Chain schedules at least 28 tasks" and stayed green for months
 * while printing five identical rows. A comparison suite whose techniques all
 * tie must say so out loud.
 */

import { describe, it, expect } from 'vitest';
import {
  runTechnique,
  compare,
  renderComparison,
  TechniqueRun,
} from './harness/technique-harness';
import {
  ALL_TECHNIQUES,
  CHAIN_TECHNIQUES,
  TASK_TECHNIQUES,
  BASELINE_KEY,
} from './harness/techniques';

/** Run every technique once against a tenant. */
async function runAll(tenantId: string): Promise<TechniqueRun[]> {
  const runs: TechniqueRun[] = [];
  for (const technique of ALL_TECHNIQUES) {
    runs.push(await runTechnique(tenantId, technique));
  }
  return runs;
}

// ═══════════════════════════════════════════════════════════════════
//  CONTRACT 1 — DETERMINISM
// ═══════════════════════════════════════════════════════════════════

describe('Contract 1 — determinism', () => {
  it('every technique reproduces its schedule byte-for-byte', async () => {
    const tenantId = 'demo-manufacturing';
    const mismatches: string[] = [];

    for (const technique of ALL_TECHNIQUES) {
      const first = await runTechnique(tenantId, technique);
      const second = await runTechnique(tenantId, technique);
      if (first.fingerprint !== second.fingerprint) {
        mismatches.push(
          `${technique.key}: ${first.fingerprint} != ${second.fingerprint}`,
        );
      }
    }

    if (mismatches.length > 0) {
      console.log('\nNON-DETERMINISTIC TECHNIQUES:\n  ' + mismatches.join('\n  ') + '\n');
    }
    // A technique that cannot reproduce its own schedule cannot have a KPI
    // delta attributed to it. This gate must hold before any technique is
    // compared, which is why it is contract 1.
    expect(mismatches).toEqual([]);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════
//  CONTRACT 2 + 3 — FEASIBILITY GATE AND DISCRIMINATION
// ═══════════════════════════════════════════════════════════════════

describe('Technique bake-off — demo-manufacturing', () => {
  let runs: TechniqueRun[];

  it('runs the technique set and reports', async () => {
    runs = await runAll('demo-manufacturing');
    const cmp = compare('demo-manufacturing', runs, BASELINE_KEY);
    console.log(renderComparison(cmp));
    expect(runs).toHaveLength(ALL_TECHNIQUES.length);
  }, 120_000);

  it('no technique silently places fewer tasks than the baseline', () => {
    const cmp = compare('demo-manufacturing', runs, BASELINE_KEY);
    const dq = cmp.rows.filter((r) => r.disqualified);
    // Feasibility is a gate, not a metric — a technique that places less work
    // is not comparable on delivery gap and must be surfaced, not ranked.
    if (dq.length > 0) {
      console.log(
        '\nDISQUALIFIED (placed fewer tasks than baseline):\n  ' +
        dq.map((r) => `${r.technique.key}: ${r.disqualifiedReason}`).join('\n  ') + '\n',
      );
    }
    expect(dq.map((r) => r.technique.key)).toEqual([]);
  });

  it('KNOWN ISSUE: all chain-routed techniques collapse to one schedule', () => {
    const cmp = compare('demo-manufacturing', runs, BASELINE_KEY);
    const chainKeys = CHAIN_TECHNIQUES.map((t) => t.key);
    const chainPrints = new Set(
      cmp.rows.filter((r) => chainKeys.includes(r.technique.key)).map((r) => r.fingerprint),
    );

    // basescheduler.ts:884 routes every chainCompatible strategy to
    // scheduleChainPass, which never consults the neighborhood or its dispatch
    // plug — so ATC, DBR and Slack currently have no effect on chained data.
    //
    // This assertion DOCUMENTS the defect. When the dispatch seam is wired into
    // chain ordering, this test fails and must be deliberately updated — which
    // is the point. It is the regression net for that fix.
    expect(chainPrints.size).toBe(1);
  });

  it('the engine reports every chain-routed technique as "Chain"', () => {
    const chainKeys = CHAIN_TECHNIQUES.map((t) => t.key);
    const reported = runs
      .filter((r) => chainKeys.includes(r.technique.key))
      .map((r) => r.kpis.reportedStrategy);
    // Corroborates the collapse from the engine's own mouth: the requested
    // strategy is discarded and overwritten at basescheduler.ts:928.
    expect(new Set(reported)).toEqual(new Set(['Chain']));
  });

  it('task-level decomposition produces a different schedule than chain-atomic', () => {
    const cmp = compare('demo-manufacturing', runs, BASELINE_KEY);
    const baseline = cmp.rows.find((r) => r.technique.key === BASELINE_KEY)!;
    const taskKeys = TASK_TECHNIQUES.map((t) => t.key);
    const taskRows = cmp.rows.filter((r) => taskKeys.includes(r.technique.key));

    // If this fails the harness cannot detect a difference it should be able to
    // detect, and every other result in the suite is suspect. This is the
    // positive control for contract 3.
    for (const row of taskRows) {
      expect(
        row.fingerprint,
        `${row.technique.key} should differ from the ${BASELINE_KEY} baseline`,
      ).not.toBe(baseline.fingerprint);
    }
  });

  it('no technique introduces a chain precedence violation', () => {
    for (const run of runs) {
      expect(
        run.kpis.chainViolations,
        `${run.technique.key} violated chain precedence`,
      ).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  LADDER — larger instances
// ═══════════════════════════════════════════════════════════════════

describe('Technique bake-off — acme-outpatient', () => {
  it('runs the technique set and reports', async () => {
    const runs = await runAll('acme-outpatient');
    const cmp = compare('acme-outpatient', runs, BASELINE_KEY);
    console.log(renderComparison(cmp));

    // Same collapse expected here — the routing gate is data-shape dependent,
    // not tenant dependent.
    const chainKeys = CHAIN_TECHNIQUES.map((t) => t.key);
    const chainPrints = new Set(
      cmp.rows.filter((r) => chainKeys.includes(r.technique.key)).map((r) => r.fingerprint),
    );
    expect(chainPrints.size).toBe(1);
  }, 180_000);
});

describe('Technique bake-off — stafford-slim-100', () => {
  it('runs the technique set and reports', async () => {
    const runs = await runAll('stafford-slim-100');
    const cmp = compare('stafford-slim-100', runs, BASELINE_KEY);
    console.log(renderComparison(cmp));

    const baseline = cmp.rows.find((r) => r.technique.key === BASELINE_KEY)!;
    expect(baseline.kpis.scheduled).toBeGreaterThan(0);
    // Real customer data — the delivery-gap vector should be populated, since
    // an all-undated run means the customer-date mapping regressed.
    expect(baseline.kpis.ordersMeasured).toBeGreaterThan(0);
  }, 600_000);
});
