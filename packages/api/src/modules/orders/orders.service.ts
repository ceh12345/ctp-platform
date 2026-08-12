import { Injectable } from '@nestjs/common';
import { CTPDateTime } from '@ctp/engine';
import { ConfigService } from '../../config/config.service';
import { StateService } from '../state/state.service';
import { IOrderData, IWorkOrderGroupData } from '../../config/interfaces/config-store.interface';
import {
  OrdersRowDto,
  OrdersListResponseDto,
  DistinctResponseDto,
} from './dto/orders-row.dto';

/**
 * Sentinel used in distinct lists and filter equality for rows whose value
 * is null OR empty string. Picked as a string so it round-trips through URL
 * query params cleanly. OI-4 in SPRINT-orders-page-rebuild.md.
 */
const EMPTY_SENTINEL = '(none)';

const HIERARCHY_NAMES = new Set(['Customer', 'Project', 'SalesOrder', 'Family']);

export interface ListOrdersParams {
  filters: Record<string, string[]>;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface DistinctParams {
  column: string;
  filters: Record<string, string[]>;
  search?: string;
  limit: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
  ) {}

  /**
   * Projected span per order from the SOLVED landscape: earliest scheduled
   * start and latest scheduled end across the order's tasks.
   *
   * The orders grid is otherwise a pure config-data view; projected dates are
   * a solve output, so they are joined in here rather than stored. Returns an
   * empty map before the first solve, so the columns render blank rather than
   * misleading.
   */
  private projectedSpans(): Map<string, { start: number; end: number }> {
    const spans = new Map<string, { start: number; end: number }>();
    const landscape = this.stateService.getLandscape();
    if (!landscape) return spans;
    landscape.tasks.forEach((task: any) => {
      const orderKey = task.linkId?.name;
      if (!orderKey || !task.scheduled) return;
      const st = task.scheduled.startW, en = task.scheduled.endW;
      if (!(st > 0) || !(en > 0)) return;
      const cur = spans.get(orderKey);
      if (cur === undefined) spans.set(orderKey, { start: st, end: en });
      else {
        if (st < cur.start) cur.start = st;
        if (en > cur.end) cur.end = en;
      }
    });
    return spans;
  }

  listOrders(params: ListOrdersParams): OrdersListResponseDto {
    const all = this.configService.getOrders();
    const groupsByKey = this.indexGroups();
    const spans = this.projectedSpans();
    const statusByKey = deriveStatuses(all, groupsByKey, spans);
    const filtered = applyFilters(all, params.filters, statusByKey, spans);
    const sorted = sortRows(filtered, params.sortBy, params.sortDir, statusByKey, spans);
    const start = (params.page - 1) * params.pageSize;
    const slice = sorted.slice(start, start + params.pageSize);
    return {
      totalCount: all.length,
      filteredCount: sorted.length,
      page: params.page,
      pageSize: params.pageSize,
      rows: slice.map((row) => projectRow(row, groupsByKey, statusByKey, spans)),
    };
  }

  private indexGroups(): Map<string, IWorkOrderGroupData> {
    const groups = this.configService.getWorkOrderGroupsData() ?? [];
    const m = new Map<string, IWorkOrderGroupData>();
    for (const g of groups) m.set(g.key, g);
    return m;
  }

