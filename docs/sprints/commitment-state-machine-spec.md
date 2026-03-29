# Spec: Commitment State Machine — Merged Status Column + Contextual Toolbar

**What you're building:** Replace the separate Status and Commitment columns with a single Status column showing commitment level. Enforce the state machine transitions so only valid actions appear in the toolbar. Guard against invalid transitions (e.g., can't unschedule a dispatched task without reverting first).

**Size:** ~1.5 hours
**Depends on:** Commitment stack (done), progression buttons (done)

---

## Part 1: Merge Into Existing Status Badge — Remove Commit Column

Don't add a new column. Update the existing `taskStatusBadge()` function to show commitment level instead of the old status labels. Remove the separate Commit column entirely.

### Update `taskStatusBadge()`

The existing function returns badges like "Scheduled", "Infeasible", "Pinned", "Excluded". Replace those with commitment-level icons and labels. The pending action tags (→ UNSCHED, → PIN, → EXCLUDE, REDIRECT, RUSH) stay exactly as they are.

```typescript
function taskStatusBadge(task: any): { icon: string; label: string; color: string } {
  // Commitment-level display replaces the old status labels
  const level = task.commitmentLevel || deriveDisplayLevel(task);

  switch (level) {
    case 'completed':    return { icon: '✔', label: 'Done', color: '#06b6d4' };
    case 'running':      return { icon: '●', label: 'Running', color: '#ef4444' };
    case 'on_hold':      return { icon: '⚠', label: 'On Hold', color: '#f59e0b' };
    case 'dispatched':   return { icon: '◆', label: 'Dispatched', color: '#f97316' };
    case 'pinned':       return { icon: '📌', label: 'Pinned', color: '#3b82f6' };
    case 'planned':      return { icon: '✓', label: 'Planned', color: '#22c55e' };
    case 'infeasible':   return { icon: '✕', label: 'Infeasible', color: '#ef4444' };
    case 'excluded':     return { icon: '—', label: 'Excluded', color: '#475569' };
    case 'unscheduled':
    default:             return { icon: '○', label: 'Unsched', color: '#9ca3af' };
  }
}

function deriveDisplayLevel(task: any): string {
  if (task.commitmentLevel) return task.commitmentLevel;
  if (!task.included) return 'excluded';
  if (task.included && !task.feasible) return 'infeasible';
  if (task.feasible && task.dispatched) return 'dispatched';
  if (task.feasible && task.pinned) return 'pinned';
  if (task.feasible) return 'planned';
  return 'unscheduled';
}
```

### Remove the Commit column

Find the Commit column definition (gated behind intermediate experience level) and remove it:
- Remove the column header for "Commit"
- Remove the column cell rendering for commitment level
- The Status column now carries this information at all experience levels

### What stays unchanged

- The Status column header and position — same as today
- Pending action indicators (→ UNSCHED, → PIN, → EXCLUDE, REDIRECT, RUSH) — untouched
- The column width may need a small bump to fit "Dispatched" label (~110px should be enough)

---

## Part 2: State Machine — Valid Transitions

