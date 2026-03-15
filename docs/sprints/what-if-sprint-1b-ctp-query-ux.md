# What-If Sprint 1b: CTP Query UX Enhancements

**What it does:** Improves the CTP Query results dialog to answer the planner's question faster. Adds a promise summary banner, sorts options by completion date, collapses task detail by default, highlights the active ghost-bar option, and improves the infeasible state with bottleneck context.

**Size:** ~1-1.5 hours CC work
**Depends on:** What-If Sprint 1 — CTP Query (done 2026-03-12)

---

## Current State

The CTP Query dialog (from What-If Sprint 1) has:
- Input form: source chain dropdown, order name, priority, date picker for need-by date
- Results: flat list of option cards, each showing all tasks with start/end/resources
- Ghost bars on Gantt for the selected option
- Book This button on each option
- Infeasibility report when zero options

**Problems:**
1. Options sorted by score (best combo first), not completion date — the planner has to scan to find the earliest delivery
2. No summary — the planner can't answer "when can I get it?" without reading through option details
3. Every option shows full task detail expanded — the dialog gets tall and noisy with 3+ options
4. No visual link between the selected option card and the ghost bars on the Gantt
5. Infeasible state shows the full report but no quick one-liner about what the bottleneck is

---

## Part 1: Backend — Summary + Sort

### 1a. Sort options by chain completion date

After building the options array in `ctpQuery()`, sort by the last task's end time (ascending = earliest completion first), then re-rank:

```typescript
// After building options from combos:
options.sort((a, b) => {
  const aEnd = a.tasks[a.tasks.length - 1]?.end || '';
  const bEnd = b.tasks[b.tasks.length - 1]?.end || '';
  return new Date(aEnd).getTime() - new Date(bEnd).getTime();
});

// Re-rank after sorting (rank 1 = earliest completion)
options.forEach((opt, i) => { opt.rank = i + 1; });
```

### 1b. Add summary to CTPQueryResponse

Extend the response interface:

```typescript
export interface CTPQueryResponse {
  orderName: string;
  sourceChainKey: string;
  feasible: boolean;
  options: CTPQueryOption[];
  summary: CTPQuerySummary | null;          // NEW
  infeasibilityReport: InfeasibilityReport | null;
}

export interface CTPQuerySummary {
  totalOptions: number;
  feasibleOptions: number;

  // The answer to "when can I get it?"
  earliestCompletionDate: string | null;    // ISO — last task end of the first sorted option
  earliestCompletionResources: string;      // "CNC-02 → Weld Bay 1 → Assembly Bay 2"
  latestCompletionDate: string | null;      // ISO — last task end of the last sorted option

  // Promise status relative to need-by date
  promiseStatus: 'on-time' | 'tight' | 'cannot-meet' | null;
  promiseSlackDays: number | null;          // positive = early, negative = late
  needByDate: string | null;               // echo back the input for display
}
```

### 1c. Build summary in ctpQuery()

After sorting options and before returning:

```typescript
const feasibleOptions = options.filter(o => o.feasible !== false);
const earliest = feasibleOptions[0];
const latest = feasibleOptions[feasibleOptions.length - 1];

const summary: CTPQuerySummary = {
  totalOptions: options.length,
  feasibleOptions: feasibleOptions.length,
  earliestCompletionDate: earliest
    ? earliest.tasks[earliest.tasks.length - 1]?.end
    : null,
  earliestCompletionResources: earliest
    ? earliest.tasks
        .filter(t => t.taskType === 'PROCESS' || !t.taskType)
        .map(t => t.resources.map(r => r.resourceName || r.resourceKey).join(', '))
        .join(' → ')
    : '',
  latestCompletionDate: latest
    ? latest.tasks[latest.tasks.length - 1]?.end
    : null,
  promiseStatus: null,
  promiseSlackDays: null,
  needByDate: request.dueDate || null,
};

// Compute promise status if need-by date was provided
if (request.dueDate && summary.earliestCompletionDate) {
  const earliestMs = new Date(summary.earliestCompletionDate).getTime();
  const needByMs = new Date(request.dueDate).getTime();
  const slackDays = Math.round((needByMs - earliestMs) / (24 * 3600 * 1000) * 10) / 10;

  summary.promiseSlackDays = slackDays;
  if (slackDays >= 2) {
    summary.promiseStatus = 'on-time';
  } else if (slackDays >= 0) {
    summary.promiseStatus = 'tight';
  } else {
    summary.promiseStatus = 'cannot-meet';
  }
}

return {
  orderName: request.orderName,
  sourceChainKey: request.sourceChainKey,
  feasible: feasibleOptions.length > 0,
  options,
  summary,
  infeasibilityReport: ...,
};
```

