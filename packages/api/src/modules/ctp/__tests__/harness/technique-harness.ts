/**
 * Scheduling technique comparison harness (v1).
 *
 * WHY THIS EXISTS
 * ---------------
 * `strategy-comparison.spec.ts` compares `INeighborhoodStrategy` instances by
 * monkey-patching `nextTasksToSchedule`. That patch is dead code on any tenant
 * with chain data: `CTPBaseScheduler.schedule()` routes to `scheduleChainPass`
 * when `hasChains && strategy.chainCompatible`, and the chain pass never calls
 * `nextTasksToSchedule`. The result is five identical rows and assertions too
 * weak to notice — the harness worked, nothing consumed its output.
 *
 * This harness drives the seam one level up: a technique sets
 * `appSettings.solverStrategy` and the engine routes itself, exactly as it does
 * in production. Nothing is patched, so what the harness measures is what a
 * tenant would get.
 *
 * THREE CONTRACTS
 * ---------------
 * 1. DETERMINISM — a technique must produce a byte-identical schedule when run
 *    twice on the same landscape. Compared via `fingerprint`. Techniques that
 *    fail this cannot have KPI deltas attributed to them.
 *
 * 2. FEASIBILITY IS A GATE, NOT A METRIC — a run that places fewer tasks than
 *    the baseline is disqualified before its delivery-gap numbers are compared.
 *    Otherwise a technique "wins" by declining to schedule the hard work.
 *
 * 3. DISCRIMINATION — the harness reports which techniques produced distinct
 *    schedules. A set that collapses to one outcome is a finding (either the
 *    techniques are equivalent, or the seam that differentiates them is
 *    broken); it must never pass silently.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { StateService } from '../../../state/state.service';
import { StateHydratorService } from '../../../state/state-hydrator.service';
import { ConfigService } from '../../../../config/config.service';
import { FileConfigStore } from '../../../../config/file-config-store';
import {
  CTPScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  List,
  CTPTask,
  CTPTaskStateConstants,
  CTPWipStateConstants,
} from '@ctp/engine';

const CONFIG_ROOT = path.resolve(
  __dirname, '..', '..', '..', '..', '..', '..', '..', 'config',
);

// ═══════════════════════════════════════════════════════════════════
//  TECHNIQUE DEFINITION
// ═══════════════════════════════════════════════════════════════════

/**
 * A technique is a named scheduling policy the engine can be asked to run.
 *
 * v1 techniques are all reachable through `appSettings.solverStrategy`, i.e.
 * they are production code paths. Future techniques with a different loop shape
 * (parallel SGS, shifting bottleneck, two-phase FJSP) will need a scheduler
 * factory here rather than a strategy string — that is the intended extension
 * point, and the reason `runTechnique` takes the whole technique rather than a
 * bare strategy name.
 */
export interface Technique {
  /** Stable identifier used in tables and assertions. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Value written to `appSettings.solverStrategy`. */
  solverStrategy: string;
  /**
   * Value written to `appSettings.activeSequence` — the processing sequence
   * that `getChainPriority` ranks chains by.
   *
   * Production sets this from the solve request or the tenant's
   * `defaultSequence` (`ctp.service.ts:396`). The harness drives `CTPScheduler`
   * directly, so it must set it explicitly or the engine falls back to
   * `task.priority` — which on Stafford is a single value on 96% of orders,
   * i.e. an arbitrary tie. Leave undefined to measure that fallback
   * deliberately; set a name to measure a real sequence.
   */
  activeSequence?: string;
  /**
   * Which decomposition the engine is EXPECTED to route this to.
   * `runTechnique` records what actually happened in `kpis.reportedStrategy`,
   * so a mismatch between expectation and reality is visible rather than
   * assumed.
   */
  expectedDecomposition: 'chain' | 'task';
  /** Optional note explaining what the technique is for. */
  note?: string;
}

