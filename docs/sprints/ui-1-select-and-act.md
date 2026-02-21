# Prompt: Planner Workspace — Select, Queue, Solve

## Overview

The planner needs a workspace where they can:
1. See everything — scheduled AND unscheduled tasks
2. Select tasks (one, some, or all) from a filtered view
3. Queue actions — schedule, unschedule, pin, exclude
4. See visual feedback on what's queued
5. Review and commit with one Solve

Today the app has the pieces (task table with filters, Gantt, solve preview) but they're disconnected. This prompt connects them into a coherent workflow.

## Three Changes

### A. Task Selection (checkboxes in the task table)
### B. Unscheduled Tasks Panel (beside/below Gantt)
### C. Visual Feedback + Batch Solve (queued actions shown, committed together)

---

## A. Task Selection

### Selection State

Add to the main App component:

```tsx
const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
```

Pass down to TaskTable (and anywhere else that needs it).

### Checkbox Column

Add as the **first column** in the task table.

**Header — select all visible:**
```tsx
<th style={{ padding: '10px 8px', width: 36, textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
  <input type="checkbox"
    checked={rows.length > 0 && rows.every((r: any) => selectedTasks.has(r.key))}
    ref={el => {
      if (el) el.indeterminate = rows.some((r: any) => selectedTasks.has(r.key))
        && !rows.every((r: any) => selectedTasks.has(r.key));
    }}
    onChange={(e) => {
      if (e.target.checked) {
        setSelectedTasks(prev => {
          const next = new Set(prev);
          rows.forEach((r: any) => next.add(r.key));
          return next;
        });
      } else {
        setSelectedTasks(prev => {
          const next = new Set(prev);
          rows.forEach((r: any) => next.delete(r.key));
          return next;
        });
      }
    }}
    style={{ cursor: 'pointer', accentColor: C.accent }}
  />
</th>
```

The `indeterminate` state is important — if some rows are selected but not all, the header checkbox shows a dash instead of a check.

**Row — toggle individual:**
```tsx
<td style={{ padding: '4px 8px', textAlign: 'center' }}
  onClick={(e) => e.stopPropagation()}>
  <input type="checkbox"
    checked={selectedTasks.has(tk.key)}
    onChange={() => {
      setSelectedTasks(prev => {
        const next = new Set(prev);
        if (next.has(tk.key)) next.delete(tk.key);
        else next.add(tk.key);
        return next;
      });
    }}
    style={{ cursor: 'pointer', accentColor: C.accent }}
  />
</td>
```

**Selected row highlight:**
```tsx
<tr style={{
  ...existingRowStyle,
  ...(selectedTasks.has(tk.key) && { background: `${C.accent}0a` }),
}}>
```

`e.stopPropagation()` on the checkbox cell prevents the row click (which opens detail panel) from firing when clicking the checkbox.

### Selection Toolbar

Show when `selectedTasks.size > 0`. This **replaces** the existing `TaskBulkActions` bar that acts on all filtered tasks. Instead, actions target the explicit selection.

```tsx
{selectedTasks.size > 0 && (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    background: `${C.accent}0a`, borderRadius: 8, marginBottom: 8,
    border: `1px solid ${C.accent}33`, fontFamily: FONT,
  }}>
    <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>
      {selectedTasks.size} selected
    </span>
    <div style={{ width: 1, height: 16, background: C.border }} />
    
    {/* Contextual buttons based on what's selected */}
    {/* Details below in "Selection Toolbar Logic" */}
    
    <div style={{ flex: 1 }} />
    <button onClick={() => setSelectedTasks(new Set())}
      style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}>
      Clear
    </button>
  </div>
)}
```

### Selection Toolbar Logic

Analyze the selected tasks and show relevant actions:

```tsx
// Derive from selection
const selectedArray = Array.from(selectedTasks);
const selectedObjs = selectedArray.map(k => tasks.find((t: any) => t.key === k)).filter(Boolean);

const scheduledSel = selectedObjs.filter((t: any) => t.feasible && t.scheduledStart);
const unscheduledSel = selectedObjs.filter((t: any) => !t.feasible || !t.scheduledStart);
const pinnedSel = selectedObjs.filter((t: any) => taskPins?.[t.key]);
const excludedSel = selectedObjs.filter((t: any) => taskExcludes?.[t.key]);
const pendingUnsched = selectedArray.filter(k => taskUnschedules?.has(k));
```

