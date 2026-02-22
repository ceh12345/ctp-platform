# UI Sprint 1.1: Immediate Single-Task Actions (Add-On)

## Status: READY

## What Changed

After using Sprint 1, we learned that planners want real-time interaction — not everything queued for solve. Single-task actions from the Gantt context menu should hit the API immediately and refresh the Gantt. Bulk actions from the selection toolbar still queue for solve.

This is an add-on to Sprint 1, not a replacement. Everything from Sprint 1 stays: checkboxes, selection toolbar, unscheduled panel, visual indicators, batch-through-solve for bulk actions.

## The Split

### Immediate Actions — Single Task

From Gantt context menu, task detail panel, or unscheduled panel chip. One task at a time, each call hits the API and refreshes from `/ctp/state`:

| Action | API Call | Result |
|--------|----------|--------|
| Unschedule | `POST /ctp/tasks/:taskKey/unschedule` | Task removed from Gantt, appears in unscheduled panel |
| Pin | `PATCH /ctp/tasks/:taskKey/pin` with `{ pinned: true }` | Task gets lock icon, solver won't move it |
| Unpin | `PATCH /ctp/tasks/:taskKey/pin` with `{ pinned: false }` | Lock icon removed |
| Where To → Move To | `POST /ctp/tasks/:taskKey/move-to` | Task moves on Gantt (already works) |
| Schedule | `POST /ctp/tasks/:taskKey/schedule` | Task placed in best available slot |

### Immediate Actions — Bulk (Selection Toolbar)

From the selection toolbar when tasks are checked. Same API calls, executed in sequence for each selected task. UI refreshes once after all calls complete:

| Button | What it does | API |
|--------|-------------|-----|
| ✕ Unschedule N | Each task unscheduled via API | `POST /tasks/:key/unschedule` × N |
| 📌 Pin N | Each task pinned via API | `PATCH /tasks/:key/pin` × N |
| 📌 Unpin N | Each task unpinned via API | `PATCH /tasks/:key/pin` × N |
| ▶ Schedule N | Each task placed in best slot via API | `POST /tasks/:key/schedule` × N |

These are NOT queued for solve. They execute immediately. The planner sees the Gantt update after the batch completes.

### Solve — Separate Operation

Solve is the optimizer. It's a different action from the toolbar (not the selection toolbar). The planner uses it when they want the engine to holistically schedule or reschedule tasks considering trade-offs, scoring, and priorities.

Default solve behavior: schedule all unscheduled tasks that are not pinned and not excluded. Tasks that are already scheduled and not explicitly unscheduled stay where they are.

The planner's workflow:
1. Unschedule tasks (immediate, one by one or bulk)
2. Pin the tasks they don't want moved (immediate)
3. Optionally place some tasks manually via WhereTo/MoveTo (immediate)
4. Hit Solve for the rest → solver places remaining unscheduled tasks optimally

Solve still uses the existing flow: Solve Preview → confirm → `POST /ctp/solve`. But overrides like `taskExcludes` and `orderModes` still queue for solve since they're configuration, not direct actions.

## Implementation

### Unsuppress Existing Handlers

The codebase already has `handleApiUnschedule` and `handleApiPin` but they were suppressed with `void`. Unsuppress them:

```tsx
// DELETE these lines:
void handleApiUnschedule;
void handleApiPin;
```

### handleApiUnschedule

Should already exist. Verify it follows this pattern:

```tsx
const handleApiUnschedule = useCallback(async (taskKey: string) => {
  try {
    const res = await api(`/ctp/tasks/${taskKey}/unschedule`, {
      method: 'POST',
      body: JSON.stringify({ resetScore: true }),
    });
    if (!res.success) {
      showToast?.(`Cannot unschedule: ${res.message || 'Unknown error'}`);
    }
    return res.success;
  } catch (err) {
    console.error('Unschedule error:', err);
    return false;
  }
}, []);
```

### handleApiPin

Should already exist. Verify it follows this pattern:

```tsx
const handleApiPin = useCallback(async (taskKey: string, pinned: boolean) => {
  try {
    const res = await api(`/ctp/tasks/${taskKey}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    });
    if (!res.success && !res.taskKey) {
      showToast?.(`Cannot ${pinned ? 'pin' : 'unpin'}: ${res.message || 'Unknown error'}`);
    }
    return true;
  } catch (err) {
    console.error('Pin error:', err);
    return false;
  }
}, []);
```

### handleApiSchedule (NEW)

Schedule a single task by finding its best slot:

```tsx
const handleApiSchedule = useCallback(async (taskKey: string) => {
  try {
    const res = await api(`/ctp/tasks/${taskKey}/schedule`, {
      method: 'POST',
    });
    if (!res.success) {
      showToast?.(`Cannot schedule: ${res.errors?.[0]?.reason || 'No feasible slot found'}`);
    }
    return res.success;
  } catch (err) {
    console.error('Schedule error:', err);
    return false;
  }
}, []);
```

### Bulk Immediate Handlers (NEW)

These call the single-task API in sequence for each selected task, then refresh once:

```tsx
const handleBulkUnschedule = useCallback(async (keys: string[]) => {
  setActionLoading('bulk');
  let successCount = 0;
  for (const key of keys) {
    const ok = await handleApiUnschedule(key);
    if (ok) successCount++;
  }
  // Single refresh after all calls complete
  const updated = await api('/ctp/state');
  if (updated.tasks) setSolveResult(updated);
  setSelectedTasks(new Set());
  setActionLoading(null);
  if (successCount < keys.length) {
    showToast?.(`${successCount}/${keys.length} tasks unscheduled`);
  }
}, [handleApiUnschedule]);

const handleBulkPin = useCallback(async (keys: string[], pinned: boolean) => {
  setActionLoading('bulk');
  for (const key of keys) {
    await handleApiPin(key, pinned);
  }
  const updated = await api('/ctp/state');
  if (updated.tasks) setSolveResult(updated);
  setSelectedTasks(new Set());
  setActionLoading(null);
}, [handleApiPin]);

const handleBulkSchedule = useCallback(async (keys: string[]) => {
  setActionLoading('bulk');
  let successCount = 0;
  let errors: string[] = [];
  for (const key of keys) {
    const ok = await handleApiSchedule(key);
    if (ok) successCount++;
    else errors.push(key);
  }
  const updated = await api('/ctp/state');
  if (updated.tasks) setSolveResult(updated);
  setSelectedTasks(new Set());
  setActionLoading(null);
  if (errors.length > 0) {
    showToast?.(`${successCount}/${keys.length} scheduled. ${errors.length} could not be placed.`);
  }
}, [handleApiSchedule]);
```

### Wire Single-Task Actions to Gantt Context Menu

The Gantt right-click context menu calls immediate handlers then refreshes:

```tsx
// Unschedule — immediate API call
{onApiUnschedule && contextMenu.task.feasible && (
  <button onClick={async () => {
    setContextMenu(null);
    await onApiUnschedule(contextMenu.task.key);
    // Refresh from live state
    const updated = await api('/ctp/state');
    if (updated.tasks) setSolveResult(updated);
  }} style={menuBtnStyle}>
    ✕ Unschedule
  </button>
)}

// Pin/Unpin — immediate API call
{onApiPin && contextMenu.task.feasible && (
  <button onClick={async () => {
    setContextMenu(null);
    await onApiPin(contextMenu.task.key, !contextMenu.task.pinned);
    const updated = await api('/ctp/state');
    if (updated.tasks) setSolveResult(updated);
  }} style={menuBtnStyle}>
    📌 {contextMenu.task.pinned ? 'Unpin' : 'Pin'}
  </button>
)}

// Where To — already immediate
{onWhereTo && (
  <button onClick={() => {
    setContextMenu(null);
    onWhereTo(contextMenu.task.key, 'gantt');
  }} style={menuBtnStyle}>
    🗺 Where Can This Go?
  </button>
)}
```

### Wire Bulk Actions to Selection Toolbar

Replace the queue-based handlers with immediate bulk handlers:

```tsx
{/* Bulk Unschedule — immediate */}
{scheduledSel.length > 0 && (
  <button onClick={() => handleBulkUnschedule(scheduledSel.map(t => t.key))}
    disabled={actionLoading === 'bulk'}
    style={toolbarBtnStyle}>
    ✕ Unschedule {scheduledSel.length}
  </button>
)}