// ═══════════════════════════════════════════════════════════════════
//  KPI VECTOR
// ═══════════════════════════════════════════════════════════════════

/**
 * KPI vector for one run.
 *
 * The `deliveryGap.*` family matches the contract in
 * `docs/sprints/SPRINT-solver-comparison.md` so harness output and the
 * client-facing bake-off produce the same numbers rather than diverging.
 * Gap convention: `gap = customerDate − jobCompletion`, so POSITIVE is slack
 * (finishing ahead of need) and NEGATIVE is penetration (past the date).
 */
export interface TechniqueKpis {
  // ─── Feasibility (the gate) ───
  totalTasks: number;
  scheduled: number;
  infeasible: number;
  notScheduled: number;
  feasibilityRate: number;

  // ─── deliveryGap.* (the decision metric) ───
  deliveryGapLateCount: number;
  deliveryGapLateTotalSec: number;
  deliveryGapWorstLateSec: number;
  deliveryGapOnTimeCount: number;
  deliveryGapSlackTotalSec: number;
  /** Orders that had both a customer date and at least one scheduled task. */
  ordersMeasured: number;
  /** Orders skipped because no usable customer date was present. */
  ordersUndated: number;

  // ─── Supporting ───
  makespanSec: number;
  chainViolations: number;
  worstChainGapSec: number;
  bumps: number;
  contextsEvaluated: number;
  solveTimeMs: number;

  /**
   * What the ENGINE said it ran, from `CTPSolveResult.strategy`. On chained
   * data the engine overwrites this to 'Chain' regardless of the requested
   * strategy — capturing it is how the harness surfaces routing collapse
   * instead of inferring it.
   */
  reportedStrategy: string;
}

export interface TechniqueRun {
  technique: Technique;
  tenantId: string;
  kpis: TechniqueKpis;
  /**
   * Hash over every placement (task, resource, start, end). Identical
   * fingerprints mean identical schedules — this is both the determinism check
   * and the discrimination primitive.
   */
  fingerprint: string;
}

// ═══════════════════════════════════════════════════════════════════
//  SERVICE CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

async function loadLandscape(tenantId: string) {
  const store = new FileConfigStore(CONFIG_ROOT, tenantId);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(
    hydrator, configService, { sync: async () => ({}) } as any,
  );
  await stateService.syncFromAdapter();
  const landscape = stateService.getLandscape();
  if (!landscape) throw new Error(`Tenant '${tenantId}' produced no landscape`);
  return { landscape, configService };
}

function buildScoring(configService: ConfigService): CTPScoring {
  const scoringConfig = configService.getScoring();
  if (!scoringConfig) throw new Error('Tenant has no scoring configuration');
  const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
  for (const rule of scoringConfig.rules) {
    const cfg = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
    cfg.includeInSolve = rule.includeInSolve;
    cfg.penaltyFactor = rule.penaltyFactor;
    scoring.addConfig(cfg);
  }
  return scoring;
}

// ═══════════════════════════════════════════════════════════════════
//  RUN
// ═══════════════════════════════════════════════════════════════════

/**
 * Run one technique against one tenant and return its KPI vector.
 *
 * The landscape is loaded fresh per run so no state leaks between techniques —
 * that is the fixed-demand invariant the whole comparison rests on. It is also
 * why this is slow enough to belong in a dedicated spec rather than the main
 * suite.
 */