**Buttons shown:**

| Selected contains | Button | Action |
|---|---|---|
| Unscheduled or excluded tasks | ▶ Schedule N | Remove from excludes + unschedules set → included in next solve |
| Scheduled tasks (not pending unsched) | ✕ Unschedule N | Add to `taskUnschedules` |
| Tasks pending unschedule | ↩ Cancel Unschedule N | Remove from `taskUnschedules` |
| Scheduled unpinned tasks | 📌 Pin N | Set `taskPins[key] = true` |
| Pinned tasks | 📌 Unpin N | Set `taskPins[key] = false` |
| Non-excluded tasks | ⏸ Exclude N | Set `taskExcludes[key] = true` |
| Excluded tasks | ▶ Include N | Set `taskExcludes[key] = false` |
| Exactly 1 task | 🗺 Where To | Open WhereTo for that task |

Multiple buttons can show at once when selection is mixed (some scheduled, some not).

**Action callbacks (passed from App):**

```tsx
onScheduleSelected={(keys) => {
  // Remove from excludes and unschedules — "put back in play"
  setTaskExcludes(prev => {
    const next = { ...prev };
    keys.forEach(k => { next[k] = false; });
    return next;
  });
  setTaskUnschedules(prev => {
    const next = new Set(prev);
    keys.forEach(k => next.delete(k));
    return next;
  });
  setSelectedTasks(new Set()); // Clear selection after action
  setSolveStale(true);
}}

onUnscheduleSelected={(keys) => {
  setTaskUnschedules(prev => {
    const next = new Set(prev);
    keys.forEach(k => next.add(k));
    return next;
  });
  setSelectedTasks(new Set());
  setSolveStale(true);
}}

onPinSelected={(keys) => {
  setTaskPins(prev => {
    const next = { ...prev };
    keys.forEach(k => { next[k] = true; });
    return next;
  });
  setSelectedTasks(new Set());
  setSolveStale(true);
}}

onExcludeSelected={(keys) => {
  setTaskExcludes(prev => {
    const next = { ...prev };
    keys.forEach(k => { next[k] = true; });
    return next;
  });
  setSelectedTasks(new Set());
  setSolveStale(true);
}}
```

Each action clears the selection after applying — the visual indicators now show what's queued, and the selection is free for the next operation.

### Existing TaskBulkActions

The existing `TaskBulkActions` component (Pin All, Exclude All, Unschedule All on filtered set) can stay but should be secondary — shown only when nothing is selected. When tasks ARE selected, the selection toolbar takes over:

```tsx
{selectedTasks.size > 0 ? (
  <SelectionToolbar ... />
) : hasActions && (
  <TaskBulkActions ... />  // existing component, unchanged
)}
```

---

## B. Unscheduled Tasks Panel

### Purpose

The Gantt only shows scheduled tasks (they have time bars). Unscheduled tasks are invisible there. The planner needs to see what's NOT on the board — what failed, what was excluded, what's waiting.

### Location

Below the Gantt chart, inside the same Schedule tab. Collapsible.

### Component