Define the allowed transitions from each commitment level:

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  unscheduled:  ['planned'],           // via solve
  planned:      ['pinned', 'unscheduled'],  // pin or unschedule
  pinned:       ['dispatched', 'planned'],  // dispatch or unpin (→ planned)
  dispatched:   ['running', 'on_hold', 'pinned'],  // start, hold, or revert
  running:      ['on_hold', 'completed'],   // hold or complete (nothing else)
  on_hold:      ['running'],               // resume only
  completed:    [],                         // terminal state — no transitions
};
```

### Toolbar actions mapped to transitions

| Toolbar Action | Transition | Valid from |
|---|---|---|
| Solve | unscheduled → planned | unscheduled |
| Pin | planned → pinned | planned |
| Unpin | pinned → planned | pinned |
| Unschedule | planned → unscheduled | planned only (not pinned, not dispatched) |
| Dispatch | pinned → dispatched | pinned |
| Revert | dispatched → pinned | dispatched |
| Start | dispatched → running | dispatched |
| Hold | running → on_hold, dispatched → on_hold | running, dispatched |
| Resume | on_hold → running | on_hold |
| Complete | running → completed | running |

### Guard function

```typescript
function canTransition(task: any, action: string): { allowed: boolean; reason?: string } {
  const level = task.commitmentLevel || deriveDisplayLevel(task);

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
```

---

## Part 3: Contextual Toolbar

The toolbar shows only valid actions for the selected task(s). No more showing buttons that don't apply.

### Determine visible buttons

```typescript
function getToolbarActions(selectedTasks: any[]): ToolbarAction[] {
  if (selectedTasks.length === 0) return [];

  // Get the commitment levels of all selected tasks
  const levels = selectedTasks.map(t => t.commitmentLevel || deriveDisplayLevel(t));
  const uniqueLevels = [...new Set(levels)];

  const actions: ToolbarAction[] = [];

  // ─── Universal actions (always available if any tasks selected) ───
  // WhereTo — available for planned and unscheduled
  if (levels.some(l => l === 'planned' || l === 'unscheduled')) {
    actions.push({ key: 'whereto', label: 'WhereTo', icon: '🔍' });
  }

  // ─── Single-level actions (all selected tasks at same level) ───
  if (uniqueLevels.length === 1) {
    const level = uniqueLevels[0];

    switch (level) {
      case 'unscheduled':
        actions.push({ key: 'schedule', label: 'Schedule', icon: '▶' });
        break;

      case 'planned':
        actions.push({ key: 'pin', label: 'Pin', icon: '📌' });
        actions.push({ key: 'unschedule', label: 'Unschedule', icon: '↩' });
        actions.push({ key: 'exclude', label: 'Exclude', icon: '✕' });
        break;

      case 'pinned':
        actions.push({ key: 'unpin', label: 'Unpin', icon: '📌' });  // same icon, toggles
        actions.push({ key: 'dispatch', label: 'Dispatch', icon: '🚀' });
        break;

      case 'dispatched':
        actions.push({ key: 'start', label: 'Start', icon: '▶' });
        actions.push({ key: 'hold', label: 'Hold', icon: '⏸' });
        actions.push({ key: 'revert', label: 'Revert to Pinned', icon: '↩' });
        break;

      case 'running':
        actions.push({ key: 'hold', label: 'Hold', icon: '⏸' });
        actions.push({ key: 'complete', label: 'Complete', icon: '✓' });
        break;

      case 'on_hold':
        actions.push({ key: 'resume', label: 'Resume', icon: '▶' });
        break;

      case 'completed':
        // No actions — terminal state
        break;

      case 'excluded':
        actions.push({ key: 'include', label: 'Include', icon: '✓' });
        break;
    }
  }

  // ─── Mixed selection: show only actions valid for ALL selected tasks ───
  if (uniqueLevels.length > 1) {
    // Only show actions where every selected task passes the guard
    const candidateActions = ['unschedule', 'pin', 'unpin', 'dispatch', 'hold'];
    for (const action of candidateActions) {
      if (selectedTasks.every(t => canTransition(t, action).allowed)) {
        const config = ACTION_CONFIG[action];
        if (config) actions.push(config);
      }
    }
  }

  return actions;
}

interface ToolbarAction {
  key: string;
  label: string;
  icon: string;
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
};
```

### Render toolbar

```typescript
{/* Selection toolbar — replaces current static button list */}
{selectedTasks.length > 0 && (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
    background: C.surface2, borderRadius: 8, border: `1px solid ${C.border}`,
  }}>
    <span style={{ fontSize: 11, color: C.textDim, marginRight: 4 }}>
      {selectedTasks.length} selected
    </span>

    {getToolbarActions(selectedTasks).map(action => (
      <button
        key={action.key}
        onClick={(e) => handleToolbarAction(action.key, e)}
        style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 6,
          background: 'transparent', border: `1px solid ${C.border}`,
          color: C.text, cursor: 'pointer',
          outline: isQueuing ? `2px dashed ${C.accent}` : 'none',
        }}
        title={action.label}
      >
        {action.icon} {action.label}
        {isQueuing && <span style={{ fontSize: 9, marginLeft: 3, color: C.accent }}>+Q</span>}
      </button>
    ))}

    {/* Queue mode toggle */}
    <button
      onClick={() => setQueueMode(m => !m)}
      style={{
        fontSize: 11, padding: '3px 10px', borderRadius: 6, marginLeft: 'auto',
        background: queueMode ? C.accent + '20' : 'transparent',
        border: `1px solid ${queueMode ? C.accent : C.border}`,
        color: queueMode ? C.accent : C.textMuted,
        cursor: 'pointer',
      }}
    >
      {queueMode ? '📋 Queuing' : '📋'}
    </button>
  </div>
)}
```

### Action handler router

```typescript
function handleToolbarAction(action: string, event: React.MouseEvent) {
  const taskKeys = Array.from(selectedTasks);
  const tasks = taskKeys.map(k => solveResult.tasks.find(t => t.key === k)).filter(Boolean);

  // Guard check
  for (const task of tasks) {
    const check = canTransition(task, action);
    if (!check.allowed) {
      showToast(check.reason!, 'warning');
      return;
    }
  }

  // Check queue mode
  const shouldQueue = queueMode || event.shiftKey;

  switch (action) {
    case 'schedule':
      handleSolveSelected(taskKeys, event);
      break;
    case 'unschedule':
      handleApiUnschedule(taskKeys, event);
      break;
    case 'pin':
      handleApiPin(taskKeys, true, event);
      break;
    case 'unpin':
      handleApiPin(taskKeys, false, event);
      break;
    case 'dispatch':
      handleDispatch(taskKeys, event);
      break;
    case 'revert':
      handleRevertDispatch(taskKeys, event);
      break;
    case 'start':
      handleStart(taskKeys[0], event);
      break;
    case 'hold':
      handleHold(taskKeys[0], event);
      break;
    case 'resume':
      handleResume(taskKeys[0], event);
      break;
    case 'complete':
      handleComplete(taskKeys[0], event);
      break;
    case 'exclude':
      handleExclude(taskKeys, event);
      break;
    case 'include':
      handleInclude(taskKeys, event);
      break;
    case 'whereto':
      handleWhereTo(taskKeys[0]);
      break;
  }
}
```

---

## Part 4: Revert Dispatch Endpoint

The state machine requires a "revert" action: dispatched → pinned. This undoes the dispatch (clears materialsPulled, dispatchedAt) but keeps the task pinned at its scheduled position.

### Controller

```typescript
@Post('tasks/revert-dispatch')
@ApiOperation({ summary: 'Revert dispatched task(s) back to pinned state' })
revertDispatch(@Body() body: { taskKeys: string[] }) {
  return this.ctpService.revertDispatch(body.taskKeys);
}
```

### Service

```typescript
revertDispatch(taskKeys: string[]): any {
  const landscape = this.ensureLandscape();
  const results: any[] = [];

  for (const key of taskKeys) {
    const task = landscape.tasks.getEntity(key);
    if (!task) { results.push({ taskKey: key, result: 'not_found' }); continue; }
    if (!task.dispatched) {
      results.push({ taskKey: key, result: 'skipped', detail: 'Task is not dispatched' });
      continue;
    }

    task.dispatched = false;
    task.dispatchedAt = null;
    task.materialsPulled = false;
    // Keep pinned = true — reverts to pinned, not planned
    task.commitmentLevel = 'pinned';
    results.push({ taskKey: key, result: 'ok' });
  }

  return { status: 'ok', results };
}
```

### Warning on revert

When the planner clicks Revert, warn if materials were pulled:

```typescript
async function handleRevertDispatch(taskKeys: string[], event: React.MouseEvent) {
  const shouldQueue = queueMode || event.shiftKey;

  // Check if any tasks had materials pulled
  const dispatchedTasks = taskKeys
    .map(k => solveResult.tasks.find(t => t.key === k))
    .filter(t => t?.dispatched && t?.materialsPulled);

  if (dispatchedTasks.length > 0 && !shouldQueue) {
    const confirmed = confirm(
      `${dispatchedTasks.length} task(s) have materials pulled. ` +
      `Reverting will mark materials as wasted. Continue?`
    );
    if (!confirmed) return;
  }

  if (shouldQueue) {
    for (const key of taskKeys) {
      addToQueue(`Revert dispatch: ${key}`, {
        type: 'revert_dispatch' as any,
        taskKey: key,
      });
    }
    return;
  }

  await api('/ctp/tasks/revert-dispatch', {
    method: 'POST',
    body: JSON.stringify({ taskKeys }),
  });
  refreshState();
}
```

---

## Part 5: Gantt Context Menu — Commitment Actions

The right-click context menu on Gantt bars should also show contextual commitment actions:

```typescript
function getGanttContextActions(task: any): ContextMenuItem[] {
  const level = task.commitmentLevel || deriveDisplayLevel(task);
  const items: ContextMenuItem[] = [];

  // WhereTo always available for planned/unscheduled
  if (level === 'planned' || level === 'unscheduled') {
    items.push({ label: 'Where can this go?', action: 'whereto' });
    items.push({ separator: true });
  }

  // Commitment actions based on level
  switch (level) {
    case 'planned':
      items.push({ label: '📌 Pin', action: 'pin' });
      items.push({ label: '↩ Unschedule', action: 'unschedule' });
      break;
    case 'pinned':
      items.push({ label: '📌 Unpin', action: 'unpin' });
      items.push({ label: '🚀 Dispatch', action: 'dispatch' });
      break;
    case 'dispatched':
      items.push({ label: '▶ Start', action: 'start' });
      items.push({ label: '⏸ Hold', action: 'hold' });
      items.push({ label: '↩ Revert to pinned', action: 'revert' });
      break;
    case 'running':
      items.push({ label: '⏸ Hold', action: 'hold' });
      items.push({ label: '✓ Complete', action: 'complete' });
      break;
    case 'on_hold':
      items.push({ label: '▶ Resume', action: 'resume' });
      break;
  }

  // Always show Ask AI
  items.push({ separator: true });
  items.push({ label: 'Ask AI about this task', action: 'askAi' });

  return items;
}
```

---

## Part 6: Bulk Action Counts — Filter by Valid Transitions

The bulk action buttons currently count ALL selected tasks. They should only count tasks where `canTransition()` returns true for that action. Completed, running, and dispatched tasks are silently excluded from the count. If the valid count is 0, the button doesn't show.

### Button label shows valid count

```typescript
// For each bulk action button, compute the valid count:
const validForAction = (action: string) =>
  selectedTasks.filter(t => canTransition(t, action).allowed);

