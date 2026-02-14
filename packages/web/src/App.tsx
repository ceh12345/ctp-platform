import { useState, useEffect, useCallback, CSSProperties, ReactNode } from 'react';

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
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPct(v: number | null | undefined, scale = 1): string {
  if (v == null) return '—';
  return `${(v * scale).toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString();
}

function getProductColor(productKey: string | null | undefined, products: any[]): string {
  if (!productKey) return C.textDim;
  const product = products.find((p: any) => p.key === productKey);
  if (!product) return C.accent;
  const name: string = product.name || '';
  if (name.includes('Widget-A')) return C.accent;
  if (name.includes('Widget-B')) return C.purple;
  if (name.includes('Widget-C')) return C.cyan;
  if (name.includes('Housing')) return C.orange;
  if (name.includes('Bracket')) return C.green;
  return C.accent;
}

function deriveOrderStatus(order: any): string {
  const fillRate = order.fillRate ?? 0;
  if (fillRate >= 0.99) return 'on-track';
  const now = Date.now();
  const due = new Date(order.dueDate).getTime();
  if (due < now && fillRate < 0.99) return 'late';
  if (fillRate < 0.5 || due - now < 48 * 3600 * 1000) return 'at-risk';
  return 'on-track';
}

function deriveMaterialStatus(mat: any): string {
  const remaining = mat.remaining ?? (mat.onHand - (mat.consumed || 0));
  if (remaining < 0) return 'shortage';
  if (remaining < mat.onHand * 0.2) return 'at-risk';
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
    const affected = tasks.filter((t: any) =>
      t.inputMaterials?.some((m: any) => m.productKey === matKey),
    );
    if (affected.length === 0) return;
    conflicts.push({
      id: `CFT-MAT-${matKey}`,
      taskKey: affected[0].key,
      taskName: affected[0].name,
      orderRef: affected[0].orderRef,
      severity: status === 'shortage' ? 'critical' : 'warning',
      reason: 'material',
      reasonDetail: `${matName}: ${fmtNum(mat.onHand)} on hand, ${fmtNum(mat.consumed)} consumed, ${fmtNum(mat.remaining)} remaining`,
      bottleneckResource: null,
      bottleneckUtilization: 0,
      materialKey: matKey,
      materialName: matName,
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
   SMALL UI COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function SortHeader({ label, k, current, dir, onSort }: {
  label: string; k: string; current: string; dir: string; onSort: (k: string) => void;
}) {
  const active = k === current;
  return (
    <th
      onClick={() => onSort(k)}
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
        color: active ? C.accent : C.textMuted, cursor: 'pointer', userSelect: 'none',
        borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontFamily: FONT,
      }}
    >
      {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
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
  const c = color || (pct >= 0.9 ? C.green : pct >= 0.5 ? C.yellow : C.red);
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(Math.max(pct, 0), 1));
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function UtilBar({ pct, label }: { pct: number; label: string }) {
  const color = pct > 90 ? C.red : pct > 70 ? C.yellow : C.green;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
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

function GanttChart({ tasks, resources, summary, products }: {
  tasks: any[]; resources: any[]; summary: any; products: any[];
}) {
  const [hovered, setHovered] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  if (!summary?.horizonStart || !summary?.horizonEnd) {
    return <div style={{ color: C.textDim, padding: 20 }}>No horizon data</div>;
  }

  const hStart = new Date(summary.horizonStart).getTime();
  const hEnd = new Date(summary.horizonEnd).getTime();
  const totalMs = hEnd - hStart;
  if (totalMs <= 0) return <div style={{ color: C.textDim }}>Invalid horizon</div>;

  const toPct = (iso: string) => ((new Date(iso).getTime() - hStart) / totalMs) * 100;

  // Day grid
  const days: { date: Date; pct: number }[] = [];
  const d = new Date(hStart);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getTime() < hEnd) {
    days.push({ date: new Date(d), pct: ((d.getTime() - hStart) / totalMs) * 100 });
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Group tasks by primary resource
  const resMap = new Map<string, any[]>();
  resources.forEach((r: any) => resMap.set(r.resourceKey, []));
  tasks.filter((t: any) => t.feasible && t.scheduledStart && t.scheduledEnd).forEach((t: any) => {
    const rk = t.assignedResources?.[0]?.resourceKey;
    if (rk && resMap.has(rk)) resMap.get(rk)!.push(t);
  });

  const LANE_H = 44;
  const LABEL_W = 140;

  return (
    <div style={{ position: 'relative' }}>
      {/* Time axis */}
      <div style={{ marginLeft: LABEL_W, display: 'flex', position: 'relative', height: 24 }}>
        {days.map((day, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${day.pct}%`, fontSize: 10, color: C.textDim,
            transform: 'translateX(-50%)', whiteSpace: 'nowrap',
          }}>
            {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
          </div>
        ))}
      </div>

      {/* Lanes */}
      {resources.map((res: any) => {
        const rTasks = resMap.get(res.resourceKey) || [];
        return (
          <div key={res.resourceKey} style={{ display: 'flex', borderTop: `1px solid ${C.border}` }}>
            <div style={{
              width: LABEL_W, minWidth: LABEL_W, padding: '10px 12px', fontSize: 12,
              color: C.textMuted, fontWeight: 500, display: 'flex', alignItems: 'center',
            }}>
              {res.resourceName}
            </div>
            <div style={{ flex: 1, position: 'relative', height: LANE_H }}>
              {/* Day grid lines */}
              {days.map((day, i) => (
                <div key={i} style={{
                  position: 'absolute', left: `${day.pct}%`, top: 0, bottom: 0,
                  width: 1, background: C.border, opacity: 0.5,
                }} />
              ))}
              {/* Task bars */}
              {rTasks.map((t: any) => {
                const left = toPct(t.scheduledStart);
                const right = toPct(t.scheduledEnd);
                const w = Math.max(right - left, 0.3);
                const barColor = getProductColor(t.outputProductKey, products);
                return (
                  <div
                    key={t.key}
                    onMouseEnter={e => { setHovered(t); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
                    onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHovered(null)}
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
          <div style={{ color: C.textMuted }}>
            {fmtDate(hovered.scheduledStart)} → {fmtDate(hovered.scheduledEnd)}
          </div>
          <div style={{ color: C.textMuted }}>Duration: {fmtDuration(hovered.durationSeconds)}</div>
          {hovered.orderRef && <div style={{ color: C.textMuted }}>Order: {hovered.orderRef}</div>}
          {hovered.outputProductKey && (
            <div style={{ color: C.textMuted }}>
              Output: {hovered.outputProductKey} × {fmtNum(hovered.outputQty)}
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

function TaskTable({ tasks, products }: { tasks: any[]; products: any[] }) {
  const { sortKey, sortDir, toggle, sorted } = useSort('key');
  const rows = sorted(tasks);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <SortHeader label="Task" k="key" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Order" k="orderRef" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Product" k="outputProductKey" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Qty" k="outputQty" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Scrap%" k="outputScrapRate" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Resource" k="_resource" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Start" k="scheduledStart" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="End" k="scheduledEnd" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Duration" k="durationSeconds" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Score" k="score" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Status" k="feasible" current={sortKey} dir={sortDir} onSort={toggle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((t: any) => {
            const resKey = t.assignedResources?.[0]?.resourceKey || '—';
            const prodColor = getProductColor(t.outputProductKey, products);
            return (
              <tr key={t.key} style={{ transition: 'background 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.key}</div>
                  <div style={{ fontSize: 11, color: C.textDim }}>{t.name}</div>
                </td>
                <td style={cellStyle}>{t.orderRef || '—'}</td>
                <td style={cellStyle}>
                  {t.outputProductKey ? (
                    <span style={{ color: prodColor, fontWeight: 500 }}>{t.outputProductKey}</span>
                  ) : '—'}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(t.outputQty)}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  {t.outputScrapRate != null ? fmtPct(t.outputScrapRate, 100) : '—'}
                </td>
                <td style={cellStyle}>{resKey}</td>
                <td style={cellStyle}>{fmtDate(t.scheduledStart)}</td>
                <td style={cellStyle}>{fmtDate(t.scheduledEnd)}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtDuration(t.durationSeconds)}</td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  {t.score != null ? t.score.toFixed(2) : '—'}
                </td>
                <td style={cellStyle}>
                  <Badge label={t.feasible ? 'scheduled' : 'infeasible'}
                    color={t.feasible ? C.green : C.red} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDER TABLE
   ═══════════════════════════════════════════════════════════════ */

function OrderTable({ orders, products }: { orders: any[]; products: any[] }) {
  const { sortKey, sortDir, toggle, sorted } = useSort('priority');
  const rows = sorted(orders);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <SortHeader label="Order" k="orderKey" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Product" k="productKey" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Demand" k="demandQty" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Scheduled" k="scheduledQty" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Due Date" k="dueDate" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Priority" k="priority" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Fill Rate" k="fillRate" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Status" k="_status" current={sortKey} dir={sortDir} onSort={toggle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((o: any) => {
            const status = deriveOrderStatus(o);
            const prodColor = getProductColor(o.productKey, products);
            return (
              <tr key={o.orderKey}
                onMouseEnter={e => (e.currentTarget.style.background = C.surface2)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ ...cellStyle, fontWeight: 600 }}>{o.orderKey}</td>
                <td style={cellStyle}>
                  <span style={{ color: prodColor, fontWeight: 500 }}>{o.productKey}</span>
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
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtPct(o.fillRate, 100)}</span>
                  </div>
                </td>
                <td style={cellStyle}><Badge label={status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MATERIALS TABLE
   ═══════════════════════════════════════════════════════════════ */

function MatTable({ materials }: { materials: any[] }) {
  const { sortKey, sortDir, toggle, sorted } = useSort('materialKey');
  const rows = sorted(materials);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <SortHeader label="Material" k="materialKey" current={sortKey} dir={sortDir} onSort={toggle} />
            <SortHeader label="Unit" k="unit" current={sortKey} dir={sortDir} onSort={toggle} />
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
            const status = deriveMaterialStatus(m);
            const net = (m.remaining ?? 0) + (m.incoming ?? 0);
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
                  {fmtNum(m.remaining)}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>{fmtNum(m.incoming)}</td>
                <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: net < 0 ? C.red : C.green }}>
                  {net >= 0 ? '+' : ''}{fmtNum(net)}
                </td>
                <td style={cellStyle}><Badge label={status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONFLICT CARDS
   ═══════════════════════════════════════════════════════════════ */

function ConflictCards({ conflicts }: { conflicts: any[] }) {
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
        No conflicts detected
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
                <div style={{ color: C.textDim, marginTop: 4 }}>
                  <strong>Task Key:</strong> {c.taskKey}
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

function OverviewTab({ summary, tasks, resources, orders, materials, products, onTabChange }: {
  summary: any; tasks: any[]; resources: any[]; orders: any[]; materials: any[];
  products: any[]; onTabChange: (t: string) => void;
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
        <KPI icon="✓" label="Feasibility" value={fmtPct(summary?.feasibilityRate)} color={
          (summary?.feasibilityRate ?? 0) >= 90 ? C.green : (summary?.feasibilityRate ?? 0) >= 70 ? C.yellow : C.red
        } sub={`${summary?.scheduledTasks ?? 0} of ${summary?.includedTasks ?? 0} tasks`} />
        <KPI icon="⚡" label="Avg Utilization" value={fmtPct(avgUtil)} color={
          avgUtil > 85 ? C.red : avgUtil > 60 ? C.yellow : C.green
        } sub={`${resources.length} resources`} />
        <KPI icon="⏰" label="Late Orders" value={lateOrders} color={lateOrders > 0 ? C.red : C.green}
          sub={`of ${orders.length} total`} />
        <KPI icon="⚠" label="Conflicts" value={conflicts.length}
          color={conflicts.length > 0 ? C.red : C.green} sub="task + material" />
        <KPI icon="📦" label="Shortages" value={shortages} color={shortages > 0 ? C.red : C.green}
          sub={`of ${materials.length} materials`} />
      </div>

      {/* Gantt + Side panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        <Card title="Schedule Overview">
          <GanttChart tasks={tasks} resources={resources} summary={summary} products={products} />
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Resource Utilization">
            {resources.map((r: any) => (
              <UtilBar key={r.resourceKey} pct={r.utilization} label={r.resourceName} />
            ))}
          </Card>
          <Card title="Order Status">
            {orders.map((o: any) => {
              const status = deriveOrderStatus(o);
              return (
                <div key={o.orderKey} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: `1px solid ${C.border}`,
                }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{o.orderKey}</span>
                    <span style={{ color: C.textDim, fontSize: 12, marginLeft: 8 }}>{o.productKey}</span>
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
            ⚠ {conflicts.filter((c: any) => c.severity === 'critical').length} critical conflicts detected
          </span>
          <span style={{ color: C.red, fontSize: 12 }}>View Conflicts →</span>
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
            📦 {shortages} material shortage{shortages > 1 ? 's' : ''} — review inventory
          </span>
          <span style={{ color: C.yellow, fontSize: 12 }}>View Materials →</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TAB CONTENT — SCHEDULE
   ═══════════════════════════════════════════════════════════════ */

function ScheduleTab({ tasks, resources, summary, products }: {
  tasks: any[]; resources: any[]; summary: any; products: any[];
}) {
  const [sub, setSub] = useState('Gantt Chart');
  return (
    <div>
      <SubTabs tabs={['Gantt Chart', 'Task List']} active={sub} onChange={setSub} />
      {sub === 'Gantt Chart' ? (
        <Card>
          <GanttChart tasks={tasks} resources={resources} summary={summary} products={products} />
        </Card>
      ) : (
        <Card>
          <TaskTable tasks={tasks} products={products} />
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
        <KPI label="Total Orders" value={orders.length} icon="📋" />
        <KPI label="Total Demand" value={fmtNum(totalDemand)} icon="📦" />
        <KPI label="Late" value={lateCount} icon="⏰" color={lateCount > 0 ? C.red : C.green} />
        <KPI label="At Risk" value={atRiskCount} icon="⚠" color={atRiskCount > 0 ? C.yellow : C.green} />
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

function ConflictsTab({ tasks, resources, materials }: {
  tasks: any[]; resources: any[]; materials: any[];
}) {
  const conflicts = deriveConflicts(tasks, resources, materials);
  const critical = conflicts.filter((c: any) => c.severity === 'critical').length;
  const infeasible = tasks.filter((t: any) => t.included && !t.feasible).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label="Total Conflicts" value={conflicts.length} icon="⚠"
          color={conflicts.length > 0 ? C.red : C.green} />
        <KPI label="Critical" value={critical} icon="🔴"
          color={critical > 0 ? C.red : C.green} />
        <KPI label="Infeasible Tasks" value={infeasible} icon="✕"
          color={infeasible > 0 ? C.red : C.green} />
      </div>
      <ConflictCards conflicts={conflicts} />
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
        <KPI label="Materials Tracked" value={materials.length} icon="📦" />
        <KPI label="Shortages" value={shortages} icon="🔴" color={shortages > 0 ? C.red : C.green} />
        <KPI label="At Risk" value={atRisk} icon="⚠" color={atRisk > 0 ? C.yellow : C.green} />
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
        <span style={{ color: C.text }}>Precision Parts Co.</span>
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

  const tasks = solveResult?.tasks || [];
  const resources = solveResult?.resourceUtilization || [];
  const orders = solveResult?.orders || [];
  const materials = solveResult?.materials || [];
  const summary = solveResult?.summary || null;

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [result, prods] = await Promise.all([
        api('/ctp/solve-and-sync', { method: 'POST' }),
        api('/data/products'),
      ]);
      setSolveResult(result);
      setProducts(prods);
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    }
  }, []);

  const handleSolve = useCallback(async () => {
    setSolving(true);
    try {
      setError(null);
      const result = await api('/ctp/solve-and-sync', { method: 'POST' });
      setSolveResult(result);
    } catch (e: any) {
      setError(e.message || 'Solve failed');
    } finally {
      setSolving(false);
    }
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
        <div style={{ marginTop: 16, color: C.textMuted, fontSize: 14 }}>Loading CTP Platform...</div>
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
            <span style={{ color: C.textDim, fontSize: 13, marginLeft: 8 }}>Precision Parts Co.</span>
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
              <span>{resources.length} resources</span>
              <span>{summary.totalTasks} tasks</span>
              <span>{orders.length} orders</span>
            </div>
          )}
          <button
            onClick={handleSolve}
            disabled={solving}
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
            ) : (
              <>▶ Solve All</>
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
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 20px', background: 'none', border: 'none',
              borderBottom: tab === activeTab ? `2px solid ${C.accent}` : '2px solid transparent',
              color: tab === activeTab ? C.text : C.textMuted,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab}
          </button>
        ))}
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
            Retry
          </button>
        </div>
      )}

      {/* Tab content */}
      <main style={{ padding: 24 }}>
        {activeTab === 'Overview' && (
          <OverviewTab summary={summary} tasks={tasks} resources={resources}
            orders={orders} materials={materials} products={products} onTabChange={setActiveTab} />
        )}
        {activeTab === 'Schedule' && (
          <ScheduleTab tasks={tasks} resources={resources} summary={summary} products={products} />
        )}
        {activeTab === 'Orders' && <OrdersTab orders={orders} products={products} />}
        {activeTab === 'Conflicts' && <ConflictsTab tasks={tasks} resources={resources} materials={materials} />}
        {activeTab === 'Materials' && <MaterialsTab materials={materials} />}
      </main>

      {/* Modals */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Engine Settings">
        <SettingsContent />
      </Modal>
      <Modal open={userOpen} onClose={() => setUserOpen(false)} title="User Profile">
        <UserProfileContent />
      </Modal>

      {/* Global animation keyframes */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
