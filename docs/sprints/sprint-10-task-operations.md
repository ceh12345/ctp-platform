# UI Sprint 10: Task Operations (Split, Rerun, Duration Edit)

## Status: WAITING (blocked by Sprint 1, Sprint 5)

## What the Planner Gets

Modify task characteristics before re-solving: edit duration, split a task across breaks, or create a rerun of a failed task.

## Why This Matters

"This task will actually take 6 hours, not the 4 hours the system says." "This 8-hour task can't run in one stretch — split it across two shifts." "Quality check failed — we need to rerun this task." These are daily realities that require the planner to modify task data, not just scheduling decisions.

## Feature 1: Edit Duration

### User Flow
1. Planner clicks a task → detail panel opens
2. Duration field shows "4h 00m" with a pencil icon
3. Clicks → edit mode → types "6h 00m" or "360" (minutes)
4. Enter → override stored, "was 4h" shown
5. Solve → task scheduled with new duration

### UI

In task detail panel:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <span style={{ color: C.textDim, fontSize: 12 }}>Duration:</span>
  {editingDuration ? (
    <input type="text" defaultValue={formatDurationInput(currentDuration)}
      autoFocus
      onBlur={(e) => {
        const newDuration = parseDurationInput(e.target.value);
        if (newDuration > 0) {
          setDurationOverrides(prev => ({ ...prev, [task.key]: newDuration }));
          setSolveStale(true);
        }
        setEditingDuration(false);
      }}
      style={{ width: 80, fontSize: 12, padding: '2px 6px', borderRadius: 4,
        border: `1px solid ${C.accent}`, background: C.surface, color: C.text }}
    />
  ) : (
    <span onClick={() => setEditingDuration(true)} style={{ cursor: 'pointer' }}>
      <span style={{
        ...(durationOverrides[task.key] && { color: C.accent, fontWeight: 700 }),
      }}>
        {fmtDuration(durationOverrides[task.key] ?? task.durationSeconds)}
      </span>
      {durationOverrides[task.key] && (
        <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>
          (was {fmtDuration(task.durationSeconds)})
        </span>
      )}
      <span style={{ marginLeft: 4, color: C.textDim, fontSize: 11 }}>✏️</span>
    </span>
  )}
</div>
```

### Duration Parser

Accept multiple formats:

```tsx
function parseDurationInput(input: string): number {
  // "6h 30m" → 23400 seconds
  // "6.5h" → 23400 seconds
  // "390m" → 23400 seconds
  // "390" → 23400 seconds (assume minutes)
  // "6:30" → 23400 seconds
  
  input = input.trim().toLowerCase();
  
  // h/m format: "6h 30m" or "6h30m"
  const hmMatch = input.match(/(\d+\.?\d*)\s*h\s*(?:(\d+)\s*m)?/);
  if (hmMatch) {
    return (parseFloat(hmMatch[1]) * 3600) + (parseInt(hmMatch[2] || '0') * 60);
  }
  
  // minutes: "390m"
  const mMatch = input.match(/^(\d+\.?\d*)\s*m$/);
  if (mMatch) return parseFloat(mMatch[1]) * 60;
  
  // HH:MM format: "6:30"
  const colonMatch = input.match(/^(\d+):(\d+)$/);
  if (colonMatch) return parseInt(colonMatch[1]) * 3600 + parseInt(colonMatch[2]) * 60;
  
  // Plain number: assume minutes
  const num = parseFloat(input);
  if (!isNaN(num)) return num * 60;
  
  return -1; // invalid
}
```

### Override State

```tsx
const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
```

### Pass to Solve

```tsx
const request = {
  ...existingOverrides,
  durationOverrides, // taskKey → seconds
};
```

---

## Feature 2: Split Task

### User Flow
1. Planner clicks task "Mixing-ORD-007-1" (8 hours)
2. In detail panel, clicks "Split Task"
3. Dialog:
   ```
   Split "Mixing-ORD-007-1" (8h)
   
   Part 1: [4h 00m]  ← first half
   Part 2: [4h 00m]  ← second half
   
   Gap between parts: [minimum ▾]
   (Solver will find best placement for each part)
   ```
4. Confirm → original task replaced by two linked tasks
5. Solve → solver places each part, possibly across shift break

### Implementation Approach

Split is complex because it creates new tasks. Two approaches:

**Option A: Client-side split (override)**
- Don't create real tasks in the engine
- Send split configuration to solve request
- Engine handles split internally during solve
- Pro: no task mutation before solve
- Con: engine needs split support

**Option B: API-based split (create tasks)**
- `POST /ctp/tasks/:taskKey/split` → creates two tasks, links them
- Original task deleted or marked as parent
- Two new tasks appear in the landscape
- Pro: clean data model
- Con: requires API endpoint and landscape mutation

Recommend Option B for correctness, but defer to engine team on feasibility.

### Split Dialog

```
┌──────────────────────────────────────┐
│ Split Task — Mixing-ORD-007-1        │
│ Total duration: 8h 00m               │
│                                      │
│ Part 1 duration: [4h 00m    ]       │
│ Part 2 duration: [4h 00m    ] (auto) │
│                                      │
│ Minimum gap:     [0h 00m    ]       │
│ Maximum gap:     [8h 00m    ]       │
│                                      │
│ ℹ The solver will schedule each     │
│   part independently. They will      │
│   maintain the same resource and     │
│   order assignment.                  │
│                                      │
│              [Cancel]  [Split]       │
└──────────────────────────────────────┘
```

---

## Feature 3: Add Rerun

### User Flow
1. Quality check failed on "Mixing-ORD-007-1"
2. Planner clicks task → "Add Rerun"
3. Dialog:
   ```
   Rerun "Mixing-ORD-007-1"
   
   Duration: [4h 00m] (same as original)
   Must start after original ends: [✓]
   Reason: [Quality failure    ]
   ```
4. Confirm → new task created as copy, linked to original
5. Solve → rerun task gets scheduled after original

### Implementation

Rerun creates a new task:
- Same resource requirements as original
- Same duration (editable)
- Linked to original via linkId (predecessor relationship)
- Default: must start after original ends
- Appears in the unscheduled panel until solved

Like split, this requires API support for task creation:
`POST /ctp/tasks/:taskKey/rerun`

---

## Override State Summary

```tsx
// Duration edits (cleared after solve)
const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});

