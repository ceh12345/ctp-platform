# Disjunctive Graph — Session 3: Gantt Highlighting + WhereTo Enhancement

**What it does:** (1) Visual critical path highlighting on the Gantt — toggle to show which tasks drive the makespan. (2) WhereTo options annotated with critical path impact — options that shorten the critical path are visually boosted.

**Size:** ~2 hours CC work
**Depends on:** Session 1 complete (per-task `isOnCriticalPath` and `slack` in solve response)

---

## Part 1: Gantt — Critical Path Toggle

### 1a. Toggle control

Add a "Critical Path" toggle button to the Gantt toolbar, next to the existing zoom and view controls:

```typescript
// In the Gantt toolbar area:
<button
  onClick={() => setShowCriticalPath(prev => !prev)}
  style={{
    padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: FONT,
    background: showCriticalPath ? C.orange + '22' : 'transparent',
    color: showCriticalPath ? C.orange : C.textMuted,
    border: showCriticalPath ? `1px solid ${C.orange}44` : `1px solid transparent`,
    display: 'flex', alignItems: 'center', gap: 4,
  }}
>
  🔗 Critical Path
</button>
```

State:
```typescript
const [showCriticalPath, setShowCriticalPath] = useState(false);
```

Pass `showCriticalPath` down to the GanttChart component.

### 1b. Visual treatment on Gantt bars

When `showCriticalPath` is true, modify the rendering of each task bar:

**Critical-path tasks** get:
- A bright orange/amber top border (2px solid, `C.orange`)
- Full opacity
- A subtle glow: `boxShadow: '0 0 6px rgba(249, 115, 22, 0.3)'`

**Non-critical tasks** get:
- Reduced opacity (`opacity: 0.4`)
- No border change

**When `showCriticalPath` is false**, all tasks render normally (no opacity change, no border).

```typescript
// In the task bar rendering:
const isCritical = showCriticalPath && task.isOnCriticalPath;
const isDimmed = showCriticalPath && !task.isOnCriticalPath;

const barStyle = {
  // ... existing bar styles ...
  opacity: isDimmed ? 0.35 : 1,
  borderTop: isCritical ? `2px solid ${C.orange}` : undefined,
  boxShadow: isCritical ? `0 0 6px ${C.orange}40` : undefined,
  transition: 'opacity 0.2s, border-top 0.2s, box-shadow 0.2s',
};
```

### 1c. Critical path segment connectors

When `showCriticalPath` is true, draw thin connecting lines between consecutive critical-path tasks to show the flow. These are SVG lines (or absolutely positioned divs) connecting the end of one critical-path bar to the start of the next.

Two cases:
- **Same resource row**: horizontal arrow from end of bar A to start of bar B (disjunctive arc — resource sequencing)
- **Different resource row**: diagonal line from end of bar A on row X to start of bar B on row Y (conjunctive arc — chain precedence)

```typescript
// After rendering all task bars, if showCriticalPath:
{showCriticalPath && criticalPathConnectors.map((conn, i) => (
  <svg key={`cp-conn-${i}`} style={{
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    pointerEvents: 'none', overflow: 'visible',
  }}>
    <line
      x1={conn.fromX} y1={conn.fromY}
      x2={conn.toX} y2={conn.toY}
      stroke={C.orange}
      strokeWidth={1.5}
      strokeDasharray={conn.type === 'conjunctive' ? '4 3' : undefined}
      opacity={0.6}
      markerEnd="url(#cp-arrow)"
    />
  </svg>
))}
```

Build the connectors from the solve response's `criticalPath.taskKeys` array — each consecutive pair is a connection. Determine whether it's same-resource (disjunctive, solid line) or cross-resource (conjunctive, dashed line) by comparing the task's assigned resource.