// Button only shows if count > 0, label shows valid count:
const unscheduleTargets = validForAction('unschedule');
{unscheduleTargets.length > 0 && (
  <button onClick={(e) => handleApiUnschedule(unscheduleTargets.map(t => t.key), e)}>
    ↩ Unschedule {unscheduleTargets.length}
  </button>
)}

const pinTargets = validForAction('pin');
{pinTargets.length > 0 && (
  <button onClick={(e) => handleApiPin(pinTargets.map(t => t.key), true, e)}>
    📌 Pin {pinTargets.length}
  </button>
)}

const unpinTargets = validForAction('unpin');
{unpinTargets.length > 0 && (
  <button onClick={(e) => handleApiPin(unpinTargets.map(t => t.key), false, e)}>
    📌 Unpin {unpinTargets.length}
  </button>
)}

const dispatchTargets = validForAction('dispatch');
{dispatchTargets.length > 0 && (
  <button onClick={(e) => handleDispatch(dispatchTargets.map(t => t.key), e)}>
    🚀 Dispatch {dispatchTargets.length}
  </button>
)}
```

### Handler filters to valid tasks only

Each action handler should also filter before executing, as a safety net:

```typescript
const handleApiUnschedule = useCallback(async (taskKeys: string[], event?: React.MouseEvent) => {
  // Filter to only valid tasks
  const validKeys = taskKeys.filter(k => {
    const task = solveResult.tasks.find(t => t.key === k);
    return task && canTransition(task, 'unschedule').allowed;
  });
  if (validKeys.length === 0) return;

  // ... rest of handler (queue or execute)
}, [/* deps */]);
```

---

## Part 7: Bulk Extend Window

A bulk action to extend the window end on multiple selected tasks. Common scenario: "all 5 tasks for this order are tight, give them another day."

### Toolbar button

Shows for planned and unscheduled tasks:

```typescript
// In getToolbarActions, add for planned and unscheduled levels:
case 'planned':
  actions.push({ key: 'pin', label: 'Pin', icon: '📌' });
  actions.push({ key: 'unschedule', label: 'Unschedule', icon: '↩' });
  actions.push({ key: 'extend_window', label: 'Extend Window', icon: '⟫' });
  actions.push({ key: 'exclude', label: 'Exclude', icon: '✕' });
  actions.push({ key: 'rush', label: 'Rush', icon: '🔥' });
  actions.push({ key: 'resource_pref', label: 'Set Pref', icon: '⇄' });
  break;