{/* Bulk Pin — immediate */}
{unpinnedScheduledSel.length > 0 && (
  <button onClick={() => handleBulkPin(unpinnedScheduledSel.map(t => t.key), true)}
    disabled={actionLoading === 'bulk'}
    style={toolbarBtnStyle}>
    📌 Pin {unpinnedScheduledSel.length}
  </button>
)}

{/* Bulk Unpin — immediate */}
{pinnedSel.length > 0 && (
  <button onClick={() => handleBulkPin(pinnedSel.map(t => t.key), false)}
    disabled={actionLoading === 'bulk'}
    style={toolbarBtnStyle}>
    📌 Unpin {pinnedSel.length}
  </button>
)}

{/* Bulk Schedule — immediate */}
{unscheduledSel.length > 0 && (
  <button onClick={() => handleBulkSchedule(unscheduledSel.map(t => t.key))}
    disabled={actionLoading === 'bulk'}
    style={toolbarBtnStyle}>
    ▶ Schedule {unscheduledSel.length}
  </button>
)}

{/* Exclude — still queues for solve (configuration, not direct action) */}
{selectedArray.length > 0 && (
  <button onClick={() => {
    setTaskExcludes(prev => {
      const next = { ...prev };
      selectedArray.forEach(k => { next[k] = true; });
      return next;
    });
    setSelectedTasks(new Set());
    setSolveStale(true);
  }} style={toolbarBtnStyle}>
    ⏸ Exclude {selectedArray.length}
  </button>
)}
```

### Wire to Unscheduled Panel

Each task chip in the unscheduled panel gets immediate Schedule and WhereTo buttons:

```tsx
{onApiSchedule && !isExcluded && (
  <button onClick={async (e) => {
    e.stopPropagation();
    await onApiSchedule(task.key);
    const updated = await api('/ctp/state');
    if (updated.tasks) setSolveResult(updated);
  }}
    title="Schedule this task now"
    style={{
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 12, padding: '0 2px', color: C.green, opacity: 0.7,
    }}>
    ▶
  </button>
)}

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
```

### Wire to Task Detail Panel

```tsx
// If task is scheduled:
<button onClick={async () => {
  await handleApiUnschedule(task.key);
  const updated = await api('/ctp/state');
  if (updated.tasks) setSolveResult(updated);
}}>Unschedule</button>

<button onClick={async () => {
  await handleApiPin(task.key, !task.pinned);
  const updated = await api('/ctp/state');
  if (updated.tasks) setSolveResult(updated);
}}>
  {task.pinned ? 'Unpin' : 'Pin'}
</button>

// If task is not scheduled:
<button onClick={async () => {
  await handleApiSchedule(task.key);
  const updated = await api('/ctp/state');
  if (updated.tasks) setSolveResult(updated);
}}>Schedule</button>
```

### Wire to Gantt Context Menu

The Gantt right-click context menu should call the immediate handlers:

```tsx
// Unschedule — immediate API call
{onApiUnschedule && contextMenu.task.feasible && (
  <button onClick={async () => {
    setContextMenu(null);
    await onApiUnschedule(contextMenu.task.key);
  }} style={menuBtnStyle}>
    ✕ Unschedule
  </button>
)}

// Pin/Unpin — immediate API call
{onApiPin && contextMenu.task.feasible && (
  <button onClick={async () => {
    setContextMenu(null);
    await onApiPin(contextMenu.task.key, !contextMenu.task.pinned);
  }} style={menuBtnStyle}>
    📌 {contextMenu.task.pinned ? 'Unpin' : 'Pin'}
  </button>
)}

