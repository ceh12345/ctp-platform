# UI Sprint 2: Solve Selected (Partial Re-Solve)

## Status: WAITING (blocked by Sprint 1)

## What the Planner Gets

A "Solve Selected" button in the selection toolbar. Instead of solving everything, the solver only schedules the selected tasks. Everything else stays exactly where it is.

## Why This Matters

Today every solve reschedules everything. If the planner unschedules 3 tasks and re-solves, the solver might move 15 other tasks too — "helping" by reoptimizing the whole schedule. The planner doesn't want that. They want surgical control: "fix just these, leave the rest alone."

The API already supports this via `taskKeys` in the solve request. This sprint exposes it to the UI.

## User Flow

1. Planner selects 5 tasks via checkboxes (Sprint 1)
2. Selection toolbar shows: `☑ 5 selected | ▶ Solve Selected (5) | ✕ Unschedule 3 | ...`
3. Planner clicks "Solve Selected (5)"
4. Confirmation: "Solve 5 tasks. 35 other tasks will not be moved."
5. API call: `POST /ctp/solve` with `{ taskKeys: ['T1','T2','T3','T4','T5'] }`
6. Results refresh — only those 5 tasks may have changed
7. Selection clears, stale banner gone

## UI Changes

### Selection Toolbar Addition

Add "Solve Selected" as a primary action button (distinguished from the queue-style actions):

```tsx
<button onClick={handleSolveSelected} style={{
  padding: '6px 14px', borderRadius: 6, fontFamily: FONT,
  background: C.accent, color: '#fff', border: 'none',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}}>
  ▶ Solve Selected ({selectedTasks.size})
</button>
```

This button is visually distinct — filled accent color instead of text-only — because it triggers an immediate solve, not a queued action.

### Confirmation Dialog

Brief confirmation before solving:

```
┌─────────────────────────────────────┐
│ Solve 5 selected tasks              │
│                                     │
│ These tasks will be scheduled:      │
│ • Mixing-ORD-007-1                  │
│ • Filling-ORD-007-2                 │
│ • Labeling-ORD-007-3                │
│ • Mixing-ORD-009-1                  │
│ • Filling-ORD-009-2                 │
│                                     │
│ All other tasks stay in place.      │
│                                     │
│            [Cancel]  [Solve]        │
└─────────────────────────────────────┘
```

### API Call

```tsx
const handleSolveSelected = async () => {
  const keys = Array.from(selectedTasks);
  // Build request with only the selected task keys
  const request = {
    taskKeys: keys,
    // Include any pending overrides that apply to these tasks
    taskPins: Object.fromEntries(
      Object.entries(taskPins).filter(([k]) => keys.includes(k))
    ),
    taskExcludes: Object.keys(taskExcludes).filter(k => taskExcludes[k] && keys.includes(k)),
    taskUnschedules: Array.from(taskUnschedules).filter(k => keys.includes(k)),
    strategy: selectedStrategy,
  };
  
  const res = await fetch(`${API}/ctp/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await res.json();
  setResult(data);
  // Clear overrides and selection
  setSelectedTasks(new Set());
  setTaskUnschedules(new Set());
  setTaskPins({});
  setTaskExcludes({});
  setSolveStale(false);
};
```

### Results Merge

Important: the solve response only contains the selected tasks' results. The UI needs to merge these into the existing result set, not replace it:

```tsx
// Merge approach: update only the tasks that were re-solved
setResult(prev => {
  if (!prev) return data;
  const updatedKeys = new Set(data.tasks.map((t: any) => t.key));
  const merged = prev.tasks
    .filter((t: any) => !updatedKeys.has(t.key))  // keep unchanged tasks
    .concat(data.tasks);                            // add re-solved tasks
  return {
    ...prev,
    tasks: merged,
    // Update summary with fresh counts
    summary: data.summary,
    resourceUtilization: data.resourceUtilization,
  };
});
```

**Note:** This merge logic may need refinement based on how the API returns partial solve results. If the API always returns the full task list even for partial solves, the merge is unnecessary — just replace.

## Interaction with Sprint 1 Actions

The "Solve Selected" button works alongside queued actions:

- Select 3 tasks → Unschedule 2 → then Solve Selected (3)
  - The 2 are unscheduled, then all 3 are solved
  - Overrides for those 3 are included in the request

- Select 5 tasks → Solve Selected → only those 5 are touched
  - Any overrides (pins, excludes) on non-selected tasks are preserved for the full solve later

## Edge Cases

- **Nothing selected:** Button doesn't appear
- **All tasks selected:** Equivalent to full solve — show warning "This will re-solve all tasks"
- **Selected tasks include pinned:** Pinned tasks are included but won't move — show info
- **Solve fails:** Show errors, don't clear selection or overrides

## Test Plan

1. Select 3 tasks → "Solve Selected (3)" appears in toolbar
2. Click → confirmation dialog shows task names
3. Confirm → only those 3 tasks change in results
4. Other tasks' positions unchanged
5. Selection clears after solve
6. Select all → warning about full re-solve
7. Pending unschedule + solve selected = unschedule applied first
8. Results merge correctly (no duplicate tasks, counts accurate)

## Depends On

- Sprint 1: Select & Act (selection mechanism)
- API: `taskKeys` parameter in solve request (already exists)