export async function runTechnique(
  tenantId: string,
  technique: Technique,
): Promise<TechniqueRun> {
  const { landscape, configService } = await loadLandscape(tenantId);
  const scoring = buildScoring(configService);

  // The technique IS the strategy setting — no patching, so the engine routes
  // itself exactly as it would for a tenant configured this way.
  if (!landscape.appSettings) throw new Error('Landscape has no appSettings');
  landscape.appSettings.solverStrategy = technique.solverStrategy;
  // Explicit on both branches: an unset sequence is a measured condition here,
  // not an oversight. See the field docs on Technique.activeSequence.
  (landscape.appSettings as any).activeSequence = technique.activeSequence;

  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    landscape.horizon, landscape.tasks, landscape.resources,
    landscape.stateChanges, landscape.processes,
  );
  scheduler.initSettings(landscape.appSettings);
  scheduler.initScoring(scoring);

  const taskList = new List<CTPTask>();
  landscape.tasks.forEach((t) => taskList.add(t));

  // Keys present BEFORE the solve. Anything that appears afterwards was
  // synthesized by the scheduler (setup / teardown / changeover tasks), and its
  // key comes from `IdFactory.generateUniqueKey()`, which mixes `Date.now()`
  // with `Math.random()`. Those keys are therefore different on every run and
  // must not enter the fingerprint — see `computeFingerprint`.
  const sourceKeys = new Set<string>();
  landscape.tasks.forEach((t: any) => sourceKeys.add(t.key));

  const solveResult = scheduler.schedule(taskList);

  const kpis = computeKpis(landscape, solveResult);
  const fingerprint = computeFingerprint(landscape, sourceKeys);

  return { technique, tenantId, kpis, fingerprint };
}

// ═══════════════════════════════════════════════════════════════════
//  KPI COMPUTATION
// ═══════════════════════════════════════════════════════════════════

function computeKpis(landscape: any, solveResult: any): TechniqueKpis {
  const taskMap = new Map<string, any>();
  landscape.tasks.forEach((t: any) => taskMap.set(t.key, t));

  let chainViolations = 0;
  let worstChainGapSec = 0;
  let minStartW = Number.POSITIVE_INFINITY;
  let maxEndW = Number.NEGATIVE_INFINITY;

  // Job completion per order key. A chain's order key is `linkId.name`
  // (the same join `getChainPriority` uses).
  const completionByOrder = new Map<string, number>();

  landscape.tasks.forEach((task: any) => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;

    const startW = task.scheduled.startW;
    const endW = task.scheduled.endW;
    if (startW < minStartW) minStartW = startW;
    if (endW > maxEndW) maxEndW = endW;

    const orderKey = task.linkId?.name;
    if (orderKey) {
      const prev = completionByOrder.get(orderKey);
      if (prev === undefined || endW > prev) completionByOrder.set(orderKey, endW);
    }

    // Chain integrity — a successor must not start before its predecessor ends.
    const prevKey = task.linkId?.prevLink;
    if (!prevKey) return;
    const pred = taskMap.get(prevKey);
    if (!pred || pred.state !== CTPTaskStateConstants.SCHEDULED || !pred.scheduled) return;

    // Anchored work is placed at its ACTUAL position by Pass 1, not chosen by
    // the solver. Real shop floors do start operations out of order, so an
    // overlap between two committed tasks is a historical fact rather than a
    // scheduling defect — counting it would blame every technique equally for
    // something none of them decided.
    if (!isAnchored(task) && !isAnchored(pred)) {
      if (startW < pred.scheduled.endW) chainViolations++;
    }
    const gap = startW - pred.scheduled.endW;
    if (gap > worstChainGapSec) worstChainGapSec = gap;
  });

  // ─── deliveryGap.* ───
  let lateCount = 0;
  let lateTotalSec = 0;
  let worstLateSec = 0;
  let onTimeCount = 0;
  let slackTotalSec = 0;
  let ordersMeasured = 0;
  let ordersUndated = 0;

  for (const [orderKey, completion] of completionByOrder) {
    const order = landscape.orders?.getEntity(orderKey);
    const customerDate = resolveCustomerDate(order);
    if (customerDate === null) { ordersUndated++; continue; }

    ordersMeasured++;
    const gap = customerDate - completion;   // + = slack, − = penetration
    if (gap < 0) {
      lateCount++;
      lateTotalSec += -gap;
      if (-gap > worstLateSec) worstLateSec = -gap;
    } else {
      onTimeCount++;
      slackTotalSec += gap;
    }
  }

  const totalTasks = solveResult.totalTasks ?? 0;
  const scheduled = solveResult.scheduled ?? 0;

  return {
    totalTasks,
    scheduled,
    infeasible: solveResult.infeasible ?? 0,
    notScheduled: solveResult.notScheduled ?? 0,
    feasibilityRate: totalTasks > 0 ? scheduled / totalTasks : 0,

    deliveryGapLateCount: lateCount,
    deliveryGapLateTotalSec: lateTotalSec,
    deliveryGapWorstLateSec: worstLateSec,
    deliveryGapOnTimeCount: onTimeCount,
    deliveryGapSlackTotalSec: slackTotalSec,
    ordersMeasured,
    ordersUndated,

    makespanSec: maxEndW > minStartW ? maxEndW - minStartW : 0,
    chainViolations,
    worstChainGapSec,
    bumps: solveResult.totalBumps ?? 0,
    contextsEvaluated: solveResult.contextsEvaluated ?? 0,
    solveTimeMs: solveResult.solveTimeMs ?? 0,

    reportedStrategy: solveResult.strategy ?? '?',
  };
}

