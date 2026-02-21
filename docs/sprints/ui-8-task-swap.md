# UI Sprint 8: Task Swap

## Status: WAITING (blocked by Sprint 1, Sprint 2, Sprint 4)

## What the Planner Gets

Select exactly two scheduled tasks on the same resource → "Swap" button appears → tasks exchange time slots on the next solve.

## Why This Matters

"These two tasks are in the wrong order. Just swap them." This is the most intuitive operation a planner can imagine, but today it requires: unschedule both, hope the solver puts them back in swapped positions, manually verify. Swap makes it explicit and predictable.

## User Flow

1. Planner sees Task A (8am-10am) and Task B (10am-12pm) on CNC-01
2. Selects both via checkboxes (or Ctrl+click on Gantt bars)
3. Selection toolbar shows: `☑ 2 selected | 🔄 Swap | ✕ Unschedule 2 | ...`
4. Clicks "🔄 Swap"
5. Visual preview: ghost bars show where each task will go
   - Task A ghost at 10am-12pm, Task B ghost at 8am-10am
6. Both tasks queued for unschedule with time preference overrides
7. Solve → tasks land in swapped positions

## UI Changes

### Swap Button Visibility

Show "Swap" only when exactly 2 scheduled tasks are selected AND they share at least one resource:

```tsx
const canSwap = useMemo(() => {
  if (selectedTasks.size !== 2) return false;
  const [key1, key2] = Array.from(selectedTasks);
  const t1 = tasks.find(t => t.key === key1);
  const t2 = tasks.find(t => t.key === key2);
  if (!t1?.feasible || !t2?.feasible) return false;
  // Check shared resource
  const res1 = new Set(t1.assignedResources?.map(r => r.resourceKey) || []);
  return t2.assignedResources?.some(r => res1.has(r.resourceKey)) || false;
}, [selectedTasks, tasks]);

{canSwap && (
  <button onClick={handleSwap} style={toolbarBtnStyle}>
    🔄 Swap
  </button>
)}
```

### Swap Handler

Swap is implemented as: unschedule both + set time preferences so solver places them in each other's slots:

```tsx
const handleSwap = () => {
  const [key1, key2] = Array.from(selectedTasks);
  const t1 = tasks.find(t => t.key === key1);
  const t2 = tasks.find(t => t.key === key2);
  
  // Queue both for unschedule
  setTaskUnschedules(prev => {
    const next = new Set(prev);
    next.add(key1);
    next.add(key2);
    return next;
  });
  
  // Set time preferences: each task prefers the other's time slot
  setTimePreferences(prev => ({
    ...prev,
    [key1]: { preferredStart: t2.scheduledStart, preferredEnd: t2.scheduledEnd },
    [key2]: { preferredStart: t1.scheduledStart, preferredEnd: t1.scheduledEnd },
  }));
  
  setSelectedTasks(new Set());
  setSolveStale(true);
};
```

### Visual Preview on Gantt

After swap is queued, show ghost bars at swapped positions:

```tsx
// For swapped tasks, show ghost at target position
{timePreferences[task.key] && (
  <div style={{
    position: 'absolute',
    left: timeToPixel(new Date(timePreferences[task.key].preferredStart).getTime()),
    width: /* computed from preferred start/end */,
    top: rowY, height: barHeight,
    borderRadius: 4,
    border: `2px dashed ${C.accent}`,
    background: `${C.accent}15`,
    pointerEvents: 'none',
  }}>
    <span style={{ fontSize: 9, color: C.accent, padding: 2 }}>
      {task.name} → here
    </span>
  </div>
)}
```

### Swap Badge

Tasks queued for swap show a distinctive badge:

```tsx
{timePreferences[tk.key] && (
  <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginLeft: 4 }}>🔄 SWAP</span>
)}
```

## API Requirements

Need `timePreferences` in the solve request:

```typescript
interface TimePreference {
  taskKey: string;
  preferredStart: string;  // ISO datetime
  preferredEnd: string;    // ISO datetime
}
```

The engine scoring would need a time-preference scoring rule that penalizes deviation from the preferred time slot. This ensures the solver places the task as close to the target time as possible.

**Simpler alternative:** If the engine doesn't support time preferences yet, implement swap as two sequential WhereTo+MoveTo calls:
1. Unschedule both
2. MoveTo Task A at Task B's old time
3. MoveTo Task B at Task A's old time

This is deterministic and doesn't need solver support, but bypasses scoring.

## Edge Cases

- **Different durations:** Task A is 2h, Task B is 3h. Swap still works — each gets the other's start time, duration stays the same. The gaps/overlaps sort themselves out in the solve.
- **Tasks on different resources:** Swap button hidden. Not supported (too complex).
- **One task pinned:** Swap button hidden. Can't move a pinned task.
- **Tasks not adjacent:** Swap still works — they just exchange time slots, tasks between them may shift.
- **Cancel swap:** Remove from timePreferences and taskUnschedules.

## Test Plan

1. Select 2 scheduled tasks on same resource → "Swap" button appears
2. Select 2 on different resources → no "Swap" button
3. Select 3 tasks → no "Swap" button
4. Click Swap → both tasks get strikethrough + ghost bars at swapped positions
5. Solve → tasks land in swapped positions
6. "SWAP" badge appears in task table
7. Cancel swap (undo unschedule) → ghost bars removed

## Depends On

- Sprint 1: Select & Act (selection)
- Sprint 2: Solve Selected (targeted re-solve for just the 2 tasks)
- Sprint 4: Redirect Work (resource preference pattern, extended to time preferences)
- API: Time preference support in solve request (or fallback to MoveTo)