// Where To — already immediate
{onWhereTo && (
  <button onClick={() => {
    setContextMenu(null);
    onWhereTo(contextMenu.task.key, 'gantt');
  }} style={menuBtnStyle}>
    🗺 Where Can This Go?
  </button>
)}
```

### Wire to Unscheduled Panel

Each task chip in the unscheduled panel gets a "Schedule" button for immediate placement:

```tsx
{onApiSchedule && !isExcluded && (
  <button onClick={async (e) => {
    e.stopPropagation();
    await onApiSchedule(task.key);
  }}
    title="Schedule this task now"
    style={{
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 12, padding: '0 2px', color: C.green, opacity: 0.7,
    }}>
    ▶
  </button>
)}
```

So the unscheduled panel chips now have two quick actions:
- ▶ Schedule (immediate — find best slot and place it)
- 🗺️ Where To (shows options, planner picks)

### Wire to Task Detail Panel

In the task detail/slide panel, the action buttons should also be immediate:

```tsx
// If task is scheduled:
<button onClick={() => handleApiUnschedule(task.key)}>Unschedule</button>
<button onClick={() => handleApiPin(task.key, !task.pinned)}>
  {task.pinned ? 'Unpin' : 'Pin'}
</button>

// If task is not scheduled:
<button onClick={() => handleApiSchedule(task.key)}>Schedule</button>
```

### Selection Toolbar — Unchanged

Bulk actions from the selection toolbar still queue for solve. No changes needed:

```tsx
// These still queue to local state:
onUnscheduleSelected → setTaskUnschedules(...)
onPinSelected → setTaskPins(...)
onExcludeSelected → setTaskExcludes(...)
onScheduleSelected → remove from excludes/unschedules
```

The distinction is clear:
- **One task, context menu / panel / chip** → immediate API call
- **Multiple tasks, selection toolbar** → queue for solve

### Loading State

Immediate actions should show a brief loading indicator so the planner knows something is happening:

```tsx
const [actionLoading, setActionLoading] = useState<string | null>(null);

const handleApiUnschedule = useCallback(async (taskKey: string) => {
  setActionLoading(taskKey);
  try {
    // ... API call ...
  } finally {
    setActionLoading(null);
  }
}, []);
```

On the Gantt bar or table row, show a subtle spinner or pulse when `actionLoading === task.key`:

```tsx
style={{
  ...(actionLoading === task.key && {
    opacity: 0.5,
    animation: 'pulse 0.8s ease-in-out infinite',
  }),
}}
```

### Error Handling

If an immediate action fails, show a toast or inline error — don't silently fail:

```tsx
// After failed unschedule:
if (!res.success) {
  // Could be: task is pinned, task not found, task not scheduled
  showToast?.(`Cannot unschedule: ${res.message || 'Unknown error'}`);
}

// After failed schedule:
if (!res.success) {
  showToast?.(`Cannot schedule ${taskKey}: ${res.errors?.[0]?.reason || 'No feasible slot found'}`);
}
```

If a toast system doesn't exist yet, a simple approach:

```tsx
const [toast, setToast] = useState<string | null>(null);

// Show toast
const showToast = (msg: string) => {
  setToast(msg);
  setTimeout(() => setToast(null), 4000);
};

