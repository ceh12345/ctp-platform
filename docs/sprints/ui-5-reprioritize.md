# Sprint 5: Reprioritize

Let planners control which tasks the solver schedules first. Inline priority editing, bulk Set Priority, one-click 🔥 Rush. Priority drives solver task ordering.

Stop any running dev servers on ports 3000 and 3001 before starting. Restart both after all changes are complete.

**Depends on:** Sprint 1 (Select & Act), Sprint 2 (Solve Selected)

---

## Part 1: Engine — Priority Field + Sorting

### 1.1 Add `priority` and `originalPriority` to CTPTask

`CTPTask` inherits `rank` from `CTPEntity` — that's the business priority set in config data (e.g., Urgent=1, Elective=3). **Don't change `rank`.**

Add a new field `priority` that the planner can override at runtime:

```typescript
// In CTPTask class
public priority: number = 50;           // Planner-settable priority (1=highest, 100=lowest)
public originalPriority: number = 50;   // Original value for reset
```

Initialize both in the constructor:
```typescript
this.priority = 50;           // Default: normal priority
this.originalPriority = 50;
```

### 1.2 Hydration — Map from config data

In the state hydrator (`state-hydrator.service.ts`), when building tasks from config:

```typescript
// If task data has a priority field, use it
if (data.priority !== undefined) {
  task.priority = data.priority;
  task.originalPriority = data.priority;
}
// Also map from typedAttributes if present (healthcare uses "priority": "URGENT" etc.)
if (data.typedAttributes?.priority) {
  const priorityMap: Record<string, number> = {
    'URGENT': 10,
    'EMERGENCY': 5,
    'ADD-ON': 25,
    'ROUTINE': 50,
    'ELECTIVE': 50,
  };
  const mapped = priorityMap[data.typedAttributes.priority.toUpperCase()];
  if (mapped !== undefined) {
    task.priority = mapped;
    task.originalPriority = mapped;
  }
}
```

This means healthcare cases with `"priority": "URGENT"` automatically get priority 10, while manufacturing tasks default to 50. The planner can override any of them at runtime.

### 1.3 Sort by priority in task list building

In `ctp.service.ts`, the `buildTaskList()` method builds the list of tasks to solve. After building the list, sort by priority so the solver processes high-priority tasks first:

```typescript
// At the end of buildTaskList(), before return:
taskList.sort((a, b) => {
  if (a.priority !== b.priority) return a.priority - b.priority;  // Lower number = higher priority
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  return 0;
});
```

### 1.4 Apply priority overrides on landscape

Add to the solve request DTO (`solve-request.dto.ts`):

```typescript
// Add to SolveRequestDto
priorityOverrides?: Record<string, number>;  // taskKey → priority value
```

In `ctp.service.ts` `solve()`, apply overrides after other overrides (add as step 1g):

```typescript
// 1g. Priority overrides
if (request?.priorityOverrides) {
  for (const [taskKey, priority] of Object.entries(request.priorityOverrides)) {
    const task = landscape.tasks?.getEntity(taskKey);
    if (task) {
      task.priority = priority;
    }
  }
}
```

### 1.5 Add priority to solve response

In the task results section of `extractResults()`, add priority to each task:

```typescript
const taskResult: any = {
  // ... existing fields ...
  priority: task.priority,
  originalPriority: task.originalPriority,
  isRush: task.priority <= 10,
  // ...
};
```

### 1.6 Reset priority on Sync

When `stateService.syncFromConfig()` runs, it rebuilds the landscape from scratch. Priorities reset to their config values automatically — no extra work needed.

---

## Part 2: Frontend — Priority Column + Rush + Bulk Set

### 2.1 Priority column in task table

Add a **Priority** column to the task table. Display rules:

| Priority Value | Display | Style |
|---------------|---------|-------|
| 1-10 | 🔥 RUSH | Red badge, bold |
| 11-25 | HIGH | Orange text |
| 26-75 | NORMAL | Default text |
| 76-100 | LOW | Dimmed text |

The column should be **inline editable** — click the cell, it becomes a number input (1-100), press Enter or click away to confirm.