### 1d. Add bottleneck one-liner to infeasibility report

When the query returns zero options, extract a short summary from the `InfeasibilityReport`:

```typescript
// If infeasibilityReport exists, add a one-liner:
if (infeasibilityReport) {
  infeasibilityReport.shortSummary = infeasibilityReport.bottleneckSlot
    ? `Bottleneck: ${infeasibilityReport.bottleneckSlot} — ${
        infeasibilityReport.slots
          ?.find(s => s.isBottleneck)
          ?.resources
          ?.map(r => `${r.resourceName}: ${Math.round(r.availableMinutes / 60 * 10) / 10}h free`)
          .join(', ') || 'fully booked'
      }`
    : 'No feasible resource combinations found within the planning horizon';
}
```

---

## Part 2: Frontend — Dialog Enhancements

### 2a. Promise summary banner

Add above the options list, below the input form. This is the first thing the planner sees after clicking Evaluate.

```typescript
function CTPPromiseBanner({ summary }: { summary: CTPQuerySummary | null }) {
  if (!summary) return null;

  // No feasible options
  if (summary.feasibleOptions === 0) {
    return (
      <div style={{
        padding: '14px 18px', borderRadius: 10, marginBottom: 16,
        background: C.redDim, border: `1px solid ${C.red}`,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.red }}>
          Cannot fulfill this order
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
          No feasible placement found within the current schedule.
        </div>
      </div>
    );
  }

  // Promise status colors
  const statusConfig: Record<string, { bg: string; border: string; color: string; icon: string }> = {
    'on-time':     { bg: C.greenDim,  border: C.green,  color: C.green,  icon: '✓' },
    'tight':       { bg: C.yellowDim, border: C.yellow, color: C.yellow, icon: '⚠' },
    'cannot-meet': { bg: C.redDim,    border: C.red,    color: C.red,    icon: '✗' },
  };

  // Default (no need-by date provided) — neutral/accent
  const config = summary.promiseStatus
    ? statusConfig[summary.promiseStatus]
    : { bg: C.accentGlow, border: C.accent, color: C.accent, icon: '📅' };

  const statusLabel = summary.promiseStatus === 'on-time' ? 'Can deliver'
    : summary.promiseStatus === 'tight' ? 'Tight — minimal buffer'
    : summary.promiseStatus === 'cannot-meet' ? 'Cannot meet need-by date'
    : 'Earliest delivery';

  return (
    <div style={{
      padding: '14px 18px', borderRadius: 10, marginBottom: 16,
      background: config.bg, border: `1px solid ${config.border}`,
    }}>
      {/* Primary: the answer */}
      <div style={{ fontWeight: 700, fontSize: 15, color: config.color }}>
        {config.icon} {statusLabel}: {fmtDate(summary.earliestCompletionDate)}
      </div>

      {/* Resource routing */}
      {summary.earliestCompletionResources && (
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
          via {summary.earliestCompletionResources}
        </div>
      )}

      {/* Slack relative to need-by */}
      {summary.needByDate && summary.promiseSlackDays != null && (
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
          {summary.promiseSlackDays >= 0
            ? `${summary.promiseSlackDays} day${Math.abs(summary.promiseSlackDays) !== 1 ? 's' : ''} before need-by date (${fmtDateShort(summary.needByDate)})`
            : `${Math.abs(summary.promiseSlackDays)} day${Math.abs(summary.promiseSlackDays) !== 1 ? 's' : ''} after need-by date (${fmtDateShort(summary.needByDate)})`
          }
        </div>
      )}

      {/* Option count and range */}
      <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
        {summary.feasibleOptions} option{summary.feasibleOptions !== 1 ? 's' : ''} found
        {summary.latestCompletionDate && summary.earliestCompletionDate !== summary.latestCompletionDate
          ? ` · ${fmtDateShort(summary.earliestCompletionDate)} – ${fmtDateShort(summary.latestCompletionDate)} range`
          : ''
        }
      </div>
    </div>
  );
}
```