// Render toast
{toast && (
  <div style={{
    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    padding: '10px 20px', borderRadius: 8, fontSize: 13, fontFamily: FONT,
    background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 9999,
  }}>
    {toast}
  </div>
)}
```

## What NOT to Change

- WhereTo/MoveTo — already immediate, no changes
- Unscheduled panel from Sprint 1 — stays, gains ▶ Schedule button per chip
- Checkboxes and selection from Sprint 1 — stays
- Exclude — still queues for solve (it's configuration, not a direct action)
- Order modes — still queue for solve
- Solve Preview — still works for excludes, order modes, and explicit solve requests
- The Solve button itself — planner uses it when they want the optimizer to place unscheduled tasks holistically

## What Changes from Sprint 1

- Selection toolbar Unschedule/Pin/Schedule buttons → **immediate API calls** (were queued)
- Gantt context menu Unschedule/Pin → **immediate API calls** (were queued)
- Task detail panel actions → **immediate API calls** (were queued)
- Visual indicators for pending unschedule/pin → **no longer needed for these actions** since they happen instantly. Strikethrough and pin badges still show for the actual state (unscheduled = not on Gantt, pinned = lock icon from server data)
- `taskUnschedules` and `taskPins` local state → **still exist** but only used if Exclude+Solve flow needs them. For direct actions, they're bypassed.

## Solve Behavior

Solve now means: "take the current landscape and schedule all unscheduled tasks that aren't pinned or excluded." The planner's workflow:

1. Unschedule tasks interactively (immediate)
2. Pin tasks they want locked (immediate)
3. Place some tasks manually via WhereTo/MoveTo (immediate)
4. Hit Solve → optimizer places remaining unscheduled tasks

Solve does NOT move already-scheduled tasks unless the planner explicitly unscheduled them first.

## User Flow Examples

### Clear a resource after a date
1. Filter task list to Resource A + after 2pm
2. Select all (header checkbox) → "8 selected"
3. Click "✕ Unschedule 8" → API calls fire, all 8 unscheduled immediately
4. Gantt clears Resource A after 2pm, all 8 appear in unscheduled panel
5. WhereTo on priority task → place it on Resource A at 2pm
6. Click ▶ on remaining tasks in unscheduled panel to auto-place them

### Lock down the next shift
1. Filter task list to "Next 4 hours"
2. Select all → "12 selected"
3. Click "📌 Pin 12" → all 12 pinned immediately, lock icons appear
4. Now solver won't touch them on the next solve

### Bulk schedule from unscheduled pool
1. 10 tasks sitting in unscheduled panel
2. Check 6 of them via checkboxes
3. Click "▶ Schedule 6" → engine finds best slot for each, placed immediately
4. Toast: "6/6 scheduled" (or "4/6 scheduled. 2 could not be placed.")
5. Remaining 4 still in unscheduled panel — use WhereTo for manual placement

### Solver for optimization
1. Planner has manually placed 15 tasks, 5 remain unscheduled
2. Clicks Solve → solver optimally places the 5 unscheduled tasks
3. The 15 already-placed tasks don't move

### Interactive single-task on Gantt
1. Right-click task on Gantt → Unschedule → gone immediately
2. Task appears in unscheduled panel
3. Click 🗺️ → WhereTo ghost bars appear → pick option → MoveTo → placed
4. Right-click → 📌 Pin → locked immediately

## Test Plan

1. **Single unschedule from Gantt** — right-click → Unschedule → task disappears immediately, appears in unscheduled panel
2. **Single pin from Gantt** — right-click → Pin → lock icon appears immediately
3. **Single unpin from Gantt** — right-click pinned task → Unpin → lock icon gone immediately
4. **Single schedule from unscheduled panel** — click ▶ → task placed on Gantt immediately
5. **Bulk unschedule** — select 5 tasks → "Unschedule 5" → all 5 gone from Gantt immediately
6. **Bulk pin** — select 5 → "Pin 5" → all 5 get lock icon immediately
7. **Bulk schedule** — select 5 unscheduled → "Schedule 5" → placed immediately, toast shows success count
8. **Partial bulk failure** — schedule 5 but 2 have no feasible slot → toast "3/5 scheduled. 2 could not be placed."
9. **Loading state** — during bulk action, buttons disabled, subtle loading indicator
10. **Error on single action** — try to unschedule a pinned task → toast error message
11. **Selection clears after bulk action** — checkboxes unchecked after any bulk action completes
12. **Refresh from /ctp/state** — after every immediate action, UI shows current server state
13. **Exclude still queues** — exclude from toolbar → visual indicator, committed on solve
14. **Solve after interactive changes** — unschedule 3 interactively, solve → solver places the 3 unscheduled tasks
15. **Mixed workflow** — unschedule 2 (immediate), pin 3 (immediate), solve remaining

## Depends On

- Sprint 1: Select & Act (complete)
- API: `/ctp/tasks/:taskKey/unschedule`, `/ctp/tasks/:taskKey/pin`, `/ctp/tasks/:taskKey/schedule` (all exist)
