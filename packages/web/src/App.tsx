import { useState, useEffect, useCallback, useMemo, useRef, Fragment, CSSProperties, ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const C = {
  bg: "#0a0e17",
  surface: "#111827",
  surface2: "#1a2332",
  border: "#1e293b",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textDim: "#475569",
  accent: "#3b82f6",
  accentGlow: "rgba(59,130,246,0.12)",
  purple: "#8b5cf6",
  green: "#22c55e",
  greenDim: "rgba(34,197,94,0.15)",
  yellow: "#eab308",
  yellowDim: "rgba(234,179,8,0.15)",
  red: "#ef4444",
  redDim: "rgba(239,68,68,0.15)",
  cyan: "#06b6d4",
  orange: "#f97316",
  orangeDim: "rgba(249,115,22,0.15)",
};

const FONT = "'DM Sans','Segoe UI',system-ui,sans-serif";

/* ═══════════════════════════════════════════════════════════════
   API HELPER
   ═══════════════════════════════════════════════════════════════ */

const tenantId = new URLSearchParams(window.location.search).get('tenant') || 'demo-manufacturing';
const API_BASE = import.meta.env.VITE_API_URL ?? '';

type ErrorCategory = 'validation' | 'engine' | 'config' | 'system';

class ApiError extends Error {
  code: string;
  category: ErrorCategory;
  status: number;
  details: any;

  constructor(message: string, code: string, category: ErrorCategory, status: number, details?: any) {
    super(message);
    this.code = code;
    this.category = category;
    this.status = status;
    this.details = details;
  }
}

async function api(path: string, options?: RequestInit) {
  const method = options?.method?.toUpperCase() ?? 'GET';
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const start = performance.now();
  let res: Response;
  try {
    const headers: Record<string, string> = { 'X-Tenant-Id': tenantId };
    if (hasBody) headers['Content-Type'] = 'application/json';
    res = await fetch(`${API_BASE}/v1${path}`, {
      headers,
      ...(hasBody && !options?.body ? { body: '{}' } : {}),
      ...options,
    });
  } catch (networkErr) {
    console.error(`[API network] ${method} ${path} → connection failed:`, networkErr);
    throw new ApiError(
      'Cannot reach the API server. Check that the server is running and try again.',
      'NETWORK_ERROR',
      'system',
      0,
    );
  }

  if (!res.ok) {
    let errorData: any = null;
    try { errorData = await res.json(); } catch { /* no JSON body */ }

    // Proxy returns 500 with no JSON when the API server is down
    if (res.status >= 500 && !errorData) {
      console.error(`[API network] ${method} ${path} → ${res.status} (no JSON body — API server likely down)`);
      throw new ApiError(
        'Cannot reach the API server. Check that the server is running and try again.',
        'NETWORK_ERROR',
        'system',
        res.status,
      );
    }

    const err = errorData?.error || {};
    const apiError = new ApiError(
      err.message || `API error: ${res.status} ${res.statusText}`,
      err.code || 'UNKNOWN',
      err.category || (res.status >= 500 ? 'system' : 'engine'),
      res.status,
      err.details,
    );

    console.error(
      `[API ${apiError.category}] ${method} ${path} → ${res.status}:`,
      apiError.message,
      apiError.details || '',
    );

    throw apiError;
  }

  const elapsed = Math.round(performance.now() - start);
  if (elapsed > 5000) {
    console.warn(`[API] Slow response: ${method} ${path} took ${elapsed}ms`);
  }

  return res.json();
}

/* ═══════════════════════════════════════════════════════════════
   TERMINOLOGY / LOCALE / ACTION HELPERS
   ═══════════════════════════════════════════════════════════════ */

let _terminology: Record<string, string> = {};
let _locale: any = {};

/** Resolve a domain term from tenant terminology config */
function t(key: string, fallback?: string): string {
  return _terminology[key] || fallback || key;
}

/** Resolve an action label from locale config */
function act(key: string, fallback?: string): string {
  return _locale?.actions?.[key] || fallback || key;
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES — locale-aware formatting
   ═══════════════════════════════════════════════════════════════ */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const loc = _locale?.locale || 'en-US';
  const tz = _locale?.timezone;
  return new Date(iso).toLocaleDateString(loc, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const loc = _locale?.locale || 'en-US';
  const tz = _locale?.timezone;
  return new Date(iso).toLocaleDateString(loc, {
    month: 'short', day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const loc = _locale?.locale || 'en-US';
  const tz = _locale?.timezone;
  return new Date(iso).toLocaleTimeString(loc, {
    hour: '2-digit', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

function fmtDayTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const loc = _locale?.locale || 'en-US';
  const tz = _locale?.timezone;
  const d = new Date(iso);
  const day = d.toLocaleDateString(loc, { weekday: 'short', ...(tz ? { timeZone: tz } : {}) });
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  return `${day} ${time}`;
}

function fmtDayTimeRange(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso) return '—';
  const loc = _locale?.locale || 'en-US';
  const tz = _locale?.timezone;
  const s = new Date(startIso);
  const sDay = s.toLocaleDateString(loc, { weekday: 'short', ...(tz ? { timeZone: tz } : {}) });
  const sTime = s.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  if (!endIso) return `${sDay} ${sTime}`;
  const e = new Date(endIso);
  const eDay = e.toLocaleDateString(loc, { weekday: 'short', ...(tz ? { timeZone: tz } : {}) });
  const eTime = e.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  return sDay === eDay ? `${sDay} ${sTime} – ${eTime}` : `${sDay} ${sTime} – ${eDay} ${eTime}`;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** For values already in 0-100 range (feasibilityRate, utilization) */
function fmtPctDirect(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

/** For values in 0-1 range (fillRate, scrapRate) */
function fmtPctFromDecimal(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  const loc = _locale?.locale || 'en-US';
  return v.toLocaleString(loc);
}

// exported for future use in cost display components
export function fmtCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  const loc = _locale?.locale || 'en-US';
  const cur = _locale?.currency || 'USD';
  return value.toLocaleString(loc, {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Get human-readable priority label from a task.
 *  Prefers typedAttributes.priority text (URGENT, ADD-ON, ELECTIVE, etc.)
 *  Falls back to numeric tier: 1-10 RUSH, 11-30 HIGH, 31-70 NORMAL, 71-100 LOW */
function priorityLabel(task: any, overridePriority?: number): string {
  const textPri = Array.isArray(task?.typedAttributes)
    ? task.typedAttributes.find((a: any) => a.name === 'priority')?.value?.value
    : task?.typedAttributes?.priority;
  if (textPri && typeof textPri === 'string' && isNaN(Number(textPri))) return textPri;
  const num = overridePriority ?? task?.priority ?? 100;
  if (num <= 10) return 'RUSH';
  if (num <= 30) return 'HIGH';
  if (num <= 70) return 'NORMAL';
  return 'LOW';
}

function priorityLabelColor(label: string): string {
  switch (label.toUpperCase()) {
    case 'URGENT': case 'RUSH': return '#f44336';
    case 'ADD-ON': case 'HIGH': return '#ff9800';
    case 'ELECTIVE': case 'NORMAL': return '#94a3b8';
    case 'LOW': return '#64748b';
    default: return '#94a3b8';
  }
}

/** Numeric rank for sorting by priority label (lower = higher priority) */
function priorityRank(label: string): number {
  const u = label.toUpperCase();
  if (u === 'URGENT' || u === 'RUSH') return 0;
  if (u === 'ADD-ON' || u === 'HIGH') return 1;
  if (u === 'ELECTIVE' || u === 'NORMAL') return 2;
  if (u === 'LOW') return 3;
  return 2;
}

/** Detect timezone offset from task ISO dates for Gantt axis labels.
 *  When the tenant locale specifies a timezone, compute the real UTC offset
 *  for that zone (using the first scheduled task's date) instead of parsing
 *  the API response offset which may reflect the server's local timezone. */
function detectGanttTz(tasks: any[]): { offsetMs: number; tz: string } {
  const iso = tasks.find((tk: any) => tk.scheduledStart)?.scheduledStart || '';
  const tz = _locale?.timezone;
  if (tz && iso) {
    // Compute the UTC offset for the tenant timezone at the reference date
    const refDate = new Date(iso);
    const utcStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' });
    const localStr = refDate.toLocaleString('en-US', { timeZone: tz });
    const offsetMs = new Date(localStr).getTime() - new Date(utcStr).getTime();
    return { offsetMs, tz };
  }
  // Fallback: parse offset from ISO string
  const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return { offsetMs: 0, tz: tz || 'UTC' };
  const sign = m[1] === '-' ? -1 : 1;
  const hrs = parseInt(m[2]), mins = parseInt(m[3]);
  const offsetMs = sign * (hrs * 60 + mins) * 60000;
  return { offsetMs, tz: tz || (mins === 0 && hrs > 0 ? `Etc/GMT${sign < 0 ? '+' : '-'}${hrs}` : 'UTC') };
}

function getTaskColor(task: any, colors: any): string {
  if (!colors?.taskColors) return '#3b82f6';
  const taskType = (task.type || '').toUpperCase();
  // Process change / changeover / setup / teardown
  if (taskType === 'PROCESS CHANGE' || taskType === 'CHANGEOVER') return colors.taskColors.processChange || colors.taskColors.changeover || '#eab308';
  if (taskType === 'SETUP' || taskType === 'SET_UP') return colors.taskColors.setup || '#eab308';
  if (taskType === 'TEARDOWN' || taskType === 'TEAR_DOWN') return colors.taskColors.teardown || '#eab308';
  if (task.subType === 'CHANGEOVER' || task.subType === 'CHANGE_OVER' || task.subType === 'PROCESS CHANGE') return colors.taskColors.processChange || '#eab308';
  // Match by task name pattern
  const name = task.name || '';
  if (colors.taskColors.byNamePattern) {
    for (const [pattern, color] of Object.entries(colors.taskColors.byNamePattern)) {
      if (name.includes(pattern)) return color as string;
    }
  }
  // Legacy: match by process key
  const process = task.process || '';
  if (colors.taskColors.byProcess?.[process]) return colors.taskColors.byProcess[process];
  return colors.taskColors.default || '#3b82f6';
}

/* ═══════════════════════════════════════════════════════════════
   EXPERIENCE LEVELS
   ═══════════════════════════════════════════════════════════════ */

type ExperienceLevel = 'novice' | 'intermediate' | 'expert';

const EXP_ORDER: ExperienceLevel[] = ['novice', 'intermediate', 'expert'];

/** Returns true if currentLevel >= minLevel */
function showAt(current: ExperienceLevel, min: ExperienceLevel): boolean {
  return EXP_ORDER.indexOf(current) >= EXP_ORDER.indexOf(min);
}

const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string; icon: string; desc: string }[] = [
  { value: 'novice', label: 'Planner', icon: '📋', desc: 'Clean dashboard with key metrics. Best for day-to-day scheduling.' },
  { value: 'intermediate', label: 'Analyst', icon: '📊', desc: 'Scores, breakdowns, and resource modes. For deeper analysis.' },
  { value: 'expert', label: 'Engineer', icon: '⚙', desc: 'Full diagnostic data, solver stats, and strategy tuning.' },
];

const TIME_RANGE_OPTIONS = [
  { label: '3 hours', days: 3 / 24 },
  { label: '6 hours', days: 6 / 24 },
  { label: '8 hours', days: 8 / 24 },
  { label: '12 hours', days: 12 / 24 },
  { label: '24 hours', days: 1 },
];
const ZOOM_LEVELS = [
  ...TIME_RANGE_OPTIONS,
  { label: 'Day', days: 1 },
  { label: '3 Day', days: 3 },
  { label: 'Week', days: 7 },
  { label: '2 Week', days: 14 },
  { label: 'Fit', days: 0 },
];

function deriveOrderStatus(order: any, tasks?: any[]): string {
  const raw = order.fillRate ?? 0;
  // fillRate is a ratio (0.0–N) where 1.0 = 100%. Values > 1 mean overfilled.
  const fillRate = raw > 100 ? raw / 100 : raw;
  const due = order.dueDate ? new Date(order.dueDate).getTime() : 0;

  // For single-unit orders (healthcare cases, etc.), derive fill from task feasibility
  const effectiveFillRate = (order.demandQty ?? 0) <= 1 && tasks
    ? (tasks.filter((tk: any) => tk.orderRef === order.orderKey).length > 0 &&
       tasks.filter((tk: any) => tk.orderRef === order.orderKey).every((tk: any) => tk.feasible && tk.scheduledEnd)
        ? 1.0 : 0)
    : fillRate;

  if (due > 0 && tasks) {
    const orderTasks = tasks.filter((tk: any) => tk.orderRef === order.orderKey && tk.feasible && tk.scheduledEnd);
    const lastEnd = orderTasks.length > 0
      ? Math.max(...orderTasks.map((tk: any) => new Date(tk.scheduledEnd).getTime()))
      : 0;
    if (lastEnd > due) return 'late';
    if (effectiveFillRate < 0.5) return 'at-risk';
    if (lastEnd > 0 && due - lastEnd < 48 * 3600 * 1000) return 'at-risk';
  } else {
    if (effectiveFillRate < 0.5) return 'at-risk';
  }
  if (effectiveFillRate >= 0.99) return 'on-track';
  return 'at-risk';
}

function deriveMaterialStatus(mat: any): string {
  const available = (mat.onHand ?? 0) - (mat.consumed ?? 0);
  const net = available + (mat.incoming ?? 0);
  if (net < 0) return 'shortage';
  if (available < 0) return 'at-risk';
  return 'covered';
}

function statusColor(status: string): string {
  switch (status) {
    case 'on-track': case 'covered': return C.green;
    case 'at-risk': case 'warning': return C.yellow;
    case 'late': case 'shortage': case 'critical': case 'capacity': return C.red;
    case 'availability': return '#9e9e9e';
    case 'dependency': return '#ff9800';
    default: return C.textDim;
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'on-track': case 'covered': return C.greenDim;
    case 'at-risk': case 'warning': return C.yellowDim;
    case 'late': case 'shortage': case 'critical': case 'capacity': return C.redDim;
    case 'availability': return '#9e9e9e18';
    case 'dependency': return '#ff980018';
    default: return 'transparent';
  }
}

function deriveConflicts(tasks: any[], resources: any[], materials: any[]): any[] {
  const conflicts: any[] = [];
  const infeasible = tasks.filter((t: any) => t.included && !t.feasible);
  infeasible.forEach((task: any) => {
    const resKey = task.assignedResources?.[0]?.resourceKey;
    const resource = resources.find((r: any) => r.resourceKey === resKey);
    const orderTasks = task.orderRef
      ? tasks.filter((t: any) => t.orderRef === task.orderRef)
      : [];
    const hasInfeasibleUpstream = orderTasks.some(
      (t: any) => !t.feasible && t.key !== task.key,
    );

    // Build reasonDetail from infeasibilityReport if available
    let reasonDetail: string;
    if (task.infeasibilityReport) {
      const rpt = task.infeasibilityReport;
      const bnSlot = rpt.slots?.find((s: any) => s.isBottleneck);
      if (bnSlot) {
        const blockedNames = bnSlot.resources
          ?.filter((r: any) => r.status === 'blocked' || r.status === 'partial')
          .flatMap((r: any) => (r.blockingTasks || []).map((bt: any) => bt.chainKey || bt.taskName))
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
        reasonDetail = `Bottleneck: ${bnSlot.slotLabel}`;
        if (blockedNames?.length > 0) reasonDetail += ` — blocked by ${blockedNames.join(', ')}`;
      } else {
        reasonDetail = rpt.reason || 'No feasible placement';
      }
    } else if (hasInfeasibleUpstream) {
      reasonDetail = `Blocked by infeasible upstream task in ${task.orderRef}`;
    } else {
      reasonDetail = `No feasible slot on ${resKey || 'any resource'}` +
        (resource ? ` (${resource.utilization.toFixed(0)}% util)` : '');
    }

    // Use conflictType from infeasibility report when available
    let reason: string;
    if (task.infeasibilityReport?.conflictType) {
      reason = task.infeasibilityReport.conflictType;
    } else if (hasInfeasibleUpstream) {
      reason = 'dependency';
    } else {
      reason = 'capacity';
    }

    conflicts.push({
      id: `CFT-${task.key}`,
      taskKey: task.key,
      taskName: task.name,
      orderRef: task.orderRef,
      severity: 'critical',
      reason,
      reasonDetail,
      bottleneckResource: task.infeasibilityReport?.bottleneckSlot || resKey,
      bottleneckUtilization: resource?.utilization || 0,
      infeasibilityReport: task.infeasibilityReport || null,
    });
  });
  materials.forEach((mat: any) => {
    const status = deriveMaterialStatus(mat);
    if (status !== 'shortage' && status !== 'at-risk') return;
    const matKey = mat.materialKey || mat.key;
    const matName = mat.materialName || mat.name;
    const deficit = Math.abs((mat.onHand ?? 0) - (mat.consumed ?? 0));
    const net = (mat.onHand ?? 0) - (mat.consumed ?? 0) + (mat.incoming ?? 0);

    // Find affected tasks and determine material resource mode
    const affected = tasks.filter((t: any) =>
      t.inputMaterials?.some((m: any) => m.productKey === matKey),
    );
    if (affected.length === 0) return;

    // Check if material resource is ON (hard constraint) or TRACK (informational)
    const triggerTask = mat.firstNeedTaskKey
      ? tasks.find((t: any) => t.key === mat.firstNeedTaskKey) || affected[0]
      : affected[0];
    const matRes = triggerTask?.materialResources?.find((r: any) =>
      r.resourceKey === matKey || r.resourceName === matName,
    );
    // Default to TRACK: if no material resource is defined the engine
    // scheduled the task regardless of stock, so it's informational.
    const mode = (matRes?.mode || 'TRACK').toUpperCase();
    const isHardConstraint = mode === 'ON';

    let severity: string;
    let reasonDetail: string;

    if (status === 'shortage' && isHardConstraint) {
      severity = 'critical';
      reasonDetail = `Cannot execute: short ${fmtNum(deficit)} ${mat.unit || 'units'} of ${matName} for ${triggerTask.name || triggerTask.key}`;
    } else if (status === 'shortage') {
      severity = 'warning';
      reasonDetail = `Inventory alert: ${matName} will be short ${fmtNum(deficit)} ${mat.unit || 'units'} — schedule may proceed but stock insufficient`;
    } else {
      // at-risk
      severity = 'warning';
      reasonDetail = `${matName}: tight inventory — ${fmtNum(mat.onHand)} on hand, net ${fmtNum(net)} after incoming`;
    }

    conflicts.push({
      id: `CFT-MAT-${matKey}`,
      taskKey: triggerTask.key,
      taskName: triggerTask.name,
      orderRef: triggerTask.orderRef,
      severity,
      reason: 'material',
      reasonDetail,
      bottleneckResource: null,
      bottleneckUtilization: 0,
      materialKey: matKey,
      materialName: matName,
      materialMode: mode,
    });
  });
  return conflicts;
}

/* ═══════════════════════════════════════════════════════════════
   useSort HOOK
   ═══════════════════════════════════════════════════════════════ */

function useSort(defaultKey: string, defaultDir: 'asc' | 'desc' = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);
  const toggle = useCallback((key: string) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);
  const sorted = useCallback(
    <T,>(data: T[]): T[] => {
      return [...data].sort((a: any, b: any) => {
        const va = a[sortKey] ?? '';
        const vb = b[sortKey] ?? '';
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    },
    [sortKey, sortDir],
  );
  return { sortKey, sortDir, toggle, sorted };
}

/* ═══════════════════════════════════════════════════════════════
   useFilter HOOK
   ═══════════════════════════════════════════════════════════════ */

interface FilterConfig {
  statusField?: string;
  statusDeriver?: (row: any) => string;
}

function useFilter<T>(data: T[], config: FilterConfig) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});

  const distinctValues = useCallback((key: string): string[] => {
    const values = new Set<string>();
    data.forEach((row: any) => {
      const v = row[key];
      if (v != null && v !== '') values.add(String(v));
    });
    return Array.from(values).sort();
  }, [data]);

  const toggleColumnValue = useCallback((column: string, value: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (!next[column]) next[column] = new Set();
      else next[column] = new Set(next[column]);
      if (next[column].has(value)) next[column].delete(value);
      else next[column].add(value);
      if (next[column].size === 0) delete next[column];
      return next;
    });
  }, []);

  const clearColumnFilter = useCallback((column: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      delete next[column];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setSearch('');
    setStatus('all');
    setColumnFilters({});
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (status !== 'all') count++;
    count += Object.keys(columnFilters).length;
    return count;
  }, [search, status, columnFilters]);

  const filtered = useMemo(() => {
    let result = data;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((row: any) =>
        Object.values(row).some(v => {
          if (v == null) return false;
          if (typeof v === 'string') return v.toLowerCase().includes(q);
          if (typeof v === 'number') return String(v).includes(q);
          return false;
        }),
      );
    }

    if (status !== 'all' && (config.statusField || config.statusDeriver)) {
      result = result.filter((row: any) => {
        const rowStatus = config.statusDeriver
          ? config.statusDeriver(row)
          : row[config.statusField!];
        return rowStatus === status;
      });
    }

    for (const [column, values] of Object.entries(columnFilters)) {
      if (values.size > 0) {
        result = result.filter((row: any) => {
          const v = row[column];
          return v != null && values.has(String(v));
        });
      }
    }

    return result;
  }, [data, search, status, columnFilters, config]);

  const setColumnFilter = useCallback((column: string, selected: Set<string>) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (selected.size === 0) delete next[column];
      else next[column] = selected;
      return next;
    });
  }, []);

  return {
    search, setSearch,
    status, setStatus,
    columnFilters, toggleColumnValue, clearColumnFilter, setColumnFilter,
    clearAll,
    activeFilterCount,
    filtered,
    distinctValues,
  };
}

/* ═══════════════════════════════════════════════════════════════
   SMALL UI COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function SortHeader({ label, k, current, dir, onSort, filterProps }: {
  label: string; k: string; current: string; dir: string; onSort: (k: string) => void;
  filterProps?: {
    column: string;
    values: string[];
    selected: Set<string>;
    onChange: (column: string, selected: Set<string>) => void;
  };
}) {
  const active = k === current;
  const isFiltered = filterProps && filterProps.selected.size > 0;
  return (
    <th
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
        color: isFiltered ? C.accent : active ? C.accent : C.textMuted,
        cursor: 'pointer', userSelect: 'none',
        borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span onClick={() => onSort(k)}>
          {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
        {filterProps && (
          <ColumnFilter
            column={filterProps.column}
            values={filterProps.values}
            selected={filterProps.selected}
            onChange={filterProps.onChange}
          />
        )}
      </div>
    </th>
  );
}

/* ── Filter UI Components ──────────────────────────────────────── */

function SearchBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '6px 12px', minWidth: 200,
    }}>
      <span style={{ color: C.textDim, fontSize: 14 }}>&#x1F50D;</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Search...'}
        style={{
          background: 'none', border: 'none', outline: 'none',
          color: C.text, fontSize: 13, flex: 1, fontFamily: FONT,
        }}
      />
      {value && (
        <button onClick={() => onChange('')} style={{
          background: 'none', border: 'none', color: C.textDim,
          cursor: 'pointer', fontSize: 12, padding: '2px 4px',
        }}>&#x2715;</button>
      )}
    </div>
  );
}

function StatusToggles({ options, active, onChange }: {
  options: { value: string; label: string; color?: string; count?: number }[];
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(opt => {
        const isActive = opt.value === active;
        const c = opt.color || C.accent;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)} style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
            fontSize: 12, fontWeight: 600, fontFamily: FONT,
            background: isActive ? c + '22' : 'transparent',
            color: isActive ? c : C.textMuted,
            border: isActive ? `1px solid ${c}44` : '1px solid transparent',
          }}>
            {opt.label}
            {opt.count != null && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>({opt.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ColumnFilter({ column, values, selected, onChange }: {
  column: string;
  values: string[];
  selected: Set<string>;
  onChange: (column: string, selected: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isFiltered = selected.size > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(column, next);
  };

  const selectAll = () => onChange(column, new Set(values));
  const clearAll = () => onChange(column, new Set());

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}
      onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} style={{
        background: isFiltered ? C.accent + '22' : 'none',
        border: isFiltered ? `1px solid ${C.accent}44` : '1px solid transparent',
        borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
        fontSize: 11, color: isFiltered ? C.accent : C.textDim,
        display: 'inline-flex', alignItems: 'center', gap: 2,
      }}>
        <span style={{
          fontSize: 8, transition: 'transform 0.15s',
          transform: open ? 'rotate(180deg)' : 'rotate(0)',
        }}>&#x25BC;</span>
        {isFiltered && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#fff',
            background: C.accent, borderRadius: 8,
            padding: '0 5px', minWidth: 16, textAlign: 'center',
          }}>{selected.size}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 999,
          minWidth: 180, maxHeight: 280, overflow: 'auto',
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: '6px 0',
          fontFamily: FONT,
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 10px 8px',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span onClick={selectAll} style={{
              fontSize: 10, color: C.accent, cursor: 'pointer', fontWeight: 600,
            }}>Select All</span>
            <span onClick={clearAll} style={{
              fontSize: 10, color: C.textMuted, cursor: 'pointer', fontWeight: 600,
            }}>Clear</span>
          </div>

          {[...values].sort().map(val => (
            <div key={val} onClick={() => toggle(val)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 10px', cursor: 'pointer',
              background: selected.has(val) ? `${C.accent}10` : 'transparent',
              transition: 'background 0.1s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${C.accent}15`; }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = selected.has(val) ? `${C.accent}10` : 'transparent';
              }}
            >
              <span style={{
                width: 14, height: 14, borderRadius: 3,
                border: `2px solid ${selected.has(val) ? C.accent : C.border}`,
                background: selected.has(val) ? C.accent : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, color: '#fff', fontWeight: 800, flexShrink: 0,
              }}>
                {selected.has(val) && '\u2713'}
              </span>
              <span style={{ fontSize: 12, color: C.text }}>{val || '\u2014'}</span>
            </div>
          ))}

          {values.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: C.textDim }}>No values</div>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveFilters({ filter }: { filter: ReturnType<typeof useFilter> }) {
  const active = Object.entries(filter.columnFilters).filter(([, s]) => s.size > 0);
  if (active.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '6px 12px', marginBottom: 8,
      background: `${C.accent}08`, borderRadius: 8,
      border: `1px solid ${C.accent}20`,
    }}>
      <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Filters:</span>
      {active.map(([column, selected]) => (
        <span key={column}
          onClick={() => filter.setColumnFilter(column, new Set())}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 12,
            background: `${C.accent}15`, border: `1px solid ${C.accent}30`,
            fontSize: 11, color: C.accent, cursor: 'pointer', fontWeight: 600,
          }}
        >
          {column.replace(/^_/, '')}: {selected.size}
          <span style={{ fontSize: 9, marginLeft: 2 }}>\u2715</span>
        </span>
      ))}
      <span onClick={() => filter.clearAll()} style={{
        fontSize: 10, color: C.textMuted, cursor: 'pointer', marginLeft: 8, fontWeight: 600,
      }}>Clear all</span>
    </div>
  );
}

function FilterBar({ filter, statusOptions, children }: {
  filter: ReturnType<typeof useFilter>;
  statusOptions?: { value: string; label: string; color?: string; count?: number }[];
  children?: ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      marginBottom: 12, padding: '8px 0',
    }}>
      <SearchBox value={filter.search} onChange={filter.setSearch} />

      {statusOptions && (
        <StatusToggles options={statusOptions} active={filter.status} onChange={filter.setStatus} />
      )}

      {children}

      {filter.activeFilterCount > 0 && (
        <button onClick={filter.clearAll} style={{
          background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '4px 12px', color: C.textMuted, fontSize: 12, cursor: 'pointer',
          fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          Clear all ({filter.activeFilterCount})
          <span style={{ fontSize: 10 }}>&#x2715;</span>
        </button>
      )}

      <span style={{ fontSize: 12, color: C.textDim, marginLeft: 'auto' }}>
        {filter.filtered.length} results
      </span>
    </div>
  );
}

function Badge({ label, color }: { label: string; color?: string }) {
  const c = color || statusColor(label);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 9999,
      fontSize: 11, fontWeight: 600, color: c,
      background: statusBg(label), border: `1px solid ${c}33`,
      fontFamily: FONT, textTransform: 'capitalize',
    }}>
      {label}
    </span>
  );
}

function KPI({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: string;
}) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '18px 20px', flex: 1, minWidth: 140, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Ring({ pct, size = 36, color }: { pct: number; size?: number; color?: string }) {
  const norm = pct > 1 ? pct / 100 : pct;
  const c = color || (norm >= 0.9 ? C.green : norm >= 0.5 ? C.yellow : C.red);
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(Math.max(norm, 0), 1));
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function UtilBar({ pct, label, onClick }: { pct: number; label: string; onClick?: () => void }) {
  const color = pct > 90 ? C.red : pct > 70 ? C.yellow : C.green;
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontSize: 13, color: C.textMuted, minWidth: 120, fontFamily: FONT }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`, height: '100%', background: color,
          borderRadius: 4, transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 13, color: C.text, minWidth: 48, textAlign: 'right', fontFamily: FONT }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function Modal({ open, onClose, title, children, width }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 28, minWidth: width || 360, maxWidth: width || 500, maxHeight: '85vh', overflowY: 'auto' as const, fontFamily: FONT,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: C.textMuted, fontSize: 20,
              cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ResourcePreferenceDialog({ open, onClose, selectedTaskKeys, tasks, resourcePreferenceOverrides, onApply, onApplyAndSolve }: {
  open: boolean; onClose: () => void; selectedTaskKeys: string[]; tasks: any[];
  resourcePreferenceOverrides: Record<string, Record<string, string>>;
  onApply: (taskKeys: string[], resourceModes: Record<string, string>) => void;
  onApplyAndSolve: (taskKeys: string[], resourceModes: Record<string, string>) => void;
}) {
  const [localModes, setLocalModes] = useState<Record<string, string>>({});
  const compatResources = useMemo(() => getCompatibleResources(selectedTaskKeys, tasks), [selectedTaskKeys, tasks]);
  const hasCompatData = useMemo(() => selectedTaskKeys.some(k => {
    const t = tasks.find((tk: any) => tk.key === k);
    return t?.compatibleResources?.length > 0;
  }), [selectedTaskKeys, tasks]);

  // Initialize local modes from existing overrides on open
  useEffect(() => {
    if (!open) return;
    const modes: Record<string, string> = {};
    for (const cr of compatResources) {
      // Check if any selected task has an existing override for this resource
      let existingMode: string | null = null;
      for (const taskKey of selectedTaskKeys) {
        const m = resourcePreferenceOverrides[taskKey]?.[cr.resourceKey];
        if (m && !existingMode) existingMode = m;
      }
      modes[cr.resourceKey] = existingMode || cr.defaultMode || 'AVAILABLE';
    }
    setLocalModes(modes);
  }, [open, compatResources, selectedTaskKeys, resourcePreferenceOverrides]);

  if (!open) return null;

  const total = selectedTaskKeys.length;
  const allExcluded = compatResources.length > 0 && compatResources.every(cr => localModes[cr.resourceKey] === 'EXCLUDED');
  const hasChanges = compatResources.some(cr => localModes[cr.resourceKey] !== (cr.defaultMode || 'AVAILABLE'));

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 28, minWidth: 400, maxWidth: 640, width: '90%', fontFamily: FONT,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
            🔀 Resource Preferences
          </h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: C.textMuted, fontSize: 20,
            cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
          }}>✕</button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: 12, color: C.textMuted }}>
          Redirect <strong style={{ color: C.text }}>{total}</strong> selected task{total !== 1 ? 's' : ''} to different resources. The solver will respect these preferences on the next solve.
        </p>

        {!hasCompatData && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: C.yellowDim, border: `1px solid ${C.yellow}33`, marginBottom: 12, fontSize: 11, color: C.yellow }}>
            Full compatibility data not available. Showing assigned resources only.
          </div>
        )}

        {/* Resource table */}
        <div style={{ overflowY: 'auto', flex: 1, maxHeight: 400, marginBottom: 16 }}>
          {/* Header row */}
          <div style={{ display: 'flex', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ flex: 2 }}>Resource</div>
            <div style={{ width: 60, textAlign: 'center' }}>Now</div>
            <div style={{ width: 80, textAlign: 'center' }}>Compatible</div>
            <div style={{ flex: 1, textAlign: 'right' }}>Preference</div>
          </div>

          {compatResources.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
              No compatible resources found for selected tasks.
            </div>
          ) : compatResources.map(cr => {
            const mode = localModes[cr.resourceKey] || 'AVAILABLE';
            const modeDef = RESOURCE_PREF_MODES.find(m => m.value === mode) || RESOURCE_PREF_MODES[2];
            const isPartial = cr.compatibleCount < total;
            return (
              <div key={cr.resourceKey} style={{
                display: 'flex', alignItems: 'center', padding: '8px 10px',
                borderBottom: `1px solid ${C.border}15`,
              }}>
                <div style={{ flex: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cr.resourceKey}</span>
                  {cr.resourceName !== cr.resourceKey && (
                    <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6 }}>{cr.resourceName}</span>
                  )}
                </div>
                <div style={{ width: 60, textAlign: 'center', fontSize: 12, color: cr.currentCount > 0 ? C.text : C.textDim }}>
                  {cr.currentCount}/{total}
                </div>
                <div style={{ width: 80, textAlign: 'center', fontSize: 12, color: isPartial ? C.yellow : C.text }}>
                  {cr.compatibleCount}/{total}
                  {isPartial && <span style={{ fontSize: 10 }}> ⚠</span>}
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  <select
                    value={mode}
                    onChange={e => setLocalModes(prev => ({ ...prev, [cr.resourceKey]: e.target.value }))}
                    style={{
                      background: C.surface2, color: modeDef.color, border: `1px solid ${C.border}`,
                      borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600,
                      fontFamily: FONT, cursor: 'pointer', outline: 'none',
                    }}
                  >
                    {RESOURCE_PREF_MODES.map(m => (
                      <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        {/* Warnings */}
        {allExcluded && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: C.redDim, border: `1px solid ${C.red}33`, marginBottom: 12, fontSize: 11, color: C.red }}>
            All resources excluded — solver cannot schedule these tasks.
          </div>
        )}

        {/* Footer legend */}
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 16 }}>
          <strong>Now</strong> = tasks currently assigned here &nbsp;·&nbsp; <strong>Compatible</strong> = tasks that can run here
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => onApply(selectedTaskKeys, localModes)}
            disabled={!hasChanges}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              fontFamily: FONT, border: `1px solid ${C.purple}55`, background: `${C.purple}22`,
              color: hasChanges ? C.purple : C.textDim, cursor: hasChanges ? 'pointer' : 'default',
              opacity: hasChanges ? 1 : 0.5,
            }}>Apply</button>
          <button onClick={() => onApplyAndSolve(selectedTaskKeys, localModes)}
            disabled={allExcluded}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              fontFamily: FONT, border: `1px solid ${C.accent}55`, background: `${C.accent}22`,
              color: allExcluded ? C.textDim : C.accent, cursor: allExcluded ? 'default' : 'pointer',
              opacity: allExcluded ? 0.5 : 1,
            }}>Apply & Solve</button>
        </div>
      </div>
    </div>
  );
}

function SlidePanel({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 580,
          background: C.bg, borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: C.surface, position: 'sticky', top: 0, zIndex: 1,
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONT }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: C.textMuted, fontSize: 20,
              cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, fontFamily: FONT }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const upper = (mode || 'ON').toUpperCase();
  const color = upper === 'ON' ? C.green : upper === 'TRACK' ? C.cyan : C.textDim;
  const bg = upper === 'ON' ? C.greenDim : upper === 'TRACK' ? 'rgba(6,182,212,0.15)' : 'rgba(71,85,105,0.15)';
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 9999,
      fontSize: 10, fontWeight: 700, color, background: bg,
      border: `1px solid ${color}33`, fontFamily: FONT,
    }}>
      {upper}
    </span>
  );
}

const ORDER_MODES = [
  { value: 'INCLUDE', label: 'Include', color: C.green },
  { value: 'LOCKED', label: 'Locked', color: C.yellow },
  { value: 'EXCLUDE', label: 'Exclude', color: C.textDim },
];
const MATERIAL_MODES = [
  { value: 'TRACK', label: 'Monitored', icon: '◐', color: C.cyan },
  { value: 'ON', label: 'Required', icon: '●', color: C.green },
  { value: 'OFF', label: 'Ignored', icon: '○', color: C.textDim },
];
const RESOURCE_MODES = [
  { value: 'ON', label: 'Required', icon: '●', color: C.green },
  { value: 'TRACK', label: 'Monitored', icon: '◐', color: C.cyan },
  { value: 'OFF', label: 'Ignored', icon: '○', color: C.textDim },
];
const RESOURCE_PREF_MODES = [
  { value: 'REQUIRED',  label: 'Required',  icon: '◉', color: C.green,     desc: 'Must use this resource' },
  { value: 'PREFERRED', label: 'Preferred', icon: '●', color: C.cyan,      desc: 'Try first, fall back if full' },
  { value: 'AVAILABLE', label: 'Available', icon: '○', color: C.textMuted,  desc: 'Solver picks freely (default)' },
  { value: 'EXCLUDED',  label: 'Excluded',  icon: '⊘', color: C.red,       desc: 'Do not use for this task' },
];

function getCompatibleResources(selectedTaskKeys: string[], tasks: any[]): {
  resourceKey: string; resourceName: string; currentCount: number; compatibleCount: number; defaultMode: string;
}[] {
  const resourceMap = new Map<string, {
    resourceKey: string; resourceName: string;
    currentCount: number; compatibleCount: number; defaultMode: string;
  }>();

  for (const taskKey of selectedTaskKeys) {
    const task = tasks.find((t: any) => t.key === taskKey);
    if (!task) continue;

    // Use compatibleResources from API response; fall back to assignedResources
    const compatResources = task.compatibleResources?.length > 0
      ? task.compatibleResources
      : (task.assignedResources ?? []);

    for (const cr of compatResources) {
      if (!resourceMap.has(cr.resourceKey)) {
        resourceMap.set(cr.resourceKey, {
          resourceKey: cr.resourceKey,
          resourceName: cr.resourceName ?? cr.resourceKey,
          currentCount: 0, compatibleCount: 0,
          defaultMode: cr.mode || 'AVAILABLE',
        });
      }
      resourceMap.get(cr.resourceKey)!.compatibleCount++;
    }

    // Count current assignments
    for (const ar of (task.assignedResources ?? [])) {
      const entry = resourceMap.get(ar.resourceKey);
      if (entry) entry.currentCount++;
    }
  }

  return Array.from(resourceMap.values())
    .sort((a, b) => b.currentCount - a.currentCount || b.compatibleCount - a.compatibleCount);
}

function ClickableModeBadge({ mode, modes, onChange }: {
  mode: string;
  modes: { value: string; label: string; color: string }[];
  onChange: (newMode: string) => void;
}) {
  const upper = (mode || modes[0].value).toUpperCase();
  const current = modes.find(m => m.value === upper) || modes[0];
  const nextIdx = (modes.findIndex(m => m.value === upper) + 1) % modes.length;
  const color = current.color;
  const bg = color + '22';
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onChange(modes[nextIdx].value); }}
      title={`Click to change to ${modes[nextIdx].label}`}
      style={{
        display: 'inline-block', padding: '1px 8px', borderRadius: 9999,
        fontSize: 10, fontWeight: 700, color, background: bg,
        border: `1px solid ${color}33`, fontFamily: FONT,
        cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.15s',
      }}
    >
      {current.label}
    </span>
  );
}

function ModeToggle({ mode, modes, onChange }: {
  mode: string;
  modes: { value: string; label: string; icon: string; color: string }[];
  onChange: (newMode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const upper = (mode || modes[0].value).toUpperCase();
  const current = modes.find(m => m.value === upper) || modes[0];
  const color = current.color;
  const bg = color + '22';
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <span
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '1px 8px', borderRadius: 9999,
          fontSize: 10, fontWeight: 700, color, background: bg,
          border: `1px solid ${color}33`, fontFamily: FONT,
          cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.15s',
        }}
      >
        <span style={{ fontSize: 11 }}>{current.icon}</span>
        {current.label}
        <span style={{ fontSize: 8, marginLeft: 2 }}>▼</span>
      </span>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 999, marginTop: 4,
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 4, minWidth: 130, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {modes.map(opt => {
              const isActive = opt.value === upper;
              return (
                <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }} style={{
                  width: '100%', padding: '6px 10px', background: isActive ? opt.color + '15' : 'none',
                  border: 'none', color: opt.color, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                  borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6,
                }} onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.bg; }}
                   onMouseLeave={e => { e.currentTarget.style.background = isActive ? opt.color + '15' : 'none'; }}>
                  <span style={{ fontSize: 12 }}>{opt.icon}</span>
                  {opt.label}
                  {isActive && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SubTabs({ tabs, active, onChange }: {
  tabs: string[]; active: string; onChange: (t: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, fontFamily: FONT,
            background: t === active ? C.accent : 'transparent',
            color: t === active ? '#fff' : C.textMuted,
            transition: 'all 0.15s',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Card({ title, children, style: s }: {
  title?: string; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 20, fontFamily: FONT, ...s,
    }}>
      {title && (
        <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.textMuted }}>
          {title}
        </h4>
      )}
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DETAIL PANELS
   ═══════════════════════════════════════════════════════════════ */

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase',
      letterSpacing: '0.05em', marginBottom: 8, marginTop: 20,
    }}>
      {label}
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', padding: '5px 0',
      fontSize: 13,
    }}>
      <span style={{ color: C.textMuted }}>{label}</span>
      <span style={{ color: color || C.text, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function SummaryRow({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '5px 0', fontSize: 13,
    }}>
      <span style={{ fontSize: 13, minWidth: 20, color }}>{icon}</span>
      <span style={{ color: C.text }}>{text}</span>
    </div>
  );
}

// ── Solve Preview Modal ────────────────────────────────────────────────
interface StrategyOption {
  key: string; label: string; icon: string; short: string;
  detail: string; bestFor: string; time: string; sortOrder: number;
}

const FALLBACK_STRATEGIES: StrategyOption[] = [
  { key: 'Chain', label: 'Chain', icon: '🔗', short: 'Chain-by-chain in priority order', detail: '', bestFor: '', time: '1-5s', sortOrder: 10 },
  { key: 'ChainFirstFit', label: 'First Fit', icon: '⚡', short: 'First chain, full sequence — fastest', detail: '', bestFor: '', time: '< 1s', sortOrder: 20 },
  { key: 'DueDate', label: 'Due Date', icon: '📅', short: 'Earliest due date first', detail: '', bestFor: '', time: '1-5s', sortOrder: 30 },
  { key: 'Greedy', label: 'Greedy', icon: '🎯', short: 'Best individual placement, ignores chains', detail: '', bestFor: '', time: '1-5s', sortOrder: 40 },
  { key: 'ShortestFirst', label: 'Shortest First', icon: '⏱️', short: 'Shortest tasks first (SPT)', detail: '', bestFor: '', time: '1-5s', sortOrder: 50 },
];

interface SolverTierOption {
  key: string; label: string; icon: string; short: string;
  detail: string; defaultStrategy: string; time: string; sortOrder: number;
  solverDepth?: { bumpLimit?: number; tabuTenure?: number; iterationCount?: number };
}

const FALLBACK_TIERS: SolverTierOption[] = [
  { key: 'quick', label: 'Quick', icon: '⚡', short: 'Fast feasibility check', detail: '', defaultStrategy: 'ChainFirstFit', time: '< 1s', sortOrder: 10 },
  { key: 'balanced', label: 'Balanced', icon: '🎯', short: 'Good balance of speed and quality', detail: '', defaultStrategy: 'Chain', time: '1-5s', sortOrder: 20 },
  { key: 'thorough', label: 'Thorough', icon: '🔬', short: 'Deeper search with conflict resolution', detail: '', defaultStrategy: 'Chain', time: '5-30s', sortOrder: 30, solverDepth: { bumpLimit: 10, tabuTenure: 5, iterationCount: 100 } },
  { key: 'best', label: 'Best', icon: '🏆', short: 'Maximum quality, multiple passes', detail: '', defaultStrategy: 'Chain', time: '30s-5m', sortOrder: 40, solverDepth: { bumpLimit: 50, tabuTenure: 10, iterationCount: 1000 } },
];

function SolvePreview({ orders, tasks, materials, resources,
  orderModes, taskPins, taskExcludes, taskUnschedules,
  materialModes, modeOverrides, resourcePreferenceOverrides,
  priorityOverrides, windowOverrides,
  previousOrderModes, previousTaskPins, previousTaskExcludes, previousMaterialModes,
  strategy, onStrategyChange, strategyOptions,
  tier, onTierChange, tierOptions,
  experienceLevel,
  configName, scoringSummary,
  onConfirm, onCancel }: {
  orders: any[]; tasks: any[]; materials: any[]; resources: any[];
  orderModes: Record<string, string>;
  taskPins: Record<string, boolean>;
  taskExcludes: Record<string, boolean>;
  taskUnschedules: Set<string>;
  materialModes?: Record<string, string>;
  modeOverrides?: Record<string, string>;
  resourcePreferenceOverrides?: Record<string, Record<string, string>>;
  priorityOverrides?: Record<string, number>;
  windowOverrides?: Record<string, { startW?: string; endW?: string }>;
  previousOrderModes: Record<string, string>;
  previousTaskPins: Record<string, boolean>;
  previousTaskExcludes: Record<string, boolean>;
  previousMaterialModes?: Record<string, string>;
  strategy: string;
  onStrategyChange: (s: string) => void;
  strategyOptions: StrategyOption[];
  tier: string;
  onTierChange: (t: string) => void;
  tierOptions: SolverTierOption[];
  experienceLevel: ExperienceLevel;
  configName?: string;
  scoringSummary?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Order counts
  const orderSummary = useMemo(() => {
    let included = 0, locked = 0, excluded = 0;
    let includedTasks = 0, lockedTasks = 0, excludedTasks = 0;
    const excludedOrderKeys: string[] = [];

    orders.forEach(o => {
      const mode = orderModes[o.orderKey] || 'INCLUDE';
      const orderTasks = tasks.filter((tk: any) => tk.orderRef === o.orderKey);
      const taskCount = orderTasks.length;

      if (mode === 'INCLUDE') { included++; includedTasks += taskCount; }
      else if (mode === 'LOCKED') { locked++; lockedTasks += taskCount; }
      else if (mode === 'EXCLUDE') { excluded++; excludedTasks += taskCount; excludedOrderKeys.push(o.orderKey); }
    });

    return { included, locked, excluded, includedTasks, lockedTasks, excludedTasks, excludedOrderKeys };
  }, [orders, tasks, orderModes]);

  // Task counts
  const taskSummary = useMemo(() => {
    const pinnedKeys = Object.entries(taskPins).filter(([, v]) => v).map(([k]) => k);
    const excludedKeys = Object.entries(taskExcludes).filter(([, v]) => v).map(([k]) => k);
    const unscheduleKeys = Array.from(taskUnschedules);

    const solvableTasks = tasks.filter((tk: any) => {
      const orderMode = orderModes[tk.orderRef] || 'INCLUDE';
      if (orderMode === 'EXCLUDE' || orderMode === 'LOCKED') return false;
      if (taskExcludes[tk.key]) return false;
      if (taskPins[tk.key]) return false;
      return true;
    });

    return { pinned: pinnedKeys, excluded: excludedKeys, unschedule: unscheduleKeys, toSolve: solvableTasks.length };
  }, [tasks, orderModes, taskPins, taskExcludes, taskUnschedules]);

  // Resource counts
  const resourceSummary = useMemo(() => {
    const active = resources.length;
    const matRequired = materials.filter((m: any) => (materialModes?.[(m.materialKey || m.key) as string] || m.mode || 'TRACK') === 'ON').length;
    const matMonitored = materials.filter((m: any) => (materialModes?.[(m.materialKey || m.key) as string] || m.mode || 'TRACK') === 'TRACK').length;
    const matIgnored = materials.filter((m: any) => (materialModes?.[(m.materialKey || m.key) as string] || m.mode || 'TRACK') === 'OFF').length;
    return { active, matRequired, matMonitored, matIgnored };
  }, [resources, materials, materialModes]);

  // Compute deltas from last solve
  const MODE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    INCLUDE: { label: 'Include', icon: '▶', color: C.green },
    LOCKED: { label: 'Locked', icon: '🔒', color: C.yellow },
    EXCLUDE: { label: 'Exclude', icon: '⏸', color: C.textDim },
    ON: { label: 'Required', icon: '●', color: C.green },
    TRACK: { label: 'Monitored', icon: '○', color: C.yellow },
    OFF: { label: 'Ignored', icon: '–', color: C.textDim },
  };

  const changes = useMemo(() => {
    const deltas: { icon: string; text: string; color: string }[] = [];

    // Order mode changes
    orders.forEach(o => {
      const prev = previousOrderModes[o.orderKey] || 'INCLUDE';
      const curr = orderModes[o.orderKey] || 'INCLUDE';
      if (prev !== curr) {
        const config = MODE_LABELS[curr] || MODE_LABELS.INCLUDE;
        deltas.push({
          icon: config.icon,
          text: `${o.orderKey} changed: ${MODE_LABELS[prev]?.label || prev} → ${config.label}`,
          color: config.color,
        });
      }
    });

    // Task pins
    Object.entries(taskPins).forEach(([key, pinned]) => {
      const wasPinned = previousTaskPins[key] || false;
      if (pinned && !wasPinned) {
        const task = tasks.find((tk: any) => tk.key === key);
        const resKey = task?.assignedResources?.[0]?.resourceKey || '';
        deltas.push({
          icon: '📌',
          text: `${key} pinned${resKey ? ` to ${resKey}` : ''}${task?.scheduledStart ? ` at ${fmtDate(task.scheduledStart)}` : ''}`,
          color: C.yellow,
        });
      } else if (!pinned && wasPinned) {
        deltas.push({ icon: '📌', text: `${key} unpinned`, color: C.textMuted });
      }
    });

    // Task excludes
    Object.entries(taskExcludes).forEach(([key, excl]) => {
      const wasExcluded = previousTaskExcludes[key] || false;
      if (excl && !wasExcluded) {
        deltas.push({ icon: '⏸', text: `${key} excluded from solve`, color: C.textDim });
      } else if (!excl && wasExcluded) {
        deltas.push({ icon: '▶', text: `${key} re-included in solve`, color: C.green });
      }
    });

    // Unschedules
    Array.from(taskUnschedules).forEach(key => {
      deltas.push({ icon: '✕', text: `${key} will be unscheduled`, color: C.red });
    });

    // Material mode changes
    if (materialModes && previousMaterialModes) {
      materials.forEach((m: any) => {
        const key = m.materialKey || m.key;
        const prev = previousMaterialModes[key] || m.mode || 'TRACK';
        const curr = materialModes[key] || m.mode || 'TRACK';
        if (prev !== curr) {
          deltas.push({
            icon: MODE_LABELS[curr]?.icon || '●',
            text: `${m.materialName || key} mode: ${MODE_LABELS[prev]?.label || prev} → ${MODE_LABELS[curr]?.label || curr}`,
            color: MODE_LABELS[curr]?.color || C.textMuted,
          });
        }
      });
    }

    // Resource mode changes
    if (modeOverrides) {
      Object.entries(modeOverrides).forEach(([compoundKey, newMode]) => {
        const parts = compoundKey.split(':');
        if (parts.length >= 3) {
          deltas.push({
            icon: MODE_LABELS[newMode]?.icon || '●',
            text: `${parts[1]} on ${parts[0]} → ${MODE_LABELS[newMode]?.label || newMode}`,
            color: MODE_LABELS[newMode]?.color || C.textMuted,
          });
        }
      });
    }

    // Resource preference overrides
    const PREF_MODE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
      REQUIRED: { label: 'Required', icon: '◉', color: C.green },
      PREFERRED: { label: 'Preferred', icon: '●', color: C.cyan },
      AVAILABLE: { label: 'Available', icon: '○', color: C.textMuted },
      EXCLUDED: { label: 'Excluded', icon: '⊘', color: C.red },
    };
    if (resourcePreferenceOverrides) {
      Object.entries(resourcePreferenceOverrides).forEach(([taskKey, resModes]) => {
        const task = tasks.find((tk: any) => tk.key === taskKey);
        // Find each resource's default mode from compatibleResources
        Object.entries(resModes).forEach(([resKey, mode]) => {
          const cr = task?.compatibleResources?.find((c: any) => c.resourceKey === resKey);
          const defaultMode = cr?.mode || 'AVAILABLE';
          if (mode !== defaultMode) {
            const config = PREF_MODE_LABELS[mode] || PREF_MODE_LABELS.AVAILABLE;
            deltas.push({
              icon: config.icon,
              text: `${taskKey}: ${resKey} → ${config.label}`,
              color: config.color,
            });
          }
        });
      });
    }

    // Priority overrides
    if (priorityOverrides) {
      Object.entries(priorityOverrides).forEach(([taskKey, pri]) => {
        const task = tasks.find((tk: any) => tk.key === taskKey);
        const origPri = task?.priority ?? task?.pri;
        deltas.push({
          icon: '⚡',
          text: `${taskKey} priority: ${origPri ?? '?'} → ${pri}`,
          color: C.yellow,
        });
      });
    }

    // Window overrides
    if (windowOverrides) {
      Object.entries(windowOverrides).forEach(([taskKey, wo]) => {
        const parts: string[] = [];
        if (wo.startW) parts.push(`start → ${fmtDate(wo.startW)}`);
        if (wo.endW) parts.push(`end → ${fmtDate(wo.endW)}`);
        if (parts.length > 0) {
          deltas.push({
            icon: '🕐',
            text: `${taskKey} window: ${parts.join(', ')}`,
            color: C.cyan,
          });
        }
      });
    }

    return deltas;
  }, [orders, tasks, materials, orderModes, taskPins, taskExcludes, taskUnschedules,
      materialModes, modeOverrides, resourcePreferenceOverrides, priorityOverrides, windowOverrides,
      previousOrderModes, previousTaskPins, previousTaskExcludes, previousMaterialModes]);

  // Detect first solve
  const isFirstSolve = changes.length === 0 && !tasks.some((tk: any) => tk.feasible);

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 0, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        fontFamily: FONT, boxShadow: '0 16px 64px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
            Solve Preview
          </h3>
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', color: C.textMuted, fontSize: 20,
            cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {isFirstSolve ? (
            <div style={{ padding: '12px 0', fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                Ready to schedule
              </div>
              <SummaryRow icon="📋" color={C.text}
                text={`${orders.length} orders with ${tasks.length} tasks`} />
              <SummaryRow icon="⚙" color={C.text}
                text={`${resources.length} capacity resources`} />
              <SummaryRow icon="📦" color={C.text}
                text={`${materials.length} materials tracked`} />
            </div>
          ) : (
            <>
              {/* Orders section */}
              <SectionLabel label="Orders" />
              <SummaryRow icon="▶" color={C.green}
                text={`${orderSummary.included} orders included (${orderSummary.includedTasks} tasks)`} />
              {orderSummary.locked > 0 && (
                <SummaryRow icon="🔒" color={C.yellow}
                  text={`${orderSummary.locked} orders locked (${orderSummary.lockedTasks} tasks — won't move)`} />
              )}
              {orderSummary.excluded > 0 && (
                <SummaryRow icon="⏸" color={C.textDim}
                  text={`${orderSummary.excluded} orders excluded (${orderSummary.excludedTasks} tasks — ${orderSummary.excludedOrderKeys.join(', ')})`} />
              )}

              {/* Queued Actions */}
              {(taskSummary.unschedule.length > 0 || taskSummary.pinned.length > 0 || taskSummary.excluded.length > 0) && (
                <div style={{
                  marginBottom: 16, padding: 12, borderRadius: 8,
                  background: C.surface2, border: `1px solid ${C.border}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
                    QUEUED ACTIONS
                  </div>
                  {taskSummary.unschedule.length > 0 && (
                    <div style={{ fontSize: 13, color: C.red, marginBottom: 4 }}>
                      {'\u2715'} Unschedule: {taskSummary.unschedule.map(k =>
                        tasks.find((tt: any) => tt.key === k)?.name || k
                      ).join(', ')}
                    </div>
                  )}
                  {taskSummary.pinned.length > 0 && (
                    <div style={{ fontSize: 13, color: C.accent, marginBottom: 4 }}>
                      {'\uD83D\uDCCC'} Pin: {taskSummary.pinned.map(k =>
                        tasks.find((tt: any) => tt.key === k)?.name || k
                      ).join(', ')}
                    </div>
                  )}
                  {taskSummary.excluded.length > 0 && (
                    <div style={{ fontSize: 13, color: C.textDim }}>
                      {'\u23F8'} Exclude: {taskSummary.excluded.map(k =>
                        tasks.find((tt: any) => tt.key === k)?.name || k
                      ).join(', ')}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, fontStyle: 'italic' }}>
                    Solve will: {[
                      taskSummary.unschedule.length > 0 && `unschedule ${taskSummary.unschedule.length}`,
                      taskSummary.excluded.length > 0 && `exclude ${taskSummary.excluded.length}`,
                      taskSummary.pinned.length > 0 && `pin ${taskSummary.pinned.length}`,
                      `schedule ${taskSummary.toSolve} remaining`,
                    ].filter(Boolean).join(' \u2192 ')}
                  </div>
                </div>
              )}

              {/* Tasks section */}
              <SectionLabel label="Tasks" />
              {taskSummary.pinned.length > 0 && (
                <SummaryRow icon="📌" color={C.yellow}
                  text={`${taskSummary.pinned.length} tasks pinned (${taskSummary.pinned.slice(0, 3).join(', ')}${taskSummary.pinned.length > 3 ? '…' : ''})`} />
              )}
              {taskSummary.excluded.length > 0 && (
                <SummaryRow icon="⏸" color={C.textDim}
                  text={`${taskSummary.excluded.length} tasks excluded (${taskSummary.excluded.slice(0, 3).join(', ')}${taskSummary.excluded.length > 3 ? '…' : ''})`} />
              )}
              {taskSummary.unschedule.length > 0 && (
                <SummaryRow icon="✕" color={C.red}
                  text={`${taskSummary.unschedule.length} tasks to unschedule (${taskSummary.unschedule.slice(0, 3).join(', ')}${taskSummary.unschedule.length > 3 ? '…' : ''})`} />
              )}
              {taskSummary.pinned.length === 0 && taskSummary.excluded.length === 0 && taskSummary.unschedule.length === 0 && (
                <SummaryRow icon="✓" color={C.green} text="No task overrides" />
              )}

              {/* Resources section */}
              <SectionLabel label="Resources & Materials" />
              <SummaryRow icon="⚙" color={C.text}
                text={`${resourceSummary.active} capacity resources active`} />
              <SummaryRow icon="📦" color={C.text}
                text={`${resourceSummary.matMonitored} materials monitored${resourceSummary.matRequired > 0 ? `, ${resourceSummary.matRequired} required` : ''}${resourceSummary.matIgnored > 0 ? `, ${resourceSummary.matIgnored} ignored` : ''}`} />

              {/* Changes from last solve */}
              {changes.length > 0 && (
                <>
                  <SectionLabel label="Changes from Last Solve" />
                  <div style={{
                    background: C.bg, borderRadius: 8, padding: 12,
                    border: `1px solid ${C.border}`,
                  }}>
                    {changes.map((delta, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '4px 0', fontSize: 12, color: delta.color,
                      }}>
                        <span style={{ fontSize: 12, minWidth: 18 }}>{delta.icon}</span>
                        <span>{delta.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px 20px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
            Solver will process <strong style={{ color: C.text }}>{taskSummary.toSolve} tasks</strong> across{' '}
            <strong style={{ color: C.text }}>{resourceSummary.active} resources</strong>
            {taskSummary.pinned.length > 0 && (
              <> with <strong style={{ color: C.yellow }}>{taskSummary.pinned.length} pinned</strong> positions</>
            )}
            {orderSummary.locked > 0 && (
              <> and <strong style={{ color: C.yellow }}>{orderSummary.locked} locked</strong> orders</>
            )}
          </div>

          {/* Tier selector (always visible) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            padding: '10px 12px', background: C.bg, borderRadius: 8,
            border: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>Solver:</span>
            <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center' }}>
              {tierOptions.map(t => {
                const isActive = t.key === tier;
                const tooltip = (
                  <div style={{ maxWidth: 260 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: C.text }}>{t.icon} {t.label}</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>{t.short}</div>
                    {t.detail && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4, marginBottom: 6 }}>{t.detail}</div>}
                    <div style={{ fontSize: 11, color: C.accent }}>Expected: {t.time}</div>
                  </div>
                );
                return (
                  <HoverTooltip key={t.key} content={tooltip}>
                    <button onClick={() => onTierChange(t.key)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, fontFamily: FONT,
                        background: isActive ? C.accent + '22' : 'transparent',
                        color: isActive ? C.accent : C.textMuted,
                        border: isActive ? `1px solid ${C.accent}44` : `1px solid transparent`,
                        display: 'flex', alignItems: 'center', gap: 5,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{t.icon}</span>
                      {t.label}
                    </button>
                  </HoverTooltip>
                );
              })}
            </div>
          </div>

          {/* Dispatching strategy override (intermediate+) */}
          {showAt(experienceLevel, 'intermediate') && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
              padding: '8px 10px', background: C.bg, borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}>
              <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600, whiteSpace: 'nowrap' }}>Dispatch:</span>
              <div style={{ display: 'flex', gap: 2, flex: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                {strategyOptions.map(opt => {
                  const isActive = opt.key === strategy;
                  const tooltip = (
                    <div style={{ maxWidth: 260 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4, color: C.text }}>{opt.icon} {opt.label}</div>
                      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>{opt.short}</div>
                      {opt.detail && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4, marginBottom: 6 }}>{opt.detail}</div>}
                      {opt.bestFor && <div style={{ fontSize: 11, color: C.accent }}>Best for: {opt.bestFor}</div>}
                    </div>
                  );
                  return (
                    <HoverTooltip key={opt.key} content={tooltip}>
                      <button onClick={() => onStrategyChange(opt.key)}
                        style={{
                          padding: '4px 7px', borderRadius: 5, cursor: 'pointer',
                          fontSize: 10, fontWeight: 600, fontFamily: FONT,
                          background: isActive ? C.accent + '22' : 'transparent',
                          color: isActive ? C.accent : C.textMuted,
                          border: isActive ? `1px solid ${C.accent}44` : `1px solid transparent`,
                          display: 'flex', alignItems: 'center', gap: 3,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ fontSize: 10 }}>{opt.icon}</span>
                        {opt.label}
                      </button>
                    </HoverTooltip>
                  );
                })}
              </div>
            </div>
          )}

          {/* Solver depth parameters (expert only, read-only placeholder) */}
          {showAt(experienceLevel, 'expert') && (() => {
            const activeTier = tierOptions.find(t => t.key === tier);
            const depth = activeTier?.solverDepth;
            if (!depth) return null;
            return (
              <div style={{
                display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8,
                padding: '8px 12px', background: C.bg, borderRadius: 8,
                border: `1px solid ${C.border}`, opacity: 0.6,
              }}>
                <span style={{ fontSize: 11, color: C.textDim, fontWeight: 600 }}>Depth:</span>
                {depth.bumpLimit != null && <span style={{ fontSize: 11, color: C.textDim }}>Bumps: {depth.bumpLimit}</span>}
                {depth.tabuTenure != null && <span style={{ fontSize: 11, color: C.textDim }}>Tabu: {depth.tabuTenure}</span>}
                {depth.iterationCount != null && <span style={{ fontSize: 11, color: C.textDim }}>Iters: {depth.iterationCount}</span>}
                <span style={{ fontSize: 10, color: C.textDim, fontStyle: 'italic', marginLeft: 'auto' }}>read-only</span>
              </div>
            );
          })()}

          {/* Active config + scoring summary */}
          {configName && (
            <div style={{
              padding: '8px 12px', background: C.bg, borderRadius: 8,
              border: `1px solid ${C.border}`, marginBottom: 8,
            }}>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
                Configuration: <span style={{ color: C.text, fontWeight: 600 }}>{configName}</span>
              </div>
              {scoringSummary && (
                <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.6 }}>
                  {scoringSummary}
                </div>
              )}
            </div>
          )}

          <div style={{ height: 8 }} />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onCancel} style={{
              padding: '8px 20px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            }}>
              Cancel
            </button>
            <button onClick={onConfirm} style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: C.accent, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              ▶ Solve Now
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, textAlign: 'center' }}>
            Tip: Shift+Click the Solve button to skip this preview
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Solve Results Dialog — post-solve summary
// ═══════════════════════════════════════════════════════════════

interface SolveSnapshot {
  scheduledTasks: number;
  includedTasks: number;
  feasibilityRate: number;
  makespan: number;
  totalScore?: number;
}

// ═══════════════════════════════════════════════════════════════
// Solve Replay — types and helpers
// ═══════════════════════════════════════════════════════════════

type SolveAction =
  | 'anchor' | 'schedule' | 'infeasible' | 'bump' | 'bump-remove'
  | 'retry' | 'retry-success' | 'retry-fail' | 'skip'
  | 'chain-start' | 'chain-end';

interface SolveStep {
  sequence: number;
  action: SolveAction;
  taskKey: string;
  chainKey: string | null;
  resourceKey: string | null;
  resourceName: string | null;
  startTime: string | null;
  endTime: string | null;
  score: number | null;
  reason: string | null;
  chainPhase: string | null;
  bumpTarget: string | null;
}

interface ReplayState {
  active: boolean;
  steps: SolveStep[];
  currentStep: number;
  playing: boolean;
  speed: number;
  visibleTasks: Set<string>;
  flashAction: SolveAction | null;
  flashTaskKey: string | null;
}

const REPLAY_INITIAL: ReplayState = {
  active: false, steps: [], currentStep: 0,
  playing: false, speed: 500,
  visibleTasks: new Set(), flashAction: null, flashTaskKey: null,
};

function fmtReplayTime(iso: string | null): string {
  if (!iso) return '';
  const loc = _locale?.locale || 'en-US';
  const tz = _locale?.timezone;
  return new Date(iso).toLocaleTimeString(loc, {
    hour: '2-digit', minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

const ANCHOR_LABELS: Record<string, string> = {
  completed: '✓ Anchor (completed)',
  running: '● Anchor (running)',
  on_hold: '⚠ Anchor (on hold)',
  dispatched: '◆ Anchor (dispatched)',
  pinned: '📌 Anchor (pinned)',
};

function describeStep(step: SolveStep): string {
  switch (step.action) {
    case 'anchor': {
      const label = ANCHOR_LABELS[step.reason || ''] || 'Anchor';
      return `${label}: ${step.taskKey} → ${step.resourceName || '?'} ${fmtReplayTime(step.startTime)}–${fmtReplayTime(step.endTime)}`;
    }
    case 'chain-start':
      return `Evaluating chain: ${step.chainKey}`;
    case 'schedule':
      return `${step.taskKey} → ${step.resourceName || '?'} ${fmtReplayTime(step.startTime)}–${fmtReplayTime(step.endTime)}${step.score != null ? ` score: ${step.score.toFixed(1)}` : ''}`;
    case 'infeasible':
      return `${step.taskKey} — infeasible${step.reason ? `: ${step.reason}` : ''}`;
    case 'bump':
      return `Bumping chain ${step.bumpTarget} to free resources for ${step.chainKey}`;
    case 'bump-remove':
      return `Removing ${step.taskKey} from ${step.resourceName || '?'}`;
    case 'retry':
      return `Retrying ${step.chainKey || step.taskKey} with freed resources...`;
    case 'retry-success':
      return `${step.taskKey} → ${step.resourceName || '?'} ${fmtReplayTime(step.startTime)}–${fmtReplayTime(step.endTime)}`;
    case 'retry-fail':
      return `${step.taskKey} still infeasible${step.reason ? `: ${step.reason}` : ''}`;
    case 'skip':
      return `Skipped ${step.taskKey}${step.reason ? ` (${step.reason})` : ''}`;
    case 'chain-end':
      return `Chain ${step.chainKey} complete`;
    default:
      return `${step.action}: ${step.taskKey}`;
  }
}

function advanceToStep(targetStep: number, steps: SolveStep[]): Set<string> {
  const visible = new Set<string>();
  for (let i = 0; i < targetStep; i++) {
    const step = steps[i];
    switch (step.action) {
      case 'anchor':
      case 'schedule':
      case 'retry-success':
        visible.add(step.taskKey);
        break;
      case 'bump-remove':
        visible.delete(step.taskKey);
        break;
    }
  }
  return visible;
}

function stepColor(action: SolveAction): string {
  switch (action) {
    case 'anchor': return C.accent;
    case 'schedule': case 'retry-success': return C.green;
    case 'infeasible': case 'retry-fail': return C.red;
    case 'bump': case 'bump-remove': return C.orange;
    case 'chain-start': case 'chain-end': return C.cyan;
    case 'retry': return C.yellow;
    case 'skip': return C.textDim;
    default: return C.textMuted;
  }
}

function stepIcon(action: SolveAction): string {
  switch (action) {
    case 'anchor': return '⚓';
    case 'schedule': return '✓';
    case 'infeasible': return '✗';
    case 'bump': case 'bump-remove': return '⟳';
    case 'retry': return '…';
    case 'retry-success': return '✓';
    case 'retry-fail': return '✗';
    case 'skip': return '–';
    case 'chain-start': return '▸';
    case 'chain-end': return '▪';
    default: return '·';
  }
}

function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HoldDialog({ taskName, onApply, onCancel }: {
  taskName: string;
  onApply: (args: { holdReason: string; holdStart: string; estimatedResumeTime?: string }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [heldSince, setHeldSince] = useState(() => toLocalDatetimeInput(new Date().toISOString()));
  const [estimatedResume, setEstimatedResume] = useState('');

  const applyPreset = (offsetSeconds: number) => {
    const base = heldSince ? new Date(heldSince) : new Date();
    setEstimatedResume(toLocalDatetimeInput(new Date(base.getTime() + offsetSeconds * 1000).toISOString()));
  };

  const inputStyle: CSSProperties = {
    fontSize: 12, padding: '6px 8px', borderRadius: 6,
    background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
  };
  const presetBtnStyle: CSSProperties = {
    fontSize: 11, padding: '6px 10px', borderRadius: 6,
    background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer',
  };
  const labelStyle: CSSProperties = { fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 20, maxWidth: 340, width: '90%', fontFamily: FONT }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Put task on hold</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>{taskName}</div>

        <label style={labelStyle}>Reason (optional)</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Machine breakdown"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 12 }} />

        <label style={labelStyle}>Held since</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <input type="datetime-local" value={heldSince} onChange={e => setHeldSince(e.target.value)}
            style={{ ...inputStyle, flex: 1 }} />
          <button onClick={() => setHeldSince(toLocalDatetimeInput(new Date().toISOString()))} style={presetBtnStyle}>
            Now
          </button>
        </div>

        <label style={labelStyle}>Estimated resume (optional)</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          <input type="datetime-local" value={estimatedResume} onChange={e => setEstimatedResume(e.target.value)}
            style={{ ...inputStyle, flex: 1 }} />
          <button onClick={() => applyPreset(7200)} style={presetBtnStyle}>+2h</button>
          <button onClick={() => applyPreset(14400)} style={presetBtnStyle}>+4h</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8,
            background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => onApply({
            holdReason: reason,
            holdStart: heldSince ? new Date(heldSince).toISOString() : new Date().toISOString(),
            estimatedResumeTime: estimatedResume ? new Date(estimatedResume).toISOString() : undefined,
          })} style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8,
            background: C.accent, border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            ⏸ Hold
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtendWindowDialog({ taskCount, onApply, onCancel }: {
  taskCount: number;
  onApply: (seconds: number) => void;
  onCancel: () => void;
}) {
  const presets = [
    { label: '+1h', seconds: 3600 },
    { label: '+4h', seconds: 14400 },
    { label: '+1 day', seconds: 86400 },
    { label: '+2 days', seconds: 172800 },
    { label: '+1 week', seconds: 604800 },
  ];
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 20, maxWidth: 320, width: '90%',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
          Extend window end
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
          Applying to {taskCount} task{taskCount !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {presets.map(p => (
            <button key={p.label} onClick={() => onApply(p.seconds)} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 8,
              background: C.surface2, border: `1px solid ${C.border}`,
              color: C.text, cursor: 'pointer',
            }}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            fontSize: 12, padding: '6px 16px', borderRadius: 8,
            background: 'transparent', border: `1px solid ${C.border}`,
            color: C.textMuted, cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SolveResultsDialog({ result, previousSnapshot, experienceLevel, onClose, onTaskClick, onViewProblems }: {
  result: any;
  previousSnapshot: SolveSnapshot | null;
  experienceLevel: ExperienceLevel;
  onClose: () => void;
  onTaskClick: (task: any) => void;
  onViewProblems: () => void;
}) {
  const summary = result.summary;
  const stats = result.stats || {};
  const tasks = result.tasks || [];
  const orders = result.orders || [];
  const materials = result.materials || [];

  // Derived data
  const infeasibleTasks = tasks.filter((t: any) => t.included && !t.feasible && t.type !== 'SET_UP' && t.type !== 'TEAR_DOWN');
  const lateOrders = orders.filter((o: any) => {
    if (!o.dueDate) return false;
    const scheduledTasks = tasks.filter((t: any) => t.orderRef === o.orderKey && t.feasible && t.scheduledEnd);
    if (scheduledTasks.length === 0) return false;
    const lastEnd = scheduledTasks.map((t: any) => t.scheduledEnd).sort().pop();
    return lastEnd && new Date(lastEnd) > new Date(o.dueDate);
  });
  const shortages = materials.filter((m: any) => m.firstShortageDate);
  const lowFillOrders = orders.filter((o: any) => o.fillRate < 1 && o.fillRate > 0);

  const hasProblems = infeasibleTasks.length > 0 || lateOrders.length > 0 || shortages.length > 0 || lowFillOrders.length > 0;

  // Average resource utilization
  const resourceUtils = result.resourceUtilization || [];
  const avgUtil = resourceUtils.length > 0
    ? Math.round(resourceUtils.reduce((s: number, r: any) => s + r.utilization, 0) / resourceUtils.length * 10) / 10
    : 0;

  // Previous snapshot comparison
  const prev = previousSnapshot;
  // prevAvgUtil: not stored yet — skip for now

  // Outcome color
  const outcomeColor = summary.unscheduledTasks === 0 ? C.green
    : summary.unscheduledTasks <= 3 ? C.yellow : C.red;
  const outcomeIcon = summary.unscheduledTasks === 0 ? '✅'
    : summary.unscheduledTasks <= 3 ? '⚠️' : '❌';
  const outcomeText = summary.unscheduledTasks === 0 ? 'Solve Complete'
    : `${summary.unscheduledTasks} task${summary.unscheduledTasks !== 1 ? 's' : ''} could not be scheduled`;

  // Delta helper
  const delta = (current: number, previous: number | undefined, suffix: string = '', invert: boolean = false) => {
    if (previous === undefined || previous === null) return null;
    const diff = current - previous;
    if (diff === 0) return <span style={{ color: C.textDim, fontSize: 11 }}> —</span>;
    const isGood = invert ? diff < 0 : diff > 0;
    const arrow = diff > 0 ? '↑' : '↓';
    const sign = diff > 0 ? '+' : '';
    return (
      <span style={{ color: isGood ? C.green : C.red, fontSize: 11, fontWeight: 600 }}>
        {' '}{sign}{Math.round(diff * 10) / 10}{suffix} {arrow}
      </span>
    );
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 0, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        fontFamily: FONT, boxShadow: '0 16px 64px rgba(0,0,0,0.5)',
      }}>
        {/* Header bar */}
        <div style={{
          padding: '16px 24px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: outcomeColor + '10', borderRadius: '16px 16px 0 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>{outcomeIcon}</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{outcomeText}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                {summary.scheduledTasks}/{summary.includedTasks} scheduled
              </div>
            </div>
          </div>
          <span style={{ fontSize: 13, color: C.textDim, fontWeight: 600 }}>
            {(stats.totalTimeMs / 1000).toFixed(1)}s
          </span>
        </div>

        {/* Scrollable content */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>

          {/* Strategy line — always visible, top of content */}
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 12,
            background: C.bg, border: `1px solid ${C.border}`,
            fontSize: 12, color: C.textMuted, display: 'flex', gap: 16, alignItems: 'center',
          }}>
            <span>Strategy: <strong style={{ color: C.text }}>{stats.strategy || 'Chain'}</strong></span>
            {stats.engineVersion && (
              <span>Engine: <strong style={{ color: C.text }}>{stats.engineVersion}</strong></span>
            )}
            {result.solveResult && (
              <span>Contexts: <strong style={{ color: C.text }}>{result.solveResult.contextsEvaluated}</strong></span>
            )}
            {stats.totalScore != null && (
              <span>Score: <strong style={{ color: C.text }}>{Math.round(stats.totalScore)}</strong></span>
            )}
          </div>

          {/* Scorecard — always visible */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Scheduled', value: `${summary.scheduledTasks}/${summary.includedTasks}`,
                delta: delta(summary.scheduledTasks, prev?.scheduledTasks) },
              { label: 'Feasibility', value: `${summary.feasibilityRate}%`,
                delta: delta(summary.feasibilityRate, prev?.feasibilityRate, '%') },
              { label: 'Infeasible', value: String(summary.unscheduledTasks),
                delta: delta(summary.unscheduledTasks, prev ? (prev.includedTasks - prev.scheduledTasks) : undefined, '', true) },
              { label: 'Avg Utilization', value: `${avgUtil}%`, delta: null },
            ].map(kpi => (
              <div key={kpi.label} style={{
                padding: '12px 14px', borderRadius: 10,
                background: C.bg, border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                  {kpi.value}{kpi.delta}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, marginTop: 2 }}>{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Section 2: Problems — only if problems exist */}
          {hasProblems && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel label="Attention Needed" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {infeasibleTasks.length > 0 && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: C.redDim, border: `1px solid ${C.red}22`, fontSize: 12,
                  }}>
                    <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>
                      {infeasibleTasks.length} infeasible task{infeasibleTasks.length !== 1 ? 's' : ''}
                    </div>
                    {infeasibleTasks.slice(0, 5).map((t: any) => {
                      const resNames = (t.assignedResources?.length > 0
                        ? t.assignedResources
                        : t.compatibleResources || []
                      ).map((r: any) => r.resourceName || r.resourceKey).filter(Boolean);
                      return (
                        <div key={t.key}
                          onClick={() => { onTaskClick(t); onClose(); }}
                          style={{ color: C.text, cursor: 'pointer', padding: '3px 0', display: 'flex', flexDirection: 'column' }}
                          onMouseEnter={e => { e.currentTarget.style.color = C.accent; }}
                          onMouseLeave={e => { e.currentTarget.style.color = C.text; }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{t.name}</span>
                            <span style={{ color: C.textDim, fontSize: 11 }}>
                              {t.errors?.[0]?.reason || 'no feasible slot'}
                            </span>
                          </div>
                          {resNames.length > 0 && (
                            <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
                              Resources: {resNames.join(', ')}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {infeasibleTasks.length > 5 && (
                      <div style={{ color: C.textDim, fontSize: 11, marginTop: 4 }}>
                        +{infeasibleTasks.length - 5} more...
                      </div>
                    )}
                  </div>
                )}
                {lateOrders.length > 0 && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: C.yellowDim, border: `1px solid ${C.yellow}22`, fontSize: 12,
                  }}>
                    <div style={{ color: C.yellow, fontWeight: 600, marginBottom: 4 }}>
                      {lateOrders.length} late order{lateOrders.length !== 1 ? 's' : ''}
                    </div>
                    {lateOrders.slice(0, 3).map((o: any) => (
                      <div key={o.orderKey} style={{ color: C.text, padding: '2px 0' }}>
                        {o.name} — due {fmtDate(o.dueDate)}
                      </div>
                    ))}
                  </div>
                )}
                {shortages.length > 0 && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: C.redDim, border: `1px solid ${C.red}22`, fontSize: 12,
                  }}>
                    <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>
                      {shortages.length} material shortage{shortages.length !== 1 ? 's' : ''}
                    </div>
                    {shortages.slice(0, 3).map((m: any) => (
                      <div key={m.materialKey} style={{ color: C.text, padding: '2px 0' }}>
                        {m.materialName}: short {m.shortageQty} {m.unit} at {fmtDate(m.firstShortageDate)}
                      </div>
                    ))}
                  </div>
                )}
                {lowFillOrders.length > 0 && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: `${C.yellow}08`, border: `1px solid ${C.yellow}22`, fontSize: 12,
                  }}>
                    <div style={{ color: C.yellow, fontWeight: 600, marginBottom: 4 }}>
                      {lowFillOrders.length} partially filled order{lowFillOrders.length !== 1 ? 's' : ''}
                    </div>
                    {lowFillOrders.slice(0, 3).map((o: any) => (
                      <div key={o.orderKey} style={{ color: C.text, padding: '2px 0' }}>
                        {o.name}: {Math.round(o.fillRate * 100)}% filled ({o.scheduledQty}/{o.demandQty})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Comparison vs previous (intermediate+) */}
          {showAt(experienceLevel, 'intermediate') && prev && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel label="vs Previous Solve" />
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
              }}>
                {[
                  { label: 'Scheduled', prev: prev.scheduledTasks, cur: summary.scheduledTasks, suffix: '' },
                  { label: 'Feasibility', prev: prev.feasibilityRate, cur: summary.feasibilityRate, suffix: '%' },
                  { label: 'Makespan', prev: Math.round(prev.makespan / 3600), cur: Math.round(summary.makespan / 3600), suffix: 'h', invert: true },
                ].map(row => {
                  const diff = row.cur - row.prev;
                  const isGood = row.invert ? diff < 0 : diff > 0;
                  const color = diff === 0 ? C.textDim : isGood ? C.green : C.red;
                  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '—';
                  return (
                    <div key={row.label} style={{
                      padding: '6px 10px', borderRadius: 6, background: C.bg,
                      border: `1px solid ${C.border}`, fontSize: 12,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ color: C.textMuted }}>{row.label}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ color: C.textDim }}>{row.prev}{row.suffix}</span>
                        <span style={{ color: C.textDim }}> → </span>
                        <span style={{ color, fontWeight: 600 }}>{row.cur}{row.suffix} {arrow}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 5: Solver stats (expert only) */}
          {showAt(experienceLevel, 'expert') && (
            <div style={{ marginBottom: 8 }}>
              <SectionLabel label="Solver Diagnostics" />
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
              }}>
                {[
                  stats.propagationTimeMs != null && { label: 'Propagation', value: `${stats.propagationTimeMs}ms` },
                  stats.windowsTightened != null && { label: 'Windows tightened', value: String(stats.windowsTightened) },
                  stats.bumpsPerformed != null && { label: 'Bumps', value: `${stats.backtrackSuccesses || 0}/${stats.bumpsPerformed}` },
                  stats.iterations != null && { label: 'Iterations', value: String(stats.iterations) },
                  result.solveResult?.contextsEvaluated != null && { label: 'Contexts', value: String(result.solveResult.contextsEvaluated) },
                  stats.contextsPerTask != null && { label: 'Ctx/task', value: String(stats.contextsPerTask) },
                ].filter(Boolean).map((item: any) => (
                  <div key={item.label} style={{
                    padding: '6px 10px', borderRadius: 6, background: C.bg,
                    border: `1px solid ${C.border}`, fontSize: 11,
                  }}>
                    <div style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
                    <div style={{ color: C.textDim, fontSize: 10 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              {stats.scoreBreakdown && (
                <div style={{
                  marginTop: 6, padding: '6px 10px', borderRadius: 6,
                  background: C.bg, border: `1px solid ${C.border}`, fontSize: 11,
                  display: 'flex', gap: 12, flexWrap: 'wrap',
                }}>
                  <span style={{ color: C.textDim, fontWeight: 600 }}>Score breakdown:</span>
                  {Object.entries(stats.scoreBreakdown).map(([key, val]) => (
                    <span key={key} style={{ color: C.text }}>
                      {key.replace('ScoringRule', '')}: <strong>{typeof val === 'number' ? Math.round(val) : JSON.stringify(val)}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: `1px solid ${C.border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          {hasProblems && (
            <button onClick={() => { onViewProblems(); onClose(); }} style={{
              padding: '8px 20px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            }}>
              View Problems
            </button>
          )}
          <button onClick={onClose} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: C.accent, color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            View Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bottleneck Display Components ── */

function ResourceBottleneckPanel({ report }: { report: any }) {
  if (!report) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        padding: '8px 12px', borderRadius: 8, marginBottom: 12,
        background: '#f4433610', border: '1px solid #f4433630',
        fontSize: 12, color: '#f44336',
      }}>
        {report.reason}
      </div>

      {report.combosGenerated > 0 && (
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
          Combos: {report.combosGenerated} tried → {report.combosSurvivedPropagation} survived propagation → {report.combosPassedAssignment} valid
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
        Resource Availability
      </div>

      {report.slots.map((slot: any) => (
        <ResourceSlotRow key={`${slot.slotLabel}-${slot.slotIndex}`} slot={slot} />
      ))}
    </div>
  );
}

function ResourceSlotRow({ slot }: { slot: any }) {
  const [expanded, setExpanded] = useState(slot.isBottleneck);
  const icon = slot.status === 'available' ? '🟢' : slot.status === 'partial' ? '🟡' : '🔴';

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <span>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{slot.slotLabel}</span>
        {slot.isBottleneck && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
            background: '#f4433620', color: '#f44336',
          }}>
            BOTTLENECK
          </span>
        )}
        <span style={{ fontSize: 10, color: C.textDim }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 24, marginTop: 4 }}>
          {slot.resources.map((res: any) => (
            <ResourceBottleneckDetailRow key={res.resourceKey} resource={res} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceBottleneckDetailRow({ resource }: { resource: any }) {
  const icon = resource.status === 'available' ? '🟢' : resource.status === 'partial' ? '🟡' : '🔴';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10 }}>{icon}</span>
        <span style={{ fontSize: 11, flex: 1 }}>{resource.resourceName}</span>
        <span style={{ fontSize: 10, color: C.textDim }}>
          {resource.availableMinutes > 0 ? `${(resource.availableMinutes / 60).toFixed(1)}h free` : 'No availability'}
        </span>
      </div>
      {resource.note && (
        <div style={{ fontSize: 10, color: C.textDim, paddingLeft: 18 }}>{resource.note}</div>
      )}
      {resource.blockingTasks?.map((bt: any) => (
        <div key={bt.taskKey} style={{ fontSize: 10, color: C.textDim, paddingLeft: 18 }}>
          → {bt.taskName}{bt.chainKey ? ` (${bt.chainKey})` : ''} {fmtTime(bt.start)}–{fmtTime(bt.end)}
        </div>
      ))}
    </div>
  );
}

function TaskDetailPanel({ task, tasks, products, colors, onClose, onResourceClick,
  taskPins, taskExcludes, taskUnschedules: _taskUnschedules, orderModes: _orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask, onCancelUnschedule: _onCancelUnschedule,
  onApiUnschedule, onApiPin,
  resourceModeOverrides, onResourceModeChange, experienceLevel = 'novice',
  whereToTaskKey, whereToOptions, onMoveTo, onNavigateToOrders, onTaskClick,
  resourcePreferenceOverrides, onResourcePrefChange, onClearResourceOverrides,
  windowOverrides, onSetWindowOverride,
  priorityOverrides, onSetPriority,
  onApiSchedule, actionLoading, onWhereTo, whereToSource, whereToLoading, onAskAI }: {
  task: any; tasks: any[]; products: any[]; colors: any;
  onClose: () => void; onResourceClick: (r: any) => void;
  taskPins?: Record<string, boolean>;
  taskExcludes?: Record<string, boolean>;
  taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onPinTask?: (key: string, pinned: boolean) => void;
  onExcludeTask?: (key: string, excluded: boolean) => void;
  onUnscheduleTask?: (key: string) => void;
  onCancelUnschedule?: (key: string) => void;
  onApiUnschedule?: (key: string) => Promise<void>;
  onApiPin?: (key: string, pinned: boolean) => Promise<void>;
  resourceModeOverrides?: Record<string, string>;
  onResourceModeChange?: (compoundKey: string, mode: string) => void;
  experienceLevel?: ExperienceLevel;
  whereToTaskKey?: string | null;
  whereToOptions?: any[];
  onMoveTo?: (key: string, option: any) => void;
  onNavigateToOrders?: (orderKey: string) => void;
  onTaskClick?: (task: any) => void;
  resourcePreferenceOverrides?: Record<string, Record<string, string>>;
  onResourcePrefChange?: (taskKey: string, resourceKey: string, mode: string) => void;
  onClearResourceOverrides?: (taskKey: string) => void;
  windowOverrides?: Record<string, { startW?: string; endW?: string }>;
  onSetWindowOverride?: (key: string, win: { startW?: string; endW?: string }) => void;
  priorityOverrides?: Record<string, number>;
  onSetPriority?: (key: string, priority: number) => void;
  onApiSchedule?: (key: string) => Promise<void>;
  actionLoading?: string | null;
  onWhereTo?: (key: string, source?: 'gantt' | 'table' | 'panel') => void;
  whereToSource?: 'gantt' | 'table' | 'panel' | null;
  whereToLoading?: boolean;
  onAskAI?: (task: any) => void;
}) {
  const prodName = task.outputProductKey
    ? (products.find((p: any) => p.key === task.outputProductKey)?.name || task.outputProductKey)
    : null;
  const prodColor = colors ? getTaskColor(task, colors) : C.accent;

  const isPinned = taskPins?.[task.key] || task.pinned || false;
  const isExcluded = taskExcludes?.[task.key] || false;
  // willUnschedule reserved for future use

  const orderChain = task.orderRef
    ? tasks.filter((t: any) => t.orderRef === task.orderRef)
        .sort((a: any, b: any) => {
          const aT = a.scheduledStart ? new Date(a.scheduledStart).getTime() : Infinity;
          const bT = b.scheduledStart ? new Date(b.scheduledStart).getTime() : Infinity;
          return aT - bT;
        })
    : [];

  const actionBtnBase: React.CSSProperties = {
    padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4,
    transition: 'background 0.15s',
  };

  return (
    <SlidePanel open={true} onClose={onClose} title={`${t('task', 'Task')} Detail`}>
      {/* Header badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {taskStatusBadge(task)}
        {task.orderRef && (onNavigateToOrders
          ? <span onClick={() => { onNavigateToOrders(task.orderRef); onClose(); }}
              style={{ color: C.accent, cursor: 'pointer', textDecoration: 'underline', fontSize: 13, fontWeight: 600 }}
              title={`View ${task.orderRef} in Orders`}
            >{task.orderRef}</span>
          : <Badge label={task.orderRef} color={C.purple} />
        )}
        {task.process && <Badge label={task.process} color={C.accent} />}
        {task.cadenceIntervalMinutes != null && <Badge label={`${task.cadenceIntervalMinutes}m cadence`} color={C.purple} />}
        {onAskAI && (
          <button onClick={() => onAskAI(task)} style={{
            ...actionBtnBase, padding: '3px 10px',
            background: `${C.purple}15`, border: `1px solid ${C.purple}55`, color: C.purple,
            marginLeft: 'auto',
          }}>✨ Ask AI</button>
        )}
      </div>

      {/* Schedule + WhereTo buttons for unscheduled tasks */}
      {!task.feasible && !isExcluded && (onApiSchedule || onWhereTo) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {onApiSchedule && (
            <button
              onClick={() => { if (actionLoading !== task.key) onApiSchedule(task.key); }}
              disabled={actionLoading === task.key}
              style={{
                ...actionBtnBase,
                background: C.greenDim, border: `1px solid ${C.green}55`,
                color: actionLoading === task.key ? C.textDim : C.green,
                cursor: actionLoading === task.key ? 'wait' : 'pointer',
              }}
            >{actionLoading === task.key ? '⏳ Scheduling...' : '▶ Schedule'}</button>
          )}
          {onWhereTo && (
            <button
              onClick={() => onWhereTo(task.key, 'panel')}
              style={{
                ...actionBtnBase,
                background: `${C.accent}15`, border: `1px solid ${C.accent}55`,
                color: C.accent,
              }}
            >🗺️ Where To</button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {(onApiPin || onPinTask) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => onApiPin ? onApiPin(task.key, !task.pinned) : onPinTask?.(task.key, !isPinned)} style={{
            ...actionBtnBase,
            background: (task.pinned || isPinned) ? C.yellowDim : 'transparent',
            border: `1px solid ${(task.pinned || isPinned) ? C.yellow : C.border}`,
            color: (task.pinned || isPinned) ? C.yellow : C.textMuted,
          }}>📌 {(task.pinned || isPinned) ? 'Pinned' : 'Pin'}</button>

          <button onClick={() => onExcludeTask?.(task.key, !isExcluded)} style={{
            ...actionBtnBase,
            background: isExcluded ? 'rgba(71,85,105,0.15)' : 'transparent',
            border: `1px solid ${isExcluded ? C.textDim : C.border}`,
            color: isExcluded ? C.textDim : C.textMuted,
          }}>⏸ {isExcluded ? 'Excluded' : 'Exclude'}</button>

          {task.feasible && (
            <button onClick={() => onApiUnschedule ? onApiUnschedule(task.key) : onUnscheduleTask?.(task.key)} style={{
              ...actionBtnBase,
              background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
            }}>✕ Unschedule</button>
          )}
          {task.feasible && onWhereTo && (
            <button onClick={() => onWhereTo(task.key, 'panel')} style={{
              ...actionBtnBase,
              background: `${C.accent}15`, border: `1px solid ${C.accent}55`, color: C.accent,
            }}>🗺️ Where To</button>
          )}
        </div>
      )}

      {/* WhereTo loading in panel */}
      {whereToSource === 'panel' && whereToTaskKey === task.key && whereToLoading && (
        <div style={{ fontSize: 12, color: C.accent, marginTop: 16, textAlign: 'center' }}>
          🗺️ Finding options...
        </div>
      )}
      {/* WhereTo no options in panel */}
      {whereToSource === 'panel' && whereToTaskKey === task.key && !whereToLoading && whereToOptions && whereToOptions.length === 0 && (
        <div style={{ fontSize: 12, color: C.red, marginTop: 16, textAlign: 'center' }}>
          No feasible options found
        </div>
      )}
      {/* WhereTo Available Positions */}
      {whereToTaskKey === task.key && whereToOptions && whereToOptions.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 16, marginBottom: 8 }}>
            🗺️ Available Positions
          </div>
          {task.isOnCriticalPath && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, marginBottom: 8,
              background: '#f9731615', border: '1px solid #f9731630',
              fontSize: 11, color: '#f97316',
            }}>
              {'\u26A1'} This task is on the critical path — moving it may shorten the schedule
            </div>
          )}
          {(whereToSource === 'panel' ? whereToOptions : whereToOptions.slice(0, 5)).map((option: any) => {
            const ghostColor = option.rank === 1 ? C.green : option.rank <= 3 ? C.accent : C.textDim;
            return (
              <div key={option.contextHash}
                onClick={() => onMoveTo?.(whereToTaskKey!, option)}
                style={{
                  padding: '6px 10px', borderRadius: 6, marginBottom: 3, cursor: 'pointer',
                  border: `1px solid ${option.rank === 1 ? C.green : C.border}`,
                  background: option.rank === 1 ? `${C.green}08` : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${C.accent}15`; }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = option.rank === 1 ? `${C.green}08` : 'transparent';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                    #{option.rank} {option.resources.map((r: any) => r.resourceName || r.resourceKey).join(' + ')}
                    {option.isBestOnResource && option.rank > 1 && (
                      <span style={{ fontSize: 9, color: C.accent, fontWeight: 600, marginLeft: 6 }}>best on resource</span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: ghostColor }}>
                    {option.score.toFixed(1)}
                  </span>
                </div>
                {option.latestStart && option.start !== option.latestStart ? (
                  <>
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                      Window: {fmtDayTimeRange(option.start, option.latestStart)}
                    </div>
                    <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>
                      Suggested: {fmtDayTimeRange(option.latestStart, option.latestEnd)} ({fmtDuration(option.duration)})
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                    {fmtDayTimeRange(option.latestStart || option.start, option.latestEnd || option.end)} ({fmtDuration(option.duration)})
                  </div>
                )}
              </div>
            );
          })}
          {whereToOptions.length > 5 && (
            <div style={{ fontSize: 10, color: C.textDim, textAlign: 'center', marginTop: 4 }}>
              +{whereToOptions.length - 5} more{whereToSource !== 'panel' ? ' on Gantt' : ''}
            </div>
          )}
        </>
      )}

      {/* Task Info */}
      <SectionLabel label={`${t('task', 'Task')} Info`} />
      <DetailRow label="Key" value={task.key} />
      <DetailRow label="Name" value={task.name} />

      {/* Schedule */}
      <SectionLabel label={t('schedule', 'Schedule')} />
      <DetailRow label="Start" value={fmtDate(task.scheduledStart)} />
      <DetailRow label="End" value={fmtDate(task.scheduledEnd)} />
      <DetailRow label={t('duration', 'Duration')} value={fmtDuration(task.durationSeconds)} />
      {showAt(experienceLevel, 'intermediate') && (
        <DetailRow label={t('score', 'Score')} value={task.score != null ? task.score.toFixed(2) : '—'} />
      )}

      {/* Priority */}
      <SectionLabel label="Priority" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.textMuted, minWidth: 60 }}>Priority</span>
        <input type="number" min={1} max={100}
          value={priorityOverrides?.[task.key] ?? task.priority ?? 100}
          onChange={e => {
            const v = Math.max(1, Math.min(100, parseInt(e.target.value) || 100));
            onSetPriority?.(task.key, v);
          }}
          style={{
            width: 56, padding: '3px 6px', fontSize: 12, fontFamily: FONT,
            border: `1px solid ${priorityOverrides?.[task.key] !== undefined ? C.purple : C.border}`,
            borderRadius: 4,
            background: priorityOverrides?.[task.key] !== undefined ? C.purple + '08' : 'transparent',
            color: priorityOverrides?.[task.key] !== undefined ? C.purple : C.text,
            fontWeight: priorityOverrides?.[task.key] !== undefined ? 700 : 400,
            textAlign: 'center',
          }} />
        {(() => {
          const lbl = priorityLabel(task, priorityOverrides?.[task.key]);
          const clr = priorityLabelColor(lbl);
          return <span style={{ fontSize: 10, color: clr, fontWeight: 600, padding: '1px 5px', borderRadius: 3, border: `1px solid ${clr}33` }}>{lbl}</span>;
        })()}
        {priorityOverrides?.[task.key] !== undefined && (
          <span onClick={() => onSetPriority?.(task.key, task.priority ?? 100)}
            style={{ fontSize: 11, color: C.textMuted, cursor: 'pointer', textDecoration: 'underline' }}>Reset</span>
        )}
      </div>

      {/* Time Window */}
      <SectionLabel label="Time Window" />
      <DetailRow label="Window Start" value={fmtDate(task.windowStart)} />
      <DetailRow label="Window End" value={fmtDate(task.windowEnd)} />
      {!task.feasible && onSetWindowOverride && (
        <div style={{ marginTop: 4, padding: '8px 10px', borderRadius: 8, background: C.redDim ?? '#fee', border: `1px solid ${C.red}33` }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.red, marginBottom: 6 }}>Infeasible — Extend Window</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => {
              const endMs = new Date(task.windowEnd || task.scheduledEnd || Date.now()).getTime() + 86_400_000;
              onSetWindowOverride(task.key, { startW: task.windowStart || undefined, endW: new Date(endMs).toISOString() });
            }} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.text,
            }}>+1 day</button>
            <button onClick={() => {
              const endMs = new Date(task.windowEnd || task.scheduledEnd || Date.now()).getTime() + 7 * 86_400_000;
              onSetWindowOverride(task.key, { startW: task.windowStart || undefined, endW: new Date(endMs).toISOString() });
            }} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.text,
            }}>+1 week</button>
            <button onClick={() => onSetWindowOverride(task.key, {})} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.text,
            }}>No Window</button>
          </div>
          {windowOverrides?.[task.key] && (
            <div style={{ marginTop: 4, fontSize: 11, color: C.purple, fontWeight: 600 }}>
              Window override pending — solve to apply
            </div>
          )}
        </div>
      )}

      {/* Commitment Level */}
      {task.commitmentLevel && task.commitmentLevel !== 'planned' && task.commitmentLevel !== 'unscheduled' && (
        <>
          <SectionLabel label="Commitment" />
          <DetailRow label="Level" value={(() => {
            const cfg: Record<string, { icon: string; color: string; label: string }> = {
              completed: { icon: '\u2714', color: '#16a34a', label: 'Completed' },
              running: { icon: '\u25CF', color: '#ef4444', label: 'Running' },
              on_hold: { icon: '\u26A0', color: '#f59e0b', label: 'On Hold' },
              dispatched: { icon: '\u25C6', color: '#f97316', label: 'Dispatched' },
              pinned: { icon: '\uD83D\uDCCC', color: '#3b82f6', label: 'Pinned' },
            };
            const c = cfg[task.commitmentLevel] || { icon: '', color: C.text, label: task.commitmentLevel };
            return <span style={{ color: c.color, fontWeight: 600 }}>{c.icon} {c.label}</span>;
          })()} />
          {task.commitmentLevel === 'running' && task.percentComplete > 0 && (
            <>
              <DetailRow label="Progress" value={`${task.percentComplete}%`} color="#ef4444" />
              <div style={{ margin: '4px 0 8px', height: 6, background: C.surface2, borderRadius: 3 }}>
                <div style={{ width: `${task.percentComplete}%`, height: '100%', borderRadius: 3, background: '#ef4444', transition: 'width 0.3s' }} />
              </div>
            </>
          )}
          {task.commitmentLevel === 'running' && task.actualStart && (
            <DetailRow label="Started" value={fmtDate(task.actualStart)} />
          )}
          {task.actualResource && (
            <DetailRow label="Actual Resource" value={task.actualResource} />
          )}
          {task.commitmentLevel === 'on_hold' && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, marginTop: 4, marginBottom: 8,
              background: '#f59e0b15', border: '1px solid #f59e0b30',
              fontSize: 11, color: '#f59e0b',
            }}>
              {'\u26A0'} On Hold{task.holdReason ? ` — ${task.holdReason}` : ''}
              {task.estimatedResumeTime && <div style={{ marginTop: 2, fontSize: 10, color: C.textMuted }}>Est. resume: {fmtDate(task.estimatedResumeTime)}</div>}
            </div>
          )}
          {task.commitmentLevel === 'dispatched' && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, marginTop: 4, marginBottom: 8,
              background: '#f9731615', border: '1px solid #f9731630',
              fontSize: 11, color: '#f97316',
            }}>
              {'\u25C6'} Dispatched{task.materialsPulled ? ' — materials pulled' : ''}
              {task.dispatchedAt && <div style={{ marginTop: 2, fontSize: 10, color: C.textMuted }}>Dispatched: {fmtDate(task.dispatchedAt)}</div>}
            </div>
          )}
        </>
      )}

      {/* Schedule Flexibility (slack) */}
      {task.feasible && task.slack !== undefined && task.slack !== null && (
        <>
          <SectionLabel label="Schedule Flexibility" />
          <DetailRow label="Slack" value={
            task.isOnCriticalPath ? 'Zero (critical path)'
            : task.slack < 60 ? `${Math.round(task.slack)}s`
            : task.slack < 3600 ? `${Math.floor(task.slack / 60)}m`
            : `${Math.floor(task.slack / 3600)}h ${Math.floor((task.slack % 3600) / 60)}m`
          } color={task.isOnCriticalPath ? '#f97316' : task.slack < 1800 ? C.yellow : C.green} />
          {task.isOnCriticalPath && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, marginTop: 4,
              background: '#f9731615', border: '1px solid #f9731630',
              fontSize: 11, color: '#f97316',
            }}>
              {'\u26A1'} On critical path — any delay extends the makespan
            </div>
          )}
          {!task.isOnCriticalPath && task.slack < 1800 && (
            <div style={{
              padding: '6px 10px', borderRadius: 6, marginTop: 4,
              background: C.yellow + '15', border: `1px solid ${C.yellow}30`,
              fontSize: 11, color: C.yellow,
            }}>
              {'\u26A0'} Near-critical — less than 30 minutes of slack
            </div>
          )}
        </>
      )}

      {/* Product Output */}
      {prodName && (
        <>
          <SectionLabel label={`${t('product', 'Product')} Output`} />
          <DetailRow label={t('product', 'Product')} value={<span style={{ color: prodColor }}>{prodName}</span>} />
          <DetailRow label={t('quantity', 'Qty')} value={fmtNum(task.outputQty)} />
          {showAt(experienceLevel, 'intermediate') && (
            <DetailRow label="Scrap Rate" value={task.outputScrapRate != null ? fmtPctFromDecimal(task.outputScrapRate) : '—'} />
          )}
        </>
      )}

      {/* Capacity Resources */}
      {task.assignedResources?.length > 0 && (
        <>
          <SectionLabel label={`Capacity ${t('resources', 'Resources')}`} />
          {task.assignedResources.map((r: any, i: number) => {
            const capKey = `${task.key}:${r.resourceKey}:capacity`;
            const displayMode = resourceModeOverrides?.[capKey] || r.mode || 'ON';
            return (
              <div
                key={i}
                onClick={() => onResourceClick(r)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', marginBottom: 4, borderRadius: 8,
                  background: C.surface, border: `1px solid ${C.border}`, cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = C.surface)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.resourceKey}</span>
                  {r.resourceName && <span style={{ fontSize: 12, color: C.textDim }}>{r.resourceName}</span>}
                  {r.isPrimary && <Badge label="primary" color={C.accent} />}
                </div>
                {onResourceModeChange && showAt(experienceLevel, 'intermediate') ? (
                  <ModeToggle mode={displayMode} modes={RESOURCE_MODES}
                    onChange={(m) => onResourceModeChange(capKey, m)} />
                ) : (
                  showAt(experienceLevel, 'intermediate') ? <ModeBadge mode={displayMode} /> : null
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Resource Preference Overrides */}
      {task.compatibleResources?.length > 0 && (showAt(experienceLevel, 'intermediate') || !task.assignedResources?.length) && (
        <>
          <SectionLabel label="Resource Preference Overrides" />
          {resourcePreferenceOverrides?.[task.key] && Object.keys(resourcePreferenceOverrides[task.key]).length > 0 && (
            <button onClick={() => onClearResourceOverrides?.(task.key)} style={{
              background: 'none', border: 'none', color: C.accent, fontSize: 11,
              cursor: 'pointer', fontFamily: FONT, marginBottom: 8, padding: 0, textDecoration: 'underline',
            }}>Clear Overrides</button>
          )}
          {task.compatibleResources.map((cr: any) => {
            const currentMode = resourcePreferenceOverrides?.[task.key]?.[cr.resourceKey] || cr.mode || 'AVAILABLE';
            const isOverridden = currentMode !== (cr.mode || 'AVAILABLE');
            return (
              <div key={cr.resourceKey} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', marginBottom: 4, borderRadius: 8,
                background: isOverridden ? `${C.purple}08` : C.surface,
                border: `1px solid ${isOverridden ? C.purple + '33' : C.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cr.resourceKey}</span>
                  {cr.resourceName && cr.resourceName !== cr.resourceKey && (
                    <span style={{ fontSize: 12, color: C.textDim }}>{cr.resourceName}</span>
                  )}
                  {isOverridden && <span style={{ fontSize: 10, color: C.purple }}>(override)</span>}
                </div>
                {onResourcePrefChange ? (
                  <ModeToggle mode={currentMode} modes={RESOURCE_PREF_MODES}
                    onChange={(m) => onResourcePrefChange(task.key, cr.resourceKey, m)} />
                ) : (
                  <ModeBadge mode={currentMode} />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Material Resources */}
      {task.materialResources?.length > 0 && (
        <>
          <SectionLabel label={`${t('material', 'Material')} ${t('resources', 'Resources')}`} />
          {task.materialResources.map((r: any, i: number) => {
            const matKey = `${task.key}:${r.resourceKey}:material`;
            const displayMode = resourceModeOverrides?.[matKey] || r.mode || 'TRACK';
            return (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', marginBottom: 4, borderRadius: 8,
                  background: C.surface, border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.resourceKey}</span>
                  {r.resourceName && <span style={{ fontSize: 12, color: C.textDim }}>{r.resourceName}</span>}
                </div>
                {onResourceModeChange && showAt(experienceLevel, 'intermediate') ? (
                  <ModeToggle mode={displayMode} modes={RESOURCE_MODES}
                    onChange={(m) => onResourceModeChange(matKey, m)} />
                ) : (
                  showAt(experienceLevel, 'intermediate') ? <ModeBadge mode={displayMode} /> : null
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Input Materials */}
      {task.inputMaterials?.length > 0 && (
        <>
          <SectionLabel label={`Input ${t('materials', 'Materials')}`} />
          {task.inputMaterials.map((m: any, i: number) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13,
            }}>
              <span style={{ color: C.text, fontWeight: 500 }}>{m.productKey}</span>
              <span style={{ color: C.textMuted }}>
                {fmtNum(m.requiredQty)} {m.unitOfMeasure}
                {m.scrapRate > 0 && showAt(experienceLevel, 'intermediate') && <span style={{ color: C.yellow, marginLeft: 6 }}>({fmtPctFromDecimal(m.scrapRate)} scrap)</span>}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Order Chain */}
      {orderChain.length > 1 && (
        <>
          <SectionLabel label={`Order Chain (${task.orderRef})`} />
          {orderChain.map((t: any, i: number) => {
            const isCurrent = t.key === task.key;
            const clickable = !isCurrent && !!onTaskClick;
            return (
              <div key={t.key}
                onClick={clickable ? () => onTaskClick!(t) : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', marginBottom: 2, borderRadius: 6,
                  background: isCurrent ? C.accentGlow : 'transparent',
                  border: isCurrent ? `1px solid ${C.accent}33` : '1px solid transparent',
                  fontSize: 12,
                  cursor: clickable ? 'pointer' : 'default',
                }}
                onMouseEnter={clickable ? (e) => { e.currentTarget.style.background = `${C.text}08`; } : undefined}
                onMouseLeave={clickable ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: t.feasible ? C.greenDim : C.redDim,
                  color: t.feasible ? C.green : C.red, fontSize: 10, fontWeight: 700,
                }}>
                  {i + 1}
                </span>
                <span style={{
                  color: isCurrent ? C.accent : clickable ? C.text : C.text,
                  fontWeight: isCurrent ? 700 : 400, flex: 1,
                  textDecoration: clickable ? 'underline' : 'none',
                  textDecorationColor: clickable ? C.textDim : undefined,
                  textUnderlineOffset: 2,
                }}>
                  {t.name}
                </span>
                <span style={{ color: C.textDim, fontSize: 11 }}>{fmtDate(t.scheduledStart)}</span>
              </div>
            );
          })}
        </>
      )}

      {/* Infeasibility Bottleneck */}
      {!task.feasible && task.infeasibilityReport && (
        <>
          <SectionLabel label="Infeasibility Analysis" />
          <ResourceBottleneckPanel report={task.infeasibilityReport} />
        </>
      )}

      {/* Errors */}
      {task.errors?.length > 0 && !task.infeasibilityReport && (
        <>
          <SectionLabel label="Errors" />
          {task.errors.map((err: any, i: number) => (
            <div key={i} style={{
              padding: '8px 10px', marginBottom: 4, borderRadius: 6,
              background: C.redDim, border: `1px solid ${C.red}33`, fontSize: 12, color: C.red,
            }}>
              <strong>{err.agent}:</strong> {err.reason}
            </div>
          ))}
        </>
      )}
    </SlidePanel>
  );
}

function ResourceDetailPanel({ resource, tasks, colors, onClose, onTaskClick, onOpenDowntimeEditor }: {
  resource: any; tasks: any[]; colors: any;
  onClose: () => void; onTaskClick: (t: any) => void;
  onOpenDowntimeEditor?: (resourceKey: string) => void;
}) {
  const resTasks = tasks
    .filter((t: any) => t.assignedResources?.some((r: any) => r.resourceKey === resource.resourceKey))
    .sort((a: any, b: any) => {
      const aT = a.scheduledStart ? new Date(a.scheduledStart).getTime() : Infinity;
      const bT = b.scheduledStart ? new Date(b.scheduledStart).getTime() : Infinity;
      return aT - bT;
    });

  const totalHrs = (resource.totalAvailable || 0) / 3600;
  const assignedHrs = (resource.totalAssigned || 0) / 3600;

  return (
    <SlidePanel open={true} onClose={onClose} title={`${t('resource', 'Resource')} Detail`}>
      {/* Resource Info */}
      <SectionLabel label={`${t('resource', 'Resource')} Info`} />
      <DetailRow label="Key" value={resource.resourceKey} />
      <DetailRow label="Name" value={resource.resourceName} />

      {/* Utilization */}
      <SectionLabel label={t('utilization', 'Utilization')} />
      <UtilBar pct={resource.utilization || 0} label={resource.resourceName} />
      <DetailRow label={t('available', 'Available')} value={`${totalHrs.toFixed(1)}h`} />
      <DetailRow label="Assigned" value={`${assignedHrs.toFixed(1)}h`} />

      {/* Net Available */}
      {resource.netAvailable?.length > 0 && (
        <>
          <SectionLabel label={`Net ${t('available', 'Available')} (${resource.netAvailable.length})`} />
          <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 8 }}>
            {resource.netAvailable.map((iv: any, i: number) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', marginBottom: 2, borderRadius: 6,
                background: C.surface, border: `1px solid ${C.border}`, fontSize: 12,
              }}>
                <span style={{ color: C.text }}>{fmtDate(iv.start)}</span>
                <span style={{ color: C.green, fontWeight: 600 }}>{fmtDuration(iv.durationSec)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {resource.netAvailable?.length === 0 && (
        <>
          <SectionLabel label={`Net ${t('available', 'Available')}`} />
          <div style={{ color: C.red, fontSize: 12, padding: '4px 0 8px' }}>Fully booked — no open slots</div>
        </>
      )}

      {/* Downtime History */}
      {(resource.downtimes?.length > 0 || onOpenDowntimeEditor) && (
        <>
          <SectionLabel label={`Downtime${resource.downtimes?.length ? ` (${resource.downtimes.length})` : ''}`} />
          {(resource.downtimes || []).map((dt: any, i: number) => {
            const isActive = dt.status === 'active';
            const isEnded = dt.status === 'ended';
            const fmtDtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            return (
              <div
                key={`dth-${i}`}
                onClick={() => onOpenDowntimeEditor?.(resource.resourceKey)}
                style={{
                  padding: '8px 12px', marginBottom: 4, borderRadius: 8,
                  background: isActive ? 'rgba(234,179,8,0.1)' : C.surface,
                  border: `1px solid ${isActive ? '#eab308' : C.border}`,
                  borderLeft: `3px solid ${isActive ? '#eab308' : isEnded ? C.green : C.accent}`,
                  cursor: onOpenDowntimeEditor ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (onOpenDowntimeEditor) e.currentTarget.style.background = isActive ? 'rgba(234,179,8,0.15)' : C.surface2; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'rgba(234,179,8,0.1)' : C.surface; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, color: isEnded ? C.green : '#eab308' }}>{isEnded ? '✓' : '⚠'}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{dt.reason || 'Downtime'}</span>
                </div>
                <div style={{ fontSize: 11, color: C.textDim, paddingLeft: 18 }}>
                  {fmtDtTime(dt.startTime)} – {dt.indefinite ? '???' : dt.endTime ? fmtDtTime(dt.endTime) : '???'}
                  {isActive && <span style={{ color: '#eab308', fontWeight: 600, marginLeft: 6 }}>(active)</span>}
                </div>
              </div>
            );
          })}
          {resource.downtimes?.length === 0 && (
            <div style={{ color: C.textDim, fontSize: 12, padding: '4px 0 8px' }}>No downtimes recorded</div>
          )}
          {onOpenDowntimeEditor && (
            <button
              onClick={() => onOpenDowntimeEditor(resource.resourceKey)}
              style={{
                background: 'none', border: `1px dashed ${C.border}`, borderRadius: 6,
                color: C.accent, fontSize: 12, fontFamily: FONT, padding: '6px 12px',
                cursor: 'pointer', width: '100%', marginTop: 4, marginBottom: 8,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
            >
              + Schedule Downtime
            </button>
          )}
        </>
      )}

      {/* Task Agenda */}
      <SectionLabel label={`${t('task', 'Task')} Agenda (${resTasks.length})`} />
      {resTasks.length === 0 && (
        <div style={{ color: C.textDim, fontSize: 13, padding: '8px 0' }}>No {t('tasks', 'tasks')} assigned</div>
      )}
      {resTasks.map((t: any) => {
        const prodColor = colors ? getTaskColor(t, colors) : C.accent;
        const assignedRes = t.assignedResources?.find((r: any) => r.resourceKey === resource.resourceKey);
        return (
          <div
            key={t.key}
            onClick={() => onTaskClick(t)}
            style={{
              padding: '10px 12px', marginBottom: 4, borderRadius: 8,
              background: C.surface, border: `1px solid ${C.border}`, cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
            onMouseLeave={e => (e.currentTarget.style.background = C.surface)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 4, height: 24, borderRadius: 2, background: prodColor }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: C.textDim }}>{t.key}</div>
                </div>
              </div>
              {assignedRes && <ModeBadge mode={assignedRes.mode || 'ON'} />}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.textMuted, marginLeft: 12 }}>
              {t.orderRef && <span>{t.orderRef}</span>}
              <span>{fmtDate(t.scheduledStart)} → {fmtDate(t.scheduledEnd)}</span>
            </div>
          </div>
        );
      })}
    </SlidePanel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   RESOURCE AGENDA PANEL
   ═══════════════════════════════════════════════════════════════ */

interface AgendaItem {
  type: 'assignment' | 'available' | 'off-shift' | 'downtime';
  startTime: string;   // ISO datetime
  endTime: string;     // ISO datetime
  durationMinutes: number;
  taskKey?: string;
  taskName?: string;
  orderRef?: string;
  priority?: number;
  processCategory?: string;
  task?: any;          // full task object for click handler
  reason?: string;           // downtime reason
  indefinite?: boolean;      // downtime has no end
  isFullDay?: boolean;       // downtime covers the entire day
}

function buildAgendaItems(
  resource: any, tasks: any[], dayStartMs: number, dayEndMs: number,
): AgendaItem[] {
  // Find availability windows that overlap this day
  const dayAvail: { start: number; end: number }[] = (resource.availability || [])
    .map((iv: any) => ({ start: new Date(iv.start).getTime(), end: new Date(iv.end).getTime() }))
    .filter((iv: { start: number; end: number }) => iv.start < dayEndMs && iv.end > dayStartMs)
    .map((iv: { start: number; end: number }) => ({
      start: Math.max(iv.start, dayStartMs),
      end: Math.min(iv.end, dayEndMs),
    }));

  // Find tasks assigned to this resource on this day
  const dayTasks = tasks
    .filter((t: any) =>
      t.scheduledStart && t.scheduledEnd &&
      t.assignedResources?.some((r: any) => r.resourceKey === resource.resourceKey) &&
      new Date(t.scheduledStart).getTime() < dayEndMs &&
      new Date(t.scheduledEnd).getTime() > dayStartMs
    )
    .map((t: any) => ({
      start: Math.max(new Date(t.scheduledStart).getTime(), dayStartMs),
      end: Math.min(new Date(t.scheduledEnd).getTime(), dayEndMs),
      task: t,
    }))
    .sort((a: any, b: any) => a.start - b.start);

  const items: AgendaItem[] = [];
  const toISO = (ms: number) => new Date(ms).toISOString();
  const toMin = (ms: number) => Math.round(ms / 60000);

  // Working hours bounds
  const workStart = dayAvail.length > 0 ? dayAvail[0].start : null;
  const workEnd = dayAvail.length > 0 ? dayAvail[dayAvail.length - 1].end : null;

  // Off-shift before work
  if (workStart && workStart > dayStartMs) {
    items.push({ type: 'off-shift', startTime: toISO(dayStartMs), endTime: toISO(workStart), durationMinutes: toMin(workStart - dayStartMs) });
  }

  if (workStart && workEnd) {
    let cursor = workStart;
    // Walk each availability window — insert off-shift for gaps between windows
    for (let wi = 0; wi < dayAvail.length; wi++) {
      const win = dayAvail[wi];
      // Off-shift gap between previous window and this one
      if (win.start > cursor) {
        items.push({ type: 'off-shift', startTime: toISO(cursor), endTime: toISO(win.start), durationMinutes: toMin(win.start - cursor) });
        cursor = win.start;
      }
      // Process assignments within this availability window
      for (const dt of dayTasks) {
        if (dt.end <= cursor || dt.start >= win.end) continue; // outside this window
        const effStart = Math.max(dt.start, cursor);
        // Gap before this assignment (within this window)
        if (effStart > cursor) {
          items.push({ type: 'available', startTime: toISO(cursor), endTime: toISO(effStart), durationMinutes: toMin(effStart - cursor) });
        }
        const effEnd = Math.min(dt.end, win.end);
        const dur = toMin(effEnd - effStart);
        items.push({
          type: 'assignment', startTime: toISO(effStart), endTime: toISO(effEnd), durationMinutes: dur,
          taskKey: dt.task.key, taskName: dt.task.name, orderRef: dt.task.orderRef,
          priority: dt.task.priority, processCategory: dt.task.processCategory || dt.task.process,
          task: dt.task,
        });
        cursor = Math.max(cursor, effEnd);
      }
      // Available gap at end of this window
      if (cursor < win.end) {
        items.push({ type: 'available', startTime: toISO(cursor), endTime: toISO(win.end), durationMinutes: toMin(win.end - cursor) });
        cursor = win.end;
      }
    }
  }

  // Off-shift after work
  if (workEnd && workEnd < dayEndMs) {
    items.push({ type: 'off-shift', startTime: toISO(workEnd), endTime: toISO(dayEndMs), durationMinutes: toMin(dayEndMs - workEnd) });
  }

  // If no availability at all for this day, show full day off-shift
  if (!workStart) {
    items.push({ type: 'off-shift', startTime: toISO(dayStartMs), endTime: toISO(dayEndMs), durationMinutes: toMin(dayEndMs - dayStartMs) });
  }

  // Inject downtime items — split/remove available blocks that overlap
  const downtimeRanges: { startMs: number; endMs: number; reason: string; indefinite: boolean }[] = [];
  for (const dt of (resource.downtimes || [])) {
    const dtStartMs = new Date(dt.startTime).getTime();
    const dtEndMs = dt.endTime ? new Date(dt.endTime).getTime() : dayEndMs;
    if (dtStartMs >= dayEndMs || dtEndMs <= dayStartMs) continue;
    downtimeRanges.push({
      startMs: Math.max(dtStartMs, dayStartMs),
      endMs: Math.min(dtEndMs, dayEndMs),
      reason: dt.reason || 'Downtime',
      indefinite: !!dt.indefinite,
    });
  }

  if (downtimeRanges.length > 0) {
    // Split available blocks around downtime ranges
    const revised: AgendaItem[] = [];
    for (const item of items) {
      if (item.type !== 'available') { revised.push(item); continue; }
      const iStart = new Date(item.startTime).getTime();
      const iEnd = new Date(item.endTime).getTime();
      // Check if any downtime overlaps this available block
      let cursor = iStart;
      const overlapping = downtimeRanges
        .filter(d => d.startMs < iEnd && d.endMs > iStart)
        .sort((a, b) => a.startMs - b.startMs);
      if (overlapping.length === 0) { revised.push(item); continue; }
      for (const d of overlapping) {
        // Available slice before this downtime
        const sliceEnd = Math.min(d.startMs, iEnd);
        if (sliceEnd > cursor) {
          const dur = toMin(sliceEnd - cursor);
          if (dur > 0) revised.push({ ...item, startTime: toISO(cursor), endTime: toISO(sliceEnd), durationMinutes: dur });
        }
        cursor = Math.max(cursor, d.endMs);
      }
      // Available slice after last downtime
      if (cursor < iEnd) {
        const dur = toMin(iEnd - cursor);
        if (dur > 0) revised.push({ ...item, startTime: toISO(cursor), endTime: toISO(iEnd), durationMinutes: dur });
      }
    }
    // Add downtime items — split around assignments so downtime shows before AND after tasks
    const assignmentBlocks = revised
      .filter(it => it.type === 'assignment')
      .map(it => ({ startMs: new Date(it.startTime).getTime(), endMs: new Date(it.endTime).getTime() }))
      .sort((a, b) => a.startMs - b.startMs);
    for (const d of downtimeRanges) {
      let cursor = d.startMs;
      for (const ab of assignmentBlocks) {
        if (ab.endMs <= cursor || ab.startMs >= d.endMs) continue;
        // Downtime slice before this assignment
        const sliceEnd = Math.min(ab.startMs, d.endMs);
        if (sliceEnd > cursor) {
          const dur = toMin(sliceEnd - cursor);
          if (dur > 0) revised.push({
            type: 'downtime', startTime: toISO(cursor), endTime: toISO(sliceEnd), durationMinutes: dur,
            reason: d.reason, indefinite: d.indefinite && sliceEnd >= d.endMs,
            isFullDay: cursor <= dayStartMs && sliceEnd >= dayEndMs,
          });
        }
        cursor = Math.max(cursor, ab.endMs);
      }
      // Downtime slice after last assignment (or the whole thing if no assignments overlap)
      if (cursor < d.endMs) {
        const dur = toMin(d.endMs - cursor);
        if (dur > 0) revised.push({
          type: 'downtime', startTime: toISO(cursor), endTime: toISO(d.endMs), durationMinutes: dur,
          reason: d.reason, indefinite: d.indefinite,
          isFullDay: cursor <= dayStartMs && d.endMs >= dayEndMs,
        });
      }
    }
    revised.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return revised;
  }

  return items;
}

function ResourceAgendaPanel({ resource, tasks, colors, horizonStart, horizonEnd, onClose, onTaskClick, onOpenDowntimeEditor }: {
  resource: any; tasks: any[]; colors: any;
  horizonStart?: string; horizonEnd?: string;
  onClose: () => void; onTaskClick: (t: any) => void;
  onOpenDowntimeEditor?: (resourceKey: string) => void;
}) {
  // Build list of days in horizon that have availability or assignments for this resource
  // Day boundaries are in the tenant timezone so "Monday Feb 16" means local midnight-to-midnight
  const days = useMemo(() => {
    const tz = _locale?.timezone || 'UTC';
    const loc = _locale?.locale || 'en-US';
    const hStartMs = horizonStart ? new Date(horizonStart).getTime() : Date.now();
    const hEndMs = horizonEnd ? new Date(horizonEnd).getTime() : hStartMs + 14 * 86400000;

    // Helper: get UTC offset in minutes for a given UTC timestamp in the tenant tz
    const getOffsetMin = (utcMs: number): number => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false,
      }).formatToParts(new Date(utcMs));
      const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      const utcH = new Date(utcMs).getUTCHours();
      const utcM = new Date(utcMs).getUTCMinutes();
      return (h * 60 + m) - (utcH * 60 + utcM);
    };

    // Helper: get local midnight as UTC ms for the local date containing utcMs
    const localMidnight = (utcMs: number): number => {
      const off = getOffsetMin(utcMs);
      const localMs = utcMs + off * 60000;
      const dayMs = localMs - (localMs % 86400000); // floor to UTC day
      return dayMs - off * 60000; // back to UTC
    };

    const result: { label: string; startMs: number; endMs: number }[] = [];
    let dayStartMs = localMidnight(hStartMs);

    while (dayStartMs < hEndMs) {
      const dayEndMs = localMidnight(dayStartMs + 86400000 + 3600000); // +25h to cross midnight safely

      const dayLabel = new Date(dayStartMs + 12 * 3600000).toLocaleDateString(loc, {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: tz,
      });

      const hasAvail = resource.availability?.some((iv: any) =>
        new Date(iv.start).getTime() < dayEndMs && new Date(iv.end).getTime() > dayStartMs
      );
      const hasAssign = tasks.some((t: any) =>
        t.scheduledStart && t.scheduledEnd &&
        t.assignedResources?.some((r: any) => r.resourceKey === resource.resourceKey) &&
        new Date(t.scheduledStart).getTime() < dayEndMs &&
        new Date(t.scheduledEnd).getTime() > dayStartMs
      );

      const hasDowntime = (resource.downtimes || []).some((dt: any) => {
        const dtStart = new Date(dt.startTime).getTime();
        const dtEnd = dt.endTime ? new Date(dt.endTime).getTime() : hEndMs;
        return dtStart < dayEndMs && dtEnd > dayStartMs;
      });

      if (hasAvail || hasAssign || hasDowntime) {
        result.push({ label: dayLabel, startMs: dayStartMs, endMs: dayEndMs });
      }

      dayStartMs = dayEndMs;
    }
    return result;
  }, [resource, tasks, horizonStart, horizonEnd]);

  // Default to first day with assignments, or first day
  const firstAssignIdx = useMemo(() => {
    const idx = days.findIndex(d =>
      tasks.some((t: any) =>
        t.scheduledStart && t.assignedResources?.some((r: any) => r.resourceKey === resource.resourceKey) &&
        new Date(t.scheduledStart).getTime() >= d.startMs && new Date(t.scheduledStart).getTime() < d.endMs
      )
    );
    return idx >= 0 ? idx : 0;
  }, [days, tasks, resource]);

  const [dayIdx, setDayIdx] = useState(firstAssignIdx);
  const currentDay = days[dayIdx];

  const agendaItems = useMemo(() => {
    if (!currentDay) return [];
    return buildAgendaItems(resource, tasks, currentDay.startMs, currentDay.endMs);
  }, [resource, tasks, currentDay]);

  // Day utilization
  const dayUtil = useMemo(() => {
    const assigned = agendaItems.filter(i => i.type === 'assignment').reduce((s, i) => s + i.durationMinutes, 0);
    const available = agendaItems.filter(i => i.type !== 'off-shift').reduce((s, i) => s + i.durationMinutes, 0);
    return available > 0 ? Math.round(assigned / available * 100) : 0;
  }, [agendaItems]);

  if (days.length === 0) {
    return (
      <SlidePanel open={true} onClose={onClose} title={`${resource.resourceName} — Agenda`}>
        <div style={{ color: C.textDim, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
          No availability in the scheduling horizon
        </div>
      </SlidePanel>
    );
  }

  return (
    <SlidePanel open={true} onClose={onClose} title={`${resource.resourceName} — Agenda`}>
      {/* Resource info */}
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>{resource.resourceKey}</div>

      {/* Day navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 0', marginBottom: 16, borderBottom: `1px solid ${C.border}`,
      }}>
        <button
          onClick={() => setDayIdx(i => Math.max(0, i - 1))}
          disabled={dayIdx <= 0}
          style={{
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
            color: dayIdx > 0 ? C.text : C.textDim, cursor: dayIdx > 0 ? 'pointer' : 'default',
            padding: '4px 10px', fontSize: 14, fontFamily: FONT,
          }}
        >◀</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{currentDay?.label}</div>
          <div style={{ fontSize: 11, color: dayUtil > 90 ? C.red : dayUtil > 70 ? C.yellow : C.green, fontWeight: 600 }}>
            {dayUtil}% utilized
          </div>
        </div>
        <button
          onClick={() => setDayIdx(i => Math.min(days.length - 1, i + 1))}
          disabled={dayIdx >= days.length - 1}
          style={{
            background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
            color: dayIdx < days.length - 1 ? C.text : C.textDim,
            cursor: dayIdx < days.length - 1 ? 'pointer' : 'default',
            padding: '4px 10px', fontSize: 14, fontFamily: FONT,
          }}
        >▶</button>
      </div>

      {/* Agenda list */}
      {agendaItems.map((item, i) => {
        if (item.type === 'assignment') {
          const taskColor = item.task && colors ? getTaskColor(item.task, colors) : C.accent;
          return (
            <div
              key={i}
              onClick={() => item.task && onTaskClick(item.task)}
              style={{
                padding: '10px 12px', marginBottom: 4, borderRadius: 8,
                background: C.surface, border: `1px solid ${C.border}`,
                borderLeft: `4px solid ${taskColor}`,
                cursor: 'pointer', transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
              onMouseLeave={e => (e.currentTarget.style.background = C.surface)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                  {fmtTime(item.startTime)}–{fmtTime(item.endTime)} — {item.taskKey}
                </span>
                <span style={{ fontSize: 11, color: C.accent, fontWeight: 600 }}>
                  {fmtDuration(item.durationMinutes * 60)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 2 }}>{item.taskName}</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.textDim }}>
                {item.orderRef && <span>{item.orderRef}</span>}
                {item.priority != null && <span>Priority {item.priority}</span>}
              </div>
            </div>
          );
        }
        if (item.type === 'available') {
          return (
            <div key={i} style={{
              padding: '8px 12px', marginBottom: 4, borderRadius: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, color: C.green }}>
                {fmtTime(item.startTime)}–{fmtTime(item.endTime)} — {t('available', 'Available')}
              </span>
              <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>
                {fmtDuration(item.durationMinutes * 60)}
              </span>
            </div>
          );
        }
        if (item.type === 'downtime') {
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', marginBottom: 4, borderRadius: 8,
              background: 'rgba(234,179,8,0.1)',
              borderLeft: '3px solid #eab308',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#eab308' }}>⚠ DOWN</span>
              <span style={{ fontSize: 12, color: C.text }}>{item.reason}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim }}>
                {item.isFullDay
                  ? '(all day)'
                  : item.indefinite
                    ? `${fmtTime(item.startTime)} → indefinite`
                    : `${fmtTime(item.startTime)}–${fmtTime(item.endTime)}`
                }
              </span>
            </div>
          );
        }
        // off-shift
        return (
          <div key={i} style={{
            padding: '8px 12px', marginBottom: 4, borderRadius: 8,
            background: `${C.textDim}11`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: C.textDim }}>
              {fmtTime(item.startTime)}–{fmtTime(item.endTime)} — {t('offShift', 'Off Shift')}
            </span>
            <span style={{ fontSize: 11, color: C.textDim }}>
              {fmtDuration(item.durationMinutes * 60)}
            </span>
          </div>
        );
      })}

      {/* ── Downtime History ── */}
      {(resource.downtimes?.length > 0 || onOpenDowntimeEditor) && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase',
            letterSpacing: '0.08em', padding: '4px 0 8px',
          }}>
            Downtime History
          </div>
          {(resource.downtimes || []).length === 0 && (
            <div style={{ fontSize: 12, color: C.textDim, padding: '4px 0 8px' }}>No downtimes recorded</div>
          )}
          {(resource.downtimes || []).map((dt: any, i: number) => {
            const isActive = dt.status === 'active';
            const isEnded = dt.status === 'ended';
            const fmtDtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const fmtDtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            const durH = dt.durationHours != null ? `${Math.round(dt.durationHours * 10) / 10}h` : null;
            return (
              <div
                key={`dth-${i}`}
                onClick={() => onOpenDowntimeEditor?.(resource.resourceKey)}
                style={{
                  padding: '8px 12px', marginBottom: 4, borderRadius: 8,
                  background: isActive ? 'rgba(234,179,8,0.1)' : C.surface,
                  border: `1px solid ${isActive ? '#eab308' : C.border}`,
                  borderLeft: `3px solid ${isActive ? '#eab308' : isEnded ? C.green : C.accent}`,
                  cursor: onOpenDowntimeEditor ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (onOpenDowntimeEditor) e.currentTarget.style.background = isActive ? 'rgba(234,179,8,0.15)' : C.surface2; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'rgba(234,179,8,0.1)' : C.surface; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, color: isEnded ? C.green : '#eab308' }}>
                    {isEnded ? '✓' : '⚠'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{dt.reason || 'Downtime'}</span>
                  {durH && !dt.indefinite && (
                    <span style={{ fontSize: 11, color: C.textDim, marginLeft: 'auto' }}>({durH})</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textDim, paddingLeft: 18 }}>
                  {fmtDtDate(dt.startTime)} {fmtDtTime(dt.startTime)}
                  {' – '}
                  {dt.indefinite ? '???' : dt.endTime ? `${fmtDtTime(dt.endTime)}` : '???'}
                  {isActive && <span style={{ color: '#eab308', fontWeight: 600, marginLeft: 6 }}>(active)</span>}
                </div>
              </div>
            );
          })}
          {onOpenDowntimeEditor && (
            <button
              onClick={() => onOpenDowntimeEditor(resource.resourceKey)}
              style={{
                background: 'none', border: `1px dashed ${C.border}`, borderRadius: 6,
                color: C.accent, fontSize: 12, fontFamily: FONT, padding: '6px 12px',
                cursor: 'pointer', width: '100%', marginTop: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
            >
              + Schedule Downtime
            </button>
          )}
        </div>
      )}
    </SlidePanel>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TABLE WRAPPER
   ═══════════════════════════════════════════════════════════════ */

const tableStyle: CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: FONT,
};
const cellStyle: CSSProperties = {
  padding: '10px 12px', borderBottom: `1px solid ${C.border}`, color: C.text,
  whiteSpace: 'nowrap',
};

/* ═══════════════════════════════════════════════════════════════
   FILTER CHIP
   ═══════════════════════════════════════════════════════════════ */

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 12, fontSize: 12, fontFamily: FONT,
      background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
    }}>
      {label}
      <span onClick={onClear} style={{ cursor: 'pointer', color: C.textMuted, fontWeight: 700, marginLeft: 2 }}>✕</span>
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REPLAY CONTROL BAR
   ═══════════════════════════════════════════════════════════════ */

function ReplayControlBar({ replay, onStep, onJumpStart, onJumpEnd, onTogglePlay, onSpeedChange, onExit }: {
  replay: ReplayState;
  onStep: (delta: number) => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  onExit: () => void;
}) {
  const step = replay.currentStep > 0 ? replay.steps[replay.currentStep - 1] : null;
  const btnStyle: CSSProperties = {
    background: 'none', border: `1px solid ${C.border}`, color: C.text,
    borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 14,
    fontFamily: 'monospace', lineHeight: 1, minWidth: 28, textAlign: 'center',
  };
  return (
    <div style={{
      background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '8px 14px', marginBottom: 8, fontFamily: FONT,
    }}>
      {/* Top row: controls + step counter + speed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button style={btnStyle} onClick={onJumpStart} title="Jump to start (Home)">⏮</button>
        <button style={btnStyle} onClick={() => onStep(-1)} title="Step back (←)">◀</button>
        <button style={{ ...btnStyle, background: replay.playing ? C.accent : 'none', color: replay.playing ? '#fff' : C.text }}
          onClick={onTogglePlay} title="Play/Pause (Space)">
          {replay.playing ? '⏸' : '▶'}
        </button>
        <button style={btnStyle} onClick={() => onStep(1)} title="Step forward (→)">▶▶</button>
        <button style={btnStyle} onClick={onJumpEnd} title="Jump to end (End)">⏭</button>

        <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, marginLeft: 8 }}>
          Step {replay.currentStep} of {replay.steps.length}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Fast</span>
          <input type="range" min={100} max={2000} step={100} value={replay.speed}
            onChange={e => onSpeedChange(Number(e.target.value))}
            style={{ width: 80, accentColor: C.accent }} />
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Slow</span>
          {replay.currentStep >= replay.steps.length && (
            <button onClick={onJumpStart} style={{
              background: 'none', border: `1px solid ${C.accent}`, color: C.accent,
              borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11,
              fontWeight: 600, fontFamily: FONT, marginLeft: 8,
            }}>Restart</button>
          )}
          <button onClick={onExit} style={{
            background: 'none', border: `1px solid ${C.border}`, color: C.red,
            borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11,
            fontWeight: 600, fontFamily: FONT, marginLeft: 8,
          }}>Exit Replay</button>
        </div>
      </div>

      {/* Step description */}
      {step && (
        <div style={{
          marginTop: 6, padding: '4px 8px', borderRadius: 6,
          background: `${stepColor(step.action)}15`, borderLeft: `3px solid ${stepColor(step.action)}`,
          fontSize: 12, color: C.text, fontWeight: 500,
        }}>
          <span style={{ color: stepColor(step.action), fontWeight: 700, marginRight: 6 }}>
            {stepIcon(step.action)}
          </span>
          {describeStep(step)}
        </div>
      )}
      {!step && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.textDim }}>
          Empty schedule — step forward to begin replay
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REPLAY STEP LOG PANEL
   ═══════════════════════════════════════════════════════════════ */

function ReplayStepLog({ replay, onJumpToStep }: {
  replay: ReplayState;
  onJumpToStep: (step: number) => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!collapsed && logRef.current) {
      const active = logRef.current.querySelector('[data-active="true"]');
      if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [replay.currentStep, collapsed]);

  return (
    <div style={{
      marginTop: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
      fontFamily: FONT, fontSize: 11,
    }}>
      <div onClick={() => setCollapsed(c => !c)} style={{
        padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: collapsed ? 'none' : `1px solid ${C.border}`,
        userSelect: 'none',
      }}>
        <span style={{ fontWeight: 600, color: C.textMuted, fontSize: 12 }}>
          {collapsed ? '▸' : '▾'} Solve Log ({replay.steps.length} steps)
        </span>
        <span style={{ fontSize: 10, color: C.textDim }}>
          {collapsed ? 'click to expand' : 'click to collapse'}
        </span>
      </div>
    {!collapsed && (
    <div ref={logRef} style={{ maxHeight: 200, overflow: 'auto' }}>
      {replay.steps.map((step, i) => {
        const stepNum = i + 1;
        const isCurrent = stepNum === replay.currentStep;
        const isPast = stepNum < replay.currentStep;
        return (
          <div key={step.sequence}
            data-active={isCurrent ? 'true' : undefined}
            onClick={() => onJumpToStep(stepNum)}
            style={{
              padding: '3px 8px', cursor: 'pointer',
              background: isCurrent ? `${stepColor(step.action)}20` : 'transparent',
              borderLeft: isCurrent ? `3px solid ${stepColor(step.action)}` : '3px solid transparent',
              color: isPast ? C.textMuted : isCurrent ? C.text : C.textDim,
              display: 'flex', gap: 6, alignItems: 'baseline',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = `${C.surface2}`; }}
            onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span style={{ minWidth: 24, textAlign: 'right', color: C.textDim, fontSize: 10 }}>{stepNum}.</span>
            <span style={{ color: stepColor(step.action), fontWeight: 700, fontSize: 10 }}>{stepIcon(step.action)}</span>
            <span>{describeStep(step)}</span>
          </div>
        );
      })}
    </div>
    )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DATE TIME PICKER
   ═══════════════════════════════════════════════════════════════ */

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

/**
 * DateTimePicker
 * value / onChange: ISO 8601 strings (e.g. "2026-03-29T14:30:00.000Z").
 * Emits ISO on every change so callers can send directly to the API.
 * Quick buttons: Now, +1h, +2h, +4h, End of Shift (17:00 same day).
 */
function DateTimePicker({ value, onChange, disabled, placeholder }: {
  value: string;           // ISO string — "" when unset
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');

  // Parse ISO → local Date (or null)
  const parse = (v: string): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  // Build ISO from local date + hour + minute
  const toISO = (d: Date, h: number, m: number): string => {
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
    return local.toISOString();
  };

  const nowD = new Date();
  const initial = parse(value);

  const [open,      setOpen]      = useState(false);
  const [viewYear,  setViewYear]  = useState(initial?.getFullYear()  ?? nowD.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial?.getMonth()     ?? nowD.getMonth());
  const [hour,      setHour]      = useState(initial?.getHours()     ?? nowD.getHours());
  const [minute,    setMinute]    = useState(initial?.getMinutes()   ?? nowD.getMinutes());
  const [selDate,   setSelDate]   = useState<Date | null>(initial);

  // Sync internal state when value changes from outside
  useEffect(() => {
    const d = parse(value);
    if (d) {
      setSelDate(d);
      setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
      setHour(d.getHours());        setMinute(d.getMinutes());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const popupRef   = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popupRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const emit = (d: Date, h: number, m: number) => onChange(toISO(d, h, m));

  const pickDay = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    setSelDate(d);
    emit(d, hour, minute);
    setOpen(false);
  };

  const pickTime = (h: number, m: number) => {
    setHour(h); setMinute(m);
    if (selDate) emit(selDate, h, m);
  };

  const pickNow = () => {
    const n = new Date();
    setHour(n.getHours()); setMinute(n.getMinutes());
    setSelDate(n); setViewYear(n.getFullYear()); setViewMonth(n.getMonth());
    onChange(n.toISOString());
    setOpen(false);
  };

  const pickOffset = (offsetHours: number) => {
    const base = selDate ? new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate(), hour, minute) : new Date();
    const target = new Date(base.getTime() + offsetHours * 3_600_000);
    setHour(target.getHours()); setMinute(target.getMinutes());
    setSelDate(target); setViewYear(target.getFullYear()); setViewMonth(target.getMonth());
    onChange(target.toISOString());
    setOpen(false);
  };

  const pickEndOfShift = () => {
    const base = selDate ?? new Date();
    const eos = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 17, 0, 0);
    setHour(17); setMinute(0); setSelDate(eos);
    onChange(eos.toISOString());
    setOpen(false);
  };

  // Calendar grid
  const firstDow  = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMon = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMon }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const tod = new Date();
  const isToday = (d: number) => tod.getFullYear() === viewYear && tod.getMonth() === viewMonth && tod.getDate() === d;
  const isSel   = (d: number) => selDate?.getFullYear() === viewYear && selDate?.getMonth() === viewMonth && selDate?.getDate() === d;

  const displayText = (() => {
    const d = parse(value);
    if (!d) return placeholder ?? 'Select date & time…';
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const navBtn: React.CSSProperties = {
    background: 'none', border: 'none', color: C.text, cursor: 'pointer',
    fontSize: 13, padding: '3px 8px', borderRadius: 4,
  };
  const quickBtn: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
    color: C.textDim, fontSize: 10, padding: '3px 7px', cursor: 'pointer', fontFamily: FONT,
  };
  const timeSelect: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
    color: C.text, fontSize: 12, padding: '4px 6px', fontFamily: FONT, flex: 1,
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          width: '100%', padding: '7px 10px', textAlign: 'left', fontSize: 12, fontFamily: FONT,
          background: C.surface, border: `1px solid ${open ? C.accent : C.border}`, borderRadius: 6,
          color: value ? C.text : C.textDim, cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          opacity: disabled ? 0.5 : 1, transition: 'border-color 0.15s',
        }}
      >
        <span>{displayText}</span>
        <span style={{ color: C.textDim, fontSize: 11 }}>📅</span>
      </button>

      {/* Popup */}
      {open && (
        <div
          ref={popupRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1010,
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}
        >
          {/* Quick presets row */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            <button style={{ ...quickBtn, background: C.accent, color: '#fff', borderColor: C.accent, fontWeight: 600 }} onClick={pickNow}>Now</button>
            <button style={quickBtn} onClick={() => pickOffset(1)}>+1h</button>
            <button style={quickBtn} onClick={() => pickOffset(2)}>+2h</button>
            <button style={quickBtn} onClick={() => pickOffset(4)}>+4h</button>
            <button style={quickBtn} onClick={pickEndOfShift}>End of shift</button>
          </div>

          {/* Month / year nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button style={navBtn} onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); }}>◀</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{MONTHS_LONG[viewMonth]} {viewYear}</span>
            <button style={navBtn} onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1); }}>▶</button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
            {DAY_LABELS.map(dl => (
              <div key={dl} style={{ textAlign: 'center', fontSize: 10, color: C.textDim, fontWeight: 700, padding: '2px 0' }}>{dl}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />;
              const sel = isSel(day), tdy = isToday(day);
              return (
                <button key={idx} onClick={() => pickDay(day)} style={{
                  padding: '5px 0', border: 'none', borderRadius: 5, fontFamily: FONT, cursor: 'pointer',
                  background: sel ? C.accent : tdy ? `${C.accent}28` : 'none',
                  color: sel ? '#fff' : tdy ? C.accent : C.text,
                  fontSize: 12, fontWeight: sel || tdy ? 700 : 400, textAlign: 'center',
                }}>
                  {day}
                </button>
              );
            })}
          </div>

          {/* Time selectors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: C.textDim, minWidth: 28 }}>Time</span>
            <select value={hour} onChange={e => pickTime(Number(e.target.value), minute)} style={timeSelect}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{pad(i)}</option>)}
            </select>
            <span style={{ color: C.textDim, fontWeight: 700, fontSize: 14 }}>:</span>
            <select value={minute} onChange={e => pickTime(hour, Number(e.target.value))} style={timeSelect}>
              {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{pad(i)}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DOWNTIME EDITOR PANEL
   ═══════════════════════════════════════════════════════════════ */

function DowntimeEditorPanel({ resourceKey, resources, onClose, onStale, onToast, isQueuing, onQueue }: {
  resourceKey: string;
  resources: any[];
  onClose: () => void;
  onStale: () => void;
  onToast: (msg: string) => void;
  isQueuing?: boolean;
  onQueue?: (label: string, command: any) => void;
}) {
  const resource = resources.find((r: any) => r.resourceKey === resourceKey);
  const resourceName = resource?.resourceName || resourceKey;

  const [downtimeData, setDowntimeData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [formReason, setFormReason] = useState('');
  const [formFrom, setFormFrom] = useState(() => new Date().toISOString());
  const [formUntil, setFormUntil] = useState('');
  const [indefinite, setIndefinite] = useState(false);
  const [affectedPreview, setAffectedPreview] = useState<any[] | null>(null);
  const [showBringUpAt, setShowBringUpAt] = useState<string | null>(null);
  const [bringUpAtTime, setBringUpAtTime] = useState(() => new Date().toISOString());
  const [submitting, setSubmitting] = useState(false);

  const loadDowntimes = useCallback(() => {
    setLoading(true);
    api(`/ctp/resources/${resourceKey}/downtimes`)
      .then(d => { setDowntimeData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [resourceKey]);

  useEffect(() => { loadDowntimes(); }, [loadDowntimes]);

  const handleBringUpNow = async (dtIndex: number, e?: React.MouseEvent) => {
    void dtIndex;
    if ((isQueuing || e?.shiftKey) && onQueue) {
      onQueue(`▶ ${resourceName} back up`, { type: 'resource_uptime', resourceKey });
      return;
    }
    setSubmitting(true);
    try {
      await api(`/ctp/resources/${resourceKey}/uptime`, { method: 'POST', body: JSON.stringify({}) });
      onToast(`${resourceName} is back online`);
      onStale();
      loadDowntimes();
    } catch (e: any) {
      onToast(`Error: ${(e as any).message}`);
    } finally { setSubmitting(false); }
  };

  const handleBringUpAt = async () => {
    if (!bringUpAtTime) return;
    setSubmitting(true);
    try {
      await api(`/ctp/resources/${resourceKey}/uptime`, { method: 'POST', body: JSON.stringify({ actualUpTime: bringUpAtTime }) });
      onToast(`${resourceName} brought up at ${new Date(bringUpAtTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
      onStale();
      loadDowntimes();
      setShowBringUpAt(null);
    } catch (e: any) {
      onToast(`Error: ${e.message}`);
    } finally { setSubmitting(false); }
  };

  const handleMarkDown = async (e?: React.MouseEvent) => {
    const startTime = formFrom; // already ISO
    const endTime = (!indefinite && formUntil) ? formUntil : undefined; // already ISO
    const reason = formReason || 'Downtime';
    if ((isQueuing || e?.shiftKey) && onQueue) {
      onQueue(`⚠ ${resourceName} down: ${reason}`, { type: 'resource_downtime', resourceKey, startTime, endTime: endTime ?? null, strategy: reason });
      setFormReason(''); setFormFrom(new Date().toISOString()); setFormUntil(''); setIndefinite(false);
      return;
    }
    setSubmitting(true);
    try {
      const body: any = { reason, startTime };
      if (endTime) body.endTime = endTime;
      const result = await api(`/ctp/resources/${resourceKey}/downtime`, { method: 'POST', body: JSON.stringify(body) });
      setAffectedPreview(result.affectedTasks || []);
      onToast(`${resourceName} marked down${result.affectedCount > 0 ? ` — ${result.affectedCount} task(s) affected` : ''}`);
      onStale();
      loadDowntimes();
      setFormReason(''); setFormFrom(new Date().toISOString()); setFormUntil(''); setIndefinite(false);
    } catch (e: any) {
      onToast(`Error: ${(e as any).message}`);
    } finally { setSubmitting(false); }
  };

  const fmtDt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const panelStyle: React.CSSProperties = {
    position: 'fixed', top: 0, right: 0, width: 400, height: '100vh',
    background: C.surface2, borderLeft: `1px solid ${C.border}`, zIndex: 900,
    display: 'flex', flexDirection: 'column', fontFamily: FONT,
    boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
  };
  const sectionHdr: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em',
    padding: '12px 16px 6px', borderTop: `1px solid ${C.border}`, marginTop: 4,
  };
  const inputStyle: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, fontSize: 12, padding: '6px 10px', fontFamily: FONT, width: '100%', boxSizing: 'border-box',
  };
  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: 6, fontSize: 12, fontFamily: FONT, cursor: 'pointer', padding: '6px 12px',
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Downtime: {resourceName}</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{resourceKey}</div>
        </div>
        <button onClick={onClose} style={{ ...btnBase, background: C.surface, color: C.text, padding: '4px 10px' }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Active Downtimes */}
        <div style={sectionHdr}>Active & Upcoming Downtimes</div>
        {loading ? (
          <div style={{ padding: '12px 16px', color: C.textDim, fontSize: 12 }}>Loading…</div>
        ) : !downtimeData?.downtimes?.length ? (
          <div style={{ padding: '12px 16px', color: C.textDim, fontSize: 12 }}>No active or upcoming downtimes.</div>
        ) : downtimeData.downtimes.map((dt: any, i: number) => (
          <div key={i} style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: '#ef4444', fontSize: 14, lineHeight: 1.4 }}>⚠</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{dt.reason}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                  Down since: {fmtDt(dt.startTime)}
                  {dt.indefinite ? ' — indefinitely' : dt.endTime ? ` → ${fmtDt(dt.endTime)} (${dt.durationHours}h)` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    style={{ ...btnBase, background: '#22c55e', color: '#fff', fontSize: 11 }}
                    disabled={submitting}
                    onClick={(e) => handleBringUpNow(i, e)}
                    title="Shift+click to queue"
                  >▶ Bring Up Now</button>
                  <button
                    style={{ ...btnBase, background: C.surface, color: C.text, border: `1px solid ${C.border}`, fontSize: 11 }}
                    onClick={() => setShowBringUpAt(showBringUpAt === `${i}` ? null : `${i}`)}
                  >▶ Bring Up At…</button>
                </div>
                {showBringUpAt === `${i}` && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <DateTimePicker value={bringUpAtTime} onChange={setBringUpAtTime} />
                    </div>
                    <button style={{ ...btnBase, background: '#22c55e', color: '#fff', fontSize: 11 }} disabled={submitting} onClick={handleBringUpAt}>OK</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Affected tasks from last Mark Down */}
        {affectedPreview !== null && (
          <>
            <div style={sectionHdr}>Last Action — Affected Tasks ({affectedPreview.length})</div>
            {affectedPreview.length === 0 ? (
              <div style={{ padding: '8px 16px', fontSize: 12, color: C.textDim }}>No tasks were affected.</div>
            ) : affectedPreview.map((at: any, i: number) => (
              <div key={i} style={{ padding: '6px 16px', fontSize: 12, color: C.text }}>
                {at.commitmentLevel === 'running' && <span style={{ color: '#ef4444', marginRight: 6 }}>⚠ ON HOLD</span>}
                {at.taskName} <span style={{ color: C.textDim }}>({at.orderKey || '—'})</span>
              </div>
            ))}
          </>
        )}

        {/* Schedule Downtime form */}
        <div style={sectionHdr}>Schedule Downtime</div>
        <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Reason</div>
            <input style={inputStyle} placeholder="e.g. Spindle bearing replacement" value={formReason} onChange={e => setFormReason(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>From</div>
            <DateTimePicker value={formFrom} onChange={setFormFrom} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Until</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <DateTimePicker value={formUntil} onChange={setFormUntil} disabled={indefinite} placeholder="Select end date & time…" />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textDim, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={indefinite} onChange={e => setIndefinite(e.target.checked)} style={{ cursor: 'pointer', width: 14, height: 14 }} />
                Down indefinitely (no end time)
              </label>
            </div>
          </div>
          <button
            style={{ ...btnBase, background: '#ef4444', color: '#fff', fontWeight: 600, marginTop: 4 }}
            disabled={submitting || !formFrom}
            onClick={(e) => handleMarkDown(e)}
            title="Shift+click to queue"
          >⚠ Mark Down</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GANTT CHART
   ═══════════════════════════════════════════════════════════════ */

function GanttChart({ tasks, resources, products, colors, onTaskClick, onResourceClick,
  taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask,
  onApiUnschedule, onApiPin, onApiBulkUnschedule: _onApiBulkUnschedule, actionLoading,
  onResourceFilter, resourceFilter,
  onWhereTo, whereToTaskKey, whereToOptions, whereToLoading,
  whereToCurrentAssignment, whereToSource, onMoveTo, onCancelWhereTo,
  zoomLevel, setZoomLevel, scrollOffset, setScrollOffset,
  onSetResourcePrefForTask, onViewAgenda, onOpenDowntimeEditor, onAskAI,
  replay, onReplayStep, onReplayJumpStart, onReplayJumpEnd,
  onReplayTogglePlay, onReplaySpeedChange, onReplayExit, onReplayJumpToStep,
  ctpGhostBars, onToolbarAction }: {
  tasks: any[]; resources: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
  onViewAgenda?: (r: any) => void;
  onOpenDowntimeEditor?: (resourceKey: string) => void;
  taskPins?: Record<string, boolean>; taskExcludes?: Record<string, boolean>; taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onPinTask?: (key: string, pinned: boolean) => void;
  onExcludeTask?: (key: string, excluded: boolean) => void;
  onUnscheduleTask?: (key: string) => void;
  onApiUnschedule?: (key: string) => Promise<void>;
  onApiPin?: (key: string, pinned: boolean) => Promise<void>;
  onApiBulkUnschedule?: (keys: string[]) => Promise<void>;
  actionLoading?: string | null;
  onResourceFilter?: (resourceKey: string) => void;
  resourceFilter?: string | null;
  onWhereTo?: (key: string) => void;
  whereToTaskKey?: string | null;
  whereToOptions?: any[];
  whereToLoading?: boolean;
  whereToCurrentAssignment?: any;
  whereToSource?: 'gantt' | 'table' | 'panel' | null;
  onMoveTo?: (key: string, option: any) => void;
  onCancelWhereTo?: () => void;
  zoomLevel?: string; setZoomLevel?: (v: string) => void;
  scrollOffset?: number; setScrollOffset?: React.Dispatch<React.SetStateAction<number>>;
  onSetResourcePrefForTask?: (taskKey: string) => void;
  onAskAI?: (task: any) => void;
  replay?: ReplayState;
  onReplayStep?: (delta: number) => void;
  onReplayJumpStart?: () => void;
  onReplayJumpEnd?: () => void;
  onReplayTogglePlay?: () => void;
  onReplaySpeedChange?: (speed: number) => void;
  onReplayExit?: () => void;
  onReplayJumpToStep?: (step: number) => void;
  ctpGhostBars?: any[] | null;
  onToolbarAction?: (action: string, taskKeys: string[], event?: any) => void;
}) {
  // Suppress Gantt ghost bars/overlays when WhereTo triggered from task detail panel
  const showGanttWhereTo = whereToSource !== 'panel';
  // Local fallback state when props aren't provided (e.g. Overview tab)
  const [localZoom, setLocalZoom] = useState('3 hours');
  const [localScroll, setLocalScroll] = useState(0);
  const effectiveZoom = zoomLevel ?? localZoom;
  const effectiveSetZoom = setZoomLevel ?? setLocalZoom;
  const effectiveScroll = scrollOffset ?? localScroll;
  const effectiveSetScroll = setScrollOffset ?? setLocalScroll;
  // Derive lastTimeRange from effective zoom so dropdown stays in sync after remount
  const isTimeRangeZoom = TIME_RANGE_OPTIONS.some(t => t.label === effectiveZoom);
  const [lastTimeRange, setLastTimeRange] = useState(() => isTimeRangeZoom ? effectiveZoom : '3 hours');
  const [hovered, setHovered] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ task: any; x: number; y: number } | null>(null);
  const [resContextMenu, setResContextMenu] = useState<{ resource: any; x: number; y: number } | null>(null);
  const [ganttSearch, setGanttSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hiddenWorkCenters, setHiddenWorkCenters] = useState<Set<string>>(new Set());
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  // Compute time range from actual scheduled task data (exclude excluded tasks/orders)
  const scheduled = tasks.filter((t: any) => {
    if (!t.feasible || !t.scheduledStart || !t.scheduledEnd) return false;
    if (taskExcludes?.[t.key]) return false;
    const om = orderModes?.[t.orderRef] || 'INCLUDE';
    if (om === 'EXCLUDE') return false;
    return true;
  });

  // In replay mode, use all scheduled tasks for time axis but filter bars by visibleTasks
  const replayActive = replay?.active ?? false;
  const replayVisible = replay?.visibleTasks ?? new Set<string>();

  if (scheduled.length === 0 && !replayActive) {
    return <div style={{ color: C.textDim, padding: 20 }}>No {t('scheduledStatus', 'scheduled').toLowerCase()} {t('tasks', 'tasks')}</div>;
  }
  if (scheduled.length === 0 && replayActive) {
    return (
      <div>
        {replay && onReplayStep && onReplayJumpStart && onReplayJumpEnd && onReplayTogglePlay && onReplaySpeedChange && onReplayExit && (
          <ReplayControlBar replay={replay} onStep={onReplayStep} onJumpStart={onReplayJumpStart}
            onJumpEnd={onReplayJumpEnd} onTogglePlay={onReplayTogglePlay}
            onSpeedChange={onReplaySpeedChange} onExit={onReplayExit} />
        )}
        <div style={{ color: C.textDim, padding: 20 }}>No scheduled tasks — step forward to begin replay</div>
      </div>
    );
  }

  // Detect timezone from task data for correct axis labels
  const { offsetMs: _tzOff, tz: _ganttTz } = detectGanttTz(scheduled);
  const _localH = (d: Date) => new Date(d.getTime() + _tzOff).getUTCHours();
  const _localM = (d: Date) => new Date(d.getTime() + _tzOff).getUTCMinutes();
  const _snapMidnight = (d: Date) => { const s = new Date(d.getTime() + _tzOff); s.setUTCHours(0, 0, 0, 0); return new Date(s.getTime() - _tzOff); };
  const _snapEndOfDay = (d: Date) => { const s = new Date(d.getTime() + _tzOff); s.setUTCHours(23, 59, 59, 999); return new Date(s.getTime() - _tzOff); };

  const taskStarts = scheduled.map((t: any) => new Date(t.scheduledStart).getTime());
  const taskEnds = scheduled.map((t: any) => new Date(t.scheduledEnd).getTime());
  const dataStart = Math.min(...taskStarts);
  const dataEnd = Math.max(...taskEnds);

  const zoomConfig = ZOOM_LEVELS.find(z => z.label === effectiveZoom);
  let hStartMs: number, hEndMs: number;

  if (zoomConfig && zoomConfig.days > 0) {
    const viewStart = new Date(dataStart);
    if (zoomConfig.days < 1) {
      // Sub-day zoom: snap to the hour of earliest task
      viewStart.setUTCMinutes(0, 0, 0);
    } else {
      // Day+ zoom: snap to midnight in data timezone
      const snapped = _snapMidnight(viewStart);
      viewStart.setTime(snapped.getTime());
    }
    const stepMs = zoomConfig.days * 24 * 3600 * 1000;
    const scrolledStart = new Date(viewStart.getTime() + effectiveScroll * stepMs);
    const scrolledEnd = new Date(scrolledStart.getTime() + stepMs);
    hStartMs = scrolledStart.getTime();
    hEndMs = scrolledEnd.getTime();
  } else {
    // Fit to data
    const bufferMs = 12 * 3600 * 1000;
    const hStartDate = _snapMidnight(new Date(dataStart - bufferMs));
    const hEndDate = _snapEndOfDay(new Date(dataEnd + bufferMs));
    hStartMs = hStartDate.getTime();
    hEndMs = hEndDate.getTime();
  }

  const totalMs = hEndMs - hStartMs;
  if (totalMs <= 0) return <div style={{ color: C.textDim }}>Invalid time range</div>;

  const toPct = (iso: string) => ((new Date(iso).getTime() - hStartMs) / totalMs) * 100;

  // Time axis labels
  const axisLabels: { date: Date; pct: number; label: string }[] = [];
  if (zoomConfig && zoomConfig.days > 0 && zoomConfig.days <= 1) {
    // Sub-day labels: 30-min for ≤3hr, hourly for Day
    const stepMin = zoomConfig.days <= 0.25 ? 30 : 60;
    const h = new Date(hStartMs);
    h.setUTCSeconds(0, 0);
    // Snap to next step boundary
    const mins = h.getUTCMinutes();
    const nextSlot = Math.ceil(mins / stepMin) * stepMin;
    if (nextSlot >= 60) { h.setUTCMinutes(0); h.setUTCHours(h.getUTCHours() + 1); }
    else if (nextSlot > mins) { h.setUTCMinutes(nextSlot); }
    else { h.setTime(h.getTime() + stepMin * 60000); h.setUTCSeconds(0, 0); }
    while (h.getTime() < hEndMs) {
      const hr = _localH(h);
      const min = _localM(h);
      let label: string;
      if (zoomConfig.days < 1) {
        // 3 Hr view: full time on every tick
        label = h.toLocaleTimeString(_locale?.locale || 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: _ganttTz });
      } else {
        // Day view: hour number only, am/pm at 6-hour marks
        const isPeriodMark = hr % 6 === 0 && min === 0;
        const period = hr < 12 ? 'am' : 'pm';
        const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
        label = isPeriodMark ? `${hr12}${period}` : `${hr12}`;
      }
      axisLabels.push({
        date: new Date(h),
        pct: ((h.getTime() - hStartMs) / totalMs) * 100,
        label,
      });
      h.setTime(h.getTime() + stepMin * 60000);
    }
  } else {
    // Daily labels
    const step = zoomConfig && zoomConfig.days >= 14 ? 2 : 1;
    const d = _snapMidnight(new Date(hStartMs));
    d.setTime(d.getTime() + 86400000); // advance to next local midnight
    let count = 0;
    while (d.getTime() < hEndMs) {
      if (count % step === 0) {
        axisLabels.push({
          date: new Date(d),
          pct: ((d.getTime() - hStartMs) / totalMs) * 100,
          label: d.toLocaleDateString(_locale?.locale || 'en-US', { month: 'short', day: 'numeric', timeZone: _ganttTz }),
        });
      }
      d.setTime(d.getTime() + 86400000);
      count++;
    }
  }

  // Date group labels — day headers above time axis for sub-day zoom levels
  const dateGroupLabels: { label: string; startPct: number; widthPct: number }[] = [];
  if (zoomConfig && zoomConfig.days <= 1) {
    const cursor = _snapMidnight(new Date(hStartMs));
    while (cursor.getTime() < hEndMs) {
      const dayStart = cursor.getTime();
      const dayEnd = _snapEndOfDay(cursor).getTime();
      const clippedStart = Math.max(dayStart, hStartMs);
      const clippedEnd = Math.min(dayEnd, hEndMs);
      if (clippedEnd > clippedStart) {
        dateGroupLabels.push({
          label: new Date(dayStart).toLocaleDateString(_locale?.locale || 'en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: _ganttTz }),
          startPct: ((clippedStart - hStartMs) / totalMs) * 100,
          widthPct: ((clippedEnd - clippedStart) / totalMs) * 100,
        });
      }
      cursor.setTime(dayStart + 86400000);
    }
  }

  // Group tasks by every assigned resource (multi-resource tasks appear on all lanes)
  // In replay mode, only include tasks that are in the visible set
  const displayScheduled = replayActive
    ? scheduled.filter((t: any) => replayVisible.has(t.key))
    : scheduled;
  const resMap = new Map<string, any[]>();
  resources.forEach((r: any) => resMap.set(r.resourceKey, []));
  displayScheduled.forEach((t: any) => {
    for (const ar of t.assignedResources || []) {
      const rk = ar.resourceKey;
      if (rk && resMap.has(rk)) resMap.get(rk)!.push(t);
    }
  });

  // All work center names (for toggle buttons)
  const allWorkCenters = Array.from(new Set(resources.map((r: any) => r.workCenter || 'Other')));

  // Filter resources
  let visibleResources = resources;
  if (ganttSearch) {
    const q = ganttSearch.toLowerCase();
    visibleResources = visibleResources.filter((r: any) =>
      (r.resourceName || '').toLowerCase().includes(q) ||
      (r.resourceKey || '').toLowerCase().includes(q),
    );
  }
  if (hiddenWorkCenters.size > 0) {
    visibleResources = visibleResources.filter((r: any) =>
      !hiddenWorkCenters.has(r.workCenter || 'Other'),
    );
  }
  if (hideEmpty) {
    visibleResources = visibleResources.filter((r: any) =>
      (resMap.get(r.resourceKey) || []).length > 0,
    );
  }

  // Group visible resources by work center
  const workCenters = new Map<string, any[]>();
  visibleResources.forEach((r: any) => {
    const wc = r.workCenter || 'Other';
    if (!workCenters.has(wc)) workCenters.set(wc, []);
    workCenters.get(wc)!.push(r);
  });

  const LANE_H = 44;
  const LABEL_W = 170;

  return (
    <div style={{ position: 'relative' }}>
      {/* Replay Controls — at TOP of Gantt per user preference */}
      {replayActive && replay && onReplayStep && onReplayJumpStart && onReplayJumpEnd && onReplayTogglePlay && onReplaySpeedChange && onReplayExit && (
        <ReplayControlBar replay={replay} onStep={onReplayStep} onJumpStart={onReplayJumpStart}
          onJumpEnd={onReplayJumpEnd} onTogglePlay={onReplayTogglePlay}
          onSpeedChange={onReplaySpeedChange} onExit={onReplayExit} />
      )}
      {replayActive && replay && onReplayJumpToStep && (
        <ReplayStepLog replay={replay} onJumpToStep={onReplayJumpToStep} />
      )}
      {/* Resource filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <SearchBox value={ganttSearch} onChange={setGanttSearch} placeholder="Filter resources..." />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.textMuted, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)}
            style={{ accentColor: C.accent }} />
          Hide empty
          <HoverTooltip content="Hide resources with no scheduled tasks in the current view">
            <span style={{ color: C.textDim, fontSize: 12, cursor: 'help' }}>&#x24D8;</span>
          </HoverTooltip>
        </label>
        <button
          onClick={() => setShowCriticalPath(prev => !prev)}
          style={{
            padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, fontFamily: FONT,
            background: showCriticalPath ? '#f9731622' : 'transparent',
            color: showCriticalPath ? '#f97316' : C.textMuted,
            border: showCriticalPath ? '1px solid #f9731644' : '1px solid transparent',
            display: 'flex', alignItems: 'center', gap: 4,
            transition: 'all 0.15s',
          }}
        >
          {'\uD83D\uDD17'} Critical Path
        </button>
        {allWorkCenters.map(wc => (
          <button key={wc} onClick={() => {
            setHiddenWorkCenters(prev => {
              const next = new Set(prev);
              if (next.has(wc)) next.delete(wc); else next.add(wc);
              return next;
            });
          }} style={{
            padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: hiddenWorkCenters.has(wc) ? 'transparent' : C.accent + '22',
            color: hiddenWorkCenters.has(wc) ? C.textDim : C.accent,
            border: hiddenWorkCenters.has(wc) ? `1px solid ${C.border}` : `1px solid ${C.accent}44`,
            textDecoration: hiddenWorkCenters.has(wc) ? 'line-through' : 'none',
            fontFamily: FONT,
          }}>
            {wc}
          </button>
        ))}
        <span style={{ fontSize: 12, color: C.textDim, marginLeft: 'auto' }}>
          {visibleResources.length} of {resources.length} resources
        </span>
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
        <select value={lastTimeRange} onChange={e => { setLastTimeRange(e.target.value); effectiveSetZoom(e.target.value); effectiveSetScroll(0); }} style={{
          padding: '5px 14px', paddingRight: 24, borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: FONT,
          border: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
          backgroundColor: TIME_RANGE_OPTIONS.some(t => t.label === effectiveZoom) ? '#3b82f6' : 'transparent',
          color: TIME_RANGE_OPTIONS.some(t => t.label === effectiveZoom) ? '#fff' : '#94a3b8',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='${TIME_RANGE_OPTIONS.some(t => t.label === effectiveZoom) ? 'white' : '%2394a3b8'}'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
        }}>
          {TIME_RANGE_OPTIONS.map(z => (
            <option key={z.label} value={z.label} style={{ background: '#1e293b', color: '#fff' }}>{z.label}</option>
          ))}
        </select>
        {ZOOM_LEVELS.filter(z => !TIME_RANGE_OPTIONS.includes(z)).map(z => (
          <button key={z.label} onClick={() => { effectiveSetZoom(z.label); effectiveSetScroll(0); }} style={{
            padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: z.label === effectiveZoom ? '#3b82f6' : 'transparent',
            color: z.label === effectiveZoom ? '#fff' : '#94a3b8',
            fontFamily: FONT,
          }}>{z.label}</button>
        ))}
        {zoomConfig && zoomConfig.days > 0 && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button onClick={() => effectiveSetScroll(s => s - 1)} style={{
              padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT,
            }}>← {act('prev', 'Prev')}</button>
            <button onClick={() => effectiveSetScroll(0)} style={{
              padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT,
            }}>{act('today', 'Today')}</button>
            <button onClick={() => effectiveSetScroll(s => s + 1)} style={{
              padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT,
            }}>{act('next', 'Next')} →</button>
          </div>
        )}
      </div>

      {/* Date group row — day headers for sub-day zoom */}
      {dateGroupLabels.length > 0 && (
        <div style={{ marginLeft: LABEL_W, position: 'relative', height: 20, marginBottom: 2, overflow: 'hidden' }}>
          {dateGroupLabels.map((dg, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${dg.startPct}%`,
              width: `${dg.widthPct}%`,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              color: C.accent,
              fontFamily: FONT,
              borderLeft: i > 0 ? `1px solid ${C.border}` : 'none',
              boxSizing: 'border-box',
            }}>
              {dg.label}
            </div>
          ))}
        </div>
      )}

      {/* Time axis */}
      <div style={{ marginLeft: LABEL_W, display: 'flex', position: 'relative', height: 24, overflow: 'hidden' }}>
        {axisLabels.map((lbl, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${lbl.pct}%`, fontSize: 10, color: C.textMuted,
            transform: 'translateX(-50%)', whiteSpace: 'nowrap',
          }}>
            {lbl.label}
          </div>
        ))}
      </div>

      {/* Grouped Lanes */}
      {Array.from(workCenters.entries()).map(([wcName, wcResources]) => (
        <div key={wcName}>
          {/* Work Center header row */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '6px 12px', background: C.surface2,
            borderTop: `1px solid ${C.border}`,
            fontSize: 11, fontWeight: 700, color: C.textMuted,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {wcName}
            <span style={{ marginLeft: 8, fontSize: 10, color: C.textDim }}>
              {wcResources.length} resource{wcResources.length !== 1 ? 's' : ''}
            </span>
          </div>
          {/* Resource lanes within this work center */}
          {wcResources.map((res: any) => {
            const rTasks = resMap.get(res.resourceKey) || [];
            const isFiltered = resourceFilter === res.resourceKey;
            return (
              <div key={res.resourceKey} style={{
                display: 'flex', borderTop: `1px solid ${C.border}`,
                ...(isFiltered && { background: `${C.accent}08`, borderLeft: `3px solid ${C.accent}` }),
              }}>
                <div
                  style={{
                    width: LABEL_W, minWidth: LABEL_W, padding: '6px 8px 6px 12px', fontSize: 12,
                    color: isFiltered ? C.accent : C.textMuted, fontWeight: isFiltered ? 600 : 500,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                    transition: 'color 0.1s',
                  }}
                >
                  <span
                    onClick={() => onResourceClick?.(res)}
                    onContextMenu={e => { e.preventDefault(); setResContextMenu({ resource: res, x: e.clientX, y: e.clientY }); }}
                    style={{ cursor: onResourceClick ? 'pointer' : 'default', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 3 }}
                    onMouseEnter={e => { if (onResourceClick) (e.currentTarget as HTMLElement).style.color = C.accent; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = ''; }}
                  >
                    {res.resourceName}
                    {res.isCurrentlyDown && (
                      <span style={{ color: '#eab308', fontSize: 11, flexShrink: 0 }} title="Resource is currently down">⚠</span>
                    )}
                  </span>
                  {onResourceFilter && (
                    <span
                      onClick={() => onResourceFilter(res.resourceKey)}
                      title={isFiltered
                        ? `Task List filtered to ${res.resourceName} — click to clear`
                        : `Filter Task List to ${res.resourceName}`}
                      style={{
                        cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: '2px 4px', borderRadius: 4,
                        color: isFiltered ? C.accent : C.textDim,
                        background: isFiltered ? `${C.accent}18` : 'transparent',
                        border: `1px solid ${isFiltered ? C.accent + '44' : 'transparent'}`,
                        flexShrink: 0, userSelect: 'none',
                      }}
                    >⊡</span>
                  )}
                </div>
                <div style={{ flex: 1, position: 'relative', height: LANE_H, overflow: 'hidden' }}>
                  {/* Unavailable background (full lane) */}
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(128,128,128,0.06)' }} />
                  {/* Available intervals */}
                  {res.availability?.map((iv: any, i: number) => {
                    const left = toPct(iv.start);
                    const right = toPct(iv.end);
                    const w = right - left;
                    if (w <= 0) return null;
                    return (
                      <div key={i} style={{
                        position: 'absolute', left: `${left}%`, width: `${w}%`,
                        top: 0, bottom: 0, background: 'rgba(76,175,80,0.20)',
                      }} />
                    );
                  })}
                  {/* Grid lines */}
                  {axisLabels.map((lbl, i) => (
                    <div key={i} style={{
                      position: 'absolute', left: `${lbl.pct}%`, top: 0, bottom: 0,
                      width: 1, background: C.border, opacity: 0.5,
                    }} />
                  ))}
                  {/* Downtime regions */}
                  {(res.downtimes || []).map((dt: any, i: number) => {
                    const leftRaw  = toPct(dt.startTime);
                    const rightRaw = dt.endTime ? toPct(dt.endTime) : 100;
                    // Clamp to visible range — a past-start downtime still covers the visible area
                    const left = Math.max(0, leftRaw);
                    const right = Math.min(100, rightRaw);
                    const w = right - left;
                    if (w <= 0) return null;
                    return (
                      <div
                        key={`dt-${i}`}
                        style={{
                          position: 'absolute', left: `${left}%`, width: `${w}%`,
                          top: 0, bottom: 0,
                          background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(234,179,8,0.15) 6px, rgba(234,179,8,0.15) 12px)',
                          borderLeft: '3px solid #eab308',
                          ...(dt.indefinite ? {} : { borderRight: '3px solid #eab308' }),
                          cursor: 'pointer', zIndex: 1, pointerEvents: 'all',
                        }}
                        title={`⚠ ${dt.reason}\n${new Date(dt.startTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} → ${dt.indefinite ? 'indefinite' : new Date(dt.endTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                        onClick={() => onOpenDowntimeEditor?.(res.resourceKey)}
                      />
                    );
                  })}
                  {/* Task bars */}
                  {rTasks.map((t: any) => {
                    const left = toPct(t.scheduledStart);
                    const right = toPct(t.scheduledEnd);
                    const w = Math.max(right - left, 0.3);
                    const barColor = colors ? getTaskColor(t, colors) : C.accent;
                    const isPinned = taskPins?.[t.key] || t.pinned;
                    const isExcluded = taskExcludes?.[t.key];
                    const willUnsched = taskUnschedules?.has(t.key);
                    const isReplayFlash = replayActive && replay?.flashTaskKey === t.key;
                    const flashAnim = isReplayFlash && replay?.flashAction;
                    const isCritical = showCriticalPath && t.isOnCriticalPath;
                    const isDimmed = showCriticalPath && !t.isOnCriticalPath;
                    return (
                      <div
                        key={t.key}
                        onMouseEnter={e => { setHovered(t); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                        onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => onTaskClick?.(t)}
                        onContextMenu={e => {
                          if (onPinTask || onExcludeTask || onUnscheduleTask) {
                            e.preventDefault();
                            setHovered(null);
                            setContextMenu({ task: t, x: e.clientX, y: e.clientY });
                          }
                        }}
                        style={{
                          position: 'absolute', left: `${left}%`, width: `${w}%`,
                          top: 6, height: LANE_H - 12, borderRadius: 4,
                          background: barColor,
                          opacity: isDimmed ? 0.35 : actionLoading === t.key ? 0.45 : isExcluded ? 0.2 : 0.85,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', paddingLeft: 4,
                          overflow: 'hidden', fontSize: 10, color: '#fff', fontWeight: 500,
                          transition: 'opacity 0.2s, box-shadow 0.2s, transform 0.2s, border-top 0.2s',
                          border: willUnsched ? `2px dashed ${C.red}` : 'none',
                          ...(isCritical && { borderTop: '2px solid #f97316', boxShadow: '0 0 6px #f9731640' }),
                          ...(isPinned && !isCritical && { boxShadow: `0 0 0 2px ${C.accent}` }),
                          ...(isExcluded && { filter: 'grayscale(1)' }),
                          ...(t.commitmentLevel === 'running' && !isCritical ? { borderLeft: '4px solid #ef4444' } : {}),
                          ...(t.commitmentLevel === 'on_hold' ? { borderLeft: '4px solid #f59e0b' } : {}),
                          ...(t.commitmentLevel === 'dispatched' && !isCritical ? { borderLeft: '4px solid #f97316' } : {}),
                          ...(actionLoading === t.key && { animation: 'pulse 1s ease-in-out infinite' }),
                          ...(flashAnim === 'schedule' || flashAnim === 'retry-success'
                            ? { boxShadow: `0 0 8px 2px ${C.green}`, transform: 'scaleY(1.1)' }
                            : {}),
                        }}
                      >
                        {willUnsched && (
                          <div style={{
                            position: 'absolute', inset: 0, borderRadius: 'inherit',
                            background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${C.red}22 4px, ${C.red}22 8px)`,
                          }} />
                        )}
                        {t.commitmentLevel === 'on_hold' && (
                          <div style={{
                            position: 'absolute', inset: 0, borderRadius: 'inherit',
                            background: `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(245,158,11,0.2) 4px, rgba(245,158,11,0.2) 8px)`,
                          }} />
                        )}
                        {t.commitmentLevel === 'running' && t.percentComplete > 0 && (
                          <div style={{
                            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 'inherit',
                            width: `${t.percentComplete}%`, background: 'rgba(255,255,255,0.2)',
                          }} />
                        )}
                        {isPinned && <span style={{ position: 'absolute', top: -6, right: -4, fontSize: 9, zIndex: 2 }}>📌</span>}
                        {w > 3 && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }}>{t.name}</span>}
                      </div>
                    );
                  })}
                  {/* WhereTo dim overlay on lane */}
                  {showGanttWhereTo && whereToTaskKey && whereToOptions && whereToOptions.length > 0 && !whereToLoading && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', pointerEvents: 'none', zIndex: 5 }} />
                  )}
                  {/* Ghost bars for this resource — start window + suggested placement */}
                  {showGanttWhereTo && whereToTaskKey && whereToOptions && whereToOptions.length > 0 && !whereToLoading && (
                    whereToOptions
                      .filter(opt => {
                        const primary = opt.resources?.find((r: any) => r.isPrimary) || opt.resources?.[0];
                        return primary?.resourceKey === res.resourceKey;
                      })
                      .map(option => {
                        const barOpacity = option.rank === 1 ? 1.0 : 0.5;
                        const barBg = option.rank === 1 ? `${C.accent}25` : `${C.accent}12`;
                        const barBorder = option.rank === 1 ? `2px solid ${C.accent}` : `1px dashed ${C.accent}66`;
                        // Ghost bar: earliest start → earliest end (visible near current schedule)
                        const gLeft = toPct(option.start);
                        const gRight = toPct(option.end);
                        const gW = Math.max(gRight - gLeft, 0.3);
                        // Start window extends right if there's flexibility
                        const hasWindow = option.latestStart && option.start !== option.latestStart;
                        const winRight = hasWindow ? toPct(option.latestEnd || option.end) : gRight;
                        const winW = winRight - gLeft;
                        const showWindow = hasWindow && winW > 0.5;
                        // Tooltip
                        const taskName = tasks.find((tk: any) => tk.key === whereToTaskKey)?.name || whereToTaskKey;
                        const resNames = option.resources?.map((r: any) => r.resourceName || r.resourceKey).join(', ') || '';
                        const tooltipText = [
                          `${taskName} — Option #${option.rank}`,
                          `Start window: ${fmtDayTimeRange(option.start, option.latestStart || option.start)}`,
                          `Suggested: ${fmtDayTime(option.latestStart || option.start)} (latest, no idle time)`,
                          `Duration: ${fmtDuration(option.duration)}`,
                          `End: ${fmtDayTime(option.latestEnd || option.end)}`,
                          `Resources: ${resNames}`,
                          `Score: ${option.score.toFixed(2)}`,
                        ].join('\n');
                        return (
                          <Fragment key={option.contextHash}>
                            {/* Start window — light background showing flexibility */}
                            {showWindow && (
                              <div style={{
                                position: 'absolute', left: `${gLeft}%`, width: `${winW}%`,
                                top: 2, height: LANE_H - 4, borderRadius: 4,
                                background: `${C.accent}08`, border: `1px dashed ${C.accent}22`,
                                pointerEvents: 'none', zIndex: 9,
                              }} />
                            )}
                            {/* Ghost bar — solid suggested placement at latest start */}
                            <div
                              title={tooltipText}
                              onClick={(e) => { e.stopPropagation(); onMoveTo?.(whereToTaskKey!, option); }}
                              style={{
                                position: 'absolute', left: `${gLeft}%`, width: `${gW}%`,
                                top: 2, height: LANE_H - 4, borderRadius: 4,
                                background: barBg, border: barBorder, opacity: barOpacity,
                                cursor: 'pointer', zIndex: 10,
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '0 8px', gap: 4, overflow: 'hidden',
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${C.accent}40`; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = barBg; }}
                            >
                              <span style={{ fontSize: 10, fontWeight: 600, color: C.accent, whiteSpace: 'nowrap' }}>
                                {option.rank === 1 ? '★' : `#${option.rank}`} {fmtDayTime(option.start)}
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 600, color: C.accent, whiteSpace: 'nowrap' }}>
                                Move Here
                              </span>
                            </div>
                          </Fragment>
                        );
                      })
                  )}
                  {/* Current assignment highlight */}
                  {whereToTaskKey && whereToCurrentAssignment && whereToCurrentAssignment.resources?.[0] === res.resourceKey && (
                    <div style={{
                      position: 'absolute',
                      left: `${toPct(whereToCurrentAssignment.start)}%`,
                      width: `${Math.max(toPct(whereToCurrentAssignment.end) - toPct(whereToCurrentAssignment.start), 0.3)}%`,
                      top: 1, height: LANE_H - 2,
                      border: `2px solid ${C.yellow}`, borderRadius: 6,
                      pointerEvents: 'none', zIndex: 9,
                    }}>
                      <span style={{
                        position: 'absolute', top: -12, right: 4,
                        fontSize: 9, color: C.yellow, fontWeight: 700,
                        background: C.surface, padding: '0 4px', borderRadius: 3,
                      }}>current</span>
                    </div>
                  )}
                  {/* CTP Query ghost bars */}
                  {ctpGhostBars && ctpGhostBars
                    .filter(bar => bar.resourceKeys.includes(res.resourceKey))
                    .map((bar, bi) => {
                      const gLeft = toPct(bar.start);
                      const gRight = toPct(bar.end);
                      const gW = Math.max(gRight - gLeft, 0.3);
                      return (
                        <div key={`ctp-${bi}`} title={`${bar.taskName}\n${new Date(bar.start).toLocaleString()} — ${new Date(bar.end).toLocaleString()}`} style={{
                          position: 'absolute', left: `${gLeft}%`, width: `${gW}%`,
                          top: 2, height: LANE_H - 4, borderRadius: 4,
                          background: `${C.green}25`, border: `2px dashed ${C.green}`,
                          pointerEvents: 'none', zIndex: 11,
                          display: 'flex', alignItems: 'center', padding: '0 6px',
                        }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: C.green, whiteSpace: 'nowrap' }}>
                            {bar.label}
                          </span>
                        </div>
                      );
                    })
                  }
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* ═══ WhereTo Overlay ═══ */}
      {/* Loading indicator */}
      {showGanttWhereTo && whereToTaskKey && whereToLoading && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, padding: '6px 16px', borderRadius: 8,
          background: C.surface, border: `1px solid ${C.accent}`,
          fontSize: 12, fontWeight: 600, color: C.accent,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          🗺️ Finding options...
        </div>
      )}
      {/* No options found */}
      {showGanttWhereTo && whereToTaskKey && !whereToLoading && whereToOptions && whereToOptions.length === 0 && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, padding: '8px 20px', borderRadius: 8,
          background: C.surface, border: `1px solid ${C.red}`,
          fontSize: 12, fontWeight: 600, color: C.red,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          No feasible options found
          <button onClick={onCancelWhereTo} style={{
            marginLeft: 12, padding: '2px 8px', borderRadius: 4,
            border: `1px solid ${C.border}`, background: 'transparent',
            color: C.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: FONT,
          }}>Dismiss</button>
        </div>
      )}
      {/* Info panel */}
      {showGanttWhereTo && whereToTaskKey && whereToOptions && whereToOptions.length > 0 && !whereToLoading && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 20,
          width: 280, maxHeight: 400, overflow: 'auto',
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: 14,
          fontFamily: FONT,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🗺️ Where To?</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                {whereToOptions.length} option{whereToOptions.length !== 1 ? 's' : ''} · Click to move
              </div>
            </div>
            <button onClick={onCancelWhereTo} style={{
              background: 'none', border: 'none', color: C.textMuted, fontSize: 16,
              cursor: 'pointer', padding: 4,
            }}>✕</button>
          </div>
          {whereToOptions.map((option: any) => {
            const ghostColor = option.rank === 1 ? C.green : option.rank <= 3 ? C.accent : C.textDim;
            return (
              <div key={option.contextHash}
                onClick={() => onMoveTo?.(whereToTaskKey!, option)}
                style={{
                  padding: '8px 10px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                  border: `1px solid ${option.rank === 1 ? C.green : C.border}`,
                  background: option.rank === 1 ? `${C.green}10` : 'transparent',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${C.accent}15`; }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = option.rank === 1 ? `${C.green}10` : 'transparent';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-flex', width: 18, height: 18, borderRadius: 9,
                      alignItems: 'center', justifyContent: 'center',
                      background: ghostColor, color: '#fff', fontSize: 9, fontWeight: 800,
                    }}>{option.rank}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                      {option.resources.map((r: any) => r.resourceName || r.resourceKey).join(' + ')}
                    </span>
                    {option.isBestOnResource && option.rank > 1 && (
                      <span style={{ fontSize: 9, color: C.accent, fontWeight: 600 }}>best on resource</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: ghostColor }}>
                    {option.score.toFixed(1)}
                  </span>
                </div>
                {option.latestStart && option.start !== option.latestStart ? (
                  <>
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                      Window: {fmtDayTimeRange(option.start, option.latestStart)}
                    </div>
                    <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>
                      Suggested: {fmtDayTimeRange(option.latestStart, option.latestEnd)} ({fmtDuration(option.duration)})
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                    {fmtDayTimeRange(option.latestStart || option.start, option.latestEnd || option.end)} ({fmtDuration(option.duration)})
                  </div>
                )}
                {option.changeover && (
                  <div style={{ fontSize: 10, color: C.yellow, marginTop: 2 }}>
                    ⚙ Changeover: {option.changeover.from} → {option.changeover.to}
                    ({Math.round(option.changeover.duration / 60)}min)
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 8, textAlign: 'center' }}>
            Press Escape to cancel
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div onClick={() => setContextMenu(null)} style={{
            position: 'fixed', inset: 0, zIndex: 998,
          }} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 999,
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 4, minWidth: 160, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            fontFamily: FONT,
          }}>
            <div style={{ padding: '6px 10px', fontSize: 11, color: C.textDim, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
              {contextMenu.task.name}
            </div>
            {onTaskClick && (
              <button onClick={() => { onTaskClick(contextMenu.task); setContextMenu(null); }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.text, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                🔍 View Details
              </button>
            )}
            {onAskAI && (
              <button onClick={() => { onAskAI(contextMenu.task); setContextMenu(null); }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.purple, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                ✨ Ask AI
              </button>
            )}
            {/* Contextual commitment actions */}
            {(() => {
              const task = contextMenu.task;
              const level = task._status || task.commitmentLevel || deriveDisplayLevel(task);
              const menuBtnStyle = {
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.text, fontSize: 12, cursor: 'pointer', textAlign: 'left' as const, fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              };
              const hoverIn = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).style.background = C.bg;
              const hoverOut = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).style.background = 'none';
              const items: React.ReactNode[] = [];

              // WhereTo for planned/unscheduled/infeasible
              if ((level === 'planned' || level === 'unscheduled' || level === 'infeasible') && onWhereTo) {
                items.push(
                  <button key="whereto" onClick={() => { onWhereTo(task.key); setContextMenu(null); }}
                    style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
                    🗺️ Where Can This Go?
                  </button>
                );
              }

              // Resource Pref for planned/unscheduled/infeasible
              if ((level === 'planned' || level === 'unscheduled' || level === 'infeasible') && onSetResourcePrefForTask) {
                items.push(
                  <button key="respref" onClick={() => { onSetResourcePrefForTask(task.key); setContextMenu(null); }}
                    style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
                    🔀 Set Resource Preference
                  </button>
                );
              }

              // Separator before commitment actions
              if (items.length > 0) {
                items.push(<div key="sep1" style={{ height: 1, background: C.border, margin: '2px 0' }} />);
              }

              // Commitment actions by level
              switch (level) {
                case 'planned':
                  if (onApiPin) items.push(
                    <button key="pin" onClick={async () => { setContextMenu(null); await onApiPin(task.key, true); }}
                      style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>📌 Pin</button>
                  );
                  if (onApiUnschedule) items.push(
                    <button key="unsched" onClick={async () => { setContextMenu(null); await onApiUnschedule(task.key); }}
                      style={{ ...menuBtnStyle, color: C.red }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>↩ Unschedule</button>
                  );
                  if (onExcludeTask) items.push(
                    <button key="exclude" onClick={() => { onExcludeTask(task.key, true); setContextMenu(null); }}
                      style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>✕ Exclude</button>
                  );
                  break;
                case 'pinned':
                  if (onApiPin) items.push(
                    <button key="unpin" onClick={async () => { setContextMenu(null); await onApiPin(task.key, false); }}
                      style={{ ...menuBtnStyle, color: C.yellow }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>📌 Unpin</button>
                  );
                  if (onToolbarAction) items.push(
                    <button key="dispatch" onClick={() => { setContextMenu(null); onToolbarAction('dispatch', [task.key]); }}
                      style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>🚀 Dispatch</button>
                  );
                  break;
                case 'dispatched':
                  if (onToolbarAction) {
                    items.push(
                      <button key="start" onClick={() => { setContextMenu(null); onToolbarAction('start', [task.key]); }}
                        style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>▶ Start</button>
                    );
                    items.push(
                      <button key="hold" onClick={() => { setContextMenu(null); onToolbarAction('hold', [task.key]); }}
                        style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>⏸ Hold</button>
                    );
                    items.push(
                      <button key="revert" onClick={() => { setContextMenu(null); onToolbarAction('revert', [task.key]); }}
                        style={{ ...menuBtnStyle, color: C.yellow }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>↩ Revert to Pinned</button>
                    );
                  }
                  break;
                case 'running':
                  if (onToolbarAction) {
                    items.push(
                      <button key="hold" onClick={() => { setContextMenu(null); onToolbarAction('hold', [task.key]); }}
                        style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>⏸ Hold</button>
                    );
                    items.push(
                      <button key="complete" onClick={() => { setContextMenu(null); onToolbarAction('complete', [task.key]); }}
                        style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>✓ Complete</button>
                    );
                  }
                  break;
                case 'on_hold':
                  if (onToolbarAction) items.push(
                    <button key="resume" onClick={() => { setContextMenu(null); onToolbarAction('resume', [task.key]); }}
                      style={menuBtnStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>▶ Resume</button>
                  );
                  break;
                case 'excluded':
                  if (onExcludeTask) items.push(
                    <button key="include" onClick={() => { onExcludeTask(task.key, false); setContextMenu(null); }}
                      style={{ ...menuBtnStyle, color: C.green }} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>✓ Re-include</button>
                  );
                  break;
              }

              return items;
            })()}
          </div>
        </>
      )}

      {/* Resource Context Menu */}
      {resContextMenu && (
        <>
          <div onClick={() => setResContextMenu(null)} style={{
            position: 'fixed', inset: 0, zIndex: 998,
          }} />
          <div style={{
            position: 'fixed', left: resContextMenu.x, top: resContextMenu.y, zIndex: 999,
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 4, minWidth: 160, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            fontFamily: FONT,
          }}>
            <div style={{ padding: '6px 10px', fontSize: 11, color: C.textDim, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
              {resContextMenu.resource.resourceName}
            </div>
            {onViewAgenda && (
              <button onClick={() => { onViewAgenda(resContextMenu.resource); setResContextMenu(null); }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.text, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                📋 View Agenda
              </button>
            )}
            {onResourceClick && (
              <button onClick={() => { onResourceClick(resContextMenu.resource); setResContextMenu(null); }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.text, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                🔍 View Details
              </button>
            )}
            {onResourceFilter && (
              <button onClick={() => { onResourceFilter(resContextMenu.resource.resourceKey); setResContextMenu(null); }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.text, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                ⊡ Filter Tasks
              </button>
            )}
            {onOpenDowntimeEditor && (
              <button onClick={() => { onOpenDowntimeEditor(resContextMenu.resource.resourceKey); setResContextMenu(null); }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: '#ef4444', fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                ⚠ Manage Downtime
              </button>
            )}
          </div>
        </>
      )}

      {/* Tooltip */}
      {hovered && (
        <div style={{
          position: 'fixed', left: tooltipPos.x + 12, top: tooltipPos.y - 10,
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: C.text, zIndex: 999,
          pointerEvents: 'none', fontFamily: FONT, minWidth: 200,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.name}</div>
          {hovered.type && hovered.type !== 'PROCESS' && (
            <div style={{ color: C.yellow, fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{hovered.type}</div>
          )}
          <div style={{ color: C.textMuted }}>
            {fmtDate(hovered.scheduledStart)} → {fmtDate(hovered.scheduledEnd)}
          </div>
          <div style={{ color: C.textMuted }}>{t('duration', 'Duration')}: {fmtDuration(hovered.durationSeconds)}</div>
          {hovered.orderRef && <div style={{ color: C.textMuted }}>{t('order', 'Order')}: {hovered.orderRef}</div>}
          {hovered.outputProductKey && (
            <div style={{ color: C.textMuted }}>
              Output: {products.find((p: any) => p.key === hovered.outputProductKey)?.name || hovered.outputProductKey} × {fmtNum(hovered.outputQty)}
            </div>
          )}
          {hovered.score != null && (
            <div style={{ color: C.textMuted }}>Score: {hovered.score.toFixed(2)}</div>
          )}
          {hovered.isOnCriticalPath && (
            <div style={{ fontSize: 10, color: '#f97316', fontWeight: 600, marginTop: 2 }}>
              {'\u26A1'} Critical path — zero slack
            </div>
          )}
          {!hovered.isOnCriticalPath && hovered.slack !== undefined && hovered.slack !== null && (
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
              Slack: {hovered.slack < 60 ? `${Math.round(hovered.slack)}s` : hovered.slack < 3600 ? `${Math.floor(hovered.slack / 60)}m` : `${Math.floor(hovered.slack / 3600)}h ${Math.floor((hovered.slack % 3600) / 60)}m`}
            </div>
          )}
          {hovered.commitmentLevel && hovered.commitmentLevel !== 'planned' && hovered.commitmentLevel !== 'unscheduled' && (
            <div style={{ fontSize: 10, fontWeight: 600, marginTop: 2, color:
              hovered.commitmentLevel === 'completed' ? '#16a34a' : hovered.commitmentLevel === 'running' ? '#ef4444' : hovered.commitmentLevel === 'on_hold' ? '#f59e0b' : hovered.commitmentLevel === 'dispatched' ? '#f97316' : C.accent }}>
              {{ completed: '\u2714 Completed', running: '\u25CF Running', on_hold: '\u26A0 On Hold', dispatched: '\u25C6 Dispatched', pinned: '\uD83D\uDCCC Pinned' }[hovered.commitmentLevel as string] || ''}
              {hovered.commitmentLevel === 'running' && hovered.percentComplete > 0 ? ` (${hovered.percentComplete}%)` : ''}
              {hovered.commitmentLevel === 'on_hold' && hovered.holdReason ? ` — ${hovered.holdReason}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GANTT BY CASE
   ═══════════════════════════════════════════════════════════════ */

const CASE_LANE_H = 44;
const CASE_LABEL_W = 180;

function CaseGanttChart({ tasks, orders, products: _products, colors, onTaskClick,
  taskPins, taskExcludes, taskUnschedules, orderModes,
  zoomLevel, setZoomLevel, scrollOffset, setScrollOffset }: {
  tasks: any[]; orders?: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void;
  taskPins?: Record<string, boolean>; taskExcludes?: Record<string, boolean>; taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  zoomLevel: string; setZoomLevel: (v: string) => void;
  scrollOffset: number; setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [hovered, setHovered] = useState<any>(null);
  const [hoveredGap, setHoveredGap] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [caseSearch, setCaseSearch] = useState('');
  const [sortBy, setSortBy] = useState<'start' | 'priority' | 'worstGap' | 'name'>('start');
  const isTimeRangeZoom = TIME_RANGE_OPTIONS.some(t => t.label === zoomLevel);
  const [lastTimeRange, setLastTimeRange] = useState(() => isTimeRangeZoom ? zoomLevel : '3 hours');
  const showCriticalPath = false; // Critical path toggle is on the resource Gantt only

  // Filter scheduled tasks (same as GanttChart)
  const scheduled = tasks.filter((tk: any) => {
    if (!tk.feasible || !tk.scheduledStart || !tk.scheduledEnd) return false;
    if (taskExcludes?.[tk.key]) return false;
    const om = orderModes?.[tk.orderRef] || 'INCLUDE';
    if (om === 'EXCLUDE') return false;
    return true;
  });
  const unscheduledTasks = tasks.filter((tk: any) => {
    if (taskExcludes?.[tk.key]) return false;
    const om = orderModes?.[tk.orderRef] || 'INCLUDE';
    if (om === 'EXCLUDE') return false;
    return !tk.feasible || !tk.scheduledStart || !tk.scheduledEnd;
  });

  if (scheduled.length === 0 && unscheduledTasks.length === 0) {
    return <div style={{ color: C.textDim, padding: 20, textAlign: 'center' }}>No tasks to display</div>;
  }

  // Detect timezone from task data for correct axis labels
  const { offsetMs: _tzOff, tz: _ganttTz } = detectGanttTz(scheduled);
  const _localH = (d: Date) => new Date(d.getTime() + _tzOff).getUTCHours();
  const _localM = (d: Date) => new Date(d.getTime() + _tzOff).getUTCMinutes();
  const _snapMidnight = (d: Date) => { const s = new Date(d.getTime() + _tzOff); s.setUTCHours(0, 0, 0, 0); return new Date(s.getTime() - _tzOff); };
  const _snapEndOfDay = (d: Date) => { const s = new Date(d.getTime() + _tzOff); s.setUTCHours(23, 59, 59, 999); return new Date(s.getTime() - _tzOff); };

  // Time range computation (same as GanttChart)
  const taskStarts = scheduled.map((tk: any) => new Date(tk.scheduledStart).getTime());
  const taskEnds = scheduled.map((tk: any) => new Date(tk.scheduledEnd).getTime());
  const dataStart = taskStarts.length > 0 ? Math.min(...taskStarts) : Date.now();
  const dataEnd = taskEnds.length > 0 ? Math.max(...taskEnds) : Date.now() + 86400000;

  const zoomConfig = ZOOM_LEVELS.find(z => z.label === zoomLevel);
  let hStartMs: number, hEndMs: number;
  if (zoomConfig && zoomConfig.days > 0) {
    const viewStart = new Date(dataStart);
    if (zoomConfig.days < 1) { viewStart.setUTCMinutes(0, 0, 0); }
    else { const snapped = _snapMidnight(viewStart); viewStart.setTime(snapped.getTime()); }
    const stepMs = zoomConfig.days * 24 * 3600 * 1000;
    const scrolledStart = new Date(viewStart.getTime() + scrollOffset * stepMs);
    hStartMs = scrolledStart.getTime();
    hEndMs = hStartMs + stepMs;
  } else {
    const bufferMs = 12 * 3600 * 1000;
    const hStartDate = _snapMidnight(new Date(dataStart - bufferMs));
    const hEndDate = _snapEndOfDay(new Date(dataEnd + bufferMs));
    hStartMs = hStartDate.getTime();
    hEndMs = hEndDate.getTime();
  }
  const totalMs = hEndMs - hStartMs;
  if (totalMs <= 0) return <div style={{ color: C.textDim }}>Invalid time range</div>;
  const toPct = (iso: string) => ((new Date(iso).getTime() - hStartMs) / totalMs) * 100;

  // Axis labels (same as GanttChart)
  const axisLabels: { pct: number; label: string }[] = [];
  if (zoomConfig && zoomConfig.days > 0 && zoomConfig.days <= 1) {
    const stepMin = zoomConfig.days <= 0.25 ? 30 : 60;
    const h = new Date(hStartMs); h.setUTCSeconds(0, 0);
    const mins = h.getUTCMinutes();
    const nextSlot = Math.ceil(mins / stepMin) * stepMin;
    if (nextSlot >= 60) { h.setUTCMinutes(0); h.setUTCHours(h.getUTCHours() + 1); }
    else if (nextSlot > mins) { h.setUTCMinutes(nextSlot); }
    else { h.setTime(h.getTime() + stepMin * 60000); h.setUTCSeconds(0, 0); }
    while (h.getTime() < hEndMs) {
      const hr = _localH(h); const min = _localM(h);
      let label: string;
      if (zoomConfig.days < 1) {
        label = h.toLocaleTimeString(_locale?.locale || 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: _ganttTz });
      } else {
        const isPeriodMark = hr % 6 === 0 && min === 0;
        const period = hr < 12 ? 'am' : 'pm';
        const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
        label = isPeriodMark ? `${hr12}${period}` : `${hr12}`;
      }
      axisLabels.push({ pct: ((h.getTime() - hStartMs) / totalMs) * 100, label });
      h.setTime(h.getTime() + stepMin * 60000);
    }
  } else {
    const step = zoomConfig && zoomConfig.days >= 14 ? 2 : 1;
    const d = _snapMidnight(new Date(hStartMs));
    d.setTime(d.getTime() + 86400000);
    let count = 0;
    while (d.getTime() < hEndMs) {
      if (count % step === 0) {
        axisLabels.push({
          pct: ((d.getTime() - hStartMs) / totalMs) * 100,
          label: d.toLocaleDateString(_locale?.locale || 'en-US', { month: 'short', day: 'numeric', timeZone: _ganttTz }),
        });
      }
      d.setTime(d.getTime() + 86400000); count++;
    }
  }

  // Build case rows
  type CaseRow = { caseKey: string; caseName: string; priority: string; phases: any[]; unscheduledPhases: any[]; gaps: { startMs: number; endMs: number; gapSec: number; fromName: string; toName: string }[]; earliestStart: number; worstGap: number };
  const caseMap = new Map<string, { sched: any[]; unsched: any[] }>();
  for (const tk of scheduled) {
    const key = tk.orderRef || tk.key;
    if (!caseMap.has(key)) caseMap.set(key, { sched: [], unsched: [] });
    caseMap.get(key)!.sched.push(tk);
  }
  for (const tk of unscheduledTasks) {
    const key = tk.orderRef || tk.key;
    if (!caseMap.has(key)) caseMap.set(key, { sched: [], unsched: [] });
    caseMap.get(key)!.unsched.push(tk);
  }

  let caseRows: CaseRow[] = [];
  for (const [caseKey, { sched, unsched }] of caseMap) {
    const phases = [...sched].sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
    const gaps: CaseRow['gaps'] = [];
    let worstGap = 0;
    for (let i = 0; i < phases.length - 1; i++) {
      const endMs = new Date(phases[i].scheduledEnd).getTime();
      const startMs = new Date(phases[i + 1].scheduledStart).getTime();
      const gapSec = Math.max(0, (startMs - endMs) / 1000);
      if (gapSec > 0) {
        gaps.push({ startMs: endMs, endMs: startMs, gapSec, fromName: phases[i].name, toName: phases[i + 1].name });
        worstGap = Math.max(worstGap, gapSec);
      }
    }
    const order = orders?.find((o: any) => o.orderKey === caseKey);
    const caseName = order?.name ?? caseKey;
    const priority = priorityLabel(phases[0]);
    const earliestStart = phases.length > 0 ? new Date(phases[0].scheduledStart).getTime() : Infinity;
    caseRows.push({ caseKey, caseName, priority, phases, unscheduledPhases: unsched, gaps, earliestStart, worstGap });
  }

  // Search filter
  if (caseSearch) {
    const q = caseSearch.toLowerCase();
    caseRows = caseRows.filter(r => r.caseName.toLowerCase().includes(q) || r.caseKey.toLowerCase().includes(q));
  }

  // Sort
  if (sortBy === 'start') caseRows.sort((a, b) => a.earliestStart - b.earliestStart);
  else if (sortBy === 'priority') caseRows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  else if (sortBy === 'worstGap') caseRows.sort((a, b) => b.worstGap - a.worstGap);
  else if (sortBy === 'name') caseRows.sort((a, b) => a.caseName.localeCompare(b.caseName));

  const navBtnStyle = { padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT } as const;

  return (
    <div style={{ position: 'relative' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <SearchBox value={caseSearch} onChange={setCaseSearch} placeholder={`Filter ${t('orders', 'orders').toLowerCase()}...`} />
        <span style={{ fontSize: 11, color: C.textDim, marginLeft: 8 }}>Sort:</span>
        {(['start', 'priority', 'worstGap', 'name'] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)} style={{
            padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: FONT,
            background: sortBy === s ? `${C.accent}22` : 'transparent',
            color: sortBy === s ? C.accent : C.textMuted,
            border: sortBy === s ? `1px solid ${C.accent}44` : `1px solid ${C.border}`,
          }}>
            {s === 'start' ? 'Earliest Start' : s === 'priority' ? 'Priority' : s === 'worstGap' ? 'Worst Gap' : 'Name'}
          </button>
        ))}
        <span style={{ fontSize: 12, color: C.textDim, marginLeft: 'auto' }}>
          {caseRows.length} {t(caseRows.length !== 1 ? 'orders' : 'order', caseRows.length !== 1 ? 'orders' : 'order').toLowerCase()}
        </span>
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <select value={lastTimeRange} onChange={e => { setLastTimeRange(e.target.value); setZoomLevel(e.target.value); setScrollOffset(0); }} style={{
          padding: '5px 14px', paddingRight: 24, borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: FONT,
          border: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
          backgroundColor: TIME_RANGE_OPTIONS.some(t => t.label === zoomLevel) ? '#3b82f6' : 'transparent',
          color: TIME_RANGE_OPTIONS.some(t => t.label === zoomLevel) ? '#fff' : '#94a3b8',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='${TIME_RANGE_OPTIONS.some(t => t.label === zoomLevel) ? 'white' : '%2394a3b8'}'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
        }}>
          {TIME_RANGE_OPTIONS.map(z => (
            <option key={z.label} value={z.label} style={{ background: '#1e293b', color: '#fff' }}>{z.label}</option>
          ))}
        </select>
        {ZOOM_LEVELS.filter(z => !TIME_RANGE_OPTIONS.includes(z)).map(z => (
          <button key={z.label} onClick={() => { setZoomLevel(z.label); setScrollOffset(0); }} style={{
            padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: z.label === zoomLevel ? '#3b82f6' : 'transparent',
            color: z.label === zoomLevel ? '#fff' : '#94a3b8',
            fontFamily: FONT,
          }}>{z.label}</button>
        ))}
        {zoomConfig && zoomConfig.days > 0 && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button onClick={() => setScrollOffset(s => s - 1)} style={navBtnStyle}>← {act('prev', 'Prev')}</button>
            <button onClick={() => setScrollOffset(0)} style={navBtnStyle}>{act('today', 'Today')}</button>
            <button onClick={() => setScrollOffset(s => s + 1)} style={navBtnStyle}>{act('next', 'Next')} →</button>
          </div>
        )}
      </div>

      {/* Time axis */}
      <div style={{ marginLeft: CASE_LABEL_W, display: 'flex', position: 'relative', height: 24, overflow: 'hidden' }}>
        {axisLabels.map((lbl, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${lbl.pct}%`, fontSize: 10, color: C.textMuted,
            transform: 'translateX(-50%)', whiteSpace: 'nowrap',
          }}>{lbl.label}</div>
        ))}
      </div>

      {/* Case lanes */}
      {caseRows.map(row => (
        <div key={row.caseKey} style={{ display: 'flex', borderTop: `1px solid ${C.border}` }}>
          {/* Row label */}
          <div style={{
            width: CASE_LABEL_W, minWidth: CASE_LABEL_W, padding: '8px 10px', fontSize: 12,
            color: C.textMuted, fontWeight: 500, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text, fontWeight: 600, fontSize: 11 }}
              title={row.caseName}>{row.caseName}</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {row.priority && (() => {
                const clr = priorityLabelColor(row.priority);
                return (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                    background: `${clr}20`, color: clr,
                  }}>{row.priority}</span>
                );
              })()}
              {row.worstGap > 0 && (
                <span style={{ fontSize: 9, color: C.red, fontWeight: 600 }}>{fmtDuration(row.worstGap)} gap</span>
              )}
            </div>
          </div>

          {/* Lane area */}
          <div style={{ flex: 1, position: 'relative', height: CASE_LANE_H, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(128,128,128,0.04)' }} />
            {/* Grid lines */}
            {axisLabels.map((lbl, i) => (
              <div key={i} style={{
                position: 'absolute', left: `${lbl.pct}%`, top: 0, bottom: 0,
                width: 1, background: C.border, opacity: 0.5,
              }} />
            ))}
            {/* Gap regions */}
            {row.gaps.map((gap, i) => {
              const left = ((gap.startMs - hStartMs) / totalMs) * 100;
              const w = ((gap.endMs - hStartMs) / totalMs) * 100 - left;
              if (w <= 0) return null;
              return (
                <div key={`gap-${i}`}
                  onMouseEnter={e => { setHoveredGap(gap); setHovered(null); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoveredGap(null)}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${w}%`,
                    top: 10, height: CASE_LANE_H - 20, borderRadius: 3,
                    background: gap.gapSec > 900 ? `${C.red}15` : '#ff980015',
                    border: `1.5px dashed ${gap.gapSec > 900 ? C.red : '#ff9800'}`,
                  }}
                />
              );
            })}
            {/* Phase bars */}
            {row.phases.map((tk: any) => {
              const left = toPct(tk.scheduledStart);
              const right = toPct(tk.scheduledEnd);
              const w = Math.max(right - left, 0.3);
              const barColor = colors ? getTaskColor(tk, colors) : C.accent;
              const isPinned = taskPins?.[tk.key];
              const isExcluded = taskExcludes?.[tk.key];
              const willUnsched = taskUnschedules?.has(tk.key);
              const isCriticalCase = showCriticalPath && tk.isOnCriticalPath;
              const isDimmedCase = showCriticalPath && !tk.isOnCriticalPath;
              return (
                <div key={tk.key}
                  onMouseEnter={e => { setHovered(tk); setHoveredGap(null); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onTaskClick?.(tk)}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${w}%`,
                    top: 6, height: CASE_LANE_H - 12, borderRadius: 4,
                    background: barColor, opacity: isDimmedCase ? 0.35 : isExcluded ? 0.2 : 0.85, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', paddingLeft: 4,
                    overflow: 'hidden', fontSize: 10, color: '#fff', fontWeight: 500,
                    transition: 'opacity 0.2s, border-top 0.2s, box-shadow 0.2s',
                    border: willUnsched ? `2px dashed ${C.red}` : 'none',
                    ...(isCriticalCase ? { borderTop: '2px solid #f97316', boxShadow: '0 0 6px #f9731640' } : {}),
                    ...(isPinned && !isCriticalCase ? { boxShadow: `0 0 0 2px ${C.accent}` } : {}),
                    ...(isExcluded ? { filter: 'grayscale(1)' } : {}),
                  }}>
                  {willUnsched && (
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: 'inherit',
                      background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${C.red}22 4px, ${C.red}22 8px)`,
                    }} />
                  )}
                  {isPinned && <span style={{ position: 'absolute', top: -6, right: -4, fontSize: 9, zIndex: 2 }}>📌</span>}
                  {w > 3 && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }}>{tk.name}</span>}
                </div>
              );
            })}
            {/* Unscheduled phases (dashed outlines) */}
            {row.unscheduledPhases.map((tk: any) => {
              const lastEndMs = row.phases.length > 0
                ? new Date(row.phases[row.phases.length - 1].scheduledEnd).getTime()
                : hStartMs;
              const estDurMs = (tk.durationSeconds || 3600) * 1000;
              const left = ((lastEndMs - hStartMs) / totalMs) * 100;
              const w = Math.max((estDurMs / totalMs) * 100, 0.5);
              return (
                <div key={tk.key}
                  onMouseEnter={e => { setHovered({ ...tk, _unscheduled: true }); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onTaskClick?.(tk)}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${w}%`,
                    top: 8, height: CASE_LANE_H - 16, borderRadius: 4,
                    background: 'transparent', border: `2px dashed ${C.textDim}`, opacity: 0.6,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', paddingLeft: 4,
                    overflow: 'hidden', fontSize: 9, color: C.textDim, fontWeight: 500,
                  }}>
                  {w > 3 && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.name}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Task tooltip */}
      {hovered && !hoveredGap && (
        <div style={{
          position: 'fixed', left: tooltipPos.x + 12, top: tooltipPos.y - 10,
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: C.text, zIndex: 999,
          pointerEvents: 'none', fontFamily: FONT, minWidth: 200,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.name}</div>
          {hovered._unscheduled && <div style={{ color: C.yellow, fontSize: 11, fontWeight: 600, marginBottom: 2 }}>Unscheduled</div>}
          {hovered.type && hovered.type !== 'PROCESS' && <div style={{ color: C.yellow, fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{hovered.type}</div>}
          {hovered.scheduledStart && <div style={{ color: C.textMuted }}>{fmtDate(hovered.scheduledStart)} → {fmtDate(hovered.scheduledEnd)}</div>}
          <div style={{ color: C.textMuted }}>{t('duration', 'Duration')}: {fmtDuration(hovered.durationSeconds)}</div>
          {hovered.assignedResources?.length > 0 && (
            <div style={{ color: C.textMuted }}>Resources: {hovered.assignedResources.map((r: any) => r.resourceKey).join(', ')}</div>
          )}
          {hovered.isOnCriticalPath && (
            <div style={{ fontSize: 10, color: '#f97316', fontWeight: 600, marginTop: 2 }}>
              {'\u26A1'} Critical path — zero slack
            </div>
          )}
          {!hovered.isOnCriticalPath && hovered.slack !== undefined && hovered.slack !== null && (
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
              Slack: {hovered.slack < 60 ? `${Math.round(hovered.slack)}s` : hovered.slack < 3600 ? `${Math.floor(hovered.slack / 60)}m` : `${Math.floor(hovered.slack / 3600)}h ${Math.floor((hovered.slack % 3600) / 60)}m`}
            </div>
          )}
        </div>
      )}

      {/* Gap tooltip */}
      {hoveredGap && (
        <div style={{
          position: 'fixed', left: tooltipPos.x + 12, top: tooltipPos.y - 10,
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: C.text, zIndex: 999,
          pointerEvents: 'none', fontFamily: FONT, minWidth: 160,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 700, color: hoveredGap.gapSec > 900 ? C.red : '#ff9800', marginBottom: 4 }}>
            Gap: {fmtDuration(hoveredGap.gapSec)}
          </div>
          <div style={{ color: C.textMuted, fontSize: 11 }}>
            Between {hoveredGap.fromName} and {hoveredGap.toName}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TASK STATUS HELPERS
   ═══════════════════════════════════════════════════════════════ */

function deriveTaskStatus(tk: any, taskPins?: Record<string, boolean>, taskExcludes?: Record<string, boolean>,
  taskUnschedules?: Set<string>, orderModes?: Record<string, string>): string {
  // Commitment-level statuses from API
  if (tk.commitmentLevel === 'completed') return 'completed';
  if (tk.commitmentLevel === 'running') return 'running';
  if (tk.commitmentLevel === 'on_hold') return 'on_hold';
  if (tk.commitmentLevel === 'dispatched') return 'dispatched';
  // Local overrides (client-side pending actions)
  const isExcluded = taskExcludes?.[tk.key] || false;
  const orderMode = orderModes?.[tk.orderRef] || 'INCLUDE';
  if (isExcluded || orderMode === 'EXCLUDE') return 'excluded';
  const isPinned = taskPins?.[tk.key] || false;
  if (isPinned || orderMode === 'LOCKED') return 'pinned';
  if (taskUnschedules?.has?.(tk.key)) return 'unscheduled';
  if (tk.feasible && tk.scheduledStart) return 'planned';
  if (tk.errors?.length > 0) return 'infeasible';
  return 'unscheduled';
}

/** Extended status check — returns 'rush' for rush tasks regardless of their base status.
 *  Used by the filter to support Rush as a pseudo-status chip. */
function deriveTaskStatusExtended(tk: any): string {
  if ((tk.priority ?? 100) <= 10) return 'rush';
  return tk._status;
}

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  completed:   { label: 'Done',        color: '#06b6d4', icon: '✔' },
  running:     { label: 'Running',     color: '#ef4444', icon: '●' },
  on_hold:     { label: 'On Hold',     color: '#f59e0b', icon: '⚠' },
  dispatched:  { label: 'Dispatched',  color: '#f97316', icon: '◆' },
  pinned:      { label: 'Pinned',      color: '#3b82f6', icon: '📌' },
  planned:     { label: 'Planned',     color: '#22c55e', icon: '✓' },
  infeasible:  { label: 'Infeasible',  color: '#ef4444', icon: '✕' },
  excluded:    { label: 'Excluded',    color: '#475569', icon: '—' },
  unscheduled: { label: 'Unsched',     color: '#9ca3af', icon: '○' },
};

function deriveDisplayLevel(task: any): string {
  if (task.commitmentLevel) return task.commitmentLevel;
  if (task.excluded || task._status === 'excluded') return 'excluded';
  if (!task.feasible && task.errors?.length > 0) return 'infeasible';
  if (task.dispatched) return 'dispatched';
  if (task.pinned) return 'pinned';
  if (task.feasible && task.scheduledStart) return 'planned';
  return 'unscheduled';
}

function taskStatusBadge(tk: any) {
  // Prefer _status (set by deriveTaskStatus, accounts for local overrides like taskUnschedules/taskPins/taskExcludes)
  const level = tk._status || tk.commitmentLevel || deriveDisplayLevel(tk);
  const c = TASK_STATUS_CONFIG[level] || TASK_STATUS_CONFIG.unscheduled;
  const label = t(level + 'Status', c.label);
  return <Badge label={`${c.icon} ${label}`} color={c.color} />;
}

/* ═══════════════════════════════════════════════════════════════
   COMMITMENT STATE MACHINE
   ═══════════════════════════════════════════════════════════════ */

// State machine: unscheduled→planned→pinned→dispatched→running→completed (on_hold branch)

function canTransition(task: any, action: string): { allowed: boolean; reason?: string } {
  const level = task._status || task.commitmentLevel || deriveDisplayLevel(task);

  switch (action) {
    case 'unschedule':
      if (level === 'running') return { allowed: false, reason: 'Cannot unschedule a running task' };
      if (level === 'on_hold') return { allowed: false, reason: 'Cannot unschedule a task on hold' };
      if (level === 'dispatched') return { allowed: false, reason: 'Revert to pinned first — materials have been pulled' };
      if (level === 'pinned') return { allowed: false, reason: 'Unpin first, then unschedule' };
      if (level === 'completed') return { allowed: false, reason: 'Cannot unschedule a completed task' };
      return { allowed: true };
    case 'pin':
      if (level !== 'planned') return { allowed: false, reason: 'Only planned tasks can be pinned' };
      return { allowed: true };
    case 'unpin':
      if (level !== 'pinned') return { allowed: false, reason: 'Task is not pinned' };
      return { allowed: true };
    case 'dispatch':
      if (level !== 'pinned') return { allowed: false, reason: 'Pin the task first, then dispatch' };
      return { allowed: true };
    case 'revert':
      if (level !== 'dispatched') return { allowed: false, reason: 'Only dispatched tasks can be reverted' };
      return { allowed: true };
    case 'start':
      if (level !== 'dispatched') return { allowed: false, reason: 'Dispatch the task first, then start' };
      return { allowed: true };
    case 'hold':
      if (level !== 'running' && level !== 'dispatched') return { allowed: false, reason: 'Only running or dispatched tasks can be put on hold' };
      return { allowed: true };
    case 'resume':
      if (level !== 'on_hold') return { allowed: false, reason: 'Task is not on hold' };
      return { allowed: true };
    case 'complete':
      if (level !== 'running') return { allowed: false, reason: 'Only running tasks can be completed' };
      return { allowed: true };
    default:
      return { allowed: true };
  }
}

interface ToolbarAction {
  key: string;
  label: string;
  icon: string;
  count?: number;
}

const ACTION_CONFIG: Record<string, ToolbarAction> = {
  schedule:   { key: 'schedule', label: 'Schedule', icon: '▶' },
  unschedule: { key: 'unschedule', label: 'Unschedule', icon: '↩' },
  pin:        { key: 'pin', label: 'Pin', icon: '📌' },
  unpin:      { key: 'unpin', label: 'Unpin', icon: '📌' },
  dispatch:   { key: 'dispatch', label: 'Dispatch', icon: '🚀' },
  revert:     { key: 'revert', label: 'Revert', icon: '↩' },
  start:      { key: 'start', label: 'Start', icon: '▶' },
  hold:       { key: 'hold', label: 'Hold', icon: '⏸' },
  resume:     { key: 'resume', label: 'Resume', icon: '▶' },
  complete:   { key: 'complete', label: 'Complete', icon: '✓' },
  exclude:    { key: 'exclude', label: 'Exclude', icon: '✕' },
  include:    { key: 'include', label: 'Include', icon: '✓' },
  whereto:    { key: 'whereto', label: 'WhereTo', icon: '🔍' },
  resourcePref: { key: 'resourcePref', label: 'Resource Pref', icon: '🔀' },
  rush:       { key: 'rush', label: 'Rush', icon: '⚡' },
  extend_window: { key: 'extend_window', label: 'Extend Window', icon: '⟫' },
};

function getToolbarActions(selectedTasks: any[]): ToolbarAction[] {
  if (selectedTasks.length === 0) return [];

  // Count tasks at each level
  const levelCounts: Record<string, number> = {};
  for (const t of selectedTasks) {
    const l = t._status || t.commitmentLevel || deriveDisplayLevel(t);
    levelCounts[l] = (levelCounts[l] || 0) + 1;
  }

  const actions: ToolbarAction[] = [];
  const add = (key: string, count: number) => {
    if (count > 0) actions.push({ ...ACTION_CONFIG[key], count });
  };

  // WhereTo — single selection, planned / unscheduled / infeasible
  if (selectedTasks.length === 1 && ((levelCounts.planned || 0) + (levelCounts.unscheduled || 0) + (levelCounts.infeasible || 0) > 0)) {
    actions.push({ ...ACTION_CONFIG.whereto });
  }

  // Each button maps to specific source levels
  add('schedule',   (levelCounts.unscheduled || 0) + (levelCounts.infeasible || 0));
  add('pin',        levelCounts.planned || 0);
  add('unpin',      levelCounts.pinned || 0);
  add('unschedule', levelCounts.planned || 0);
  add('exclude',    (levelCounts.planned || 0) + (levelCounts.unscheduled || 0) + (levelCounts.infeasible || 0));
  add('include',    levelCounts.excluded || 0);
  add('resourcePref', (levelCounts.planned || 0) + (levelCounts.unscheduled || 0) + (levelCounts.infeasible || 0));
  add('rush',       (levelCounts.planned || 0) + (levelCounts.unscheduled || 0) + (levelCounts.infeasible || 0));
  add('dispatch',   levelCounts.pinned || 0);
  add('start',      levelCounts.dispatched || 0);
  add('hold',       (levelCounts.running || 0) + (levelCounts.dispatched || 0));
  add('resume',     levelCounts.on_hold || 0);
  add('revert',     levelCounts.dispatched || 0);
  add('complete',   levelCounts.running || 0);
  add('extend_window', (levelCounts.planned || 0) + (levelCounts.unscheduled || 0) + (levelCounts.infeasible || 0));

  return actions;
}

/* ═══════════════════════════════════════════════════════════════
   TASK TABLE — INLINE & BULK ACTIONS
   ═══════════════════════════════════════════════════════════════ */

function IconBtn({ icon, title, active, activeColor, onClick }: {
  icon: string; title: string; active?: boolean; activeColor?: string; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = active ? (activeColor || C.accent) : hovered ? C.text : C.textDim;
  const bg = active ? `${activeColor || C.accent}20` : hovered ? `${C.text}10` : 'transparent';
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 6,
        border: active ? `1px solid ${activeColor}40` : '1px solid transparent',
        background: bg, color, cursor: 'pointer',
        fontSize: 12, padding: 0, fontFamily: FONT, transition: 'all 0.1s',
      }}>{icon}</button>
  );
}

function BulkBtn({ icon, label, color, onClick }: {
  icon: string; label: string; color: string; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 6,
        border: `1px solid ${hovered ? color : C.border}`,
        background: hovered ? `${color}15` : 'transparent',
        color: hovered ? color : C.textMuted,
        fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
        transition: 'all 0.15s',
      }}>
      <span style={{ fontSize: 10 }}>{icon}</span>
      {label}
    </button>
  );
}

function TaskRowActions({ task, taskPins, taskExcludes, taskUnschedules, orderModes,
  onPin, onExclude, onUnschedule, onWhereTo, whereToTaskKey,
  onApiSchedule, actionLoading }: {
  task: any;
  taskPins: Record<string, boolean>; taskExcludes: Record<string, boolean>;
  taskUnschedules?: Set<string>;
  orderModes: Record<string, string>;
  onPin: (taskKey: string) => void; onExclude: (taskKey: string) => void;
  onUnschedule: (taskKey: string) => void;
  onWhereTo?: (taskKey: string, source?: 'gantt' | 'table') => void;
  whereToTaskKey?: string | null;
  onApiSchedule?: (key: string) => Promise<void>;
  actionLoading?: string | null;
}) {
  const isPinned = taskPins[task.key] || task.pinned || false;
  const isExcluded = taskExcludes[task.key] || false;
  const isScheduled = task.feasible && task.scheduledStart;
  const orderMode = orderModes[task.orderRef] || 'INCLUDE';
  const isLocked = orderMode === 'LOCKED';
  const isLoading = actionLoading === task.key;

  if (isLocked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
        <span style={{ fontSize: 10, color: C.yellow }} title="Order is locked">🔒</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 2 }}
      onClick={(e) => e.stopPropagation()}>
      {!isScheduled && !isExcluded && !isPinned && onApiSchedule && (
        <IconBtn icon={isLoading ? '⏳' : '▶'}
          title="Schedule this task"
          active={false} activeColor={C.green}
          onClick={() => { if (!isLoading) onApiSchedule(task.key); }} />
      )}
      {task.type === 'PROCESS' && !isExcluded && onWhereTo && (
        <IconBtn icon="🗺️"
          title="Where can this go?"
          active={whereToTaskKey === task.key} activeColor={C.accent}
          onClick={() => onWhereTo(task.key, 'table')} />
      )}
      {isScheduled && (
        <IconBtn icon="📌" title={isPinned ? 'Unpin' : 'Pin to position'}
          active={isPinned} activeColor={C.yellow} onClick={() => onPin(task.key)} />
      )}
      <IconBtn icon={isExcluded ? '▶' : '⏸'}
        title={isExcluded ? 'Include in solve' : 'Exclude from solve'}
        active={isExcluded} activeColor={C.textDim} onClick={() => onExclude(task.key)} />
      {isScheduled && !isPinned && (
        <IconBtn icon={taskUnschedules?.has(task.key) ? '\u21A9' : '\u2715'}
          title={taskUnschedules?.has(task.key) ? 'Cancel Unschedule' : 'Unschedule'}
          active={taskUnschedules?.has(task.key) || false} activeColor={C.red}
          onClick={() => onUnschedule(task.key)} />
      )}
    </div>
  );
}

function TaskBulkActions({ filteredTasks, taskPins: _taskPins, taskExcludes: _taskExcludes, orderModes,
  onPinAll, onUnpinAll, onExcludeAll, onIncludeAll, onUnscheduleAll,
  onSolveAll, onRushAll, onResourcePrefAll, onExtendWindowAll }: {
  filteredTasks: any[];
  taskPins: Record<string, boolean>; taskExcludes: Record<string, boolean>;
  orderModes: Record<string, string>;
  onPinAll: (keys: string[]) => void; onUnpinAll: (keys: string[]) => void;
  onExcludeAll: (keys: string[]) => void; onIncludeAll: (keys: string[]) => void;
  onUnscheduleAll: (keys: string[]) => void;
  onSolveAll?: (keys: string[]) => void;
  onRushAll?: (keys: string[]) => void;
  onResourcePrefAll?: (keys: string[]) => void;
  onExtendWindowAll?: (keys: string[]) => void;
}) {
  const actionable = filteredTasks.filter(t => {
    const orderMode = orderModes[t.orderRef] || 'INCLUDE';
    return orderMode !== 'LOCKED';
  });
  // Use _status (commitment-aware) to determine what can be unscheduled/pinned
  const planned = actionable.filter(t => t._status === 'planned');
  const pinnedTasks = actionable.filter(t => t._status === 'pinned');
  const unscheduled = actionable.filter(t => t._status === 'unscheduled');
  const infeasible = actionable.filter(t => t._status === 'infeasible');
  const excludedCount = actionable.filter(t => t._status === 'excluded').length;
  const plannedKeys = planned.map(t => t.key);
  const actionableKeys = actionable.map(t => t.key);
  const needsSchedulingKeys = [...unscheduled, ...infeasible].map(t => t.key);
  const rushableKeys = [...planned, ...unscheduled, ...infeasible].map(t => t.key);

  if (filteredTasks.length <= 1) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
      fontSize: 11, color: C.textMuted, flexWrap: 'wrap',
      borderBottom: `1px solid ${C.border}`, marginBottom: 8,
    }}>
      <span style={{ fontWeight: 700, fontSize: 11, color: C.textDim, marginRight: 4 }}>
        Bulk ({filteredTasks.length} shown):
      </span>

      {/* Unscheduled / infeasible actions */}
      {needsSchedulingKeys.length > 0 && onSolveAll && (
        <BulkBtn icon="▶" label={`Schedule ${needsSchedulingKeys.length}`} color={C.green}
          onClick={() => onSolveAll!(needsSchedulingKeys)} />
      )}
      {needsSchedulingKeys.length > 0 && onResourcePrefAll && (
        <BulkBtn icon="🔀" label={`Resource Pref ${needsSchedulingKeys.length}`} color={C.accent}
          onClick={() => onResourcePrefAll!(needsSchedulingKeys)} />
      )}
      {needsSchedulingKeys.length > 0 && onExtendWindowAll && (
        <BulkBtn icon="⟫" label={`Extend Window ${needsSchedulingKeys.length}`} color={C.textMuted}
          onClick={() => onExtendWindowAll!(needsSchedulingKeys)} />
      )}
      {rushableKeys.length > 0 && onRushAll && (
        <BulkBtn icon="⚡" label={`Rush ${rushableKeys.length}`} color={C.yellow}
          onClick={() => onRushAll!(rushableKeys)} />
      )}

      {/* Planned actions */}
      {planned.length > 0 && (
        <BulkBtn icon="✕" label={`Unschedule ${planned.length}`} color={C.red}
          onClick={() => onUnscheduleAll(plannedKeys)} />
      )}
      {planned.length > 0 && (
        <BulkBtn icon="📌" label={`Pin ${planned.length}`} color={C.yellow}
          onClick={() => onPinAll(plannedKeys)} />
      )}
      {pinnedTasks.length > 0 && (
        <BulkBtn icon="📌" label={`Unpin ${pinnedTasks.length}`} color={C.textDim}
          onClick={() => onUnpinAll(pinnedTasks.map(t => t.key))} />
      )}
      {excludedCount < actionable.length && (
        <BulkBtn icon="⏸" label={`Exclude ${actionable.length - excludedCount}`} color={C.textDim}
          onClick={() => onExcludeAll(actionableKeys)} />
      )}
      {excludedCount > 0 && (
        <BulkBtn icon="▶" label={`Include ${excludedCount}`} color={C.green}
          onClick={() => onIncludeAll(actionableKeys)} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TASK TABLE
   ═══════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════
// RESOURCE HIERARCHY BROWSER
// ═══════════════════════════════════════════════════════════════

function ResourceHierarchyBrowser({ resources, selectedResources, onSelectionChange }: {
  resources: any[];
  selectedResources: Set<string>;
  onSelectionChange: (s: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Build tree: workCenter → resourceType → resource
  const tree = useMemo(() => {
    const wcMap = new Map<string, Map<string, any[]>>();
    for (const r of resources) {
      const wc = r.workCenter || 'Other';
      const rt = r.line || r.resourceType || r.resourceClass || 'Resource';
      if (!wcMap.has(wc)) wcMap.set(wc, new Map());
      const rtMap = wcMap.get(wc)!;
      if (!rtMap.has(rt)) rtMap.set(rt, []);
      rtMap.get(rt)!.push(r);
    }
    return wcMap;
  }, [resources]);

  const toggleExpand = (key: string) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  };

  const toggleResource = (key: string) => {
    onSelectionChange((() => { const n = new Set(selectedResources); if (n.has(key)) n.delete(key); else n.add(key); return n; })());
  };

  const toggleGroup = (keys: string[]) => {
    const allSelected = keys.every(k => selectedResources.has(k));
    onSelectionChange((() => {
      const n = new Set(selectedResources);
      keys.forEach(k => allSelected ? n.delete(k) : n.add(k));
      return n;
    })());
  };

  if (resources.length === 0) return null;

  const selectedCount = selectedResources.size;
  const totalRes = resources.length;

  return (
    <div style={{ fontSize: 12, fontFamily: FONT }}>
      {[...tree.entries()].map(([wc, rtMap]) => {
        const wcKeys = [...rtMap.values()].flat().map(r => r.resourceKey);
        const wcSelected = wcKeys.filter(k => selectedResources.has(k)).length;
        const isExpanded = expanded.has(wc);
        return (
          <div key={wc}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', cursor: 'pointer' }}
              onClick={() => toggleExpand(wc)}>
              <span style={{ fontSize: 10, color: C.textDim, width: 12 }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
              <input type="checkbox" checked={wcSelected === wcKeys.length && wcKeys.length > 0}
                ref={el => { if (el) el.indeterminate = wcSelected > 0 && wcSelected < wcKeys.length; }}
                onChange={() => toggleGroup(wcKeys)}
                onClick={e => e.stopPropagation()}
                style={{ accentColor: C.accent }} />
              <span style={{ fontWeight: 600, color: C.text }}>{wc}</span>
              <span style={{ fontSize: 10, color: C.textDim }}>({wcKeys.length} resources)</span>
            </div>
            {isExpanded && [...rtMap.entries()].map(([rt, resList]) => {
              const rtKeys = resList.map((r: any) => r.resourceKey);
              const rtSelected = rtKeys.filter((k: string) => selectedResources.has(k)).length;
              return (
                <div key={rt} style={{ paddingLeft: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                    <input type="checkbox" checked={rtSelected === rtKeys.length && rtKeys.length > 0}
                      ref={el => { if (el) el.indeterminate = rtSelected > 0 && rtSelected < rtKeys.length; }}
                      onChange={() => toggleGroup(rtKeys)}
                      style={{ accentColor: C.accent }} />
                    <span style={{ color: C.textMuted, fontWeight: 500 }}>{rt}</span>
                  </div>
                  {resList.map((r: any) => (
                    <div key={r.resourceKey} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 2px 20' }}>
                      <input type="checkbox" checked={selectedResources.has(r.resourceKey)}
                        onChange={() => toggleResource(r.resourceKey)}
                        style={{ accentColor: C.accent }} />
                      <span style={{ color: C.text, flex: 1 }}>{r.resourceName}</span>
                      <div style={{ width: 60, height: 4, background: C.surface2, borderRadius: 2 }}>
                        <div style={{
                          width: `${Math.min(r.utilization ?? 0, 100)}%`, height: '100%', borderRadius: 2,
                          background: (r.utilization ?? 0) > 85 ? C.red : (r.utilization ?? 0) > 60 ? C.yellow : C.green,
                        }} />
                      </div>
                      <span style={{ fontSize: 10, color: C.textDim, minWidth: 28, textAlign: 'right' as const }}>{Math.round(r.utilization ?? 0)}%</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
      {selectedCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, color: C.textMuted }}>{selectedCount} of {totalRes} resources selected</span>
          <button onClick={() => onSelectionChange(new Set())} style={{
            fontSize: 10, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline',
          }}>Clear</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ATTRIBUTE SEARCH
// ═══════════════════════════════════════════════════════════════

function AttributeSearch({ resources, selectedAttributes, onAttributesChange }: {
  resources: any[];
  selectedAttributes: { name: string; value: string }[];
  onAttributesChange: (attrs: { name: string; value: string }[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Build attribute index: { displayValue → { name, value, resourceKeys[] } }
  const attrIndex = useMemo(() => {
    const index: { display: string; name: string; value: string; resourceKeys: string[] }[] = [];
    const seen = new Map<string, Set<string>>();
    for (const r of resources) {
      for (const a of (r.attributes || [])) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) {
          const key = `${a.name}:${v}`;
          if (!seen.has(key)) seen.set(key, new Set());
          seen.get(key)!.add(r.resourceKey);
        }
      }
    }
    for (const [key, resKeys] of seen) {
      const [name, ...rest] = key.split(':');
      const value = rest.join(':');
      index.push({ display: `${value} (${name})`, name, value, resourceKeys: [...resKeys] });
    }
    index.sort((a, b) => a.display.localeCompare(b.display));
    return index;
  }, [resources]);

  const suggestions = query.length >= 1
    ? attrIndex.filter(a => a.display.toLowerCase().includes(query.toLowerCase()) &&
        !selectedAttributes.some(s => s.name === a.name && s.value === a.value)).slice(0, 8)
    : [];

  const addAttribute = (attr: { name: string; value: string }) => {
    onAttributesChange([...selectedAttributes, attr]);
    setQuery('');
    setShowSuggestions(false);
  };



  return (
    <div style={{ fontSize: 12, fontFamily: FONT }}>
      <div style={{ position: 'relative' }}>
        <input value={query} onChange={e => { setQuery(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          placeholder="Search resource attributes..."
          style={{
            width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12,
            background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
            boxSizing: 'border-box',
          }} />
        {showSuggestions && suggestions.length > 0 && (
          <>
            <div onClick={() => setShowSuggestions(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 100,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)', maxHeight: 200, overflowY: 'auto',
            }}>
              {suggestions.map(s => (
                <div key={`${s.name}:${s.value}`} onClick={() => addAttribute({ name: s.name, value: s.value })}
                  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: C.text }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}10`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontWeight: 600 }}>{s.value}</span>
                  <span style={{ color: C.textDim, marginLeft: 6 }}>({s.name})</span>
                  <span style={{ color: C.textDim, marginLeft: 6, fontSize: 10 }}>{s.resourceKeys.length} resource{s.resourceKeys.length !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TaskTable({ tasks, products, colors, onTaskClick, taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask,
  onApiUnschedule, onApiPin, onApiBulkUnschedule, onApiBulkPin,
  experienceLevel = 'novice',
  onWhereTo, whereToTaskKey, caseFilter, onClearCaseFilter, onNavigateToOrders,
  resourceFilter, resourceFilterName, timeFilter, onResourceFilterChange, onTimeFilterChange,
  selectedTasks, onToggleSelect, onSetSelectedTasks,
  onScheduleSelected, onUnscheduleSelected, onPinSelected, onUnpinSelected, onExcludeSelected, onIncludeSelected,
  onSetResourcePreference, resourcePreferenceOverrides,
  priorityOverrides, onSetPriority: _onSetPriority, onRushSelected,
  onApiSchedule, actionLoading, resourceUtilization, isQueuing = false,
  onToolbarAction }: {
  tasks: any[]; products: any[]; colors: any; onTaskClick?: (t: any) => void;
  taskPins?: Record<string, boolean>; taskExcludes?: Record<string, boolean>; taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onPinTask?: (key: string, pinned: boolean) => void;
  onExcludeTask?: (key: string, excluded: boolean) => void;
  onUnscheduleTask?: (key: string) => void;
  onApiUnschedule?: (key: string) => Promise<void>;
  onApiPin?: (key: string, pinned: boolean) => Promise<void>;
  onApiBulkUnschedule?: (keys: string[]) => Promise<void>;
  onApiBulkPin?: (keys: string[], pinned: boolean) => Promise<void>;
  onApiSchedule?: (key: string) => Promise<void>;
  actionLoading?: string | null;
  experienceLevel?: ExperienceLevel;
  onWhereTo?: (key: string, source?: 'gantt' | 'table') => void;
  whereToTaskKey?: string | null;
  caseFilter?: string | null;
  onClearCaseFilter?: () => void;
  onNavigateToOrders?: (orderKey: string) => void;
  resourceFilter?: string | null;
  resourceFilterName?: string | null;
  timeFilter?: { after?: string; before?: string };
  onResourceFilterChange?: (key: string | null) => void;
  onTimeFilterChange?: (f: { after?: string; before?: string }) => void;
  selectedTasks?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onSetSelectedTasks?: (s: Set<string>) => void;
  onScheduleSelected?: (keys: string[], e?: any) => void;
  onUnscheduleSelected?: (keys: string[], e?: any) => void;
  onPinSelected?: (keys: string[], e?: any) => void;
  onUnpinSelected?: (keys: string[], e?: any) => void;
  onExcludeSelected?: (keys: string[]) => void;
  onIncludeSelected?: (keys: string[]) => void;
  onSetResourcePreference?: () => void;
  resourcePreferenceOverrides?: Record<string, Record<string, string>>;
  priorityOverrides?: Record<string, number>;
  onSetPriority?: (key: string, priority: number) => void;
  onRushSelected?: (keys: string[], e?: any) => void;
  onToolbarAction?: (action: string, taskKeys: string[], event?: any) => void;
  resourceUtilization?: any[];
  isQueuing?: boolean;
}) {
  const { sortKey, sortDir, toggle, sorted } = useSort('key');
  const [activeTypeChips, setActiveTypeChips] = useState<Set<string>>(new Set(['PROCESS']));

  const caseTasks = useMemo(() => caseFilter ? tasks.filter(tk => tk.orderRef === caseFilter) : tasks, [tasks, caseFilter]);

  const enriched = useMemo(() => caseTasks.map(tk => {
    const _status = deriveTaskStatus(tk, taskPins, taskExcludes, taskUnschedules, orderModes);
    const _orderMode = orderModes?.[tk.orderRef] || 'INCLUDE';
    const _productName = tk.outputProductKey
      ? (products.find((p: any) => p.key === tk.outputProductKey)?.name || tk.outputProductKey)
      : (tk.processName || '');
    const _priority = priorityOverrides?.[tk.key] ?? tk.priority ?? 100;
    const _priorityLabel = priorityLabel(tk, priorityOverrides?.[tk.key]);
    const _priorityRank = priorityRank(_priorityLabel);
    const _type = tk.type || 'PROCESS';
    const _processCategory = tk.processCategory || '';
    return {
      ...tk,
      _resource: tk.assignedResources?.[0]?.resourceKey || '',
      _allResourceKeys: (tk.assignedResources || []).map((r: any) => r.resourceKey).concat(
        (tk.assignedResources || []).map((r: any) => r.requestedResource).filter(Boolean)
      ),
      _status,
      _orderMode,
      _productName,
      _priority,
      _priorityLabel,
      _priorityRank,
      _type,
      _processCategory,
      _slackSort: tk.isOnCriticalPath ? -1 : (tk.slack ?? Infinity),
      _commitSort: { running: 0, on_hold: 1, dispatched: 2, pinned: 3, planned: 4, unscheduled: 5 }[tk.commitmentLevel as string] ?? 5,
    };
  }), [caseTasks, taskPins, taskExcludes, taskUnschedules, orderModes, products, priorityOverrides]);

  // Derive distinct types from data
  const distinctTypes = useMemo(() => {
    const types = new Set(enriched.map(tk => tk._type));
    return Array.from(types).sort();
  }, [enriched]);

  const allTypesActive = activeTypeChips.size >= distinctTypes.length;
  const toggleTypeChip = useCallback((key: string) => {
    setActiveTypeChips(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleAllTypes = useCallback(() => {
    if (allTypesActive) setActiveTypeChips(new Set(['PROCESS']));
    else setActiveTypeChips(new Set(distinctTypes));
  }, [allTypesActive, distinctTypes]);

  const [priorityFilter, setPriorityFilter] = useState('all');

  const typeFiltered = useMemo(() => {
    if (activeTypeChips.size === 0) return [];
    let filtered = enriched.filter(tk => activeTypeChips.has(tk._type));
    if (priorityFilter === 'rush') filtered = filtered.filter(tk => tk._priority <= 10);
    else if (priorityFilter === 'override') filtered = filtered.filter(tk => priorityOverrides?.[tk.key] !== undefined);
    else if (priorityFilter === 'high') filtered = filtered.filter(tk => tk._priority >= 1 && tk._priority <= 30);
    else if (priorityFilter === 'medium') filtered = filtered.filter(tk => tk._priority >= 31 && tk._priority <= 70);
    else if (priorityFilter === 'low') filtered = filtered.filter(tk => tk._priority >= 71);
    return filtered;
  }, [enriched, activeTypeChips, priorityFilter, priorityOverrides]);

  // Use extended deriver that supports 'rush' as a pseudo-status
  const statusDeriver = useCallback((row: any) => deriveTaskStatusExtended(row), []);

  // Resource hierarchy + attribute filter state
  const [hierarchyResources, setHierarchyResources] = useState<Set<string>>(new Set());
  const [attrFilters, setAttrFilters] = useState<{ name: string; value: string }[]>([]);
  const [showHierarchy, setShowHierarchy] = useState(false);

  // Build resource attribute lookup: resourceKey → attributes
  const resAttrMap = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of (resourceUtilization || [])) {
      m.set(r.resourceKey, r.attributes || []);
    }
    return m;
  }, [resourceUtilization]);

  // Apply hierarchy + attribute filters
  const hierarchyFiltered = useMemo(() => {
    let filtered = typeFiltered;
    if (hierarchyResources.size > 0) {
      filtered = filtered.filter(tk => {
        // Scheduled tasks: filter by actual assigned resources
        if (tk.feasible && tk.assignedResources?.length) {
          return tk.assignedResources.some((ar: any) => hierarchyResources.has(ar.resourceKey));
        }
        // Unscheduled tasks: filter by preference/compatible resources
        return tk.compatibleResources?.some((cr: any) => hierarchyResources.has(cr.resourceKey)) ?? false;
      });
    }
    if (attrFilters.length > 0) {
      filtered = filtered.filter(tk => {
        const taskResKeys: string[] = [];
        if (tk.assignedResources?.length) taskResKeys.push(...tk.assignedResources.map((ar: any) => ar.resourceKey));
        if (tk.compatibleResources?.length) taskResKeys.push(...tk.compatibleResources.map((cr: any) => cr.resourceKey));
        return taskResKeys.some(rk => {
          const attrs = resAttrMap.get(rk) || [];
          return attrFilters.every(sel => {
            return attrs.some((a: any) => {
              const vals = Array.isArray(a.value) ? a.value : [a.value];
              return a.name === sel.name && vals.some((v: any) => String(v).toLowerCase().includes(sel.value.toLowerCase()));
            });
          });
        });
      });
    }
    return filtered;
  }, [typeFiltered, hierarchyResources, attrFilters, resAttrMap]);

  const filter = useFilter(hierarchyFiltered, { statusDeriver });

  // Time filter reference points (relative to schedule data, not browser clock)
  const scheduledForTz = useMemo(() => tasks.filter((tk: any) => tk.scheduledStart), [tasks]);
  const { offsetMs: tzOff } = scheduledForTz.length > 0 ? detectGanttTz(scheduledForTz) : { offsetMs: 0 };
  const schedStart = useMemo(() => {
    if (scheduledForTz.length === 0) return Date.now();
    return Math.min(...scheduledForTz.map((tk: any) => new Date(tk.scheduledStart).getTime()));
  }, [scheduledForTz]);
  const snapMidnightMs = (ms: number) => {
    const inTz = new Date(ms + tzOff); inTz.setUTCHours(0, 0, 0, 0); return inTz.getTime() - tzOff;
  };
  const fmtPreset = (iso: string) => new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const presetBtnStyle: CSSProperties = {
    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
    fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.textMuted,
  };


  // Sync resourceFilter chip ↔ _resource column dropdown (ref prevents loop)
  // Only sync to column filter if the resource is a primary resource (appears in _resource column)
  const colFilterChangedRef = useRef(false);
  useEffect(() => {
    if (colFilterChangedRef.current) { colFilterChangedRef.current = false; return; }
    if (resourceFilter) {
      const isPrimaryResource = rows.some((t: any) => t._resource === resourceFilter);
      filter.setColumnFilter('_resource', isPrimaryResource ? new Set([resourceFilter]) : new Set());
    } else {
      filter.setColumnFilter('_resource', new Set());
    }
  }, [resourceFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const colFilter = (key: string) => {
    const base = {
      column: key,
      values: filter.distinctValues(key),
      selected: filter.columnFilters[key] || new Set<string>(),
    };
    if (key === '_resource') {
      return {
        ...base,
        onChange: (col: string, sel: Set<string>) => {
          colFilterChangedRef.current = true;
          filter.setColumnFilter(col, sel);
          onResourceFilterChange?.(sel.size === 1 ? [...sel][0] : null);
        },
      };
    }
    return { ...base, onChange: filter.setColumnFilter };
  };

  const completedCount = typeFiltered.filter(tk => tk._status === 'completed').length;
  const runningCount = typeFiltered.filter(tk => tk._status === 'running').length;
  const onHoldCount = typeFiltered.filter(tk => tk._status === 'on_hold').length;
  const dispatchedCount = typeFiltered.filter(tk => tk._status === 'dispatched').length;
  const plannedCount = typeFiltered.filter(tk => tk._status === 'planned' || tk._status === 'scheduled').length;
  const unscheduledCount = typeFiltered.filter(tk => tk._status === 'unscheduled').length;
  const pinnedCount = typeFiltered.filter(tk => tk._status === 'pinned').length;
  const infeasibleCount = typeFiltered.filter(tk => tk._status === 'infeasible').length;
  const excludedCount = typeFiltered.filter(tk => tk._status === 'excluded').length;
  const rushCount = typeFiltered.filter(tk => (tk.priority ?? 100) <= 10).length;

  const statusOptions = [
    { value: 'all', label: 'All', count: typeFiltered.length },
    { value: 'completed', label: '✔ Done', color: '#06b6d4', count: completedCount },
    { value: 'running', label: '● Running', color: '#ef4444', count: runningCount },
    { value: 'on_hold', label: '⚠ On Hold', color: '#f59e0b', count: onHoldCount },
    { value: 'dispatched', label: '◆ Dispatched', color: '#f97316', count: dispatchedCount },
    { value: 'pinned', label: '📌 Pinned', color: '#3b82f6', count: pinnedCount },
    { value: 'planned', label: '✓ Planned', color: '#22c55e', count: plannedCount },
    { value: 'unscheduled', label: '○ Unsched', color: '#9ca3af', count: unscheduledCount },
    { value: 'infeasible', label: '✕ Infeasible', color: '#ef4444', count: infeasibleCount },
    { value: 'excluded', label: '— Excluded', color: '#475569', count: excludedCount },
    { value: 'rush', label: '🔥 Rush', color: '#f97316', count: rushCount },
  ].filter(opt => opt.value === 'all' || opt.count > 0);

  const hasActions = !!(onPinTask || onExcludeTask || onUnscheduleTask);
  const safePins = taskPins || {};
  const safeExcludes = taskExcludes || {};
  const safeOrderModes = orderModes || {};

  const handlePin = useCallback((key: string) => {
    const pinned = !safePins[key];
    if (onApiPin) { onApiPin(key, pinned); }
    else { onPinTask?.(key, pinned); }
  }, [safePins, onApiPin, onPinTask]);

  const handleExclude = useCallback((key: string) => {
    const excluded = !safeExcludes[key];
    onExcludeTask?.(key, excluded);
  }, [safeExcludes, onExcludeTask]);

  const handleUnschedule = useCallback((key: string) => {
    if (onApiUnschedule) { onApiUnschedule(key); }
    else { onUnscheduleTask?.(key); }
  }, [onApiUnschedule, onUnscheduleTask]);

  const handlePinAll = useCallback((keys: string[]) => {
    if (onApiBulkPin) { onApiBulkPin(keys, true); }
    else { keys.forEach(k => onPinTask?.(k, true)); }
  }, [onApiBulkPin, onPinTask]);

  const handleUnpinAll = useCallback((keys: string[]) => {
    if (onApiBulkPin) { onApiBulkPin(keys, false); }
    else { keys.forEach(k => onPinTask?.(k, false)); }
  }, [onApiBulkPin, onPinTask]);

  const handleExcludeAll = useCallback((keys: string[]) => {
    keys.forEach(k => onExcludeTask?.(k, true));
  }, [onExcludeTask]);

  const handleIncludeAll = useCallback((keys: string[]) => {
    keys.forEach(k => onExcludeTask?.(k, false));
  }, [onExcludeTask]);

  const handleUnscheduleAll = useCallback((keys: string[]) => {
    if (onApiBulkUnschedule) { onApiBulkUnschedule(keys); }
    else {
      if (keys.length > 5) {
        if (!window.confirm(`Unschedule ${keys.length} tasks? This will remove their current assignments.`)) return;
      }
      keys.forEach(k => onUnscheduleTask?.(k));
    }
  }, [onApiBulkUnschedule, onUnscheduleTask]);

  const handleSolveAll = useCallback((keys: string[]) => {
    onScheduleSelected?.(keys);
  }, [onScheduleSelected]);

  const handleRushAll = useCallback((keys: string[]) => {
    onRushSelected?.(keys);
  }, [onRushSelected]);

  const handleResourcePrefAll = useCallback((keys: string[]) => {
    onSetSelectedTasks?.(new Set(keys));
    onSetResourcePreference?.();
  }, [onSetSelectedTasks, onSetResourcePreference]);

  const handleExtendWindowAll = useCallback((keys: string[]) => {
    onToolbarAction?.('extend_window', keys);
  }, [onToolbarAction]);

  let preRows = filter.filtered;
  if (resourceFilter) {
    preRows = preRows.filter((t: any) =>
      t.assignedResources?.some((r: any) => r.resourceKey === resourceFilter || r.requestedResource === resourceFilter)
    );
  }
  if (timeFilter?.after) {
    const afterMs = new Date(timeFilter.after).getTime();
    preRows = preRows.filter((t: any) => !t.scheduledEnd || new Date(t.scheduledEnd).getTime() > afterMs);
  }
  if (timeFilter?.before) {
    const beforeMs = new Date(timeFilter.before).getTime();
    preRows = preRows.filter((t: any) => !t.scheduledStart || new Date(t.scheduledStart).getTime() < beforeMs);
  }
  const rows = sorted(preRows);
  // Derive case name for the filter chip
  const caseFilterName = caseFilter ? (caseTasks[0]?.orderName || caseFilter) : null;
  return (
    <div>
      {caseFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: FONT,
            background: C.accent + '18', color: C.accent, border: `1px solid ${C.accent}44`,
          }}>
            Filtered: {caseFilterName}
            <span onClick={onClearCaseFilter} style={{ cursor: 'pointer', opacity: 0.7, fontSize: 14 }} title="Clear filter">&times;</span>
          </span>
        </div>
      )}
      {/* ═══ UNIFIED FILTER BAR ═══ */}
      <div style={{ marginBottom: 8 }}>
        <SearchBox value={filter.search} onChange={filter.setSearch} placeholder="Search tasks..." />
      </div>

      {/* Row 1: STATUS */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, minWidth: 44, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
        <StatusToggles options={statusOptions} active={filter.status} onChange={filter.setStatus} />
        {distinctTypes.length > 1 && (
          <>
            <div style={{ width: 1, height: 16, background: C.border }} />
            <button onClick={toggleAllTypes} style={{
              padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, fontFamily: FONT,
              background: allTypesActive ? C.accent + '22' : 'transparent',
              color: allTypesActive ? C.accent : C.textMuted,
              border: allTypesActive ? `1px solid ${C.accent}44` : '1px solid transparent',
            }}>All Types</button>
            {distinctTypes.map(typ => {
              const isActive = activeTypeChips.has(typ);
              const count = enriched.filter(tk => tk._type === typ).length;
              const label = typ.charAt(0) + typ.slice(1).toLowerCase().replace(/_/g, ' ');
              return (
                <button key={typ} onClick={() => toggleTypeChip(typ)} style={{
                  padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, fontFamily: FONT,
                  background: isActive ? C.accent + '22' : 'transparent',
                  color: isActive ? C.accent : C.textMuted,
                  border: isActive ? `1px solid ${C.accent}44` : '1px solid transparent',
                }}>
                  {label}<span style={{ marginLeft: 4, opacity: 0.6 }}>({count})</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Row 2: WHEN */}
      {onTimeFilterChange && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, minWidth: 44, textTransform: 'uppercase', letterSpacing: '0.05em' }}>When</span>
          <button style={presetBtnStyle} onClick={() => onTimeFilterChange({ after: new Date(snapMidnightMs(schedStart)).toISOString() })}>Schedule Start</button>
          <button style={presetBtnStyle} onClick={() => onTimeFilterChange({ after: new Date(schedStart).toISOString() })}>Now {'\u2192'}</button>
          <button style={presetBtnStyle} onClick={() => onTimeFilterChange({ after: new Date(schedStart).toISOString(), before: new Date(schedStart + 4 * 3600_000).toISOString() })}>Next 4h</button>
          <button style={presetBtnStyle} onClick={() => { const d = snapMidnightMs(schedStart); onTimeFilterChange({ after: new Date(d).toISOString(), before: new Date(d + 86_400_000).toISOString() }); }}>Today</button>
          <button style={presetBtnStyle} onClick={() => { const d = snapMidnightMs(schedStart) + 86_400_000; onTimeFilterChange({ after: new Date(d).toISOString(), before: new Date(d + 86_400_000).toISOString() }); }}>Tomorrow</button>
          {timeFilter?.after && <FilterChip label={`After: ${fmtPreset(timeFilter.after)}`} onClear={() => onTimeFilterChange({ ...timeFilter, after: undefined })} />}
          {timeFilter?.before && <FilterChip label={`Before: ${fmtPreset(timeFilter.before)}`} onClear={() => onTimeFilterChange({ ...timeFilter, before: undefined })} />}
        </div>
      )}

      {/* Row 3: WORK */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, minWidth: 44, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Work</span>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{
          padding: '4px 8px', borderRadius: 6, fontSize: 11, fontFamily: FONT,
          border: `1px solid ${priorityFilter !== 'all' ? C.purple : C.border}`,
          background: priorityFilter !== 'all' ? C.purple + '12' : C.surface2,
          color: priorityFilter !== 'all' ? C.purple : C.text, cursor: 'pointer',
        }}>
          <option value="all">All Priorities</option>
          <option value="rush">{'\uD83D\uDD25'} Rush (1-10)</option>
          <option value="high">{'\u2B06'} High (11-25)</option>
          <option value="medium">Normal (26-75)</option>
          <option value="low">{'\u2B07'} Low (76-100)</option>
          <option value="override">Has Override</option>
        </select>
        {resourceFilterName && onResourceFilterChange && (
          <FilterChip label={`Resource: ${resourceFilterName}`} onClear={() => onResourceFilterChange(null)} />
        )}
      </div>

      {/* Row 4: WHERE */}
      {resourceUtilization && resourceUtilization.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textDim, minWidth: 44, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Where</span>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowHierarchy(!showHierarchy)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              background: hierarchyResources.size > 0 ? C.accent + '22' : showHierarchy ? C.surface2 : 'transparent',
              color: hierarchyResources.size > 0 ? C.accent : C.textMuted,
              border: hierarchyResources.size > 0 ? `1px solid ${C.accent}44` : `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {showHierarchy ? '\u25BE' : '\u25B8'} Resources
              {hierarchyResources.size > 0 && <span style={{ fontSize: 10, opacity: 0.7 }}>({hierarchyResources.size})</span>}
            </button>
            {showHierarchy && (
              <>
                <div onClick={() => setShowHierarchy(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 100, width: 320,
                  padding: '10px 12px', background: C.surface, borderRadius: 10,
                  border: `1px solid ${C.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  maxHeight: 400, overflowY: 'auto',
                }}>
                  <ResourceHierarchyBrowser resources={resourceUtilization} selectedResources={hierarchyResources} onSelectionChange={setHierarchyResources} />
                </div>
              </>
            )}
          </div>
          <div style={{ flex: 1, maxWidth: 260 }}>
            <AttributeSearch resources={resourceUtilization} selectedAttributes={attrFilters} onAttributesChange={setAttrFilters} />
          </div>
        </div>
      )}

      <ActiveFilters filter={filter} />

      {/* Active filter summary */}
      {(hierarchyResources.size > 0 || attrFilters.length > 0 || filter.status !== 'all' || timeFilter?.after || timeFilter?.before || priorityFilter !== 'all' || resourceFilterName) && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center', padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 10, color: C.textDim }}>Active:</span>
          {hierarchyResources.size > 0 && (
            <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: C.accent + '22', color: C.accent, border: `1px solid ${C.accent}33`, display: 'flex', alignItems: 'center', gap: 3 }}>
              {hierarchyResources.size} resource{hierarchyResources.size !== 1 ? 's' : ''}
              <span onClick={() => setHierarchyResources(new Set())} style={{ cursor: 'pointer', opacity: 0.7 }}>{'\u2715'}</span>
            </span>
          )}
          {attrFilters.map((attr, i) => (
            <span key={i} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: C.purple + '22', color: C.purple, border: `1px solid ${C.purple}33`, display: 'flex', alignItems: 'center', gap: 3 }}>
              {attr.value}
              <span onClick={() => setAttrFilters(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', opacity: 0.7 }}>{'\u2715'}</span>
            </span>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim }}>{rows.length} of {hierarchyFiltered.length} tasks</span>
          <button onClick={() => { setHierarchyResources(new Set()); setAttrFilters([]); filter.setStatus('all'); onTimeFilterChange?.({}); setPriorityFilter('all'); onResourceFilterChange?.(null); }} style={{
            fontSize: 10, color: C.textMuted, background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
          }}>Clear all</button>
        </div>
      )}
      {selectedTasks && selectedTasks.size > 0 ? (() => {
        const selArr = Array.from(selectedTasks);
        const selObjs = selArr.map(k => enriched.find((tt: any) => tt.key === k)).filter(Boolean);
        const toolbarActions = getToolbarActions(selObjs);
        const btnStyle: CSSProperties = {
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.text,
        };

        const handleAction = (action: string, e: React.MouseEvent) => {
          // Filter to only tasks where this action is valid
          const eligible = selObjs.filter(t => canTransition(t, action).allowed);
          const keys = eligible.map(t => t.key);
          if (keys.length === 0) return;
          switch (action) {
            case 'schedule':
              onScheduleSelected?.(keys, e); break;
            case 'unschedule':
              onUnscheduleSelected?.(keys, e); break;
            case 'pin':
              onPinSelected?.(keys, e); break;
            case 'unpin':
              onUnpinSelected?.(keys, e); break;
            case 'exclude':
              onExcludeSelected?.(keys); break;
            case 'include':
              onIncludeSelected?.(keys); break;
            case 'whereto':
              onWhereTo?.(keys[0], 'table'); break;
            case 'resourcePref':
              onSetResourcePreference?.(); break;
            case 'rush':
              onRushSelected?.(keys, e); break;
            default:
              onToolbarAction?.(action, keys, e); break;
          }
        };

        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            background: `${C.accent}0a`, borderRadius: 8, marginBottom: 8,
            border: `1px solid ${C.accent}33`, fontFamily: FONT,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>
              {selectedTasks.size} selected
            </span>
            <div style={{ width: 1, height: 16, background: C.border }} />

            {toolbarActions.map(action => (
              <button
                key={action.key}
                onClick={(e) => handleAction(action.key, e)}
                style={{
                  ...btnStyle,
                  outline: isQueuing ? `2px dashed ${C.accent}` : 'none',
                }}
                title={action.label}
              >
                {action.icon} {action.label}{action.count != null && action.count < selectedTasks.size ? ` ${action.count}` : ''}
                {isQueuing && <span style={{ fontSize: 9, marginLeft: 3, color: C.accent }}>+Q</span>}
              </button>
            ))}

            <div style={{ flex: 1 }} />
            <button onClick={() => onSetSelectedTasks?.(new Set())}
              style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}>
              Clear
            </button>
          </div>
        );
      })() : hasActions && (
        <TaskBulkActions filteredTasks={filter.filtered}
          taskPins={safePins} taskExcludes={safeExcludes} orderModes={safeOrderModes}
          onPinAll={handlePinAll} onUnpinAll={handleUnpinAll}
          onExcludeAll={handleExcludeAll} onIncludeAll={handleIncludeAll}
          onUnscheduleAll={handleUnscheduleAll}
          onSolveAll={onScheduleSelected ? handleSolveAll : undefined}
          onRushAll={onRushSelected ? handleRushAll : undefined}
          onResourcePrefAll={onSetResourcePreference ? handleResourcePrefAll : undefined}
          onExtendWindowAll={onToolbarAction ? handleExtendWindowAll : undefined} />
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {selectedTasks && <th style={{ padding: '10px 8px', width: 36, textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
                <input type="checkbox"
                  checked={rows.length > 0 && rows.every((r: any) => selectedTasks.has(r.key))}
                  ref={el => {
                    if (el) el.indeterminate = rows.some((r: any) => selectedTasks.has(r.key))
                      && !rows.every((r: any) => selectedTasks.has(r.key));
                  }}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onSetSelectedTasks?.(new Set([...selectedTasks, ...rows.map((r: any) => r.key)]));
                    } else {
                      const rowKeys = new Set(rows.map((r: any) => r.key));
                      onSetSelectedTasks?.(new Set([...selectedTasks].filter(k => !rowKeys.has(k))));
                    }
                  }}
                  style={{ cursor: 'pointer', accentColor: C.accent }}
                />
              </th>}
              <SortHeader label={t('task', 'Task')} k="key" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('name')} />
              <SortHeader label={t('product', 'Product')} k="_productName" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_productName')} />
              <SortHeader label={t('order', 'Order')} k="orderRef" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('orderRef')} />
              <SortHeader label={t('resource', 'Resource')} k="_resource" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_resource')} />
              <SortHeader label="Start" k="scheduledStart" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="End" k="scheduledEnd" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('duration', 'Duration')} k="durationSeconds" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Priority" k="_priorityRank" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_priorityLabel')} />
              <SortHeader label={t('processCategory', 'Category')} k="_processCategory" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_processCategory')} />
              {showAt(experienceLevel, 'intermediate') && <SortHeader label={t('score', 'Score')} k="score" current={sortKey} dir={sortDir} onSort={toggle} />}
              {showAt(experienceLevel, 'intermediate') && <SortHeader label="Slack" k="_slackSort" current={sortKey} dir={sortDir} onSort={toggle} />}
              <SortHeader label="Status" k="_status" current={sortKey} dir={sortDir} onSort={toggle} />
              {hasActions && <th style={{
                padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 600,
                color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                fontFamily: FONT, width: 90,
              }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((tk: any) => {
              const resKey = tk._resource || '—';
              const prodColor = colors ? getTaskColor(tk, colors) : C.accent;
              return (
                <tr key={tk.key} style={{
                  transition: 'background 0.1s, opacity 0.2s',
                  cursor: onTaskClick ? 'pointer' : 'default',
                  opacity: tk._status === 'excluded' ? 0.4 : 1,
                  borderLeft: taskUnschedules?.has(tk.key) ? `3px solid ${C.red}` :
                              tk._status === 'pinned' ? `3px solid ${C.yellow}` :
                              tk._orderMode === 'LOCKED' ? `3px solid ${C.yellow}` :
                              '3px solid transparent',
                  ...(selectedTasks?.has(tk.key) && { background: `${C.accent}0a` }),
                }}
                  onClick={() => onTaskClick?.(tk)}
                  onMouseEnter={e => (e.currentTarget.style.background = selectedTasks?.has(tk.key) ? `${C.accent}14` : C.surface2)}
                  onMouseLeave={e => (e.currentTarget.style.background = selectedTasks?.has(tk.key) ? `${C.accent}0a` : 'transparent')}
                >
                  {selectedTasks && <td style={{ padding: '4px 8px', textAlign: 'center' as const }}
                    onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox"
                      checked={selectedTasks.has(tk.key)}
                      onChange={() => onToggleSelect?.(tk.key)}
                      style={{ cursor: 'pointer', accentColor: C.accent }}
                    />
                  </td>}
                  <td style={cellStyle}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{tk.name}</div>
                    <div style={{ fontSize: 11, color: C.textDim }}>{tk.key}</div>
                  </td>
                  <td style={cellStyle}>
                    {tk._productName ? (
                      <span style={{ color: prodColor, fontWeight: 500 }}>
                        {tk._productName}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={cellStyle}>{tk.orderRef ? (
                    <span onClick={(e) => { e.stopPropagation(); onNavigateToOrders?.(tk.orderRef); }}
                      style={{
                        color: onNavigateToOrders ? C.accent : C.text,
                        cursor: onNavigateToOrders ? 'pointer' : 'default',
                        textDecoration: onNavigateToOrders ? 'underline' : 'none',
                      }}
                      title={onNavigateToOrders ? `View ${tk.orderRef} in Orders` : undefined}
                    >{tk.orderRef}</span>
                  ) : '—'}</td>
                  <td style={cellStyle}>{resKey}</td>
                  <td style={cellStyle}>{fmtDate(tk.scheduledStart)}</td>
                  <td style={cellStyle}>{fmtDate(tk.scheduledEnd)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtDuration(tk.durationSeconds)}</td>
                  <td style={cellStyle}>
                    {(() => {
                      const clr = priorityLabelColor(tk._priorityLabel);
                      return <span style={{ fontSize: 11, color: clr, fontWeight: 600 }}>{tk._priorityLabel}</span>;
                    })()}
                  </td>
                  <td style={cellStyle}>{tk._processCategory || '—'}</td>
                  {showAt(experienceLevel, 'intermediate') && <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {tk.score != null ? tk.score.toFixed(2) : '—'}
                  </td>}
                  {showAt(experienceLevel, 'intermediate') && <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {!tk.feasible || tk.slack === undefined || tk.slack === null ? '—'
                      : tk.isOnCriticalPath ? <span style={{ color: '#f97316', fontWeight: 600, fontSize: 11 }}>{'\u26A1'} Critical</span>
                      : <span style={{ color: tk.slack < 1800 ? C.yellow : tk.slack < 7200 ? C.textMuted : C.green, fontSize: 11 }}>
                          {tk.slack < 60 ? `${Math.round(tk.slack)}s` : tk.slack < 3600 ? `${Math.floor(tk.slack / 60)}m` : `${Math.floor(tk.slack / 3600)}h ${Math.floor((tk.slack % 3600) / 60)}m`}
                        </span>
                    }
                  </td>}
                  <td style={cellStyle}>
                    {taskStatusBadge(tk)}
                    {taskUnschedules?.has(tk.key) && (
                      <span style={{ fontSize: 10, color: C.red, fontWeight: 600, marginLeft: 4 }}>{'\u2192'} UNSCHED</span>
                    )}
                    {taskPins?.[tk.key] && !taskUnschedules?.has(tk.key) && (
                      <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginLeft: 4 }}>{'\u2192'} PIN</span>
                    )}
                    {taskExcludes?.[tk.key] && !taskUnschedules?.has(tk.key) && (
                      <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600, marginLeft: 4 }}>{'\u2192'} EXCLUDE</span>
                    )}
                    {resourcePreferenceOverrides?.[tk.key] && Object.keys(resourcePreferenceOverrides[tk.key]).length > 0 && (
                      <span style={{ fontSize: 10, color: C.purple, fontWeight: 600, marginLeft: 4, padding: '1px 5px', borderRadius: 3, border: `1px solid ${C.purple}33` }}>{'\uD83D\uDD00'} REDIRECT</span>
                    )}
                    {(priorityOverrides?.[tk.key] ?? tk.priority) <= 10 && (
                      <span style={{ fontSize: 10, color: '#f44336', fontWeight: 600, marginLeft: 4, padding: '1px 5px', borderRadius: 3, border: '1px solid #f4433633' }}>{'\u26A1'} {priorityLabel(tk, priorityOverrides?.[tk.key])}</span>
                    )}
                  </td>
                  {hasActions && (
                    <td style={{ ...cellStyle, textAlign: 'center', padding: '4px 6px' }}>
                      <TaskRowActions task={tk}
                        taskPins={safePins} taskExcludes={safeExcludes} taskUnschedules={taskUnschedules}
                        orderModes={safeOrderModes}
                        onPin={handlePin} onExclude={handleExclude} onUnschedule={handleUnschedule}
                        onWhereTo={onWhereTo} whereToTaskKey={whereToTaskKey}
                        onApiSchedule={onApiSchedule} actionLoading={actionLoading} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULE PROGRESS
   ═══════════════════════════════════════════════════════════════ */

function ScheduleProgress({ placed, total, infeasible }: {
  placed: number; total: number; infeasible: number;
}) {
  if (total === 0) return <span style={{ color: C.textDim, fontSize: 12 }}>—</span>;
  const pct = (placed / total) * 100;
  const color = pct === 100 ? C.green : pct > 0 ? C.yellow : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 36 }}>
        {placed}/{total}
      </span>
      <div style={{
        flex: 1, height: 4, background: C.border, borderRadius: 2,
        overflow: 'hidden', maxWidth: 60,
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color, borderRadius: 2,
          transition: 'width 0.3s',
        }} />
      </div>
      {infeasible > 0 && (
        <span style={{ fontSize: 10, color: C.red }} title={`${infeasible} infeasible`}>
          ⚠{infeasible}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDER TABLE
   ═══════════════════════════════════════════════════════════════ */

function OrderTable({ orders, products, tasks, orderModes, taskPins, taskExcludes, onOrderModeChange }: {
  orders: any[]; products: any[]; tasks?: any[];
  orderModes?: Record<string, string>;
  taskPins?: Record<string, boolean>;
  taskExcludes?: Record<string, boolean>;
  onOrderModeChange?: (key: string, mode: string) => void;
}) {
  const { sortKey, sortDir, toggle, sorted } = useSort('priority');

  const enriched = useMemo(() => orders.map(o => {
    const orderTasks = (tasks || []).filter((tk: any) => tk.orderRef === o.orderKey);
    const total = orderTasks.length;
    const scheduled = orderTasks.filter((tk: any) => tk.feasible && tk.scheduledStart).length;
    const pinned = orderTasks.filter((tk: any) => taskPins?.[tk.key]).length;
    const excluded = orderTasks.filter((tk: any) => taskExcludes?.[tk.key]).length;
    const infeasible = orderTasks.filter((tk: any) => !tk.feasible && tk.errors?.length > 0).length;
    const placed = scheduled + pinned;
    const prodName = products.find((p: any) => p.key === o.productKey)?.name || o.productKey;

    const starts = orderTasks.filter((tk: any) => tk.feasible && tk.scheduledStart).map((tk: any) => tk.scheduledStart);
    const ends = orderTasks.filter((tk: any) => tk.feasible && tk.scheduledEnd).map((tk: any) => tk.scheduledEnd);

    const firstTask = orderTasks[0];
    const _priorityLabel = priorityLabel(firstTask, undefined);
    const _priorityColor = priorityLabelColor(_priorityLabel);

    return {
      ...o,
      _status: deriveOrderStatus(o, tasks),
      _productName: prodName,
      _totalTasks: total,
      _scheduledTasks: placed,
      _infeasibleTasks: infeasible,
      _excludedTasks: excluded,
      _scheduleProgress: total > 0 ? placed / total : 0,
      _scheduledStart: starts.length ? starts.sort()[0] : null,
      _scheduledEnd: ends.length ? ends.sort().pop() : null,
      _priorityLabel,
      _priorityColor,
    };
  }), [orders, tasks, taskPins, taskExcludes, products]);

  const statusDeriver = useCallback((row: any) => row._status, []);
  const filter = useFilter(enriched, { statusDeriver });

  const onTrackCount = enriched.filter(o => o._status === 'on-track').length;
  const atRiskCount = enriched.filter(o => o._status === 'at-risk').length;
  const lateCount = enriched.filter(o => o._status === 'late').length;
  const statusOptions = [
    { value: 'all', label: 'All', count: enriched.length },
    { value: 'on-track', label: t('onTrack', 'On Track'), color: C.green, count: onTrackCount },
    { value: 'at-risk', label: t('atRisk', 'At Risk'), color: C.yellow, count: atRiskCount },
    { value: 'late', label: t('late', 'Late'), color: C.red, count: lateCount },
  ];

  const colFilter = (key: string) => ({
    column: key,
    values: filter.distinctValues(key),
    selected: filter.columnFilters[key] || new Set<string>(),
    onChange: filter.setColumnFilter,
  });

  const rows = sorted(filter.filtered);
  return (
    <div>
      <FilterBar filter={filter} statusOptions={statusOptions} />
      <ActiveFilters filter={filter} />
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {onOrderModeChange && <th style={{
                padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                fontFamily: FONT, width: 80,
              }}>Mode</th>}
              <SortHeader label={t('order', 'Order')} k="orderKey" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('orderKey')} />
              <SortHeader label={t('product', 'Product')} k="_productName" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_productName')} />
              <SortHeader label={t('demand', 'Demand')} k="demandQty" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('scheduledStatus', 'Scheduled')} k="scheduledQty" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Progress" k="_scheduleProgress" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Start" k="_scheduledStart" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="End" k="_scheduledEnd" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('dueDate', 'Due Date')} k="dueDate" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('priority', 'Priority')} k="priority" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('fillRate', 'Fill Rate')} k="fillRate" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Status" k="_status" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_status')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((o: any) => {
              const status = o._status;
              const prodColor = C.accent;
              return (
                <tr key={o.orderKey}
                  onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {onOrderModeChange && (
                    <td style={cellStyle}>
                      <ClickableModeBadge
                        mode={orderModes?.[o.orderKey] || 'INCLUDE'}
                        modes={ORDER_MODES}
                        onChange={(m) => onOrderModeChange(o.orderKey, m)}
                      />
                    </td>
                  )}
                  <td style={{ ...cellStyle, fontWeight: 600 }}>{o.orderKey}</td>
                  <td style={cellStyle}>
                    <span style={{ color: prodColor, fontWeight: 500 }}>
                      {o._productName}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(o.demandQty)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(o.scheduledQty)}</td>
                  <td style={cellStyle}>
                    <ScheduleProgress placed={o._scheduledTasks} total={o._totalTasks} infeasible={o._infeasibleTasks} />
                  </td>
                  <td style={cellStyle}>{fmtDate(o._scheduledStart)}</td>
                  <td style={cellStyle}>{fmtDate(o._scheduledEnd)}</td>
                  <td style={cellStyle}>{fmtDateShort(o.dueDate)}</td>
                  <td style={cellStyle}>
                    <Badge
                      label={o._priorityLabel}
                      color={o._priorityColor}
                    />
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Ring pct={o.fillRate} size={28} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{
                        (o.fillRate ?? 0) > 1 ? fmtPctDirect(o.fillRate) : fmtPctFromDecimal(o.fillRate)
                      }</span>
                    </div>
                  </td>
                  <td style={cellStyle}><Badge label={status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HOVER TOOLTIP
   ═══════════════════════════════════════════════════════════════ */

function HoverTooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  if (!content) return <>{children}</>;

  return (
    <span
      style={{ position: 'relative', cursor: 'help' }}
      onMouseEnter={e => { setShow(true); setPos({ x: e.clientX, y: e.clientY }); }}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: 'fixed', left: pos.x + 12, top: pos.y - 10,
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: C.text, zIndex: 999,
          pointerEvents: 'none', fontFamily: FONT, minWidth: 180,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {content}
        </div>
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MATERIALS TABLE
   ═══════════════════════════════════════════════════════════════ */

function MatTable({ materials, materialModes, onMaterialModeChange }: {
  materials: any[];
  materialModes?: Record<string, string>;
  onMaterialModeChange?: (key: string, mode: string) => void;
}) {
  const { sortKey, sortDir, toggle, sorted } = useSort('materialKey');

  const enriched = useMemo(() => materials.map(m => ({
    ...m,
    _status: deriveMaterialStatus(m),
    _net: (m.remaining ?? 0) + (m.incoming ?? 0),
  })), [materials]);

  const statusDeriver = useCallback((row: any) => row._status, []);
  const filter = useFilter(enriched, { statusDeriver });

  const coveredCount = enriched.filter(m => m._status === 'covered').length;
  const atRiskCount = enriched.filter(m => m._status === 'at-risk').length;
  const shortageCount = enriched.filter(m => m._status === 'shortage').length;
  const statusOptions = [
    { value: 'all', label: 'All', count: enriched.length },
    { value: 'covered', label: t('available', 'Covered'), color: C.green, count: coveredCount },
    { value: 'at-risk', label: t('atRisk', 'At Risk'), color: C.yellow, count: atRiskCount },
    { value: 'shortage', label: t('shortage', 'Shortage'), color: C.red, count: shortageCount },
  ];

  const colFilter = (key: string) => ({
    column: key,
    values: filter.distinctValues(key),
    selected: filter.columnFilters[key] || new Set<string>(),
    onChange: filter.setColumnFilter,
  });

  const rows = sorted(filter.filtered);
  return (
    <div>
      <FilterBar filter={filter} statusOptions={statusOptions} />
      <ActiveFilters filter={filter} />
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {onMaterialModeChange && <th style={{
                padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                fontFamily: FONT, width: 110,
              }}>Mode</th>}
              <SortHeader label={t('material', 'Material')} k="materialKey" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Unit" k="unit" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('unit')} />
              <SortHeader label="On Hand" k="onHand" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Consumed" k="consumed" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Remaining" k="remaining" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Incoming" k="incoming" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Net Position" k="_net" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Status" k="_status" current={sortKey} dir={sortDir} onSort={toggle} />
            </tr>
          </thead>
        <tbody>
          {rows.map((m: any) => {
            const status = m._status;
            const net = m._net;

            // Build shortage tooltip content
            const shortageTooltip = m.firstShortageDate ? (
              <div>
                <div style={{ fontWeight: 700, color: C.red, marginBottom: 4 }}>{t('shortage', 'Shortage')} Detail</div>
                <div style={{ color: C.textMuted, marginBottom: 2 }}>
                  <strong>First {t('shortage', 'shortage')}:</strong> {fmtDate(m.firstShortageDate)}
                </div>
                <div style={{ color: C.textMuted, marginBottom: 2 }}>
                  <strong>Deficit:</strong> {fmtNum(m.shortageQty)} {m.unit}
                </div>
                {m.firstNeedTaskName && (
                  <div style={{ color: C.textMuted }}>
                    <strong>Triggered by:</strong> {m.firstNeedTaskName} ({m.firstNeedTaskKey})
                  </div>
                )}
              </div>
            ) : null;

            // Build incoming tooltip content
            const incomingTooltip = (m.incoming ?? 0) > 0 ? (
              <div>
                <div style={{ fontWeight: 700, color: C.accent, marginBottom: 4 }}>Incoming Stock</div>
                <div style={{ color: C.textMuted, marginBottom: 2 }}>
                  <strong>{t('quantity', 'Qty')}:</strong> {fmtNum(m.incoming)} {m.unit}
                </div>
                {m.incomingDate && (
                  <div style={{ color: C.textMuted }}>
                    <strong>Arrival:</strong> {fmtDate(m.incomingDate)}
                  </div>
                )}
              </div>
            ) : null;

            return (
              <tr key={m.materialKey}
                onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {onMaterialModeChange && <td style={cellStyle}>
                  <ModeToggle
                    mode={(materialModes?.[m.materialKey] || m.mode || 'TRACK').toUpperCase()}
                    modes={MATERIAL_MODES}
                    onChange={(mode) => onMaterialModeChange(m.materialKey, mode)}
                  />
                </td>}
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600 }}>{m.materialKey}</div>
                  <div style={{ fontSize: 11, color: C.textDim }}>{m.materialName}</div>
                </td>
                <td style={cellStyle}>{m.unit}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(m.onHand)}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(m.consumed)}</td>
                <td style={{ ...cellStyle, textAlign: 'right', color: (m.remaining ?? 0) < 0 ? C.red : C.text }}>
                  <HoverTooltip content={shortageTooltip}>
                    <span style={{ borderBottom: shortageTooltip ? `1px dashed ${C.red}` : 'none' }}>
                      {fmtNum(m.remaining)}
                    </span>
                  </HoverTooltip>
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  <HoverTooltip content={incomingTooltip}>
                    <span style={{ borderBottom: incomingTooltip ? `1px dashed ${C.textDim}` : 'none' }}>
                      {fmtNum(m.incoming)}
                    </span>
                  </HoverTooltip>
                </td>
                <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: net < 0 ? C.red : C.green }}>
                  {net >= 0 ? '+' : ''}{fmtNum(net)}
                </td>
                <td style={cellStyle}>
                  <HoverTooltip content={shortageTooltip}>
                    <span style={{ display: 'inline-block', borderBottom: shortageTooltip ? `1px dashed ${C.red}` : 'none' }}>
                      <Badge label={status} />
                    </span>
                  </HoverTooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONFLICT CARDS
   ═══════════════════════════════════════════════════════════════ */

function ConflictCards({ conflicts, onTaskClick }: { conflicts: any[]; onTaskClick?: (taskKey: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (conflicts.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontFamily: FONT }}>
        No {t('conflicts', 'conflicts')} detected
      </div>
    );
  }

  // Group by conflict type
  const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
    availability: { icon: '\u26AB', color: '#9e9e9e', label: 'Availability Conflicts' },
    capacity:     { icon: '\uD83D\uDD34', color: '#f44336', label: 'Capacity Conflicts' },
    dependency:   { icon: '\uD83D\uDD17', color: '#ff9800', label: 'Dependency Conflicts' },
    material:     { icon: '\uD83D\uDCE6', color: '#2196f3', label: 'Material Conflicts' },
  };
  const typeOrder = ['availability', 'capacity', 'dependency', 'material'];
  const grouped = new Map<string, any[]>();
  for (const type of typeOrder) grouped.set(type, []);
  conflicts.forEach((c: any) => {
    const type = typeOrder.includes(c.reason) ? c.reason : 'capacity';
    grouped.get(type)!.push(c);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {typeOrder.map(type => {
        const items = grouped.get(type) || [];
        if (items.length === 0) return null;
        const cfg = typeConfig[type];
        return (
          <div key={type}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingLeft: 4 }}>
              <span>{cfg.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>
                {cfg.label} ({items.length})
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((c: any) => {
        const isOpen = expanded.has(c.id);
        return (
          <div key={c.id} style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: '14px 18px', fontFamily: FONT, cursor: 'pointer',
            borderLeft: `3px solid ${c.severity === 'critical' ? C.red : C.yellow}`,
          }} onClick={() => toggleExpand(c.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Badge label={c.severity} />
                <Badge label={c.reason} color={
                  c.reason === 'availability' ? '#9e9e9e' :
                  c.reason === 'capacity' ? '#f44336' :
                  c.reason === 'dependency' ? '#ff9800' :
                  c.reason === 'material' ? '#2196f3' : C.orange
                } />
                <span style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{c.taskName}</span>
                {c.orderRef && <span style={{ color: C.textDim, fontSize: 12 }}>({c.orderRef})</span>}
              </div>
              <span style={{ color: C.textDim, fontSize: 12 }}>{isOpen ? '▼' : '▶'}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
                <div style={{ color: C.textMuted, marginBottom: 4 }}>
                  <strong>Detail:</strong> {c.reasonDetail}
                </div>
                {c.infeasibilityReport && (
                  <ResourceBottleneckPanel report={c.infeasibilityReport} />
                )}
                {!c.infeasibilityReport && c.bottleneckResource && (
                  <div style={{ color: C.textMuted }}>
                    <strong>Resource:</strong> {c.bottleneckResource} ({c.bottleneckUtilization.toFixed(0)}% utilization)
                  </div>
                )}
                {c.materialKey && (
                  <div style={{ color: C.textMuted }}>
                    <strong>Material:</strong> {c.materialName} ({c.materialKey})
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: C.textDim }}>
                    <strong>Task Key:</strong> {c.taskKey}
                  </span>
                  {onTaskClick && (
                    <button
                      onClick={e => { e.stopPropagation(); onTaskClick(c.taskKey); }}
                      style={{
                        background: C.accent, color: '#fff', border: 'none', borderRadius: 6,
                        padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                      }}
                    >
                      {act('viewDetails', 'View Details')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — OVERVIEW
   ═══════════════════════════════════════════════════════════════ */

function OverviewTab({ summary, tasks, resources, orders, materials, products, colors, onTabChange, onTaskClick, onResourceClick, experienceLevel = 'novice',
  taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask, onWhereTo,
  zoomLevel, setZoomLevel, scrollOffset, setScrollOffset, onViewAgenda, criticalPath }: {
  summary: any; tasks: any[]; resources: any[]; orders: any[]; materials: any[];
  products: any[]; colors: any; onTabChange: (t: string) => void;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
  onViewAgenda?: (r: any) => void;
  experienceLevel?: ExperienceLevel;
  taskPins?: Record<string, boolean>; taskExcludes?: Record<string, boolean>; taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onPinTask?: (key: string, pinned: boolean) => void;
  onExcludeTask?: (key: string, excluded: boolean) => void;
  onUnscheduleTask?: (key: string) => void;
  onWhereTo?: (key: string) => void;
  zoomLevel?: string;
  setZoomLevel?: (v: string | ((prev: string) => string)) => void;
  scrollOffset?: number;
  setScrollOffset?: (v: number | ((prev: number) => number)) => void;
  criticalPath?: any;
}) {
  const avgUtil = resources.length > 0
    ? resources.reduce((s: number, r: any) => s + r.utilization, 0) / resources.length
    : 0;
  const lateOrders = orders.filter((o: any) => deriveOrderStatus(o, tasks) === 'late').length;
  const conflicts = deriveConflicts(tasks, resources, materials);
  const shortages = materials.filter((m: any) => deriveMaterialStatus(m) === 'shortage').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI icon="✓" label={t('feasibility', 'Feasibility')} value={fmtPctDirect(summary?.feasibilityRate)} color={
          (summary?.feasibilityRate ?? 0) >= 90 ? C.green : (summary?.feasibilityRate ?? 0) >= 70 ? C.yellow : C.red
        } sub={`${summary?.scheduledTasks ?? 0} of ${summary?.includedTasks ?? 0} ${t('tasks', 'tasks')}`
          + (summary?.setupTasks && showAt(experienceLevel, 'intermediate') ? ` + ${summary.setupTasks} ${t('setup', 'setup')}s` : '')} />
        <KPI icon="⚡" label={`Avg ${t('utilization', 'Utilization')}`} value={fmtPctDirect(avgUtil)} color={
          avgUtil > 85 ? C.red : avgUtil > 60 ? C.yellow : C.green
        } sub={`${resources.length} ${t('resources', 'resources')}`} />
        <KPI icon="⏰" label={`Late ${t('orders', 'Orders')}`} value={lateOrders} color={lateOrders > 0 ? C.red : C.green}
          sub={`of ${orders.length} total`} />
        <KPI icon="⚠" label={t('conflicts', 'Conflicts')} value={conflicts.length}
          color={conflicts.length > 0 ? C.red : C.green} sub={`${t('task', 'task')} + ${t('material', 'material')}`} />
        <KPI icon="📦" label={`${t('shortage', 'Shortage')}s`} value={shortages} color={shortages > 0 ? C.red : C.green}
          sub={`of ${materials.length} ${t('materials', 'materials')}`} />
        {showAt(experienceLevel, 'expert') && summary?.makespan != null && (
          <KPI icon="⏱" label={t('makespan', 'Makespan')} value={fmtDuration(summary.makespan)} color={C.text}
            sub={`${fmtDateShort(summary.horizonStart)} – ${fmtDateShort(summary.horizonEnd)}`} />
        )}
        {showAt(experienceLevel, 'intermediate') && criticalPath && (
          <KPI icon={'\uD83D\uDD17'} label="Critical Path"
            value={criticalPath.makespanFormatted}
            color={C.text}
            sub={`Bottleneck: ${criticalPath.bottleneckResource?.resourceName} (${criticalPath.bottleneckResource?.percentOfCriticalPath}%)`} />
        )}
      </div>

      {/* Gantt + Side panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        <Card title={`${t('schedule', 'Schedule')} Overview`}>
          <GanttChart tasks={tasks} resources={resources} products={products} colors={colors}
            onTaskClick={onTaskClick} onResourceClick={onResourceClick}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes}
            onPinTask={onPinTask} onExcludeTask={onExcludeTask} onUnscheduleTask={onUnscheduleTask}
            onWhereTo={onWhereTo}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            scrollOffset={scrollOffset} setScrollOffset={setScrollOffset}
            onViewAgenda={onViewAgenda} />
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title={`${t('resource', 'Resource')} ${t('utilization', 'Utilization')}`}>
            {(() => {
              const wcGroups = new Map<string, any[]>();
              resources.forEach((r: any) => {
                const wc = r.workCenter || 'Other';
                if (!wcGroups.has(wc)) wcGroups.set(wc, []);
                wcGroups.get(wc)!.push(r);
              });
              return Array.from(wcGroups.entries()).map(([wcName, wcRes]) => (
                <div key={wcName}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginTop: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {wcName}
                  </div>
                  {wcRes.map((r: any) => (
                    <UtilBar key={r.resourceKey} pct={r.utilization} label={r.resourceName}
                      onClick={() => onResourceClick?.(r)} />
                  ))}
                </div>
              ));
            })()}
          </Card>
          <Card title={`${t('order', 'Order')} Status`}>
            {orders.map((o: any) => {
              const status = deriveOrderStatus(o, tasks);
              return (
                <div key={o.orderKey} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: `1px solid ${C.border}`,
                }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{o.orderKey}</span>
                    <span style={{ color: C.textDim, fontSize: 12, marginLeft: 8 }}>
                      {products.find((p: any) => p.key === o.productKey)?.name || o.productKey}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Ring pct={o.fillRate} size={24} />
                    <Badge label={status} />
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      </div>

      {/* Alert Banners */}
      {conflicts.filter((c: any) => c.severity === 'critical').length > 0 && (
        <div
          onClick={() => onTabChange('Conflicts')}
          style={{
            background: C.redDim, border: `1px solid ${C.red}33`, borderRadius: 10,
            padding: '12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', fontFamily: FONT,
          }}
        >
          <span style={{ color: C.red, fontWeight: 600, fontSize: 13 }}>
            ⚠ {conflicts.filter((c: any) => c.severity === 'critical').length} critical {t('conflicts', 'conflicts')} detected
          </span>
          <span style={{ color: C.red, fontSize: 12 }}>View {t('conflicts', 'Conflicts')} →</span>
        </div>
      )}
      {shortages > 0 && (
        <div
          onClick={() => onTabChange('Materials')}
          style={{
            background: C.yellowDim, border: `1px solid ${C.yellow}33`, borderRadius: 10,
            padding: '12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', fontFamily: FONT,
          }}
        >
          <span style={{ color: C.yellow, fontWeight: 600, fontSize: 13 }}>
            📦 {shortages} {t('material', 'material')} {t('shortage', 'shortage')}{shortages > 1 ? 's' : ''} — review inventory
          </span>
          <span style={{ color: C.yellow, fontSize: 12 }}>View {t('materials', 'Materials')} →</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   UNSCHEDULED TASKS PANEL
   ═══════════════════════════════════════════════════════════════ */

function UnscheduledPanel({ tasks, colors, taskExcludes, taskUnschedules,
  onTaskClick, onWhereTo, onApiSchedule, actionLoading,
  resourceFilter, selectedTasks, onToggleSelect }: {
  tasks: any[]; products?: any[]; colors: any;
  taskExcludes?: Record<string, boolean>;
  taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onTaskClick?: (t: any) => void;
  onWhereTo?: (key: string) => void;
  onApiSchedule?: (key: string) => Promise<void>;
  actionLoading?: string | null;
  resourceFilter?: string | null;
  selectedTasks?: Set<string>;
  onToggleSelect?: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const unscheduled = useMemo(() => {
    return tasks.filter((t: any) => {
      const isUnscheduled = !t.feasible || !t.scheduledStart;
      const isPendingUnsched = taskUnschedules?.has(t.key);
      const isExcluded = taskExcludes?.[t.key];
      if (t.type && t.type !== 'PROCESS') return false;
      if (resourceFilter) {
        const matchesResource = t.assignedResources?.some(
          (r: any) => r.resourceKey === resourceFilter || r.requestedResource === resourceFilter
        );
        if (!matchesResource) return false;
      }
      return isUnscheduled || isPendingUnsched || isExcluded;
    });
  }, [tasks, taskUnschedules, taskExcludes, resourceFilter]);

  if (unscheduled.length === 0) return null;

  const pendingUnsched = unscheduled.filter(t => taskUnschedules?.has(t.key));

  return (
    <div style={{
      marginTop: 12, borderRadius: 8,
      border: `1px solid ${C.border}`, background: C.surface,
    }}>
      <div onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>
            {expanded ? '\u25BE' : '\u25B8'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            Not Scheduled
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: C.yellowDim, color: C.yellow,
          }}>
            {unscheduled.length}
          </span>
          {pendingUnsched.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: C.redDim, color: C.red,
            }}>
              {pendingUnsched.length} pending unschedule
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: '0 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 6,
        }}>
          {unscheduled.map((task: any) => {
            const prodColor = colors ? getTaskColor(task, colors) : C.accent;
            const isSelected = selectedTasks?.has(task.key);
            const isPendingUnsched = taskUnschedules?.has(task.key);
            const isExcluded = taskExcludes?.[task.key];

            return (
              <div key={task.key}
                onClick={() => onTaskClick?.(task)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: isSelected ? `${C.accent}18` : C.surface2,
                  border: `1px solid ${isSelected ? C.accent + '44' : C.border}`,
                  transition: 'all 0.15s', fontSize: 12, fontFamily: FONT,
                  opacity: isExcluded ? 0.4 : 1,
                }}>

                {onToggleSelect && (
                  <input type="checkbox"
                    checked={isSelected || false}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(task.key)}
                    style={{ cursor: 'pointer', accentColor: C.accent, margin: 0 }}
                  />
                )}

                <div style={{
                  width: 6, height: 6, borderRadius: '50%', background: prodColor, flexShrink: 0,
                }} />

                <div>
                  <span style={{ fontWeight: 600, color: C.text }}>{task.name}</span>
                  {task.orderRef && (
                    <span style={{ color: C.textDim, marginLeft: 6 }}>{task.orderRef}</span>
                  )}
                </div>

                {isPendingUnsched && (
                  <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>{'\u2192'} UNSCHED</span>
                )}
                {isExcluded && !isPendingUnsched && (
                  <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>EXCLUDED</span>
                )}
                {!isPendingUnsched && !isExcluded && task.errors?.length > 0 && (
                  <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>INFEASIBLE</span>
                )}

                {onApiSchedule && !isExcluded && (
                  <button onClick={(e) => { e.stopPropagation(); onApiSchedule(task.key); }}
                    title="Schedule this task now"
                    disabled={actionLoading === task.key}
                    style={{
                      background: 'none', border: 'none', cursor: actionLoading === task.key ? 'wait' : 'pointer',
                      fontSize: 12, padding: '0 2px', color: C.green,
                      opacity: actionLoading === task.key ? 0.4 : 0.7,
                    }}>
                    {actionLoading === task.key ? '...' : '\u25B6'}
                  </button>
                )}
                {onWhereTo && !isExcluded && (
                  <button onClick={(e) => { e.stopPropagation(); onWhereTo(task.key); }}
                    title="Where can this go?"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, padding: '0 2px', color: C.accent, opacity: 0.7,
                    }}>
                    {'\uD83D\uDDFA\uFE0F'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — SCHEDULE
   ═══════════════════════════════════════════════════════════════ */

function ScheduleTab({ tasks, resources, products, colors, onTaskClick, onResourceClick,
  taskPins, taskExcludes, taskUnschedules, orderModes, orders,
  onPinTask, onExcludeTask, onUnscheduleTask,
  onApiUnschedule, onApiPin, onApiSchedule, onApiBulkUnschedule, onApiBulkPin, actionLoading,
  experienceLevel = 'novice',
  onWhereTo, whereToTaskKey, whereToOptions, whereToLoading,
  whereToCurrentAssignment, whereToSource, onMoveTo, onCancelWhereTo,
  caseFilter, onClearCaseFilter, onNavigateToOrders,
  selectedTasks, onToggleSelect, onSetSelectedTasks,
  onScheduleSelected, onUnscheduleSelected, onPinSelected, onUnpinSelected, onExcludeSelected, onIncludeSelected,
  onSetResourcePreference, onSetResourcePrefForTask, resourcePreferenceOverrides,
  priorityOverrides, onSetPriority, onRushSelected,
  zoomLevel, setZoomLevel, scrollOffset, setScrollOffset, onViewAgenda, onOpenDowntimeEditor, onAskAI,
  replay, onReplayStep, onReplayJumpStart, onReplayJumpEnd,
  onReplayTogglePlay, onReplaySpeedChange, onReplayExit, onReplayJumpToStep,
  ctpGhostBars, isQueuing = false,
  onToolbarAction }: {
  tasks: any[]; resources: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
  onViewAgenda?: (r: any) => void;
  onOpenDowntimeEditor?: (resourceKey: string) => void;
  taskPins?: Record<string, boolean>; taskExcludes?: Record<string, boolean>; taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  orders?: any[];
  onPinTask?: (key: string, pinned: boolean) => void;
  onExcludeTask?: (key: string, excluded: boolean) => void;
  onUnscheduleTask?: (key: string) => void;
  onApiUnschedule?: (key: string) => Promise<void>;
  onApiPin?: (key: string, pinned: boolean) => Promise<void>;
  onApiSchedule?: (key: string) => Promise<void>;
  onApiBulkUnschedule?: (keys: string[]) => Promise<void>;
  onApiBulkPin?: (keys: string[], pinned: boolean) => Promise<void>;
  actionLoading?: string | null;
  experienceLevel?: ExperienceLevel;
  onWhereTo?: (key: string, source?: 'gantt' | 'table') => void;
  whereToTaskKey?: string | null;
  whereToOptions?: any[];
  whereToLoading?: boolean;
  whereToCurrentAssignment?: any;
  whereToSource?: 'gantt' | 'table' | 'panel' | null;
  onMoveTo?: (key: string, option: any) => void;
  onCancelWhereTo?: () => void;
  caseFilter?: string | null;
  onClearCaseFilter?: () => void;
  onNavigateToOrders?: (orderKey: string) => void;
  selectedTasks?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onSetSelectedTasks?: (s: Set<string>) => void;
  onScheduleSelected?: (keys: string[], e?: any) => void;
  onUnscheduleSelected?: (keys: string[], e?: any) => void;
  onPinSelected?: (keys: string[], e?: any) => void;
  onUnpinSelected?: (keys: string[], e?: any) => void;
  onExcludeSelected?: (keys: string[]) => void;
  onIncludeSelected?: (keys: string[]) => void;
  onSetResourcePreference?: () => void;
  onSetResourcePrefForTask?: (taskKey: string) => void;
  resourcePreferenceOverrides?: Record<string, Record<string, string>>;
  priorityOverrides?: Record<string, number>;
  onSetPriority?: (key: string, priority: number) => void;
  onRushSelected?: (keys: string[]) => void;
  zoomLevel: string;
  setZoomLevel: (v: string | ((prev: string) => string)) => void;
  scrollOffset: number;
  setScrollOffset: (v: number | ((prev: number) => number)) => void;
  onAskAI?: (task: any) => void;
  replay?: ReplayState;
  onReplayStep?: (delta: number) => void;
  onReplayJumpStart?: () => void;
  onReplayJumpEnd?: () => void;
  onReplayTogglePlay?: () => void;
  onReplaySpeedChange?: (speed: number) => void;
  onReplayExit?: () => void;
  onReplayJumpToStep?: (step: number) => void;
  ctpGhostBars?: any[] | null;
  isQueuing?: boolean;
  onToolbarAction?: (action: string, taskKeys: string[], event?: any) => void;
}) {
  const tabNames = [`Gantt by ${t('resource', 'Resource')}`, `Gantt by ${t('order', 'Order')}`, t('tasks', 'Task List')];
  const [subIdx, setSubIdx] = useState(0);
  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<{ after?: string; before?: string }>({});

  // Force Task List when case filter is active
  const effectiveIdx = caseFilter ? 2 : subIdx;

  return (
    <div>
      <SubTabs tabs={tabNames} active={tabNames[effectiveIdx]} onChange={(s) => { setSubIdx(tabNames.indexOf(s)); if (caseFilter) onClearCaseFilter?.(); }} />
      {effectiveIdx === 0 ? (
        <Card>
          <GanttChart tasks={tasks} resources={resources} products={products} colors={colors}
            onTaskClick={onTaskClick} onResourceClick={onResourceClick}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes}
            onPinTask={onPinTask} onExcludeTask={onExcludeTask} onUnscheduleTask={onUnscheduleTask}
            onApiUnschedule={onApiUnschedule} onApiPin={onApiPin}
            onApiBulkUnschedule={onApiBulkUnschedule} actionLoading={actionLoading}
            onResourceFilter={(key) => { setResourceFilter(prev => prev === key ? null : key); if (resourceFilter !== key) setSubIdx(2); }}
            resourceFilter={resourceFilter}
            onWhereTo={onWhereTo} whereToTaskKey={whereToTaskKey} whereToOptions={whereToOptions}
            whereToLoading={whereToLoading} whereToCurrentAssignment={whereToCurrentAssignment}
            whereToSource={whereToSource} onMoveTo={onMoveTo} onCancelWhereTo={onCancelWhereTo}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            scrollOffset={scrollOffset} setScrollOffset={setScrollOffset}
            onSetResourcePrefForTask={onSetResourcePrefForTask}
            onViewAgenda={onViewAgenda} onOpenDowntimeEditor={onOpenDowntimeEditor} onAskAI={onAskAI}
            replay={replay} onReplayStep={onReplayStep}
            onReplayJumpStart={onReplayJumpStart} onReplayJumpEnd={onReplayJumpEnd}
            onReplayTogglePlay={onReplayTogglePlay} onReplaySpeedChange={onReplaySpeedChange}
            onReplayExit={onReplayExit} onReplayJumpToStep={onReplayJumpToStep}
            ctpGhostBars={ctpGhostBars} onToolbarAction={onToolbarAction} />
          <UnscheduledPanel tasks={tasks} colors={colors}
            taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            onTaskClick={onTaskClick} onWhereTo={onWhereTo}
            onApiSchedule={onApiSchedule} actionLoading={actionLoading}
            resourceFilter={resourceFilter}
            selectedTasks={selectedTasks} onToggleSelect={onToggleSelect} />
        </Card>
      ) : effectiveIdx === 1 ? (
        <Card>
          <CaseGanttChart tasks={tasks} orders={orders} products={products} colors={colors}
            onTaskClick={onTaskClick}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            scrollOffset={scrollOffset} setScrollOffset={setScrollOffset} />
          <UnscheduledPanel tasks={tasks} colors={colors}
            taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            onTaskClick={onTaskClick} onWhereTo={onWhereTo}
            onApiSchedule={onApiSchedule} actionLoading={actionLoading}
            resourceFilter={resourceFilter}
            selectedTasks={selectedTasks} onToggleSelect={onToggleSelect} />
        </Card>
      ) : (
        <Card>
          <TaskTable tasks={tasks} products={products} colors={colors} onTaskClick={onTaskClick}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes} experienceLevel={experienceLevel}
            onPinTask={onPinTask} onExcludeTask={onExcludeTask} onUnscheduleTask={onUnscheduleTask}
            onApiUnschedule={onApiUnschedule} onApiPin={onApiPin}
            onApiBulkUnschedule={onApiBulkUnschedule} onApiBulkPin={onApiBulkPin}
            onWhereTo={onWhereTo} whereToTaskKey={whereToTaskKey}
            caseFilter={caseFilter} onClearCaseFilter={onClearCaseFilter}
            onNavigateToOrders={onNavigateToOrders}
            resourceFilter={resourceFilter}
            resourceFilterName={resourceFilter ? (resources.find((r: any) => r.resourceKey === resourceFilter)?.resourceName || resourceFilter) : null}
            timeFilter={timeFilter}
            onResourceFilterChange={(key) => setResourceFilter(key)}
            onTimeFilterChange={(f) => setTimeFilter(f)}
            selectedTasks={selectedTasks} onToggleSelect={onToggleSelect} onSetSelectedTasks={onSetSelectedTasks}
            onScheduleSelected={onScheduleSelected} onUnscheduleSelected={onUnscheduleSelected}
            onPinSelected={onPinSelected} onUnpinSelected={onUnpinSelected}
            onExcludeSelected={onExcludeSelected} onIncludeSelected={onIncludeSelected}
            onSetResourcePreference={onSetResourcePreference} resourcePreferenceOverrides={resourcePreferenceOverrides}
            priorityOverrides={priorityOverrides} onSetPriority={onSetPriority} onRushSelected={onRushSelected}
            onApiSchedule={onApiSchedule} actionLoading={actionLoading}
            resourceUtilization={resources} isQueuing={isQueuing}
            onToolbarAction={onToolbarAction} />
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — ORDERS
   ═══════════════════════════════════════════════════════════════ */

function OrdersTab({ orders, products, tasks, orderModes, taskPins, taskExcludes, onOrderModeChange,
  caseFilter, onClearCaseFilter }: {
  orders: any[]; products: any[]; tasks?: any[];
  orderModes?: Record<string, string>;
  taskPins?: Record<string, boolean>;
  taskExcludes?: Record<string, boolean>;
  onOrderModeChange?: (key: string, mode: string) => void;
  caseFilter?: string | null;
  onClearCaseFilter?: () => void;
}) {
  const filteredOrders = useMemo(() =>
    caseFilter ? orders.filter(o => o.orderKey === caseFilter) : orders,
    [orders, caseFilter]);
  const totalDemand = filteredOrders.reduce((s: number, o: any) => s + (o.demandQty || 0), 0);
  const lateCount = filteredOrders.filter((o: any) => deriveOrderStatus(o, tasks) === 'late').length;
  const atRiskCount = filteredOrders.filter((o: any) => deriveOrderStatus(o, tasks) === 'at-risk').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {caseFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: FONT,
            background: C.accent + '18', color: C.accent, border: `1px solid ${C.accent}44`,
          }}>
            Filtered: {caseFilter}
            <span onClick={onClearCaseFilter} style={{ cursor: 'pointer', opacity: 0.7, fontSize: 14 }} title="Clear filter">&times;</span>
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label={`Total ${t('orders', 'Orders')}`} value={filteredOrders.length} icon="📋" />
        <KPI label={`Total ${t('demand', 'Demand')}`} value={fmtNum(totalDemand)} icon="📦" />
        <KPI label={t('late', 'Late')} value={lateCount} icon="⏰" color={lateCount > 0 ? C.red : C.green} />
        <KPI label={t('atRisk', 'At Risk')} value={atRiskCount} icon="⚠" color={atRiskCount > 0 ? C.yellow : C.green} />
      </div>
      <Card>
        <OrderTable orders={filteredOrders} products={products} tasks={tasks}
          orderModes={orderModes} taskPins={taskPins} taskExcludes={taskExcludes}
          onOrderModeChange={onOrderModeChange} />
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — CONFLICTS
   ═══════════════════════════════════════════════════════════════ */

function ConflictsTab({ tasks, resources, materials, onTaskClick }: {
  tasks: any[]; resources: any[]; materials: any[];
  onTaskClick?: (taskKey: string) => void;
}) {
  const conflicts = deriveConflicts(tasks, resources, materials);
  const [cfSearch, setCfSearch] = useState('');
  const [severity, setSeverity] = useState('all');
  const [reason, setReason] = useState('all');

  const criticalCount = conflicts.filter((c: any) => c.severity === 'critical').length;
  const warningCount = conflicts.filter((c: any) => c.severity === 'warning').length;
  const infeasible = tasks.filter((tk: any) => tk.included && !tk.feasible).length;

  let filtered = conflicts;
  if (cfSearch) {
    const q = cfSearch.toLowerCase();
    filtered = filtered.filter((c: any) =>
      (c.taskName || '').toLowerCase().includes(q) ||
      (c.taskKey || '').toLowerCase().includes(q) ||
      (c.orderRef || '').toLowerCase().includes(q) ||
      (c.reasonDetail || '').toLowerCase().includes(q),
    );
  }
  if (severity !== 'all') {
    filtered = filtered.filter((c: any) => c.severity === severity);
  }
  if (reason !== 'all') {
    filtered = filtered.filter((c: any) => c.reason === reason);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label={`Total ${t('conflicts', 'Conflicts')}`} value={conflicts.length} icon="⚠"
          color={conflicts.length > 0 ? C.red : C.green} />
        <KPI label="Critical" value={criticalCount} icon="🔴"
          color={criticalCount > 0 ? C.red : C.green} />
        <KPI label="Warnings" value={warningCount} icon="🟡"
          color={warningCount > 0 ? C.yellow : C.green} />
        <KPI label={`${t('infeasibleStatus', 'Infeasible')} ${t('tasks', 'Tasks')}`} value={infeasible} icon="✕"
          color={infeasible > 0 ? C.red : C.green} />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SearchBox value={cfSearch} onChange={setCfSearch} placeholder="Search conflicts..." />
        <StatusToggles options={[
          { value: 'all', label: 'All', count: conflicts.length },
          { value: 'critical', label: 'Critical', color: C.red, count: criticalCount },
          { value: 'warning', label: 'Warning', color: C.yellow, count: warningCount },
        ]} active={severity} onChange={setSeverity} />
        <StatusToggles options={[
          { value: 'all', label: 'All Reasons' },
          { value: 'availability', label: 'Availability', color: '#9e9e9e' },
          { value: 'capacity', label: 'Capacity', color: '#f44336' },
          { value: 'dependency', label: 'Dependency', color: '#ff9800' },
          { value: 'material', label: t('material', 'Material'), color: C.cyan },
        ]} active={reason} onChange={setReason} />
        <span style={{ fontSize: 12, color: C.textDim, marginLeft: 'auto' }}>
          {filtered.length} of {conflicts.length}
        </span>
      </div>

      <ConflictCards conflicts={filtered} onTaskClick={onTaskClick} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — MATERIALS
   ═══════════════════════════════════════════════════════════════ */

function MaterialsTab({ materials, materialModes, onMaterialModeChange }: {
  materials: any[];
  materialModes?: Record<string, string>;
  onMaterialModeChange?: (key: string, mode: string) => void;
}) {
  const shortages = materials.filter((m: any) => deriveMaterialStatus(m) === 'shortage').length;
  const atRisk = materials.filter((m: any) => deriveMaterialStatus(m) === 'at-risk').length;
  const hasIncoming = materials.filter((m: any) => (m.incoming ?? 0) > 0).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label={`${t('materials', 'Materials')} Tracked`} value={materials.length} icon="📦" />
        <KPI label={`${t('shortage', 'Shortage')}s`} value={shortages} icon="🔴" color={shortages > 0 ? C.red : C.green} />
        <KPI label={t('atRisk', 'At Risk')} value={atRisk} icon="⚠" color={atRisk > 0 ? C.yellow : C.green} />
        <KPI label="Incoming" value={hasIncoming} icon="🚚" color={C.accent} />
      </div>
      <Card>
        <MatTable materials={materials} materialModes={materialModes} onMaterialModeChange={onMaterialModeChange} />
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL CONTENT
   ═══════════════════════════════════════════════════════════════ */

// ── Scoring Rules Editor types & catalog ─────────────────────────────────

interface ScoringRuleOverride {
  ruleName: string;
  weight: number;
  objective: number;
  includeInSolve: boolean;
  penaltyFactor: number;
  group?: string;
}

const RULE_CATALOG: Record<string, {
  desc: string; objective: number; defaultWeight: number; defaultPenalty: number; defaultGroup?: string;
}> = {
  EarliestStartTimeScoringRule: { desc: 'Prefer earlier placement — builds buffer before due dates', objective: 0, defaultWeight: 0.15, defaultPenalty: 0, defaultGroup: 'Schedule Quality' },
  LatestStartTimeScoringRule: { desc: 'Prefer later placement — JIT strategy, delays work to reduce WIP', objective: 0, defaultWeight: 0.15, defaultPenalty: 0, defaultGroup: 'Schedule Quality' },
  WhiteSpaceScoringRule: { desc: 'Prefer slots with more flexibility — preserves options for later tasks', objective: 1, defaultWeight: 0.15, defaultPenalty: 0, defaultGroup: 'Resource Efficiency' },
  ChangeoverScoringRule: { desc: 'Minimize changeover/setup time — batch similar work together', objective: 0, defaultWeight: 0.20, defaultPenalty: 0, defaultGroup: 'Resource Efficiency' },
  DueDateScoringRule: { desc: 'Penalize lateness — only fires on the last task in each order chain', objective: 0, defaultWeight: 0.35, defaultPenalty: 2.0, defaultGroup: 'Schedule Quality' },
  ResourceUtilizationScoringRule: { desc: 'Spread work across resources — avoids overloading bottlenecks', objective: 1, defaultWeight: 0.20, defaultPenalty: 0, defaultGroup: 'Resource Efficiency' },
  ResourcePreferenceScoringRule: { desc: 'Honor operator/machine preferences — tiebreaker for resource assignment', objective: 0, defaultWeight: 0.10, defaultPenalty: 0, defaultGroup: 'Schedule Quality' },
  ResourceCostScoringRule: { desc: 'Minimize hourly resource cost — prefers cheaper machines/operators', objective: 0, defaultWeight: 0.20, defaultPenalty: 0, defaultGroup: 'Cost' },
  ChangeoverCostScoringRule: { desc: 'Minimize changeover dollar cost — batch similar products to avoid expensive setups', objective: 0, defaultWeight: 0.15, defaultPenalty: 0, defaultGroup: 'Cost' },
  LatenessCostScoringRule: { desc: 'Minimize lateness penalties — dollar cost per day late from order contracts', objective: 0, defaultWeight: 0.15, defaultPenalty: 0, defaultGroup: 'Cost' },
  MaterialCostScoringRule: { desc: 'Minimize material waste cost — accounts for scrap rates and unit costs', objective: 0, defaultWeight: 0.10, defaultPenalty: 0, defaultGroup: 'Cost' },
  OvertimeCostScoringRule: { desc: 'Minimize overtime premium — extra cost for hours outside standard availability', objective: 0, defaultWeight: 0.10, defaultPenalty: 0, defaultGroup: 'Cost' },
};

function displayRuleName(name: string): string {
  return name.replace(/ScoringRule$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

const RULE_ABBREV: Record<string, string> = {
  DueDateScoringRule: 'DueDate',
  EarliestStartTimeScoringRule: 'Earliest',
  LatestStartTimeScoringRule: 'Latest',
  WhiteSpaceScoringRule: 'WhiteSpc',
  ChangeoverScoringRule: 'Chgover',
  ResourceUtilizationScoringRule: 'Util',
  ResourcePreferenceScoringRule: 'Pref',
  ResourceCostScoringRule: 'ResCost',
  ChangeoverCostScoringRule: 'ChgCost',
  LatenessCostScoringRule: 'LateCost',
  MaterialCostScoringRule: 'MatCost',
  OvertimeCostScoringRule: 'OTCost',
};

// ── Scoring Rules Editor ─────────────────────────────────────────────────

function ScoringRulesEditor({ rules, onChange, source, configName }: {
  rules: ScoringRuleOverride[];
  onChange: (rules: ScoringRuleOverride[]) => void;
  source: 'config' | 'override' | null;
  configName?: string;
}) {
  const [activeRule, setActiveRule] = useState<string | null>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const ruleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const totalWeight = rules.filter(r => r.includeInSolve).reduce((s, r) => s + r.weight, 0);
  const totalPct = Math.round(totalWeight * 100);
  const isValid = totalPct >= 99 && totalPct <= 101;

  const availableRules = Object.keys(RULE_CATALOG).filter(
    name => !rules.some(r => r.ruleName === name),
  );

  // Group rules
  const groups = useMemo(() => {
    const g = new Map<string, { rules: ScoringRuleOverride[]; indices: number[] }>();
    rules.forEach((rule, idx) => {
      const name = rule.group || 'Other';
      if (!g.has(name)) g.set(name, { rules: [], indices: [] });
      g.get(name)!.rules.push(rule);
      g.get(name)!.indices.push(idx);
    });
    return g;
  }, [rules]);
  const hasGroups = groups.size > 1 || (groups.size === 1 && !groups.has('Other'));

  const updateRule = (idx: number, patch: Partial<ScoringRuleOverride>) => {
    const next = rules.map((r, i) => i === idx ? { ...r, ...patch } : r);
    onChange(next);
  };

  const removeRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  const handleAdd = (ruleName: string) => {
    const cat = RULE_CATALOG[ruleName];
    if (!cat) return;
    onChange([...rules, {
      ruleName,
      weight: cat.defaultWeight,
      objective: cat.objective,
      includeInSolve: true,
      penaltyFactor: cat.defaultPenalty,
      group: cat.defaultGroup,
    }]);
    setShowAddDropdown(false);
    setTimeout(() => {
      setActiveRule(ruleName);
      ruleRefs.current[ruleName]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const scrollToRule = (ruleName: string) => {
    setActiveRule(ruleName);
    ruleRefs.current[ruleName]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header: title + source badge + add button */}
      <div style={{
        flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0 0 10px', borderBottom: `1px solid ${C.border}`, marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Scoring Rules</span>
          {configName && <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 6 }}>— {configName}</span>}
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 4,
            background: source === 'override' ? C.yellowDim : C.accentGlow,
            color: source === 'override' ? C.yellow : C.accent,
          }}>
            {source === 'override' ? 'Modified' : 'Config'}
          </span>
        </div>
        {availableRules.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowAddDropdown(!showAddDropdown)} style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: C.accent, color: '#fff', border: 'none', cursor: 'pointer',
            }}>+ Add Rule</button>
            {showAddDropdown && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 10,
                background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 200, padding: 4,
              }}>
                {availableRules.map(name => (
                  <div key={name} onClick={() => handleAdd(name)}
                    style={{
                      padding: '6px 10px', borderRadius: 4, fontSize: 12, color: C.text,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}15`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {displayRuleName(name)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two-column layout: left nav + right panel */}
      <div style={{ display: 'flex', flex: 1, gap: 0, minHeight: 0 }}>
        {/* Left nav — grouped rule names */}
        <div style={{
          width: 160, flexShrink: 0, borderRight: `1px solid ${C.border}`,
          overflowY: 'auto', paddingRight: 0,
        }}>
          {[...groups.entries()].map(([groupName, { rules: groupRules }]) => (
            <div key={groupName}>
              {hasGroups && (
                <div style={{
                  padding: '8px 12px 4px', fontSize: 9, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: 0.8,
                  color: C.textDim,
                }}>
                  {groupName} ({Math.round(groupRules.filter(r => r.includeInSolve).reduce((s, r) => s + r.weight, 0) * 100)}%)
                </div>
              )}
              {groupRules.map(rule => (
                <div key={rule.ruleName}
                  onClick={() => scrollToRule(rule.ruleName)}
                  style={{
                    padding: '6px 12px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderLeft: activeRule === rule.ruleName ? `3px solid ${C.accent}` : '3px solid transparent',
                    background: activeRule === rule.ruleName ? `${C.accent}10` : 'transparent',
                    opacity: rule.includeInSolve ? 1 : 0.45,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (activeRule !== rule.ruleName) e.currentTarget.style.background = `${C.text}08`; }}
                  onMouseLeave={e => { if (activeRule !== rule.ruleName) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {RULE_ABBREV[rule.ruleName] || displayRuleName(rule.ruleName)}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: C.text, minWidth: 28, textAlign: 'right' as const,
                  }}>
                    {Math.round(rule.weight * 100)}%
                  </span>
                </div>
              ))}
            </div>
          ))}
          {/* Reset button */}
          {source === 'override' && (
            <div style={{ padding: '8px 12px' }}>
              <button onClick={() => onChange([])} style={{
                padding: '4px 8px', borderRadius: 4, fontSize: 10,
                background: 'none', border: `1px solid ${C.border}`, color: C.textMuted,
                cursor: 'pointer', width: '100%',
              }}>Reset</button>
            </div>
          )}
        </div>

        {/* Right panel — rule detail cards */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          {rules.map((rule, idx) => {
            const cat = RULE_CATALOG[rule.ruleName];
            return (
              <div key={rule.ruleName}
                ref={el => { ruleRefs.current[rule.ruleName] = el; }}
                style={{
                  padding: '12px 14px', borderRadius: 10, background: C.bg,
                  border: activeRule === rule.ruleName ? `1px solid ${C.accent}44` : `1px solid ${C.border}`,
                  opacity: rule.includeInSolve ? 1 : 0.45,
                  transition: 'opacity 0.15s, border 0.15s',
                  marginBottom: 8,
                }}
                onClick={() => setActiveRule(rule.ruleName)}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                      {displayRuleName(rule.ruleName)}
                    </span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 600,
                      background: rule.objective === 1 ? C.greenDim : C.accentGlow,
                      color: rule.objective === 1 ? C.green : C.accent,
                    }}>
                      {rule.objective === 1 ? 'maximize' : 'minimize'}
                    </span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeRule(idx); }} style={{
                    background: 'none', border: 'none', color: C.textDim, cursor: 'pointer',
                    fontSize: 14, padding: '2px 6px', lineHeight: 1,
                  }}>x</button>
                </div>
                {/* Description */}
                {cat && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{cat.desc}</div>}
                {/* Weight slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, width: 42 }}>Weight</span>
                  <input type="range" min={0} max={100} step={1}
                    value={Math.round(rule.weight * 100)}
                    onChange={e => updateRule(idx, { weight: parseInt(e.target.value) / 100 })}
                    style={{ flex: 1, accentColor: C.accent }}
                  />
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 600, width: 32, textAlign: 'right' as const }}>
                    {Math.round(rule.weight * 100)}%
                  </span>
                </div>
                {/* Penalty factor — DueDate only */}
                {rule.ruleName === 'DueDateScoringRule' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: C.textMuted, width: 42 }}>Penalty</span>
                    <input type="number" min={0} max={10} step={0.5}
                      value={rule.penaltyFactor}
                      onChange={e => updateRule(idx, { penaltyFactor: parseFloat(e.target.value) || 0 })}
                      style={{
                        width: 56, padding: '3px 6px', borderRadius: 4, fontSize: 12,
                        background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
                      }}
                    />
                    <span style={{ fontSize: 10, color: C.textDim }}>Late amplifier (0=symmetric, 2=3x)</span>
                  </div>
                )}
                {/* Include toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textMuted, cursor: 'pointer' }}
                  onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={rule.includeInSolve}
                    onChange={e => updateRule(idx, { includeInSolve: e.target.checked })}
                    style={{ accentColor: C.accent }}
                  />
                  Include in solve
                </label>
              </div>
            );
          })}

          {/* JSON preview */}
          <div style={{ marginTop: 4 }}>
            <button onClick={() => setShowJson(!showJson)} style={{
              background: 'none', border: 'none', color: C.accent, fontSize: 11,
              cursor: 'pointer', padding: 0, textDecoration: 'underline',
            }}>{showJson ? 'Hide' : 'Show'} scoring.json</button>
            {showJson && (
              <pre style={{
                marginTop: 6, padding: 10, borderRadius: 8, fontSize: 11,
                background: C.bg, border: `1px solid ${C.border}`, color: C.textMuted,
                overflowX: 'auto', whiteSpace: 'pre-wrap',
              }}>
                {JSON.stringify({ rules }, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Pinned weight total at bottom */}
      <div style={{
        flexShrink: 0, padding: '8px 12px', borderTop: `1px solid ${C.border}`, marginTop: 8,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderRadius: 8, fontSize: 12, fontWeight: 600,
        background: isValid ? C.greenDim : C.redDim,
        color: isValid ? C.green : C.red,
      }}>
        <span>Total weight: {totalPct}%</span>
        <span>{isValid ? '\u2713 Valid' : '\u26A0 Must sum to 100%'}</span>
      </div>
    </div>
  );
}

// ── Solver Section ───────────────────────────────────────────────────────

function SolverSection({ stats, solveResult, configName }: { stats?: any; solveResult?: any; configName?: string }) {
  if (!stats) {
    return (
      <div style={{ color: C.textMuted, fontSize: 13, padding: '20px 0' }}>
        No solve data yet. Run a solve to see statistics.
      </div>
    );
  }

  const sr = solveResult?.solveResult;

  return (
    <div>
      <SectionLabel label="Last Solve" />
      <div style={{
        padding: '10px 14px', borderRadius: 8, marginBottom: 16,
        background: C.bg, border: `1px solid ${C.border}`,
        fontSize: 13, color: C.textMuted, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {configName && <span>Config: <strong style={{ color: C.text }}>{configName}</strong></span>}
        <span>Strategy: <strong style={{ color: C.text }}>{stats.strategy || '-'}</strong></span>
        <span>Time: <strong style={{ color: C.text }}>{(stats.totalTimeMs / 1000).toFixed(2)}s</strong></span>
        {sr?.contextsEvaluated != null && (
          <span>Contexts: <strong style={{ color: C.text }}>{sr.contextsEvaluated}</strong></span>
        )}
        {stats.totalScore != null && (
          <span>Score: <strong style={{ color: C.text }}>{Math.round(stats.totalScore)}</strong></span>
        )}
      </div>

      <SectionLabel label="Timing Breakdown" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          stats.propagationTimeMs != null && { label: 'Propagation', value: `${stats.propagationTimeMs}ms` },
          stats.windowsTightened != null && { label: 'Windows tightened', value: String(stats.windowsTightened) },
          stats.bumpsPerformed != null && { label: 'Bumps', value: `${stats.backtrackSuccesses || 0}/${stats.bumpsPerformed}` },
          stats.iterations != null && { label: 'Iterations', value: String(stats.iterations) },
          sr?.contextsEvaluated != null && { label: 'Contexts evaluated', value: String(sr.contextsEvaluated) },
          stats.contextsPerTask != null && { label: 'Contexts / task', value: String(stats.contextsPerTask) },
        ].filter(Boolean).map((item: any) => (
          <div key={item.label} style={{
            padding: '8px 12px', borderRadius: 6, background: C.bg,
            border: `1px solid ${C.border}`, fontSize: 12,
          }}>
            <div style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
            <div style={{ color: C.textDim, fontSize: 10, marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {stats.scoreBreakdown && Object.keys(stats.scoreBreakdown).length > 0 && (
        <>
          <SectionLabel label="Score Breakdown" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
            {Object.entries(stats.scoreBreakdown).map(([key, val]) => (
              <div key={key} style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 12px',
                borderRadius: 6, background: C.bg, border: `1px solid ${C.border}`, fontSize: 12,
              }}>
                <span style={{ color: C.textMuted }}>{key.replace('ScoringRule', '')}</span>
                <span style={{ color: C.text, fontWeight: 600 }}>{typeof val === 'number' ? Math.round(val) : String(val)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel label="All Statistics" />
      <div style={{ fontSize: 12 }}>
        {Object.entries(stats).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => (
          <div key={k} style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 0',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ color: C.textMuted }}>{k}</span>
            <span style={{ color: C.text, fontWeight: 500 }}>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings Content (left-nav layout) ───────────────────────────────────

function AdminCloneTenant() {
  const [tenants, setTenants] = useState<{ tenantId: string; name: string; vertical: string }[]>([]);
  const [source, setSource] = useState('');
  const [targetName, setTargetName] = useState('');
  const target = targetName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTenants = useCallback(async () => {
    try {
      const res = await api('/ctp/admin/tenants');
      setTenants(res.tenants || []);
      if (!source && res.tenants?.length > 0) setSource(res.tenants[0].tenantId);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadTenants(); }, []);

  const handleClone = async () => {
    if (!source || !target) return;
    setLoading(true);
    setStatus(null);
    try {
      await api('/ctp/admin/clone-tenant', {
        method: 'POST',
        body: JSON.stringify({ sourceTenant: source, targetTenant: target, displayName: targetName.trim() || undefined }),
      });
      setStatus({ type: 'ok', msg: `Cloned '${source}' to '${target}'` });
      setTargetName('');
      loadTenants();
    } catch (err: any) {
      setStatus({ type: 'error', msg: err.message || 'Clone failed' });
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete tenant '${id}'? This cannot be undone.`)) return;
    try {
      await api(`/ctp/admin/tenant/${id}`, { method: 'DELETE' });
      setStatus({ type: 'ok', msg: `Deleted '${id}'` });
      loadTenants();
    } catch (err: any) {
      setStatus({ type: 'error', msg: err.message || 'Delete failed' });
    }
  };

  const handleReset = async (id: string) => {
    if (!confirm(`Reset tenant '${id}' to its source? All changes will be lost.`)) return;
    try {
      await api(`/ctp/admin/tenant/${id}/reset`, { method: 'POST' });
      setStatus({ type: 'ok', msg: `Reset '${id}' to source` });
      loadTenants();
    } catch (err: any) {
      setStatus({ type: 'error', msg: err.message || 'Reset failed' });
    }
  };

  const PROTECTED = new Set(['demo-manufacturing', 'stafford-engineering', 'acme-outpatient']);

  return (
    <div>
      <SectionLabel label="Clone Tenant" />
      <p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 16px' }}>
        Copy a tenant configuration to create a sandbox for testing.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600 }}>Source</div>
          <select value={source} onChange={e => setSource(e.target.value)} style={{
            width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
            background: C.surface, color: C.text, fontSize: 13, fontFamily: FONT,
          }}>
            {tenants.map(t => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600 }}>New Tenant Name</div>
          <input value={targetName} onChange={e => setTargetName(e.target.value)}
            placeholder="e.g. Stafford Sandbox" style={{
            width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
            background: C.surface, color: C.text, fontSize: 13, fontFamily: FONT, boxSizing: 'border-box',
          }} />
          {target && <div style={{ fontSize: 10, color: C.textDim, marginTop: 3, fontFamily: 'monospace' }}>Key: {target}</div>}
        </div>
        <button onClick={handleClone} disabled={loading || !source || !target || target.length < 3} style={{
          padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: FONT,
          opacity: loading || !source || !target || target.length < 3 ? 0.4 : 1,
          whiteSpace: 'nowrap',
        }}>
          Clone
        </button>
      </div>

      {status && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12,
          background: status.type === 'ok' ? '#16a34a22' : '#ef444422',
          color: status.type === 'ok' ? '#16a34a' : '#ef4444',
          border: `1px solid ${status.type === 'ok' ? '#16a34a44' : '#ef444444'}`,
        }}>
          {status.msg}
        </div>
      )}

      <SectionLabel label="Tenants" />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontWeight: 600 }}>Tenant</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontWeight: 600 }}>Name</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontWeight: 600 }}>Source</th>
            <th style={{ textAlign: 'center', padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontWeight: 600, width: 160 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.tenantId}>
              <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.text, fontFamily: 'monospace', fontSize: 11 }}>{t.tenantId}</td>
              <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textMuted }}>{t.name}</td>
              <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontFamily: 'monospace', fontSize: 10 }}>{(t as any).clonedFrom || '\u2014'}</td>
              <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, textAlign: 'center' }}>
                <a href={`?tenant=${t.tenantId}`} style={{ color: C.accent, fontSize: 11, marginRight: 10, textDecoration: 'none' }}>Switch</a>
                {(t as any).clonedFrom && (
                  <span onClick={() => handleReset(t.tenantId)} style={{ color: '#f59e0b', fontSize: 11, cursor: 'pointer', marginRight: 10 }}>Reset</span>
                )}
                {!PROTECTED.has(t.tenantId) && (
                  <span onClick={() => handleDelete(t.tenantId)} style={{ color: C.red, fontSize: 11, cursor: 'pointer' }}>Delete</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SETTINGS_SECTIONS: { key: string; label: string; icon: string; minLevel: ExperienceLevel; group?: string }[] = [
  { key: 'general',  label: 'General',       icon: 'G', minLevel: 'novice' },
  { key: 'scoring',  label: 'Scoring Rules', icon: 'S', minLevel: 'intermediate' },
  { key: 'solver',   label: 'Solver',        icon: 'D', minLevel: 'expert' },
  { key: 'admin',    label: 'Admin',         icon: 'A', minLevel: 'novice', group: 'Admin' },
];

function SettingsContent({ experienceLevel, onExperienceChange, stats, solveResult, scoringRules, onScoringRulesChange, scoringSource, configName }: {
  experienceLevel: ExperienceLevel;
  onExperienceChange: (level: ExperienceLevel) => void;
  stats?: any;
  solveResult?: any;
  scoringRules: ScoringRuleOverride[];
  onScoringRulesChange: (rules: ScoringRuleOverride[]) => void;
  scoringSource: 'config' | 'override' | null;
  configName?: string;
}) {
  const [activeSection, setActiveSection] = useState('general');
  const visibleSections = SETTINGS_SECTIONS.filter(s => showAt(experienceLevel, s.minLevel));

  // Fall back to 'general' if current section becomes invisible
  useEffect(() => {
    if (!visibleSections.some(s => s.key === activeSection)) {
      setActiveSection('general');
    }
  }, [experienceLevel]);

  return (
    <div style={{ display: 'flex', fontFamily: FONT, minHeight: 400 }}>
      {/* Left nav */}
      <div style={{ width: 170, borderRight: `1px solid ${C.border}`, flexShrink: 0, paddingTop: 4 }}>
        {visibleSections.map((section, i) => (
          <div key={section.key}>
            {section.group && (i === 0 || visibleSections[i - 1].group !== section.group) && (
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, padding: '12px 14px 4px', textTransform: 'uppercase', letterSpacing: 1, borderTop: i > 0 ? `1px solid ${C.border}` : 'none', marginTop: i > 0 ? 4 : 0 }}>
                {section.group}
              </div>
            )}
            <div
              onClick={() => setActiveSection(section.key)}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 8,
                background: activeSection === section.key ? C.accentGlow : 'transparent',
                borderLeft: activeSection === section.key ? `2px solid ${C.accent}` : '2px solid transparent',
                color: activeSection === section.key ? C.accent : C.textMuted,
                fontWeight: activeSection === section.key ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              {section.label}
            </div>
          </div>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, padding: '0 20px', overflowY: 'auto', maxHeight: 500 }}>
        {activeSection === 'general' && (
          <div>
            <SectionLabel label="Experience Level" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {EXPERIENCE_LEVELS.map(lvl => {
                const isActive = lvl.value === experienceLevel;
                return (
                  <div
                    key={lvl.value}
                    onClick={() => onExperienceChange(lvl.value)}
                    style={{
                      padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                      background: isActive ? C.accentGlow : C.bg,
                      border: isActive ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.surface2; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? C.accentGlow : C.bg; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{lvl.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: isActive ? C.accent : C.text }}>{lvl.label}</div>
                        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{lvl.desc}</div>
                      </div>
                      {isActive && <span style={{ color: C.accent, fontSize: 16 }}>&#10003;</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeSection === 'scoring' && (
          <ScoringRulesEditor rules={scoringRules} onChange={onScoringRulesChange} source={scoringSource} configName={configName} />
        )}

        {activeSection === 'solver' && (
          <SolverSection stats={stats} solveResult={solveResult} configName={configName} />
        )}

        {activeSection === 'admin' && (
          <AdminCloneTenant />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   USER PROFILE MODAL CONTENT
   ═══════════════════════════════════════════════════════════════ */

function UserProfileContent() {
  const row: CSSProperties = {
    display: 'flex', justifyContent: 'space-between', padding: '8px 0',
    borderBottom: `1px solid ${C.border}`, fontSize: 13,
  };
  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: C.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: '#fff',
        }}>
          JD
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>John Doe</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>Production Planner</div>
        </div>
      </div>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Email</span>
        <span style={{ color: C.text }}>john.doe@precisionparts.co</span>
      </div>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Tenant</span>
        <span style={{ color: C.text }}>{t('tenantDisplayName', 'CTP Platform')}</span>
      </div>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Role</span>
        <span style={{ color: C.text }}>Production Planner</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — ANALYTICS
   ═══════════════════════════════════════════════════════════════ */

function formatKpiValue(kpi: any): string {
  if (kpi.format === 'percent') return `${kpi.value}%`;
  if (kpi.format === 'duration') return `${kpi.value}m`;
  if (kpi.format === 'ratio') return String(kpi.value);
  if (kpi.format === 'count') return String(kpi.value);
  return String(kpi.value);
}

function UtilizationDetail({ data, experienceLevel }: { data: any; experienceLevel: ExperienceLevel }) {
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  if (!data || !data.resources) return null;

  const groupAvg = data.avgUtilization ?? 0;

  return (
    <div>
      {/* Group summary */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: groupAvg >= 70 ? C.green : groupAvg >= 50 ? C.yellow : C.red }}>
            {groupAvg}%
          </span>
          <span style={{ fontSize: 13, color: C.textMuted }}>Average Utilization</span>
        </div>
        {/* Target line bar */}
        <div style={{ position: 'relative', height: 8, background: C.surface2, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(groupAvg, 100)}%`, background: groupAvg >= 70 ? C.green : groupAvg >= 50 ? C.yellow : C.red, borderRadius: 4 }} />
          <div style={{ position: 'absolute', left: '70%', top: -2, width: 2, height: 12, background: C.textDim }} title="Target: 70%" />
        </div>
      </div>

      {/* Per-resource bars */}
      {data.resources.map((res: any) => (
        <div key={res.key} style={{ marginBottom: 12 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, cursor: 'pointer' }}
            onClick={() => setExpandedResource(expandedResource === res.key ? null : res.key)}
          >
            <span style={{ fontSize: 12, color: C.text, width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {res.name}
            </span>
            <div style={{ flex: 1, height: 20, display: 'flex', borderRadius: 4, overflow: 'hidden', background: C.surface2 }}>
              {/* Assigned (green) */}
              <div style={{ width: `${res.utilization}%`, height: '100%', background: C.green, transition: 'width 0.3s' }} />
              {/* Available but unassigned (light grey) */}
              <div style={{ width: `${Math.max(100 - res.utilization, 0)}%`, height: '100%', background: C.border }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, width: 45, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              color: res.utilization >= 70 ? C.green : res.utilization >= 50 ? C.yellow : C.red }}>
              {res.utilization}%
            </span>
          </div>
          {/* Daily breakdown (expert) */}
          {showAt(experienceLevel, 'expert') && expandedResource === res.key && res.daily && (
            <div style={{ marginLeft: 132, marginBottom: 8, fontSize: 11 }}>
              {res.daily.map((d: any) => (
                <div key={d.date} style={{ display: 'flex', gap: 12, padding: '2px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.textDim, width: 80 }}>{d.date}</span>
                  <span style={{ color: C.textMuted, width: 70 }}>{fmtDuration(d.available)}</span>
                  <span style={{ color: C.green, width: 70 }}>{fmtDuration(d.assigned)}</span>
                  <span style={{ fontWeight: 600, color: d.utilization >= 70 ? C.green : d.utilization >= 50 ? C.yellow : C.red }}>
                    {d.utilization}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Bottleneck (intermediate+) */}
      {showAt(experienceLevel, 'intermediate') && data.bottleneck && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Bottleneck
          </div>
          <div style={{ fontSize: 13, color: C.text }}>
            <strong>{data.bottleneck.resource}</strong> in {data.bottleneck.hierarchy} at{' '}
            <span style={{ color: C.red, fontWeight: 600 }}>{data.bottleneck.resourceUtilization}%</span>
          </div>
        </Card>
      )}
    </div>
  );
}

function SchedulingDetail({ data, experienceLevel }: { data: any; experienceLevel: ExperienceLevel }) {
  if (!data || !('totalTasks' in data)) return null;

  // Group turnovers by resource for bar chart
  const resourceTurnovers = new Map<string, number[]>();
  for (const to of data.avgTurnover?.turnovers ?? []) {
    if (!resourceTurnovers.has(to.resource)) resourceTurnovers.set(to.resource, []);
    resourceTurnovers.get(to.resource)!.push(to.duration);
  }
  const maxTurnover = Math.max(...(data.avgTurnover?.turnovers?.map((t: any) => t.duration) ?? [0]), 1);

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPI icon="✓" label="Scheduled" value={`${data.scheduled}/${data.totalTasks}`}
          color={data.scheduled === data.totalTasks ? C.green : C.yellow}
          sub={`${data.unscheduled} unscheduled`} />
        <KPI icon="✗" label="Infeasible" value={data.infeasible}
          color={data.infeasible === 0 ? C.green : C.red} />
        <KPI icon="⏱" label="On-Time Starts" value={fmtPctDirect(data.onTimeStarts?.percentage ?? 0)}
          color={data.onTimeStarts?.percentage >= 90 ? C.green : data.onTimeStarts?.percentage >= 75 ? C.yellow : C.red}
          sub={`${data.onTimeStarts?.count ?? 0} of ${data.onTimeStarts?.total ?? 0}`} />
        <KPI icon="⚙" label="Avg Turnover" value={`${data.avgTurnover?.minutes ?? 0}m`}
          color={data.avgTurnover?.minutes <= 20 ? C.green : data.avgTurnover?.minutes <= 45 ? C.yellow : C.red}
          sub={`${data.avgTurnover?.count ?? 0} turnovers`} />
      </div>

      {/* Turnover bar chart (intermediate+) */}
      {showAt(experienceLevel, 'intermediate') && data.avgTurnover?.turnovers?.length > 0 && (
        <>
          <SectionLabel label="Turnovers by Resource" />
          {[...resourceTurnovers.entries()].map(([resource, durations]) => {
            const avg = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
            return (
              <div key={resource} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: C.text, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resource}</span>
                <div style={{ flex: 1, height: 16, background: C.surface2, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(avg / maxTurnover) * 100}%`, height: '100%', background: avg <= 1200 ? C.green : avg <= 2700 ? C.yellow : C.red, borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, width: 40, textAlign: 'right', color: C.textMuted }}>{fmtDuration(avg)}</span>
              </div>
            );
          })}
        </>
      )}

      {/* Turnover table (expert) */}
      {showAt(experienceLevel, 'expert') && data.avgTurnover?.turnovers?.length > 0 && (
        <>
          <SectionLabel label="All Turnovers" />
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textDim, fontWeight: 600 }}>Resource</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textDim, fontWeight: 600 }}>From</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textDim, fontWeight: 600 }}>To</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: C.textDim, fontWeight: 600 }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.avgTurnover.turnovers.map((to: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px', color: C.text }}>{to.resource}</td>
                    <td style={{ padding: '6px 8px', color: C.textMuted }}>{to.from}</td>
                    <td style={{ padding: '6px 8px', color: C.textMuted }}>{to.to}</td>
                    <td style={{ padding: '6px 8px', color: C.text, textAlign: 'right', fontWeight: 600 }}>{fmtDuration(to.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MiniCaseGantt({ chain }: { chain: any }) {
  const phases = (chain.phases || []).filter((p: any) => p.scheduledStart && p.scheduledEnd);
  if (phases.length === 0) return null;
  const allStarts = phases.map((p: any) => new Date(p.scheduledStart).getTime());
  const allEnds = phases.map((p: any) => new Date(p.scheduledEnd).getTime());
  const minMs = Math.min(...allStarts);
  const maxMs = Math.max(...allEnds);
  const span = maxMs - minMs;
  if (span <= 0) return null;
  const pct = (ms: number) => ((ms - minMs) / span) * 100;
  const phaseColor = (i: number) => i === 0 ? '#ff9800' : i === phases.length - 1 ? '#4caf50' : C.accent;
  return (
    <div style={{ position: 'relative', height: 20, background: C.surface2, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
      {chain.gaps?.map((gap: any, i: number) => {
        if (gap.gapSeconds <= 0 || !phases[i]?.scheduledEnd || !phases[i + 1]?.scheduledStart) return null;
        const left = pct(new Date(phases[i].scheduledEnd).getTime());
        const w = pct(new Date(phases[i + 1].scheduledStart).getTime()) - left;
        if (w <= 0) return null;
        return <div key={`g${i}`} style={{ position: 'absolute', left: `${left}%`, width: `${w}%`, top: 4, height: 12, borderRadius: 2, background: `${C.red}20`, border: `1px dashed ${C.red}` }} />;
      })}
      {phases.map((p: any, i: number) => {
        const left = pct(new Date(p.scheduledStart).getTime());
        const w = Math.max(pct(new Date(p.scheduledEnd).getTime()) - left, 0.5);
        return <div key={p.taskKey} style={{ position: 'absolute', left: `${left}%`, width: `${w}%`, top: 3, height: 14, borderRadius: 3, background: phaseColor(i), opacity: 0.8 }} />;
      })}
    </div>
  );
}

function ChainDetail({ data, experienceLevel, onNavigateToCase }: { data: any; experienceLevel: ExperienceLevel; onNavigateToCase?: (caseKey: string) => void }) {
  const [sortBy, setSortBy] = useState<'gap' | 'name' | 'start'>('gap');
  const [filter, setFilter] = useState<'all' | 'violations' | 'complete'>('all');

  if (!data || !data.chains) return null;

  let chains = [...data.chains];

  // Filter
  if (filter === 'violations') chains = chains.filter((c: any) => c.totalGap > 0);
  if (filter === 'complete') chains = chains.filter((c: any) => c.status === 'complete');

  // Sort
  if (sortBy === 'gap') chains.sort((a: any, b: any) => b.totalGap - a.totalGap);
  if (sortBy === 'name') chains.sort((a: any, b: any) => a.caseName.localeCompare(b.caseName));
  if (sortBy === 'start') chains.sort((a: any, b: any) => {
    const aStart = a.phases[0]?.scheduledStart ?? '';
    const bStart = b.phases[0]?.scheduledStart ?? '';
    return aStart.localeCompare(bStart);
  });

  return (
    <div>
      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPI icon="🔗" label="Chains" value={data.summary.totalChains}
          sub={`${data.summary.completeChains} complete`} />
        <KPI icon="⏱" label="Avg Gap" value={`${Math.round(data.summary.avgGapSeconds / 60)}m`}
          color={data.summary.avgGapSeconds === 0 ? C.green : data.summary.avgGapSeconds <= 900 ? C.yellow : C.red} />
        <KPI icon="⚡" label="Back-to-Back" value={`${data.summary.backToBackRate}%`}
          color={data.summary.backToBackRate >= 90 ? C.green : data.summary.backToBackRate >= 70 ? C.yellow : C.red} />
        <KPI icon="⚠" label="Violations" value={data.summary.violations.length}
          color={data.summary.violations.length === 0 ? C.green : C.red} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <SubTabs tabs={['All', 'Violations', 'Complete']} active={filter === 'all' ? 'All' : filter === 'violations' ? 'Violations' : 'Complete'}
          onChange={(t) => setFilter(t === 'All' ? 'all' : t === 'Violations' ? 'violations' : 'complete')} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.textDim }}>Sort:</span>
        {(['gap', 'name', 'start'] as const).map((s) => (
          <button key={s} onClick={() => setSortBy(s)} style={{
            padding: '3px 8px', borderRadius: 4, border: `1px solid ${sortBy === s ? C.accent : C.border}`,
            background: sortBy === s ? `${C.accent}20` : 'transparent', color: sortBy === s ? C.accent : C.textMuted,
            fontSize: 11, cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
          }}>
            {s === 'gap' ? 'Worst Gap' : s === 'name' ? 'Name' : 'Start Time'}
          </button>
        ))}
      </div>

      {/* Chain cards */}
      {chains.map((chain: any) => (
        <div key={chain.caseKey} style={{
          border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 8,
          background: C.surface,
        }}>
          {/* Case header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span onClick={() => onNavigateToCase?.(chain.caseKey)} style={{
              fontWeight: 600, fontSize: 13, color: onNavigateToCase ? C.accent : C.text,
              cursor: onNavigateToCase ? 'pointer' : 'default',
              textDecoration: onNavigateToCase ? 'underline' : 'none',
            }} title={onNavigateToCase ? `View ${chain.caseName} in Schedule` : undefined}>{chain.caseName}</span>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: chain.totalGap === 0 ? '#4caf5020' : '#f4433620',
              color: chain.totalGap === 0 ? '#4caf50' : '#f44336',
            }}>
              {chain.totalGap === 0 ? '✓ Back-to-back' : `⚠ ${Math.round(chain.totalGap / 60)}min total gap`}
            </span>
          </div>

          {/* Mini Gantt bar */}
          <MiniCaseGantt chain={chain} />

          {/* Phase rows */}
          {chain.phases.map((phase: any, i: number) => (
            <div key={phase.taskKey}>
              {/* Connector line */}
              {i > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 20, height: 20 }}>
                  <span style={{ fontSize: 10, color: C.textDim }}>│</span>
                  {chain.gaps[i - 1]?.gapSeconds > 0 && (
                    <span style={{ fontSize: 10, color: '#f44336', marginLeft: 8 }}>
                      ⚠ {Math.round(chain.gaps[i - 1].gapSeconds / 60)}min gap
                    </span>
                  )}
                  {chain.gaps[i - 1]?.gapSeconds === 0 && (
                    <span style={{ fontSize: 10, color: '#4caf50', marginLeft: 8 }}>✓ 0 gap</span>
                  )}
                </div>
              )}

              {/* Phase row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 20 }}>
                <span style={{ fontSize: 10, width: 16, color: C.textDim }}>
                  {i === 0 ? '┌' : i === chain.phases.length - 1 ? '└' : '├'}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                  background: phase.type === 'SET_UP' ? '#ff980020' : phase.type === 'PROCESS' ? '#2196f320' : '#9e9e9e20',
                  color: phase.type === 'SET_UP' ? '#ff9800' : phase.type === 'PROCESS' ? '#2196f3' : '#9e9e9e',
                  width: 60, textAlign: 'center' as const,
                }}>
                  {phase.type === 'SET_UP' ? t('setup', 'Setup') : phase.type === 'TEAR_DOWN' ? t('teardown', 'Teardown') : t('process', 'Process')}
                </span>
                <span style={{ fontSize: 12, flex: 1, color: C.text }}>{phase.name}</span>
                <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: C.textMuted }}>
                  {phase.scheduledStart ? fmtDate(phase.scheduledStart) : '—'} — {phase.scheduledEnd ? fmtDate(phase.scheduledEnd) : '—'}
                </span>
                {showAt(experienceLevel, 'intermediate') && (
                  <span style={{ fontSize: 10, color: C.textDim }}>
                    {phase.resources.join(', ')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {chains.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: C.textDim, fontSize: 13 }}>
          {filter === 'violations' ? 'No violations found — all chains are back-to-back!' : 'No chains to display'}
        </div>
      )}
    </div>
  );
}

interface BottleneckSummary {
  resourceType: string;
  count: number;
  blockedBy: string;
  tasks: any[];
}

function buildBottleneckSummary(tasks: any[]): BottleneckSummary[] {
  const infeasible = tasks.filter((t: any) => !t.feasible && t.infeasibilityReport);
  const bySlot = new Map<string, { count: number; blockers: Set<string>; tasks: any[] }>();

  for (const task of infeasible) {
    const slot = task.infeasibilityReport.bottleneckSlot || 'Unknown';
    if (!bySlot.has(slot)) bySlot.set(slot, { count: 0, blockers: new Set(), tasks: [] });
    const entry = bySlot.get(slot)!;
    entry.count++;
    entry.tasks.push(task);

    const bottleneckSlotData = task.infeasibilityReport.slots.find((s: any) => s.isBottleneck);
    if (bottleneckSlotData) {
      for (const res of bottleneckSlotData.resources) {
        for (const bt of res.blockingTasks) {
          entry.blockers.add(bt.chainKey || bt.taskName);
        }
      }
    }
  }

  return Array.from(bySlot.entries()).map(([slot, data]) => ({
    resourceType: slot,
    count: data.count,
    blockedBy: Array.from(data.blockers).join(', '),
    tasks: data.tasks,
  }));
}

function generateRecommendations(summary: BottleneckSummary[]): string[] {
  const recs: string[] = [];
  for (const item of summary) {
    if (item.count >= 2) {
      recs.push(`${item.resourceType} is a systemic bottleneck \u2014 ${item.count} tasks affected. Consider adding capacity.`);
    }
    if (item.blockedBy) {
      recs.push(`${item.resourceType} blocked by ${item.blockedBy}. Consider deferring or rescheduling those chains.`);
    }
  }
  if (summary.length === 0) {
    recs.push('No infeasible tasks \u2014 all tasks placed successfully.');
  }
  return recs;
}

function CostDetail({ data, experienceLevel }: {
  data: any; experienceLevel: ExperienceLevel;
}) {
  if (!data || data.status !== 'ok') return null;

  return (
    <div>
      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { icon: '\uD83D\uDCB0', label: 'Total Cost', value: data.totalCostFormatted, color: C.text, sub: `${data.taskCount} tasks with cost` },
          { icon: '\uD83D\uDCCA', label: 'Avg per Task', value: data.avgCostPerTaskFormatted, color: C.text, sub: `across ${data.taskCount} tasks` },
        ].map((kpi, i) => (
          <div key={i} style={{
            flex: '1 1 140px', padding: '12px 14px', background: C.surface2, borderRadius: 10,
            border: `1px solid ${C.border}`, minWidth: 140,
          }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{kpi.icon} {kpi.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color, fontFamily: FONT }}>{kpi.value}</div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Cost by resource — bar chart */}
      <div style={{ padding: '12px 14px', background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cost by resource</div>
        {(data.costByResource || []).map((rb: any) => (
          <div key={rb.key} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: C.text }}>{rb.name}</span>
            <span style={{ fontSize: 11, color: C.textMuted, minWidth: 50, textAlign: 'right' as const }}>
              {rb.taskCount} task{rb.taskCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.text, minWidth: 70, textAlign: 'right' as const }}>
              {rb.costFormatted}
            </span>
            <div style={{ width: 100, height: 6, background: C.surface, borderRadius: 3 }}>
              <div style={{
                width: `${rb.percentOfTotal}%`, height: '100%', borderRadius: 3,
                background: rb.percentOfTotal > 20 ? C.accent : C.green,
              }} />
            </div>
            <span style={{ fontSize: 10, color: C.textDim, minWidth: 30, textAlign: 'right' as const }}>
              {rb.percentOfTotal}%
            </span>
          </div>
        ))}
      </div>

      {/* Cost by order (intermediate+) */}
      {showAt(experienceLevel, 'intermediate') && (
        <div style={{ padding: '12px 14px', background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cost by order</div>
          {(data.costByOrder || []).map((o: any) => (
            <div key={o.key} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0',
              borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{ flex: 1, fontSize: 12, color: C.text }}>{o.key}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.text, minWidth: 70, textAlign: 'right' as const }}>
                {o.costFormatted}
              </span>
              <div style={{ width: 100, height: 6, background: C.surface, borderRadius: 3 }}>
                <div style={{
                  width: `${o.percentOfTotal}%`, height: '100%', borderRadius: 3,
                  background: C.purple,
                }} />
              </div>
              <span style={{ fontSize: 10, color: C.textDim, minWidth: 30, textAlign: 'right' as const }}>
                {o.percentOfTotal}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CriticalPathDetail({ data, experienceLevel, onTaskClick }: {
  data: any; experienceLevel: ExperienceLevel; onTaskClick?: (key: string) => void;
}) {
  if (!data || data.status !== 'ok') return null;

  return (
    <div>
      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { icon: '\u23F1', label: 'Critical Path', value: data.makespanFormatted, color: C.text, sub: `${data.criticalTasks} of ${data.totalTasks} tasks` },
          { icon: '\uD83D\uDD34', label: 'Bottleneck', value: data.bottleneckResource.resourceName, color: C.red, sub: `${data.bottleneckResource.percentOfCriticalPath}% of critical path` },
          { icon: '\u26A0', label: 'Near-Critical', value: String(data.nearCriticalTasks), color: data.nearCriticalTasks > 5 ? C.yellow : C.green, sub: '< 30min slack' },
          { icon: '\uD83D\uDCCA', label: 'Avg Slack', value: data.avgSlackFormatted, color: data.avgSlack < 1800 ? C.yellow : C.green, sub: 'non-critical tasks' },
        ].map((kpi, i) => (
          <div key={i} style={{
            flex: '1 1 120px', padding: '12px 14px', background: C.surface2, borderRadius: 10,
            border: `1px solid ${C.border}`, minWidth: 120,
          }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{kpi.icon} {kpi.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color, fontFamily: FONT }}>{kpi.value}</div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Critical path strip */}
      <div style={{ padding: '12px 14px', background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Critical path by resource</div>
        <div style={{ display: 'flex', gap: 2, height: 32, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          {(data.segments || []).map((seg: any, i: number) => {
            const pct = data.makespan > 0 ? (seg.totalDuration / data.makespan) * 100 : 0;
            const colors = [C.accent, C.purple, C.green, '#f97316', C.cyan, C.yellow, C.red];
            const color = colors[i % colors.length];
            return (
              <div key={i} style={{
                width: `${pct}%`, background: color + '40',
                borderLeft: i > 0 ? `1px solid ${C.border}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, color, overflow: 'hidden', whiteSpace: 'nowrap',
                minWidth: pct > 8 ? undefined : 0,
              }}>
                {pct > 8 && seg.resourceName}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: C.textMuted }}>
          {(data.segments || []).map((seg: any, i: number) => {
            const colors = [C.accent, C.purple, C.green, '#f97316', C.cyan, C.yellow, C.red];
            const color = colors[i % colors.length];
            const pct = data.makespan > 0 ? Math.round((seg.totalDuration / data.makespan) * 100) : 0;
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                {seg.resourceName} ({pct}%)
              </span>
            );
          })}
        </div>
      </div>

      {/* Resource breakdown */}
      <div style={{ padding: '12px 14px', background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Resource contribution to critical path</div>
        {(data.resourceBreakdown || []).map((rb: any) => (
          <div key={rb.resourceKey} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ flex: 1, fontSize: 12, color: C.text }}>{rb.resourceName}</span>
            <span style={{ fontSize: 11, color: C.textMuted, minWidth: 50, textAlign: 'right' as const }}>
              {rb.taskCount} task{rb.taskCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.text, minWidth: 50, textAlign: 'right' as const }}>
              {rb.criticalTimeFormatted}
            </span>
            <div style={{ width: 100, height: 6, background: C.surface, borderRadius: 3 }}>
              <div style={{
                width: `${rb.percentOfCriticalPath}%`, height: '100%', borderRadius: 3,
                background: rb.percentOfCriticalPath > 40 ? C.red : rb.percentOfCriticalPath > 20 ? C.yellow : C.accent,
              }} />
            </div>
            <span style={{ fontSize: 10, color: C.textDim, minWidth: 30, textAlign: 'right' as const }}>
              {rb.percentOfCriticalPath}%
            </span>
          </div>
        ))}
      </div>

      {/* Slack distribution (intermediate+) */}
      {showAt(experienceLevel, 'intermediate') && (
        <div style={{ padding: '12px 14px', background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Slack distribution</div>
          {(data.slackBuckets || []).map((bucket: any) => (
            <div key={bucket.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: bucket.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: C.text }}>{bucket.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{bucket.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Critical path task list (expert+) */}
      {showAt(experienceLevel, 'expert') && (
        <div style={{ padding: '12px 14px', background: C.surface2, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Critical path tasks</div>
          {(data.pathTasks || []).map((pt: any, i: number) => (
            <div key={pt.key} onClick={() => onTaskClick?.(pt.key)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderBottom: `1px solid ${C.border}`, cursor: onTaskClick ? 'pointer' : 'default',
              fontSize: 12,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.surface; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ color: C.textDim, minWidth: 20 }}>{i + 1}</span>
              <span style={{ flex: 1, color: C.text }}>{pt.name}</span>
              <span style={{ color: C.textMuted, minWidth: 80 }}>{pt.resourceName}</span>
              <span style={{ color: C.text, fontWeight: 600, minWidth: 50, textAlign: 'right' as const }}>{pt.durationFormatted}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATIONS TAB
// ═══════════════════════════════════════════════════════════════

function ConfigurationsTab({ configurations, activeConfigKey, onActivate, onSetDefault, onDelete, onDuplicate, onRename,
  isModified, modifiedConfig, activeConfig, onSave, onSaveAs, onReset }: {
  configurations: any[];
  activeConfigKey: string;
  onActivate: (key: string) => void;
  onSetDefault: (key: string) => void;
  onDelete: (key: string) => void;
  onDuplicate: (config: any) => void;
  onRename: (key: string, newName: string) => void;
  isModified?: boolean;
  modifiedConfig?: any;
  activeConfig?: any;
  onSave?: () => void;
  onSaveAs?: () => void;
  onReset?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');

  if (configurations.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontFamily: FONT }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>No configurations yet</div>
        <div style={{ fontSize: 12 }}>Run a solve to create the default configuration.</div>
      </div>
    );
  }

  const scoringSummary = (scoring: any[]) => {
    if (!scoring || scoring.length === 0) return '—';
    return scoring
      .filter((r: any) => r.includeInSolve)
      .slice(0, 5)
      .map((r: any) => `${RULE_ABBREV[r.ruleName] || displayRuleName(r.ruleName)} ${Math.round(r.weight * 100)}%`)
      .join(' \u00B7 ');
  };

  const tierLabel = (tier: string) => {
    switch (tier) {
      case 'quick': return '\u26A1 Quick';
      case 'balanced': return '\uD83C\uDFAF Balanced';
      case 'thorough': return '\uD83D\uDD2C Thorough';
      case 'best': return '\uD83C\uDFC6 Best';
      default: return tier;
    }
  };

  // Compare view
  if (compareMode) {
    const configA = configurations.find(c => c.key === compareA);
    const configB = configurations.find(c => c.key === compareB);
    return (
      <div style={{ fontFamily: FONT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Compare Configurations</h2>
          <button onClick={() => setCompareMode(false)} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer',
          }}>Back</button>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <select value={compareA} onChange={e => setCompareA(e.target.value)} style={{
            flex: 1, padding: '8px 10px', borderRadius: 6, fontSize: 13,
            background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
          }}>
            <option value="">Select Config A...</option>
            {configurations.map(c => <option key={c.key} value={c.key}>{c.name}{c.isDefault ? ' (default)' : ''}</option>)}
          </select>
          <select value={compareB} onChange={e => setCompareB(e.target.value)} style={{
            flex: 1, padding: '8px 10px', borderRadius: 6, fontSize: 13,
            background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
          }}>
            <option value="">Select Config B...</option>
            {configurations.map(c => <option key={c.key} value={c.key}>{c.name}{c.isDefault ? ' (default)' : ''}</option>)}
          </select>
        </div>
        {configA && configB && <ConfigDiff configA={configA} configB={configB} labelA={configA.name} labelB={configB.name} />}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Configurations</h2>
      </div>

      {/* Config cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {configurations.map(config => {
          const isActive = config.key === activeConfigKey;
          const isDefault = config.isDefault;
          return (
            <div key={config.key} style={{
              padding: '16px 20px', borderRadius: 12, background: C.surface,
              border: isActive ? `1px solid ${C.accent}44` : `1px solid ${C.border}`,
              borderLeft: isActive ? `3px solid ${C.accent}` : `3px solid transparent`,
              transition: 'all 0.15s',
            }}>
              {/* Top row: name + badges + actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {renameKey === config.key ? (
                    <input autoFocus value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => { if (renameValue.trim()) onRename(config.key, renameValue.trim()); setRenameKey(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') { if (renameValue.trim()) onRename(config.key, renameValue.trim()); setRenameKey(null); } if (e.key === 'Escape') setRenameKey(null); }}
                      style={{ fontSize: 15, fontWeight: 700, color: C.text, background: C.surface2, border: `1px solid ${C.accent}`, borderRadius: 4, padding: '2px 6px', width: 200 }}
                    />
                  ) : (
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{config.name}</span>
                  )}
                  {isDefault && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: C.greenDim, color: C.green, fontWeight: 600 }}>{'\u2605'} Default</span>}
                  {isActive && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: C.accentGlow, color: C.accent, fontWeight: 600 }}>{'\u25CF'} Active</span>}
                  {isActive && isModified && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: C.yellowDim, color: C.yellow, fontWeight: 600 }}>{'\u26A0'} Modified</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{config.strategy}</span>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: C.surface2, color: C.text, fontWeight: 600 }}>{tierLabel(config.tier)}</span>
                </div>
              </div>

              {/* Description */}
              {config.description && (
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.description}
                </div>
              )}

              {/* Scoring summary */}
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, fontFamily: FONT }}>
                {scoringSummary(config.scoring)}
              </div>

              {/* Actions row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: C.textDim }}>
                  {config.updatedAt ? `Modified ${new Date(config.updatedAt).toLocaleDateString()}` : ''}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!isActive && (
                    <button onClick={() => onActivate(config.key)} style={{
                      padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                      background: C.accent + '22', color: C.accent, border: `1px solid ${C.accent}33`, cursor: 'pointer',
                    }}>Activate</button>
                  )}
                  <button onClick={() => onDuplicate(config)} style={{
                    padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                    background: C.surface2, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer',
                  }}>Duplicate</button>
                  {/* Overflow menu */}
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setMenuOpen(menuOpen === config.key ? null : config.key)} style={{
                      padding: '4px 8px', borderRadius: 5, fontSize: 13,
                      background: C.surface2, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer',
                    }}>{'\u22EF'}</button>
                    {menuOpen === config.key && (
                      <div style={{
                        position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20,
                        background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 160, padding: 4,
                      }}>
                        <div onClick={() => { setRenameKey(config.key); setRenameValue(config.name); setMenuOpen(null); }}
                          style={{ padding: '6px 10px', borderRadius: 4, fontSize: 12, color: C.text, cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.background = `${C.text}08`; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >Rename</div>
                        {!isDefault && (
                          <div onClick={() => { onSetDefault(config.key); setMenuOpen(null); }}
                            style={{ padding: '6px 10px', borderRadius: 4, fontSize: 12, color: C.text, cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = `${C.text}08`; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >Set as Default</div>
                        )}
                        {!isDefault && (
                          <div onClick={() => { setConfirmDelete(config.key); setMenuOpen(null); }}
                            style={{ padding: '6px 10px', borderRadius: 4, fontSize: 12, color: C.red, cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = `${C.red}10`; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >Delete</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Modified: diff + save/reset */}
              {isActive && isModified && modifiedConfig && activeConfig && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: `${C.yellow}08`, border: `1px solid ${C.yellow}22` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.yellow, marginBottom: 8 }}>Unsaved changes:</div>
                  <ConfigDiff configA={activeConfig} configB={modifiedConfig} labelA="Saved" labelB="Modified" />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button onClick={onSave} style={{
                      padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: C.accent, color: '#fff', border: 'none', cursor: 'pointer',
                    }}>Save</button>
                    <button onClick={onSaveAs} style={{
                      padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: C.surface2, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer',
                    }}>Save As...</button>
                    <button onClick={onReset} style={{
                      padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: 'none', color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer',
                    }}>Reset</button>
                  </div>
                </div>
              )}

              {/* Delete confirmation */}
              {confirmDelete === config.key && (
                <div style={{
                  marginTop: 8, padding: '8px 12px', borderRadius: 6,
                  background: C.redDim, border: `1px solid ${C.red}33`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 12, color: C.red }}>Delete "{config.name}"?</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setConfirmDelete(null)} style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: 11,
                      background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer',
                    }}>Cancel</button>
                    <button onClick={() => { onDelete(config.key); setConfirmDelete(null); }} style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: 11,
                      background: C.red, border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600,
                    }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Compare button */}
      {configurations.length >= 2 && (
        <button onClick={() => { setCompareMode(true); setCompareA(configurations[0]?.key ?? ''); setCompareB(configurations[1]?.key ?? ''); }}
          style={{
            marginTop: 16, padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer',
            width: '100%',
          }}>Compare Two Configurations</button>
      )}
    </div>
  );
}

// ── ConfigDiff component ──────────────────────────────────────────────

function ConfigDiff({ configA, configB, labelA, labelB }: {
  configA: any; configB: any; labelA: string; labelB: string;
}) {
  // diff types: 'same' | 'changed' | 'only-a' | 'only-b'
  type DiffType = 'same' | 'changed' | 'only-a' | 'only-b';
  const rows: { label: string; valueA: string; valueB: string; diff: DiffType }[] = [];

  const diffType = (a: string, b: string): DiffType => {
    if (a === '—' && b !== '—') return 'only-b';
    if (a !== '—' && b === '—') return 'only-a';
    if (a !== b) return 'changed';
    return 'same';
  };

  // Strategy
  const sA = configA.strategy || '—', sB = configB.strategy || '—';
  rows.push({ label: 'Strategy', valueA: sA, valueB: sB, diff: diffType(sA, sB) });

  // Tier
  const tA = configA.tier || '—', tB = configB.tier || '—';
  rows.push({ label: 'Tier', valueA: tA, valueB: tB, diff: diffType(tA, tB) });

  // Experience level
  const expA = configA.suggestedExperienceLevel || '—';
  const expB = configB.suggestedExperienceLevel || '—';
  rows.push({ label: 'Experience Level', valueA: expA, valueB: expB, diff: diffType(expA, expB) });

  // Scoring rules
  const allRuleNames = new Set<string>();
  (configA.scoring || []).forEach((r: any) => allRuleNames.add(r.ruleName));
  (configB.scoring || []).forEach((r: any) => allRuleNames.add(r.ruleName));

  for (const name of allRuleNames) {
    const rA = (configA.scoring || []).find((r: any) => r.ruleName === name);
    const rB = (configB.scoring || []).find((r: any) => r.ruleName === name);
    const wA = rA ? `${Math.round(rA.weight * 100)}%` : '—';
    const wB = rB ? `${Math.round(rB.weight * 100)}%` : '—';
    rows.push({
      label: RULE_ABBREV[name] || displayRuleName(name),
      valueA: wA, valueB: wB,
      diff: diffType(wA, wB),
    });
    // Penalty factor if different
    if (rA?.penaltyFactor || rB?.penaltyFactor) {
      const pA = String(rA?.penaltyFactor ?? 0);
      const pB = String(rB?.penaltyFactor ?? 0);
      if (pA !== pB) {
        rows.push({ label: '  penalty', valueA: pA, valueB: pB, diff: 'changed' });
      }
    }
  }

  const diffCount = rows.filter(r => r.diff !== 'same').length;

  // Color mapping: changed=yellow, added(only-b)=green, deleted(only-a)=red, same=dim
  const rowBg = (d: DiffType) => d === 'changed' ? `${C.yellow}10` : d === 'only-a' ? `${C.red}10` : d === 'only-b' ? `${C.green}10` : 'transparent';
  const labelColor = (d: DiffType) => d === 'changed' ? C.yellow : d === 'only-a' ? C.red : d === 'only-b' ? C.green : C.textDim;
  const valColorA = (d: DiffType) => d === 'changed' ? C.yellow : d === 'only-a' ? C.red : d === 'same' ? C.textDim : C.textDim;
  const valColorB = (d: DiffType) => d === 'changed' ? C.yellow : d === 'only-b' ? C.green : d === 'same' ? C.textDim : C.textDim;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', borderBottom: `2px solid ${C.border}`, marginBottom: 4 }}>
        <div style={{ width: 160, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase' }}>Field</div>
        <div style={{ flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.accent }}>{labelA}</div>
        <div style={{ flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.purple }}>{labelB}</div>
        <div style={{ width: 60, padding: '8px 8px', fontSize: 11, fontWeight: 700, color: C.textDim, textAlign: 'center' as const }}>Status</div>
      </div>
      {/* Rows */}
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'flex', borderBottom: `1px solid ${C.border}`,
          background: rowBg(row.diff),
        }}>
          <div style={{ width: 160, padding: '6px 12px', fontSize: 12, color: labelColor(row.diff), fontWeight: row.diff !== 'same' ? 600 : 400 }}>{row.label}</div>
          <div style={{ flex: 1, padding: '6px 12px', fontSize: 12, color: valColorA(row.diff), fontWeight: row.diff !== 'same' ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
            {row.valueA}
          </div>
          <div style={{ flex: 1, padding: '6px 12px', fontSize: 12, color: valColorB(row.diff), fontWeight: row.diff !== 'same' ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
            {row.valueB}
          </div>
          <div style={{ width: 60, padding: '6px 8px', fontSize: 10, textAlign: 'center' as const, color: labelColor(row.diff), fontWeight: 600 }}>
            {row.diff === 'changed' ? '\u0394' : row.diff === 'only-a' ? '\u2212' : row.diff === 'only-b' ? '+' : ''}
          </div>
        </div>
      ))}
      {/* Summary */}
      <div style={{ padding: '10px 12px', fontSize: 12, color: C.textMuted, display: 'flex', gap: 12 }}>
        <span>{diffCount} difference{diffCount !== 1 ? 's' : ''}</span>
        {rows.some(r => r.diff === 'changed') && <span style={{ color: C.yellow }}>{'\u0394'} Changed</span>}
        {rows.some(r => r.diff === 'only-b') && <span style={{ color: C.green }}>+ Added</span>}
        {rows.some(r => r.diff === 'only-a') && <span style={{ color: C.red }}>{'\u2212'} Removed</span>}
      </div>
    </div>
  );
}

function AnalyticsTab({ kpis, detail, selectedKpi, onSelectKpi, loading, experienceLevel = 'novice' as ExperienceLevel, onNavigateToCase, tasks = [], onNavigateToConflicts }: {
  kpis: any[];
  detail: any;
  selectedKpi: string | null;
  onSelectKpi: (key: string) => void;
  loading: boolean;
  experienceLevel?: ExperienceLevel;
  onNavigateToCase?: (caseKey: string) => void;
  tasks?: any[];
  onNavigateToConflicts?: () => void;
}) {
  // No-solve state
  if (kpis.length === 0 && !loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <Card style={{ textAlign: 'center', maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 8 }}>No Analytics Yet</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>
            Run <strong>{t('solve', 'Build Schedule')}</strong> to see analytics and KPIs.
          </div>
        </Card>
      </div>
    );
  }

  // Infeasibility KPI — computed from tasks
  const infeasibleCount = tasks.filter((t: any) => !t.feasible && t.infeasibilityReport).length;
  const allKpis = [
    ...kpis,
    {
      key: 'infeasibility',
      group: 'Scheduling',
      name: 'Infeasibility Analysis',
      value: infeasibleCount,
      unit: 'tasks',
      status: infeasibleCount === 0 ? 'good' : 'warning',
    },
  ];

  // Group KPIs
  const groups = new Map<string, any[]>();
  for (const kpi of allKpis) {
    if (!groups.has(kpi.group)) groups.set(kpi.group, []);
    groups.get(kpi.group)!.push(kpi);
  }

  // Determine selected KPI's group for detail view
  const selectedKpiObj = allKpis.find((k) => k.key === selectedKpi);
  const selectedGroup = selectedKpiObj?.group;

  // Find group data in detail response
  let detailContent: React.ReactNode = null;
  if (loading) {
    detailContent = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: C.textMuted }}>
        Loading...
      </div>
    );
  } else if (selectedKpi === 'infeasibility') {
    const summary = buildBottleneckSummary(tasks);
    const recs = generateRecommendations(summary);
    const infeasibleTasks = tasks.filter((t: any) => !t.feasible && t.infeasibilityReport);
    detailContent = (
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16 }}>
          Infeasibility Analysis — {infeasibleCount} task{infeasibleCount !== 1 ? 's' : ''} infeasible
        </div>

        {/* Conflict Type Breakdown */}
        {infeasibleTasks.length > 0 && (() => {
          const typeCounts = { availability: 0, capacity: 0, dependency: 0 };
          infeasibleTasks.forEach((t: any) => {
            const ct = t.infeasibilityReport?.conflictType || 'dependency';
            if (ct in typeCounts) typeCounts[ct as keyof typeof typeCounts]++;
          });
          return (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>By Conflict Type</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, maxWidth: 300 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Type</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ['\u26AB Availability', typeCounts.availability, '#9e9e9e'],
                    ['\uD83D\uDD34 Capacity', typeCounts.capacity, '#f44336'],
                    ['\uD83D\uDD17 Dependency', typeCounts.dependency, '#ff9800'],
                  ] as [string, number, string][]).map(([label, count, color]) => (
                    <tr key={label} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '6px 8px', color, fontWeight: 500 }}>{label}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', color: C.text }}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Bottleneck Summary Table */}
        {summary.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Bottleneck Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Resource Type</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Count</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Blocked By</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.resourceType} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px', color: C.text, fontWeight: 500 }}>{s.resourceType}</td>
                    <td style={{ padding: '6px 8px', color: C.text, textAlign: 'center' }}>{s.count}</td>
                    <td style={{ padding: '6px 8px', color: C.textMuted, fontSize: 11 }}>{s.blockedBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Affected Chains/Tasks Table */}
        {infeasibleTasks.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Affected Tasks</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Chain</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Task</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: C.textMuted, fontWeight: 600 }}>Bottleneck</th>
                </tr>
              </thead>
              <tbody>
                {infeasibleTasks.map((t: any) => {
                  const ct = t.infeasibilityReport?.conflictType || 'dependency';
                  const ctColor = ct === 'availability' ? '#9e9e9e' : ct === 'capacity' ? '#f44336' : '#ff9800';
                  return (
                  <tr key={t.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px', color: C.accent, fontWeight: 500 }}>{t.orderRef || '—'}</td>
                    <td style={{ padding: '6px 8px', color: C.text }}>{t.name}</td>
                    <td style={{ padding: '6px 8px', color: ctColor, fontWeight: 500, fontSize: 11, textTransform: 'capitalize' }}>{ct}</td>
                    <td style={{ padding: '6px 8px', color: '#f44336', fontWeight: 500 }}>
                      {t.infeasibilityReport.bottleneckSlot || '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Recommendations */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>Recommendations</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: C.textMuted, lineHeight: 1.8 }}>
            {recs.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>

        {/* View in Conflicts link */}
        {onNavigateToConflicts && infeasibleCount > 0 && (
          <button
            onClick={onNavigateToConflicts}
            style={{
              background: 'none', border: `1px solid ${C.accent}`, borderRadius: 6,
              color: C.accent, padding: '6px 16px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT,
            }}
          >
            View in Conflicts →
          </button>
        )}
      </div>
    );
  } else if (selectedGroup === 'Utilization' && detail) {
    // Find the utilization group matching selected KPI
    const slug = selectedKpi ?? '';
    const hierarchy = slug.replace(/-utilization$/, '').replace(/-/g, ' ');
    const group = detail.groups?.find((g: any) => g.hierarchy.toLowerCase().replace(/[^a-z0-9]+/g, ' ') === hierarchy);
    detailContent = <UtilizationDetail data={{ ...group, bottleneck: detail.bottleneck }} experienceLevel={experienceLevel} />;
  } else if (selectedGroup === 'Scheduling' && detail) {
    detailContent = <SchedulingDetail data={detail} experienceLevel={experienceLevel} />;
  } else if (selectedGroup === 'Chain Integrity' && detail) {
    detailContent = <ChainDetail data={detail} experienceLevel={experienceLevel} onNavigateToCase={onNavigateToCase} />;
  } else if (selectedGroup === 'Critical Path' && detail) {
    detailContent = <CriticalPathDetail data={detail} experienceLevel={experienceLevel} onTaskClick={(key) => {
      const task = tasks.find((t: any) => t.key === key);
      if (task) onNavigateToCase?.(key);
    }} />;
  } else if (selectedGroup === 'Cost' && detail) {
    detailContent = <CostDetail data={detail} experienceLevel={experienceLevel} />;
  } else if (selectedKpi && !detail) {
    detailContent = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: C.textMuted }}>
        Select a KPI to view details
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 200px)' }}>
      {/* Left Panel — KPI Catalog */}
      <div style={{
        width: 280, borderRight: `1px solid ${C.border}`, overflowY: 'auto',
        background: C.surface, borderRadius: '8px 0 0 8px', flexShrink: 0,
      }}>
        {[...groups.entries()].map(([groupName, groupKpis]) => (
          <div key={groupName}>
            <div style={{
              padding: '10px 16px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.8,
              color: C.textDim, borderBottom: `1px solid ${C.border}`,
            }}>
              {groupName}
            </div>
            {groupKpis.map((kpi: any) => (
              <div
                key={kpi.key}
                onClick={() => onSelectKpi(kpi.key)}
                style={{
                  padding: '8px 16px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: selectedKpi === kpi.key ? `${C.accent}10` : 'transparent',
                  borderLeft: selectedKpi === kpi.key ? `3px solid ${C.accent}` : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { if (selectedKpi !== kpi.key) e.currentTarget.style.background = `${C.text}08`; }}
                onMouseLeave={(e) => { if (selectedKpi !== kpi.key) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 12, color: C.text }}>{kpi.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.text }}>
                    {formatKpiValue(kpi)}
                  </span>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: kpi.status === 'good' ? '#4caf50' : kpi.status === 'warning' ? '#ff9800' : '#f44336',
                  }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Right Panel — Detail View */}
      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {selectedKpiObj && (
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: C.text }}>
            {selectedKpiObj.name}
          </h3>
        )}
        {detailContent || (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: C.textDim, fontSize: 13 }}>
            Select a KPI from the catalog to view details
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CHAT PANEL — AI SCHEDULING ASSISTANT
   ═══════════════════════════════════════════════════════════════ */

type ChatActionType = 'whereTo' | 'openTask' | 'openResource' | 'filterChain' | 'openTab' | 'navigateOrder' | 'applyFix';

interface ChatAction {
  type: ChatActionType;
  label: string;
  taskKey?: string;
  resourceKey?: string;
  chainKey?: string;
  orderKey?: string;
  tab?: string;
  startAfter?: string;
  startBefore?: string;
  recId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  loading?: boolean;
  toolCallInProgress?: string;
  actions?: ChatAction[];
}

function parseActionsFromText(text: string): { cleanText: string; actions: ChatAction[] } {
  const actions: ChatAction[] = [];
  const actionRegex = /<action\s+([^/]+)\/>/g;
  let match;

  while ((match = actionRegex.exec(text)) !== null) {
    const attrStr = match[1];
    const get = (name: string) => {
      const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrStr);
      return m ? m[1] : undefined;
    };
    const type = get('type') as ChatActionType | undefined;
    const label = get('label');
    if (type && label) {
      actions.push({
        type,
        label,
        taskKey: get('taskKey'),
        resourceKey: get('resourceKey'),
        chainKey: get('chainKey'),
        orderKey: get('orderKey'),
        tab: get('tab'),
        startAfter: get('startAfter'),
        startBefore: get('startBefore'),
        recId: get('recId'),
      });
    }
  }

  const cleanText = text.replace(actionRegex, '').trim();
  return { cleanText, actions };
}

// ═══ CTP Option Card (collapsible) ═══
function CTPOptionCardInner({ option, isActive, isEarliest, completionDate, resourceChain, onSelect, onBook }: {
  option: any; isActive: boolean; isEarliest: boolean;
  completionDate: string; resourceChain: string;
  onSelect: () => void; onBook: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 16px', borderRadius: 8, marginBottom: 8, cursor: 'pointer',
        background: isActive ? `${C.accent}12` : C.bg,
        border: isActive ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Compact summary — always visible */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: C.textDim, fontWeight: 600, fontFamily: FONT }}>
              Option {option.rank}
            </span>
            {isEarliest && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8,
                background: C.greenDim, color: C.green, fontWeight: 600, fontFamily: FONT,
              }}>
                earliest
              </span>
            )}
            {isActive && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8,
                background: C.accentGlow, color: C.accent, fontWeight: 600, fontFamily: FONT,
              }}>
                viewing on Gantt
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2, fontFamily: FONT }}>
            Completes: {fmtDate(completionDate)}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2, fontFamily: FONT }}>
            {resourceChain}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: C.textDim, fontFamily: FONT }}>Score</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, fontFamily: FONT }}>
              {option.chainScore?.toFixed(2) ?? '\u2014'}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.textDim, fontSize: 14, padding: '4px',
            }}
            title={expanded ? 'Collapse detail' : 'Show task detail'}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onBook(); }}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: C.accent, color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            }}
          >
            Schedule
          </button>
        </div>
      </div>
      {/* Expanded task detail */}
      {expanded && (
        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: `1px solid ${C.border}`,
        }}>
          {option.tasks.map((task: any, i: number) => {
            const taskTypeLower = (task.taskType || '').toUpperCase();
            const isSetup = taskTypeLower === 'SETUP' || taskTypeLower === 'SET_UP';
            const isTeardown = taskTypeLower === 'TEAR_DOWN' || taskTypeLower === 'TEARDOWN';
            const typeLabel = isSetup ? 'Setup' : isTeardown ? 'Teardown' : 'Process';
            const typeBg = isSetup || isTeardown ? C.yellowDim : C.accentGlow;
            const typeColor = isSetup || isTeardown ? C.yellow : C.accent;
            return (
              <div key={i} style={{
                display: 'flex', gap: 12, padding: '4px 0',
                fontSize: 12, alignItems: 'baseline', fontFamily: FONT,
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                  width: 60, textAlign: 'center', flexShrink: 0,
                  background: typeBg, color: typeColor,
                }}>
                  {typeLabel}
                </span>
                <span style={{ color: C.text, flex: 1 }}>{task.taskName}</span>
                <span style={{ color: C.textMuted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {fmtDate(task.start)} \u2013 {fmtDate(task.end)}
                </span>
                <span style={{ color: C.textDim, fontSize: 11 }}>
                  {task.resources.map((r: any) => r.resourceName || r.resourceKey).join(', ')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══ CTP Query Form ═══
function CTPQueryForm({ templates, loading, onEvaluate }: {
  templates: any[];
  loading: boolean;
  onEvaluate: (sourceChainKey: string, orderName: string, priority?: number, needByDate?: string) => void;
}) {
  const [selectedChain, setSelectedChain] = useState(templates[0]?.chainKey || '');
  const [orderName, setOrderName] = useState('');
  const [needByDate, setNeedByDate] = useState('');

  // Update selected chain when templates load
  useEffect(() => {
    if (templates.length > 0 && !selectedChain) {
      setSelectedChain(templates[0].chainKey);
    }
  }, [templates, selectedChain]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, fontFamily: FONT, marginBottom: 4, display: 'block' }}>
          Based on (template chain):
        </label>
        <select
          value={selectedChain}
          onChange={e => setSelectedChain(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.surface, color: C.text,
            fontSize: 13, fontFamily: FONT,
          }}
        >
          {templates.length === 0 && <option value="">Loading templates...</option>}
          {templates.map((tpl: any) => (
            <option key={tpl.chainKey} value={tpl.chainKey}>
              {tpl.chainKey} — {tpl.name} ({tpl.taskCount} tasks, {tpl.totalDurationMinutes}min)
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, fontFamily: FONT, marginBottom: 4, display: 'block' }}>
          New order name:
        </label>
        <input
          type="text"
          value={orderName}
          onChange={e => setOrderName(e.target.value)}
          placeholder="e.g., Rush Order 500 units"
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.surface, color: C.text,
            fontSize: 13, fontFamily: FONT, boxSizing: 'border-box',
          }}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, fontFamily: FONT, marginBottom: 4, display: 'block' }}>
          Need by date (optional):
        </label>
        <input
          type="date"
          value={needByDate}
          onChange={e => setNeedByDate(e.target.value)}
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.surface, color: C.text,
            fontSize: 13, fontFamily: FONT, boxSizing: 'border-box',
            colorScheme: 'dark',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button
          onClick={() => {
            if (selectedChain && orderName.trim()) {
              onEvaluate(selectedChain, orderName.trim(), undefined, needByDate || undefined);
            }
          }}
          disabled={loading || !selectedChain || !orderName.trim()}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: !selectedChain || !orderName.trim() ? C.textDim : C.accent,
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: FONT, opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Evaluating...' : 'Evaluate'}
        </button>
      </div>
    </div>
  );
}

function buildSystemPrompt(solveResult: any, selectedTask?: any): string {
  if (!solveResult) return 'No schedule data available yet. Ask the planner to run a solve first.';
  const { summary, tasks, resourceUtilization, orders, terminology } = solveResult;
  const tl = (key: string, fallback: string) => terminology?.[key] || fallback;

  let prompt = `You are a scheduling assistant for a ${tl('applicationName', 'scheduling')} application.
You help planners understand the current schedule, investigate conflicts, and identify opportunities.

Answer concisely. Use specific task names, resource names, and times.
When citing data, reference the specific task or resource by name.
If you don't have enough information to answer, say so.

## Current Schedule Summary
- Total ${tl('task', 'task')}s: ${summary?.includedTasks ?? 0}
- Scheduled: ${summary?.scheduledTasks ?? 0}
- Infeasible: ${summary?.unscheduledTasks ?? 0}
- Feasibility rate: ${summary?.feasibilityRate ?? 0}%
- Horizon: ${summary?.horizonStart || '?'} to ${summary?.horizonEnd || '?'}
`;

  // Infeasible tasks with bottleneck details
  const infeasible = (tasks || []).filter((t: any) => !t.feasible && t.included);
  if (infeasible.length > 0) {
    prompt += `\n## Infeasible ${tl('task', 'Task')}s\n`;
    for (const task of infeasible) {
      prompt += `- ${task.key} (${task.name})`;
      if (task.windowStart || task.windowEnd) prompt += ` [window: ${task.windowStart || '?'} to ${task.windowEnd || '?'}]`;
      if (task.infeasibilityReport) {
        const rpt = task.infeasibilityReport;
        prompt += ` — [${rpt.conflictType || 'unknown'}] ${rpt.reason}`;
        const bottleneck = rpt.slots?.find((s: any) => s.isBottleneck);
        if (bottleneck) {
          prompt += `\n  Bottleneck: ${bottleneck.slotLabel}`;
          for (const res of bottleneck.resources || []) {
            prompt += `\n    ${res.resourceName}: ${res.status}`;
            if (res.availableMinutes !== undefined) prompt += ` (${res.availableMinutes}min free)`;
            if (res.note) prompt += ` — ${res.note}`;
            for (const bt of (res.blockingTasks || [])) {
              prompt += `\n      blocked by ${bt.taskName}${bt.chainKey ? ` (${bt.chainKey})` : ''} ${bt.start || ''}–${bt.end || ''}`;
            }
          }
        }
      } else {
        for (const err of (task.errors || [])) {
          prompt += `\n  Error: ${err.reason || err}`;
        }
      }
      prompt += '\n';
    }
  }

  // Scheduled tasks (summarized)
  const scheduled = (tasks || []).filter((t: any) => t.feasible);
  if (scheduled.length > 0) {
    prompt += `\n## Scheduled ${tl('task', 'Task')}s\n`;
    for (const task of scheduled) {
      const resources = (task.assignedResources || [])
        .map((r: any) => r.resourceName || r.resourceKey)
        .join(', ');
      prompt += `- ${task.key} (${task.name}): ${task.scheduledStart || '?'}–${task.scheduledEnd || '?'} on ${resources}`;
      if (task.orderRef) prompt += ` [${tl('order', 'Order')}: ${task.orderRef}]`;
      if (task.windowStart || task.windowEnd) prompt += ` [window: ${task.windowStart || '?'} to ${task.windowEnd || '?'}]`;
      if (task.isOnCriticalPath) prompt += ` [CRITICAL PATH]`;
      else if (task.slack !== undefined && task.slack < 1800) prompt += ` [near-critical, slack: ${Math.round(task.slack / 60)}min]`;
      prompt += '\n';
    }
  }

  // Resource utilization
  if (resourceUtilization?.length > 0) {
    prompt += `\n## Resource Utilization\n`;
    for (const res of resourceUtilization) {
      const freeHours = ((res.totalAvailable - res.totalAssigned) / 3600).toFixed(1);
      prompt += `- ${res.resourceName} (${res.resourceKey}): ${res.utilization?.toFixed(0) || 0}% utilized — ${freeHours}h free\n`;
    }
  }

  // Orders
  if (orders?.length > 0) {
    prompt += `\n## ${tl('order', 'Order')}s\n`;
    for (const order of orders) {
      prompt += `- ${order.orderKey} (${order.name}): ${order.scheduledQty}/${order.demandQty} filled`;
      if (order.dueDate) prompt += ` — due ${order.dueDate}`;
      prompt += ` — priority ${order.priority}`;
      prompt += '\n';
    }
  }

  // Chain integrity
  const chains = (tasks || []).filter((t: any) => t.orderRef).reduce((acc: Map<string, any[]>, t: any) => {
    if (!acc.has(t.orderRef)) acc.set(t.orderRef, []);
    acc.get(t.orderRef)!.push(t);
    return acc;
  }, new Map<string, any[]>());

  if (chains.size > 0) {
    prompt += `\n## Chain Integrity\n`;
    for (const [chainKey, chainTasks] of chains) {
      const sorted = chainTasks.sort((a: any, b: any) =>
        (a.scheduledStart || '').localeCompare(b.scheduledStart || '')
      );
      const allScheduled = sorted.every((t: any) => t.feasible);
      prompt += `- ${chainKey}: ${sorted.length} phases, ${allScheduled ? 'all scheduled' : 'has infeasible phases'}\n`;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].scheduledStart && sorted[i-1].scheduledEnd) {
          const gap = (new Date(sorted[i].scheduledStart).getTime() - new Date(sorted[i-1].scheduledEnd).getTime()) / 60000;
          if (gap > 0) {
            prompt += `  Gap: ${sorted[i-1].key} -> ${sorted[i].key}: ${gap.toFixed(0)} min\n`;
          }
        }
      }
    }
  }

  // Critical path
  if (solveResult.criticalPath) {
    const cp = solveResult.criticalPath;
    prompt += `\n## Critical Path Analysis\n`;
    prompt += `- Makespan: ${cp.makespanFormatted}\n`;
    prompt += `- Bottleneck resource: ${cp.bottleneckResource?.resourceName} (${cp.bottleneckResource?.percentOfCriticalPath}% of critical path)\n`;
    prompt += `- ${cp.criticalTasks} of ${cp.totalTasks} tasks are on the critical path\n`;
    prompt += `- ${cp.nearCriticalTasks ?? 0} tasks are near-critical (< 30min slack)\n`;
    if (cp.segments?.length > 0) {
      prompt += `- Critical path flows through: ${cp.segments.map((s: any) => s.resourceName || s.resourceKey).join(' → ')}\n`;
    }
  }

  // Solve stats
  if (solveResult.stats) {
    prompt += `\n## Solve Statistics\n`;
    prompt += `- Strategy: ${solveResult.stats.strategy}\n`;
    if (solveResult.stats.totalTimeMs) prompt += `- Solve time: ${solveResult.stats.totalTimeMs}ms\n`;
  }

  // Selected task context
  if (selectedTask) {
    prompt += `\n## Currently Selected Task\n`;
    prompt += `The planner is currently looking at: ${selectedTask.name} (${selectedTask.key})\n`;
    if (selectedTask.windowStart || selectedTask.windowEnd) {
      prompt += `Scheduling window: ${selectedTask.windowStart || '?'} to ${selectedTask.windowEnd || '?'}\n`;
      prompt += `(This task can ONLY be scheduled within this window. If the planner asks why it wasn't scheduled on a particular day, check if that day falls within this window.)\n`;
    }
    if (selectedTask.feasible) {
      prompt += `Status: Scheduled ${selectedTask.scheduledStart}–${selectedTask.scheduledEnd}\n`;
    } else {
      prompt += `Status: Infeasible\n`;
      if (selectedTask.infeasibilityReport) {
        prompt += `Conflict type: ${selectedTask.infeasibilityReport.conflictType}\n`;
        prompt += `Reason: ${selectedTask.infeasibilityReport.reason}\n`;
      }
    }
  }

  // Tool usage guidance
  prompt += `\n## Tools Available\n`;
  prompt += `You have tools to investigate the schedule further:\n`;
  prompt += `- where_can_task_go: Find feasible placement options for a task (calls WhereTo). Use this whenever the planner asks to reschedule, move, or find a new time for a specific task — especially when they specify a time constraint like "weeknights", "before Friday", "not on Sunday", or "sometime next week". Pass startAfter and startBefore constraints to narrow the window. This tool handles all required resources simultaneously — field + umpire + staff — so prefer it over chaining multiple find_available_resources calls when rescheduling a known task.\n`;
  prompt += `  Examples that should trigger this tool:\n`;
  prompt += `    "When can I reschedule GAME-042 to a weeknight?" → where_can_task_go(task_key="GAME-042", startAfter="Monday 5pm", startBefore="Friday 9pm")\n`;
  prompt += `    "Can CASE-004 be moved to later this week?" → where_can_task_go(task_key="C004-PROC", startAfter="now", startBefore="Friday 6pm")\n`;
  prompt += `- get_resource_agenda: See a resource's full day (assignments + gaps)\n`;
  prompt += `- get_chain_detail: See all phases of a case/order chain\n`;
  prompt += `- analyze_impact: See what happens if a task/chain is unscheduled\n`;
  prompt += `- find_available_resources: Search for free resources in a time window\n`;
  prompt += `- compare_tasks: Compare multiple tasks side by side\n`;
  prompt += `- query_resources: Find resources by attribute (lights, surface, park, certification, capability, etc.)\n`;
  prompt += `- evaluate_new_order: Stateless CTP query — evaluate when a new order can be scheduled by cloning an existing chain. Use when the planner asks "when can I schedule a new...", "can I fit another...", "where can I add...". The schedule is NOT modified.\n`;
  prompt += `- get_critical_path: Get the critical path analysis — bottleneck resource, critical segments, slack distribution. Use when the planner asks about makespan, bottlenecks, schedule length, or what is driving the timeline.\n`;
  prompt += `- diagnose_tasks: Analyze why tasks are infeasible and get ranked fix recommendations with tradeoffs. Use when the planner asks "why can't X schedule?", "what's wrong with X?", "how can I fix X?". Returns root cause + actionable options.\n`;
  prompt += `\n## Diagnosing and Fixing Problems\n`;
  prompt += `When the planner asks about infeasible tasks or how to fix them:\n`;
  prompt += `1. Call diagnose_tasks to get root causes AND fix recommendations in ONE step\n`;
  prompt += `2. Explain the root cause in plain language — why it can't schedule, which resources are blocked, by whom\n`;
  prompt += `3. Present 2-3 options conversationally with tradeoffs\n`;
  prompt += `4. Include an action button for each option: <action type="applyFix" recId="recommendation-id" label="Apply: description" />\n`;
  prompt += `5. The user clicks a button to apply — you do NOT execute the fix yourself\n`;
  prompt += `6. After the user clicks, the UI executes the fix and refreshes the schedule automatically\n`;
  prompt += `You CANNOT apply fixes yourself. Present the options with action buttons and let the user click to execute.\n`;
  prompt += `When the user says "fix it" or "apply option 1", respond with the appropriate action button so they can click it.\n`;
  prompt += `Do NOT say "I'll apply that now" — say "Click the button below to apply:" and include the action tag.\n`;
  prompt += `Example:\n`;
  prompt += `  "EQ-003 can't schedule because Jack P. is fully booked. I see two options:\n`;
  prompt += `  1. **Move to Luke** ($55/hr, standard TIG) — available Tuesday afternoon\n`;
  prompt += `  <action type="applyFix" recId="move-EQ003-abc" label="Apply: Move to Luke" />\n`;
  prompt += `  2. **Extend window 1 day** — Jack has a slot Wednesday morning\n`;
  prompt += `  <action type="applyFix" recId="window-EQ003-1d" label="Apply: Extend window 1 day" />\n`;
  prompt += `  Which would you prefer?"\n`;
  prompt += `\n## Attribute Questions — Where to Look\n`;
  prompt += `Task attributes (sport, division, homeTeam, phase, procedureType, operation, etc.) are already in the schedule summary above. Answer task attribute questions directly from context — do NOT call query_resources for tasks.\n`;
  prompt += `Resource attributes (lighting, surface, park, certification, capability, fencing, etc.) are NOT in the schedule summary. Always call query_resources for questions about resource properties.\n`;
  prompt += `Examples:\n`;
  prompt += `  "Which games are baseball?" → answer from task context (sport on tasks)\n`;
  prompt += `  "Which fields have lights?" → call query_resources (lightingAvailable on resources)\n`;
  prompt += `  "Which cases are cardiology?" → answer from task context (procedureType on tasks)\n`;
  prompt += `  "Which ORs have laparoscopic equipment?" → call query_resources (capability on resources)\n`;
  prompt += `\nRescheduling a specific task to a different time window → where_can_task_go with startAfter/startBefore constraints. Do NOT use find_available_resources for this — it only checks one resource at a time. where_can_task_go checks all required resources simultaneously and returns ranked feasible slots.\n`;
  prompt += `\n## CTP Query — Scheduling New Orders\n`;
  prompt += `When the planner asks about scheduling a NEW order (not rescheduling an existing one):\n`;
  prompt += `1. Identify which existing chain to use as a template. Match by procedure type, category, or ask the user. Use get_chain_detail to inspect chain structures if needed.\n`;
  prompt += `2. Call evaluate_new_order with the source chain key and order name.\n`;
  prompt += `3. If the user mentions a deadline ("by Friday", "need it by March 20", "end of week"), convert to ISO date and pass as need_by_date.\n`;
  prompt += `4. Present the ranked options with dates, times, and resources. If promise status is returned, show it prominently (e.g., "6 days early", "2 days late").\n`;
  prompt += `If the user specifies preferences ("with Dr. Patel" or "on Monday"), pass them as preferred_surgeon.\n`;
  prompt += `\n## Task Scheduling Windows\n`;
  prompt += `Some tasks have a scheduling window [window: start to end] shown in brackets. This restricts when the task can be placed.\n`;
  prompt += `If a planner asks "why wasn't X scheduled on Monday?" or similar, first check the task's scheduling window. If Monday falls outside the window, explain that clearly — e.g., "The scheduling window for this task doesn't start until 11:00 PM Monday night, so Tuesday is the earliest workday it can be placed."\n`;
  prompt += `Convert window times to the local timezone the planner would understand.\n`;

  prompt += `\n## Time Window Resolution\n`;
  prompt += `When the planner uses relative time expressions, resolve them to ISO 8601 datetimes before passing to any tool. Use the schedule horizon dates above as reference.\n`;
  prompt += `  "weeknight" or "weekday evening" → startAfter: nearest Monday at 17:00, startBefore: nearest Friday at 21:00\n`;
  prompt += `  "next week" → startAfter: next Monday at 00:00, startBefore: next Sunday at 23:59\n`;
  prompt += `  "this weekend" → startAfter: nearest Saturday at 00:00, startBefore: nearest Sunday at 23:59\n`;
  prompt += `  "before Friday" → startBefore: this Friday at 00:00\n`;
  prompt += `  "after Wednesday" → startAfter: this Wednesday at 23:59\n`;
  prompt += `  "Monday night" → startAfter: Monday at 17:00, startBefore: Monday at 22:00\n`;
  prompt += `  "morning" → startAfter: day at 06:00, startBefore: day at 12:00\n`;
  prompt += `  "afternoon" → startAfter: day at 12:00, startBefore: day at 17:00\n`;
  prompt += `Always use the horizon start/end dates from the schedule summary to determine which Monday/Friday/etc. is "nearest".\n`;
  prompt += `\nUse tools when the planner's question requires fresher or more detailed data than what's in the schedule summary above. For simple questions about the current state, answer from the summary directly without calling tools.\n`;
  prompt += `\nAlways explain tool results in plain language. Don't just dump raw data — interpret it, highlight the key finding, and suggest next steps when appropriate.\n`;

  // UI Action tags
  prompt += `\n## UI Actions\n`;
  prompt += `After your response text, you may emit action tags to surface relevant UI navigation as clickable buttons for the planner. Use them when your answer references something specific the planner would benefit from seeing or acting on immediately.\n\n`;
  prompt += `Available actions:\n`;
  prompt += `  <action type="whereTo" taskKey="C004-PROC" label="Show options on Gantt" />\n`;
  prompt += `  <action type="whereTo" taskKey="GAME-042" startAfter="2026-06-08T17:00:00" startBefore="2026-06-12T21:00:00" label="Show weeknight options" />\n`;
  prompt += `  — Triggers WhereTo ghost bars for the task. Use after answering "where can X go?"\n`;
  prompt += `  When emitting a whereTo action after answering a time-constrained rescheduling question, always include the same startAfter and startBefore values you used in the where_can_task_go tool call. This ensures the Gantt shows the same options the AI described — not the global top 5.\n\n`;
  prompt += `  <action type="openTask" taskKey="C004-PROC" label="Open CASE-004 detail" />\n`;
  prompt += `  — Opens the task detail panel. Use when discussing a specific task's details.\n\n`;
  prompt += `  <action type="openResource" resourceKey="AN-JONES" label="View AN-JONES schedule" />\n`;
  prompt += `  — Opens the resource detail panel. Use when discussing a specific resource.\n\n`;
  prompt += `  <action type="filterChain" chainKey="CASE-004" label="Show CASE-004 on Schedule" />\n`;
  prompt += `  — Filters the Schedule tab to show only this chain. Use for chain-level questions.\n\n`;
  prompt += `  <action type="openTab" tab="Analytics" label="Go to Analytics" />\n`;
  prompt += `  — Switches to a tab. Valid tabs: Overview, Schedule, Orders, Conflicts, Materials, Analytics\n\n`;
  prompt += `  <action type="navigateOrder" orderKey="WO-1004" label="View WO-1004 in Orders" />\n`;
  prompt += `  — Goes to the Orders tab filtered to this order.\n\n`;
  prompt += `Rules:\n`;
  prompt += `- Emit at most 2-3 actions per response — don't overwhelm with buttons\n`;
  prompt += `- Only emit actions directly relevant to what you just explained\n`;
  prompt += `- Always include a clear, short label (max 5 words)\n`;
  prompt += `- Never emit actions for hypothetical or speculative scenarios\n`;
  prompt += `- Place action tags at the very end of your response text\n`;

  return prompt;
}

function getSuggestedQuestions(solveResult: any): string[] {
  if (!solveResult) return ['Run a solve first to get schedule data'];
  const suggestions: string[] = [];
  const { summary, tasks } = solveResult;

  suggestions.push('Give me a summary of the current schedule');

  const infeasible = (tasks || []).filter((t: any) => !t.feasible && t.included);
  if (infeasible.length > 0) {
    suggestions.push(`Why ${infeasible.length === 1 ? 'is' : 'are'} ${infeasible.length} task${infeasible.length > 1 ? 's' : ''} infeasible?`);
    if (infeasible[0]?.infeasibilityReport?.bottleneckSlot) {
      suggestions.push(`Tell me about the ${infeasible[0].infeasibilityReport.bottleneckSlot} bottleneck`);
    }
  }

  if (summary?.feasibilityRate < 100) {
    suggestions.push('What would it take to get to 100% feasibility?');
  }

  suggestions.push('Which resource has the most availability?');

  return suggestions.slice(0, 4);
}

// ═══ AI Tool Definitions ═══
const AI_TOOLS = [
  {
    name: 'where_can_task_go',
    description: 'Find feasible scheduling options for a task. Returns ranked placement options with resources, start/end times, and scores. Use when the planner asks where a task can be placed, what options exist, how to resolve an infeasible task, or to reschedule/move a task to a different time. Supports time constraints to narrow the search window.',
    input_schema: { type: 'object' as const, properties: { task_key: { type: 'string' as const, description: 'The task key (e.g., "C004-PROC")' }, start_after: { type: 'string' as const, description: 'Optional: only show options starting after this time (ISO datetime). Use for "after Monday", "weeknight", "later this week".' }, start_before: { type: 'string' as const, description: 'Optional: only show options starting before this time (ISO datetime). Use for "before Friday", "this week", "by Wednesday".' } }, required: ['task_key'] },
  },
  {
    name: 'get_resource_agenda',
    description: "Get a resource's daily schedule showing all assignments, available gaps, and off-shift periods. Use when the planner asks about a specific resource's availability or what's booked on a resource.",
    input_schema: { type: 'object' as const, properties: { resource_key: { type: 'string' as const, description: 'The resource key (e.g., "OR-01", "AN-JONES")' }, date: { type: 'string' as const, description: 'Optional date (ISO format). Defaults to first horizon day.' } }, required: ['resource_key'] },
  },
  {
    name: 'get_chain_detail',
    description: 'Get detailed information about a chain (case/order) including all phases, scheduled times, gaps between phases, and resource assignments.',
    input_schema: { type: 'object' as const, properties: { chain_key: { type: 'string' as const, description: 'The chain/order key (e.g., "CASE-002")' } }, required: ['chain_key'] },
  },
  {
    name: 'analyze_impact',
    description: 'Analyze the impact of unscheduling a task or chain. Shows which resources would be freed, which infeasible tasks might benefit, and chain disruptions.',
    input_schema: { type: 'object' as const, properties: { task_key: { type: 'string' as const, description: 'The task key or chain key to analyze' } }, required: ['task_key'] },
  },
  {
    name: 'find_available_resources',
    description: 'Find resources with availability in a given time window. Use when the planner asks which resources are free or needs to find capacity.',
    input_schema: { type: 'object' as const, properties: { start_time: { type: 'string' as const, description: 'Start of search window (ISO datetime)' }, end_time: { type: 'string' as const, description: 'End of search window (ISO datetime)' }, resource_group: { type: 'string' as const, description: 'Optional filter by resource group/work center' }, min_duration_minutes: { type: 'number' as const, description: 'Minimum contiguous availability needed (default 30)' } }, required: ['start_time', 'end_time'] },
  },
  {
    name: 'compare_tasks',
    description: 'Compare two or more tasks side by side showing resources, timing, priority, scores, and conflicts.',
    input_schema: { type: 'object' as const, properties: { task_keys: { type: 'array' as const, items: { type: 'string' as const }, description: 'Array of task keys to compare' } }, required: ['task_keys'] },
  },
  {
    name: 'query_resources',
    description: 'Query RESOURCES by their typed attributes — physical properties, capabilities, certifications, location. Use when the planner asks which resources have a certain characteristic: lights, surface type, park location, sport type, certification level, fencing, capacity, machine capability, etc. Returns matching resources with full hierarchy and optional availability data. Can filter availability to a specific time window. Do NOT use this for task/game/operation questions — task attributes are already in context.',
    input_schema: { type: 'object' as const, properties: { attribute: { type: 'string' as const, description: 'The attribute name to filter on (e.g. "lightingAvailable", "surface", "park", "certificationLevel", "sport", "fenced", "capability")' }, value: { type: 'string' as const, description: 'Optional value to match. For booleans use "true" or "false". For enums use the enum value. Omit to return all resources that HAVE this attribute regardless of value.' }, include_availability: { type: 'boolean' as const, description: 'Set true to include current utilization and available minutes for each matching resource.' }, start_time: { type: 'string' as const, description: 'Optional: filter availability to this window start (ISO datetime). Use with end_time for time-specific queries like "Monday night".' }, end_time: { type: 'string' as const, description: 'Optional: filter availability to this window end (ISO datetime). Use with start_time.' } }, required: ['attribute'] },
  },
  {
    name: 'evaluate_new_order',
    description: 'Evaluate when a new order can be scheduled by cloning an existing chain\'s structure. Returns ranked placement options without changing the current schedule. Use when the user asks "when can I schedule...", "can I fit...", "where can I add...".',
    input_schema: { type: 'object' as const, properties: { source_chain_key: { type: 'string' as const, description: 'Key of an existing chain to use as template (e.g., "C001"). If the user says a procedure name, find a matching chain first.' }, order_name: { type: 'string' as const, description: 'Name for the new order (e.g., "Johnson Knee Replacement")' }, preferred_surgeon: { type: 'string' as const, description: 'Optional: preferred surgeon/primary resource key' }, need_by_date: { type: 'string' as const, description: 'Customer need-by date (ISO format, e.g., "2026-03-20"). If the user says "by Friday" or "need it March 20", convert to a date.' } }, required: ['source_chain_key', 'order_name'] },
  },
  {
    name: 'get_critical_path',
    description: 'Get the critical path analysis showing which tasks and resources drive the makespan. Returns the bottleneck resource, critical path segments, per-resource contribution, and slack distribution. Use when the user asks about makespan, bottlenecks, schedule length, or what is driving the timeline.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
  {
    name: 'diagnose_tasks',
    description: 'Analyze why tasks are infeasible and get ranked fix recommendations with tradeoffs. Returns root cause classification, blocking tasks, and actionable recommendations (move resource, expand window, bump lower priority, change strategy). Use when the planner asks why something won\'t schedule, what\'s blocking a task, or how to fix infeasibilities.',
    input_schema: { type: 'object' as const, properties: { task_keys: { type: 'array' as const, items: { type: 'string' as const }, description: 'Task keys to diagnose. Leave empty to diagnose all infeasible tasks.' } }, required: [] as string[] },
  },
];

// ═══ AI Tool Implementations ═══
async function executeWhereTo(taskKey: string, startAfter?: string, startBefore?: string): Promise<string> {
  try {
    const body: any = {};
    if (startAfter || startBefore) {
      body.constraints = {};
      if (startAfter) body.constraints.startAfter = startAfter;
      if (startBefore) body.constraints.startBefore = startBefore;
    }
    const data = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/where-to`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!data.options || data.options.length === 0) {
      return `No feasible options found for ${taskKey}.${data.reason ? ` Reason: ${data.reason}` : ''}`;
    }
    let result = `Found ${data.options.length} options for ${data.taskName || taskKey}:\n\n`;
    for (const opt of data.options) {
      const resources = (opt.resources || []).map((r: any) => r.resourceName || r.resourceKey).join(', ');
      result += `Option ${opt.rank}: ${resources}\n`;
      result += `  Time: ${opt.start} – ${opt.end}\n`;
      result += `  Score: ${opt.score?.toFixed(2) || 'N/A'}`;
      if (opt.isBestOnResource) result += ' ★ Best on this resource';
      result += '\n\n';
    }
    if (data.currentAssignment) {
      result += `Currently assigned: ${(data.currentAssignment.resources || []).join(', ')} at ${data.currentAssignment.start}–${data.currentAssignment.end}\n`;
    }
    return result;
  } catch (err: any) {
    return `Error looking up options for ${taskKey}: ${err.message}`;
  }
}

function executeResourceAgenda(resourceKey: string, date: string | undefined, solveResult: any): string {
  const resources = solveResult?.resourceUtilization || [];
  const resource = resources.find((r: any) =>
    r.resourceKey === resourceKey ||
    r.resourceKey.toLowerCase() === resourceKey.toLowerCase() ||
    r.resourceName.toLowerCase().includes(resourceKey.toLowerCase())
  );
  if (!resource) {
    return `Resource "${resourceKey}" not found. Available: ${resources.map((r: any) => `${r.resourceName} (${r.resourceKey})`).join(', ')}`;
  }

  let result = `${resource.resourceName} (${resource.resourceKey})\nUtilization: ${resource.utilization?.toFixed(0) || 0}%\nWork Center: ${resource.workCenter || 'N/A'}\n\n`;

  // Find tasks assigned to this resource
  const assignedTasks = (solveResult.tasks || []).filter((t: any) =>
    t.feasible && (t.assignedResources || []).some((r: any) => r.resourceKey === resource.resourceKey)
  ).sort((a: any, b: any) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

  const filterByDate = (items: any[]) => {
    if (!date) return items;
    return items.filter((t: any) => t.scheduledStart?.startsWith(date));
  };

  const dayTasks = filterByDate(assignedTasks);
  if (dayTasks.length > 0) {
    result += 'Assignments:\n';
    for (const t of dayTasks) {
      result += `  ${t.scheduledStart} – ${t.scheduledEnd}: ${t.name} (${t.key})${t.orderRef ? ` [${t.orderRef}]` : ''}\n`;
    }
  }

  // Net available gaps
  const dayAvailable = (resource.netAvailable || []).filter((a: any) => !date || a.start?.startsWith(date));
  if (dayAvailable.length > 0) {
    result += '\nAvailable gaps:\n';
    for (const a of dayAvailable) {
      const durMin = Math.round((a.durationSec || 0) / 60);
      result += `  ${a.start} – ${a.end}: ${durMin} min free\n`;
    }
  }

  if (dayTasks.length === 0 && dayAvailable.length === 0) result += 'No data for this date.\n';
  return result;
}

function executeChainDetail(chainKey: string, solveResult: any): string {
  const chainTasks = (solveResult.tasks || [])
    .filter((t: any) => t.orderRef === chainKey)
    .sort((a: any, b: any) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));
  if (chainTasks.length === 0) {
    const available = [...new Set((solveResult.tasks || []).map((t: any) => t.orderRef).filter(Boolean))];
    return `Chain "${chainKey}" not found. Available: ${available.join(', ')}`;
  }
  const order = (solveResult.orders || []).find((o: any) => o.orderKey === chainKey);
  let result = `Chain: ${chainKey}`;
  if (order) result += ` — ${order.name} (Priority ${order.priority})`;
  result += `\nPhases: ${chainTasks.length}\n\n`;

  let prevEnd: string | null = null;
  for (const task of chainTasks) {
    const status = task.feasible ? '✓ Scheduled' : '✗ Infeasible';
    const resources = (task.assignedResources || []).map((r: any) => r.resourceName || r.resourceKey).join(', ');
    result += `${task.type || 'PROCESS'}: ${task.name} (${task.key}) — ${status}\n`;
    if (task.feasible && task.scheduledStart) {
      result += `  Time: ${task.scheduledStart} – ${task.scheduledEnd}\n`;
      result += `  Resources: ${resources}\n`;
      if (prevEnd) {
        const gapMin = Math.round((new Date(task.scheduledStart).getTime() - new Date(prevEnd).getTime()) / 60000);
        result += `  Gap from previous: ${gapMin} min${gapMin === 0 ? ' (back-to-back ✓)' : ''}\n`;
      }
      prevEnd = task.scheduledEnd;
    } else {
      for (const err of (task.errors || [])) result += `  Error: ${err.reason || err}\n`;
      if (task.infeasibilityReport) {
        result += `  Conflict: ${task.infeasibilityReport.conflictType}\n`;
        if (task.infeasibilityReport.bottleneckSlot) result += `  Bottleneck: ${task.infeasibilityReport.bottleneckSlot}\n`;
      }
      prevEnd = null;
    }
    result += '\n';
  }
  if (order) {
    result += `Order: ${order.demandQty} demanded, ${order.scheduledQty} scheduled (${((order.fillRate || 0) * 100).toFixed(0)}% fill)\n`;
    if (order.dueDate) result += `Due: ${order.dueDate}\n`;
  }
  return result;
}

function executeImpactAnalysis(taskKey: string, solveResult: any): string {
  const chainTasks = (solveResult.tasks || []).filter((t: any) => t.orderRef === taskKey);
  const isChain = chainTasks.length > 1;
  const targetTasks = isChain
    ? chainTasks.filter((t: any) => t.feasible)
    : (solveResult.tasks || []).filter((t: any) => t.key === taskKey && t.feasible);
  if (targetTasks.length === 0) return `${taskKey} is not currently scheduled — nothing to unschedule.`;

  let result = isChain
    ? `Impact of unscheduling chain ${taskKey} (${targetTasks.length} tasks):\n\n`
    : `Impact of unscheduling ${targetTasks[0].name} (${taskKey}):\n\n`;

  const freedResources = new Map<string, { name: string; minutes: number }>();
  for (const task of targetTasks) {
    if (!task.scheduledStart || !task.scheduledEnd) continue;
    const durMin = Math.round((new Date(task.scheduledEnd).getTime() - new Date(task.scheduledStart).getTime()) / 60000);
    for (const res of (task.assignedResources || [])) {
      const existing = freedResources.get(res.resourceKey);
      if (existing) existing.minutes += durMin;
      else freedResources.set(res.resourceKey, { name: res.resourceName || res.resourceKey, minutes: durMin });
    }
  }

  result += 'Resources freed:\n';
  for (const [, info] of freedResources) result += `  ${info.name}: ${info.minutes} min freed\n`;

  const infeasible = (solveResult.tasks || []).filter((t: any) => !t.feasible && t.infeasibilityReport);
  const wouldBenefit: string[] = [];
  for (const task of infeasible) {
    const bottleneck = task.infeasibilityReport?.slots?.find((s: any) => s.isBottleneck);
    if (!bottleneck) continue;
    for (const res of (bottleneck.resources || [])) {
      if (freedResources.has(res.resourceKey)) { wouldBenefit.push(`${task.name} (${task.key}) — needs ${res.resourceName}`); break; }
    }
  }

  if (wouldBenefit.length > 0) {
    result += '\nInfeasible tasks that might benefit:\n';
    for (const b of wouldBenefit) result += `  → ${b}\n`;
  } else {
    result += '\nNo currently infeasible tasks would directly benefit from this capacity.\n';
  }

  if (!isChain && targetTasks[0].orderRef) {
    const chainPeers = (solveResult.tasks || []).filter((t: any) => t.orderRef === targetTasks[0].orderRef && t.key !== taskKey);
    if (chainPeers.length > 0) {
      result += `\n⚠ Part of chain ${targetTasks[0].orderRef}. Unscheduling may break the chain for:\n`;
      for (const peer of chainPeers) result += `  ${peer.name} (${peer.key}) — ${peer.feasible ? 'scheduled' : 'infeasible'}\n`;
    }
  }
  return result;
}

function executeFindAvailableResources(startTime: string, endTime: string, resourceGroup: string | undefined, minDurationMinutes: number | undefined, solveResult: any): string {
  const minDur = minDurationMinutes || 30;
  let resources = solveResult?.resourceUtilization || [];
  if (resourceGroup) {
    const gl = resourceGroup.toLowerCase();
    resources = resources.filter((r: any) =>
      (r.workCenter || '').toLowerCase().includes(gl) ||
      (r.resourceName || '').toLowerCase().includes(gl) ||
      (r.resourceClass || '').toLowerCase().includes(gl)
    );
  }
  if (resources.length === 0) return `No resources found${resourceGroup ? ` matching "${resourceGroup}"` : ''}.`;

  const results: { name: string; key: string; totalMin: number; gaps: { start: string; end: string; durMin: number }[] }[] = [];
  for (const res of resources) {
    const gaps: { start: string; end: string; durMin: number }[] = [];
    for (const avail of (res.netAvailable || [])) {
      const oStart = Math.max(new Date(avail.start).getTime(), new Date(startTime).getTime());
      const oEnd = Math.min(new Date(avail.end).getTime(), new Date(endTime).getTime());
      const oMin = (oEnd - oStart) / 60000;
      if (oMin >= minDur) gaps.push({ start: new Date(oStart).toISOString(), end: new Date(oEnd).toISOString(), durMin: Math.round(oMin) });
    }
    if (gaps.length > 0) {
      const totalMin = gaps.reduce((s, g) => s + g.durMin, 0);
      results.push({ name: res.resourceName, key: res.resourceKey, totalMin, gaps });
    }
  }
  if (results.length === 0) return `No resources have ${minDur}+ minutes of availability between ${startTime} and ${endTime}.`;
  results.sort((a, b) => b.totalMin - a.totalMin);

  let result = `${results.length} resources with ${minDur}+ min availability:\n\n`;
  for (const r of results) {
    result += `${r.name} (${r.key}) — ${r.totalMin} min total:\n`;
    for (const gap of r.gaps) result += `  ${gap.start} – ${gap.end} (${gap.durMin} min)\n`;
    result += '\n';
  }
  return result;
}

function executeCompareTasks(taskKeys: string[], solveResult: any): string {
  const tasks = taskKeys.map(key => (solveResult.tasks || []).find((t: any) => t.key === key)).filter(Boolean);
  if (tasks.length === 0) return `No tasks found for keys: ${taskKeys.join(', ')}`;

  let result = `Comparing ${tasks.length} tasks:\n\n`;
  for (const task of tasks) {
    result += `${task.key}: ${task.name}\n`;
    result += `  Status: ${task.feasible ? 'Scheduled' : 'Infeasible'}\n`;
    result += `  Priority: ${task.priority}\n  Type: ${task.type || 'PROCESS'}\n  Chain: ${task.orderRef || 'standalone'}\n`;
    if (task.feasible) {
      result += `  Time: ${task.scheduledStart} – ${task.scheduledEnd}\n`;
      result += `  Resources: ${(task.assignedResources || []).map((r: any) => r.resourceName || r.resourceKey).join(', ')}\n`;
    } else {
      if (task.infeasibilityReport) result += `  Conflict: ${task.infeasibilityReport.conflictType}\n`;
      for (const err of (task.errors || [])) result += `  Error: ${err.reason || err}\n`;
    }
    result += '\n';
  }

  // Shared resources
  const resMap = new Map<string, string[]>();
  for (const task of tasks) {
    for (const res of (task.assignedResources || [])) {
      if (!resMap.has(res.resourceKey)) resMap.set(res.resourceKey, []);
      resMap.get(res.resourceKey)!.push(task.key);
    }
  }
  const shared = Array.from(resMap.entries()).filter(([, tks]) => tks.length > 1);
  if (shared.length > 0) {
    result += 'Shared resources:\n';
    for (const [rk, tks] of shared) result += `  ${rk}: used by ${tks.join(', ')}\n`;
  }
  return result;
}

async function executeQueryResources(attribute: string, value: string | undefined, includeAvailability: boolean, startTime?: string, endTime?: string): Promise<string> {
  try {
    const params = new URLSearchParams({ attribute });
    if (value !== undefined) params.set('value', value);
    if (includeAvailability || startTime) params.set('includeAvailability', 'true');
    if (startTime) params.set('startTime', startTime);
    if (endTime) params.set('endTime', endTime);

    const data = await api(`/ctp/resources/query?${params}`);

    if (data.count === 0) {
      return value
        ? `No resources found with ${attribute} = "${value}".`
        : `No resources have a "${attribute}" attribute defined.`;
    }

    let result = `${data.count} resource${data.count !== 1 ? 's' : ''} `;
    result += `with ${attribute}${value ? ` = ${value}` : ''}:\n\n`;

    for (const r of data.resources) {
      const hierarchyParts = Object.values(r.hierarchy ?? {}).filter(Boolean);
      const location = hierarchyParts.join(' \u203A ');

      result += `${r.resourceName} (${r.resourceKey})`;
      if (location) result += ` — ${location}`;
      result += '\n';

      if (r.availableGaps) {
        // Time-windowed response
        result += `  Free: ${r.availableMinutes} min in window\n`;
        for (const g of r.availableGaps) {
          result += `    ${g.start} – ${g.end} (${g.durationMinutes} min)\n`;
        }
      } else if (includeAvailability && r.availableMinutes !== undefined) {
        result += `  Availability: ${r.availableMinutes} min free (${r.utilization}% utilized)\n`;
      }
    }

    return result;
  } catch (err: any) {
    return `Error querying resources: ${err.message}`;
  }
}

async function executeEvaluateNewOrder(sourceChainKey: string, orderName: string, preferredSurgeon?: string, needByDate?: string): Promise<string> {
  try {
    const body: any = { sourceChainKey, orderName, maxOptions: 3 };
    if (preferredSurgeon) {
      body.preferredResources = { Surgeon: [preferredSurgeon] };
    }
    if (needByDate) body.needByDate = needByDate;
    const data = await api('/ctp/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    // Use summary if available (Sprint 1b)
    if (data.summary) {
      const s = data.summary;
      let result = '';

      if (s.feasibleOptions === 0) {
        result = `Cannot schedule "${orderName}" — no feasible options found.\n`;
        if (data.infeasibilityReport?.shortSummary) {
          result += `${data.infeasibilityReport.shortSummary}\n`;
        }
      } else {
        // Lead with the answer
        result = `Earliest delivery for "${orderName}": ${s.earliestCompletionDate}\n`;
        result += `via ${s.earliestCompletionResources}\n`;

        if (s.promiseStatus === 'on-time') {
          result += `\u2713 ${s.promiseSlackDays} days before need-by date (${s.needByDate})\n`;
        } else if (s.promiseStatus === 'tight') {
          result += `\u26A0 Tight — only ${s.promiseSlackDays} days before need-by date\n`;
        } else if (s.promiseStatus === 'cannot-meet') {
          result += `\u2717 Cannot meet need-by date — ${Math.abs(s.promiseSlackDays!)} days late\n`;
        }

        result += `\n${s.feasibleOptions} options found`;
        if (s.latestCompletionDate !== s.earliestCompletionDate) {
          result += ` (${s.earliestCompletionDate} – ${s.latestCompletionDate})`;
        }
        result += `\n\n`;

        for (const option of data.options) {
          const lastTask = option.tasks[option.tasks.length - 1];
          const resources = option.tasks
            .filter((t: any) => t.taskType === 'PROCESS' || !t.taskType)
            .map((t: any) => t.resources.map((r: any) => r.resourceName || r.resourceKey).join(', '))
            .join(' \u2192 ');
          result += `Option ${option.rank}: Completes ${lastTask.end} — ${resources}\n`;
        }
      }
      result += `\nSchedule is unchanged. Use the CTP Query panel to schedule an option.`;
      return result;
    }

    // Fallback: no summary (shouldn't happen with Sprint 1b backend)
    if (!data.feasible || !data.options || data.options.length === 0) {
      return `No feasible placement found for "${orderName}" using chain ${sourceChainKey}.\n\n` +
        `Reason: ${data.infeasibilityReport?.reason || 'All resource combinations exhausted.'}`;
    }
    let result = `Found ${data.options.length} option(s) for "${orderName}"`;
    if (needByDate) result += ` (need by ${needByDate})`;
    result += `:\n\n`;
    for (const option of data.options) {
      result += `**Option ${option.rank}** (score: ${option.chainScore.toFixed(2)})`;
      if (option.promiseStatus) {
        const ps = option.promiseStatus;
        if (ps.status === 'early') result += ` — ${ps.slackDays} days early`;
        else if (ps.status === 'on-time') result += ` — On time`;
        else result += ` — ${Math.abs(ps.slackDays)} days late`;
      }
      result += `:\n`;
      for (const task of option.tasks) {
        const resources = task.resources.map((r: any) => r.resourceName || r.resourceKey).join(', ');
        result += `  ${task.taskName}: ${task.start} — ${task.end} [${resources}]\n`;
      }
      result += '\n';
    }
    result += `Schedule is unchanged. Use the CTP Query panel to schedule an option.`;
    return result;
  } catch (err: any) {
    return `Error evaluating new order: ${err.message}`;
  }
}

async function executeGetCriticalPath(): Promise<string> {
  try {
    const data = await api('/analytics/critical-path');

    if (data.status !== 'ok') {
      return 'No critical path available — solve the schedule first.';
    }

    const fmtDur = (s: number) => {
      if (s < 60) return `${Math.round(s)}s`;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    let result = `Critical Path Analysis:\n`;
    result += `Makespan: ${data.makespanFormatted}\n`;
    result += `Bottleneck: ${data.bottleneckResource.resourceName} (${data.bottleneckResource.percentOfCriticalPath}% of critical path)\n`;
    result += `Critical tasks: ${data.criticalTasks} of ${data.totalTasks}\n`;
    result += `Near-critical tasks (< 30min slack): ${data.nearCriticalTasks}\n`;
    result += `Average slack (non-critical): ${data.avgSlackFormatted}\n\n`;

    result += `Critical path segments:\n`;
    for (const seg of data.segments) {
      const pct = data.makespan > 0 ? Math.round((seg.totalDuration / data.makespan) * 100) : 0;
      const taskNames = seg.tasks.map((t: any) => t.name).join(', ');
      result += `  ${seg.resourceName}: ${fmtDur(seg.totalDuration)} (${pct}%) — ${taskNames}\n`;
    }

    result += `\nResource breakdown:\n`;
    for (const rb of data.resourceBreakdown) {
      result += `  ${rb.resourceName}: ${rb.criticalTimeFormatted} (${rb.percentOfCriticalPath}%, ${rb.taskCount} tasks)\n`;
    }

    result += `\nSlack distribution:\n`;
    for (const bucket of data.slackBuckets) {
      result += `  ${bucket.label}: ${bucket.count} tasks\n`;
    }

    return result;
  } catch (err: any) {
    return `Error fetching critical path: ${err.message}`;
  }
}

async function executeDiagnoseTasks(taskKeys?: string[], onDiagnoseComplete?: (data: any) => void): Promise<string> {
  try {
    const body: any = { maxRecommendations: 3 };
    if (taskKeys?.length) body.taskKeys = taskKeys;
    const data = await api('/ctp/diagnose', { method: 'POST', body: JSON.stringify(body) });

    // Store full response for action button execution (NOT sent to AI)
    if (onDiagnoseComplete) onDiagnoseComplete(data);

    if (!data.diagnoses?.length) {
      return 'No infeasible tasks found — all tasks are scheduled.';
    }

    let result = '';
    for (const d of data.diagnoses) {
      result += `── ${d.taskName} (${d.taskKey}) ──\n`;
      result += `Status: ${d.status}\n`;
      result += `Root cause: ${d.rootCause.type} — ${d.rootCause.summary}\n`;
      if (d.rootCause.blockingTasks?.length) {
        result += `Blocked by:\n`;
        for (const bt of d.rootCause.blockingTasks) {
          result += `  - ${bt.taskName} (priority ${bt.priority}) ${bt.start}–${bt.end}\n`;
        }
      }
      if (d.recommendations?.length) {
        result += `\nRecommendations:\n`;
        for (const rec of d.recommendations) {
          result += `  ${rec.rank}. [${rec.action}] ${rec.description} (score: ${rec.score.toFixed(1)})\n`;
          if (rec.tradeoffs.gains.length) result += `     Gains: ${rec.tradeoffs.gains.join('; ')}\n`;
          if (rec.tradeoffs.costs.length) result += `     Costs: ${rec.tradeoffs.costs.join('; ')}\n`;
          result += `     Action button: <action type="applyFix" recId="${rec.id}" label="Apply: ${rec.description.substring(0, 60)}" />\n`;
        }
      }
      result += '\n';
    }

    if (data.globalRecommendations?.length) {
      result += `── Global Recommendations ──\n`;
      for (const rec of data.globalRecommendations) {
        result += `  ${rec.rank}. [${rec.action}] ${rec.description}\n`;
        result += `     Action button: <action type="applyFix" recId="${rec.id}" label="Apply: ${rec.description.substring(0, 60)}" />\n`;
      }
    }

    result += `\nPresent these options to the planner with action buttons. They click to apply — you do NOT execute fixes.`;
    return result;
  } catch (err: any) {
    return `Error diagnosing tasks: ${err.message}`;
  }
}

async function executeTool(toolName: string, input: any, solveResult: any, onDiagnoseComplete?: (data: any) => void): Promise<string> {
  switch (toolName) {
    case 'where_can_task_go': return await executeWhereTo(input.task_key, input.start_after, input.start_before);
    case 'get_resource_agenda': return executeResourceAgenda(input.resource_key, input.date, solveResult);
    case 'get_chain_detail': return executeChainDetail(input.chain_key, solveResult);
    case 'analyze_impact': return executeImpactAnalysis(input.task_key, solveResult);
    case 'find_available_resources': return executeFindAvailableResources(input.start_time, input.end_time, input.resource_group, input.min_duration_minutes, solveResult);
    case 'compare_tasks': return executeCompareTasks(input.task_keys, solveResult);
    case 'query_resources': return await executeQueryResources(input.attribute, input.value, input.include_availability ?? false, input.start_time, input.end_time);
    case 'evaluate_new_order': return await executeEvaluateNewOrder(input.source_chain_key, input.order_name, input.preferred_surgeon, input.need_by_date);
    case 'get_critical_path': return await executeGetCriticalPath();
    case 'diagnose_tasks': return await executeDiagnoseTasks(input.task_keys, onDiagnoseComplete);
    default: return `Unknown tool: ${toolName}`;
  }
}

function actionIcon(type: ChatActionType): string {
  switch (type) {
    case 'whereTo':        return '\uD83D\uDCCD';
    case 'openTask':       return '\uD83D\uDCCB';
    case 'openResource':   return '\uD83D\uDC64';
    case 'filterChain':    return '\uD83D\uDD17';
    case 'openTab':        return '\u2192';
    case 'navigateOrder':  return '\uD83D\uDCE6';
    case 'applyFix':       return '\u2705';
    default:               return '\u2192';
  }
}

function ChatActionButtons({ actions, onAction }: { actions: ChatAction[]; onAction: (action: ChatAction) => void }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      marginTop: 8, paddingTop: 8,
      borderTop: `1px solid ${C.border}`,
    }}>
      {actions.map((action, i) => {
        const isFix = action.type === 'applyFix';
        const btnColor = isFix ? C.green : C.accent;
        return (
        <button
          key={i}
          onClick={() => onAction(action)}
          style={{
            padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${btnColor}44`,
            background: `${btnColor}12`,
            color: btnColor, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', gap: 4,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = `${btnColor}22`)}
          onMouseLeave={e => (e.currentTarget.style.background = `${btnColor}12`)}
        >
          {actionIcon(action.type)} {action.label}
        </button>
        );
      })}
    </div>
  );
}

function ChatBubble({ message, onAction }: { message: ChatMessage; onAction?: (action: ChatAction) => void }) {
  const isUser = message.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '8px 12px',
        borderRadius: 12,
        fontSize: 12,
        lineHeight: 1.5,
        background: isUser ? '#2196f3' : C.surface2,
        color: isUser ? '#fff' : C.text,
        whiteSpace: 'pre-wrap',
        fontFamily: FONT,
      }}>
        {message.loading ? (
          <span style={{ opacity: 0.6 }}>
            {message.toolCallInProgress
              ? `🔍 Investigating: ${message.toolCallInProgress}...`
              : 'Thinking...'}
          </span>
        ) : (
          message.content
        )}
        {!message.loading && message.actions && message.actions.length > 0 && onAction && (
          <ChatActionButtons actions={message.actions} onAction={onAction} />
        )}
      </div>
    </div>
  );
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'I can help you understand the current schedule. Ask me about tasks, resources, conflicts, or utilization.',
  timestamp: Date.now(),
};

function ChatCollapsedStrip({ lastMessage, onExpand }: { lastMessage: string | null; onExpand: () => void }) {
  return (
    <div
      onClick={onExpand}
      style={{
        position: 'fixed', right: 0, top: 0, bottom: 0,
        width: 44, zIndex: 1100,
        background: C.surface,
        borderLeft: `1px solid ${C.border}`,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        gap: 8,
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
      onMouseLeave={e => (e.currentTarget.style.background = C.surface)}
      title="Re-open AI Assistant"
    >
      <span style={{ fontSize: 14 }}>✦</span>
      {lastMessage && (
        <div style={{
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          fontSize: 10,
          color: C.textDim,
          overflow: 'hidden',
          maxHeight: 200,
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingTop: 4,
          fontFamily: FONT,
        }}>
          {lastMessage.slice(0, 80)}
        </div>
      )}
    </div>
  );
}

function ChatPanel({ solveResult, open, onClose, selectedTask, initialInput, onChatAction, collapsed, onCollapsedExpand, onCollapse, onScheduleChanged }: {
  solveResult: any; open: boolean; onClose: () => void; selectedTask?: any; initialInput?: string; onChatAction?: (action: ChatAction) => void; collapsed?: boolean; onCollapsedExpand?: () => void; onCollapse?: () => void; onScheduleChanged?: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastDiagnoseResponse, setLastDiagnoseResponse] = useState<any>(null);

  // Pre-fill input from external trigger (e.g. Ask AI button)
  useEffect(() => {
    if (initialInput && open) setInput(initialInput);
  }, [initialInput, open]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSolveRef = useRef<any>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Context refresh after re-solve
  useEffect(() => {
    if (solveResult && prevSolveRef.current && solveResult !== prevSolveRef.current && messages.length > 1) {
      setMessages(prev => [...prev, {
        id: `system-${Date.now()}`,
        role: 'assistant',
        content: 'The schedule has been updated. I now have the latest data.',
        timestamp: Date.now(),
      }]);
    }
    prevSolveRef.current = solveResult;
  }, [solveResult]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    const loadingMsg: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      loading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(solveResult, selectedTask);
      const apiMessages: any[] = [...messages, userMsg]
        .filter(m => m.id !== 'welcome' && !m.loading)
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }));

      const callApi = async (msgs: any[]) => {
        const res = await fetch(`${API_BASE}/v1/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
          body: JSON.stringify({
            max_tokens: 2000,
            system: systemPrompt,
            messages: msgs,
            tools: AI_TOOLS,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AI API ${res.status}: ${errBody.slice(0, 300)}`);
        }
        return res.json();
      };

      let response = await callApi(apiMessages);
      let iterations = 0;

      // Tool-use loop: handle tool calls from the AI
      while (response.stop_reason === 'tool_use' && iterations < 5) {
        iterations++;
        const toolUseBlocks = (response.content || []).filter((b: any) => b.type === 'tool_use');
        if (toolUseBlocks.length === 0) break;

        // Update loading message with tool name
        const toolName = toolUseBlocks[0].name.replace(/_/g, ' ');
        setMessages(prev => prev.map(m =>
          m.id === loadingMsg.id ? { ...m, toolCallInProgress: toolName } : m
        ));

        // Execute tools and collect results
        const toolResults: any[] = [];
        for (const toolUse of toolUseBlocks) {
          const result = await executeTool(toolUse.name, toolUse.input, solveResult, setLastDiagnoseResponse);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
        }

        // Add assistant response + tool results, then call again
        apiMessages.push({ role: 'assistant', content: response.content });
        apiMessages.push({ role: 'user', content: toolResults });

        // Reset loading text for next round
        setMessages(prev => prev.map(m =>
          m.id === loadingMsg.id ? { ...m, toolCallInProgress: undefined } : m
        ));

        response = await callApi(apiMessages);
      }

      const rawText = (response.content || [])
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join('\n') || 'I couldn\'t generate a response.';

      const { cleanText, actions } = parseActionsFromText(rawText);

      setMessages(prev => prev.map(m =>
        m.id === loadingMsg.id
          ? { ...m, content: cleanText, loading: false, toolCallInProgress: undefined, actions: actions.length > 0 ? actions : undefined }
          : m
      ));
    } catch (err: any) {
      console.error('AI chat error:', err);
      const errMsg = err?.message || String(err);
      setMessages(prev => prev.map(m =>
        m.id === loadingMsg.id
          ? { ...m, content: `Sorry, I encountered an error: ${errMsg}`, loading: false, toolCallInProgress: undefined }
          : m
      ));
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, solveResult, selectedTask]);

  if (!open) return null;

  if (collapsed) {
    const lastAssistant = messages.filter(m => m.role === 'assistant' && !m.loading).pop();
    return <ChatCollapsedStrip lastMessage={lastAssistant?.content ?? null} onExpand={() => onCollapsedExpand?.()} />;
  }

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0,
      width: 340, zIndex: 1100,
      borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', background: C.surface,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT }}>
          Scheduling Assistant
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => onCollapse?.()}
            title="Collapse chat"
            style={{
              background: 'none', border: 'none', color: '#999',
              cursor: 'pointer', fontSize: 16, padding: '2px 6px',
              borderRadius: 4, fontFamily: FONT, fontWeight: 700,
            }}
          >
            ›
          </button>
          <button
            onClick={() => setMessages([WELCOME_MESSAGE])}
            title="Clear chat"
            style={{
              background: 'none', border: 'none', color: '#999',
              cursor: 'pointer', fontSize: 12, padding: '2px 6px',
              fontFamily: FONT, fontWeight: 600,
            }}
          >
            Clear
          </button>
          <button
            onClick={onClose}
            title="Close"
            style={{
              background: 'none', border: 'none', color: '#999',
              cursor: 'pointer', fontSize: 16, padding: '2px 6px', fontWeight: 700,
            }}
          >
            x
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.map(m => <ChatBubble key={m.id} message={m} onAction={async (action: ChatAction) => {
          if (action.type === 'applyFix' && action.recId) {
            if (!lastDiagnoseResponse) { return; }
            const allRecs = [
              ...(lastDiagnoseResponse.diagnoses?.flatMap((d: any) => d.recommendations) || []),
              ...(lastDiagnoseResponse.globalRecommendations || []),
            ];
            const rec = allRecs.find((r: any) => r.id === action.recId);
            if (!rec) { return; }
            try {
              const result = await api('/ctp/apply-recommendation', {
                method: 'POST',
                body: JSON.stringify({
                  recommendationId: rec.id,
                  commands: rec.commands,
                  landscapeHash: lastDiagnoseResponse.landscapeHash,
                }),
              });
              if (result.stale) {
                setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Schedule has changed — please ask me to re-diagnose.', timestamp: Date.now() }]);
              } else if (result.success) {
                setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Applied: ${rec.description}. Schedule updated.`, timestamp: Date.now() }]);
                if (onScheduleChanged) await onScheduleChanged();
                setLastDiagnoseResponse(null);
              } else {
                setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Fix failed${result.rolledBack ? ' (rolled back)' : ''}: ${result.reason}`, timestamp: Date.now() }]);
              }
            } catch (err: any) {
              setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: `Error: ${err.message}`, timestamp: Date.now() }]);
            }
          } else {
            onChatAction?.(action);
          }
        }} />)}

        {/* Suggested questions */}
        {messages.length <= 1 && solveResult && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, fontFamily: FONT }}>
              Try asking:
            </div>
            {getSuggestedQuestions(solveResult).map((q, i) => (
              <button
                key={i}
                onClick={() => setInput(q)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 10px', marginBottom: 4, borderRadius: 8,
                  border: `1px solid ${C.border}`, background: 'transparent',
                  fontSize: 11, color: C.accent, cursor: 'pointer', fontFamily: FONT,
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: 12, borderTop: `1px solid ${C.border}`,
        display: 'flex', gap: 8,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSend(); }}
          placeholder="Ask about the schedule..."
          disabled={loading}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: `1px solid ${C.border}`, fontSize: 12,
            background: C.bg, color: C.text, fontFamily: FONT,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 12px', borderRadius: 8, border: 'none',
            background: '#2196f3', color: '#fff', fontSize: 12,
            cursor: loading ? 'wait' : 'pointer', fontFamily: FONT,
            fontWeight: 600,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */

const TABS = ['Overview', 'Schedule', 'Orders', 'Conflicts', 'Materials', 'Analytics', 'Configurations'];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(() => {
    const saved = localStorage.getItem('ctp-experience-level');
    return (saved === 'novice' || saved === 'intermediate' || saved === 'expert') ? saved : 'novice';
  });
  const [userOpen, setUserOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedResource, setSelectedResource] = useState<any>(null);
  const [agendaResource, setAgendaResource] = useState<any>(null);
  const [downtimeResource, setDowntimeResource] = useState<string | null>(null);
  const openDowntimeEditor = useCallback((resourceKey: string) => { setDowntimeResource(resourceKey); }, []);
  const [colors, setColors] = useState<any>(null);

  // Solve preview & override state
  const [showSolvePreview, setShowSolvePreview] = useState(false);
  const [showSolveResults, setShowSolveResults] = useState(false);
  const [previousSolveSnapshot, setPreviousSolveSnapshot] = useState<SolveSnapshot | null>(null);
  const [orderModes, setOrderModes] = useState<Record<string, string>>({});
  const [taskPins, setTaskPins] = useState<Record<string, boolean>>({});
  const [taskExcludes, setTaskExcludes] = useState<Record<string, boolean>>({});
  const [taskUnschedules, setTaskUnschedules] = useState<Set<string>>(new Set());
  const [materialModeOverrides, setMaterialModeOverrides] = useState<Record<string, string>>({});
  const [resourceModeOverrides, setResourceModeOverrides] = useState<Record<string, string>>({});
  const [solverStrategy, setSolverStrategy] = useState('Chain');
  const [strategyOptions, setStrategyOptions] = useState<StrategyOption[]>(FALLBACK_STRATEGIES);
  const [selectedTier, setSelectedTier] = useState('balanced');
  const [tierOptions, setTierOptions] = useState<SolverTierOption[]>(FALLBACK_TIERS);
  const [solveStale, setSolveStale] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [resourcePreferenceOverrides, setResourcePreferenceOverrides] = useState<Record<string, Record<string, string>>>({});
  const [showResourcePrefDialog, setShowResourcePrefDialog] = useState(false);
  const [priorityOverrides, setPriorityOverrides] = useState<Record<string, number>>({});
  const [windowOverrides, setWindowOverrides] = useState<Record<string, { startW?: string; endW?: string }>>({});
  const [scoringOverrides, setScoringOverrides] = useState<ScoringRuleOverride[] | null>(null);
  const [configurations, setConfigurations] = useState<any[]>([]);
  const [activeConfigKey, setActiveConfigKey] = useState<string>('default');
  const [activeConfig, setActiveConfig] = useState<any>(null);
  const [configDropdownOpen, setConfigDropdownOpen] = useState(false);

  // ─── Action Queue State ───
  interface QueuedAction {
    id: string;
    label: string;
    command: any; // RecommendationCommand
  }
  const [actionQueue, setActionQueue] = useState<QueuedAction[]>([]);
  const [queueMode, setQueueMode] = useState(false);
  const [queueExecuting, setQueueExecuting] = useState(false);
  const [queueResult, setQueueResult] = useState<any>(null);
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [extendWindowTaskKeys, setExtendWindowTaskKeys] = useState<string[]>([]);
  const [showExtendWindowDialog, setShowExtendWindowDialog] = useState(false);
  const [holdDialogTask, setHoldDialogTask] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const isQueuing = queueMode || shiftHeld;

  const handleScoringRulesChange = useCallback((rules: ScoringRuleOverride[]) => {
    setScoringOverrides(rules.length === 0 ? null : rules);
    if (rules.length > 0) setSolveStale(true);
  }, []);

  // Derive active scoring rules from override state or last solve result
  const activeScoringRules: ScoringRuleOverride[] = scoringOverrides
    ?? solveResult?.scoring?.rules
    ?? [];
  // Detect if active config has been modified in Settings
  const isConfigModified = useMemo(() => {
    if (!activeConfig || !scoringOverrides) return false;
    const savedScoring = activeConfig.scoring || [];
    if (scoringOverrides.length !== savedScoring.length) return true;
    for (let i = 0; i < scoringOverrides.length; i++) {
      const o = scoringOverrides[i];
      const s = savedScoring[i];
      if (!s || o.ruleName !== s.ruleName || Math.round(o.weight * 100) !== Math.round(s.weight * 100)
        || o.objective !== s.objective || o.includeInSolve !== s.includeInSolve
        || o.penaltyFactor !== s.penaltyFactor) return true;
    }
    return false;
  }, [activeConfig, scoringOverrides]);

  const scoringSource: 'config' | 'override' | null = isConfigModified
    ? 'override'
    : scoringOverrides ? 'config'
    : solveResult?.scoring?.source === 'config' ? 'config'
    : null;

  // Build modified config snapshot for diff display
  const modifiedConfig = useMemo(() => {
    if (!isConfigModified || !activeConfig) return null;
    return {
      ...activeConfig,
      scoring: scoringOverrides ?? activeConfig.scoring,
      strategy: solverStrategy,
      tier: selectedTier,
    };
  }, [isConfigModified, activeConfig, scoringOverrides, solverStrategy, selectedTier]);

  // Scoring validation — block solve if overrides don't sum to 100%
  const scoringWeightPct = Math.round(
    (scoringOverrides ?? []).filter(r => r.includeInSolve).reduce((s, r) => s + r.weight, 0) * 100,
  );
  const scoringValid = !scoringOverrides || (scoringWeightPct >= 99 && scoringWeightPct <= 101);

  // Immediate action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; severity: 'info' | 'warning' | 'error' } | null>(null);
  const showToast = useCallback((msg: string, severity: 'info' | 'warning' | 'error' = 'info') => {
    setToast({ msg, severity });
    const duration = severity === 'error' ? 8000 : severity === 'warning' ? 5000 : 3000;
    setTimeout(() => setToast(null), duration);
  }, []);
  // Gantt zoom state — lifted to App so it persists across tab switches
  const [ganttZoomLevel, setGanttZoomLevel] = useState('3 hours');
  const [ganttScrollOffset, setGanttScrollOffset] = useState(0);
  // WhereTo state
  const [whereToTaskKey, setWhereToTaskKey] = useState<string | null>(null);
  const [whereToOptions, setWhereToOptions] = useState<any[]>([]);
  const [whereToLoading, setWhereToLoading] = useState(false);
  const [whereToCurrentAssignment, setWhereToCurrentAssignment] = useState<any>(null);
  const [whereToSource, setWhereToSource] = useState<'gantt' | 'table' | 'panel' | null>(null);
  // Schedule case filter (set from Analytics chain links)
  const [scheduleCaseFilter, setScheduleCaseFilter] = useState<string | null>(null);
  // Orders case filter (set from task orderRef click)
  const [ordersCaseFilter, setOrdersCaseFilter] = useState<string | null>(null);
  // Analytics state
  const [analyticsKpis, setAnalyticsKpis] = useState<any[]>([]);
  const [analyticsDetail, setAnalyticsDetail] = useState<any>(null);
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatInitialInput, setChatInitialInput] = useState<string | undefined>(undefined);
  // CTP Query state
  const [showCTPDialog, setShowCTPDialog] = useState(false);
  const [ctpTemplates, setCTPTemplates] = useState<any[]>([]);
  const [ctpResult, setCTPResult] = useState<any>(null);
  const [ctpLoading, setCTPLoading] = useState(false);
  const [ctpSelectedOption, setCTPSelectedOption] = useState<number>(0);
  // Solve Replay state
  const [replay, setReplay] = useState<ReplayState>(REPLAY_INITIAL);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Previous state snapshots for delta computation
  const [prevOrderModes, setPrevOrderModes] = useState<Record<string, string>>({});
  const [prevTaskPins, setPrevTaskPins] = useState<Record<string, boolean>>({});
  const [prevTaskExcludes, setPrevTaskExcludes] = useState<Record<string, boolean>>({});
  const [prevMaterialModes, setPrevMaterialModes] = useState<Record<string, string>>({});

  const handleExperienceChange = useCallback((level: ExperienceLevel) => {
    setExperienceLevel(level);
    localStorage.setItem('ctp-experience-level', level);
  }, []);

  const handleTierChange = useCallback((tierKey: string) => {
    setSelectedTier(tierKey);
    const tierDef = tierOptions.find(t => t.key === tierKey);
    if (tierDef) setSolverStrategy(tierDef.defaultStrategy);
  }, [tierOptions]);

  const tasks = solveResult?.tasks || [];
  const resources = solveResult?.resourceUtilization || [];
  const orders = solveResult?.orders || [];
  const materials = solveResult?.materials || [];
  const summary = solveResult?.summary || null;

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [result, prods, colorsData, termData, localeData, strategiesData, versionData] = await Promise.all([
        api('/ctp/solve-and-sync', {
          method: 'POST',
          body: JSON.stringify({ detailLevel: experienceLevel }),
        }),
        api('/data/products'),
        api('/data/colors').catch(() => null),
        api('/data/terminology').catch(() => ({})),
        api('/data/locale').catch(() => ({})),
        api('/data/strategies').catch(() => null),
        api('/health/version').catch(() => null),
      ]);
      if (versionData) setVersionInfo(versionData);
      // Load configurations
      try {
        const configList = await api('/configurations');
        if (configList?.configurations) {
          setConfigurations(configList.configurations);
          setActiveConfigKey(configList.activeKey || 'default');
          const active = configList.configurations.find((c: any) => c.key === (configList.activeKey || 'default'));
          if (active) {
            setActiveConfig(active);
            // Initialize session from active config
            if (active.scoring?.length > 0) setScoringOverrides(active.scoring);
            if (active.strategy) setSolverStrategy(active.strategy);
            if (active.tier) setSelectedTier(active.tier);
          }
        }
      } catch { /* configurations endpoint optional */ }
      setSolveResult(result);
      setProducts(prods);
      setColors(result.colors || colorsData || {});
      _terminology = result.terminology || termData || {};
      _locale = result.locale || localeData || {};
      if (strategiesData?.strategies?.length > 0) {
        setStrategyOptions(strategiesData.strategies);
      }
      // Use tenant's configured default strategy if available
      if (strategiesData?.defaultStrategy) {
        setSolverStrategy(strategiesData.defaultStrategy);
      }
      if (strategiesData?.tiers?.length > 0) {
        setTierOptions(strategiesData.tiers);
        if (strategiesData.defaultTier) {
          setSelectedTier(strategiesData.defaultTier);
          // Only override with tier's default if no tenant-level default
          if (!strategiesData.defaultStrategy) {
            const defaultTierDef = strategiesData.tiers.find(
              (t: any) => t.key === strategiesData.defaultTier
            );
            if (defaultTierDef) setSolverStrategy(defaultTierDef.defaultStrategy);
          }
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    }
  }, [experienceLevel]);

  // ─── Action Queue Helpers ───
  const addToQueue = useCallback((label: string, command: any) => {
    setActionQueue(prev => [
      ...prev,
      { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label, command },
    ]);
    showToast(`Queued: ${label}`, 'info');
  }, [showToast]);

  const removeFromQueue = useCallback((id: string) => {
    setActionQueue(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setActionQueue([]);
    setQueueResult(null);
  }, []);

  const reorderQueue = useCallback((fromIndex: number, direction: 'up' | 'down') => {
    setActionQueue(prev => {
      const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  const executeQueue = useCallback(async () => {
    if (actionQueue.length === 0) return;
    setQueueExecuting(true);
    setQueueResult(null);
    setShowExecuteConfirm(false);

    try {
      const commands = actionQueue.map(a => a.command);
      const result = await api('/ctp/execute', {
        method: 'POST',
        body: JSON.stringify({
          commands,
          name: `queue-${actionQueue.length}-actions`,
          detailLevel: experienceLevel,
        }),
      });

      setQueueResult(result);

      if (result.success) {
        // Refresh schedule state from the returned newState
        if (result.newState?.tasks) {
          setSolveResult(result.newState);
        } else {
          const updated = await api('/ctp/state?detailLevel=' + experienceLevel);
          setSolveResult(updated);
        }
        // Clear queue on success after brief delay
        setTimeout(() => {
          setActionQueue([]);
          setQueueResult(null);
        }, 3000);
      }
    } catch (err: any) {
      setQueueResult({ success: false, reason: err.message });
    } finally {
      setQueueExecuting(false);
    }
  }, [actionQueue, experienceLevel]);

  const handleSolveConfirm = useCallback(async () => {
    if (!scoringValid) {
      showToast(`Scoring rules must sum to 100% (currently ${scoringWeightPct}%). Open Settings → Scoring Rules to fix.`, 'warning');
      console.warn(`[Solve blocked] Scoring weights sum to ${scoringWeightPct}%`);
      return;
    }
    setShowSolvePreview(false);
    setSolving(true);
    setSelectedTask(null);
    setSelectedResource(null);
    // Cancel WhereTo if active
    setWhereToTaskKey(null); setWhereToOptions([]); setWhereToCurrentAssignment(null);
    // Clear analytics so they reload after new solve
    setAnalyticsKpis([]); setAnalyticsDetail(null); setSelectedKpi(null);

    // Snapshot current solve for comparison deltas
    if (solveResult?.summary) {
      setPreviousSolveSnapshot({
        scheduledTasks: solveResult.summary.scheduledTasks,
        includedTasks: solveResult.summary.includedTasks,
        feasibilityRate: solveResult.summary.feasibilityRate,
        makespan: solveResult.summary.makespan,
        totalScore: solveResult.stats?.totalScore,
      });
    }

    try {
      setError(null);

      // Build request body with all overrides
      const body: any = { preserveLandscape: true };
      const activeOrderModes = Object.fromEntries(
        Object.entries(orderModes).filter(([, v]) => v !== 'INCLUDE'),
      );
      if (Object.keys(activeOrderModes).length > 0) body.orderModes = activeOrderModes;

      const activePins = Object.fromEntries(
        Object.entries(taskPins).filter(([, v]) => v),
      );
      if (Object.keys(activePins).length > 0) body.taskPins = activePins;

      const activeExcludes = Object.fromEntries(
        Object.entries(taskExcludes).filter(([, v]) => v),
      );
      if (Object.keys(activeExcludes).length > 0) body.taskExcludes = activeExcludes;

      if (taskUnschedules.size > 0) body.taskUnschedules = Array.from(taskUnschedules);

      if (Object.keys(resourceModeOverrides).length > 0) body.resourceModes = resourceModeOverrides;
      if (Object.keys(materialModeOverrides).length > 0) body.materialModes = materialModeOverrides;
      if (Object.keys(resourcePreferenceOverrides).length > 0) body.resourcePreferenceOverrides = resourcePreferenceOverrides;
      if (Object.keys(priorityOverrides).length > 0) body.priorityOverrides = priorityOverrides;
      if (Object.keys(windowOverrides).length > 0) body.windowOverrides = windowOverrides;

      body.strategy = solverStrategy;
      body.detailLevel = experienceLevel;
      if (activeConfigKey) body.configurationKey = activeConfigKey;
      if (scoringOverrides && scoringOverrides.length > 0) body.scoringOverrides = scoringOverrides;

      const result = await api('/ctp/solve', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSolveResult(result);
      setSolveStale(false);

      // Snapshot current state as "previous" for next delta computation
      setPrevOrderModes({ ...orderModes });
      setPrevTaskPins({ ...taskPins });
      setPrevTaskExcludes({ ...taskExcludes });
      setPrevMaterialModes({ ...materialModeOverrides });

      // Clear all overrides — server state is now truth
      setTaskUnschedules(new Set());
      setTaskPins({});
      setTaskExcludes({});
      setOrderModes({});
      setMaterialModeOverrides({});
      setResourceModeOverrides({});
      setSelectedTasks(new Set());

      if (result.colors) setColors(result.colors);
      if (result.terminology) _terminology = result.terminology;
      if (result.locale) _locale = result.locale;

      // Console warnings for diagnostics
      if (result?.summary?.feasibilityRate < 70) {
        console.warn(`[Solve] Low feasibility: ${result.summary.feasibilityRate}% (${result.summary.unscheduledTasks} infeasible)`);
      }

      // Show results dialog
      setShowSolveResults(true);
    } catch (e: any) {
      if (e instanceof ApiError) {
        switch (e.category) {
          case 'validation':
            showToast(e.message, 'warning');
            if (e.code === 'SCORING_WEIGHT_INVALID') setSettingsOpen(true);
            break;
          case 'config':
            setError(`Configuration error: ${e.message}`);
            break;
          case 'engine':
            setError(`Solver error: ${e.message}`);
            showToast('Solver encountered an error. Try adjusting inputs and re-solving.', 'error');
            break;
          default:
            setError(e.message);
            break;
        }
      } else {
        console.error('[Solve] Non-API error:', e);
        setError(e.message || 'Solve failed');
      }
    } finally {
      setSolving(false);
    }
  }, [orderModes, taskPins, taskExcludes, taskUnschedules, materialModeOverrides, resourceModeOverrides, resourcePreferenceOverrides, priorityOverrides, windowOverrides, solverStrategy, experienceLevel, solveResult, scoringOverrides]);

  const handleSolveCancel = useCallback(() => {
    setShowSolvePreview(false);
  }, []);

  // Resource Preference handlers
  const handleApplyPreferences = useCallback((
    selectedTaskKeys: string[],
    resourceModes: Record<string, string>,
  ) => {
    const newOverrides = { ...resourcePreferenceOverrides };
    for (const taskKey of selectedTaskKeys) {
      // Store all explicit mode selections — even AVAILABLE is an override if the default was EXCLUDED
      const taskOverrides: Record<string, string> = { ...resourceModes };
      if (Object.keys(taskOverrides).length > 0) {
        newOverrides[taskKey] = taskOverrides;
      } else {
        delete newOverrides[taskKey];
      }
    }
    setResourcePreferenceOverrides(newOverrides);
    setShowResourcePrefDialog(false);
    setSolveStale(true);
    showToast(`Resource preferences applied for ${selectedTaskKeys.length} task(s)`);
  }, [resourcePreferenceOverrides, showToast]);

  const handleApplyAndSolve = useCallback(async (
    selectedTaskKeys: string[],
    resourceModes: Record<string, string>,
  ) => {
    // Apply preferences first (compute inline to avoid stale closure)
    const newOverrides = { ...resourcePreferenceOverrides };
    for (const taskKey of selectedTaskKeys) {
      // Store all explicit mode selections — even AVAILABLE is an override if the default was EXCLUDED
      const taskOverrides: Record<string, string> = { ...resourceModes };
      if (Object.keys(taskOverrides).length > 0) {
        newOverrides[taskKey] = taskOverrides;
      } else {
        delete newOverrides[taskKey];
      }
    }
    setResourcePreferenceOverrides(newOverrides);
    setShowResourcePrefDialog(false);

    // Snapshot current assignments for post-solve comparison
    const beforeAssignments: Record<string, string> = {};
    for (const key of selectedTaskKeys) {
      const task = tasks.find((t: any) => t.key === key);
      if (task?.assignedResources?.[0]) {
        beforeAssignments[key] = task.assignedResources[0].resourceKey;
      }
    }

    setSolving(true);
    try {
      setError(null);
      const body: any = {
        preserveLandscape: true,
        resourcePreferenceOverrides: newOverrides,
        strategy: solverStrategy,
        detailLevel: experienceLevel,
      };
      // Include other active overrides
      const activeOrderModes = Object.fromEntries(Object.entries(orderModes).filter(([, v]) => v !== 'INCLUDE'));
      if (Object.keys(activeOrderModes).length > 0) body.orderModes = activeOrderModes;
      const activePins = Object.fromEntries(Object.entries(taskPins).filter(([, v]) => v));
      if (Object.keys(activePins).length > 0) body.taskPins = activePins;
      const activeExcludes = Object.fromEntries(Object.entries(taskExcludes).filter(([, v]) => v));
      if (Object.keys(activeExcludes).length > 0) body.taskExcludes = activeExcludes;
      if (taskUnschedules.size > 0) body.taskUnschedules = Array.from(taskUnschedules);
      if (Object.keys(resourceModeOverrides).length > 0) body.resourceModes = resourceModeOverrides;
      if (Object.keys(materialModeOverrides).length > 0) body.materialModes = materialModeOverrides;
      if (scoringOverrides && scoringOverrides.length > 0) body.scoringOverrides = scoringOverrides;

      const result = await api('/ctp/solve', { method: 'POST', body: JSON.stringify(body) });
      setSolveResult(result);
      setSolveStale(false);

      // Build redirect summary toast
      const moved: string[] = [];
      for (const key of selectedTaskKeys) {
        const newTask = result.tasks?.find((t: any) => t.key === key);
        const before = beforeAssignments[key] || '(none)';
        const after = newTask?.assignedResources?.[0]?.resourceKey || '(none)';
        if (before !== after) moved.push(`${key}: ${before} → ${after}`);
      }
      if (moved.length > 0) {
        showToast(`Redirect: ${moved.length} task(s) moved. ${moved.slice(0, 3).join('; ')}${moved.length > 3 ? '...' : ''}`);
      } else {
        showToast('Solve complete. No resource changes.');
      }

      // Clear all overrides — server state is now truth
      setResourcePreferenceOverrides({});
      setPriorityOverrides({});
      setWindowOverrides({});
      setTaskUnschedules(new Set());
      setTaskPins({});
      setTaskExcludes({});
      setOrderModes({});
      setMaterialModeOverrides({});
      setResourceModeOverrides({});
      setSelectedTasks(new Set());

      if (result.colors) setColors(result.colors);
      if (result.terminology) _terminology = result.terminology;
      if (result.locale) _locale = result.locale;

      setShowSolveResults(true);
    } catch (e: any) {
      if (e instanceof ApiError) {
        e.category === 'validation' ? showToast(e.message, 'warning') : setError(e.message);
      } else {
        setError(e.message || 'Solve failed');
      }
    } finally {
      setSolving(false);
    }
  }, [resourcePreferenceOverrides, tasks, solverStrategy, experienceLevel,
      orderModes, taskPins, taskExcludes, taskUnschedules, resourceModeOverrides,
      materialModeOverrides, showToast]);

  const handleClearResourceOverrides = useCallback((taskKey: string) => {
    setResourcePreferenceOverrides(prev => {
      const next = { ...prev };
      delete next[taskKey];
      return next;
    });
    setSolveStale(true);
  }, []);

  // Click handlers for detail panels
  const handleTaskClick = useCallback((t: any) => {
    setSelectedResource(null);
    setSelectedTask(t);
  }, []);

  const handleTaskClickByKey = useCallback((key: string) => {
    const t = tasks.find((task: any) => task.key === key);
    if (t) { setSelectedResource(null); setSelectedTask(t); }
  }, [tasks]);

  const handleResourceClick = useCallback((r: any) => {
    setSelectedTask(null);
    // Look up full resource object (with utilization data) when clicked from task detail
    const full = resources.find((res: any) => res.resourceKey === r.resourceKey);
    setSelectedResource(full || r);
  }, [resources]);

  // Ask AI handler
  const handleAskAI = useCallback((task: any) => {
    setChatInitialInput(`Tell me about ${task.name} (${task.key})`);
    setChatOpen(true);
    setChatCollapsed(false);
    // Clear after a tick so the effect fires but doesn't persist
    setTimeout(() => setChatInitialInput(undefined), 100);
  }, []);

  // ── Replay handlers ──────────────────────────────────────────
  const replayGoToStep = useCallback((targetStep: number, steps: SolveStep[]) => {
    const clamped = Math.max(0, Math.min(targetStep, steps.length));
    const visible = advanceToStep(clamped, steps);
    const currentStepData = clamped > 0 ? steps[clamped - 1] : null;
    setReplay(prev => ({
      ...prev,
      currentStep: clamped,
      visibleTasks: visible,
      flashAction: currentStepData?.action ?? null,
      flashTaskKey: currentStepData?.taskKey ?? null,
    }));
    // Clear flash after 300ms
    setTimeout(() => {
      setReplay(prev => ({ ...prev, flashAction: null, flashTaskKey: null }));
    }, 300);
  }, []);

  const handleReplayStep = useCallback((delta: number) => {
    setReplay(prev => {
      const target = prev.currentStep + delta;
      replayGoToStep(target, prev.steps);
      return prev; // replayGoToStep sets state
    });
    // Actually call it with current state
    setReplay(prev => {
      const target = Math.max(0, Math.min(prev.currentStep + delta, prev.steps.length));
      const visible = advanceToStep(target, prev.steps);
      const currentStepData = target > 0 ? prev.steps[target - 1] : null;
      return {
        ...prev,
        currentStep: target,
        visibleTasks: visible,
        flashAction: currentStepData?.action ?? null,
        flashTaskKey: currentStepData?.taskKey ?? null,
      };
    });
    setTimeout(() => {
      setReplay(prev => ({ ...prev, flashAction: null, flashTaskKey: null }));
    }, 300);
  }, []);

  const handleReplayJumpStart = useCallback(() => {
    setReplay(prev => ({
      ...prev, currentStep: 0, visibleTasks: new Set(),
      playing: false, flashAction: null, flashTaskKey: null,
    }));
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
  }, []);

  const handleReplayJumpEnd = useCallback(() => {
    setReplay(prev => ({
      ...prev,
      currentStep: prev.steps.length,
      visibleTasks: advanceToStep(prev.steps.length, prev.steps),
      playing: false, flashAction: null, flashTaskKey: null,
    }));
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
  }, []);

  const handleReplayTogglePlay = useCallback(() => {
    setReplay(prev => {
      const nowPlaying = !prev.playing;
      if (!nowPlaying && replayTimerRef.current) {
        clearInterval(replayTimerRef.current);
        replayTimerRef.current = null;
      }
      return { ...prev, playing: nowPlaying };
    });
  }, []);

  const handleReplaySpeedChange = useCallback((speed: number) => {
    setReplay(prev => ({ ...prev, speed }));
  }, []);

  const handleReplayExit = useCallback(() => {
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    setReplay(REPLAY_INITIAL);
  }, []);

  const handleReplayJumpToStep = useCallback((step: number) => {
    setReplay(prev => {
      const clamped = Math.max(0, Math.min(step, prev.steps.length));
      const visible = advanceToStep(clamped, prev.steps);
      const currentStepData = clamped > 0 ? prev.steps[clamped - 1] : null;
      return {
        ...prev,
        currentStep: clamped,
        visibleTasks: visible,
        playing: false,
        flashAction: currentStepData?.action ?? null,
        flashTaskKey: currentStepData?.taskKey ?? null,
      };
    });
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    setTimeout(() => {
      setReplay(prev => ({ ...prev, flashAction: null, flashTaskKey: null }));
    }, 300);
  }, []);

  // Auto-play timer effect
  useEffect(() => {
    if (replay.playing && replay.active) {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current);
      replayTimerRef.current = setInterval(() => {
        setReplay(prev => {
          if (prev.currentStep >= prev.steps.length) {
            // Reached the end — stop playing
            if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
            return { ...prev, playing: false };
          }
          const target = prev.currentStep + 1;
          const visible = advanceToStep(target, prev.steps);
          const currentStepData = prev.steps[target - 1];
          return {
            ...prev,
            currentStep: target,
            visibleTasks: visible,
            flashAction: currentStepData?.action ?? null,
            flashTaskKey: currentStepData?.taskKey ?? null,
          };
        });
        // Clear flash
        setTimeout(() => {
          setReplay(prev => ({ ...prev, flashAction: null, flashTaskKey: null }));
        }, 300);
      }, replay.speed);
    } else {
      if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    }
    return () => {
      if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    };
  }, [replay.playing, replay.active, replay.speed]);

  // Keyboard shortcuts for replay
  useEffect(() => {
    if (!replay.active) return;
    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          handleReplayTogglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleReplayStep(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleReplayStep(-1);
          break;
        case 'Home':
          e.preventDefault();
          handleReplayJumpStart();
          break;
        case 'End':
          e.preventDefault();
          handleReplayJumpEnd();
          break;
        case 'Escape':
          e.preventDefault();
          handleReplayExit();
          break;
        case '+': case '=':
          e.preventDefault();
          handleReplaySpeedChange(Math.max(100, replay.speed - 100));
          break;
        case '-':
          e.preventDefault();
          handleReplaySpeedChange(Math.min(2000, replay.speed + 100));
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [replay.active, replay.speed, handleReplayTogglePlay, handleReplayStep, handleReplayJumpStart, handleReplayJumpEnd, handleReplayExit, handleReplaySpeedChange]);

  const handleStartReplay = useCallback(async () => {
    // If we already have solveSteps in the result, use them directly
    if (solveResult?.solveSteps?.length > 0) {
      setReplay({
        active: true,
        steps: solveResult.solveSteps,
        currentStep: 0,
        playing: false,
        speed: 500,
        visibleTasks: new Set(),
        flashAction: null,
        flashTaskKey: null,
      });
      setActiveTab('Schedule');
      return;
    }
    // Otherwise, re-solve with recordSolveSteps enabled
    setSolving(true);
    try {
      const body: any = {
        preserveLandscape: true,
        strategy: solverStrategy,
        detailLevel: experienceLevel,
        recordSolveSteps: true,
      };
      if (scoringOverrides && scoringOverrides.length > 0) body.scoringOverrides = scoringOverrides;
      const result = await api('/ctp/solve', { method: 'POST', body: JSON.stringify(body) });
      setSolveResult(result);
      setSolveStale(false);

      if (result.solveSteps?.length > 0) {
        setReplay({
          active: true,
          steps: result.solveSteps,
          currentStep: 0,
          playing: false,
          speed: 500,
          visibleTasks: new Set(),
          flashAction: null,
          flashTaskKey: null,
        });
      } else {
        showToast('No solve steps recorded');
      }
      setActiveTab('Schedule');
    } catch (e: any) {
      setError(e.message || 'Replay solve failed');
    } finally {
      setSolving(false);
    }
  }, [solveResult, solverStrategy, experienceLevel, showToast]);

  // WhereTo handlers
  const cancelWhereTo = useCallback(() => {
    setWhereToTaskKey(null);
    setWhereToOptions([]);
    setWhereToCurrentAssignment(null);
    setWhereToSource(null);
  }, []);

  const handleWhereTo = useCallback(async (taskKey: string, source: 'gantt' | 'table' | 'panel' = 'gantt', startAfter?: string, startBefore?: string) => {
    if (source === 'gantt') setActiveTab('Schedule');
    // Open detail panel only from table — from Gantt/panel the user already sees the task
    if (source === 'table') {
      setSelectedTask(tasks.find((tk: any) => tk.key === taskKey) || null);
    }
    setWhereToSource(source);
    setWhereToTaskKey(taskKey);
    setWhereToLoading(true);
    setWhereToOptions([]);
    setWhereToCurrentAssignment(null);
    try {
      const constraints: any = { maxResults: 10 };
      if (startAfter) constraints.startAfter = startAfter;
      if (startBefore) constraints.startBefore = startBefore;
      const result = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/where-to`, {
        method: 'POST',
        body: JSON.stringify({ constraints }),
      });
      setWhereToOptions(result.options || []);
      setWhereToCurrentAssignment(result.currentAssignment || null);
    } catch (err) {
      console.error('WhereTo failed:', err);
      setWhereToOptions([]);
    } finally {
      setWhereToLoading(false);
    }
  }, [tasks]);

  const handleMoveTo = useCallback(async (taskKey: string, option: any) => {
    try {
      const result = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/move-to`, {
        method: 'POST',
        body: JSON.stringify({
          contextHash: option.contextHash,
          startTime: option.start,
        }),
      });
      if (result.success) {
        setWhereToTaskKey(null);
        setWhereToOptions([]);
        setWhereToCurrentAssignment(null);
        if (result.requiresResolve) setSolveStale(true);
        // Refresh from live landscape state (not cached results — moveTo modifies landscape directly)
        const updated = await api('/ctp/state');
        applyStateRefresh(updated);
      } else {
        alert(result.reason || 'Position no longer available. Refreshing options...');
        handleWhereTo(taskKey);
      }
    } catch (err) {
      console.error('MoveTo failed:', err);
    }
  }, [handleWhereTo]);

  // Chat action handler — AI response buttons drive the UI
  const handleChatAction = useCallback((action: ChatAction) => {
    switch (action.type) {
      case 'whereTo':
        setActiveTab('Schedule');
        if (action.taskKey) handleWhereTo(action.taskKey, 'gantt', action.startAfter, action.startBefore);
        break;
      case 'openTask':
        if (action.taskKey) {
          const task = tasks.find((t: any) => t.key === action.taskKey);
          if (task) { setSelectedResource(null); setSelectedTask(task); }
        }
        break;
      case 'openResource':
        if (action.resourceKey) {
          const resource = (solveResult?.resourceUtilization || []).find((r: any) => r.resourceKey === action.resourceKey);
          if (resource) { setSelectedTask(null); setSelectedResource(resource); }
        }
        break;
      case 'filterChain':
        if (action.chainKey) { setScheduleCaseFilter(action.chainKey); setActiveTab('Schedule'); }
        break;
      case 'openTab':
        if (action.tab) setActiveTab(action.tab);
        break;
      case 'navigateOrder':
        if (action.orderKey) { setOrdersCaseFilter(action.orderKey); setActiveTab('Orders'); }
        break;
    }
    // Collapse chat for space-hungry actions; keep open for detail panels
    const shouldCollapse = ['whereTo', 'filterChain', 'openTab', 'navigateOrder'].includes(action.type);
    if (shouldCollapse) setChatCollapsed(true);
  }, [tasks, solveResult, handleWhereTo]);

  // CTP ghost bars — computed from selected CTP option for Gantt overlay
  const ctpGhostBars = useMemo(() => {
    if (!ctpResult?.feasible || !ctpResult.options?.length) return null;
    const option = ctpResult.options[ctpSelectedOption] || ctpResult.options[0];
    return option.tasks.map((task: any) => ({
      resourceKeys: task.resources.map((r: any) => r.resourceKey),
      start: task.start,
      end: task.end,
      label: `CTP: ${task.taskType}`,
      taskName: task.taskName,
      rank: option.rank,
    }));
  }, [ctpResult, ctpSelectedOption]);

  // ─── CTP Query handlers ───

  const handleOpenCTPDialog = useCallback(async () => {
    setShowCTPDialog(true);
    try {
      const data = await api('/ctp/chain-templates');
      setCTPTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to load chain templates:', err);
      setCTPTemplates([]);
    }
  }, []);

  const handleCTPEvaluate = useCallback(async (sourceChainKey: string, orderName: string, priority?: number, needByDate?: string) => {
    setCTPLoading(true);
    setCTPResult(null);
    setCTPSelectedOption(0);
    try {
      const body: any = { sourceChainKey, orderName, maxOptions: 5 };
      if (priority != null) body.priority = priority;
      if (needByDate) body.needByDate = needByDate;
      const result = await api('/ctp/query', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCTPResult(result);
    } catch (err: any) {
      setCTPResult({ feasible: false, options: [], summary: null, infeasibilityReport: { reason: err.message, shortSummary: err.message } });
    } finally {
      setCTPLoading(false);
    }
  }, []);

  const handleCTPBook = useCallback(async (_sourceChainKey: string, orderName: string, option: any) => {
    // For V1: add the order by solving with the clone injected
    // Since we don't have a session endpoint yet, we confirm and do a fresh solve
    if (!confirm(`Schedule "${orderName}"?\n\nOption ${option.rank}: ${option.tasks.map((t: any) => `${t.taskType} at ${new Date(t.start).toLocaleTimeString()}`).join(', ')}\n\nThis will re-solve the schedule with the new order.`)) return;

    // Close dialog and show solve is stale
    setShowCTPDialog(false);
    setCTPResult(null);
    showToast(`"${orderName}" scheduling requires a re-solve with the new order. Feature coming in What-If Sprint 2.`);
  }, [showToast]);

  const handleCTPClose = useCallback(() => {
    setShowCTPDialog(false);
    setCTPResult(null);
    setCTPSelectedOption(0);
  }, []);

  // ─── Immediate single-task API actions ───

  // After any immediate action refreshes /ctp/state, apply the result and
  // invalidate analytics so KPIs reflect the new landscape state.
  const applyStateRefresh = useCallback((updated: any) => {
    if (!updated.tasks) return;
    // Preserve compatibleResources from previous solve (state endpoint doesn't return them)
    setSolveResult((prev: any) => {
      if (prev?.tasks) {
        const prevCompatMap = new Map(
          prev.tasks.map((t: any) => [t.key, t.compatibleResources])
        );
        updated.tasks = updated.tasks.map((t: any) => ({
          ...t,
          compatibleResources: t.compatibleResources || prevCompatMap.get(t.key) || [],
        }));
      }
      return updated;
    });
    setAnalyticsKpis([]);
    setAnalyticsDetail(null);
  }, []);

  const handleApiUnschedule = useCallback(async (taskKey: string) => {
    setActionLoading(taskKey);
    try {
      const res = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/unschedule`, {
        method: 'POST',
        body: JSON.stringify({ resetScore: true }),
      });
      if (res.success) {
        const updated = await api('/ctp/state');
        applyStateRefresh(updated);
      } else {
        showToast(`Cannot unschedule: ${res.message || 'Unknown error'}`);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.category === 'validation') {
        showToast(err.message, 'warning');
      } else {
        showToast(err.message || 'Unschedule failed', 'error');
      }
    } finally {
      setActionLoading(null);
    }
  }, [showToast]);

  const handleApiPin = useCallback(async (taskKey: string, pinned: boolean) => {
    setActionLoading(taskKey);
    try {
      const res = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned }),
      });
      if (res.success || res.taskKey) {
        const updated = await api('/ctp/state');
        applyStateRefresh(updated);
        setTaskPins(prev => ({ ...prev, [taskKey]: pinned }));
      } else {
        showToast(`Cannot ${pinned ? 'pin' : 'unpin'}: ${res.message || 'Unknown error'}`);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.category === 'validation') {
        showToast(err.message, 'warning');
      } else {
        showToast(err.message || `${pinned ? 'Pin' : 'Unpin'} failed`, 'error');
      }
    } finally {
      setActionLoading(null);
    }
  }, [showToast]);

  const handleApiSchedule = useCallback(async (taskKey: string) => {
    setActionLoading(taskKey);
    try {
      const res = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/schedule`, {
        method: 'POST',
      });
      if (res.success) {
        const updated = await api('/ctp/state');
        applyStateRefresh(updated);
        const resource = res.assignedResources?.[0]?.resourceKey;
        const time = res.scheduledStart ? new Date(res.scheduledStart).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        showToast(`✓ Task scheduled${resource ? ` on ${resource}` : ''}${time ? ` at ${time}` : ''}`);
        setSolveStale(true);
      } else {
        showToast(`Cannot schedule: ${res.errors?.[0]?.reason || res.message || 'No feasible slot'}`);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.category === 'validation') {
        showToast(err.message, 'warning');
      } else {
        showToast(err.message || 'Schedule failed', 'error');
      }
    } finally {
      setActionLoading(null);
    }
  }, [showToast]);

  const handleApiBulkUnschedule = useCallback(async (keys: string[], event?: React.MouseEvent) => {
    if (queueMode || event?.shiftKey) {
      const tasks_ = solveResult?.tasks || [];
      for (const key of keys) {
        const t = tasks_.find((tt: any) => tt.key === key);
        addToQueue(`Unschedule ${t?.name || key}`, { type: 'unschedule', taskKey: key });
      }
      setSelectedTasks(new Set());
      return;
    }
    setActionLoading('__bulk__');
    let successCount = 0;
    try {
      for (const key of keys) {
        try {
          const res = await api(`/ctp/tasks/${encodeURIComponent(key)}/unschedule`, {
            method: 'POST',
            body: JSON.stringify({ resetScore: true }),
          });
          if (res.success) successCount++;
        } catch { /* continue */ }
      }
      const updated = await api('/ctp/state');
      if (updated.tasks) setSolveResult(updated);
      setSelectedTasks(new Set());
      if (successCount < keys.length) {
        showToast(`${successCount}/${keys.length} tasks unscheduled`);
      }
    } catch (err) {
      console.error('Bulk unschedule error:', err);
      showToast('Bulk unschedule failed');
    } finally {
      setActionLoading(null);
    }
  }, [showToast, queueMode, addToQueue, solveResult]);

  const handleApiBulkPin = useCallback(async (keys: string[], pinned: boolean, event?: React.MouseEvent) => {
    if (queueMode || event?.shiftKey) {
      const tasks_ = solveResult?.tasks || [];
      for (const key of keys) {
        const t = tasks_.find((tt: any) => tt.key === key);
        addToQueue(`${pinned ? 'Pin' : 'Unpin'} ${t?.name || key}`, { type: 'pin', taskKey: key, pinned });
      }
      setSelectedTasks(new Set());
      return;
    }
    setActionLoading('__bulk__');
    try {
      for (const key of keys) {
        try {
          await api(`/ctp/tasks/${encodeURIComponent(key)}/pin`, {
            method: 'PATCH',
            body: JSON.stringify({ pinned }),
          });
        } catch { /* continue */ }
      }
      const updated = await api('/ctp/state');
      if (updated.tasks) setSolveResult(updated);
      setTaskPins(prev => {
        const next = { ...prev };
        keys.forEach(k => { next[k] = pinned; });
        return next;
      });
      setSelectedTasks(new Set());
    } catch (err) {
      console.error('Bulk pin error:', err);
      showToast(`Bulk ${pinned ? 'pin' : 'unpin'} failed`);
    } finally {
      setActionLoading(null);
    }
  }, [showToast, queueMode, addToQueue, solveResult]);

  const handleBulkSchedule = useCallback(async (keys: string[], event?: React.MouseEvent) => {
    if (queueMode || event?.shiftKey) {
      addToQueue(`Solve targeted (${keys.length} tasks)`, { type: 'solve', taskKeys: keys, scope: 'targeted', expandChains: true });
      setSelectedTasks(new Set());
      return;
    }
    setActionLoading('__bulk__');
    let successCount = 0;
    try {
      for (const key of keys) {
        try {
          const res = await api(`/ctp/tasks/${encodeURIComponent(key)}/schedule`, {
            method: 'POST',
          });
          if (res.success) successCount++;
        } catch { /* continue */ }
      }
      const updated = await api('/ctp/state');
      if (updated.tasks) setSolveResult(updated);
      setSelectedTasks(new Set());
      if (successCount < keys.length) {
        showToast(`${successCount}/${keys.length} scheduled. ${keys.length - successCount} could not be placed.`);
      } else if (keys.length > 1) {
        showToast(`${successCount}/${keys.length} tasks scheduled`);
      }
    } catch (err) {
      console.error('Bulk schedule error:', err);
      showToast('Bulk schedule failed');
    } finally {
      setActionLoading(null);
    }
  }, [showToast, queueMode, addToQueue]);

  const handleHold = useCallback(async (taskKey: string, args: { holdReason: string; holdStart: string; estimatedResumeTime?: string }, event?: React.MouseEvent) => {
    const tasks_ = solveResult?.tasks || [];
    const shouldQueue = queueMode || event?.shiftKey;
    setHoldDialogTask(null);

    if (shouldQueue) {
      const task = tasks_.find((t: any) => t.key === taskKey);
      addToQueue(`Hold: ${task?.name || taskKey}`, {
        type: 'hold', taskKey,
        holdReason: args.holdReason || undefined,
        estimatedResumeTime: args.estimatedResumeTime,
      });
      return;
    }

    setActionLoading(taskKey);
    try {
      await api('/ctp/tasks/hold', {
        method: 'POST',
        body: JSON.stringify({
          taskKey,
          holdReason: args.holdReason || 'On hold',
          estimatedResumeTime: args.estimatedResumeTime,
          holdStart: args.holdStart,
        }),
      });
      const updated = await api('/ctp/state');
      if (updated.tasks) setSolveResult(updated);
      showToast('Task put on hold');
    } catch (err: any) {
      showToast(err.message || 'Hold failed', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [solveResult, queueMode, addToQueue, showToast]);

  const handleExtendWindow = useCallback(async (taskKeys: string[], extensionSeconds: number, event?: React.MouseEvent) => {
    const tasks_ = solveResult?.tasks || [];
    const shouldQueue = queueMode || event?.shiftKey;

    if (shouldQueue) {
      for (const key of taskKeys) {
        const task = tasks_.find((t: any) => t.key === key);
        if (!task) continue;
        const currentEnd = task.windowEnd || task.scheduledEnd;
        if (!currentEnd) continue;
        const newEnd = new Date(new Date(currentEnd).getTime() + extensionSeconds * 1000).toISOString();
        const label = extensionSeconds >= 86400
          ? `+${Math.round(extensionSeconds / 86400)}d`
          : `+${Math.round(extensionSeconds / 3600)}h`;
        addToQueue(`Extend window ${label}: ${task.name || key}`, { type: 'set_window', taskKey: key, windowEnd: newEnd });
      }
      setShowExtendWindowDialog(false);
      return;
    }

    setShowExtendWindowDialog(false);
    setActionLoading('__bulk__');
    try {
      for (const key of taskKeys) {
        const task = tasks_.find((t: any) => t.key === key);
        if (!task) continue;
        const currentEnd = task.windowEnd || task.scheduledEnd;
        if (!currentEnd) continue;
        const newEnd = new Date(new Date(currentEnd).getTime() + extensionSeconds * 1000).toISOString();
        await api(`/ctp/tasks/${key}/window`, {
          method: 'PATCH',
          body: JSON.stringify({ windowEnd: newEnd }),
        });
      }
      const updated = await api('/ctp/state');
      if (updated.tasks) setSolveResult(updated);
      setSelectedTasks(new Set());
      showToast(`Window extended for ${taskKeys.length} task(s)`);
    } catch (err: any) {
      showToast(err.message || 'Extend window failed', 'error');
    } finally {
      setActionLoading(null);
    }
  }, [solveResult, queueMode, addToQueue, showToast]);

  const handleToolbarAction = useCallback(async (action: string, taskKeys: string[], event?: any) => {
    const tasks_ = solveResult?.tasks || [];

    // Hold — show dialog to capture reason + times
    if (action === 'hold') {
      const task = tasks_.find((t: any) => t.key === taskKeys[0]);
      setHoldDialogTask({ key: taskKeys[0], name: task?.name || taskKeys[0] });
      return;
    }

    // Extend window — show dialog to pick duration
    if (action === 'extend_window') {
      const eligible = taskKeys.filter(k => {
        const task = tasks_.find((t: any) => t.key === k);
        return task && (task.windowEnd || task.scheduledEnd);
      });
      if (eligible.length === 0) return;
      setExtendWindowTaskKeys(eligible);
      setShowExtendWindowDialog(true);
      return;
    }

    const shouldQueue = queueMode || event?.shiftKey;

    // Map toolbar action to command type
    const commandType: Record<string, string> = {
      dispatch: 'dispatch', revert: 'revert_dispatch',
      start: 'start', hold: 'hold', resume: 'resume', complete: 'complete',
    };
    const cmdType = commandType[action];
    if (!cmdType) return;

    // Filter to only valid tasks — silently skip invalid ones
    const validKeys = taskKeys.filter(k => {
      const task = tasks_.find((t: any) => t.key === k);
      return task && canTransition(task, action).allowed;
    });
    if (validKeys.length === 0) return;
    taskKeys = validKeys;

    // Revert: warn if materials pulled
    if (action === 'revert' && !shouldQueue) {
      const pulled = taskKeys.filter(k => {
        const t = tasks_.find((tt: any) => tt.key === k);
        return t?.dispatched && t?.materialsPulled;
      });
      if (pulled.length > 0) {
        const confirmed = confirm(
          `${pulled.length} task(s) have materials pulled. Reverting will mark materials as wasted. Continue?`
        );
        if (!confirmed) return;
      }
    }

    if (shouldQueue) {
      const labels: Record<string, string> = {
        dispatch: 'Dispatch', revert: 'Revert dispatch',
        start: 'Start', hold: 'Hold', resume: 'Resume', complete: 'Complete',
      };
      for (const key of taskKeys) {
        const t = tasks_.find((tt: any) => tt.key === key);
        addToQueue(`${labels[action] || action} ${t?.name || key}`, { type: cmdType, taskKey: key });
      }
      setSelectedTasks(new Set());
      return;
    }

    // Revert uses dedicated endpoint
    if (action === 'revert') {
      setActionLoading('__bulk__');
      try {
        await api('/ctp/tasks/revert-dispatch', {
          method: 'POST',
          body: JSON.stringify({ taskKeys }),
        });
        const updated = await api('/ctp/state');
        if (updated.tasks) setSolveResult(updated);
        setSelectedTasks(new Set());
        showToast(`${taskKeys.length} task(s) reverted to pinned`);
      } catch (err: any) {
        showToast(err.message || 'Revert failed', 'error');
      } finally {
        setActionLoading(null);
      }
      return;
    }

    // Other commitment actions use /ctp/execute
    setActionLoading('__bulk__');
    try {
      const commands = taskKeys.map(key => ({ type: cmdType, taskKey: key }));
      await api('/ctp/execute', {
        method: 'POST',
        body: JSON.stringify({ commands, name: `${action} ${taskKeys.length} task(s)` }),
      });
      const updated = await api('/ctp/state');
      if (updated.tasks) setSolveResult(updated);
      setSelectedTasks(new Set());
      const labels: Record<string, string> = {
        dispatch: 'dispatched', start: 'started', hold: 'put on hold', resume: 'resumed', complete: 'completed',
      };
      showToast(`${taskKeys.length} task(s) ${labels[action] || action}`);
    } catch (err: any) {
      showToast(err.message || `${action} failed`, 'error');
    } finally {
      setActionLoading(null);
    }
  }, [showToast, queueMode, addToQueue, solveResult]);

  // Escape key to cancel WhereTo
  useEffect(() => {
    if (!whereToTaskKey) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelWhereTo(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [whereToTaskKey, cancelWhereTo]);

  // Analytics: load summary when tab opens, load detail when KPI selected
  const loadAnalyticsSummary = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await api('/analytics/summary');
      setAnalyticsKpis(data.kpis || []);
    } catch { setAnalyticsKpis([]); }
    finally { setAnalyticsLoading(false); }
  }, []);

  const handleSelectKpi = useCallback(async (key: string) => {
    setSelectedKpi(key);
    setAnalyticsDetail(null);
    setAnalyticsLoading(true);
    // Determine which endpoint to call based on KPI group
    const kpi = analyticsKpis.find((k: any) => k.key === key);
    if (!kpi) { setAnalyticsLoading(false); return; }
    try {
      if (kpi.group === 'Utilization') {
        const data = await api('/analytics/utilization');
        setAnalyticsDetail(data);
      } else if (kpi.group === 'Scheduling') {
        const data = await api('/analytics/scheduling');
        setAnalyticsDetail(data);
      } else if (kpi.group === 'Chain Integrity') {
        const data = await api('/analytics/chains');
        setAnalyticsDetail(data);
      } else if (kpi.group === 'Critical Path') {
        const data = await api('/analytics/critical-path');
        setAnalyticsDetail(data);
      } else if (kpi.group === 'Cost') {
        const data = await api('/analytics/cost');
        setAnalyticsDetail(data);
      }
    } catch { setAnalyticsDetail(null); }
    finally { setAnalyticsLoading(false); }
  }, [analyticsKpis]);

  // ── Configuration handlers ──
  const reloadConfigurations = useCallback(async () => {
    try {
      const configList = await api('/configurations');
      if (configList?.configurations) {
        setConfigurations(configList.configurations);
        setActiveConfigKey(configList.activeKey || 'default');
        const active = configList.configurations.find((c: any) => c.key === (configList.activeKey || 'default'));
        if (active) setActiveConfig(active);
      }
    } catch { /* ignore */ }
  }, []);

  const handleConfigActivate = useCallback(async (key: string) => {
    await api(`/configurations/${key}/activate`, { method: 'POST' });
    setActiveConfigKey(key);
    const config = configurations.find(c => c.key === key);
    if (config) {
      setActiveConfig(config);
      // Load config's settings into session state — this is the new baseline, not a modification
      setScoringOverrides(config.scoring ?? null);
      setSolverStrategy(config.strategy || 'Chain');
      setSelectedTier(config.tier || 'quick');
      // Reset baseline — config switch is a clean state, not stale
      setSolveStale(false);
      setPrevOrderModes({ ...orderModes });
      setPrevTaskPins({ ...taskPins });
      setPrevTaskExcludes({ ...taskExcludes });
      setPrevMaterialModes({ ...materialModeOverrides });
    }
  }, [configurations, orderModes, taskPins, taskExcludes, materialModeOverrides]);

  const handleConfigSetDefault = useCallback(async (key: string) => {
    await api(`/configurations/${key}/set-default`, { method: 'POST' });
    await reloadConfigurations();
  }, [reloadConfigurations]);

  const handleConfigDelete = useCallback(async (key: string) => {
    try {
      await api(`/configurations/${key}`, { method: 'DELETE' });
      // Optimistic removal then reload
      setConfigurations(prev => prev.filter(c => c.key !== key));
      await reloadConfigurations();
    } catch (err) {
      console.error('Delete config failed:', err);
      showToast('Failed to delete configuration', 'warning');
    }
  }, [reloadConfigurations, showToast]);

  const handleConfigDuplicate = useCallback(async (config: any) => {
    const name = prompt('Name for the duplicate:', `${config.name} (Copy)`);
    if (!name) return;
    await api('/configurations', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: config.description,
        scoring: config.scoring,
        strategy: config.strategy,
        tier: config.tier,
        suggestedExperienceLevel: config.suggestedExperienceLevel,
      }),
    });
    await reloadConfigurations();
  }, [reloadConfigurations]);

  const handleConfigRename = useCallback(async (key: string, newName: string) => {
    await api(`/configurations/${key}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
    await reloadConfigurations();
  }, [reloadConfigurations]);

  const handleConfigSave = useCallback(async () => {
    if (!activeConfig || !scoringOverrides) return;
    await api(`/configurations/${activeConfig.key}`, {
      method: 'PUT',
      body: JSON.stringify({
        scoring: scoringOverrides,
        strategy: solverStrategy,
        tier: selectedTier,
      }),
    });
    setScoringOverrides(null);
    await reloadConfigurations();
    showToast('Configuration saved');
  }, [activeConfig, scoringOverrides, solverStrategy, selectedTier, reloadConfigurations, showToast]);

  const handleConfigSaveAs = useCallback(async () => {
    if (!scoringOverrides) return;
    const name = prompt('Save as new configuration:');
    if (!name) return;
    await api('/configurations', {
      method: 'POST',
      body: JSON.stringify({
        name,
        scoring: scoringOverrides,
        strategy: solverStrategy,
        tier: selectedTier,
      }),
    });
    setScoringOverrides(null);
    await reloadConfigurations();
    showToast(`Configuration "${name}" created`);
  }, [scoringOverrides, solverStrategy, selectedTier, reloadConfigurations, showToast]);

  const handleConfigReset = useCallback(() => {
    setScoringOverrides(null);
    if (activeConfig) {
      setSolverStrategy(activeConfig.strategy || 'Chain');
      setSelectedTier(activeConfig.tier || 'quick');
    }
    showToast('Changes discarded');
  }, [activeConfig, showToast]);


  // Auto-load analytics summary when switching to Analytics tab
  useEffect(() => {
    if (activeTab === 'Analytics' && analyticsKpis.length === 0 && !analyticsLoading && solveResult) {
      loadAnalyticsSummary();
    }
  }, [activeTab, analyticsKpis.length, analyticsLoading, solveResult, loadAnalyticsSummary]);

  // Initial load
  useEffect(() => {
    document.body.style.margin = '0';
    document.body.style.background = C.bg;
    document.body.style.color = C.text;
    document.body.style.fontFamily = FONT;
    document.body.className = '';

    // Load DM Sans font
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // ── Loading state ──
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: C.text,
      }}>
        <div style={{
          width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.accent,
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <div style={{ marginTop: 16, color: C.textMuted, fontSize: 14 }}>Loading {t('tenantDisplayName', 'CTP Platform')}...</div>
      </div>
    );
  }

  // ── Render ──
  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.text, display: 'flex', flexDirection: 'column', paddingBottom: 24 }}>
      {/* Header */}
      <header style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', height: 56, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100,
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative' }}
            onMouseEnter={e => {
              const tip = e.currentTarget.querySelector('[data-about]') as HTMLElement;
              if (tip) tip.style.display = 'block';
            }}
            onMouseLeave={e => {
              const tip = e.currentTarget.querySelector('[data-about]') as HTMLElement;
              if (tip) tip.style.display = 'none';
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'default',
            }}>
              CT
            </div>
            <div data-about style={{
              display: 'none', position: 'absolute', top: 40, left: 0, zIndex: 2000,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: 16, minWidth: 280, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              fontSize: 12, fontFamily: FONT,
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: C.text }}>CTP Platform</div>
              {(() => {
                void solveResult?.summary;
                void solveResult?.stats;
                const formatUptime = (s: number) => {
                  const h = Math.floor(s / 3600);
                  const m = Math.floor((s % 3600) / 60);
                  return h > 0 ? `${h}h ${m}m` : `${m}m`;
                };
                const rows = [
                  { label: 'Version', value: versionInfo?.fullVersion || '—' },
                  { label: 'Branch', value: versionInfo?.gitBranch || '—' },
                  { label: 'Built', value: versionInfo?.buildDate ? fmtDate(versionInfo.buildDate) : '—' },
                  { label: 'Uptime', value: versionInfo?.uptime != null ? formatUptime(versionInfo.uptime) : '—' },
                  { label: 'Tenant', value: tenantId },
                ];
                return rows.map(r => (
                  <div key={r.label} style={{
                    display: 'flex', justifyContent: 'space-between', padding: '3px 0',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{ color: C.textMuted }}>{r.label}</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>{r.value}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>CTP Platform</span>
            <span style={{ color: C.textDim, fontSize: 13, marginLeft: 8 }}>{t('tenantDisplayName', 'CTP Platform')}</span>
          </div>
          {summary && (
            <span style={{ color: C.textMuted, fontSize: 12, marginLeft: 8, fontWeight: 500 }}>
              {fmtDateShort(summary.horizonStart)} – {fmtDateShort(summary.horizonEnd)}
            </span>
          )}
          {summary && (
            <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 10, display: 'flex', gap: 8, fontWeight: 500 }}>
              <span>{resources.length} {t('resources', 'resources')}</span>
              <span>{'\u00B7'}</span>
              <span>{summary.totalTasks} {t('tasks', 'tasks')}</span>
              <span>{'\u00B7'}</span>
              <span>{orders.length} {t('orders', 'orders')}</span>
            </span>
          )}
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Config switcher dropdown */}
          {activeConfig && (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setConfigDropdownOpen(!configDropdownOpen)} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: C.surface2, border: `1px solid ${C.border}`,
                  color: C.text, cursor: 'pointer', fontFamily: FONT,
                }}>
                  <span style={{ position: 'relative' }}>
                    {'\u2699'}
                    {isConfigModified && <span style={{
                      position: 'absolute', top: -2, right: -4,
                      width: 6, height: 6, borderRadius: '50%', background: C.yellow,
                    }} />}
                  </span>
                  {activeConfig.name}
                  <span style={{ fontSize: 8, color: C.textDim }}>{'\u25BE'}</span>
                </button>
                {configDropdownOpen && (
                  <>
                    <div onClick={() => setConfigDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                    <div style={{
                      position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 1000,
                      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: 220, padding: 4,
                      fontFamily: FONT,
                    }}>
                      {configurations.map(config => (
                        <div key={config.key}
                          onClick={() => { handleConfigActivate(config.key); setConfigDropdownOpen(false); }}
                          style={{
                            padding: '8px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            color: config.key === activeConfigKey ? C.accent : C.text,
                            fontWeight: config.key === activeConfigKey ? 600 : 400,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}10`; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {config.isDefault && <span style={{ color: C.green, fontSize: 10 }}>{'\u2605'}</span>}
                            {config.key === activeConfigKey && <span style={{ color: C.accent, fontSize: 8 }}>{'\u25CF'}</span>}
                            {config.name}
                          </span>
                          <span style={{ fontSize: 10, color: C.textDim }}>{config.strategy}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
          )}
          <button
            onClick={() => setQueueMode(m => !m)}
            style={{
              fontSize: 11, padding: '5px 10px', borderRadius: 6,
              background: queueMode ? C.accent + '20' : 'transparent',
              border: `1px solid ${queueMode ? C.accent : C.border}`,
              color: queueMode ? C.accent : C.textMuted,
              cursor: 'pointer', fontWeight: queueMode ? 700 : 400,
              fontFamily: FONT,
            }}
            title="Toggle queue mode — actions are staged instead of executed immediately"
          >
            {queueMode ? '\uD83D\uDCCB Queuing' : 'Queue'}
            {actionQueue.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, color: C.accent }}>({actionQueue.length})</span>}
          </button>
          <button
            onClick={(e) => {
              if (queueMode) {
                const selKeys = Array.from(selectedTasks);
                if (selKeys.length > 0) {
                  addToQueue(`Solve targeted (${selKeys.length} tasks)`, { type: 'solve', taskKeys: selKeys, scope: 'targeted', expandChains: true });
                } else {
                  addToQueue('Solve all', { type: 'solve', scope: 'full' });
                }
                return;
              }
              if (e.shiftKey) { handleSolveConfirm(); }
              else { setShowSolvePreview(true); }
            }}
            disabled={solving || !scoringValid}
            title={!scoringValid ? `Scoring rules must sum to 100% (currently ${scoringWeightPct}%)` : queueMode ? 'Click to queue a solve action' : 'Click to preview, Shift+Click to solve immediately'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8, border: 'none',
              background: !scoringValid ? C.red : solving ? C.textDim : C.accent, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: solving || !scoringValid ? 'default' : 'pointer',
              fontFamily: FONT, transition: 'background 0.15s',
              opacity: !scoringValid ? 0.8 : 1,
            }}
          >
            {solving ? (
              <>
                <span style={{
                  width: 14, height: 14, border: `2px solid rgba(255,255,255,0.3)`,
                  borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }} />
                {t('solving', 'Solving')}…
              </>
            ) : solveStale ? (
              <>▶ Review & {t('solve', 'Solve')}</>
            ) : (
              <>▶ {t('solve', 'Solve All')}</>
            )}
          </button>
          {!scoringValid && (
            <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
              Scoring rules must sum to 100% ({scoringWeightPct}%)
            </span>
          )}
          <button
            onClick={handleStartReplay}
            disabled={solving || replay.active}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: replay.active ? C.purple : 'none',
              color: replay.active ? '#fff' : solveResult ? C.text : C.textDim,
              fontSize: 12, fontWeight: 600, cursor: solveResult && !solving ? 'pointer' : 'default',
              fontFamily: FONT, transition: 'background 0.15s',
              opacity: solveResult && !solving ? 1 : 0.5,
            }}
            title={solveResult?.solveSteps?.length > 0 ? 'Replay last solve' : 'Re-solve with step recording, then replay'}
          >
            {replay.active ? '⏸ Replaying' : '⟳ Replay'}
          </button>
          <button
            onClick={handleOpenCTPDialog}
            disabled={!solveResult}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: showCTPDialog ? C.green : 'none',
              color: showCTPDialog ? '#fff' : solveResult ? C.text : C.textDim,
              fontSize: 12, fontWeight: 600, cursor: solveResult ? 'pointer' : 'default',
              fontFamily: FONT, transition: 'background 0.15s',
              opacity: solveResult ? 1 : 0.5,
            }}
            title="CTP Query — evaluate when a new order can be scheduled"
          >
            CTP Query
          </button>
          <button
            onClick={() => { setChatOpen(o => !o); setChatCollapsed(false); }}
            style={{
              background: chatOpen ? C.accent : 'none', border: 'none',
              color: chatOpen ? '#fff' : C.textMuted, fontSize: 12,
              cursor: 'pointer', padding: '4px 8px', borderRadius: 4, lineHeight: 1, fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            title="Scheduling Assistant"
          >
            <span style={{ fontSize: 14 }}>💬</span>
            <span style={{ fontWeight: 600 }}>Ask AI</span>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              background: 'none', border: 'none', color: C.textMuted, fontSize: 12,
              cursor: 'pointer', padding: '4px 8px', lineHeight: 1, fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            title="Settings — change experience level"
          >
            <span style={{ fontSize: 14 }}>
              {EXPERIENCE_LEVELS.find(l => l.value === experienceLevel)?.icon || '⚙'}
            </span>
            <span style={{ fontWeight: 600 }}>
              {EXPERIENCE_LEVELS.find(l => l.value === experienceLevel)?.label || 'Settings'}
            </span>
          </button>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: error ? C.red : C.green,
          }} title={error ? 'Error' : 'Connected'} />
          <button
            onClick={() => setUserOpen(true)}
            style={{
              width: 32, height: 32, borderRadius: '50%', background: C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer',
            }}
            title="User Profile"
          >
            JD
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <nav style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', display: 'flex', gap: 0,
      }}>
        {TABS.map(tab => {
          const conflictCount = tab === 'Conflicts' ? deriveConflicts(tasks, resources, materials).length : 0;
          const shortageCount = tab === 'Materials' ? materials.filter((m: any) => deriveMaterialStatus(m) === 'shortage').length : 0;
          const badge = tab === 'Conflicts' ? conflictCount : tab === 'Materials' ? shortageCount : 0;
          const hasConfigChanges = tab === 'Configurations' && isConfigModified;
          return (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); if (tab !== 'Schedule') { if (whereToTaskKey && whereToSource !== 'panel') { setWhereToTaskKey(null); setWhereToOptions([]); setWhereToCurrentAssignment(null); setWhereToSource(null); } if (scheduleCaseFilter) setScheduleCaseFilter(null); } if (tab !== 'Orders' && ordersCaseFilter) setOrdersCaseFilter(null); }}
              style={{
                padding: '12px 20px', background: 'none', border: 'none',
                borderBottom: tab === activeTab ? `2px solid ${C.accent}` : '2px solid transparent',
                color: tab === activeTab ? C.text : C.textMuted,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                transition: 'color 0.15s, border-color 0.15s',
                display: 'flex', alignItems: 'center', gap: 0,
              }}
            >
              {t(tab.toLowerCase(), tab)}
              {badge > 0 && (
                <span style={{
                  marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  background: C.redDim, color: C.red, fontWeight: 700,
                }}>{badge}</span>
              )}
              {hasConfigChanges && (
                <span style={{
                  marginLeft: 6, width: 8, height: 8, borderRadius: '50%',
                  background: C.yellow, display: 'inline-block',
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Error banner */}
      {error && (
        <div style={{
          margin: '16px 24px 0', padding: '12px 18px', borderRadius: 10,
          background: C.redDim, border: `1px solid ${C.red}33`,
          display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT,
        }}>
          <span style={{ color: C.red, fontWeight: 700, fontSize: 12 }}>Error</span>
          <span style={{ color: C.red, fontSize: 13, fontWeight: 500, flex: 1 }}>{error}</span>
          <button
            onClick={() => { setError(null); loadData(); }}
            style={{
              background: C.red, color: '#fff', border: 'none', borderRadius: 6,
              padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            }}
          >
            {act('retry', 'Retry')}
          </button>
          <button
            onClick={() => setError(null)}
            style={{
              background: 'none', border: 'none', color: C.red, cursor: 'pointer',
              fontSize: 16, padding: '2px 6px', lineHeight: 1, opacity: 0.7,
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Stale override banner */}
      {solveStale && (
        <div style={{
          margin: '0 24px', padding: '8px 16px', borderRadius: 8,
          background: C.yellowDim, borderLeft: `3px solid ${C.yellow}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontFamily: FONT, fontSize: 13, color: C.text,
        }}>
          <span>
            ⚠ Changes pending
            {(() => {
              const parts: string[] = [];
              const om = Object.values(orderModes).filter(v => v !== 'INCLUDE').length;
              if (om > 0) parts.push(`${om} order mode${om > 1 ? 's' : ''}`);
              const tp = Object.values(taskPins).filter(Boolean).length;
              if (tp > 0) parts.push(`${tp} pinned`);
              const te = Object.values(taskExcludes).filter(Boolean).length;
              if (te > 0) parts.push(`${te} excluded`);
              const tu = taskUnschedules.size;
              if (tu > 0) parts.push(`${tu} unschedule`);
              const mm = Object.keys(materialModeOverrides).length;
              if (mm > 0) parts.push(`${mm} material mode${mm > 1 ? 's' : ''}`);
              const rm = Object.keys(resourceModeOverrides).length;
              if (rm > 0) parts.push(`${rm} resource mode${rm > 1 ? 's' : ''}`);
              const po = Object.keys(priorityOverrides).length;
              if (po > 0) parts.push(`${po} priority override${po > 1 ? 's' : ''}`);
              const wo = Object.keys(windowOverrides).length;
              if (wo > 0) parts.push(`${wo} window override${wo > 1 ? 's' : ''}`);
              return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
            })()}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                setOrderModes({});
                setTaskPins({});
                setTaskExcludes({});
                setTaskUnschedules(new Set());
                setMaterialModeOverrides({});
                setResourceModeOverrides({});
                setPriorityOverrides({});
                setWindowOverrides({});
                setSolveStale(false);
              }}
              style={{
                background: 'none', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6,
                padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: FONT, whiteSpace: 'nowrap',
              }}
            >
              Reset
            </button>
            <button
              onClick={() => setShowSolvePreview(true)}
              style={{
                background: C.yellow, color: C.bg, border: 'none', borderRadius: 6,
                padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: FONT, whiteSpace: 'nowrap',
              }}
            >
              Review & {t('solve', 'Solve')}
            </button>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <main style={{ padding: 24, flex: 1, overflow: 'auto' }}>
        {activeTab === 'Overview' && (
          <OverviewTab summary={summary} tasks={tasks} resources={resources}
            orders={orders} materials={materials} products={products} colors={colors} onTabChange={setActiveTab}
            onTaskClick={handleTaskClick} onResourceClick={handleResourceClick}
            experienceLevel={experienceLevel}
            criticalPath={solveResult?.criticalPath}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes}
            onPinTask={(key, pinned) => {
              setTaskPins(prev => ({ ...prev, [key]: pinned }));
              if (pinned) setTaskExcludes(prev => ({ ...prev, [key]: false }));
              setSolveStale(true);
            }}
            onExcludeTask={(key, excluded) => {
              setTaskExcludes(prev => ({ ...prev, [key]: excluded }));
              if (excluded) setTaskPins(prev => ({ ...prev, [key]: false }));
              setSolveStale(true);
            }}
            onUnscheduleTask={(key) => {
              setTaskUnschedules(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              });
              setSolveStale(true);
            }}
            onWhereTo={handleWhereTo}
            zoomLevel={ganttZoomLevel} setZoomLevel={setGanttZoomLevel}
            scrollOffset={ganttScrollOffset} setScrollOffset={setGanttScrollOffset}
            onViewAgenda={(r: any) => { setSelectedTask(null); setSelectedResource(null); setAgendaResource(r); }} />
        )}
        {activeTab === 'Schedule' && (
          <ScheduleTab tasks={tasks} resources={resources} products={products} colors={colors}
            orders={orders}
            onTaskClick={handleTaskClick} onResourceClick={handleResourceClick}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes}
            experienceLevel={experienceLevel}
            onPinTask={(key, pinned) => {
              setTaskPins(prev => ({ ...prev, [key]: pinned }));
              if (pinned) setTaskExcludes(prev => ({ ...prev, [key]: false }));
              setSolveStale(true);
            }}
            onExcludeTask={(key, excluded) => {
              setTaskExcludes(prev => ({ ...prev, [key]: excluded }));
              if (excluded) setTaskPins(prev => ({ ...prev, [key]: false }));
              setSolveStale(true);
            }}
            onUnscheduleTask={(key) => {
              setTaskUnschedules(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              });
              setSolveStale(true);
            }}
            onApiUnschedule={handleApiUnschedule} onApiPin={handleApiPin}
            onApiSchedule={handleApiSchedule} actionLoading={actionLoading}
            onApiBulkUnschedule={handleApiBulkUnschedule} onApiBulkPin={handleApiBulkPin}
            onWhereTo={handleWhereTo} whereToTaskKey={whereToTaskKey}
            whereToOptions={whereToOptions} whereToLoading={whereToLoading}
            whereToCurrentAssignment={whereToCurrentAssignment}
            whereToSource={whereToSource}
            onMoveTo={handleMoveTo} onCancelWhereTo={cancelWhereTo}
            caseFilter={scheduleCaseFilter} onClearCaseFilter={() => setScheduleCaseFilter(null)}
            onNavigateToOrders={(orderKey) => { setOrdersCaseFilter(orderKey); setActiveTab('Orders'); }}
            selectedTasks={selectedTasks}
            onToggleSelect={(key) => {
              setSelectedTasks(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              });
            }}
            onSetSelectedTasks={setSelectedTasks}
            onScheduleSelected={(keys: string[], e?: any) => { handleBulkSchedule(keys, e); }}
            onUnscheduleSelected={(keys: string[], e?: any) => { handleApiBulkUnschedule(keys, e); }}
            onPinSelected={(keys: string[], e?: any) => { handleApiBulkPin(keys, true, e); }}
            onUnpinSelected={(keys: string[], e?: any) => { handleApiBulkPin(keys, false, e); }}
            onExcludeSelected={(keys) => {
              setTaskExcludes(prev => { const next = { ...prev }; keys.forEach(k => { next[k] = true; }); return next; });
              setSelectedTasks(new Set());
              setSolveStale(true);
            }}
            onIncludeSelected={(keys) => {
              setTaskExcludes(prev => { const next = { ...prev }; keys.forEach(k => { next[k] = false; }); return next; });
              setSelectedTasks(new Set());
              setSolveStale(true);
            }}
            onSetResourcePreference={() => setShowResourcePrefDialog(true)}
            onSetResourcePrefForTask={(taskKey) => {
              setSelectedTasks(new Set([taskKey]));
              setShowResourcePrefDialog(true);
            }}
            resourcePreferenceOverrides={resourcePreferenceOverrides}
            priorityOverrides={priorityOverrides}
            onSetPriority={(key, pri) => {
              setPriorityOverrides(prev => ({ ...prev, [key]: pri }));
              setSolveStale(true);
            }}
            onRushSelected={(keys: string[], e?: any) => {
              if (queueMode || e?.shiftKey) {
                for (const key of keys) {
                  const t = (solveResult?.tasks || []).find((tt: any) => tt.key === key);
                  addToQueue(`Rush ${t?.name || key}`, { type: 'set_priority', taskKey: key, priority: 1 });
                }
                setSelectedTasks(new Set());
                return;
              }
              setPriorityOverrides(prev => {
                const next = { ...prev };
                keys.forEach(k => { next[k] = 1; });
                return next;
              });
              setSelectedTasks(new Set());
              setSolveStale(true);
              showToast(`${keys.length} task(s) set to RUSH priority`);
            }}
            zoomLevel={ganttZoomLevel} setZoomLevel={setGanttZoomLevel}
            scrollOffset={ganttScrollOffset} setScrollOffset={setGanttScrollOffset}
            onViewAgenda={(r: any) => { setSelectedTask(null); setSelectedResource(null); setAgendaResource(r); }}
            onOpenDowntimeEditor={openDowntimeEditor}
            onAskAI={handleAskAI}
            replay={replay} onReplayStep={handleReplayStep}
            onReplayJumpStart={handleReplayJumpStart} onReplayJumpEnd={handleReplayJumpEnd}
            onReplayTogglePlay={handleReplayTogglePlay} onReplaySpeedChange={handleReplaySpeedChange}
            onReplayExit={handleReplayExit} onReplayJumpToStep={handleReplayJumpToStep}
            ctpGhostBars={ctpGhostBars} isQueuing={isQueuing}
            onToolbarAction={handleToolbarAction} />
        )}
        {activeTab === 'Orders' && <OrdersTab orders={orders} products={products} tasks={tasks}
          orderModes={orderModes} taskPins={taskPins} taskExcludes={taskExcludes}
          onOrderModeChange={(key: string, mode: string) => {
            if (queueMode) {
              addToQueue(`Set order ${key} → ${mode}`, { type: 'set_order_mode', orderKey: key, mode });
              return;
            }
            setOrderModes(prev => ({ ...prev, [key]: mode })); setSolveStale(true);
          }}
          caseFilter={ordersCaseFilter} onClearCaseFilter={() => setOrdersCaseFilter(null)} />}
        {activeTab === 'Conflicts' && <ConflictsTab tasks={tasks} resources={resources} materials={materials}
          onTaskClick={handleTaskClickByKey} />}
        {activeTab === 'Materials' && <MaterialsTab materials={materials}
          materialModes={materialModeOverrides}
          onMaterialModeChange={(key, mode) => { setMaterialModeOverrides(prev => ({ ...prev, [key]: mode })); setSolveStale(true); }} />}
        {activeTab === 'Configurations' && <ConfigurationsTab
          configurations={configurations} activeConfigKey={activeConfigKey}
          onActivate={handleConfigActivate} onSetDefault={handleConfigSetDefault}
          onDelete={handleConfigDelete} onDuplicate={handleConfigDuplicate}
          onRename={handleConfigRename}
          isModified={isConfigModified} modifiedConfig={modifiedConfig} activeConfig={activeConfig}
          onSave={handleConfigSave} onSaveAs={handleConfigSaveAs} onReset={handleConfigReset} />}
        {activeTab === 'Analytics' && <AnalyticsTab kpis={analyticsKpis} detail={analyticsDetail}
          selectedKpi={selectedKpi} onSelectKpi={handleSelectKpi} loading={analyticsLoading}
          experienceLevel={experienceLevel} onNavigateToCase={(caseKey) => { setScheduleCaseFilter(caseKey); setActiveTab('Schedule'); }}
          tasks={tasks} onNavigateToConflicts={() => setActiveTab('Conflicts')} />}
      </main>
      <ChatPanel solveResult={solveResult} open={chatOpen} onClose={() => setChatOpen(false)} selectedTask={selectedTask} initialInput={chatInitialInput} onChatAction={handleChatAction} collapsed={chatCollapsed} onCollapsedExpand={() => setChatCollapsed(false)} onCollapse={() => setChatCollapsed(true)} onScheduleChanged={async () => {
        const updated = await api('/ctp/state?detailLevel=' + experienceLevel);
        if (updated?.tasks) setSolveResult((prev: any) => ({ ...prev, ...updated }));
      }} />
      </div>

      {/* Modals */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" width={860}>
        <SettingsContent
          experienceLevel={experienceLevel}
          onExperienceChange={handleExperienceChange}
          stats={solveResult?.stats}
          solveResult={solveResult}
          scoringRules={activeScoringRules}
          onScoringRulesChange={handleScoringRulesChange}
          scoringSource={scoringSource}
          configName={activeConfig?.name}
        />
      </Modal>
      <Modal open={userOpen} onClose={() => setUserOpen(false)} title="User Profile">
        <UserProfileContent />
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={async () => {
              setUserOpen(false);
              setSolving(true);
              showToast('Syncing...');
              try {
                setError(null);
                await api('/state/sync', { method: 'POST' });
                const freshState = await api('/ctp/state');
                setSolveResult(freshState);
                setSolveStale(false);
                setResourcePreferenceOverrides({});
                setPriorityOverrides({});
                setWindowOverrides({});
                setTaskUnschedules(new Set());
                setTaskPins({});
                setTaskExcludes({});
                setOrderModes({});
                setMaterialModeOverrides({});
                setResourceModeOverrides({});
                setSelectedTasks(new Set());
                setSelectedTask(null);
                setSelectedResource(null);
                setWhereToTaskKey(null); setWhereToOptions([]); setWhereToCurrentAssignment(null);
                setAnalyticsKpis([]); setAnalyticsDetail(null); setSelectedKpi(null);
                if (freshState.colors) setColors(freshState.colors);
                if (freshState.terminology) _terminology = freshState.terminology;
                if (freshState.locale) _locale = freshState.locale;
                showToast('Data reloaded — all tasks unscheduled');
              } catch (e: any) {
                setError(e.message || 'Sync failed');
                showToast('Sync failed');
              } finally {
                setSolving(false);
              }
            }}
            disabled={solving}
            style={{
              width: '100%', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2,
              color: solving ? C.textDim : C.text, cursor: solving ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {solving ? '⏳ Syncing...' : '🔄 Sync'}
          </button>
          <button
            onClick={async () => {
              setUserOpen(false);
              setSolving(true);
              showToast('Syncing and solving...');
              try {
                setError(null);
                const result = await api('/ctp/solve-and-sync', {
                  method: 'POST',
                  body: JSON.stringify({ detailLevel: experienceLevel }),
                });
                setSolveResult(result);
                setSolveStale(false);
                setResourcePreferenceOverrides({});
                setPriorityOverrides({});
                setWindowOverrides({});
                setTaskUnschedules(new Set());
                setTaskPins({});
                setTaskExcludes({});
                setOrderModes({});
                setMaterialModeOverrides({});
                setResourceModeOverrides({});
                setSelectedTasks(new Set());
                setSelectedTask(null);
                setSelectedResource(null);
                setWhereToTaskKey(null); setWhereToOptions([]); setWhereToCurrentAssignment(null);
                setAnalyticsKpis([]); setAnalyticsDetail(null); setSelectedKpi(null);
                if (result.colors) setColors(result.colors);
                if (result.terminology) _terminology = result.terminology;
                if (result.locale) _locale = result.locale;
                showToast('Data reloaded and solved');
              } catch (e: any) {
                setError(e.message || 'Sync & Solve failed');
                showToast('Sync & Solve failed');
              } finally {
                setSolving(false);
              }
            }}
            disabled={solving}
            style={{
              width: '100%', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2,
              color: solving ? C.textDim : C.accent, cursor: solving ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {solving ? '⏳ Solving...' : '🔄 Sync & Solve'}
          </button>
          <div style={{ fontSize: 10, color: C.textDim, textAlign: 'center' }}>
            Sync reloads config from disk. Sync & Solve also runs the scheduler.
          </div>
        </div>
      </Modal>

      {/* Detail Panels */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          tasks={tasks}
          products={products}
          colors={colors}
          onClose={() => setSelectedTask(null)}
          onResourceClick={handleResourceClick}
          taskPins={taskPins}
          taskExcludes={taskExcludes}
          taskUnschedules={taskUnschedules}
          orderModes={orderModes}
          onPinTask={(key, pinned) => {
            setTaskPins(prev => ({ ...prev, [key]: pinned }));
            if (pinned) setTaskExcludes(prev => ({ ...prev, [key]: false }));
            setSolveStale(true);
          }}
          onExcludeTask={(key, excluded) => {
            setTaskExcludes(prev => ({ ...prev, [key]: excluded }));
            if (excluded) setTaskPins(prev => ({ ...prev, [key]: false }));
            setSolveStale(true);
          }}
          onUnscheduleTask={(key) => {
            setTaskUnschedules(prev => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
            setSolveStale(true);
          }}
          onCancelUnschedule={(key) => {
            setTaskUnschedules(prev => { const s = new Set(prev); s.delete(key); return s; });
          }}
          resourceModeOverrides={resourceModeOverrides}
          onResourceModeChange={(compoundKey, mode) => {
            setResourceModeOverrides(prev => ({ ...prev, [compoundKey]: mode }));
            setSolveStale(true);
          }}
          onApiUnschedule={handleApiUnschedule}
          onApiPin={handleApiPin}
          experienceLevel={experienceLevel}
          whereToTaskKey={whereToTaskKey}
          whereToOptions={whereToOptions}
          onMoveTo={handleMoveTo}
          onNavigateToOrders={(orderKey) => {
            setOrdersCaseFilter(orderKey);
            setActiveTab('Orders');
          }}
          onTaskClick={(t) => setSelectedTask(t)}
          resourcePreferenceOverrides={resourcePreferenceOverrides}
          onResourcePrefChange={(taskKey, resourceKey, mode) => {
            setResourcePreferenceOverrides(prev => {
              const next = { ...prev };
              const taskOverrides = { ...(next[taskKey] || {}) };
              if (mode === 'AVAILABLE') {
                delete taskOverrides[resourceKey];
              } else {
                taskOverrides[resourceKey] = mode;
              }
              if (Object.keys(taskOverrides).length > 0) {
                next[taskKey] = taskOverrides;
              } else {
                delete next[taskKey];
              }
              return next;
            });
            setSolveStale(true);
          }}
          onClearResourceOverrides={handleClearResourceOverrides}
          windowOverrides={windowOverrides}
          onSetWindowOverride={(key, win) => {
            setWindowOverrides(prev => ({ ...prev, [key]: win }));
            setSolveStale(true);
          }}
          priorityOverrides={priorityOverrides}
          onSetPriority={(key, pri) => {
            setPriorityOverrides(prev => ({ ...prev, [key]: pri }));
            setSolveStale(true);
          }}
          onApiSchedule={handleApiSchedule}
          actionLoading={actionLoading}
          onWhereTo={handleWhereTo}
          whereToSource={whereToSource}
          whereToLoading={whereToLoading}
          onAskAI={handleAskAI}
        />
      )}
      {selectedResource && (
        <ResourceDetailPanel
          resource={selectedResource}
          tasks={tasks}
          colors={colors}
          onClose={() => setSelectedResource(null)}
          onTaskClick={handleTaskClick}
          onOpenDowntimeEditor={(rk: string) => { setSelectedResource(null); setDowntimeResource(rk); }}
        />
      )}
      {agendaResource && (
        <ResourceAgendaPanel
          resource={agendaResource}
          tasks={tasks}
          colors={colors}
          horizonStart={summary?.horizonStart}
          horizonEnd={summary?.horizonEnd}
          onClose={() => setAgendaResource(null)}
          onTaskClick={(t: any) => { setAgendaResource(null); handleTaskClick(t); }}
          onOpenDowntimeEditor={(rk: string) => { setAgendaResource(null); setDowntimeResource(rk); }}
        />
      )}
      {/* Downtime Editor Panel */}
      {downtimeResource && (
        <DowntimeEditorPanel
          resourceKey={downtimeResource}
          resources={resources}
          onClose={() => setDowntimeResource(null)}
          onStale={() => {
            setSolveStale(true);
            api(`/ctp/state?detailLevel=${experienceLevel}`)
              .then(r => setSolveResult(r)).catch(() => {});
          }}
          onToast={(msg) => showToast(msg)}
          isQueuing={isQueuing}
          onQueue={addToQueue}
        />
      )}

      {/* Resource Preference Dialog */}
      <ResourcePreferenceDialog
        open={showResourcePrefDialog}
        onClose={() => setShowResourcePrefDialog(false)}
        selectedTaskKeys={Array.from(selectedTasks)}
        tasks={tasks}
        resourcePreferenceOverrides={resourcePreferenceOverrides}
        onApply={handleApplyPreferences}
        onApplyAndSolve={handleApplyAndSolve}
      />

      {/* Solve Preview */}
      {showSolvePreview && (
        <SolvePreview
          orders={orders}
          tasks={tasks}
          materials={materials}
          resources={resources}
          orderModes={orderModes}
          taskPins={taskPins}
          taskExcludes={taskExcludes}
          taskUnschedules={taskUnschedules}
          materialModes={materialModeOverrides}
          modeOverrides={resourceModeOverrides}
          resourcePreferenceOverrides={resourcePreferenceOverrides}
          priorityOverrides={priorityOverrides}
          windowOverrides={windowOverrides}
          previousOrderModes={prevOrderModes}
          previousTaskPins={prevTaskPins}
          previousTaskExcludes={prevTaskExcludes}
          previousMaterialModes={prevMaterialModes}
          strategy={solverStrategy}
          onStrategyChange={setSolverStrategy}
          strategyOptions={strategyOptions}
          tier={selectedTier}
          onTierChange={handleTierChange}
          tierOptions={tierOptions}
          experienceLevel={experienceLevel}
          configName={activeConfig?.name}
          scoringSummary={activeScoringRules.filter(r => r.includeInSolve).slice(0, 6).map(r => `${RULE_ABBREV[r.ruleName] || displayRuleName(r.ruleName)} ${Math.round(r.weight * 100)}%`).join(' \u00B7 ')}
          onConfirm={handleSolveConfirm}
          onCancel={handleSolveCancel}
        />
      )}

      {/* Solve Results Dialog */}
      {showSolveResults && solveResult && (
        <SolveResultsDialog
          result={solveResult}
          previousSnapshot={previousSolveSnapshot}
          experienceLevel={experienceLevel}
          onClose={() => setShowSolveResults(false)}
          onTaskClick={(t) => { setSelectedTask(t); setSelectedResource(null); }}
          onViewProblems={() => {
            // Switch to schedule tab — infeasible tasks are visible there
            setActiveTab('Schedule');
          }}
        />
      )}

      {/* CTP Query Dialog */}
      {showCTPDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          paddingTop: 80, background: 'rgba(0,0,0,0.5)',
        }} onClick={(e) => { if (e.target === e.currentTarget) handleCTPClose(); }}>
          <div style={{
            background: C.surface, borderRadius: 12, padding: 0,
            width: ctpResult?.feasible ? 720 : 480, maxHeight: '80vh',
            border: `1px solid ${C.border}`, boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONT }}>
                  CTP Query — When Can I Schedule This?
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, fontFamily: FONT }}>
                  Evaluate placement options without changing the schedule
                </div>
              </div>
              <button onClick={handleCTPClose} style={{
                background: 'none', border: 'none', color: C.textMuted,
                fontSize: 18, cursor: 'pointer', padding: 4, lineHeight: 1,
              }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
              {/* Input form — always visible */}
              <CTPQueryForm
                templates={ctpTemplates}
                loading={ctpLoading}
                onEvaluate={handleCTPEvaluate}
              />

              {/* Results */}
              {ctpLoading && (
                <div style={{ textAlign: 'center', padding: 24, color: C.textMuted, fontSize: 13, fontFamily: FONT }}>
                  Evaluating placement options...
                </div>
              )}

              {ctpResult && !ctpLoading && (
                <div style={{ marginTop: 16 }}>
                  {/* Promise Summary Banner */}
                  {ctpResult.summary && (() => {
                    const s = ctpResult.summary;
                    if (s.feasibleOptions === 0) {
                      return (
                        <div style={{
                          padding: '14px 18px', borderRadius: 10, marginBottom: 16,
                          background: C.redDim, border: `1px solid ${C.red}`,
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.red, fontFamily: FONT }}>
                            Cannot fulfill this order
                          </div>
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                            No feasible placement found within the current schedule.
                          </div>
                        </div>
                      );
                    }
                    const statusConfig: Record<string, { bg: string; border: string; color: string; icon: string }> = {
                      'on-time':     { bg: C.greenDim,  border: C.green,  color: C.green,  icon: '\u2713' },
                      'tight':       { bg: C.yellowDim, border: C.yellow, color: C.yellow, icon: '\u26A0' },
                      'cannot-meet': { bg: C.redDim,    border: C.red,    color: C.red,    icon: '\u2717' },
                    };
                    const config = s.promiseStatus
                      ? statusConfig[s.promiseStatus]
                      : { bg: C.accentGlow, border: C.accent, color: C.accent, icon: '\uD83D\uDCC5' };
                    const statusLabel = s.promiseStatus === 'on-time' ? 'Can deliver'
                      : s.promiseStatus === 'tight' ? 'Tight \u2014 minimal buffer'
                      : s.promiseStatus === 'cannot-meet' ? 'Cannot meet need-by date'
                      : 'Earliest delivery';
                    return (
                      <div style={{
                        padding: '14px 18px', borderRadius: 10, marginBottom: 16,
                        background: config.bg, border: `1px solid ${config.border}`,
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: config.color, fontFamily: FONT }}>
                          {config.icon} {statusLabel}: {fmtDate(s.earliestCompletionDate)}
                        </div>
                        {s.earliestCompletionResources && (
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                            via {s.earliestCompletionResources}
                          </div>
                        )}
                        {s.needByDate && s.promiseSlackDays != null && (
                          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, fontFamily: FONT }}>
                            {s.promiseSlackDays >= 0
                              ? `${s.promiseSlackDays} day${Math.abs(s.promiseSlackDays) !== 1 ? 's' : ''} before need-by date (${fmtDateShort(s.needByDate)})`
                              : `${Math.abs(s.promiseSlackDays)} day${Math.abs(s.promiseSlackDays) !== 1 ? 's' : ''} after need-by date (${fmtDateShort(s.needByDate)})`
                            }
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, fontFamily: FONT }}>
                          {s.feasibleOptions} option{s.feasibleOptions !== 1 ? 's' : ''} found
                          {s.latestCompletionDate && s.earliestCompletionDate !== s.latestCompletionDate
                            ? ` \u00B7 ${fmtDateShort(s.earliestCompletionDate)} \u2013 ${fmtDateShort(s.latestCompletionDate)} range`
                            : ''
                          }
                        </div>
                      </div>
                    );
                  })()}

                  {/* Infeasible state with bottleneck */}
                  {!ctpResult.feasible && ctpResult.infeasibilityReport && (
                    <div style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                      {ctpResult.infeasibilityReport.shortSummary && (
                        <div style={{
                          padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                          background: C.bg, border: `1px solid ${C.border}`,
                          fontWeight: 500, color: C.text,
                        }}>
                          {ctpResult.infeasibilityReport.shortSummary}
                        </div>
                      )}
                      <div style={{ fontWeight: 600, marginBottom: 6, color: C.text }}>Suggestions</div>
                      <div style={{ lineHeight: 1.8 }}>
                        <div>{'\u2022'} Try a later need-by date to widen the search window</div>
                        <div>{'\u2022'} Check the bottleneck resource's agenda for work that could be deferred</div>
                        <div>{'\u2022'} Free up capacity by excluding lower-priority orders</div>
                      </div>
                    </div>
                  )}

                  {/* Feasible options — collapsible cards */}
                  {ctpResult.feasible && ctpResult.options?.length > 0 && (
                    <div>
                      {ctpResult.options.map((option: any, idx: number) => {
                        const isActive = ctpSelectedOption === idx;
                        const isEarliest = idx === 0;
                        const lastTask = option.tasks[option.tasks.length - 1];
                        const completionDate = lastTask?.end;
                        const resourceChain = option.tasks
                          .filter((t: any) => t.taskType === 'PROCESS' || !t.taskType)
                          .map((t: any) => t.resources.map((r: any) => r.resourceName || r.resourceKey).join(', '))
                          .join(' \u2192 ');

                        return (
                          <CTPOptionCardInner
                            key={idx}
                            option={option}
                            isActive={isActive}
                            isEarliest={isEarliest}
                            completionDate={completionDate}
                            resourceChain={resourceChain}
                            onSelect={() => setCTPSelectedOption(idx)}
                            onBook={() => handleCTPBook(ctpResult.sourceChainKey, ctpResult.orderName, option)}
                          />
                        );
                      })}
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8, fontFamily: FONT }}>
                        Schedule is unchanged. Click "Schedule" to add to the schedule.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Queue Panel */}
      {(actionQueue.length > 0 || queueResult) && (
        <div style={{
          position: 'fixed', bottom: versionInfo ? 28 : 4, left: 0, right: 0,
          background: C.surface, borderTop: `2px solid ${C.accent}`,
          padding: '8px 16px', zIndex: 100,
          boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, fontFamily: FONT }}>
              ACTION QUEUE ({actionQueue.length} step{actionQueue.length !== 1 ? 's' : ''})
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={clearQueue} disabled={queueExecuting}
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted, cursor: 'pointer', fontFamily: FONT }}>
                Clear All
              </button>
              <button onClick={() => setShowExecuteConfirm(true)} disabled={queueExecuting || actionQueue.length === 0}
                style={{
                  fontSize: 11, padding: '3px 14px', borderRadius: 6, fontWeight: 700, fontFamily: FONT,
                  background: queueExecuting ? C.surface2 : C.accent, border: 'none',
                  color: queueExecuting ? C.textMuted : '#fff', cursor: queueExecuting ? 'default' : 'pointer',
                }}>
                {queueExecuting ? 'Executing...' : `Execute All (${actionQueue.length})`}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {actionQueue.map((action, index) => (
              <div key={action.id} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 6, background: C.surface2, border: `1px solid ${C.border}`,
                fontSize: 11, color: C.text, fontFamily: FONT,
              }}>
                {index > 0 && (
                  <button onClick={() => reorderQueue(index, 'up')} disabled={queueExecuting}
                    style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: '0 1px', fontSize: 10 }}>
                    {'\u25B2'}
                  </button>
                )}
                {index < actionQueue.length - 1 && (
                  <button onClick={() => reorderQueue(index, 'down')} disabled={queueExecuting}
                    style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: '0 1px', fontSize: 10 }}>
                    {'\u25BC'}
                  </button>
                )}
                <span style={{ color: C.textDim, fontWeight: 600 }}>{index + 1}.</span>
                <span>{action.label}</span>
                <button onClick={() => removeFromQueue(action.id)} disabled={queueExecuting}
                  style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: '0 2px', fontSize: 11 }}>
                  {'\u2715'}
                </button>
              </div>
            ))}
          </div>
          {queueResult && (
            <div style={{
              marginTop: 6, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontFamily: FONT,
              background: queueResult.success ? C.greenDim : C.redDim,
              color: queueResult.success ? C.green : C.red,
            }}>
              {queueResult.success
                ? `Done — ${queueResult.actionsApplied?.length || 0} actions applied. ${queueResult.rippleEffects?.length || 0} tasks affected.`
                : `Failed${queueResult.rolledBack ? ' (rolled back)' : ''}: ${queueResult.reason || 'Execution failed'}`
              }
            </div>
          )}
        </div>
      )}

      {/* Hold Dialog */}
      {holdDialogTask && (
        <HoldDialog
          taskName={holdDialogTask.name}
          onApply={(args) => handleHold(holdDialogTask.key, args)}
          onCancel={() => setHoldDialogTask(null)}
        />
      )}

      {/* Extend Window Dialog */}
      {showExtendWindowDialog && (
        <ExtendWindowDialog
          taskCount={extendWindowTaskKeys.length}
          onApply={(seconds) => handleExtendWindow(extendWindowTaskKeys, seconds)}
          onCancel={() => setShowExtendWindowDialog(false)}
        />
      )}

      {/* Execute Confirmation Dialog */}
      {showExecuteConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }}>
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 20, maxWidth: 420, width: '90%', fontFamily: FONT,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
              Execute {actionQueue.length} Action{actionQueue.length !== 1 ? 's' : ''}?
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
              This will execute all queued actions atomically. If any action fails, all changes will be rolled back.
            </div>
            <div style={{ marginBottom: 16 }}>
              {actionQueue.map((action, i) => (
                <div key={action.id} style={{
                  fontSize: 11, color: C.text, padding: '3px 0',
                  borderBottom: i < actionQueue.length - 1 ? `1px solid ${C.border}` : 'none',
                }}>
                  <span style={{ color: C.textDim, marginRight: 6 }}>{i + 1}.</span>
                  {action.label}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 16 }}>
              Summary: {(() => {
                const counts: Record<string, number> = {};
                actionQueue.forEach(a => { counts[a.command.type] = (counts[a.command.type] || 0) + 1; });
                return Object.entries(counts).map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`).join(', ');
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowExecuteConfirm(false)}
                style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted, cursor: 'pointer', fontFamily: FONT }}>
                Cancel
              </button>
              <button onClick={executeQueue}
                style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8, fontWeight: 700, background: C.accent, border: 'none', color: '#fff', cursor: 'pointer', fontFamily: FONT }}>
                Execute {actionQueue.length} Action{actionQueue.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version footer */}
      {versionInfo && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, height: 24,
          background: C.bg, borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', fontFamily: FONT, fontSize: 11, color: C.textDim, zIndex: 100,
        }}>
          <span>v{versionInfo.fullVersion}</span>
          <span>{tenantId}</span>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: versionInfo ? 32 : 24, left: '50%', transform: 'translateX(-50%)',
          background: toast.severity === 'error' ? C.redDim
            : toast.severity === 'warning' ? C.yellowDim
            : C.surface2,
          color: toast.severity === 'error' ? C.red
            : toast.severity === 'warning' ? C.yellow
            : C.text,
          border: `1px solid ${toast.severity === 'error' ? C.red
            : toast.severity === 'warning' ? C.yellow
            : C.border}33`,
          borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10000,
          animation: 'toastIn 0.2s ease-out',
          maxWidth: 500,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Global animation keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 0.45 } 50% { opacity: 0.8 } }
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(10px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
      `}</style>
    </div>
  );
}