case 'unscheduled':
  actions.push({ key: 'schedule', label: 'Schedule', icon: '▶' });
  actions.push({ key: 'extend_window', label: 'Extend Window', icon: '⟫' });
  actions.push({ key: 'rush', label: 'Rush', icon: '🔥' });
  break;

// Also for infeasible (window extension is a common fix for infeasible tasks):
case 'infeasible':
  actions.push({ key: 'extend_window', label: 'Extend Window', icon: '⟫' });
  actions.push({ key: 'exclude', label: 'Exclude', icon: '✕' });
  break;
```

### Extend Window Dialog

```typescript
function ExtendWindowDialog({
  taskCount,
  onApply,
  onCancel,
}: {
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
            <button
              key={p.label}
              onClick={() => onApply(p.seconds)}
              style={{
                fontSize: 12, padding: '6px 14px', borderRadius: 8,
                background: C.surface2, border: `1px solid ${C.border}`,
                color: C.text, cursor: 'pointer',
              }}
            >
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
```

### Handler

```typescript
async function handleExtendWindow(taskKeys: string[], extensionSeconds: number, event?: React.MouseEvent) {
  const shouldQueue = queueMode || event?.shiftKey;

  if (shouldQueue) {
    for (const key of taskKeys) {
      const task = solveResult.tasks.find(t => t.key === key);
      if (!task) continue;
      const currentEnd = task.windowEnd || task.scheduledEnd;
      if (!currentEnd) continue;
      const newEnd = new Date(new Date(currentEnd).getTime() + extensionSeconds * 1000).toISOString();
      addToQueue(
        `Extend window +${extensionSeconds >= 86400 ? Math.round(extensionSeconds / 86400) + 'd' : Math.round(extensionSeconds / 3600) + 'h'}: ${task.name || key}`,
        { type: 'set_window', taskKey: key, windowEnd: newEnd },
      );
    }
    return;
  }

  // Direct execution: call PATCH for each task
  for (const key of taskKeys) {
    const task = solveResult.tasks.find(t => t.key === key);
    if (!task) continue;
    const currentEnd = task.windowEnd || task.scheduledEnd;
    if (!currentEnd) continue;
    const newEnd = new Date(new Date(currentEnd).getTime() + extensionSeconds * 1000).toISOString();
    await api(`/ctp/tasks/${key}/window`, {
      method: 'PATCH',
      body: JSON.stringify({ windowEnd: newEnd }),
    });
  }
  refreshState();
}
```

---

## Verification

### Merged status badge
- [ ] `taskStatusBadge()` takes `task` object (not `_status` string) — all call sites updated
- [ ] Old status labels ("Scheduled", "Infeasible") replaced with commitment labels
- [ ] Commit column removed from task table
- [ ] Commitment info visible at all experience levels (not gated behind intermediate)
- [ ] Pending action tags (→ UNSCHED, → PIN, → EXCLUDE, REDIRECT, RUSH) still work
- [ ] Colors match: running=red, on_hold=amber, dispatched=orange, pinned=blue, planned=green, unscheduled=gray
- [ ] Infeasible tasks show ✕ in red
- [ ] Excluded tasks show — in dim gray
- [ ] Completed tasks show ✔ Done in teal

### State machine enforcement
- [ ] Planned → can pin, unschedule, exclude, extend window, rush, set pref, WhereTo
- [ ] Pinned → can unpin, dispatch (not unschedule directly)
- [ ] Dispatched → can start, hold, revert (not unschedule directly)
- [ ] Running → can hold, complete (nothing else)
- [ ] On Hold → can resume (nothing else)
- [ ] Completed → no actions available
- [ ] Infeasible → can extend window, exclude

### Toolbar is contextual
- [ ] Select a planned task → see Pin, Unschedule, Extend Window, Exclude, Rush, Set Pref, WhereTo
- [ ] Select a pinned task → see Unpin, Dispatch
- [ ] Select a dispatched task → see Start, Hold, Revert
- [ ] Select a running task → see Hold, Complete
- [ ] Select an on_hold task → see Resume
- [ ] Select a completed task → no action buttons
- [ ] Select mixed levels → only actions valid for ALL selected tasks appear

### Bulk action counts
- [ ] Selecting WO-1005 (2 completed + 1 running + 2 planned) → Unschedule shows "2" not "5"
- [ ] Pin count only includes planned tasks
- [ ] Dispatch count only includes pinned tasks
- [ ] Zero-count buttons are hidden (not shown disabled)

### Extend window
- [ ] Dialog shows preset buttons (+1h, +4h, +1d, +2d, +1w)
- [ ] Applies to all selected tasks that have windows
- [ ] Tasks without windows are skipped
- [ ] Works through queue (Shift+click queues set_window commands)
- [ ] Available for planned, unscheduled, and infeasible tasks

### Transition guards
- [ ] Trying to unschedule a dispatched task → toast: "Revert to pinned first"
- [ ] Trying to unschedule a pinned task → toast: "Unpin first, then unschedule"
- [ ] Trying to unschedule a running task → toast: "Cannot unschedule a running task"
- [ ] Trying to dispatch a planned task → toast: "Pin the task first"
- [ ] Trying to start a pinned task → toast: "Dispatch the task first"

### Revert dispatch
- [ ] `POST /ctp/tasks/revert-dispatch` clears dispatched, materialsPulled, dispatchedAt
- [ ] Task stays pinned after revert (not planned)
- [ ] Warning shown when materials were pulled
- [ ] Works through queue (Shift+click)

### Gantt context menu
- [ ] Right-click planned task → shows Pin, Unschedule, WhereTo
- [ ] Right-click dispatched task → shows Start, Hold, Revert
- [ ] Right-click running task → shows Hold, Complete
- [ ] Right-click on_hold task → shows Resume
- [ ] Right-click completed task → shows Ask AI only

### Filter chips
- [ ] Status filter row includes commitment-level chips
- [ ] Clicking "Dispatched" shows only dispatched tasks
- [ ] Clicking "Running" shows only running tasks
- [ ] Clicking "On Hold" shows only on-hold tasks
- [ ] Counts on each chip are accurate

---

## Part 8: Hold Dialog

When an operator puts a task on hold they need to capture why and when they expect to resume. The Hold button (toolbar or Gantt context menu) opens a small dialog instead of immediately executing.

### Dialog layout

```
┌───────────────────────────────────────────┐
│  Put task on hold                         │
│                                           │
│  Reason (optional):                       │
│  [Machine breakdown            ]          │
│                                           │
│  Held since:                              │
│  [2026-02-11 10:30    ] or [Now]         │
│                                           │
│  Estimated resume (optional):             │
│  [2026-02-11 14:00    ] or [+2h] [+4h]  │
│                                           │
│              [Cancel]  [⏸ Hold]           │
└───────────────────────────────────────────┘
```

- **Reason** — free text, optional. Maps to `holdReason` in the API body.
- **Held since** — datetime of when the hold started. Defaults to now. "Now" button resets to current time. Maps to a new `holdStart` field (for display/audit — the engine ignores it). Backend stores it on the task; no engine impact.
- **Estimated resume** — optional datetime. Preset buttons (+2h, +4h) set relative to held-since time. Maps to `estimatedResumeTime` in the API body.
- **Hold button** — disabled until held-since is set (it defaults to now so it's always enabled in practice).

### Component

```typescript
function HoldDialog({
  taskName,
  onApply,
  onCancel,
}: {
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 20, maxWidth: 340, width: '90%', fontFamily: FONT }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Put task on hold</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>{taskName}</div>

        {/* Reason */}
        <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>Reason (optional)</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Machine breakdown"
          style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6,
            background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
            boxSizing: 'border-box', marginBottom: 12 }} />

        {/* Held since */}
        <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>Held since</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <input type="datetime-local" value={heldSince} onChange={e => setHeldSince(e.target.value)}
            style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6,
              background: C.surface2, border: `1px solid ${C.border}`, color: C.text }} />
          <button onClick={() => setHeldSince(toLocalDatetimeInput(new Date().toISOString()))}
            style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6,
              background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer' }}>
            Now
          </button>
        </div>

        {/* Estimated resume */}
        <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>Estimated resume (optional)</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <input type="datetime-local" value={estimatedResume} onChange={e => setEstimatedResume(e.target.value)}
            style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6,
              background: C.surface2, border: `1px solid ${C.border}`, color: C.text }} />
          <button onClick={() => applyPreset(7200)}
            style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6,
              background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer' }}>
            +2h
          </button>
          <button onClick={() => applyPreset(14400)}
            style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6,
              background: C.surface2, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer' }}>
            +4h
          </button>
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
```

### Helper

```typescript
// Format ISO datetime to value for <input type="datetime-local">
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