/** Pinned or already-started work — anchored by Pass 1, not placed by the solver. */
function isAnchored(task: any): boolean {
  if (task.pinned) return true;
  return task.wipstate !== undefined && task.wipstate !== CTPWipStateConstants.NOT_STARTED;
}

/**
 * The customer date, with a documented fallback chain.
 *
 * `customerDeliveryDate` is the authoritative customer promise where it has
 * been mapped; `lateDueDate` carries Genius `DeliveryDate` on Stafford;
 * `dueDate` (Genius `JobEndDate`) is the last resort and measures against a
 * different date, so runs that fall back should be read with that in mind.
 * Returns null when nothing usable is present, so undated orders are counted
 * and excluded rather than silently scored as on-time.
 */
function resolveCustomerDate(order: any): number | null {
  if (!order) return null;
  if (typeof order.customerDeliveryDate === 'number' && order.customerDeliveryDate > 0) {
    return order.customerDeliveryDate;
  }
  if (typeof order.lateDueDate === 'number' && order.lateDueDate > 0) return order.lateDueDate;
  if (typeof order.dueDate === 'number' && order.dueDate > 0) return order.dueDate;
  return null;
}

/**
 * Hash of every placement. Two runs agree iff every task landed on the same
 * resource at the same time. Sorted so map iteration order cannot affect it.
 *
 * Synthesized tasks (setup / teardown / changeover) are identified positionally
 * rather than by key. `IdFactory.generateUniqueKey()` builds keys from
 * `Date.now()` and `Math.random()`, so a key-based fingerprint would report
 * every run as different even when the schedule is identical. Their type,
 * resource and times still enter the hash, so a changeover that moves or
 * changes machine is still detected — only the meaningless identifier is
 * dropped.
 */
function computeFingerprint(landscape: any, sourceKeys: Set<string>): string {
  const rows: string[] = [];
  landscape.tasks.forEach((task: any) => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;
    const resources = (task.capacityResources ?? [])
      .map((r: any) => r.scheduledResource ?? '')
      .filter((r: string) => r !== '')
      .sort()
      .join('+');
    const identity = sourceKeys.has(task.key)
      ? task.key
      : `synth:${task.type ?? '?'}`;
    rows.push(`${identity}|${resources}|${task.scheduled.startW}|${task.scheduled.endW}`);
  });
  rows.sort();
  return crypto.createHash('sha1').update(rows.join('\n')).digest('hex').slice(0, 12);
}

// ═══════════════════════════════════════════════════════════════════
//  COMPARISON
// ═══════════════════════════════════════════════════════════════════

export interface ComparisonRow extends TechniqueRun {
  /** True when this run placed fewer tasks than the baseline (contract 2). */
  disqualified: boolean;
  disqualifiedReason?: string;
  /** True when this run's schedule is identical to the baseline's. */
  identicalToBaseline: boolean;
}

