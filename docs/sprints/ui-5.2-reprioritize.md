# UI: Reprioritize — Inline Priority Edit & Rush (Sprint 5 Frontend)

Add inline priority editing in the task table, bulk priority setting for selected tasks, and a one-click Rush action. Priority overrides pass to the solver on next solve.

**Prerequisites:** Sprint 1 (Select & Act) must be complete. The engine must support `priorityOverrides` in the solve request (see Sprint 5 Engine prompt). The solve response must include `priority`, `originalPriority`, and `priorityOverridden` fields on each task.

Kill any existing node processes before starting:
```bash
killall node 2>/dev/null || true
```

Stop any running dev servers on ports 3000 and 3001 before starting. Restart both after all changes are complete.

---

## Part 1: State

Add to App state:

```tsx
// taskKey → new priority value
const [priorityOverrides, setPriorityOverrides] = useState<Record<string, number>>({});

// Which task cell is being edited
const [editingPriority, setEditingPriority] = useState<string | null>(null);

// Bulk priority dialog
const [showPriorityDialog, setShowPriorityDialog] = useState(false);
```

---

## Part 2: Inline Priority Edit in Task Table

The Priority column in the task table becomes clickable. When clicked, it switches to an inline number input.

**Display mode** (default):
- Shows the effective priority: override value if one exists, otherwise the task's priority from the API
- If overridden, show in accent color with "(was X)" next to it
- Cursor: pointer to indicate editable

**Edit mode** (when clicked):
- Small number input, min 1, max 99
- Auto-focused, pre-filled with current effective priority
- Enter or blur → save the override, mark stale
- Escape → cancel, no change

```tsx
// In the task table priority column
<td
  onClick={(e) => { e.stopPropagation(); setEditingPriority(tk.key); }}
  style={{ ...cellStyle, cursor: 'pointer', minWidth: 80 }}
>
  {editingPriority === tk.key ? (
    <input
      type="number"
      min={1}
      max={99}
      defaultValue={getEffectivePriority(tk)}
      autoFocus
      onBlur={(e) => {
        const val = Math.max(1, Math.min(99, parseInt(e.target.value) || 50));
        const original = tk.priority ?? 50;
        if (val !== original) {
          setPriorityOverrides(prev => ({ ...prev, [tk.key]: val }));
          markStale();
        } else {
          // Same as original — remove override if it existed
          setPriorityOverrides(prev => {
            const next = { ...prev };
            delete next[tk.key];
            return next;
          });
        }
        setEditingPriority(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditingPriority(null);
      }}
      style={{
        width: 48, fontSize: 12, padding: '2px 6px', borderRadius: 4,
        border: `1px solid ${C.accent}`, background: C.surface, color: C.text,
        textAlign: 'center',
      }}
    />
  ) : (
    <span style={{
      ...(priorityOverrides[tk.key] !== undefined && {
        color: C.accent, fontWeight: 700,
      }),
    }}>
      {getEffectivePriority(tk)}
      {priorityOverrides[tk.key] !== undefined && (
        <span style={{ fontSize: 9, color: C.textDim, marginLeft: 4 }}>
          (was {tk.priority ?? 50})
        </span>
      )}
    </span>
  )}
</td>
```

Helper:

```tsx
function getEffectivePriority(task: any): number {
  return priorityOverrides[task.key] ?? task.priority ?? 50;
}
```

---

## Part 3: Rush Badge

Tasks with priority overridden to 1 get a Rush badge in the task table, next to the task name or in a status column:

```tsx
{priorityOverrides[tk.key] === 1 && (
  <span style={{
    fontSize: 10,
    color: C.red,
    fontWeight: 700,
    marginLeft: 4,
    padding: '1px 5px',
    borderRadius: 3,
    border: `1px solid ${C.red}`,
  }}>
    🔥 RUSH
  </span>
)}
```

Also show for tasks that came back from the API with `priority === 1` and `priorityOverridden === true` (previously rushed, now persisted).

---

## Part 4: Selection Toolbar — Bulk Priority & Rush