### State in App

```typescript
const [holdDialogTask, setHoldDialogTask] = useState<{ key: string; name: string } | null>(null);
```

### Handler

The `hold` action (toolbar or Gantt context menu) sets `holdDialogTask` instead of immediately calling the API. The dialog's `onApply` calls:

```typescript
async function handleHold(taskKey: string, args: { holdReason: string; holdStart: string; estimatedResumeTime?: string }, event?: React.MouseEvent) {
  const shouldQueue = queueMode || event?.shiftKey;
  setHoldDialogTask(null);

  if (shouldQueue) {
    const task = solveResult?.tasks?.find((t: any) => t.key === taskKey);
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
}
```

Note: The existing `executeCommands` path for `hold` calls `holdTask(taskKey, 'Queued hold', undefined)` — it works for queued actions but doesn't capture reason/time. The direct path uses `POST /ctp/tasks/hold` to pass those fields.

### Wiring

In `handleToolbarAction`, intercept `hold` to show the dialog (same pattern as `extend_window`):
```typescript
if (action === 'hold') {
  const task = tasks_.find((t: any) => t.key === taskKeys[0]);
  setHoldDialogTask({ key: taskKeys[0], name: task?.name || taskKeys[0] });
  return;
}
```

In the Gantt context menu, the `hold` button already calls `onToolbarAction('hold', [task.key])` — no change needed there.