```tsx
function UnscheduledPanel({ tasks, products, colors, taskExcludes, taskUnschedules, orderModes,
  onTaskClick, onWhereTo, selectedTasks, onToggleSelect }: {
  tasks: any[]; products: any[]; colors: any;
  taskExcludes?: Record<string, boolean>;
  taskUnschedules?: Set<string>;
  orderModes?: Record<string, string>;
  onTaskClick?: (t: any) => void;
  onWhereTo?: (key: string) => void;
  selectedTasks?: Set<string>;
  onToggleSelect?: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  
  const unscheduled = useMemo(() => {
    return tasks.filter((t: any) => {
      // Show tasks that are: not scheduled, OR pending unschedule, OR excluded
      const isUnscheduled = !t.feasible || !t.scheduledStart;
      const isPendingUnsched = taskUnschedules?.has(t.key);
      const isExcluded = taskExcludes?.[t.key];
      // Only show PROCESS tasks (not setup/teardown)
      if (t.type && t.type !== 'PROCESS') return false;
      return isUnscheduled || isPendingUnsched || isExcluded;
    });
  }, [tasks, taskUnschedules, taskExcludes]);

  if (unscheduled.length === 0) return null;

  // Group by reason
  const pendingUnsched = unscheduled.filter(t => taskUnschedules?.has(t.key));
  const excluded = unscheduled.filter(t => taskExcludes?.[t.key] && !taskUnschedules?.has(t.key));
  const infeasible = unscheduled.filter(t =>
    !t.feasible && !taskUnschedules?.has(t.key) && !taskExcludes?.[t.key]);

  return (
    <div style={{
      marginTop: 12, borderRadius: 8,
      border: `1px solid ${C.border}`, background: C.surface,
    }}>
      {/* Header — click to collapse */}
      <div onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>
            {expanded ? '▾' : '▸'}
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

      {/* Task chips */}
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

                {/* Checkbox */}
                {onToggleSelect && (
                  <input type="checkbox"
                    checked={isSelected || false}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(task.key)}
                    style={{ cursor: 'pointer', accentColor: C.accent, margin: 0 }}
                  />
                )}

                {/* Color dot */}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', background: prodColor, flexShrink: 0,
                }} />

                {/* Task info */}
                <div>
                  <span style={{ fontWeight: 600, color: C.text }}>{task.name}</span>
                  {task.orderRef && (
                    <span style={{ color: C.textDim, marginLeft: 6 }}>{task.orderRef}</span>
                  )}
                </div>

                {/* Status indicator */}
                {isPendingUnsched && (
                  <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>→ UNSCHED</span>
                )}
                {isExcluded && !isPendingUnsched && (
                  <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>EXCLUDED</span>
                )}
                {!isPendingUnsched && !isExcluded && task.errors?.length > 0 && (
                  <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>INFEASIBLE</span>
                )}

                {/* Quick WhereTo */}
                {onWhereTo && !isExcluded && (
                  <button onClick={(e) => { e.stopPropagation(); onWhereTo(task.key); }}
                    title="Find available positions"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 12, padding: '0 2px', color: C.accent, opacity: 0.7,
                    }}>
                    🗺️
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
```

### Placement in ScheduleTab

Add below the GanttChart in the Gantt view:

```tsx
{effectiveIdx === 0 ? (
  <Card>
    <GanttChart ... />
    <UnscheduledPanel
      tasks={tasks} products={products} colors={colors}
      taskExcludes={taskExcludes} taskUnschedules={taskUnschedules}
      orderModes={orderModes}
      onTaskClick={onTaskClick} onWhereTo={onWhereTo}
      selectedTasks={selectedTasks}
      onToggleSelect={(key) => {
        setSelectedTasks(prev => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      }}
    />
  </Card>
) : ...
```

Also add it below the Order Gantt (effectiveIdx === 1) — same component, same data.

### Selection Flows From Panel

Tasks selected via checkboxes in the UnscheduledPanel use the SAME `selectedTasks` set as the task table. If the user selects 3 tasks in the unscheduled panel, then switches to the Task List tab, those 3 are still selected. The selection toolbar shows and they can click "Schedule 3" to include them in the next solve.

---

## C. Visual Feedback + Batch Solve

### Gantt Bar Indicators

On existing Gantt bars, show queued action state:

**Pending unschedule:**
```tsx
const isPendingUnsched = taskUnschedules?.has(task.key);

// Overlay on the bar
{isPendingUnsched && (
  <div style={{
    position: 'absolute', inset: 0, borderRadius: 'inherit',
    background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${C.red}22 4px, ${C.red}22 8px)`,
    border: `1px dashed ${C.red}`,
  }} />
)}
```

**Pending pin:**
```tsx
const isPendingPin = taskPins?.[task.key];

