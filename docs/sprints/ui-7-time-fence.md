# UI Sprint 7: Time Fence

## Status: WAITING (blocked by Sprint 1)

## What the Planner Gets

A configurable freeze horizon. Everything starting within the fence is automatically pinned and cannot be moved by the solver. A visual line on the Gantt marks the boundary.

## Why This Matters

In production, tasks about to start or already in progress must not move. The planner needs a "hands off" zone that the solver respects automatically. Without this, every solve risks disrupting work that's already been staged, materialed, or started.

## User Flow

1. Planner sets time fence to 4 hours in settings
2. Vertical red line appears on Gantt at "now + 4 hours"
3. Tasks left of the line show a lock icon — frozen
4. Any solve automatically pins tasks inside the fence
5. Planner can still manually unpin a fenced task (with confirmation warning)

## UI Changes

### Time Fence Setting

Add to app settings or a toolbar control:

```tsx
const [timeFenceHours, setTimeFenceHours] = useState(4);

// In settings or toolbar
<div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
  <span style={{ color: C.textDim }}>🔒 Time Fence:</span>
  <select value={timeFenceHours} onChange={e => setTimeFenceHours(Number(e.target.value))}
    style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`,
      background: C.surface, color: C.text, fontSize: 12 }}>
    <option value={0}>Off</option>
    <option value={1}>1 hour</option>
    <option value={2}>2 hours</option>
    <option value={4}>4 hours</option>
    <option value={8}>8 hours (1 shift)</option>
    <option value={24}>24 hours</option>
    <option value={48}>48 hours</option>
  </select>
</div>
```

### Gantt Fence Line

Vertical line on the Gantt at the fence boundary:

```tsx
const fenceTime = new Date(Date.now() + timeFenceHours * 3600_000);
const fenceX = timeToPixel(fenceTime.getTime());

{timeFenceHours > 0 && fenceX > 0 && (
  <>
    {/* Frozen zone background */}
    <div style={{
      position: 'absolute', left: 0, width: fenceX,
      top: 0, bottom: 0,
      background: `${C.red}06`, pointerEvents: 'none',
    }} />
    {/* Fence line */}
    <div style={{
      position: 'absolute', left: fenceX, top: 0, bottom: 0,
      width: 2, background: C.red, opacity: 0.5, pointerEvents: 'none',
    }} />
    {/* Label */}
    <div style={{
      position: 'absolute', left: fenceX + 4, top: 4,
      fontSize: 10, color: C.red, fontWeight: 600, fontFamily: FONT,
      pointerEvents: 'none',
    }}>
      🔒 FENCE
    </div>
  </>
)}
```

### Auto-Pin on Solve

Before every solve, automatically pin tasks inside the fence:

```tsx
// In handleSolveConfirm, before building the request
if (timeFenceHours > 0) {
  const fenceTime = new Date(Date.now() + timeFenceHours * 3600_000).toISOString();
  const autoPins: Record<string, boolean> = { ...taskPins };
  
  tasks.forEach((t: any) => {
    if (t.feasible && t.scheduledStart && t.scheduledStart < fenceTime) {
      autoPins[t.key] = true;
    }
  });
  
  setTaskPins(autoPins);
}
```

### Lock Icon on Fenced Tasks

Tasks inside the fence get a lock badge on their Gantt bar:

```tsx
const isInsideFence = timeFenceHours > 0 &&
  task.scheduledStart &&
  new Date(task.scheduledStart) < fenceTime;

{isInsideFence && (
  <span style={{
    position: 'absolute', top: -6, left: -4, fontSize: 9,
  }}>🔒</span>
)}
```

### Override Warning

If the planner tries to unpin or unschedule a task inside the fence:

```
┌───────────────────────────────────────┐
│ ⚠ Task Inside Time Fence             │
│                                       │
│ "Mixing-ORD-007-1" starts within     │
│ the 4-hour time fence.               │
│                                       │
│ Moving this task may disrupt work     │
│ that is staged or in progress.        │
│                                       │
│         [Keep Locked]  [Override]     │
└───────────────────────────────────────┘
```

## Behavior Details

- Time fence is a rolling window — the line moves with the clock
- On initial load, tasks inside the fence are NOT auto-pinned (they preserve their existing state)
- Auto-pin happens only at solve time
- The fence applies to task START time (not end time) — a task that starts before the fence but ends after it is still fenced
- Time fence setting persists in localStorage (or app settings)

## Task Table Indicator

In the task table, fenced tasks show the lock in the status column:

```tsx
{isInsideFence && (
  <span style={{ fontSize: 10, color: C.red, fontWeight: 600, marginLeft: 4 }}>🔒 FENCED</span>
)}
```

## Edge Cases

- **Fence set to 0:** Feature disabled, no line, no auto-pin
- **All tasks inside fence:** Warning "All tasks are inside the time fence. Nothing to solve."
- **Task straddles fence (starts inside, ends outside):** Fenced — start time governs
- **Manual pin + fence overlap:** Both show. Manual pin is explicit, fence is automatic.
- **Change fence width:** Existing auto-pins from previous fence width don't clear automatically. Only new solves apply the new width.

## Test Plan

1. Set fence to 4 hours → red line appears on Gantt
2. Tasks left of line show lock icon
3. Solve → tasks inside fence auto-pinned
4. Try to unschedule fenced task → warning dialog
5. Override warning → task unscheduled despite fence
6. Set fence to 0 → line disappears, no auto-pin
7. Frozen zone background visible on Gantt
8. "FENCED" badge in task table status column
9. Fence line label visible

## Depends On

- Sprint 1: Select & Act (pin mechanism)
- No solver dependencies — uses existing pin infrastructure
