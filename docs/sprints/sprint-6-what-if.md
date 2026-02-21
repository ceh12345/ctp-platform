# UI Sprint 6: What-If Mode

## Status: WAITING (blocked by Sprints 1-5, Solver Prompt 2: Snapshot/Restore)

## What the Planner Gets

A "What-If" toggle that snapshots the current schedule, lets them make changes and solve, then shows a before/after comparison with the option to commit or revert.

## Why This Matters

Today every solve is permanent. The planner is afraid to experiment because there's no undo. "What happens if I exclude Order-009?" is a question they can't safely answer. What-If mode makes the schedule a sandbox — explore freely, decide later.

This is the most transformative capability in the roadmap. It changes the planner's relationship with the solver from "command and hope" to "explore and decide."

## User Flow — Scenario Exploration

1. Schedule is stable. 18/20 tasks scheduled, 85% utilization.
2. Planner clicks "🔬 What-If" button in the toolbar
3. UI enters What-If mode:
   - Amber border around the workspace
   - Banner: "What-If Mode — changes are temporary"
   - Snapshot saved automatically
4. Planner excludes Order-009 (4 tasks) → solves
5. Result: 14/16 tasks scheduled, utilization drops, but Order-007 gets better slots
6. Comparison panel shows:
   ```
   BEFORE          →  AFTER
   18 scheduled       14 scheduled (-4)
   85% utilization    72% utilization (-13%)
   Order-007: late    Order-007: on-time ✓
   
   Tasks moved: 3
   Tasks gained: 0
   Tasks lost: 4 (excluded)
   ```
7. Planner decides: this is better. Clicks "✓ Commit"
8. Or: this is worse. Clicks "↩ Revert" → schedule restores to snapshot

## UI Changes

### What-If Toggle

Add to the main toolbar (near the Solve button):

```tsx
const [whatIfMode, setWhatIfMode] = useState(false);
const [whatIfSnapshot, setWhatIfSnapshot] = useState<any>(null);

<button onClick={() => {
  if (whatIfMode) {
    // Exiting — ask commit or revert
    setShowWhatIfDialog(true);
  } else {
    // Entering — save snapshot
    setWhatIfSnapshot(structuredClone(result));
    setWhatIfMode(true);
  }
}} style={{
  padding: '8px 16px', borderRadius: 8, fontFamily: FONT,
  background: whatIfMode ? C.yellow : C.surface2,
  color: whatIfMode ? C.bg : C.text,
  border: `1px solid ${whatIfMode ? C.yellow : C.border}`,
  fontWeight: 600, fontSize: 13, cursor: 'pointer',
}}>
  {whatIfMode ? '🔬 Exit What-If' : '🔬 What-If'}
</button>
```

### What-If Banner

When in What-If mode, show a persistent banner:

```tsx
{whatIfMode && (
  <div style={{
    padding: '10px 16px', background: `${C.yellow}15`,
    border: `1px solid ${C.yellow}44`, borderRadius: 8, marginBottom: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontFamily: FONT,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 16 }}>🔬</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.yellow }}>
        What-If Mode
      </span>
      <span style={{ fontSize: 12, color: C.textDim }}>
        Changes are temporary. Commit or revert when done.
      </span>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={handleWhatIfRevert} style={{
        padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
        background: 'none', border: `1px solid ${C.border}`, color: C.text,
        cursor: 'pointer', fontFamily: FONT,
      }}>
        ↩ Revert
      </button>
      <button onClick={handleWhatIfCommit} style={{
        padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
        background: C.green, border: 'none', color: '#fff',
        cursor: 'pointer', fontFamily: FONT,
      }}>
        ✓ Commit
      </button>
    </div>
  </div>
)}
```

### Workspace Visual Indicator

Subtle amber tint to the entire workspace border so the planner never forgets they're in What-If:

```tsx
<div style={{
  ...(whatIfMode && {
    border: `2px solid ${C.yellow}44`,
    borderRadius: 12,
  }),
}}>
```

### Commit / Revert Handlers

```tsx
const handleWhatIfCommit = () => {
  // Current state IS the committed state — just exit what-if
  setWhatIfMode(false);
  setWhatIfSnapshot(null);
  // Note: the solve results are already in place from the what-if solve
};

const handleWhatIfRevert = () => {
  // Restore the snapshot
  setResult(whatIfSnapshot);
  setWhatIfMode(false);
  setWhatIfSnapshot(null);
  // Clear any pending overrides
  setTaskUnschedules(new Set());
  setTaskPins({});
  setTaskExcludes({});
  setOrderModes({});
  setResourceModeOverrides({});
  setPriorityOverrides({});
  setSolveStale(false);
};
```

### Comparison Panel

When in What-If mode AND a solve has been done, show a comparison:

```tsx
function WhatIfComparison({ before, after }: { before: any; after: any }) {
  const beforeScheduled = before.tasks.filter((t: any) => t.feasible).length;
  const afterScheduled = after.tasks.filter((t: any) => t.feasible).length;
  
  // Find tasks that moved
  const moved = after.tasks.filter((t: any) => {
    const b = before.tasks.find((bt: any) => bt.key === t.key);
    if (!b) return false;
    return b.scheduledStart !== t.scheduledStart || b.scheduledEnd !== t.scheduledEnd;
  });
  
  // Tasks that became feasible
  const gained = after.tasks.filter((t: any) => {
    const b = before.tasks.find((bt: any) => bt.key === t.key);
    return t.feasible && b && !b.feasible;
  });
  
  // Tasks that became infeasible
  const lost = after.tasks.filter((t: any) => {
    const b = before.tasks.find((bt: any) => bt.key === t.key);
    return !t.feasible && b && b.feasible;
  });

  const delta = (val: number, better: 'higher' | 'lower' = 'higher') => {
    if (val === 0) return <span style={{ color: C.textDim }}>—</span>;
    const isGood = better === 'higher' ? val > 0 : val < 0;
    return <span style={{ color: isGood ? C.green : C.red }}>
      {val > 0 ? '+' : ''}{val}
    </span>;
  };

  return (
    <div style={{
      padding: 16, borderRadius: 8, background: C.surface,
      border: `1px solid ${C.yellow}44`, marginBottom: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.yellow, marginBottom: 12 }}>
        What-If Impact
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px 16px', fontSize: 12 }}>
        <div style={{ color: C.textDim, fontWeight: 600 }}>BEFORE</div>
        <div />
        <div style={{ color: C.textDim, fontWeight: 600 }}>AFTER</div>
        
        <div>{beforeScheduled} scheduled</div>
        <div>{delta(afterScheduled - beforeScheduled)}</div>
        <div>{afterScheduled} scheduled</div>
        
        <div>{before.summary.feasibilityRate}%</div>
        <div>{delta(after.summary.feasibilityRate - before.summary.feasibilityRate)}</div>
        <div>{after.summary.feasibilityRate}%</div>
      </div>

      {moved.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.textMuted }}>
          {moved.length} tasks moved position
        </div>
      )}
      {gained.length > 0 && (
        <div style={{ fontSize: 12, color: C.green }}>
          +{gained.length} tasks became feasible: {gained.map(t => t.name).join(', ')}
        </div>
      )}
      {lost.length > 0 && (
        <div style={{ fontSize: 12, color: C.red }}>
          -{lost.length} tasks became infeasible: {lost.map(t => t.name).join(', ')}
        </div>
      )}
    </div>
  );
}
```

### Gantt Ghost Bars (Optional Enhancement)

Show the "before" position as ghost (semi-transparent, dashed outline) bars on the Gantt alongside the current position. This lets the planner visually see what moved:

```tsx
// For each task that moved, render a ghost bar at the old position
{whatIfMode && whatIfSnapshot && (
  (() => {
    const beforeTask = whatIfSnapshot.tasks.find(t => t.key === task.key);
    if (!beforeTask || beforeTask.scheduledStart === task.scheduledStart) return null;
    return (
      <div style={{
        position: 'absolute',
        left: timeToPixel(new Date(beforeTask.scheduledStart).getTime()),
        width: timeToPixel(new Date(beforeTask.scheduledEnd).getTime()) - timeToPixel(new Date(beforeTask.scheduledStart).getTime()),
        top: rowY, height: barHeight,
        borderRadius: 4, border: `1px dashed ${C.textDim}`,
        background: `${C.textDim}10`,
        pointerEvents: 'none',
      }} />
    );
  })()
)}
```

## Server-Side Considerations

### Option A: Client-Side Snapshot (Simpler)

The snapshot is just `structuredClone(result)` — a deep copy of the solve results in the browser. Revert restores this copy. The server state may be out of sync after a what-if solve, so revert also needs to re-sync:

```tsx
const handleWhatIfRevert = async () => {
  setResult(whatIfSnapshot);
  setWhatIfMode(false);
  setWhatIfSnapshot(null);
  // Also tell server to restore — re-sync from config
  await fetch(`${API}/ctp/solve-and-sync`, { method: 'POST' });
};
```

### Option B: Server-Side Snapshot (More Robust)

Uses the engine's Snapshot/Restore from Solver Prompt 2:
- `POST /ctp/snapshot` → server saves landscape state
- What-if solves modify server state
- `POST /ctp/restore` → server reverts to snapshot
- This ensures server and client are always consistent

Option B is better but depends on Solver Prompt 2. Option A works as an interim.

## Edge Cases

- **Solve while in What-If:** Normal solve behavior, but results compared to snapshot
- **Multiple solves in What-If:** Each new solve updates the "after" comparison
- **Browser refresh in What-If:** Snapshot lost. Warn before closing tab.
- **WhereTo/MoveTo in What-If:** Should work normally — immediate actions still apply
- **Stale data warning:** If another user modifies the schedule while in What-If, show warning

## Test Plan

1. Click "What-If" → amber border, banner appears, snapshot saved
2. Make changes (exclude, unschedule) and solve
3. Comparison panel shows before/after delta
4. "Revert" → schedule returns to snapshot state
5. "Commit" → current state becomes permanent
6. Ghost bars show previous positions on Gantt
7. What-If badge visible at all times while active
8. Multiple solves in What-If → comparison updates
9. All overrides clear on revert
10. Warning if trying to close tab while in What-If

## Depends On

- Sprints 1-5: All action capabilities (what's the point of What-If without actions?)
- Solver Prompt 2: Snapshot/Restore (for server-side consistency, Option B)
- Works with client-side snapshot (Option A) as interim