style={{
  ...(isPendingPin && { boxShadow: `0 0 0 2px ${C.accent}` }),
}}
// Pin badge
{isPendingPin && (
  <span style={{ position: 'absolute', top: -6, right: -4, fontSize: 9 }}>📌</span>
)}
```

**Pending exclude:**
```tsx
const isPendingExclude = taskExcludes?.[task.key];

style={{
  ...(isPendingExclude && { opacity: 0.2, filter: 'grayscale(1)' }),
}}
```

### Task Table Row Indicators

```tsx
// Pending action badges in the Status column, next to existing status badge
{taskUnschedules?.has(tk.key) && (
  <span style={{ fontSize: 10, color: C.red, fontWeight: 600, marginLeft: 4 }}>→ UNSCHED</span>
)}
{taskPins?.[tk.key] && (
  <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginLeft: 4 }}>→ PIN</span>
)}
{taskExcludes?.[tk.key] && (
  <span style={{ fontSize: 10, color: C.textDim, fontWeight: 600, marginLeft: 4 }}>→ EXCLUDE</span>
)}
```

Row border to indicate pending state:
```tsx
<tr style={{
  ...existingRowStyle,
  borderLeft: taskUnschedules?.has(tk.key) ? `3px solid ${C.red}` :
              taskPins?.[tk.key] ? `3px solid ${C.accent}` :
              /* keep existing pin/lock logic */ ...,
}}>
```

### Unschedule Toggle

Change the existing unschedule callback from add-only to toggle:

```tsx
onUnscheduleTask={(key) => {
  setTaskUnschedules(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  setSolveStale(true);
}}
```

Update button icons to reflect toggle state:
```tsx
// In TaskRowActions:
<IconBtn
  icon={taskUnschedules?.has(task.key) ? '↩' : '✕'}
  title={taskUnschedules?.has(task.key) ? 'Cancel unschedule' : 'Unschedule'}
  active={taskUnschedules?.has(task.key)}
  activeColor={C.red}
  onClick={() => onUnschedule(task.key)}
/>

// In Gantt context menu:
<button onClick={() => { onUnscheduleTask(task.key); setContextMenu(null); }}>
  {taskUnschedules?.has(task.key) ? '↩ Cancel Unschedule' : '✕ Unschedule'}
</button>
```

### Solve Preview — Queued Actions

Add a "Queued Actions" section at the top of the SolvePreview dialog, showing task names:

```tsx
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
        ✕ Unschedule: {taskSummary.unschedule.map(k =>
          tasks.find((t: any) => t.key === k)?.name || k
        ).join(', ')}
      </div>
    )}
    {taskSummary.pinned.length > 0 && (
      <div style={{ fontSize: 13, color: C.accent, marginBottom: 4 }}>
        📌 Pin: {taskSummary.pinned.map(k =>
          tasks.find((t: any) => t.key === k)?.name || k
        ).join(', ')}
      </div>
    )}
    {taskSummary.excluded.length > 0 && (
      <div style={{ fontSize: 13, color: C.textDim }}>
        ⏸ Exclude: {taskSummary.excluded.map(k =>
          tasks.find((t: any) => t.key === k)?.name || k
        ).join(', ')}
      </div>
    )}
    <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, fontStyle: 'italic' }}>
      Solve will: {[
        taskSummary.unschedule.length > 0 && `unschedule ${taskSummary.unschedule.length}`,
        taskSummary.excluded.length > 0 && `exclude ${taskSummary.excluded.length}`,
        taskSummary.pinned.length > 0 && `pin ${taskSummary.pinned.length}`,
        `schedule ${taskSummary.toSolve} remaining`,
      ].filter(Boolean).join(' → ')}
    </div>
  </div>
)}
```

### Clear After Solve

After successful solve in `handleSolveConfirm`:

```tsx
// After successful solve — server state is now truth
setTaskUnschedules(new Set());
setTaskPins({});
setTaskExcludes({});
setOrderModes({});
setMaterialModeOverrides({});
setResourceModeOverrides({});
setSelectedTasks(new Set());  // Clear selection
setSolveStale(false);
```

### Remove Unused Direct API Handlers

```tsx
// DELETE these lines entirely:
const handleApiUnschedule = useCallback(async (taskKey: string) => { ... }, []);
const handleApiPin = useCallback(async (taskKey: string, pinned: boolean) => { ... }, []);
void handleApiUnschedule;
void handleApiPin;
```

---

## What NOT to Change

- `loadData()` — initial solve-and-sync stays the same
- `handleSolveConfirm()` — request body construction already sends all overrides correctly
- WhereTo/MoveTo — remain immediate API calls (different interaction pattern)
- SolveResultsDialog — unchanged
- Component hierarchy — keep single-file architecture
- No new API endpoints
- Stale banner — keep existing, it already works with the override state

## Complete User Flow

```
1. App loads → solve-and-sync → Gantt shows scheduled tasks
   Below Gantt: "Not Scheduled (4)" panel shows tasks that failed or weren't included

