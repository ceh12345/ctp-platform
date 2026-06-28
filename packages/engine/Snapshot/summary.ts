/**
 * Snapshot summary projection — the KB-scale landing read (P6 of the Scheduling
 * Snapshot sprint). A pure projection over the reconstructed landscape: headline
 * counts + per-resource bucketed utilization + alert flags. NO task objects, NO
 * raw calendar intervals — just aggregates, so the Overview heatmap renders
 * without the heavy detail partition.
 *
 * Materials live in tenant config (not the engine landscape), so the one
 * config-derived figure — material shortages — is injected by the API caller via
 * opts; everything else is computed here from the landscape.
 */
import { SchedulingLandscape } from '../Models/Entities/landscape';
import { CTPTask } from '../Models/Entities/task';
import { CTPTaskStateConstants } from '../Models/Core/constants';

const WEEK_SECONDS = 7 * 86_400;

export interface SummaryHeadline {
  feasibilityRate: number;     // scheduled / included, 0..1
  scheduledTasks: number;
  includedTasks: number;
  totalTasks: number;
  conflicts: number;           // included but not scheduled
  lateOrders: number;
  totalOrders: number;
  shortages: number;           // material shortages (injected)
  makespanSeconds: number;
  horizonStartW: number;
  horizonEndW: number;
  bottleneck: { resourceKey: string; name: string; pct: number } | null;
}

export interface SummaryBucketMeta {
  granularity: 'week';
  count: number;
  horizonStartW: number;
  horizonEndW: number;
  bucketSeconds: number;
}

export interface SummaryResourceLoad {
  resourceKey: string;
  name: string;
  workCenter: string | null;
  overallUtilizationPct: number;   // 0..1
  /** Per-bucket utilization (0..1), indexed against bucketMeta. Bare numbers — no timestamps. */
  buckets: number[];
}

export interface SummaryAlert {
  count: number;
  target: string;
}

export interface SummaryDoc {
  headline: SummaryHeadline;
  bucketMeta: SummaryBucketMeta;
  resourceLoad: SummaryResourceLoad[];
  alerts: { conflicts: SummaryAlert; materials: SummaryAlert };
}

export interface SummarizeOptions {
  /** Material shortages count — computed by the API from tenant config + consumption. */
  materialShortages?: number;
}

/** Seconds of [startW,endW) that fall inside the bucket [bStart,bEnd). */
function overlap(startW: number, endW: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(endW, bEnd) - Math.max(startW, bStart));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function summarizeLandscape(
  landscape: SchedulingLandscape,
  opts: SummarizeOptions = {},
): SummaryDoc {
  const horizonStartW = landscape.horizon?.startW ?? 0;
  const horizonEndW = landscape.horizon?.endW ?? 0;
  const span = Math.max(0, horizonEndW - horizonStartW);
  const count = span > 0 ? Math.ceil(span / WEEK_SECONDS) : 0;

  // ── headline task counts + makespan ──
  let totalTasks = 0, scheduledTasks = 0, includedTasks = 0, conflicts = 0;
  let minStart = Number.POSITIVE_INFINITY, maxEnd = Number.NEGATIVE_INFINITY;
  const chainEnd = new Map<string, number>(); // linkId.name → max scheduled end

  landscape.tasks?.forEach((t: CTPTask) => {
    totalTasks++;
    const isScheduled = t.state === CTPTaskStateConstants.SCHEDULED;
    if (isScheduled) scheduledTasks++;
    if (t.includeInSolve || isScheduled) includedTasks++;
    if (t.includeInSolve && !isScheduled) conflicts++;
    if (isScheduled && t.scheduled) {
      minStart = Math.min(minStart, t.scheduled.startW);
      maxEnd = Math.max(maxEnd, t.scheduled.endW);
      const chain = t.linkId?.name;
      if (chain) chainEnd.set(chain, Math.max(chainEnd.get(chain) ?? -Infinity, t.scheduled.endW));
    }
  });
  const makespanSeconds = maxEnd > minStart ? maxEnd - minStart : 0;

  // ── late orders: scheduled chain completion past the order due date ──
  let lateOrders = 0, totalOrders = 0;
  landscape.orders?.forEach((o) => {
    totalOrders++;
    const due = o.dueDate;
    const end = chainEnd.get(o.key);
    if (due && due > 0 && end !== undefined && end > due) lateOrders++;
  });

  // ── per-resource bucketed utilization + bottleneck ──
  const resourceLoad: SummaryResourceLoad[] = [];
  let bottleneck: SummaryHeadline['bottleneck'] = null;

  landscape.resources?.forEach((res) => {
    const buckets = new Array<number>(count).fill(0);
    let totalAvail = 0, totalAssigned = 0;

    for (let b = 0; b < count; b++) {
      const bStart = horizonStartW + b * WEEK_SECONDS;
      const bEnd = Math.min(bStart + WEEK_SECONDS, horizonEndW);
      let avail = 0, assigned = 0;
      for (let n = res.original?.head ?? null; n; n = n.next) avail += overlap(n.data.startW, n.data.endW, bStart, bEnd);
      for (let n = res.assignments?.head ?? null; n; n = n.next) assigned += overlap(n.data.startW, n.data.endW, bStart, bEnd);
      buckets[b] = avail > 0 ? round4(Math.min(1, assigned / avail)) : 0;
      totalAvail += avail;
      totalAssigned += assigned;
    }

    const overallUtilizationPct = totalAvail > 0 ? round4(Math.min(1, totalAssigned / totalAvail)) : 0;
    resourceLoad.push({
      resourceKey: res.key,
      name: res.name,
      workCenter: res.hierarchy?.first ?? null,
      overallUtilizationPct,
      buckets,
    });
    if (!bottleneck || overallUtilizationPct > bottleneck.pct) {
      bottleneck = { resourceKey: res.key, name: res.name, pct: overallUtilizationPct };
    }
  });

  const shortages = opts.materialShortages ?? 0;

  return {
    headline: {
      feasibilityRate: includedTasks > 0 ? round4(scheduledTasks / includedTasks) : 0,
      scheduledTasks, includedTasks, totalTasks,
      conflicts, lateOrders, totalOrders, shortages,
      makespanSeconds, horizonStartW, horizonEndW, bottleneck,
    },
    bucketMeta: { granularity: 'week', count, horizonStartW, horizonEndW, bucketSeconds: WEEK_SECONDS },
    resourceLoad,
    alerts: {
      conflicts: { count: conflicts, target: 'conflicts' },
      materials: { count: shortages, target: 'materials' },
    },
  };
}