Render in App JSX:
```typescript
{holdDialogTask && (
  <HoldDialog
    taskName={holdDialogTask.name}
    onApply={(args) => handleHold(holdDialogTask.key, args)}
    onCancel={() => setHoldDialogTask(null)}
  />
)}
```

### Backend — `holdStart` field

The backend already accepts `holdReason` and `estimatedResumeTime`. Add `holdStart` storage to `holdTask()`:

```typescript
holdTask(taskKey: string, holdReason: string, estimatedResumeTime?: string, holdStart?: string): any {
  ...
  task.holdStart = holdStart || new Date().toISOString();  // audit field, no engine impact
  ...
}
```

Update the `POST /ctp/tasks/hold` body type to include `holdStart?: string` and pass it through.

### Verification

- [ ] Hold button (toolbar or Gantt menu) opens dialog instead of immediately executing
- [ ] Held since defaults to current time
- [ ] "Now" button resets held since to current time
- [ ] +2h / +4h preset buttons set estimated resume relative to held-since
- [ ] Reason and estimated resume are optional — Hold button always enabled
- [ ] Direct execution calls `POST /ctp/tasks/hold` with reason + estimatedResumeTime
- [ ] Queued execution adds a `hold` command (reason/time captured in command payload)
- [ ] Task shows `on_hold` badge after hold applied
- [ ] `holdReason` appears in task detail / Gantt tooltip