2. Planner reviews Gantt, sees Task X is in a bad spot
   → Right-clicks Task X → "Unschedule"
   → Task X bar gets strikethrough overlay on Gantt
   → Task X appears in "Not Scheduled" panel with "→ UNSCHED" badge
   → Stale banner: "⚠ Changes pending · 1 unschedule"

3. Planner clicks Task List tab to see all tasks
   → Sees Task X row with red border and "→ UNSCHED" badge
   → Filters table to "Unscheduled" status
   → Sees Task C and Task D that were infeasible in original solve

4. Planner checks the checkbox on Task C and Task D
   → Selection toolbar: "2 selected · ▶ Schedule 2"
   → Clicks "Schedule 2" → both removed from excludes
   → Selection clears, stale banner updates

5. Planner filters to Order-007, selects all 3 tasks
   → Clicks "📌 Pin 3" → all get pin badges
   → Stale banner: "⚠ Changes pending · 1 unschedule · 3 pinned"

6. Planner clicks "Review & Solve"
   → Solve Preview: "QUEUED ACTIONS: ✕ Unschedule: Task X · 📌 Pin: Task A, B, C"
   → "Solve will: unschedule 1 → pin 3 → schedule 16 remaining"

7. Planner clicks Solve
   → API call with all overrides → results refresh
   → Task X truly unscheduled, 3 tasks pinned, solver reschedules rest
   → All overrides clear, selection empty, no stale banner
   → "Not Scheduled" panel updates with new reality
```

## Test Plan

1. **Checkbox select** — click checkbox on row → highlighted, count in toolbar
2. **Select all** — header checkbox selects all visible filtered rows
3. **Indeterminate** — some rows selected → header shows dash
4. **Selection toolbar actions** — Schedule, Unschedule, Pin, Exclude show based on selection content
5. **Action clears selection** — clicking any toolbar action clears checkboxes
6. **Unscheduled panel appears** — below Gantt, shows count, lists unscheduled tasks as chips
7. **Panel collapse** — click header to toggle
8. **Panel selection** — checkbox on chip → same `selectedTasks` set as table
9. **Panel hidden when empty** — if everything is scheduled, panel doesn't render
10. **Gantt strikethrough** — pending unschedule shows diagonal lines on bar
11. **Gantt pin badge** — pending pin shows blue glow + 📌
12. **Gantt dim** — pending exclude dims and grays bar
13. **Table row indicators** — red border for unsched, blue for pin, dim for exclude
14. **Status badges** — "→ UNSCHED", "→ PIN", "→ EXCLUDE" in status column
15. **Unschedule toggle** — click unschedule → queued; click again → cancelled
16. **Context menu toggle** — Gantt right-click shows "Cancel Unschedule" if already queued
17. **Solve preview** — shows QUEUED ACTIONS with task names
18. **Solve executes** — all queued actions applied, solver runs on remainder
19. **Clear after solve** — selection empty, overrides empty, stale banner gone
20. **WhereTo from panel** — 🗺️ button on unscheduled chip opens WhereTo
21. **WhereTo from selection** — select 1 task → toolbar shows Where To
22. **Shared selection** — select in panel → switch to Task List → same tasks selected
