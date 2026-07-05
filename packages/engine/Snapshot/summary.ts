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

/**
 * Slim per-order status for the Overview demand rail — no task objects.
 * The client resolves the display name from productKey via its product cache,
 * so no `name` is carried here. Serialized columnar (see SummaryOrders) so the
 * 5 keys aren't repeated on every row.
 */
export interface SummaryOrder {
  orderKey: string;
  productKey: string | null;
  fillRate: number;                          // 0..1 (scheduled finished-good qty / demand)
  status: 'late' | 'at-risk' | 'on-track';   // vocabulary matches the UI statusColor(); already
                                             // encodes the due-date verdict, so raw dueW isn't carried
}

/** Column order for the columnar orders encoding. Keep in sync with SummaryOrder. */
export const SUMMARY_ORDER_COLS = ['orderKey', 'productKey', 'fillRate', 'status'] as const;

/** One order as a positional tuple, indexed by SUMMARY_ORDER_COLS. */
export type SummaryOrderRow = [string, string | null, number, SummaryOrder['status']];

/**
 * Columnar orders partition: the column header once + a row tuple per order.
 * Halves the on-disk bytes vs array-of-objects at scale (562 rows no longer
 * repeat 5 key names each). Decode with decodeSummaryOrders().
 */
export interface SummaryOrders {
  cols: typeof SUMMARY_ORDER_COLS;
  rows: SummaryOrderRow[];
}

/** Expand the columnar orders partition back to objects. Tolerates a legacy
 *  array-of-objects payload (older snapshots) so reads never break on upgrade. */
export function decodeSummaryOrders(orders: SummaryOrders | SummaryOrder[] | undefined | null): SummaryOrder[] {
  if (!orders) return [];
  if (Array.isArray(orders)) return orders;
  const { cols, rows } = orders;
  return rows.map((r) => {
    const o: any = {};
    cols.forEach((c, i) => { o[c] = r[i]; });
    return o as SummaryOrder;
  });
}

/** Slim per-conflict row for the Overview conflicts rail — unscheduled included tasks. */
export interface SummaryConflict {
  taskKey: string;
  taskName: string;
  orderKey: string | null;                   // chain/order (linkId.name)
  reason: string;                            // conflictType: availability|capacity|dependency|horizon
  reasonDetail: string;                      // the classified infeasibility reason
  bottleneck: string | null;
}

export interface SummaryDoc {
  headline: SummaryHeadline;
  bucketMeta: SummaryBucketMeta;
  resourceLoad: SummaryResourceLoad[];
  alerts: { conflicts: SummaryAlert; materials: SummaryAlert };
  /** Slim lists so the Overview demand/conflicts rails render without the detail partition. */
  orders: SummaryOrders;
  conflicts: SummaryConflict[];
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
  const chainEnd = new Map<string, number>();        // order.key → max scheduled end
  const chainSchedQty = new Map<string, number>();   // order.key → scheduled finished-good qty
  const chainTaskCount = new Map<string, number>();  // order.key → total task count
  const chainFeasSched = new Map<string, number>();  // order.key → scheduled task count
  const conflictRows: SummaryConflict[] = [];

  landscape.tasks?.forEach((t: CTPTask) => {
    totalTasks++;
    const isScheduled = t.state === CTPTaskStateConstants.SCHEDULED;
    if (isScheduled) scheduledTasks++;
    if (t.includeInSolve || isScheduled) includedTasks++;
    const chain = t.linkId?.name ?? null;
    if (chain) chainTaskCount.set(chain, (chainTaskCount.get(chain) ?? 0) + 1);
    if (t.includeInSolve && !isScheduled) {
      conflicts++;
      const rpt = t.infeasibilityReport;
      conflictRows.push({
        taskKey: t.key,
        taskName: t.name ?? t.key,
        orderKey: chain,
        reason: rpt?.conflictType ?? 'dependency',
        reasonDetail: rpt?.reason ?? 'No feasible placement',
        bottleneck: rpt?.bottleneckSlot ?? null,
      });
    }
    if (isScheduled && t.scheduled) {
      minStart = Math.min(minStart, t.scheduled.startW);
      maxEnd = Math.max(maxEnd, t.scheduled.endW);
      if (chain) {
        chainEnd.set(chain, Math.max(chainEnd.get(chain) ?? -Infinity, t.scheduled.endW));
        chainFeasSched.set(chain, (chainFeasSched.get(chain) ?? 0) + 1);
        // Finished-good output only — mirrors the detail projection's fillRate.
        if (t.outputProductKey && t.outputQty > 0) {
          chainSchedQty.set(chain, (chainSchedQty.get(chain) ?? 0) + t.netOutputQty());
        }
      }
    }
  });
  const makespanSeconds = maxEnd > minStart ? maxEnd - minStart : 0;

  // ── late orders: scheduled chain completion past the order due date ──
  let lateOrders = 0, totalOrders = 0;
  const orderRows: SummaryOrderRow[] = [];
  landscape.orders?.forEach((o) => {
    totalOrders++;
    const dueW = o.dueDate ?? 0;
    const end = chainEnd.get(o.key);
    const isLate = dueW > 0 && end !== undefined && end > dueW;
    if (isLate) lateOrders++;

    const demand = o.demandQty ?? 0;
    let fillRate = demand > 0 ? round4(Math.min(1, (chainSchedQty.get(o.key) ?? 0) / demand)) : 0;
    // Single-unit orders (cases, one-offs): fill from task completion, like the UI.
    if (demand <= 1) {
      const total = chainTaskCount.get(o.key) ?? 0;
      fillRate = total > 0 && (chainFeasSched.get(o.key) ?? 0) === total ? 1 : 0;
    }
    // Matches the UI's deriveOrderStatus: on-track needs ~full fill AND comfortable
    // lead before due (>48h); otherwise at-risk. Late wins over everything.
    const within48h = dueW > 0 && end !== undefined && dueW - end < 48 * 3600;
    const status: SummaryOrder['status'] =
      isLate ? 'late'
      : (fillRate >= 0.99 && !within48h) ? 'on-track'
      : 'at-risk';
    // Columnar tuple — order MUST match SUMMARY_ORDER_COLS. dueW drives `status`
    // above but isn't emitted (no client reads the raw due date).
    orderRows.push([o.key, o.productKey ?? null, fillRate, status]);
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
    orders: { cols: SUMMARY_ORDER_COLS, rows: orderRows },
    conflicts: conflictRows,
  };
}
