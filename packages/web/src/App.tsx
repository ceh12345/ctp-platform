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

async function api(path: string, options?: RequestInit) {
  const method = options?.method?.toUpperCase() ?? 'GET';
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const res = await fetch(`/api/v1${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
    },
    ...(hasBody && !options?.body ? { body: '{}' } : {}),
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
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

/** Detect timezone offset from task ISO dates for Gantt axis labels */
function detectGanttTz(tasks: any[]): { offsetMs: number; tz: string } {
  const iso = tasks.find((tk: any) => tk.scheduledStart)?.scheduledStart || '';
  const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return { offsetMs: 0, tz: _locale?.timezone || 'UTC' };
  const sign = m[1] === '-' ? -1 : 1;
  const hrs = parseInt(m[2]), mins = parseInt(m[3]);
  const offsetMs = sign * (hrs * 60 + mins) * 60000;
  const tz = _locale?.timezone || (mins === 0 && hrs > 0 ? `Etc/GMT${sign < 0 ? '+' : '-'}${hrs}` : 'UTC');
  return { offsetMs, tz };
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

const ZOOM_LEVELS = [
  { label: '3 Hr', days: 3 / 24 },
  { label: 'Day', days: 1 },
  { label: '3 Day', days: 3 },
  { label: 'Week', days: 7 },
  { label: '2 Week', days: 14 },
  { label: 'Fit', days: 0 },
];

function deriveOrderStatus(order: any): string {
  const raw = order.fillRate ?? 0;
  const fillRate = raw > 1 ? raw / 100 : raw;
  if (fillRate >= 0.99) return 'on-track';
  const now = Date.now();
  const due = new Date(order.dueDate).getTime();
  if (due < now && fillRate < 0.99) return 'late';
  if (fillRate < 0.5 || due - now < 48 * 3600 * 1000) return 'at-risk';
  return 'on-track';
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
    case 'late': case 'shortage': case 'critical': return C.red;
    default: return C.textDim;
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'on-track': case 'covered': return C.greenDim;
    case 'at-risk': case 'warning': return C.yellowDim;
    case 'late': case 'shortage': case 'critical': return C.redDim;
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
    conflicts.push({
      id: `CFT-${task.key}`,
      taskKey: task.key,
      taskName: task.name,
      orderRef: task.orderRef,
      severity: 'critical',
      reason: hasInfeasibleUpstream ? 'dependency' : 'capacity',
      reasonDetail: hasInfeasibleUpstream
        ? `Blocked by infeasible upstream task in ${task.orderRef}`
        : `No feasible slot on ${resKey || 'any resource'}` +
          (resource ? ` (${resource.utilization.toFixed(0)}% util)` : ''),
      bottleneckResource: resKey,
      bottleneckUtilization: resource?.utilization || 0,
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

function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
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
          padding: 28, minWidth: 360, maxWidth: 500, fontFamily: FONT,
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
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 520,
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
  materialModes, modeOverrides,
  previousOrderModes, previousTaskPins, previousTaskExcludes, previousMaterialModes,
  strategy, onStrategyChange, strategyOptions,
  tier, onTierChange, tierOptions,
  experienceLevel,
  onConfirm, onCancel }: {
  orders: any[]; tasks: any[]; materials: any[]; resources: any[];
  orderModes: Record<string, string>;
  taskPins: Record<string, boolean>;
  taskExcludes: Record<string, boolean>;
  taskUnschedules: Set<string>;
  materialModes?: Record<string, string>;
  modeOverrides?: Record<string, string>;
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

    return deltas;
  }, [orders, tasks, materials, orderModes, taskPins, taskExcludes, taskUnschedules,
      materialModes, modeOverrides, previousOrderModes, previousTaskPins, previousTaskExcludes, previousMaterialModes]);

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
  const prevAvgUtil = prev ? null : null; // We don't store prev util — skip for now

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
                    {infeasibleTasks.slice(0, 5).map((t: any) => (
                      <div key={t.key}
                        onClick={() => { onTaskClick(t); onClose(); }}
                        style={{ color: C.text, cursor: 'pointer', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}
                        onMouseEnter={e => { e.currentTarget.style.color = C.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.color = C.text; }}
                      >
                        <span>{t.name}</span>
                        <span style={{ color: C.textDim, fontSize: 11 }}>
                          {t.errors?.[0]?.reason || 'no feasible slot'}
                        </span>
                      </div>
                    ))}
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
                      {key}: <strong>{Math.round(val as number)}</strong>
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

function TaskDetailPanel({ task, tasks, products, colors, onClose, onResourceClick,
  taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask, onCancelUnschedule,
  onApiUnschedule, onApiPin,
  resourceModeOverrides, onResourceModeChange, experienceLevel = 'novice',
  whereToTaskKey, whereToOptions, onMoveTo, onNavigateToOrders, onTaskClick }: {
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
}) {
  const prodName = task.outputProductKey
    ? (products.find((p: any) => p.key === task.outputProductKey)?.name || task.outputProductKey)
    : null;
  const prodColor = colors ? getTaskColor(task, colors) : C.accent;

  const isPinned = taskPins?.[task.key] || task.pinned || false;
  const isExcluded = taskExcludes?.[task.key] || false;
  const willUnschedule = taskUnschedules?.has(task.key) || false;

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
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {taskStatusBadge(deriveTaskStatus(task, taskPins, taskExcludes, taskUnschedules, orderModes))}
        {task.orderRef && (onNavigateToOrders
          ? <span onClick={() => { onNavigateToOrders(task.orderRef); onClose(); }}
              style={{ color: C.accent, cursor: 'pointer', textDecoration: 'underline', fontSize: 13, fontWeight: 600 }}
              title={`View ${task.orderRef} in Orders`}
            >{task.orderRef}</span>
          : <Badge label={task.orderRef} color={C.purple} />
        )}
        {task.process && <Badge label={task.process} color={C.accent} />}
      </div>

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
        </div>
      )}

      {/* WhereTo Available Positions */}
      {whereToTaskKey === task.key && whereToOptions && whereToOptions.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 16, marginBottom: 8 }}>
            🗺️ Available Positions
          </div>
          {whereToOptions.slice(0, 5).map((option: any) => {
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
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: ghostColor }}>
                    {option.score.toFixed(1)}
                  </span>
                </div>
                {option.latestStart && option.start !== option.latestStart ? (
                  <>
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                      Window: {fmtTime(option.start)} – {fmtTime(option.latestStart)}
                    </div>
                    <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>
                      Suggested: {fmtTime(option.latestStart)} – {fmtTime(option.latestEnd)} ({fmtDuration(option.duration)})
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
                    {fmtTime(option.latestStart || option.start)} – {fmtTime(option.latestEnd || option.end)} ({fmtDuration(option.duration)})
                  </div>
                )}
              </div>
            );
          })}
          {whereToOptions.length > 5 && (
            <div style={{ fontSize: 10, color: C.textDim, textAlign: 'center', marginTop: 4 }}>
              +{whereToOptions.length - 5} more on Gantt
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

      {/* Errors */}
      {task.errors?.length > 0 && (
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

function ResourceDetailPanel({ resource, tasks, colors, onClose, onTaskClick }: {
  resource: any; tasks: any[]; colors: any;
  onClose: () => void; onTaskClick: (t: any) => void;
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
   GANTT CHART
   ═══════════════════════════════════════════════════════════════ */

function GanttChart({ tasks, resources, products, colors, onTaskClick, onResourceClick,
  taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask,
  onApiUnschedule, onApiPin, onApiBulkUnschedule, actionLoading,
  onResourceFilter, resourceFilter,
  onWhereTo, whereToTaskKey, whereToOptions, whereToLoading,
  whereToCurrentAssignment, onMoveTo, onCancelWhereTo,
  zoomLevel, setZoomLevel, scrollOffset, setScrollOffset }: {
  tasks: any[]; resources: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
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
  onMoveTo?: (key: string, option: any) => void;
  onCancelWhereTo?: () => void;
  zoomLevel?: string; setZoomLevel?: (v: string) => void;
  scrollOffset?: number; setScrollOffset?: React.Dispatch<React.SetStateAction<number>>;
}) {
  // Local fallback state when props aren't provided (e.g. Overview tab)
  const [localZoom, setLocalZoom] = useState('Day');
  const [localScroll, setLocalScroll] = useState(0);
  const effectiveZoom = zoomLevel ?? localZoom;
  const effectiveSetZoom = setZoomLevel ?? setLocalZoom;
  const effectiveScroll = scrollOffset ?? localScroll;
  const effectiveSetScroll = setScrollOffset ?? setLocalScroll;
  const [hovered, setHovered] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ task: any; x: number; y: number } | null>(null);
  const [ganttSearch, setGanttSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hiddenWorkCenters, setHiddenWorkCenters] = useState<Set<string>>(new Set());

  // Compute time range from actual scheduled task data (exclude excluded tasks/orders)
  const scheduled = tasks.filter((t: any) => {
    if (!t.feasible || !t.scheduledStart || !t.scheduledEnd) return false;
    if (taskExcludes?.[t.key]) return false;
    const om = orderModes?.[t.orderRef] || 'INCLUDE';
    if (om === 'EXCLUDE') return false;
    return true;
  });

  if (scheduled.length === 0) {
    return <div style={{ color: C.textDim, padding: 20 }}>No {t('scheduledStatus', 'scheduled').toLowerCase()} {t('tasks', 'tasks')}</div>;
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

  // Group tasks by every assigned resource (multi-resource tasks appear on all lanes)
  const resMap = new Map<string, any[]>();
  resources.forEach((r: any) => resMap.set(r.resourceKey, []));
  scheduled.forEach((t: any) => {
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
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {ZOOM_LEVELS.map(z => (
            <button key={z.label} onClick={() => { effectiveSetZoom(z.label); effectiveSetScroll(0); }} style={{
              padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: z.label === effectiveZoom ? '#3b82f6' : 'transparent',
              color: z.label === effectiveZoom ? '#fff' : '#94a3b8',
              fontFamily: FONT,
            }}>
              {z.label}
            </button>
          ))}
        </div>
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
                    style={{ cursor: onResourceClick ? 'pointer' : 'default', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    onMouseEnter={e => { if (onResourceClick) (e.currentTarget as HTMLElement).style.color = C.accent; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = ''; }}
                  >
                    {res.resourceName}
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
                  {/* Task bars */}
                  {rTasks.map((t: any) => {
                    const left = toPct(t.scheduledStart);
                    const right = toPct(t.scheduledEnd);
                    const w = Math.max(right - left, 0.3);
                    const barColor = colors ? getTaskColor(t, colors) : C.accent;
                    const isPinned = taskPins?.[t.key] || t.pinned;
                    const isExcluded = taskExcludes?.[t.key];
                    const willUnsched = taskUnschedules?.has(t.key);
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
                          opacity: actionLoading === t.key ? 0.45 : isExcluded ? 0.2 : 0.85,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', paddingLeft: 4,
                          overflow: 'hidden', fontSize: 10, color: '#fff', fontWeight: 500,
                          transition: 'opacity 0.15s',
                          border: willUnsched ? `2px dashed ${C.red}` : 'none',
                          ...(isPinned && { boxShadow: `0 0 0 2px ${C.accent}` }),
                          ...(isExcluded && { filter: 'grayscale(1)' }),
                          ...(actionLoading === t.key && { animation: 'pulse 1s ease-in-out infinite' }),
                        }}
                      >
                        {willUnsched && (
                          <div style={{
                            position: 'absolute', inset: 0, borderRadius: 'inherit',
                            background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${C.red}22 4px, ${C.red}22 8px)`,
                          }} />
                        )}
                        {isPinned && <span style={{ position: 'absolute', top: -6, right: -4, fontSize: 9, zIndex: 2 }}>📌</span>}
                        {w > 3 && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }}>{t.name}</span>}
                      </div>
                    );
                  })}
                  {/* WhereTo dim overlay on lane */}
                  {whereToTaskKey && whereToOptions && whereToOptions.length > 0 && !whereToLoading && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', pointerEvents: 'none', zIndex: 5 }} />
                  )}
                  {/* Ghost bars for this resource — start window + suggested placement */}
                  {whereToTaskKey && whereToOptions && whereToOptions.length > 0 && !whereToLoading && (
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
                          `Start window: ${fmtTime(option.start)} – ${fmtTime(option.latestStart || option.start)}`,
                          `Suggested: ${fmtTime(option.latestStart || option.start)} (latest, no idle time)`,
                          `Duration: ${fmtDuration(option.duration)}`,
                          `End: ${fmtTime(option.latestEnd || option.end)}`,
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
                                {option.rank === 1 ? '★' : `#${option.rank}`} {fmtTime(option.start)}
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
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* ═══ WhereTo Overlay ═══ */}
      {/* Loading indicator */}
      {whereToTaskKey && whereToLoading && (
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
      {whereToTaskKey && !whereToLoading && whereToOptions && whereToOptions.length === 0 && (
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
      {whereToTaskKey && whereToOptions && whereToOptions.length > 0 && !whereToLoading && (
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
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: ghostColor }}>
                    {option.score.toFixed(1)}
                  </span>
                </div>
                {option.latestStart && option.start !== option.latestStart ? (
                  <>
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                      Window: {fmtTime(option.start)} – {fmtTime(option.latestStart)}
                    </div>
                    <div style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>
                      Suggested: {fmtTime(option.latestStart)} – {fmtTime(option.latestEnd)} ({fmtDuration(option.duration)})
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                    {fmtTime(option.latestStart || option.start)} – {fmtTime(option.latestEnd || option.end)} ({fmtDuration(option.duration)})
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
            {onWhereTo && (() => {
              const isProcessTask = contextMenu.task.type === 'PROCESS';
              const isLockedOrder = orderModes?.[contextMenu.task.orderRef] === 'LOCKED';
              const isExcl = taskExcludes?.[contextMenu.task.key];
              const canWT = isProcessTask && !isLockedOrder && !isExcl;
              return (
                <button onClick={() => { if (canWT) { onWhereTo(contextMenu.task.key); setContextMenu(null); } }}
                  disabled={!canWT}
                  style={{
                    width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                    color: canWT ? C.text : C.textDim, fontSize: 12,
                    cursor: canWT ? 'pointer' : 'default', textAlign: 'left', fontFamily: FONT,
                    borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
                    opacity: canWT ? 1 : 0.5,
                  }}
                  onMouseEnter={e => { if (canWT) e.currentTarget.style.background = C.bg; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                  🗺️ Where Can This Go?
                </button>
              );
            })()}
            {onApiPin && contextMenu.task.feasible && (
              <button onClick={async () => {
                const isPinned = contextMenu.task.pinned || false;
                setContextMenu(null);
                await onApiPin(contextMenu.task.key, !isPinned);
              }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: contextMenu.task.pinned ? C.yellow : C.text,
                fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                📌 {contextMenu.task.pinned ? 'Unpin' : 'Pin'}
              </button>
            )}
            {onExcludeTask && (
              <button onClick={() => {
                const isExcluded = taskExcludes?.[contextMenu.task.key] || false;
                onExcludeTask(contextMenu.task.key, !isExcluded);
                setContextMenu(null);
              }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: taskExcludes?.[contextMenu.task.key] ? C.textDim : C.text,
                fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                ⏸ {taskExcludes?.[contextMenu.task.key] ? 'Re-include' : 'Exclude'}
              </button>
            )}
            {onApiUnschedule && contextMenu.task.feasible && (
              <button onClick={async () => {
                setContextMenu(null);
                await onApiUnschedule(contextMenu.task.key);
              }} style={{
                width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                color: C.red, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
              }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                 onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                ✕ Unschedule Task
              </button>
            )}
            {onApiBulkUnschedule && contextMenu.task.feasible && contextMenu.task.orderRef && (() => {
              const orderTasks = tasks.filter((t: any) => t.orderRef === contextMenu.task.orderRef && t.feasible && t.scheduledStart);
              if (orderTasks.length < 2) return null;
              return (
                <button onClick={async () => {
                  const keys = orderTasks.map((t: any) => t.key);
                  setContextMenu(null);
                  await onApiBulkUnschedule(keys);
                }} style={{
                  width: '100%', padding: '7px 10px', background: 'none', border: 'none',
                  color: C.red, fontSize: 12, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                  borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
                }} onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                   onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  ✕ Unschedule Order ({orderTasks.length})
                </button>
              );
            })()}
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

function CaseGanttChart({ tasks, orders, products, colors, onTaskClick,
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
    const priority = phases[0]?.typedAttributes?.find((a: any) => a.name === 'priority')?.value?.value || '';
    const earliestStart = phases.length > 0 ? new Date(phases[0].scheduledStart).getTime() : Infinity;
    caseRows.push({ caseKey, caseName, priority, phases, unscheduledPhases: unsched, gaps, earliestStart, worstGap });
  }

  // Search filter
  if (caseSearch) {
    const q = caseSearch.toLowerCase();
    caseRows = caseRows.filter(r => r.caseName.toLowerCase().includes(q) || r.caseKey.toLowerCase().includes(q));
  }

  // Sort
  const priorityRank = (p: string) => p === 'URGENT' ? 0 : p === 'ADD-ON' ? 1 : 2;
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
        <div style={{ display: 'flex', gap: 4 }}>
          {ZOOM_LEVELS.map(z => (
            <button key={z.label} onClick={() => { setZoomLevel(z.label); setScrollOffset(0); }} style={{
              padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: z.label === zoomLevel ? '#3b82f6' : 'transparent',
              color: z.label === zoomLevel ? '#fff' : '#94a3b8',
              fontFamily: FONT,
            }}>{z.label}</button>
          ))}
        </div>
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
              {row.priority && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                  background: row.priority === 'URGENT' ? '#f4433620' : row.priority === 'ADD-ON' ? '#ff980020' : `${C.border}`,
                  color: row.priority === 'URGENT' ? '#f44336' : row.priority === 'ADD-ON' ? '#ff9800' : C.textDim,
                }}>{row.priority}</span>
              )}
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
              return (
                <div key={tk.key}
                  onMouseEnter={e => { setHovered(tk); setHoveredGap(null); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onTaskClick?.(tk)}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${w}%`,
                    top: 6, height: CASE_LANE_H - 12, borderRadius: 4,
                    background: barColor, opacity: isExcluded ? 0.2 : 0.85, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', paddingLeft: 4,
                    overflow: 'hidden', fontSize: 10, color: '#fff', fontWeight: 500,
                    border: willUnsched ? `2px dashed ${C.red}` : 'none',
                    ...(isPinned && { boxShadow: `0 0 0 2px ${C.accent}` }),
                    ...(isExcluded && { filter: 'grayscale(1)' }),
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
  const isExcluded = taskExcludes?.[tk.key] || false;
  const orderMode = orderModes?.[tk.orderRef] || 'INCLUDE';
  if (isExcluded || orderMode === 'EXCLUDE') return 'excluded';
  const isPinned = taskPins?.[tk.key] || false;
  if (isPinned || orderMode === 'LOCKED') return 'pinned';
  if (taskUnschedules?.has?.(tk.key)) return 'unscheduled';
  if (tk.feasible && tk.scheduledStart) return 'scheduled';
  if (tk.errors?.length > 0) return 'infeasible';
  return 'unscheduled';
}

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string; icon?: string }> = {
  scheduled:   { label: 'Scheduled',   color: C.green },
  unscheduled: { label: 'Unscheduled', color: C.yellow },
  pinned:      { label: 'Pinned',      color: C.yellow, icon: '📌' },
  infeasible:  { label: 'Infeasible',  color: C.red },
  excluded:    { label: 'Excluded',    color: C.textDim, icon: '⏸' },
};

function taskStatusBadge(status: string) {
  const c = TASK_STATUS_CONFIG[status] || TASK_STATUS_CONFIG.scheduled;
  const label = t(status + 'Status', c.label);
  return <Badge label={`${c.icon ? c.icon + ' ' : ''}${label}`} color={c.color} />;
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
  onPin, onExclude, onUnschedule, onWhereTo, whereToTaskKey }: {
  task: any;
  taskPins: Record<string, boolean>; taskExcludes: Record<string, boolean>;
  taskUnschedules?: Set<string>;
  orderModes: Record<string, string>;
  onPin: (taskKey: string) => void; onExclude: (taskKey: string) => void;
  onUnschedule: (taskKey: string) => void;
  onWhereTo?: (taskKey: string, source?: 'gantt' | 'table') => void;
  whereToTaskKey?: string | null;
}) {
  const isPinned = taskPins[task.key] || task.pinned || false;
  const isExcluded = taskExcludes[task.key] || false;
  const isScheduled = task.feasible && task.scheduledStart;
  const orderMode = orderModes[task.orderRef] || 'INCLUDE';
  const isLocked = orderMode === 'LOCKED';

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
      {task.type === 'PROCESS' && !isExcluded && onWhereTo && (
        <IconBtn icon="🗺️"
          title={isScheduled ? 'Where can this go?' : 'Find available positions'}
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

function TaskBulkActions({ filteredTasks, taskPins, taskExcludes, orderModes,
  onPinAll, onUnpinAll, onExcludeAll, onIncludeAll, onUnscheduleAll }: {
  filteredTasks: any[];
  taskPins: Record<string, boolean>; taskExcludes: Record<string, boolean>;
  orderModes: Record<string, string>;
  onPinAll: (keys: string[]) => void; onUnpinAll: (keys: string[]) => void;
  onExcludeAll: (keys: string[]) => void; onIncludeAll: (keys: string[]) => void;
  onUnscheduleAll: (keys: string[]) => void;
}) {
  const actionable = filteredTasks.filter(t => {
    const orderMode = orderModes[t.orderRef] || 'INCLUDE';
    return orderMode !== 'LOCKED';
  });
  const scheduled = actionable.filter(t => t.feasible && t.scheduledStart);
  const pinnedCount = actionable.filter(t => taskPins[t.key] || t.pinned).length;
  const excludedCount = actionable.filter(t => taskExcludes[t.key]).length;
  const scheduledKeys = scheduled.map(t => t.key);
  const actionableKeys = actionable.map(t => t.key);

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
      {scheduled.length > 0 && (
        <BulkBtn icon="✕" label={`Unschedule ${scheduled.length}`} color={C.red}
          onClick={() => onUnscheduleAll(scheduledKeys)} />
      )}
      {scheduled.length > 0 && pinnedCount < scheduled.length && (
        <BulkBtn icon="📌" label={`Pin ${scheduled.length - pinnedCount}`} color={C.yellow}
          onClick={() => onPinAll(scheduledKeys)} />
      )}
      {pinnedCount > 0 && (
        <BulkBtn icon="📌" label={`Unpin ${pinnedCount}`} color={C.textDim}
          onClick={() => onUnpinAll(scheduledKeys)} />
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

function TaskTable({ tasks, products, colors, onTaskClick, taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask,
  onApiUnschedule, onApiPin, onApiBulkUnschedule, onApiBulkPin,
  experienceLevel = 'novice',
  onWhereTo, whereToTaskKey, caseFilter, onClearCaseFilter, onNavigateToOrders,
  resourceFilter, resourceFilterName, timeFilter, onResourceFilterChange, onTimeFilterChange,
  selectedTasks, onToggleSelect, onSetSelectedTasks,
  onScheduleSelected, onUnscheduleSelected, onPinSelected, onUnpinSelected, onExcludeSelected, onIncludeSelected }: {
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
  onScheduleSelected?: (keys: string[]) => void;
  onUnscheduleSelected?: (keys: string[]) => void;
  onPinSelected?: (keys: string[]) => void;
  onUnpinSelected?: (keys: string[]) => void;
  onExcludeSelected?: (keys: string[]) => void;
  onIncludeSelected?: (keys: string[]) => void;
}) {
  const { sortKey, sortDir, toggle, sorted } = useSort('key');
  const [activeTypeChips, setActiveTypeChips] = useState<Set<string>>(new Set(['PROCESS']));

  const caseTasks = useMemo(() => caseFilter ? tasks.filter(tk => tk.orderRef === caseFilter) : tasks, [tasks, caseFilter]);

  const enriched = useMemo(() => caseTasks.map(tk => {
    const _status = deriveTaskStatus(tk, taskPins, taskExcludes, taskUnschedules, orderModes);
    const _orderMode = orderModes?.[tk.orderRef] || 'INCLUDE';
    const _productName = tk.outputProductKey
      ? (products.find((p: any) => p.key === tk.outputProductKey)?.name || tk.outputProductKey)
      : '';
    const _priority = tk.typedAttributes?.find((a: any) => a.name === 'priority')?.value?.value || '';
    const _type = tk.type || 'PROCESS';
    return {
      ...tk,
      _resource: tk.assignedResources?.[0]?.resourceKey || '',
      _status,
      _orderMode,
      _productName,
      _priority,
      _type,
    };
  }), [caseTasks, taskPins, taskExcludes, taskUnschedules, orderModes, products]);

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

  // Type chip filter applied before useFilter so column dropdowns reflect type-filtered data
  const typeFiltered = useMemo(() => {
    if (activeTypeChips.size === 0) return [];
    return enriched.filter(tk => activeTypeChips.has(tk._type));
  }, [enriched, activeTypeChips]);

  const statusDeriver = useCallback((row: any) => row._status, []);
  const filter = useFilter(typeFiltered, { statusDeriver });

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
  const colFilterChangedRef = useRef(false);
  useEffect(() => {
    if (colFilterChangedRef.current) { colFilterChangedRef.current = false; return; }
    filter.setColumnFilter('_resource', resourceFilter ? new Set([resourceFilter]) : new Set());
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

  const scheduledCount = typeFiltered.filter(tk => tk._status === 'scheduled').length;
  const unscheduledCount = typeFiltered.filter(tk => tk._status === 'unscheduled').length;
  const pinnedCount = typeFiltered.filter(tk => tk._status === 'pinned').length;
  const infeasibleCount = typeFiltered.filter(tk => tk._status === 'infeasible').length;
  const excludedCount = typeFiltered.filter(tk => tk._status === 'excluded').length;

  const statusOptions = [
    { value: 'all', label: 'All', count: typeFiltered.length },
    { value: 'scheduled', label: t('scheduledStatus', 'Scheduled'), color: C.green, count: scheduledCount },
    { value: 'unscheduled', label: t('unscheduledStatus', 'Unscheduled'), color: C.yellow, count: unscheduledCount },
    { value: 'pinned', label: t('pinnedStatus', 'Pinned'), color: C.yellow, count: pinnedCount },
    { value: 'infeasible', label: t('infeasibleStatus', 'Infeasible'), color: C.red, count: infeasibleCount },
    { value: 'excluded', label: t('excludedStatus', 'Excluded'), color: C.textDim, count: excludedCount },
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

  let preRows = filter.filtered;
  if (resourceFilter) {
    preRows = preRows.filter((t: any) =>
      t.assignedResources?.some((r: any) => r.resourceKey === resourceFilter)
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
      {/* Single filter row: presets + active chips inline, Clear all far right */}
      {onTimeFilterChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <button style={presetBtnStyle} onClick={() => onTimeFilterChange({ after: new Date(snapMidnightMs(schedStart)).toISOString() })}>Schedule Start</button>
          <button style={presetBtnStyle} onClick={() => onTimeFilterChange({ after: new Date(schedStart).toISOString() })}>Now →</button>
          <button style={presetBtnStyle} onClick={() => onTimeFilterChange({ after: new Date(schedStart).toISOString(), before: new Date(schedStart + 4 * 3600_000).toISOString() })}>Next 4h</button>
          <button style={presetBtnStyle} onClick={() => { const d = snapMidnightMs(schedStart); onTimeFilterChange({ after: new Date(d).toISOString(), before: new Date(d + 86_400_000).toISOString() }); }}>Today</button>
          <button style={presetBtnStyle} onClick={() => { const d = snapMidnightMs(schedStart) + 86_400_000; onTimeFilterChange({ after: new Date(d).toISOString(), before: new Date(d + 86_400_000).toISOString() }); }}>Tomorrow</button>
          {resourceFilterName && onResourceFilterChange && <>
            <span style={{ color: C.textDim, fontSize: 12, userSelect: 'none' }}>·</span>
            <FilterChip label={`Resource: ${resourceFilterName}`} onClear={() => onResourceFilterChange(null)} />
          </>}
          {timeFilter?.after && <>
            <span style={{ color: C.textDim, fontSize: 12, userSelect: 'none' }}>·</span>
            <FilterChip label={`After: ${fmtPreset(timeFilter.after)}`} onClear={() => onTimeFilterChange({ ...timeFilter, after: undefined })} />
          </>}
          {timeFilter?.before && <>
            <span style={{ color: C.textDim, fontSize: 12, userSelect: 'none' }}>·</span>
            <FilterChip label={`Before: ${fmtPreset(timeFilter.before)}`} onClear={() => onTimeFilterChange({ ...timeFilter, before: undefined })} />
          </>}
          {(resourceFilterName || timeFilter?.after || timeFilter?.before) && <>
            <div style={{ flex: 1 }} />
            <button onClick={() => { onResourceFilterChange?.(null); onTimeFilterChange({}); }}
              style={{ fontSize: 11, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT }}>
              Clear all
            </button>
          </>}
        </div>
      )}
      <FilterBar filter={filter} statusOptions={statusOptions} />

      {/* Task Type Chips */}
      {distinctTypes.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button onClick={toggleAllTypes} style={{
            padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
            fontSize: 12, fontWeight: 600, fontFamily: FONT,
            background: allTypesActive ? C.accent + '22' : 'transparent',
            color: allTypesActive ? C.accent : C.textMuted,
            border: allTypesActive ? `1px solid ${C.accent}44` : '1px solid transparent',
          }}>
            All Types
          </button>
          {distinctTypes.map(typ => {
            const isActive = activeTypeChips.has(typ);
            const count = enriched.filter(tk => tk._type === typ).length;
            const label = typ.charAt(0) + typ.slice(1).toLowerCase().replace(/_/g, ' ');
            return (
              <button key={typ} onClick={() => toggleTypeChip(typ)} style={{
                padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                fontSize: 12, fontWeight: 600, fontFamily: FONT,
                background: isActive ? C.accent + '22' : 'transparent',
                color: isActive ? C.accent : C.textMuted,
                border: isActive ? `1px solid ${C.accent}44` : '1px solid transparent',
              }}>
                {label}
                <span style={{ marginLeft: 4, opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>
      )}

      <ActiveFilters filter={filter} />
      {selectedTasks && selectedTasks.size > 0 ? (() => {
        const selArr = Array.from(selectedTasks);
        const selObjs = selArr.map(k => tasks.find((tt: any) => tt.key === k)).filter(Boolean);
        const scheduledSel = selObjs.filter((tt: any) => tt.feasible && tt.scheduledStart && !taskUnschedules?.has(tt.key));
        const unscheduledSel = selObjs.filter((tt: any) => !tt.feasible || !tt.scheduledStart || taskExcludes?.[tt.key]);
        const pinnedSel = selObjs.filter((tt: any) => taskPins?.[tt.key] || tt.pinned);
        const unpinnedScheduled = scheduledSel.filter((tt: any) => !taskPins?.[tt.key] && !tt.pinned);
        const excludedSel = selObjs.filter((tt: any) => taskExcludes?.[tt.key]);
        const nonExcluded = selObjs.filter((tt: any) => !taskExcludes?.[tt.key]);
        const pendingUnsched = selArr.filter(k => taskUnschedules?.has(k));
        const btnStyle: CSSProperties = {
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          fontFamily: FONT, border: `1px solid ${C.border}`, background: C.surface2, color: C.text,
        };
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            background: `${C.accent}0a`, borderRadius: 8, marginBottom: 8,
            border: `1px solid ${C.accent}33`, fontFamily: FONT,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>
              {selectedTasks.size} selected
            </span>
            <div style={{ width: 1, height: 16, background: C.border }} />
            {unscheduledSel.length > 0 && onScheduleSelected && (
              <button style={{ ...btnStyle, color: C.green }} onClick={() => onScheduleSelected(unscheduledSel.map((tt: any) => tt.key))}>
                {'\u25B6'} Schedule {unscheduledSel.length}
              </button>
            )}
            {scheduledSel.length > 0 && onUnscheduleSelected && (
              <button style={{ ...btnStyle, color: C.red }} onClick={() => onUnscheduleSelected(scheduledSel.map((tt: any) => tt.key))}>
                {'\u2715'} Unschedule {scheduledSel.length}
              </button>
            )}
            {pendingUnsched.length > 0 && onScheduleSelected && (
              <button style={{ ...btnStyle, color: C.yellow }} onClick={() => onScheduleSelected(pendingUnsched)}>
                {'\u21A9'} Cancel Unschedule {pendingUnsched.length}
              </button>
            )}
            {unpinnedScheduled.length > 0 && onPinSelected && (
              <button style={{ ...btnStyle, color: C.accent }} onClick={() => onPinSelected(unpinnedScheduled.map((tt: any) => tt.key))}>
                {'\uD83D\uDCCC'} Pin {unpinnedScheduled.length}
              </button>
            )}
            {pinnedSel.length > 0 && onUnpinSelected && (
              <button style={{ ...btnStyle, color: C.yellow }} onClick={() => onUnpinSelected(pinnedSel.map((tt: any) => tt.key))}>
                {'\uD83D\uDCCC'} Unpin {pinnedSel.length}
              </button>
            )}
            {nonExcluded.length > 0 && onExcludeSelected && (
              <button style={{ ...btnStyle, color: C.textDim }} onClick={() => onExcludeSelected(nonExcluded.map((tt: any) => tt.key))}>
                {'\u23F8'} Exclude {nonExcluded.length}
              </button>
            )}
            {excludedSel.length > 0 && onIncludeSelected && (
              <button style={{ ...btnStyle, color: C.green }} onClick={() => onIncludeSelected(excludedSel.map((tt: any) => tt.key))}>
                {'\u25B6'} Include {excludedSel.length}
              </button>
            )}
            {selArr.length === 1 && onWhereTo && (
              <button style={{ ...btnStyle, color: C.accent }} onClick={() => onWhereTo(selArr[0], 'table')}>
                {'\uD83D\uDDFA'} Where To
              </button>
            )}
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
          onUnscheduleAll={handleUnscheduleAll} />
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
              <SortHeader label="Priority" k="_priority" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_priority')} />
              <SortHeader label="Type" k="_type" current={sortKey} dir={sortDir} onSort={toggle} />
              {showAt(experienceLevel, 'intermediate') && <SortHeader label={t('score', 'Score')} k="score" current={sortKey} dir={sortDir} onSort={toggle} />}
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
                  <td style={cellStyle}>{tk._priority || '—'}</td>
                  <td style={cellStyle}>{tk._type}</td>
                  {showAt(experienceLevel, 'intermediate') && <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {tk.score != null ? tk.score.toFixed(2) : '—'}
                  </td>}
                  <td style={cellStyle}>
                    {taskStatusBadge(tk._status)}
                    {taskUnschedules?.has(tk.key) && (
                      <span style={{ fontSize: 10, color: C.red, fontWeight: 600, marginLeft: 4 }}>{'\u2192'} UNSCHED</span>
                    )}
                    {taskPins?.[tk.key] && !taskUnschedules?.has(tk.key) && (
                      <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginLeft: 4 }}>{'\u2192'} PIN</span>
                    )}
                    {taskExcludes?.[tk.key] && !taskUnschedules?.has(tk.key) && (
                      <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600, marginLeft: 4 }}>{'\u2192'} EXCLUDE</span>
                    )}
                  </td>
                  {hasActions && (
                    <td style={{ ...cellStyle, textAlign: 'center', padding: '4px 6px' }}>
                      <TaskRowActions task={tk}
                        taskPins={safePins} taskExcludes={safeExcludes} taskUnschedules={taskUnschedules}
                        orderModes={safeOrderModes}
                        onPin={handlePin} onExclude={handleExclude} onUnschedule={handleUnschedule}
                        onWhereTo={onWhereTo} whereToTaskKey={whereToTaskKey} />
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

    return {
      ...o,
      _status: deriveOrderStatus(o),
      _productName: prodName,
      _totalTasks: total,
      _scheduledTasks: placed,
      _infeasibleTasks: infeasible,
      _excludedTasks: excluded,
      _scheduleProgress: total > 0 ? placed / total : 0,
      _scheduledStart: starts.length ? starts.sort()[0] : null,
      _scheduledEnd: ends.length ? ends.sort().pop() : null,
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
                      label={`P${o.priority}`}
                      color={o.priority <= 1 ? C.red : o.priority <= 2 ? C.yellow : C.textMuted}
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

  const grouped = { capacity: [] as any[], dependency: [] as any[], material: [] as any[] };
  conflicts.forEach((c: any) => {
    const bucket = grouped[c.reason as keyof typeof grouped];
    if (bucket) bucket.push(c);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {conflicts.map((c: any) => {
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
                  c.reason === 'capacity' ? C.orange :
                  c.reason === 'dependency' ? C.purple : C.cyan
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
                {c.bottleneckResource && (
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
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — OVERVIEW
   ═══════════════════════════════════════════════════════════════ */

function OverviewTab({ summary, tasks, resources, orders, materials, products, colors, onTabChange, onTaskClick, onResourceClick, experienceLevel = 'novice',
  taskPins, taskExcludes, taskUnschedules, orderModes,
  onPinTask, onExcludeTask, onUnscheduleTask, onWhereTo }: {
  summary: any; tasks: any[]; resources: any[]; orders: any[]; materials: any[];
  products: any[]; colors: any; onTabChange: (t: string) => void;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
  experienceLevel?: ExperienceLevel;
  taskPins?: Record<string, boolean>; taskExcludes?: Record<string, boolean>; taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onPinTask?: (key: string, pinned: boolean) => void;
  onExcludeTask?: (key: string, excluded: boolean) => void;
  onUnscheduleTask?: (key: string) => void;
  onWhereTo?: (key: string) => void;
}) {
  const avgUtil = resources.length > 0
    ? resources.reduce((s: number, r: any) => s + r.utilization, 0) / resources.length
    : 0;
  const lateOrders = orders.filter((o: any) => deriveOrderStatus(o) === 'late').length;
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
      </div>

      {/* Gantt + Side panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        <Card title={`${t('schedule', 'Schedule')} Overview`}>
          <GanttChart tasks={tasks} resources={resources} products={products} colors={colors}
            onTaskClick={onTaskClick} onResourceClick={onResourceClick}
            taskPins={taskPins} taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
            orderModes={orderModes}
            onPinTask={onPinTask} onExcludeTask={onExcludeTask} onUnscheduleTask={onUnscheduleTask}
            onWhereTo={onWhereTo} />
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
              const status = deriveOrderStatus(o);
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
                    title="Find available positions"
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
  whereToCurrentAssignment, onMoveTo, onCancelWhereTo,
  caseFilter, onClearCaseFilter, onNavigateToOrders,
  selectedTasks, onToggleSelect, onSetSelectedTasks,
  onScheduleSelected, onUnscheduleSelected, onPinSelected, onUnpinSelected, onExcludeSelected, onIncludeSelected }: {
  tasks: any[]; resources: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
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
  onMoveTo?: (key: string, option: any) => void;
  onCancelWhereTo?: () => void;
  caseFilter?: string | null;
  onClearCaseFilter?: () => void;
  onNavigateToOrders?: (orderKey: string) => void;
  selectedTasks?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onSetSelectedTasks?: (s: Set<string>) => void;
  onScheduleSelected?: (keys: string[]) => void;
  onUnscheduleSelected?: (keys: string[]) => void;
  onPinSelected?: (keys: string[]) => void;
  onUnpinSelected?: (keys: string[]) => void;
  onExcludeSelected?: (keys: string[]) => void;
  onIncludeSelected?: (keys: string[]) => void;
}) {
  const tabNames = [`Gantt by ${t('resource', 'Resource')}`, `Gantt by ${t('order', 'Order')}`, t('tasks', 'Task List')];
  const [subIdx, setSubIdx] = useState(0);
  const [zoomLevel, setZoomLevel] = useState('Day');
  const [scrollOffset, setScrollOffset] = useState(0);
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
            onResourceFilter={(key) => setResourceFilter(prev => prev === key ? null : key)}
            resourceFilter={resourceFilter}
            onWhereTo={onWhereTo} whereToTaskKey={whereToTaskKey} whereToOptions={whereToOptions}
            whereToLoading={whereToLoading} whereToCurrentAssignment={whereToCurrentAssignment}
            onMoveTo={onMoveTo} onCancelWhereTo={onCancelWhereTo}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            scrollOffset={scrollOffset} setScrollOffset={setScrollOffset} />
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
            onExcludeSelected={onExcludeSelected} onIncludeSelected={onIncludeSelected} />
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
  const lateCount = filteredOrders.filter((o: any) => deriveOrderStatus(o) === 'late').length;
  const atRiskCount = filteredOrders.filter((o: any) => deriveOrderStatus(o) === 'at-risk').length;
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
          { value: 'capacity', label: 'Capacity', color: C.orange },
          { value: 'dependency', label: 'Dependency', color: C.purple },
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

function SettingsContent({ experienceLevel, onExperienceChange, stats }: {
  experienceLevel: ExperienceLevel;
  onExperienceChange: (level: ExperienceLevel) => void;
  stats?: any;
}) {
  return (
    <div style={{ fontFamily: FONT }}>
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
                  <div style={{
                    fontWeight: 700, fontSize: 14, color: isActive ? C.accent : C.text,
                  }}>
                    {lvl.label}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{lvl.desc}</div>
                </div>
                {isActive && <span style={{ color: C.accent, fontSize: 16 }}>✓</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Engine stats (expert only) */}
      {showAt(experienceLevel, 'expert') && stats && (
        <>
          <SectionLabel label="Solver Statistics" />
          <div style={{ fontSize: 13 }}>
            {typeof stats === 'object' && Object.entries(stats).map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                borderBottom: `1px solid ${C.border}`,
              }}>
                <span style={{ color: C.textMuted }}>{k}</span>
                <span style={{ color: C.text, fontWeight: 500 }}>{String(v)}</span>
              </div>
            ))}
          </div>
        </>
      )}
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

function AnalyticsTab({ kpis, detail, selectedKpi, onSelectKpi, loading, experienceLevel = 'novice' as ExperienceLevel, onNavigateToCase }: {
  kpis: any[];
  detail: any;
  selectedKpi: string | null;
  onSelectKpi: (key: string) => void;
  loading: boolean;
  experienceLevel?: ExperienceLevel;
  onNavigateToCase?: (caseKey: string) => void;
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

  // Group KPIs
  const groups = new Map<string, any[]>();
  for (const kpi of kpis) {
    if (!groups.has(kpi.group)) groups.set(kpi.group, []);
    groups.get(kpi.group)!.push(kpi);
  }

  // Determine selected KPI's group for detail view
  const selectedKpiObj = kpis.find((k) => k.key === selectedKpi);
  const selectedGroup = selectedKpiObj?.group;

  // Find group data in detail response
  let detailContent: React.ReactNode = null;
  if (loading) {
    detailContent = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: C.textMuted }}>
        Loading...
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
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */

const TABS = ['Overview', 'Schedule', 'Orders', 'Conflicts', 'Materials', 'Analytics'];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(() => {
    const saved = localStorage.getItem('ctp-experience-level');
    return (saved === 'novice' || saved === 'intermediate' || saved === 'expert') ? saved : 'novice';
  });
  const [userOpen, setUserOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedResource, setSelectedResource] = useState<any>(null);
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
  // Immediate action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);
  // WhereTo state
  const [whereToTaskKey, setWhereToTaskKey] = useState<string | null>(null);
  const [whereToOptions, setWhereToOptions] = useState<any[]>([]);
  const [whereToLoading, setWhereToLoading] = useState(false);
  const [whereToCurrentAssignment, setWhereToCurrentAssignment] = useState<any>(null);
  // Schedule case filter (set from Analytics chain links)
  const [scheduleCaseFilter, setScheduleCaseFilter] = useState<string | null>(null);
  // Orders case filter (set from task orderRef click)
  const [ordersCaseFilter, setOrdersCaseFilter] = useState<string | null>(null);
  // Analytics state
  const [analyticsKpis, setAnalyticsKpis] = useState<any[]>([]);
  const [analyticsDetail, setAnalyticsDetail] = useState<any>(null);
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
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
      const [result, prods, colorsData, termData, localeData, strategiesData] = await Promise.all([
        api('/ctp/solve-and-sync', {
          method: 'POST',
          body: JSON.stringify({ detailLevel: experienceLevel }),
        }),
        api('/data/products'),
        api('/data/colors').catch(() => null),
        api('/data/terminology').catch(() => ({})),
        api('/data/locale').catch(() => ({})),
        api('/data/strategies').catch(() => null),
      ]);
      setSolveResult(result);
      setProducts(prods);
      setColors(result.colors || colorsData || {});
      _terminology = result.terminology || termData || {};
      _locale = result.locale || localeData || {};
      if (strategiesData?.strategies?.length > 0) {
        setStrategyOptions(strategiesData.strategies);
      }
      if (strategiesData?.tiers?.length > 0) {
        setTierOptions(strategiesData.tiers);
        if (strategiesData.defaultTier) {
          setSelectedTier(strategiesData.defaultTier);
          const defaultTierDef = strategiesData.tiers.find(
            (t: any) => t.key === strategiesData.defaultTier
          );
          if (defaultTierDef) setSolverStrategy(defaultTierDef.defaultStrategy);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    }
  }, [experienceLevel]);

  const handleSolveConfirm = useCallback(async () => {
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
      const body: any = {};
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

      body.strategy = solverStrategy;
      body.detailLevel = experienceLevel;

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

      // Show results dialog
      setShowSolveResults(true);
    } catch (e: any) {
      setError(e.message || 'Solve failed');
    } finally {
      setSolving(false);
    }
  }, [orderModes, taskPins, taskExcludes, taskUnschedules, materialModeOverrides, resourceModeOverrides, solverStrategy, experienceLevel, solveResult]);

  const handleSolveCancel = useCallback(() => {
    setShowSolvePreview(false);
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

  // WhereTo handlers
  const cancelWhereTo = useCallback(() => {
    setWhereToTaskKey(null);
    setWhereToOptions([]);
    setWhereToCurrentAssignment(null);
  }, []);

  const handleWhereTo = useCallback(async (taskKey: string, source: 'gantt' | 'table' = 'gantt') => {
    if (source === 'gantt') setActiveTab('Schedule');
    // Open detail panel only from table — from Gantt the user already sees the task
    if (source === 'table') {
      setSelectedTask(tasks.find((tk: any) => tk.key === taskKey) || null);
    }
    setWhereToTaskKey(taskKey);
    setWhereToLoading(true);
    setWhereToOptions([]);
    setWhereToCurrentAssignment(null);
    try {
      const result = await api(`/ctp/tasks/${encodeURIComponent(taskKey)}/where-to`, {
        method: 'POST',
        body: JSON.stringify({ constraints: { maxResults: 10 } }),
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

  // ─── Immediate single-task API actions ───

  // After any immediate action refreshes /ctp/state, apply the result and
  // invalidate analytics so KPIs reflect the new landscape state.
  const applyStateRefresh = useCallback((updated: any) => {
    if (!updated.tasks) return;
    setSolveResult(updated);
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
    } catch (err) {
      console.error('Unschedule error:', err);
      showToast('Unschedule failed');
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
    } catch (err) {
      console.error('Pin error:', err);
      showToast(`${pinned ? 'Pin' : 'Unpin'} failed`);
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
      } else {
        showToast(`Cannot schedule: ${res.errors?.[0]?.reason || res.message || 'No feasible slot'}`);
      }
    } catch (err) {
      console.error('Schedule error:', err);
      showToast('Schedule failed');
    } finally {
      setActionLoading(null);
    }
  }, [showToast]);

  const handleApiBulkUnschedule = useCallback(async (keys: string[]) => {
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
  }, [showToast]);

  const handleApiBulkPin = useCallback(async (keys: string[], pinned: boolean) => {
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
  }, [showToast]);

  const handleBulkSchedule = useCallback(async (keys: string[]) => {
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
  }, [showToast]);

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
      }
    } catch { setAnalyticsDetail(null); }
    finally { setAnalyticsLoading(false); }
  }, [analyticsKpis]);

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
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.text }}>
      {/* Header */}
      <header style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', height: 56, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100,
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff',
          }}>
            CT
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>CTP Platform</span>
            <span style={{ color: C.textDim, fontSize: 13, marginLeft: 8 }}>{t('tenantDisplayName', 'CTP Platform')}</span>
          </div>
          {summary && (
            <span style={{ color: C.textDim, fontSize: 12, marginLeft: 8 }}>
              {fmtDateShort(summary.horizonStart)} – {fmtDateShort(summary.horizonEnd)}
            </span>
          )}
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {summary && (
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.textMuted }}>
              <span>{resources.length} {t('resources', 'resources')}</span>
              <span>{summary.totalTasks} {t('tasks', 'tasks')}</span>
              <span>{orders.length} {t('orders', 'orders')}</span>
            </div>
          )}
          <button
            onClick={(e) => {
              if (e.shiftKey) { handleSolveConfirm(); }
              else { setShowSolvePreview(true); }
            }}
            disabled={solving}
            title="Click to preview, Shift+Click to solve immediately"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8, border: 'none',
              background: solving ? C.textDim : C.accent, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: solving ? 'default' : 'pointer',
              fontFamily: FONT, transition: 'background 0.15s',
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
          return (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); if (tab !== 'Schedule') { if (whereToTaskKey) { setWhereToTaskKey(null); setWhereToOptions([]); setWhereToCurrentAssignment(null); } if (scheduleCaseFilter) setScheduleCaseFilter(null); } if (tab !== 'Orders' && ordersCaseFilter) setOrdersCaseFilter(null); }}
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
            </button>
          );
        })}
      </nav>

      {/* Error banner */}
      {error && (
        <div style={{
          margin: '16px 24px 0', padding: '12px 18px', borderRadius: 10,
          background: C.redDim, border: `1px solid ${C.red}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FONT,
        }}>
          <span style={{ color: C.red, fontSize: 13, fontWeight: 500 }}>⚠ {error}</span>
          <button
            onClick={() => { setError(null); loadData(); }}
            style={{
              background: C.red, color: '#fff', border: 'none', borderRadius: 6,
              padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            }}
          >
            {act('retry', 'Retry')}
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
      <main style={{ padding: 24 }}>
        {activeTab === 'Overview' && (
          <OverviewTab summary={summary} tasks={tasks} resources={resources}
            orders={orders} materials={materials} products={products} colors={colors} onTabChange={setActiveTab}
            onTaskClick={handleTaskClick} onResourceClick={handleResourceClick}
            experienceLevel={experienceLevel}
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
            onWhereTo={handleWhereTo} />
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
            onScheduleSelected={(keys) => { handleBulkSchedule(keys); }}
            onUnscheduleSelected={(keys) => { handleApiBulkUnschedule(keys); }}
            onPinSelected={(keys) => { handleApiBulkPin(keys, true); }}
            onUnpinSelected={(keys) => { handleApiBulkPin(keys, false); }}
            onExcludeSelected={(keys) => {
              setTaskExcludes(prev => { const next = { ...prev }; keys.forEach(k => { next[k] = true; }); return next; });
              setSelectedTasks(new Set());
              setSolveStale(true);
            }}
            onIncludeSelected={(keys) => {
              setTaskExcludes(prev => { const next = { ...prev }; keys.forEach(k => { next[k] = false; }); return next; });
              setSelectedTasks(new Set());
              setSolveStale(true);
            }} />
        )}
        {activeTab === 'Orders' && <OrdersTab orders={orders} products={products} tasks={tasks}
          orderModes={orderModes} taskPins={taskPins} taskExcludes={taskExcludes}
          onOrderModeChange={(key, mode) => { setOrderModes(prev => ({ ...prev, [key]: mode })); setSolveStale(true); }}
          caseFilter={ordersCaseFilter} onClearCaseFilter={() => setOrdersCaseFilter(null)} />}
        {activeTab === 'Conflicts' && <ConflictsTab tasks={tasks} resources={resources} materials={materials}
          onTaskClick={handleTaskClickByKey} />}
        {activeTab === 'Materials' && <MaterialsTab materials={materials}
          materialModes={materialModeOverrides}
          onMaterialModeChange={(key, mode) => { setMaterialModeOverrides(prev => ({ ...prev, [key]: mode })); setSolveStale(true); }} />}
        {activeTab === 'Analytics' && <AnalyticsTab kpis={analyticsKpis} detail={analyticsDetail}
          selectedKpi={selectedKpi} onSelectKpi={handleSelectKpi} loading={analyticsLoading}
          experienceLevel={experienceLevel} onNavigateToCase={(caseKey) => { setScheduleCaseFilter(caseKey); setActiveTab('Schedule'); }} />}
      </main>

      {/* Modals */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <SettingsContent
          experienceLevel={experienceLevel}
          onExperienceChange={handleExperienceChange}
          stats={solveResult?.stats}
        />
      </Modal>
      <Modal open={userOpen} onClose={() => setUserOpen(false)} title="User Profile">
        <UserProfileContent />
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
        />
      )}
      {selectedResource && (
        <ResourceDetailPanel
          resource={selectedResource}
          tasks={tasks}
          colors={colors}
          onClose={() => setSelectedResource(null)}
          onTaskClick={handleTaskClick}
        />
      )}

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

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: C.surface2, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10000,
          animation: 'toastIn 0.2s ease-out',
        }}>
          {toast}
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