**SVG arrow marker** (add to the Gantt's SVG defs):
```html
<defs>
  <marker id="cp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M2 2L8 5L2 8" fill="none" stroke="#f97316" strokeWidth="1.5" />
  </marker>
</defs>
```

**Computing connector coordinates**: For each pair of consecutive critical-path task keys, look up the bar positions from the Gantt layout (you'll need the bar's pixel x, y, width, height — which the Gantt already computes for rendering). The connector goes from `(bar1.x + bar1.width, bar1.y + bar1.height/2)` to `(bar2.x, bar2.y + bar2.height/2)`.

**Simplification**: If computing pixel positions is complex given the current Gantt rendering approach, skip the connectors for now and just use the opacity + border treatment. The connectors are polish — the dimming + highlighting already communicates "these are the important tasks." Add connectors as a fast follow if time permits.

### 1d. Critical path badge in task tooltip

When hovering over a task bar (if the Gantt has tooltips), add:

```typescript
// In tooltip content:
{task.isOnCriticalPath && (
  <div style={{ fontSize: 10, color: C.orange, fontWeight: 600 }}>
    ⚡ Critical path — zero slack
  </div>
)}
{!task.isOnCriticalPath && task.slack !== undefined && (
  <div style={{ fontSize: 10, color: C.textDim }}>
    Slack: {formatDuration(task.slack)}
  </div>
)}
```

---

## Part 2: Task Detail Panel — Slack Display

When a task is selected and the detail panel opens, show the slack information:

```typescript
// In TaskDetailPanel, after the status/schedule section:

{task.feasible && task.slack !== undefined && (
  <div style={{ marginTop: 8 }}>
    <SectionLabel label="Schedule flexibility" />
    <DetailRow label="Slack" value={formatDuration(task.slack)}
      color={task.isOnCriticalPath ? C.orange : task.slack < 1800 ? C.yellow : C.green} />
    {task.isOnCriticalPath && (
      <div style={{
        padding: '6px 10px', borderRadius: 6, marginTop: 4,
        background: C.orange + '15', border: `1px solid ${C.orange}30`,
        fontSize: 11, color: C.orange,
      }}>
        ⚡ On critical path — any delay extends the makespan
      </div>
    )}
    {!task.isOnCriticalPath && task.slack < 1800 && (
      <div style={{
        padding: '6px 10px', borderRadius: 6, marginTop: 4,
        background: C.yellow + '15', border: `1px solid ${C.yellow}30`,
        fontSize: 11, color: C.yellow,
      }}>
        ⚠ Near-critical — less than 30 minutes of slack
      </div>
    )}
  </div>
)}
```

---

## Part 3: WhereTo — Critical Path Impact Annotation

### 3a. Backend: Add slack/critical path info to WhereTo response

In `ctp_service.ts`, in the `whereTo` method (or `formatWhereToResponse`), annotate the response with the target task's critical path status:

```typescript
// In formatWhereToResponse, add to the response:
if (task.isOnCriticalPath !== undefined) {
  (response as any).taskIsOnCriticalPath = task.isOnCriticalPath;
  (response as any).taskSlack = task.slack ?? null;
}
```

### 3b. Backend: Estimate critical path impact per option

For each WhereTo option, estimate whether it would improve, worsen, or not affect the critical path. This is a heuristic — we don't rebuild the full graph per option (that's Phase B). Instead:

- If the task is on the critical path AND the option moves it to a different resource → the critical path likely changes
- If the option's start time is earlier than the current position → the task finishes earlier → critical path may shorten
- If the option is on the current bottleneck resource → no critical path improvement
- If the option is on a non-bottleneck resource → critical path likely shortens

Add to the WhereTo option formatting:

```typescript
// In the WhereTo option mapping:
// Get critical path data from the landscape (compute or cache from last solve)
const graph = DisjunctiveGraph.buildFromLandscape(landscape);
const taskNode = graph.nodes.find(n => n.key === taskKey);
const isOnCriticalPath = taskNode?.isOnCriticalPath ?? false;

// For each option:
for (const option of result.options) {
  let criticalPathImpact: 'shortens' | 'neutral' | 'may_lengthen' | null = null;

  if (isOnCriticalPath && graph.criticalPath) {
    const currentResource = taskNode!.resourceKey;
    const optionResource = option.resources[0]?.resourceKey;
    const bottleneckResource = graph.criticalPath.bottleneckResource.resourceKey;

    if (optionResource === currentResource) {
      // Same resource — check if start time is earlier
      const currentStart = taskNode!.startW;
      const optionStart = CTPDateTime.fromDateTime(option.start);
      criticalPathImpact = optionStart < currentStart ? 'shortens' : 'neutral';
    } else if (optionResource === bottleneckResource) {
      // Moving TO the bottleneck — may worsen
      criticalPathImpact = 'may_lengthen';
    } else {
      // Moving OFF the bottleneck (or off the critical path) — likely shortens
      criticalPathImpact = currentResource === bottleneckResource ? 'shortens' : 'neutral';
    }
  }

  option.criticalPathImpact = criticalPathImpact;
}
```

**Important performance note**: Building the full disjunctive graph for every WhereTo call could be slow if WhereTo is called frequently. Options:
1. **Cache the graph** — store on the landscape or in a service-level cache after each solve. Invalidate on any mutation. This is the right approach.
2. **Lazy compute** — only build the graph when the task is on the critical path (skip for non-critical tasks).
3. **Skip for now** — just pass through the per-task `isOnCriticalPath` and `slack` without per-option impact estimation. The frontend can display "this task is on the critical path" without annotating each option.

