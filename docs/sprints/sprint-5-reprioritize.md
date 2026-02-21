# UI Sprint 5: Reprioritize

## Status: WAITING (blocked by Sprint 1)

## What the Planner Gets

Edit task priority inline in the task table, or bulk-change priority for selected tasks. Re-solve respects new priorities. A "Rush" quick action sets maximum priority.

## Why This Matters

A customer calls — their order is now urgent. The planner needs to bump it to the top of the queue without rebuilding the entire schedule manually. Priority drives solver decisions: which task gets the best time slot when capacity is contested.

## User Flow — Rush Order

1. Sales calls: Order-007 is now critical
2. Planner filters task table to Order-007
3. Selects all 4 tasks → clicks "🔥 Rush" in toolbar
4. All 4 tasks get priority = 1 (highest) and visual indicator
5. Stale banner: "4 priority changes"
6. Solve → solver gives Order-007 best available slots, possibly bumping lower-priority work

## UI Changes

### Inline Priority Edit

Priority column in task table becomes clickable/editable:

```tsx
<td onClick={(e) => { e.stopPropagation(); setEditingPriority(tk.key); }}
  style={{ ...cellStyle, cursor: 'pointer' }}>
  {editingPriority === tk.key ? (
    <input type="number" min={1} max={99}
      defaultValue={priorityOverrides[tk.key] ?? tk.priority ?? 50}
      autoFocus
      onBlur={(e) => {
        setPriorityOverrides(prev => ({ ...prev, [tk.key]: parseInt(e.target.value) }));
        setEditingPriority(null);
        setSolveStale(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditingPriority(null);
      }}
      style={{ width: 48, fontSize: 12, padding: '2px 6px', borderRadius: 4,
        border: `1px solid ${C.accent}`, background: C.surface, color: C.text }}
    />
  ) : (
    <span style={{
      ...(priorityOverrides[tk.key] !== undefined && {
        color: C.accent, fontWeight: 700,
      }),
    }}>
      {priorityOverrides[tk.key] ?? tk.priority ?? '—'}
      {priorityOverrides[tk.key] !== undefined && (
        <span style={{ fontSize: 9, color: C.textDim, marginLeft: 4 }}>
          (was {tk.priority ?? '—'})
        </span>
      )}
    </span>
  )}
</td>
```

### Selection Toolbar — Bulk Priority

When tasks are selected, show priority actions:

```tsx
<button onClick={() => setShowPriorityDialog(true)} style={toolbarBtnStyle}>
  ↕ Set Priority
</button>
<button onClick={() => handleRush(selectedArray)} style={{
  ...toolbarBtnStyle, color: C.red, fontWeight: 700,
}}>
  🔥 Rush
</button>
```

**Priority dialog:**
```
┌────────────────────────────────────┐
│ Set Priority for 4 tasks           │
│                                    │
│ Priority: [___10___]               │
│                                    │
│ 1 = Highest, 99 = Lowest           │
│                                    │
│           [Cancel]  [Apply]        │
└────────────────────────────────────┘
```

**Rush action:**
```tsx
const handleRush = (keys: string[]) => {
  setPriorityOverrides(prev => {
    const next = { ...prev };
    keys.forEach(k => { next[k] = 1; });
    return next;
  });
  setSelectedTasks(new Set());
  setSolveStale(true);
};
```

### Override State

```tsx
const [priorityOverrides, setPriorityOverrides] = useState<Record<string, number>>({});
```

### Visual Indicator

Priority column shows the new value in accent color with the old value dimmed:

```
Priority
  1  (was 50)     ← changed, shown in accent color
  50               ← unchanged
  10 (was 50)     ← changed
```

Row badge for rushed tasks:
```tsx
{priorityOverrides[tk.key] === 1 && (
  <span style={{ fontSize: 10, color: C.red, fontWeight: 700, marginLeft: 4 }}>🔥 RUSH</span>
)}
```

### Solve Preview

Add priority changes to the queued actions section:

```tsx
{Object.keys(priorityOverrides).length > 0 && (
  <div style={{ fontSize: 13, color: C.accent, marginBottom: 4 }}>
    ↕ Priority changed: {Object.entries(priorityOverrides).map(([k, p]) =>
      `${tasks.find(t => t.key === k)?.name || k} → ${p}`
    ).join(', ')}
  </div>
)}
```

### Pass to Solve

```tsx
// In handleSolveConfirm
const request = {
  ...existingOverrides,
  priorityOverrides,
};
```

### Clear After Solve

```tsx
setPriorityOverrides({});
```

## API Requirements

Need to add `priorityOverrides: Record<string, number>` to `SolveRequestDto`. The engine applies these before building the task sort order for scheduling. Tasks with lower priority numbers are scheduled first (or scored better).

## Edge Cases

- **Priority 0 or negative:** Clamp to 1-99
- **Rush on already-priority-1 task:** No-op, no stale flag
- **Undo priority change:** Click the priority cell again, set back to original (or clear the override)
- **Mixed selection with different current priorities:** Dialog shows blank input, applies same value to all

## Test Plan

1. Click priority cell → edit mode with input
2. Type new value → blur → override stored, shown in accent
3. "Was X" shown next to changed value
4. Select tasks → "Set Priority" → dialog → apply to all selected
5. "Rush" button sets priority to 1 for all selected
6. 🔥 RUSH badge appears on rushed tasks
7. Solve Preview shows priority changes
8. Solve → solver respects new priorities
9. Overrides clear after solve
10. Escape in edit mode → cancel, no change

## Depends On

- Sprint 1: Select & Act (selection for bulk)
- API: `priorityOverrides` in solve request (needs engine support)
