import { useState, useEffect, useCallback, useMemo, CSSProperties, ReactNode } from 'react';

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

async function api(path: string, options?: RequestInit) {
  const method = options?.method?.toUpperCase() ?? 'GET';
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
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

  return {
    search, setSearch,
    status, setStatus,
    columnFilters, toggleColumnValue, clearColumnFilter,
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
    distinctValues: string[];
    selected: Set<string>;
    onToggle: (column: string, value: string) => void;
    onClear: (column: string) => void;
  };
}) {
  const active = k === current;
  return (
    <th
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
        color: active ? C.accent : C.textMuted, cursor: 'pointer', userSelect: 'none',
        borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span onClick={() => onSort(k)}>
          {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
        {filterProps && (
          <ColumnFilter
            column={k}
            distinctValues={filterProps.distinctValues}
            selected={filterProps.selected}
            onToggle={filterProps.onToggle}
            onClear={filterProps.onClear}
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

function ColumnFilter({ column, distinctValues, selected, onToggle, onClear }: {
  column: string;
  distinctValues: string[];
  selected: Set<string>;
  onToggle: (column: string, value: string) => void;
  onClear: (column: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasFilter = selected.size > 0;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} style={{
        background: hasFilter ? C.accent + '22' : 'none',
        border: hasFilter ? `1px solid ${C.accent}44` : '1px solid transparent',
        borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
        fontSize: 11, color: hasFilter ? C.accent : C.textDim,
        display: 'inline-flex', alignItems: 'center', gap: 2,
      }}>
        &#x25BC; {hasFilter && `(${selected.size})`}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 998,
          }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 999,
            background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 8, minWidth: 180, maxHeight: 240, overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {hasFilter && (
              <button onClick={() => onClear(column)} style={{
                width: '100%', padding: '4px 8px', marginBottom: 4,
                background: 'none', border: 'none', color: C.accent,
                fontSize: 11, cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
              }}>
                Clear filter
              </button>
            )}
            {distinctValues.map(v => (
              <label key={v} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 8px', cursor: 'pointer', fontSize: 12,
                color: C.text, borderRadius: 4,
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(v)}
                  onChange={() => onToggle(column, v)}
                  style={{ accentColor: C.accent }}
                />
                {v}
              </label>
            ))}
            {distinctValues.length === 0 && (
              <div style={{ padding: 8, color: C.textDim, fontSize: 12 }}>No values</div>
            )}
          </div>
        </>
      )}
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
function SolvePreview({ orders, tasks, materials, resources,
  orderModes, taskPins, taskExcludes, taskUnschedules,
  materialModes, modeOverrides,
  previousOrderModes, previousTaskPins, previousTaskExcludes, previousMaterialModes,
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
    INCLUDE: { label: 'Include', icon: '\u25B6', color: C.green },
    LOCKED: { label: 'Locked', icon: '\uD83D\uDD12', color: C.yellow },
    EXCLUDE: { label: 'Exclude', icon: '\u23F8', color: C.textDim },
    ON: { label: 'Required', icon: '\u25CF', color: C.green },
    TRACK: { label: 'Monitored', icon: '\u25CB', color: C.yellow },
    OFF: { label: 'Ignored', icon: '\u2013', color: C.textDim },
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
          text: `${o.orderKey} changed: ${MODE_LABELS[prev]?.label || prev} \u2192 ${config.label}`,
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
          icon: '\u{1F4CC}',
          text: `${key} pinned${resKey ? ` to ${resKey}` : ''}${task?.scheduledStart ? ` at ${fmtDate(task.scheduledStart)}` : ''}`,
          color: C.yellow,
        });
      } else if (!pinned && wasPinned) {
        deltas.push({ icon: '\u{1F4CC}', text: `${key} unpinned`, color: C.textMuted });
      }
    });

    // Task excludes
    Object.entries(taskExcludes).forEach(([key, excl]) => {
      const wasExcluded = previousTaskExcludes[key] || false;
      if (excl && !wasExcluded) {
        deltas.push({ icon: '\u23F8', text: `${key} excluded from solve`, color: C.textDim });
      } else if (!excl && wasExcluded) {
        deltas.push({ icon: '\u25B6', text: `${key} re-included in solve`, color: C.green });
      }
    });

    // Unschedules
    Array.from(taskUnschedules).forEach(key => {
      deltas.push({ icon: '\u2715', text: `${key} will be unscheduled`, color: C.red });
    });

    // Material mode changes
    if (materialModes && previousMaterialModes) {
      materials.forEach((m: any) => {
        const key = m.materialKey || m.key;
        const prev = previousMaterialModes[key] || m.mode || 'TRACK';
        const curr = materialModes[key] || m.mode || 'TRACK';
        if (prev !== curr) {
          deltas.push({
            icon: MODE_LABELS[curr]?.icon || '\u25CF',
            text: `${m.materialName || key} mode: ${MODE_LABELS[prev]?.label || prev} \u2192 ${MODE_LABELS[curr]?.label || curr}`,
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
            icon: MODE_LABELS[newMode]?.icon || '\u25CF',
            text: `${parts[1]} on ${parts[0]} \u2192 ${MODE_LABELS[newMode]?.label || newMode}`,
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
        padding: 0, width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
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
          }}>{'\u2715'}</button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {isFirstSolve ? (
            <div style={{ padding: '12px 0', fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                Ready to schedule
              </div>
              <SummaryRow icon={'\uD83D\uDCCB'} color={C.text}
                text={`${orders.length} orders with ${tasks.length} tasks`} />
              <SummaryRow icon={'\u2699'} color={C.text}
                text={`${resources.length} capacity resources`} />
              <SummaryRow icon={'\uD83D\uDCE6'} color={C.text}
                text={`${materials.length} materials tracked`} />
            </div>
          ) : (
            <>
              {/* Orders section */}
              <SectionLabel label="Orders" />
              <SummaryRow icon={'\u25B6'} color={C.green}
                text={`${orderSummary.included} orders included (${orderSummary.includedTasks} tasks)`} />
              {orderSummary.locked > 0 && (
                <SummaryRow icon={'\uD83D\uDD12'} color={C.yellow}
                  text={`${orderSummary.locked} orders locked (${orderSummary.lockedTasks} tasks \u2014 won\u2019t move)`} />
              )}
              {orderSummary.excluded > 0 && (
                <SummaryRow icon={'\u23F8'} color={C.textDim}
                  text={`${orderSummary.excluded} orders excluded (${orderSummary.excludedTasks} tasks \u2014 ${orderSummary.excludedOrderKeys.join(', ')})`} />
              )}

              {/* Tasks section */}
              <SectionLabel label="Tasks" />
              {taskSummary.pinned.length > 0 && (
                <SummaryRow icon={'\uD83D\uDCCC'} color={C.yellow}
                  text={`${taskSummary.pinned.length} tasks pinned (${taskSummary.pinned.slice(0, 3).join(', ')}${taskSummary.pinned.length > 3 ? '\u2026' : ''})`} />
              )}
              {taskSummary.excluded.length > 0 && (
                <SummaryRow icon={'\u23F8'} color={C.textDim}
                  text={`${taskSummary.excluded.length} tasks excluded (${taskSummary.excluded.slice(0, 3).join(', ')}${taskSummary.excluded.length > 3 ? '\u2026' : ''})`} />
              )}
              {taskSummary.unschedule.length > 0 && (
                <SummaryRow icon={'\u2715'} color={C.red}
                  text={`${taskSummary.unschedule.length} tasks to unschedule (${taskSummary.unschedule.slice(0, 3).join(', ')}${taskSummary.unschedule.length > 3 ? '\u2026' : ''})`} />
              )}
              {taskSummary.pinned.length === 0 && taskSummary.excluded.length === 0 && taskSummary.unschedule.length === 0 && (
                <SummaryRow icon={'\u2713'} color={C.green} text="No task overrides" />
              )}

              {/* Resources section */}
              <SectionLabel label="Resources & Materials" />
              <SummaryRow icon={'\u2699'} color={C.text}
                text={`${resourceSummary.active} capacity resources active`} />
              <SummaryRow icon={'\uD83D\uDCE6'} color={C.text}
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
              {'\u25B6'} Solve Now
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

function TaskDetailPanel({ task, tasks, products, colors, onClose, onResourceClick }: {
  task: any; tasks: any[]; products: any[]; colors: any;
  onClose: () => void; onResourceClick: (r: any) => void;
}) {
  const prodName = task.outputProductKey
    ? (products.find((p: any) => p.key === task.outputProductKey)?.name || task.outputProductKey)
    : null;
  const prodColor = colors ? getTaskColor(task, colors) : C.accent;

  const orderChain = task.orderRef
    ? tasks.filter((t: any) => t.orderRef === task.orderRef)
        .sort((a: any, b: any) => {
          const aT = a.scheduledStart ? new Date(a.scheduledStart).getTime() : Infinity;
          const bT = b.scheduledStart ? new Date(b.scheduledStart).getTime() : Infinity;
          return aT - bT;
        })
    : [];

  return (
    <SlidePanel open={true} onClose={onClose} title={`${t('task', 'Task')} Detail`}>
      {/* Header badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <Badge label={task.feasible ? t('scheduledStatus', 'Scheduled') : t('infeasibleStatus', 'Infeasible')} color={task.feasible ? C.green : C.red} />
        {task.orderRef && <Badge label={task.orderRef} color={C.purple} />}
        {task.process && <Badge label={task.process} color={C.accent} />}
      </div>

      {/* Task Info */}
      <SectionLabel label={`${t('task', 'Task')} Info`} />
      <DetailRow label="Key" value={task.key} />
      <DetailRow label="Name" value={task.name} />

      {/* Schedule */}
      <SectionLabel label={t('schedule', 'Schedule')} />
      <DetailRow label="Start" value={fmtDate(task.scheduledStart)} />
      <DetailRow label="End" value={fmtDate(task.scheduledEnd)} />
      <DetailRow label={t('duration', 'Duration')} value={fmtDuration(task.durationSeconds)} />
      <DetailRow label={t('score', 'Score')} value={task.score != null ? task.score.toFixed(2) : '—'} />

      {/* Product Output */}
      {prodName && (
        <>
          <SectionLabel label={`${t('product', 'Product')} Output`} />
          <DetailRow label={t('product', 'Product')} value={<span style={{ color: prodColor }}>{prodName}</span>} />
          <DetailRow label={t('quantity', 'Qty')} value={fmtNum(task.outputQty)} />
          <DetailRow label="Scrap Rate" value={task.outputScrapRate != null ? fmtPctFromDecimal(task.outputScrapRate) : '—'} />
        </>
      )}

      {/* Capacity Resources */}
      {task.assignedResources?.length > 0 && (
        <>
          <SectionLabel label={`Capacity ${t('resources', 'Resources')}`} />
          {task.assignedResources.map((r: any, i: number) => (
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
              <ModeBadge mode={r.mode || 'ON'} />
            </div>
          ))}
        </>
      )}

      {/* Material Resources */}
      {task.materialResources?.length > 0 && (
        <>
          <SectionLabel label={`${t('material', 'Material')} ${t('resources', 'Resources')}`} />
          {task.materialResources.map((r: any, i: number) => (
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
              <ModeBadge mode={r.mode || 'ON'} />
            </div>
          ))}
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
                {m.scrapRate > 0 && <span style={{ color: C.yellow, marginLeft: 6 }}>({fmtPctFromDecimal(m.scrapRate)} scrap)</span>}
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
            return (
              <div key={t.key} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', marginBottom: 2, borderRadius: 6,
                background: isCurrent ? C.accentGlow : 'transparent',
                border: isCurrent ? `1px solid ${C.accent}33` : '1px solid transparent',
                fontSize: 12,
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: t.feasible ? C.greenDim : C.redDim,
                  color: t.feasible ? C.green : C.red, fontSize: 10, fontWeight: 700,
                }}>
                  {i + 1}
                </span>
                <span style={{ color: isCurrent ? C.accent : C.text, fontWeight: isCurrent ? 700 : 400, flex: 1 }}>
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
   GANTT CHART
   ═══════════════════════════════════════════════════════════════ */

function GanttChart({ tasks, resources, products, colors, onTaskClick, onResourceClick }: {
  tasks: any[]; resources: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
}) {
  const [hovered, setHovered] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState('Day');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [ganttSearch, setGanttSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [hiddenWorkCenters, setHiddenWorkCenters] = useState<Set<string>>(new Set());

  // Compute time range from actual scheduled task data
  const scheduled = tasks.filter((t: any) => t.feasible && t.scheduledStart && t.scheduledEnd);

  if (scheduled.length === 0) {
    return <div style={{ color: C.textDim, padding: 20 }}>No {t('scheduledStatus', 'scheduled').toLowerCase()} {t('tasks', 'tasks')}</div>;
  }

  const taskStarts = scheduled.map((t: any) => new Date(t.scheduledStart).getTime());
  const taskEnds = scheduled.map((t: any) => new Date(t.scheduledEnd).getTime());
  const dataStart = Math.min(...taskStarts);
  const dataEnd = Math.max(...taskEnds);

  const zoomConfig = ZOOM_LEVELS.find(z => z.label === zoomLevel);
  let hStartMs: number, hEndMs: number;

  if (zoomConfig && zoomConfig.days > 0) {
    const viewStart = new Date(dataStart);
    if (zoomConfig.days < 1) {
      // Sub-day zoom: snap to the hour of earliest task
      viewStart.setUTCMinutes(0, 0, 0);
    } else {
      // Day+ zoom: snap to midnight
      viewStart.setUTCHours(0, 0, 0, 0);
    }
    const stepMs = zoomConfig.days * 24 * 3600 * 1000;
    const scrolledStart = new Date(viewStart.getTime() + scrollOffset * stepMs);
    const scrolledEnd = new Date(scrolledStart.getTime() + stepMs);
    hStartMs = scrolledStart.getTime();
    hEndMs = scrolledEnd.getTime();
  } else {
    // Fit to data
    const bufferMs = 12 * 3600 * 1000;
    const hStartDate = new Date(dataStart - bufferMs);
    hStartDate.setUTCHours(0, 0, 0, 0);
    const hEndDate = new Date(dataEnd + bufferMs);
    hEndDate.setUTCHours(23, 59, 59, 999);
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
      const hr = h.getUTCHours();
      const min = h.getUTCMinutes();
      let label: string;
      if (zoomConfig.days < 1) {
        // 3 Hr view: full time on every tick
        label = h.toLocaleTimeString(_locale?.locale || 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: _locale?.timezone || 'UTC' });
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
    const d = new Date(hStartMs);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 1);
    let count = 0;
    while (d.getTime() < hEndMs) {
      if (count % step === 0) {
        axisLabels.push({
          date: new Date(d),
          pct: ((d.getTime() - hStartMs) / totalMs) * 100,
          label: d.toLocaleDateString(_locale?.locale || 'en-US', { month: 'short', day: 'numeric', timeZone: _locale?.timezone || 'UTC' }),
        });
      }
      d.setUTCDate(d.getUTCDate() + 1);
      count++;
    }
  }

  // Group tasks by primary resource
  const resMap = new Map<string, any[]>();
  resources.forEach((r: any) => resMap.set(r.resourceKey, []));
  tasks.filter((t: any) => t.feasible && t.scheduledStart && t.scheduledEnd).forEach((t: any) => {
    const rk = t.assignedResources?.[0]?.resourceKey;
    if (rk && resMap.has(rk)) resMap.get(rk)!.push(t);
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
  const LABEL_W = 140;

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
            <button key={z.label} onClick={() => { setZoomLevel(z.label); setScrollOffset(0); }} style={{
              padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
              background: z.label === zoomLevel ? '#3b82f6' : 'transparent',
              color: z.label === zoomLevel ? '#fff' : '#94a3b8',
              fontFamily: FONT,
            }}>
              {z.label}
            </button>
          ))}
        </div>
        {zoomConfig && zoomConfig.days > 0 && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            <button onClick={() => setScrollOffset(s => s - 1)} style={{
              padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT,
            }}>← {act('prev', 'Prev')}</button>
            <button onClick={() => setScrollOffset(0)} style={{
              padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 12, fontFamily: FONT,
            }}>{act('today', 'Today')}</button>
            <button onClick={() => setScrollOffset(s => s + 1)} style={{
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
            return (
              <div key={res.resourceKey} style={{ display: 'flex', borderTop: `1px solid ${C.border}` }}>
                <div
                  onClick={() => onResourceClick?.(res)}
                  style={{
                    width: LABEL_W, minWidth: LABEL_W, padding: '10px 12px', fontSize: 12,
                    color: C.textMuted, fontWeight: 500, display: 'flex', alignItems: 'center',
                    cursor: onResourceClick ? 'pointer' : 'default',
                    transition: 'color 0.1s',
                  }}
                  onMouseEnter={e => { if (onResourceClick) e.currentTarget.style.color = C.accent; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
                >
                  {res.resourceName}
                </div>
                <div style={{ flex: 1, position: 'relative', height: LANE_H, overflow: 'hidden' }}>
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
                    return (
                      <div
                        key={t.key}
                        onMouseEnter={e => { setHovered(t); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                        onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => onTaskClick?.(t)}
                        style={{
                          position: 'absolute', left: `${left}%`, width: `${w}%`,
                          top: 6, height: LANE_H - 12, borderRadius: 4,
                          background: barColor, opacity: 0.85, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', paddingLeft: 4,
                          overflow: 'hidden', fontSize: 10, color: '#fff', fontWeight: 500,
                          transition: 'opacity 0.15s',
                        }}
                      >
                        {w > 3 && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}

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
   TASK TABLE
   ═══════════════════════════════════════════════════════════════ */

function TaskTable({ tasks, products, colors, onTaskClick }: { tasks: any[]; products: any[]; colors: any; onTaskClick?: (t: any) => void }) {
  const { sortKey, sortDir, toggle, sorted } = useSort('key');

  // Pre-compute flat resource field for filtering/sorting
  const enriched = useMemo(() => tasks.map(tk => ({
    ...tk,
    _resource: tk.assignedResources?.[0]?.resourceKey || '',
    _status: tk.feasible ? 'scheduled' : 'infeasible',
  })), [tasks]);

  const statusDeriver = useCallback((row: any) => row._status, []);
  const filter = useFilter(enriched, { statusDeriver });

  const scheduledCount = enriched.filter(tk => tk.feasible).length;
  const infeasibleCount = enriched.length - scheduledCount;
  const statusOptions = [
    { value: 'all', label: 'All', count: enriched.length },
    { value: 'scheduled', label: t('scheduledStatus', 'Scheduled'), color: C.green, count: scheduledCount },
    { value: 'infeasible', label: t('infeasibleStatus', 'Infeasible'), color: C.red, count: infeasibleCount },
  ];

  const colFilter = (key: string) => ({
    distinctValues: filter.distinctValues(key),
    selected: filter.columnFilters[key] || new Set<string>(),
    onToggle: filter.toggleColumnValue,
    onClear: filter.clearColumnFilter,
  });

  const rows = sorted(filter.filtered);
  return (
    <div>
      <FilterBar filter={filter} statusOptions={statusOptions} />
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <SortHeader label={t('task', 'Task')} k="key" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('order', 'Order')} k="orderRef" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('orderRef')} />
              <SortHeader label={t('product', 'Product')} k="outputProductKey" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('outputProductKey')} />
              <SortHeader label={t('quantity', 'Qty')} k="outputQty" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Scrap%" k="outputScrapRate" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('resource', 'Resource')} k="_resource" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('_resource')} />
              <SortHeader label="Start" k="scheduledStart" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="End" k="scheduledEnd" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('duration', 'Duration')} k="durationSeconds" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('score', 'Score')} k="score" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Status" k="feasible" current={sortKey} dir={sortDir} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {rows.map((tk: any) => {
              const resKey = tk._resource || '—';
              const prodColor = colors ? getTaskColor(tk, colors) : C.accent;
              return (
                <tr key={tk.key} style={{ transition: 'background 0.1s', cursor: onTaskClick ? 'pointer' : 'default' }}
                  onClick={() => onTaskClick?.(tk)}
                  onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={cellStyle}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{tk.key}</div>
                    <div style={{ fontSize: 11, color: C.textDim }}>{tk.name}</div>
                  </td>
                  <td style={cellStyle}>{tk.orderRef || '—'}</td>
                  <td style={cellStyle}>
                    {tk.outputProductKey ? (
                      <span style={{ color: prodColor, fontWeight: 500 }}>
                        {products.find((p: any) => p.key === tk.outputProductKey)?.name || tk.outputProductKey}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(tk.outputQty)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {tk.outputScrapRate != null ? fmtPctFromDecimal(tk.outputScrapRate) : '—'}
                  </td>
                  <td style={cellStyle}>{resKey}</td>
                  <td style={cellStyle}>{fmtDate(tk.scheduledStart)}</td>
                  <td style={cellStyle}>{fmtDate(tk.scheduledEnd)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtDuration(tk.durationSeconds)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    {tk.score != null ? tk.score.toFixed(2) : '—'}
                  </td>
                  <td style={cellStyle}>
                    <Badge label={tk.feasible ? t('scheduledStatus', 'Scheduled') : t('infeasibleStatus', 'Infeasible')}
                      color={tk.feasible ? C.green : C.red} />
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
   ORDER TABLE
   ═══════════════════════════════════════════════════════════════ */

function OrderTable({ orders, products }: { orders: any[]; products: any[] }) {
  const { sortKey, sortDir, toggle, sorted } = useSort('priority');

  const enriched = useMemo(() => orders.map(o => ({ ...o, _status: deriveOrderStatus(o) })), [orders]);

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
    distinctValues: filter.distinctValues(key),
    selected: filter.columnFilters[key] || new Set<string>(),
    onToggle: filter.toggleColumnValue,
    onClear: filter.clearColumnFilter,
  });

  const rows = sorted(filter.filtered);
  return (
    <div>
      <FilterBar filter={filter} statusOptions={statusOptions} />
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <SortHeader label={t('order', 'Order')} k="orderKey" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('product', 'Product')} k="productKey" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('productKey')} />
              <SortHeader label={t('demand', 'Demand')} k="demandQty" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('scheduledStatus', 'Scheduled')} k="scheduledQty" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('dueDate', 'Due Date')} k="dueDate" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label={t('priority', 'Priority')} k="priority" current={sortKey} dir={sortDir} onSort={toggle}
                filterProps={colFilter('priority')} />
              <SortHeader label={t('fillRate', 'Fill Rate')} k="fillRate" current={sortKey} dir={sortDir} onSort={toggle} />
              <SortHeader label="Status" k="_status" current={sortKey} dir={sortDir} onSort={toggle} />
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
                  <td style={{ ...cellStyle, fontWeight: 600 }}>{o.orderKey}</td>
                  <td style={cellStyle}>
                    <span style={{ color: prodColor, fontWeight: 500 }}>
                      {products.find((p: any) => p.key === o.productKey)?.name || o.productKey}
                    </span>
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(o.demandQty)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(o.scheduledQty)}</td>
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
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtPctFromDecimal(o.fillRate)}</span>
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

function MatTable({ materials }: { materials: any[] }) {
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
    distinctValues: filter.distinctValues(key),
    selected: filter.columnFilters[key] || new Set<string>(),
    onToggle: filter.toggleColumnValue,
    onClear: filter.clearColumnFilter,
  });

  const rows = sorted(filter.filtered);
  return (
    <div>
      <FilterBar filter={filter} statusOptions={statusOptions} />
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
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

function OverviewTab({ summary, tasks, resources, orders, materials, products, colors, onTabChange, onTaskClick, onResourceClick }: {
  summary: any; tasks: any[]; resources: any[]; orders: any[]; materials: any[];
  products: any[]; colors: any; onTabChange: (t: string) => void;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
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
          + (summary?.setupTasks ? ` + ${summary.setupTasks} ${t('setup', 'setup')}s` : '')} />
        <KPI icon="⚡" label={`Avg ${t('utilization', 'Utilization')}`} value={fmtPctDirect(avgUtil)} color={
          avgUtil > 85 ? C.red : avgUtil > 60 ? C.yellow : C.green
        } sub={`${resources.length} ${t('resources', 'resources')}`} />
        <KPI icon="⏰" label={`Late ${t('orders', 'Orders')}`} value={lateOrders} color={lateOrders > 0 ? C.red : C.green}
          sub={`of ${orders.length} total`} />
        <KPI icon="⚠" label={t('conflicts', 'Conflicts')} value={conflicts.length}
          color={conflicts.length > 0 ? C.red : C.green} sub={`${t('task', 'task')} + ${t('material', 'material')}`} />
        <KPI icon="📦" label={`${t('shortage', 'Shortage')}s`} value={shortages} color={shortages > 0 ? C.red : C.green}
          sub={`of ${materials.length} ${t('materials', 'materials')}`} />
      </div>

      {/* Gantt + Side panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        <Card title={`${t('schedule', 'Schedule')} Overview`}>
          <GanttChart tasks={tasks} resources={resources} products={products} colors={colors} onTaskClick={onTaskClick} onResourceClick={onResourceClick} />
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
   TAB CONTENT — SCHEDULE
   ═══════════════════════════════════════════════════════════════ */

function ScheduleTab({ tasks, resources, products, colors, onTaskClick, onResourceClick }: {
  tasks: any[]; resources: any[]; products: any[]; colors: any;
  onTaskClick?: (t: any) => void; onResourceClick?: (r: any) => void;
}) {
  const [sub, setSub] = useState('Gantt');
  return (
    <div>
      <SubTabs tabs={['Gantt', `${t('task', 'Task')} List`]} active={sub} onChange={setSub} />
      {sub === 'Gantt' ? (
        <Card>
          <GanttChart tasks={tasks} resources={resources} products={products} colors={colors} onTaskClick={onTaskClick} onResourceClick={onResourceClick} />
        </Card>
      ) : (
        <Card>
          <TaskTable tasks={tasks} products={products} colors={colors} onTaskClick={onTaskClick} />
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — ORDERS
   ═══════════════════════════════════════════════════════════════ */

function OrdersTab({ orders, products }: { orders: any[]; products: any[] }) {
  const totalDemand = orders.reduce((s: number, o: any) => s + (o.demandQty || 0), 0);
  const lateCount = orders.filter((o: any) => deriveOrderStatus(o) === 'late').length;
  const atRiskCount = orders.filter((o: any) => deriveOrderStatus(o) === 'at-risk').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label={`Total ${t('orders', 'Orders')}`} value={orders.length} icon="📋" />
        <KPI label={`Total ${t('demand', 'Demand')}`} value={fmtNum(totalDemand)} icon="📦" />
        <KPI label={t('late', 'Late')} value={lateCount} icon="⏰" color={lateCount > 0 ? C.red : C.green} />
        <KPI label={t('atRisk', 'At Risk')} value={atRiskCount} icon="⚠" color={atRiskCount > 0 ? C.yellow : C.green} />
      </div>
      <Card>
        <OrderTable orders={orders} products={products} />
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

function MaterialsTab({ materials }: { materials: any[] }) {
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
        <MatTable materials={materials} />
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL CONTENT
   ═══════════════════════════════════════════════════════════════ */

function SettingsContent() {
  const row: CSSProperties = {
    display: 'flex', justifyContent: 'space-between', padding: '8px 0',
    borderBottom: `1px solid ${C.border}`, fontSize: 13,
  };
  return (
    <div style={{ fontFamily: FONT }}>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Direction</span>
        <span style={{ color: C.text, fontWeight: 600 }}>Forward</span>
      </div>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Max Lateness</span>
        <span style={{ color: C.text, fontWeight: 600 }}>0 hours</span>
      </div>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Tasks Per Loop</span>
        <span style={{ color: C.text, fontWeight: 600 }}>50</span>
      </div>
      <div style={row}>
        <span style={{ color: C.textMuted }}>Top Tasks To Schedule</span>
        <span style={{ color: C.text, fontWeight: 600 }}>2</span>
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, marginBottom: 8 }}>Scoring Rules</div>
        <div style={{ ...row, borderBottom: 'none' }}>
          <span style={{ color: C.textMuted }}>EarliestStartTimeRule</span>
          <span style={{ color: C.text }}>Weight: 1.0 · Minimize</span>
        </div>
        <div style={{ ...row, borderBottom: 'none' }}>
          <span style={{ color: C.textMuted }}>ResourceUtilizationRule</span>
          <span style={{ color: C.text }}>Weight: 0.5 · Maximize</span>
        </div>
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
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */

const TABS = ['Overview', 'Schedule', 'Orders', 'Conflicts', 'Materials'];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedResource, setSelectedResource] = useState<any>(null);
  const [colors, setColors] = useState<any>(null);

  // Solve preview state
  const [showSolvePreview, setShowSolvePreview] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [orderModes, _setOrderModes] = useState<Record<string, string>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [taskPins, _setTaskPins] = useState<Record<string, boolean>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [taskExcludes, _setTaskExcludes] = useState<Record<string, boolean>>({});
  const [taskUnschedules, setTaskUnschedules] = useState<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [materialModeOverrides, _setMaterialModeOverrides] = useState<Record<string, string>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [resourceModeOverrides, _setResourceModeOverrides] = useState<Record<string, string>>({});
  const [solveStale, setSolveStale] = useState(false);
  // Previous state snapshots for delta computation
  const [prevOrderModes, setPrevOrderModes] = useState<Record<string, string>>({});
  const [prevTaskPins, setPrevTaskPins] = useState<Record<string, boolean>>({});
  const [prevTaskExcludes, setPrevTaskExcludes] = useState<Record<string, boolean>>({});
  const [prevMaterialModes, setPrevMaterialModes] = useState<Record<string, string>>({});

  const tasks = solveResult?.tasks || [];
  const resources = solveResult?.resourceUtilization || [];
  const orders = solveResult?.orders || [];
  const materials = solveResult?.materials || [];
  const summary = solveResult?.summary || null;

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [result, prods, colorsData, termData, localeData] = await Promise.all([
        api('/ctp/solve-and-sync', { method: 'POST' }),
        api('/data/products'),
        api('/data/colors').catch(() => null),
        api('/data/terminology').catch(() => ({})),
        api('/data/locale').catch(() => ({})),
      ]);
      setSolveResult(result);
      setProducts(prods);
      setColors(result.colors || colorsData || {});
      _terminology = result.terminology || termData || {};
      _locale = result.locale || localeData || {};
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    }
  }, []);

  const handleSolveConfirm = useCallback(async () => {
    setShowSolvePreview(false);
    setSolving(true);
    setSelectedTask(null);
    setSelectedResource(null);
    try {
      setError(null);
      const result = await api('/ctp/solve-and-sync', { method: 'POST' });
      setSolveResult(result);
      setSolveStale(false);

      // Snapshot current state as "previous" for next delta computation
      setPrevOrderModes({ ...orderModes });
      setPrevTaskPins({ ...taskPins });
      setPrevTaskExcludes({ ...taskExcludes });
      setPrevMaterialModes({ ...materialModeOverrides });

      // Clear one-time actions
      setTaskUnschedules(new Set());

      if (result.colors) setColors(result.colors);
      if (result.terminology) _terminology = result.terminology;
      if (result.locale) _locale = result.locale;
    } catch (e: any) {
      setError(e.message || 'Solve failed');
    } finally {
      setSolving(false);
    }
  }, [orderModes, taskPins, taskExcludes, materialModeOverrides]);

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
    setSelectedResource(r);
  }, []);

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
                Solving…
              </>
            ) : solveStale ? (
              <>{'\u25B6'} Review & Solve</>
            ) : (
              <>{'\u25B6'} {act('solveAll', 'Solve All')}</>
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              background: 'none', border: 'none', color: C.textMuted, fontSize: 18,
              cursor: 'pointer', padding: '4px 6px', lineHeight: 1,
            }}
            title="Settings"
          >
            ⚙
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
              onClick={() => setActiveTab(tab)}
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

      {/* Tab content */}
      <main style={{ padding: 24 }}>
        {activeTab === 'Overview' && (
          <OverviewTab summary={summary} tasks={tasks} resources={resources}
            orders={orders} materials={materials} products={products} colors={colors} onTabChange={setActiveTab}
            onTaskClick={handleTaskClick} onResourceClick={handleResourceClick} />
        )}
        {activeTab === 'Schedule' && (
          <ScheduleTab tasks={tasks} resources={resources} products={products} colors={colors}
            onTaskClick={handleTaskClick} onResourceClick={handleResourceClick} />
        )}
        {activeTab === 'Orders' && <OrdersTab orders={orders} products={products} />}
        {activeTab === 'Conflicts' && <ConflictsTab tasks={tasks} resources={resources} materials={materials}
          onTaskClick={handleTaskClickByKey} />}
        {activeTab === 'Materials' && <MaterialsTab materials={materials} />}
      </main>

      {/* Modals */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Engine Settings">
        <SettingsContent />
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
          onConfirm={handleSolveConfirm}
          onCancel={handleSolveCancel}
        />
      )}

      {/* Global animation keyframes */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