When tasks are selected (Sprint 1's selection toolbar), add two buttons:

```tsx
{/* Bulk priority */}
<button
  onClick={() => setShowPriorityDialog(true)}
  style={toolbarBtnStyle}
>
  ↕ Set Priority
</button>

{/* Rush — one click to priority 1 */}
<button
  onClick={() => handleRush(selectedArray)}
  style={{ ...toolbarBtnStyle, color: C.red, fontWeight: 700 }}
>
  🔥 Rush
</button>
```

### Rush Handler

```tsx
const handleRush = (keys: string[]) => {
  setPriorityOverrides(prev => {
    const next = { ...prev };
    keys.forEach(k => {
      // Only set if not already priority 1
      const current = getEffectivePriority(tasks.find(t => t.key === k));
      if (current !== 1) {
        next[k] = 1;
      }
    });
    return next;
  });
  clearSelection();
  markStale();
};
```

---

## Part 5: Bulk Priority Dialog

A simple modal for setting priority on multiple tasks at once.

```
┌────────────────────────────────────────┐
│  ↕ Set Priority for 4 tasks            │
│                                        │
│  Current priorities: 50, 50, 25, 50    │
│                                        │
│  New priority: [____10____]            │
│                                        │
│  1 = Highest (scheduled first)         │
│  99 = Lowest (scheduled last)          │
│                                        │
│  Quick set:                            │
│  [🔥 Rush (1)]  [High (10)]           │
│  [Normal (50)]  [Low (75)]            │
│                                        │
│              [Cancel]  [Apply]         │
└────────────────────────────────────────┘
```

Features:
- Shows current priorities of selected tasks for context
- Number input for custom priority
- Quick-set buttons for common values: Rush (1), High (10), Normal (50), Low (75)
- Quick-set buttons fill the input AND apply immediately (close dialog)
- Apply button applies the input value

```tsx
function handleBulkPriority(keys: string[], priority: number) {
  const clamped = Math.max(1, Math.min(99, Math.round(priority)));
  setPriorityOverrides(prev => {
    const next = { ...prev };
    keys.forEach(k => { next[k] = clamped; });
    return next;
  });
  setShowPriorityDialog(false);
  clearSelection();
  markStale();
}
```

---

## Part 6: Stale Banner / Solve Preview Integration

Add priority changes to the queued actions shown in the stale banner or solve preview panel:

```tsx
{Object.keys(priorityOverrides).length > 0 && (
  <div style={{ fontSize: 13, color: C.accent, marginBottom: 4 }}>
    ↕ {Object.keys(priorityOverrides).length} priority change(s):
    {Object.entries(priorityOverrides).slice(0, 5).map(([k, p]) => {
      const task = tasks.find(t => t.key === k);
      return ` ${task?.name || k} → ${p === 1 ? '🔥 Rush' : p}`;
    }).join(',')}
    {Object.keys(priorityOverrides).length > 5 && (
      ` +${Object.keys(priorityOverrides).length - 5} more`
    )}
  </div>
)}
```

---

## Part 7: Pass to Solve & Clear After

### Pass Overrides in Solve Request

When building the solve request body (in Solve All, Solve Selected, or Apply & Solve), include:

```tsx
const solveRequest = {
  ...existingRequestFields,
  priorityOverrides: Object.keys(priorityOverrides).length > 0
    ? priorityOverrides
    : undefined,
};
```

### Clear After Solve

After a successful solve response:

```tsx
setPriorityOverrides({});
setEditingPriority(null);
```

---

## Part 8: Task Detail Panel

When viewing a single task's detail panel, show priority with an inline edit:

```
Priority: 1 🔥 RUSH  (was 50)  [Reset]
```

Or for non-overridden:

```
Priority: 50  [Edit]
```

- Clicking "Edit" switches to inline input (same as table cell)
- Clicking "Reset" clears the override for this task
- If priority came back as overridden from the API (`priorityOverridden: true`), show "(was X)" even if there's no local override

---

## Part 9: Gantt Context Menu

Add priority actions to the right-click context menu on Gantt bars:

```tsx
{ label: '🔥 Rush', onClick: () => handleRush([task.key]) },
{ label: '↕ Set Priority', onClick: () => {
  setSelectedTasks(new Set([task.key]));
  setShowPriorityDialog(true);
}},
```

Place these after existing menu items like "View Details" and before destructive actions like "Unschedule."

---

## Part 10: Sort Task Table by Priority

Add Priority as a sortable column in the task table. When sorting by priority:

- Use effective priority (override if exists, otherwise API value)
- Lower number = higher in list when ascending

```tsx
// In sort logic
case 'priority':
  return sortDir * (getEffectivePriority(a) - getEffectivePriority(b));
```

---

## Edge Cases

1. **Rush on already-priority-1 task:** No-op. Don't add override, don't mark stale.

2. **Edit to same value as original:** Remove override (not "no change" — actively clear it so badge disappears).

3. **Priority 0 or negative in input:** Clamp to 1 on blur.

4. **Priority > 99 in input:** Clamp to 99 on blur.

5. **Mixed priorities in bulk dialog:** Show all current values ("Current: 50, 25, 50, 10"). Apply sets all to the same new value.

6. **Overrides persist across tab switches:** Yes — state persists until solve or manual clear.

7. **Solve fails or is cancelled:** Overrides are NOT cleared. Planner can retry.

8. **Non-numeric input:** Default to 50 on blur (parseInt returns NaN → fallback).

---

## Test Plan

1. Click priority cell → edit mode with number input
2. Type 10 → blur → override stored, shown in accent, "(was 50)" displayed
3. Type 50 (same as original) → blur → override removed, back to normal display
4. Escape in edit mode → cancel, no change
5. Select 4 tasks → "↕ Set Priority" → dialog opens
6. Dialog shows current priorities of selected tasks
7. Type 10 → Apply → all 4 tasks show priority 10 in accent
8. Quick-set button "Rush (1)" → all 4 tasks set to 1, dialog closes
9. 🔥 Rush button in toolbar → selected tasks set to priority 1
10. 🔥 RUSH badge appears on priority-1 tasks
11. Stale banner shows priority change count
12. Solve → overrides included in request body as `priorityOverrides`
13. After solve → overrides cleared, badges gone (unless API returns priorityOverridden)
14. Task detail panel shows priority with edit/reset
15. Gantt right-click → "🔥 Rush" and "↕ Set Priority" in context menu
16. Sort by Priority column works with overrides
17. Priority clamped: type 0 → becomes 1, type 200 → becomes 99