export interface Comparison {
  tenantId: string;
  baselineKey: string;
  rows: ComparisonRow[];
  /** Distinct fingerprints across the technique set. 1 means total collapse. */
  distinctOutcomes: number;
  /** Fingerprint → technique keys that produced it. */
  outcomeGroups: Map<string, string[]>;
}

export function compare(
  tenantId: string,
  runs: TechniqueRun[],
  baselineKey: string,
): Comparison {
  const baseline = runs.find((r) => r.technique.key === baselineKey);
  if (!baseline) throw new Error(`Baseline technique '${baselineKey}' not in run set`);

  const outcomeGroups = new Map<string, string[]>();
  for (const run of runs) {
    const list = outcomeGroups.get(run.fingerprint) ?? [];
    list.push(run.technique.key);
    outcomeGroups.set(run.fingerprint, list);
  }

  const rows: ComparisonRow[] = runs.map((run) => {
    const fewer = run.kpis.scheduled < baseline.kpis.scheduled;
    return {
      ...run,
      disqualified: fewer,
      disqualifiedReason: fewer
        ? `placed ${run.kpis.scheduled} vs baseline ${baseline.kpis.scheduled}`
        : undefined,
      identicalToBaseline: run.fingerprint === baseline.fingerprint,
    };
  });

  return {
    tenantId,
    baselineKey,
    rows,
    distinctOutcomes: outcomeGroups.size,
    outcomeGroups,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  REPORTING
// ═══════════════════════════════════════════════════════════════════

const HOURS = 3600;

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;
}

export function renderComparison(cmp: Comparison): string {
  const out: string[] = [];
  out.push('');
  out.push(`TENANT: ${cmp.tenantId}   (baseline: ${cmp.baselineKey})`);
  out.push(
    pad('technique', 16) + pad('sequence', 22) + pad('routed', 8) + padL('placed', 10) +
    padL('late', 7) + padL('lateTot(h)', 12) + padL('worst(h)', 10) +
    padL('slack(h)', 10) + padL('mkspan(h)', 11) + padL('viol', 6) +
    padL('ms', 8) + '  fingerprint',
  );
  out.push('-'.repeat(132));

  for (const row of cmp.rows) {
    const k = row.kpis;
    const flag = row.disqualified ? ' DQ' : row.identicalToBaseline ? ' =base' : '';
    out.push(
      pad(row.technique.key, 16) +
      pad(row.technique.activeSequence ?? '(none -> priority)', 22) +
      pad(k.reportedStrategy, 8) +
      padL(`${k.scheduled}/${k.totalTasks}`, 10) +
      padL(String(k.deliveryGapLateCount), 7) +
      padL((k.deliveryGapLateTotalSec / HOURS).toFixed(1), 12) +
      padL((k.deliveryGapWorstLateSec / HOURS).toFixed(1), 10) +
      padL((k.deliveryGapSlackTotalSec / HOURS).toFixed(1), 10) +
      padL((k.makespanSec / HOURS).toFixed(1), 11) +
      padL(String(k.chainViolations), 6) +
      padL(k.solveTimeMs.toFixed(0), 8) +
      '  ' + row.fingerprint + flag,
    );
  }

  out.push('-'.repeat(132));
  out.push(
    `distinct outcomes: ${cmp.distinctOutcomes} of ${cmp.rows.length} techniques`,
  );
  for (const [fp, keys] of cmp.outcomeGroups) {
    if (keys.length > 1) out.push(`  ${fp}  <-  ${keys.join(', ')}  (IDENTICAL)`);
  }
  const measured = cmp.rows[0]?.kpis;
  if (measured) {
    out.push(
      `orders measured: ${measured.ordersMeasured}` +
      (measured.ordersUndated > 0 ? `, undated (excluded): ${measured.ordersUndated}` : ''),
    );
  }
  out.push('');
  return out.join('\n');
}