**Recommendation**: Start with option 3 (pass through task status only). Add per-option impact when you cache the graph (natural enhancement with `preserveLandscape`).

### 3c. Frontend: WhereTo option display

In the WhereTo options panel (ghost bars or list), show the critical path context:

```typescript
// At the top of the WhereTo panel, if the task is on the critical path:
{whereToResponse.taskIsOnCriticalPath && (
  <div style={{
    padding: '6px 10px', borderRadius: 6, marginBottom: 8,
    background: C.orange + '15', border: `1px solid ${C.orange}30`,
    fontSize: 11, color: C.orange,
  }}>
    ⚡ This task is on the critical path — moving it may shorten the schedule
  </div>
)}

// Per-option annotation (if criticalPathImpact is available):
{option.criticalPathImpact === 'shortens' && (
  <span style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>↓ may shorten critical path</span>
)}
{option.criticalPathImpact === 'may_lengthen' && (
  <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>↑ moves to bottleneck</span>
)}
```

### 3d. WhereTo ghost bars on Gantt

When `showCriticalPath` is active and WhereTo ghost bars are shown, ghost bars that would move a task off the bottleneck resource should have a green tint (instead of the default ghost color) to visually signal "this is a good move for the critical path."

```typescript
// In ghost bar rendering:
const ghostColor = showCriticalPath && whereToResponse?.taskIsOnCriticalPath
  && option.resources[0]?.resourceKey !== criticalPath?.bottleneckResource?.resourceKey
    ? C.green + '30'    // green tint — moves off bottleneck
    : C.accent + '20';  // default ghost color
```

---

## Part 4: Task Table — Slack Column

Add an optional "Slack" column to the task table (visible at intermediate+ level):

```typescript
// Column definition:
{ key: 'slack', label: 'Slack', sortable: true, minLevel: 'intermediate',
  render: (task: any) => {
    if (!task.feasible || task.slack === undefined) return '—';
    if (task.isOnCriticalPath) {
      return <span style={{ color: C.orange, fontWeight: 600, fontSize: 11 }}>⚡ Critical</span>;
    }
    const formatted = formatDuration(task.slack);
    const color = task.slack < 1800 ? C.yellow : task.slack < 7200 ? C.textMuted : C.green;
    return <span style={{ color, fontSize: 11 }}>{formatted}</span>;
  },
  sortValue: (task: any) => task.isOnCriticalPath ? -1 : (task.slack ?? Infinity),
}
```

Sorting by slack puts critical-path tasks first, then near-critical, then high-slack.

---

## Verification

### Gantt
- [ ] "Critical Path" toggle button in Gantt toolbar
- [ ] Toggle ON: critical-path tasks get orange top border + full opacity
- [ ] Toggle ON: non-critical tasks dim to 35% opacity
- [ ] Toggle OFF: all tasks render normally
- [ ] Task tooltip shows slack value and "Critical path" badge
- [ ] Connectors (if implemented): solid lines within same resource, dashed across resources
- [ ] Toggle state persists across tab switches (but not page reload)

### Task Detail Panel
- [ ] Scheduled tasks show "Schedule flexibility" section with slack value
- [ ] Critical-path tasks show orange "On critical path" callout
- [ ] Near-critical tasks (<30min slack) show yellow warning
- [ ] Unscheduled tasks don't show slack section

### WhereTo
- [ ] WhereTo panel shows "This task is on the critical path" banner when applicable
- [ ] Per-option impact annotation (if implemented): shortens / neutral / may_lengthen
- [ ] Ghost bars on Gantt: green tint for options moving off bottleneck (when critical path toggle is active)

### Task Table
- [ ] Slack column visible at intermediate+ level
- [ ] "⚡ Critical" badge for critical-path tasks
- [ ] Color-coded slack values (yellow < 30min, green > 2h)
- [ ] Sortable — critical tasks sort to top

### Cross-tenant
- [ ] Manufacturing: critical path visible across machine resources
- [ ] Healthcare: critical path flows across OR → surgeon → recovery
- [ ] Sports: critical path across field → equipment chains
- [ ] Toggle doesn't break when no tasks are scheduled

---

*After this session: Gantt visually highlights the critical path, task detail shows slack, WhereTo indicates critical-path impact, task table has a sortable slack column. All three sessions complete — full Phase A delivered.*