When edited:
```typescript
// Update local state
setPriorityOverrides(prev => ({ ...prev, [taskKey]: newValue }));
// Mark solve as stale
setIsStale(true);
```

Priority overrides are stored locally until the next solve, then sent in the request body.

### 2.2 Priority column sorting

The Priority column should be sortable. Click the header to sort ascending (Rush first) or descending.

### 2.3 🔥 Rush button in selection toolbar

When 1+ tasks are selected, show a **🔥 Rush** button in the selection toolbar (alongside existing Unschedule, Pin, Exclude buttons).

**On click:**
- Sets priority = 1 for ALL selected tasks
- Updates `priorityOverrides` state
- Marks solve as stale
- Shows toast: "3 tasks set to 🔥 RUSH"

```typescript
const handleRush = () => {
  const newOverrides = { ...priorityOverrides };
  selectedTasks.forEach(taskKey => {
    newOverrides[taskKey] = 1;
  });
  setPriorityOverrides(newOverrides);
  setIsStale(true);
};
```

### 2.4 Set Priority dialog

When 1+ tasks are selected, show a **"Set Priority"** button in the selection toolbar. Opens a dialog:

```
┌─────────────────────────────────────┐
│  Set Priority for 4 tasks           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Priority: [  25  ]         │    │
│  └─────────────────────────────┘    │
│                                     │
│  Quick set:                         │
│  [🔥 Rush (1)] [High (20)]         │
│  [Normal (50)] [Low (80)]          │
│                                     │
│  [Cancel]           [Apply]         │
└─────────────────────────────────────┘
```

- Number input accepts 1-100
- Quick-set buttons fill the input
- **Apply** → sets priority for all selected tasks, closes dialog, marks stale
- **Cancel** → closes dialog, no changes

### 2.5 RUSH badge on task rows

When a task has priority ≤ 10 (whether from config or override), show a 🔥 **RUSH** badge:

- **Task table:** Red badge next to the task name
- **Task detail panel:** Badge in the header area
- **Gantt bar:** Small 🔥 icon on the left side of the bar (if space permits)

### 2.6 Priority filter

Add priority to the column filter dropdowns (Sprint 3). Options:
- 🔥 Rush (1-10)
- High (11-25)
- Normal (26-75)
- Low (76-100)

### 2.7 Stale banner integration

Priority changes should trigger the stale banner. The banner's change summary should include priority changes:

```
"⚠ Changes pending — 2 tasks set to Rush · 1 task priority changed"
```

### 2.8 Clear overrides on solve

After a successful solve, clear priority overrides from local state:

```typescript
// After solve response received
setPriorityOverrides({});
```

The applied priorities are now baked into the solve result (each task shows its `priority` and `originalPriority`).

### 2.9 Send overrides in solve request

When calling `POST /ctp/solve`, include priority overrides:

```typescript
const solveBody = {
  // ... existing fields (taskKeys, resourcePreferenceOverrides, etc.) ...
  priorityOverrides: Object.keys(priorityOverrides).length > 0 
    ? priorityOverrides 
    : undefined,
};
```

### 2.10 Reset indicator

If a task's priority differs from its `originalPriority` in the solve result, show a small "modified" indicator in the priority cell (e.g., a dot or different background). This tells the planner which tasks had their priority changed from the default.

### 2.11 Gantt context menu

Add to the existing Gantt right-click context menu:

```
View Details
─────────────
🔥 Rush
Set Priority...
─────────────
Unschedule
Pin to Position
Exclude from Solve
```

"🔥 Rush" sets priority 1 for that task. "Set Priority..." opens the dialog for that single task.

### 2.12 Task detail panel

In the task detail panel, show:

```
Priority: 🔥 RUSH (1)  [Edit]
Original: ELECTIVE (50)
```

The [Edit] button opens the inline editor or the Set Priority dialog for that single task.

---

## Part 3: Solve Request Wire-Up

The full solve request body should now support:

```typescript
POST /ctp/solve
{
  // Existing fields
  taskKeys?: string[],
  strategy?: string,
  taskUnschedules?: string[],
  taskPins?: Record<string, boolean>,
  taskExcludes?: string[],
  resourceModes?: Record<string, Record<string, string>>,
  materialModes?: Record<string, string>,
  resourcePreferenceOverrides?: Record<string, Record<string, string>>,
  
  // New in Sprint 5
  priorityOverrides?: Record<string, number>,
}
```

---

## Part 4: Window Editing for Unscheduled / Infeasible Tasks

When a task is infeasible, the most common reason is "no capacity within window." The planner needs to see the window and widen it to give the solver more room.

### 4.1 Show window on task detail panel

For ALL tasks (but especially useful for Unscheduled/Infeasible), show the scheduling window in the task detail panel:

```
Scheduling Window
  Start: Feb 16, 2026 06:00    [Edit]
  End:   Feb 18, 2026 18:00    [Edit]
  Duration: 2.5 days
```

For **scheduled** tasks, also show the scheduled time below for comparison:
```
Scheduled
  Start: Feb 16, 2026 08:30
  End:   Feb 16, 2026 11:00
```

### 4.2 Inline window editing

Click [Edit] next to Start or End → date-time picker appears. Planner can:
- Push the **end** later to give more room (most common)
- Pull the **start** earlier
- Or both

When edited:
```typescript
// Store window overrides locally
setWindowOverrides(prev => ({
  ...prev,
  [taskKey]: {
    windowStart: newStart,   // ISO string or null (null = keep original)
    windowEnd: newEnd,       // ISO string or null
  }
}));
setIsStale(true);
```

### 4.3 Window override in solve request

Add to the solve request DTO:

```typescript
// Add to SolveRequestDto
windowOverrides?: Record<string, { windowStart?: string; windowEnd?: string }>;
```

In `ctp.service.ts` `solve()`, apply window overrides (add as step 1h, after priority overrides):

```typescript
// 1h. Window overrides
if (request?.windowOverrides) {
  for (const [taskKey, override] of Object.entries(request.windowOverrides)) {
    const task = landscape.tasks?.getEntity(taskKey);
    if (task && task.window) {
      if (override.windowStart) {
        task.window.startW = CTPDateTime.fromDateTime(override.windowStart);
      }
      if (override.windowEnd) {
        task.window.endW = CTPDateTime.fromDateTime(override.windowEnd);
      }
    }
  }
}
```

### 4.4 Window indicator on task table

Add a **Window** column to the task table (hidden by default, show at Detailed+ experience level). Displays the window as a compact date range:

```
Feb 16 06:00 – Feb 18 18:00
```

If the window has been overridden, show a modified indicator (dot or highlight).

### 4.5 Window on Gantt — infeasible tasks

For infeasible/unscheduled tasks that appear as chips in the unscheduled gutter, show a tooltip on hover that includes the window:

```
Rivera - Knee Replacement
Status: Infeasible
Window: Feb 16 06:00 – Feb 18 18:00
Error: No capacity on OR-01 within window
```

This tells the planner immediately whether widening the window might help.

### 4.6 Quick-extend buttons

In the task detail panel, next to the window End date, add quick-extend buttons:

```
End: Feb 18, 2026 18:00  [+1 day] [+3 days] [+1 week]  [Edit]
```

These are the most common actions — "give it one more day" to see if capacity opens up. Each button:
- Extends the window end by that amount
- Updates `windowOverrides`
- Marks stale

### 4.7 Clear window overrides

Same pattern as priority — cleared after solve:
```typescript
// After solve response received
setWindowOverrides({});
```

The applied windows are baked into the solve result.

### 4.8 Validation

- Window start must be before window end
- Window start cannot be before horizon start
- Window end cannot be after horizon end
- Show inline validation error if violated

### 4.9 Bulk window extend

When multiple infeasible tasks are selected, add an **"Extend Window"** button in the selection toolbar. Opens a dialog:

```
┌─────────────────────────────────────┐
│  Extend Window for 3 tasks          │
│                                     │
│  Extend end by:                     │
│  [+1 day] [+3 days] [+1 week]      │
│                                     │
│  Or set specific end:               │
│  ┌─────────────────────────────┐    │
│  │  [  Feb 21, 2026 18:00  ]  │    │
│  └─────────────────────────────┘    │
│                                     │
│  [Cancel]           [Apply]         │
└─────────────────────────────────────┘
```

This extends the window end for ALL selected tasks by the same amount (or to the same date). Start dates are left unchanged.

---

## Part 5: Solve Request — Complete Shape

The full solve request body now supports:

```typescript
POST /ctp/solve
{
  // Existing fields
  taskKeys?: string[],
  strategy?: string,
  taskUnschedules?: string[],
  taskPins?: Record<string, boolean>,
  taskExcludes?: string[],
  resourceModes?: Record<string, Record<string, string>>,
  materialModes?: Record<string, string>,
  resourcePreferenceOverrides?: Record<string, Record<string, string>>,

  // New in Sprint 5
  priorityOverrides?: Record<string, number>,
  windowOverrides?: Record<string, { windowStart?: string; windowEnd?: string }>,
}
```

---

## Verification

### Engine
1. Default priority is 50 for tasks without explicit priority
2. Healthcare URGENT cases get priority 10 from hydration
3. `priorityOverrides` in solve request changes task priority before solving
4. Tasks are solved in priority order (Rush first)
5. Solve response includes `priority`, `originalPriority`, `isRush` per task
6. Sync resets all priorities to original config values

### UI — Inline Editing
7. Priority column visible in task table with correct display (🔥 RUSH / HIGH / NORMAL / LOW)
8. Click priority cell → editable input appears
9. Type new value, press Enter → priority updates, stale banner appears
10. Value persists across tab switches until solve

### UI — Rush
11. Select 3 tasks → 🔥 Rush button in toolbar
12. Click Rush → all 3 show 🔥 RUSH badge, stale banner shows "3 tasks set to Rush"
13. Solve → Rush tasks scheduled first (check timestamps — they should have earlier start times)

### UI — Bulk Set Priority
14. Select 4 tasks → "Set Priority" button in toolbar
15. Dialog opens with number input and quick-set buttons
16. Click "High (20)" → input shows 20
17. Click Apply → all 4 tasks show HIGH priority, dialog closes
18. Click Cancel on a new dialog → no changes

### UI — Gantt
19. Right-click Gantt bar → "🔥 Rush" and "Set Priority..." in context menu
20. Click "🔥 Rush" → task gets Rush badge, stale banner appears

### UI — Filter
21. Priority filter dropdown shows Rush/High/Normal/Low options
22. Select "Rush" → only Rush tasks visible

### UI — Integration
23. 🔄 Sync → all priorities reset to defaults (Rush badges disappear for non-urgent tasks)
24. 🔄 Sync & Solve → clean solve with original priorities
25. Set some tasks to Rush → Solve → verify Rush tasks got earliest available slots
26. Modified priority indicator shows on tasks where priority ≠ originalPriority

### UI — Window Editing
27. Infeasible task detail panel shows Scheduling Window with Start/End and [Edit] buttons
28. Click [Edit] on End → date-time picker appears
29. Extend end by 2 days → stale banner appears, window override stored
30. Click [+1 day] quick-extend → end moves forward 1 day
31. Click [+1 week] → end moves forward 1 week
32. Solve → previously infeasible task now scheduled (if capacity exists in wider window)
33. After solve, window overrides cleared — task shows the override as its new window

### UI — Bulk Window Extend
34. Select 3 infeasible tasks → "Extend Window" button in toolbar
35. Dialog opens with quick-extend buttons and specific date input
36. Click "+3 days" → Apply → all 3 tasks get window extended by 3 days
37. Stale banner shows "3 task windows extended"

### UI — Validation
38. Try setting window end before window start → validation error shown, Apply disabled
39. Try setting window start before horizon start → validation error shown

### UI — Integration
40. 🔄 Sync → all windows reset to config defaults
41. Combine: Rush + Window Extend + Solve → Rush task with wider window gets best slot

Commit: "feat(sprint-5): reprioritize + window editing — priority column, Rush button, inline window editing, bulk extend"
