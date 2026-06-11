import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
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
  constructor(private readonly configService: ConfigService) {}

  listOrders(params: ListOrdersParams): OrdersListResponseDto {
    const all = this.configService.getOrders();
    const groupsByKey = this.indexGroups();
    const statusByKey = deriveStatuses(all, groupsByKey);
    const filtered = applyFilters(all, params.filters, statusByKey);
    const sorted = sortRows(filtered, params.sortBy, params.sortDir, statusByKey);
    const start = (params.page - 1) * params.pageSize;
    const slice = sorted.slice(start, start + params.pageSize);
    return {
      totalCount: all.length,
      filteredCount: sorted.length,
      page: params.page,
      pageSize: params.pageSize,
      rows: slice.map((row) => projectRow(row, groupsByKey, statusByKey)),
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
    const statusByKey = deriveStatuses(all, groupsByKey);
    // Excel-style scoping: strip the requested column from the filter set
    // before computing distincts for it.
    const scopedFilters = { ...params.filters };
    delete scopedFilters[params.column];
    const scoped = applyFilters(all, scopedFilters, statusByKey);

    const counts = new Map<string, number>();
    for (const o of scoped) {
      const v = resolveValue(o, params.column, statusByKey);
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

function deriveStatuses(
  rows: IOrderData[],
  groupsByKey: Map<string, IWorkOrderGroupData>,
): Map<string, DerivedStatus> {
  const now = Date.now();
  const out = new Map<string, DerivedStatus>();
  for (const row of rows) {
    const r = row as any;
    const ws = String(r.wostatus || '').toUpperCase();
    if (ws === 'COMPLETED' || ws === 'COMPLETE') { out.set(row.key, 'COMPLETED'); continue; }
    if (ws === 'CANCELLED' || ws === 'CANCELED') { out.set(row.key, 'CANCELLED'); continue; }
    const group = r.groupKey ? groupsByKey.get(r.groupKey) : undefined;
    const endIso = group?.sourceEnd;
    if (!endIso) { out.set(row.key, 'ON_TRACK'); continue; }
    const endMs = Date.parse(endIso);
    if (!Number.isFinite(endMs)) { out.set(row.key, 'ON_TRACK'); continue; }
    if (endMs < now) { out.set(row.key, 'LATE'); continue; }
    const promiseIso = (group as any)?.promiseDate;
    if (promiseIso) {
      const promiseMs = Date.parse(promiseIso);
      if (Number.isFinite(promiseMs) && endMs > promiseMs) { out.set(row.key, 'AT_RISK'); continue; }
    }
    out.set(row.key, 'ON_TRACK');
  }
  return out;
}

// ── Filter resolution ───────────────────────────────────────────────────────

function applyFilters(
  rows: IOrderData[],
  filters: Record<string, string[]>,
  statusByKey: Map<string, DerivedStatus>,
): IOrderData[] {
  const entries = Object.entries(filters).filter(([, vs]) => vs.length > 0);
  if (entries.length === 0) return rows;
  return rows.filter((row) => {
    for (const [col, vals] of entries) {
      const rowVal = normaliseForGroup(resolveValue(row, col, statusByKey));
      if (!vals.some((v) => v === rowVal)) return false;
    }
    return true;
  });
}

function resolveValue(
  row: IOrderData,
  column: string,
  statusByKey: Map<string, DerivedStatus>,
): string | number | null | undefined {
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
  statusByKey: Map<string, DerivedStatus>,
): IOrderData[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = resolveValue(a, sortBy, statusByKey);
    const bv = resolveValue(b, sortBy, statusByKey);
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
  statusByKey: Map<string, DerivedStatus>,
): OrdersRowDto {
  const r = row as any;
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
    statusLabel:    statusByKey.get(row.key) ?? null,
    quantityPlanned: typeof row.demandQty === 'number' ? row.demandQty : null,
    hierarchies,
    attributes,
  };
}