---

*Build order: Part 1 merged badge (~20 min), Part 2 state machine + guards (~20 min), Part 3 contextual toolbar (~30 min), Part 4 revert endpoint (~15 min), Part 5 Gantt context menu (~15 min), Part 6 bulk count fix (~15 min), Part 7 extend window (~20 min), Part 8 hold dialog (~25 min). Total: ~2.75 hours.*

---

## Review Issues (from CC review)

1. **`taskStatusBadge()` signature change** — Current function takes `_status: string`, new one takes `task: any`. All call sites need updating from `taskStatusBadge(tk._status)` to `taskStatusBadge(tk)`. CC should grep for all call sites.

2. **`deriveDisplayLevel` fallback** — Use `task.commitmentLevel` from the API response as the primary source. The fallback should check `task.excluded` or `!task.feasible`, matching the actual solve response fields. **Not** `task.included` (that field doesn't exist on the solve response).

3. **Missing command types** — Commitment transitions (`start`, `hold`, `resume`, `complete`, `revert_dispatch`) aren't in `RecommendationCommand.type`. **Resolution:** Add them to the union type and the command sequencer. A machine breakdown macro might need "hold task + redirect + solve" as one atomic batch — commitment transitions must work through the queue.

4. **Bulk actions** — `start`/`hold`/`resume`/`complete` are inherently single-task (you start one task at a time on the floor). Keep them single. `dispatch` is the only commitment action that makes sense in bulk (dispatch the next 5 tasks for the shift).

5. **Duplicate queue toggle** — Remove the queue toggle from Part 3's toolbar spec. Reference the existing toggle from the Action Queue sprint (already next to the Solve button).

6. **Missing toolbar buttons** — `Resource Pref` and `Rush` added to `getToolbarActions` for `planned` level. `Rush` also for `unscheduled`. `Extend Window` added for `planned`, `unscheduled`, and `infeasible`.