### 2b. Collapsible option cards

Each option shows a compact summary row by default. Click to expand and see per-task detail.

```typescript
function CTPOptionCard({ option, isEarliest, isActive, onSelect, onBook }: {
  option: CTPQueryOption;
  isEarliest: boolean;
  isActive: boolean;        // this option's ghost bars are showing on the Gantt
  onSelect: () => void;     // click to show ghost bars for this option
  onBook: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastTask = option.tasks[option.tasks.length - 1];
  const completionDate = lastTask?.end;

  // Build resource chain summary (PROCESS tasks only, skip SETUP/TEARDOWN)
  const resourceChain = option.tasks
    .filter(t => t.taskType === 'PROCESS' || !t.taskType)
    .map(t => t.resources.map(r => r.resourceName || r.resourceKey).join(', '))
    .join(' → ');

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 16px', borderRadius: 8, marginBottom: 8, cursor: 'pointer',
        background: C.bg,
        border: isActive
          ? `2px solid ${C.accent}`
          : `1px solid ${C.border}`,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Compact summary — always visible */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: C.textDim, fontWeight: 600 }}>
              Option {option.rank}
            </span>
            {isEarliest && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8,
                background: C.greenDim, color: C.green, fontWeight: 600,
              }}>
                earliest
              </span>
            )}
            {isActive && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8,
                background: C.accentGlow, color: C.accent, fontWeight: 600,
              }}>
                viewing on Gantt
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginTop: 2 }}>
            Completes: {fmtDate(completionDate)}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            {resourceChain}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Score — secondary */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: C.textDim }}>Score</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted }}>
              {option.chainScore?.toFixed(2) ?? '—'}
            </div>
          </div>

          {/* Expand toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: C.textDim, fontSize: 14, padding: '4px',
            }}
            title={expanded ? 'Collapse detail' : 'Show task detail'}
          >
            {expanded ? '▾' : '▸'}
          </button>

          {/* Book button */}
          <button
            onClick={(e) => { e.stopPropagation(); onBook(); }}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: C.accent, color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Book
          </button>
        </div>
      </div>

      {/* Expanded task detail */}
      {expanded && (
        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: `1px solid ${C.border}`,
        }}>
          {option.tasks.map((task, i) => (
            <div key={task.taskKey} style={{
              display: 'flex', gap: 12, padding: '4px 0',
              fontSize: 12, alignItems: 'baseline',
            }}>
              {/* Task type badge */}
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                width: 60, textAlign: 'center',
                background: task.taskType === 'SETUP' || task.taskType === 'SET_UP'
                  ? C.yellowDim : task.taskType === 'TEAR_DOWN'
                  ? C.yellowDim : C.accentGlow,
                color: task.taskType === 'SETUP' || task.taskType === 'SET_UP'
                  ? C.yellow : task.taskType === 'TEAR_DOWN'
                  ? C.yellow : C.accent,
              }}>
                {task.taskType === 'SETUP' || task.taskType === 'SET_UP' ? 'Setup'
                  : task.taskType === 'TEAR_DOWN' ? 'Teardown'
                  : 'Process'}
              </span>

              {/* Task name */}
              <span style={{ color: C.text, flex: 1 }}>{task.taskName}</span>

              {/* Time */}
              <span style={{ color: C.textMuted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {fmtDate(task.start)} – {fmtDate(task.end)}
              </span>

              {/* Resources */}
              <span style={{ color: C.textDim, fontSize: 11 }}>
                {task.resources.map(r => r.resourceName || r.resourceKey).join(', ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 2c. Active option highlighting + ghost bar link

When the planner clicks an option card, it becomes the "active" option:
- The card gets an accent border (2px solid accent vs 1px solid border)
- A "viewing on Gantt" badge appears on the card
- Ghost bars on the Gantt switch to this option's placements

State:

```typescript
const [activeOptionIndex, setActiveOptionIndex] = useState(0);  // default to first (earliest)
```

On first load of results, auto-select option 0 (earliest) as active and show its ghost bars.

### 2d. Infeasible state with bottleneck one-liner

When `summary.feasibleOptions === 0`, show the banner (Part 2a handles this), then below it show the bottleneck summary and suggestions:

```typescript
{!result.feasible && result.infeasibilityReport && (
  <div style={{ fontSize: 12, color: C.textMuted }}>
    {/* Bottleneck one-liner */}
    {result.infeasibilityReport.shortSummary && (
      <div style={{
        padding: '10px 14px', borderRadius: 8, marginBottom: 12,
        background: C.bg, border: `1px solid ${C.border}`,
        fontWeight: 500, color: C.text,
      }}>
        {result.infeasibilityReport.shortSummary}
      </div>
    )}

    {/* Suggestions */}
    <div style={{ fontWeight: 600, marginBottom: 6, color: C.text }}>Suggestions</div>
    <div style={{ lineHeight: 1.8 }}>
      <div>• Try a later need-by date to widen the search window</div>
      <div>• Check the bottleneck resource's agenda for work that could be deferred</div>
      <div>• Free up capacity by excluding lower-priority orders</div>
    </div>

    {/* Link to bottleneck resource agenda */}
    {result.infeasibilityReport.bottleneckSlot && (
      <button
        onClick={() => {
          // Navigate to resource agenda for the bottleneck
          const bottleneckResource = result.infeasibilityReport.slots
            ?.find(s => s.isBottleneck)?.resources?.[0];
          if (bottleneckResource) {
            onViewResource(bottleneckResource.resourceKey);
          }
        }}
        style={{
          marginTop: 10, padding: '6px 14px', borderRadius: 6,
          border: `1px solid ${C.border}`, background: 'transparent',
          color: C.accent, fontSize: 12, cursor: 'pointer',
        }}
      >
        View bottleneck resource agenda →
      </button>
    )}
  </div>
)}
```

---

## Part 3: AI Tool Update

Update the `evaluate_new_order` tool response handler to use the summary:

```typescript
// In the AI tool response formatting:
if (response.summary) {
  const s = response.summary;
  let result = '';

  if (s.feasibleOptions === 0) {
    result = `Cannot schedule "${response.orderName}" — no feasible options found.\n`;
    if (response.infeasibilityReport?.shortSummary) {
      result += `${response.infeasibilityReport.shortSummary}\n`;
    }
  } else {
    // Lead with the answer
    result = `Earliest delivery for "${response.orderName}": ${s.earliestCompletionDate}\n`;
    result += `via ${s.earliestCompletionResources}\n`;

    if (s.promiseStatus === 'on-time') {
      result += `✓ ${s.promiseSlackDays} days before need-by date (${s.needByDate})\n`;
    } else if (s.promiseStatus === 'tight') {
      result += `⚠ Tight — only ${s.promiseSlackDays} days before need-by date\n`;
    } else if (s.promiseStatus === 'cannot-meet') {
      result += `✗ Cannot meet need-by date — ${Math.abs(s.promiseSlackDays!)} days late\n`;
    }

    result += `\n${s.feasibleOptions} options found`;
    if (s.latestCompletionDate !== s.earliestCompletionDate) {
      result += ` (${s.earliestCompletionDate} – ${s.latestCompletionDate})`;
    }
    result += `\n\n`;

    // Then list options briefly
    for (const option of response.options) {
      const lastTask = option.tasks[option.tasks.length - 1];
      const resources = option.tasks
        .filter(t => t.taskType === 'PROCESS' || !t.taskType)
        .map(t => t.resources.map(r => r.resourceName).join(', '))
        .join(' → ');
      result += `Option ${option.rank}: Completes ${lastTask.end} — ${resources}\n`;
    }
  }

  return result;
}
```

The AI leads with "Earliest delivery: March 22, 3 days before your need-by date" — then lists options briefly. It doesn't dump all task details unless the planner asks.

---

## Part 4: Updated Dialog Layout

Complete dialog flow after enhancement:

```
┌──────────────────────────────────────────────────────────┐
│  CTP Query — When Can I Schedule This?                    │
│                                                           │
│  Based on:  [PV-001 - Pressure Vessel ▾]                 │
│  Name:      [Fonterra Pump Repair               ]        │
│  Need by:   [Mar 25, 2026 📅]   Priority: [HIGH ▾]      │
│                                                           │
│             [Cancel]  [Evaluate]                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─ ✓ Can deliver: Mar 22, 2026 ───────────────────────┐ │
│  │   via CNC-02 → Weld Bay 1 → Assembly Bay 2          │ │
│  │   3 days before need-by date (Mar 25)                │ │
│  │   5 options · Mar 22 – Mar 28 range                  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌ Option 1  earliest  viewing on Gantt ─── Score 1.23 ┐ │
│  │ Completes: Mar 22, 2026                      [▸][Book]│ │
│  │ CNC-02 → Weld Bay 1 → Assembly Bay 2                 │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌ Option 2 ─────────────────────────── Score 1.45 ─────┐ │
│  │ Completes: Mar 23, 2026                      [▸][Book]│ │
│  │ CNC-01 → Weld Bay 2 → Assembly Bay 1                 │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌ Option 3 ─────────────────────────── Score 1.89 ─────┐ │
│  │ Completes: Mar 26, 2026                      [▾][Book]│ │
│  │ CNC-03 → Weld Bay 1 → Assembly Bay 2                 │ │
│  │ ┌──────────────────────────────────────────────────┐  │ │
│  │ │ Setup   Strip & Clean  Mar 24 08:00–10:00       │  │ │
│  │ │         CNC-03                                   │  │ │
│  │ │ Process Machine        Mar 24 10:30–14:30       │  │ │
│  │ │         CNC-03                                   │  │ │
│  │ │ Process Weld           Mar 25 08:00–12:00       │  │ │
│  │ │         Weld Bay 1, Jack P.                      │  │ │
│  │ │ Process Assembly       Mar 26 08:00–12:00       │  │ │
│  │ │         Assembly Bay 2, Hayden S.                │  │ │
│  │ └──────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                           │
│  Schedule is unchanged. Click "Book" to add to schedule.  │
└──────────────────────────────────────────────────────────┘
```

---

## Part 5: Testing Checklist

### Backend
1. **Options sorted by end date** — First option has the earliest chain completion, not best score
2. **Rank reflects sort** — Option 1 = earliest, Option 2 = second earliest
3. **Summary present** — Response includes `summary` with all fields populated
4. **Promise on-time** — Need-by Mar 25, earliest Mar 22 → `promiseStatus: 'on-time'`, `promiseSlackDays: 3`
5. **Promise tight** — Need-by Mar 23, earliest Mar 22 → `promiseStatus: 'tight'`, `promiseSlackDays: 1`
6. **Promise cannot-meet** — Need-by Mar 20, earliest Mar 22 → `promiseStatus: 'cannot-meet'`, `promiseSlackDays: -2`
7. **No need-by** — Query without dueDate → `promiseStatus: null`, summary still has `earliestCompletionDate`
8. **Zero options** — `summary.feasibleOptions: 0`, `earliestCompletionDate: null`
9. **Bottleneck one-liner** — `infeasibilityReport.shortSummary` populated when zero options
10. **Resource chain** — `earliestCompletionResources` shows "CNC-02 → Weld Bay 1 → Assembly Bay 2" (PROCESS tasks only, skip SETUP/TEARDOWN)

### Frontend
11. **Banner renders with correct color** — Green for on-time, yellow for tight, red for cannot-meet, accent for no need-by
12. **Banner shows date prominently** — "✓ Can deliver: Mar 22, 2026" as the headline
13. **Options collapsed by default** — Only summary row visible, click ▸ to expand task detail
14. **Active option highlighted** — 2px accent border + "viewing on Gantt" badge
15. **Ghost bars switch** — Clicking a different option card switches ghost bars on the Gantt
16. **First option auto-selected** — On results load, option 1 (earliest) is active with ghost bars showing
17. **Expanded detail shows all tasks** — Type badge, name, time range, resources per task
18. **Infeasible state** — Red banner + bottleneck one-liner + suggestions + "View resource agenda" link
19. **Book still works** — Book button on each option opens confirmation dialog as before

### AI
20. **AI leads with summary** — "Earliest delivery: Mar 22, 3 days before need-by" not a list of options
21. **AI handles infeasible** — Reports bottleneck one-liner, suggests alternatives
22. **No regression** — Existing CTP query flow (form → evaluate → results → book) works as before