// Splits and reruns are persisted via API — not local overrides
// They create real tasks in the landscape
```

## Visual Indicators

### Duration Override
```tsx
// In task table, duration column
{durationOverrides[tk.key] && (
  <span style={{ color: C.accent, fontWeight: 700 }}>
    {fmtDuration(durationOverrides[tk.key])}
    <span style={{ fontSize: 10, color: C.textDim, marginLeft: 4 }}>
      (was {fmtDuration(tk.durationSeconds)})
    </span>
  </span>
)}
```

### Split Task
```tsx
// Split tasks show link indicator
{tk.splitParent && (
  <span style={{ fontSize: 10, color: C.accent, marginLeft: 4 }}>
    Part {tk.splitIndex} of {tk.splitTotal}
  </span>
)}
```

### Rerun Task
```tsx
{tk.isRerun && (
  <span style={{ fontSize: 10, color: C.yellow, marginLeft: 4 }}>↻ RERUN</span>
)}
```

## API Requirements

### Duration Override
Add to solve request: `durationOverrides: Record<string, number>` (taskKey → seconds)
Engine applies overrides to task durations before solving.

### Split Task
New endpoint: `POST /ctp/tasks/:taskKey/split`
```typescript
interface SplitRequest {
  part1Duration: number;  // seconds
  part2Duration: number;  // seconds
  minGap?: number;        // seconds
  maxGap?: number;        // seconds
}
```
Returns two new task objects. Original task removed from solve set.

### Add Rerun
New endpoint: `POST /ctp/tasks/:taskKey/rerun`
```typescript
interface RerunRequest {
  duration?: number;      // seconds, defaults to original
  mustStartAfterOriginal: boolean;
  reason?: string;
}
```
Returns new task object linked to original.

## Edge Cases

- **Duration override to 0:** Invalid — minimum 1 minute
- **Split into unequal parts:** Allowed — planner decides the split ratio
- **Split a split:** Allowed (split Part 1 into Part 1a and 1b)
- **Rerun of a rerun:** Allowed — chain of reruns
- **Cancel rerun before solve:** Delete the created task via API
- **Split + duration override:** Override applies to the original before split

## Test Plan

1. Click duration → edit → enter new value → override shown with "was X"
2. Multiple duration formats accepted (6h30m, 390m, 6:30, 390)
3. Duration override clears after solve
4. Split task → dialog → two tasks created
5. Split tasks show "Part 1 of 2" badge
6. Split tasks scheduled independently by solver
7. Rerun → new task appears in unscheduled panel
8. Rerun linked to original (predecessor)
9. Solver schedules rerun after original

## Depends On

- Sprint 1: Select & Act (detail panel interaction)
- Sprint 5: Reprioritize (inline editing pattern)
- API: Duration override in solve request
- API: Split and rerun endpoints (new)
- Engine: Support for runtime task mutation (split creates tasks, rerun creates tasks)