  distinct(params: DistinctParams): DistinctResponseDto {
    const all = this.configService.getOrders();
    const groupsByKey = this.indexGroups();
    const spans = this.projectedSpans();
    const statusByKey = deriveStatuses(all, groupsByKey, spans);
    // Excel-style scoping: strip the requested column from the filter set
    // before computing distincts for it.
    const scopedFilters = { ...params.filters };
    delete scopedFilters[params.column];
    const scoped = applyFilters(all, scopedFilters, statusByKey, spans);

    const counts = new Map<string, number>();
    for (const o of scoped) {
      const v = resolveValue(o, params.column, statusByKey, spans);
      const key = normaliseForGroup(v);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let entries = [...counts.entries()];
    if (params.search) {
      const needle = params.search.toLowerCase();
      entries = entries.filter(([v]) => v.toLowerCase().includes(needle));
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const truncated = entries.length > params.limit;
    const values = entries.slice(0, params.limit).map(([value, count]) => ({
      value: value === EMPTY_SENTINEL ? null : value,
      count,
    }));
    return { column: params.column, values, truncated };
  }
}

// ── Derived status ───────────────────────────────────────────────────────────
// Six-state rollup per SPRINT-orders-page-rebuild.md Visual spec.
// Terminal lifecycle states win over schedule-derived states.
// BLOCKED is a solver concept and is intentionally unused until chain-aware
// solver lands; the colour token stays reserved.

type DerivedStatus = 'ON_TRACK' | 'AT_RISK' | 'LATE' | 'COMPLETED' | 'CANCELLED';

/**
 * Slack (in days) below which a projected-on-time order is flagged AT_RISK —
 * it makes its promise, but any slip breaks it.
 */
const AT_RISK_SLACK_DAYS = 5;

/**
 * Delivery status from CTP'S OWN SCHEDULE, not from Genius dates.
 *
 * Previously this compared the parent Job's Genius `sourceEnd` against
 * wall-clock now, and its `promiseDate` against that same Genius date — so it
 * answered "is Genius's plan overdue?" and never consulted the schedule CTP
 * had just produced. On the 16 July book that put 101 orders in LATE which
 * CTP projects comfortably on time, and 31 in AT_RISK that are actually
 * projected late. CTP reschedules everything, so the status has to come from
 * the projection.
 *
 *   LATE      projected completion runs past the END of the promised day
 *   AT_RISK   makes it, but with <= AT_RISK_SLACK_DAYS to spare
 *   ON_TRACK  makes it with room
 *   null      no assessable commitment — no customer promise (internal /
 *             stock / rework) or nothing scheduled yet. Renders as "—".
 *
 * COMPLETED / CANCELLED still come from `wostatus`: those are facts about the
 * work order, not predictions.
 *
 * The promise is midnight at the START of the promised day (sales-order
 * DateCustomer), so the deadline is promise + 24h — matching orderDaysLate()
 * in the web client.
 */
function deriveStatuses(
  rows: IOrderData[],
  groupsByKey: Map<string, IWorkOrderGroupData>,
  spans: Map<string, { start: number; end: number }>,
): Map<string, DerivedStatus | null> {
  const DAY_MS = 86400000;
  const out = new Map<string, DerivedStatus | null>();
  for (const row of rows) {
    const r = row as any;
    const ws = String(r.wostatus || '').toUpperCase();
    if (ws === 'COMPLETED' || ws === 'COMPLETE') { out.set(row.key, 'COMPLETED'); continue; }
    if (ws === 'CANCELLED' || ws === 'CANCELED') { out.set(row.key, 'CANCELLED'); continue; }

    const promiseIso = r.customerDeliveryDate as string | undefined;
    const span = spans.get(row.key);
    if (!promiseIso || !span) { out.set(row.key, null); continue; }
    const promiseMs = Date.parse(promiseIso);
    if (!Number.isFinite(promiseMs)) { out.set(row.key, null); continue; }

    const deadlineMs = promiseMs + DAY_MS;
    const projectedEndMs = CTPDateTime.toDateTime(span.end).toMillis();
    if (projectedEndMs > deadlineMs) { out.set(row.key, 'LATE'); continue; }
    const slackDays = (deadlineMs - projectedEndMs) / DAY_MS;
    out.set(row.key, slackDays <= AT_RISK_SLACK_DAYS ? 'AT_RISK' : 'ON_TRACK');
  }
  return out;
}

// ── Filter resolution ───────────────────────────────────────────────────────

function applyFilters(
  rows: IOrderData[],
  filters: Record<string, string[]>,
  statusByKey: Map<string, DerivedStatus | null>,
  spans?: Map<string, { start: number; end: number }>,
): IOrderData[] {
  const entries = Object.entries(filters).filter(([, vs]) => vs.length > 0);
  if (entries.length === 0) return rows;
  return rows.filter((row) => {
    for (const [col, vals] of entries) {
      const rowVal = normaliseForGroup(resolveValue(row, col, statusByKey, spans));
      if (!vals.some((v) => v === rowVal)) return false;
    }
    return true;
  });
}

function resolveValue(
  row: IOrderData,
  column: string,
  statusByKey: Map<string, DerivedStatus | null>,
  spans?: Map<string, { start: number; end: number }>,
): string | number | null | undefined {
  // CTP-derived columns. These are not fields on IOrderData — the promise
  // comes off the mapped order, the projections off the solved landscape — so
  // they have to be resolved explicitly or sort/filter silently no-ops on
  // them (the grid still draws a sort arrow, so it looks like it worked).
  switch (column) {
    case 'Customer Promise':
    case 'customerDeliveryDate':
      return (row as any).customerDeliveryDate ?? null;
    case 'Projected Start':
    case 'projectedStart': {
      const span = spans?.get(row.key);
      return span ? CTPDateTime.toDateTime(span.start).toISO() : null;
    }
    case 'Projected End':
    case 'projectedEnd': {
      const span = spans?.get(row.key);
      return span ? CTPDateTime.toDateTime(span.end).toISO() : null;
    }
    case 'Days Late':
    case 'daysLate': {
      // Same rule as the web client's orderDaysLate(): the promise is
      // midnight at the START of the promised day, so the deadline is +24h.
      // Numeric so the sort orders by magnitude, not lexically.
      const promiseIso = (row as any).customerDeliveryDate as string | undefined;
      const span = spans?.get(row.key);
      if (!promiseIso || !span) return null;
      const promiseMs = Date.parse(promiseIso);
      if (!Number.isFinite(promiseMs)) return null;
      const overrunMs = CTPDateTime.toDateTime(span.end).toMillis() - (promiseMs + 86400000);
      return overrunMs <= 0 ? 0 : Math.ceil(overrunMs / 86400000);
    }
  }
  // Direct top-level fields first.
  switch (column) {
    case 'WO':
    case 'key':              return row.key;
    case 'Description':
    case 'name':             return row.name;
    case 'Job':
    case 'groupKey':         return (row as any).groupKey ?? null;
    case 'Due Date':
    case 'dueDate':          return row.dueDate ?? null;
    case 'Status':
    case 'statusLabel':      return statusByKey.get(row.key) ?? null;
    case 'Qty Planned':
    case 'quantityPlanned':  return row.demandQty ?? null;
  }
  // Hierarchies (by slot name).
  if (HIERARCHY_NAMES.has(column) || column === 'Sales Order') {
    const wanted = column === 'Sales Order' ? 'SalesOrder' : column;
    const h = (row as any).hierarchies as { name: string; value: string | null }[] | undefined;
    return h?.find((x) => x.name === wanted)?.value ?? null;
  }
  // Attributes (by attribute name). Handle common UI labels.
  const attrName = column === 'Customer Source' ? 'CustomerSource'
    : column === 'Project Manager' ? 'ProjectManagerName'
    : column === 'Job Type' ? 'JobType'
    : column;
  const a = (row as any).attributes as { name: string; value: string | null }[] | undefined;
  return a?.find((x) => x.name === attrName)?.value ?? null;
}

function normaliseForGroup(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return EMPTY_SENTINEL;
  if (typeof v === 'string' && v === '') return EMPTY_SENTINEL;
  return String(v);
}

// ── Sort ─────────────────────────────────────────────────────────────────────

function sortRows(
  rows: IOrderData[],
  sortBy: string,
  dir: 'asc' | 'desc',
  statusByKey: Map<string, DerivedStatus | null>,
  spans?: Map<string, { start: number; end: number }>,
): IOrderData[] {
  const sign = dir === 'asc' ? 1 : -1;
  const isEmpty = (v: any) => v === null || v === undefined || v === '';
  return [...rows].sort((a, b) => {
    const av = resolveValue(a, sortBy, statusByKey, spans);
    const bv = resolveValue(b, sortBy, statusByKey, spans);
    // Empties sort last in BOTH directions. compareValues puts them last for
    // ascending, but multiplying that by the descending sign flipped them to
    // the top — which buried every populated row under the blanks on any
    // column that has them (the CTP date columns have 129 rows with no
    // customer promise; dueDate never exposed it because it is always set).
    const aEmpty = isEmpty(av), bEmpty = isEmpty(bv);
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return String(a.key).localeCompare(String(b.key));
      return aEmpty ? 1 : -1;
    }
    const cmp = compareValues(av, bv);
    if (cmp !== 0) return cmp * sign;
    // Stable secondary sort by key ascending so output is deterministic.
    return String(a.key).localeCompare(String(b.key));
  });
}

function compareValues(a: any, b: any): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;   // empty sorts last in asc
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

// ── Row projection ───────────────────────────────────────────────────────────

function projectRow(
  row: IOrderData,
  groupsByKey: Map<string, IWorkOrderGroupData>,
  statusByKey: Map<string, DerivedStatus | null>,
  spans: Map<string, { start: number; end: number }>,
): OrdersRowDto {
  const r = row as any;
  const span = spans.get(row.key);
  const hierarchies = (r.hierarchies as { slot: any; name: string; value: string | null }[] | undefined) ?? [];
  const attributes  = (r.attributes  as { name: string; value: string | null }[] | undefined) ?? [];
  const group = r.groupKey ? groupsByKey.get(r.groupKey) : undefined;
  return {
    key:            row.key,
    name:           row.name,
    groupKey:       r.groupKey ?? null,
    groupName:      group?.name ?? null,
    groupSourceEnd: group?.sourceEnd ?? null,
    parentOrderKey: r.parentOrderKey ?? null,
    isHead:         r.parentOrderKey != null && r.parentOrderKey === row.key,
    dueDate:        row.dueDate ?? null,
    customerDeliveryDate: (r.customerDeliveryDate as string | undefined) ?? null,
    projectedStart: span ? CTPDateTime.toDateTime(span.start).toISO() : null,
    projectedEnd:   span ? CTPDateTime.toDateTime(span.end).toISO() : null,
    statusLabel:    statusByKey.get(row.key) ?? null,
    quantityPlanned: typeof row.demandQty === 'number' ? row.demandQty : null,
    hierarchies,
    attributes,
  };
}
