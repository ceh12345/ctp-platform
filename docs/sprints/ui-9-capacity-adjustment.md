# UI Sprint 9: Capacity Adjustment

## Status: WAITING (blocked by Sprint 3)

## What the Planner Gets

Temporarily modify resource availability — add overtime, reduce speed, block a time window for maintenance. Changes are local overrides that apply on next solve.

## Why This Matters

"Machine C is running slow today." "We're adding Saturday overtime." "Maintenance needs CNC-01 from 10am to 12pm tomorrow." These are the daily realities the planner deals with. Today they can't tell the solver about them — the solver uses the original calendar data regardless.

## User Flows

### Add Overtime
1. Planner clicks on a resource row → resource detail panel opens
2. Clicks "Add Availability"
3. Dialog: Saturday Feb 22, 6:00 AM – 2:00 PM, Capacity: 1
4. Apply → green overlay on Gantt showing added capacity
5. Solve → solver can now schedule tasks into Saturday

### Block for Maintenance
1. Planner clicks "Block Time" on CNC-01
2. Dialog: Tuesday Feb 25, 10:00 AM – 12:00 PM, Reason: Preventive Maintenance
3. Apply → red overlay on Gantt showing blocked time
4. Solve → solver avoids that window, may move affected tasks

### Reduce Speed
1. Planner clicks CNC-02 → "Speed Factor: 80%"
2. Apply → tasks on CNC-02 have longer effective durations
3. Solve → solver accounts for slower processing

## UI Changes

### Resource Detail Panel — Capacity Section

Add to the existing resource detail/slide panel:

```tsx
<div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
    Capacity Adjustments
  </div>
  
  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
    <button onClick={() => setShowAddAvail(true)} style={smallBtnStyle}>
      + Add Availability
    </button>
    <button onClick={() => setShowBlockTime(true)} style={smallBtnStyle}>
      🚫 Block Time
    </button>
    <button onClick={() => setShowSpeedFactor(true)} style={smallBtnStyle}>
      ⚡ Speed Factor
    </button>
  </div>
  
  {/* List current adjustments */}
  {adjustments.filter(a => a.resourceKey === resource.resourceKey).map(adj => (
    <div key={adj.id} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      borderRadius: 6, background: adj.type === 'add' ? `${C.green}10` : `${C.red}10`,
      border: `1px solid ${adj.type === 'add' ? C.green + '33' : C.red + '33'}`,
      marginBottom: 4, fontSize: 12,
    }}>
      <span>{adj.type === 'add' ? '➕' : adj.type === 'block' ? '🚫' : '⚡'}</span>
      <span style={{ flex: 1 }}>
        {adj.type === 'speed' 
          ? `Speed: ${adj.speedFactor * 100}%`
          : `${fmtDate(adj.start)} – ${fmtDate(adj.end)}`}
      </span>
      {adj.reason && <span style={{ color: C.textDim }}>{adj.reason}</span>}
      <button onClick={() => removeAdjustment(adj.id)}
        style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer' }}>✕</button>
    </div>
  ))}
</div>
```

### Add Availability Dialog

```
┌──────────────────────────────────────┐
│ Add Availability — CNC-01            │
│                                      │
│ Date:    [Feb 22, 2026      ▾]      │
│ Start:   [06:00 AM          ▾]      │
│ End:     [02:00 PM          ▾]      │
│ Capacity: [1    ]                    │
│ Reason:  [Saturday overtime   ]      │
│                                      │
│             [Cancel]  [Add]          │
└──────────────────────────────────────┘
```

### Block Time Dialog

```
┌──────────────────────────────────────┐
│ Block Time — CNC-01                  │
│                                      │
│ Date:    [Feb 25, 2026      ▾]      │
│ Start:   [10:00 AM          ▾]      │
│ End:     [12:00 PM          ▾]      │
│ Reason:  [Preventive maint.   ]     │
│                                      │
│             [Cancel]  [Block]        │
└──────────────────────────────────────┘
```

### Speed Factor Dialog

```
┌──────────────────────────────────────┐
│ Speed Factor — CNC-02                │
│                                      │
│ Speed:   [80] %                      │
│                                      │
│ Effective: tasks take 25% longer     │
│                                      │
│ Date range (optional):               │
│ From:    [Feb 21, 2026      ▾]      │
│ To:      [Feb 22, 2026      ▾]      │
│                                      │
│             [Cancel]  [Apply]        │
└──────────────────────────────────────┘
```

### Override State

```tsx
interface CapacityAdjustment {
  id: string;             // unique ID for removal
  resourceKey: string;
  type: 'add' | 'block' | 'speed';
  start?: string;         // ISO datetime
  end?: string;           // ISO datetime
  capacity?: number;      // for 'add'
  speedFactor?: number;   // for 'speed' (0.0 - 1.0)
  reason?: string;
}

const [capacityAdjustments, setCapacityAdjustments] = useState<CapacityAdjustment[]>([]);
```

### Gantt Overlays

Show adjustments visually on the Gantt:

```tsx
// Added availability — green zone
{adj.type === 'add' && (
  <div style={{
    position: 'absolute',
    left: timeToPixel(new Date(adj.start).getTime()),
    width: timeToPixel(new Date(adj.end).getTime()) - timeToPixel(new Date(adj.start).getTime()),
    top: rowY, height: rowHeight,
    background: `${C.green}15`, border: `1px dashed ${C.green}66`,
    borderRadius: 4, pointerEvents: 'none',
  }}>
    <span style={{ fontSize: 9, color: C.green, padding: 2 }}>+ OT</span>
  </div>
)}

// Blocked time — red zone
{adj.type === 'block' && (
  <div style={{
    position: 'absolute',
    left: timeToPixel(new Date(adj.start).getTime()),
    width: timeToPixel(new Date(adj.end).getTime()) - timeToPixel(new Date(adj.start).getTime()),
    top: rowY, height: rowHeight,
    background: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${C.red}15 4px, ${C.red}15 8px)`,
    border: `1px solid ${C.red}44`, borderRadius: 4, pointerEvents: 'none',
  }}>
    <span style={{ fontSize: 9, color: C.red, padding: 2 }}>🚫 {adj.reason || 'Blocked'}</span>
  </div>
)}

// Speed factor — subtle badge on resource label
{speedAdjustments[resource.resourceKey] && (
  <span style={{ fontSize: 10, color: C.yellow, marginLeft: 4 }}>
    ⚡{speedAdjustments[resource.resourceKey] * 100}%
  </span>
)}
```

### Pass to Solve

```tsx
const request = {
  ...existingOverrides,
  capacityAdjustments: capacityAdjustments.map(adj => ({
    resourceKey: adj.resourceKey,
    type: adj.type,
    start: adj.start,
    end: adj.end,
    capacity: adj.capacity,
    speedFactor: adj.speedFactor,
  })),
};
```

### Clear After Solve

Capacity adjustments are NOT cleared after solve — they represent physical reality (overtime is real, maintenance is real). They persist until manually removed.

```tsx
// After solve: clear task-level overrides but KEEP capacity adjustments
setTaskUnschedules(new Set());
setTaskPins({});
// setCapacityAdjustments — NOT cleared
```

## API Requirements

Need new field in solve request:

```typescript
interface CapacityAdjustmentDto {
  resourceKey: string;
  type: 'add' | 'block' | 'speed';
  start?: string;       // ISO datetime
  end?: string;         // ISO datetime  
  capacity?: number;
  speedFactor?: number;
}
```

Engine needs to:
- `add`: Insert additional availability intervals into the resource's available matrix
- `block`: Remove availability in the blocked window (like adding an assignment)
- `speed`: Modify the resource's run rate / speed factor, affecting effective duration

The engine already has concepts for all of these (CTPAvailable, CTPAssignments, runRate). The API layer needs to translate the DTO into engine operations before solving.

## Edge Cases

- **Overlapping block and add:** Block takes priority (can't add availability in a blocked window)
- **Block over existing scheduled task:** Task becomes infeasible — show warning
- **Speed factor 0%:** Invalid — clamp to minimum 10%
- **Speed factor > 100%:** Allowed (machine running faster than baseline)
- **Multiple adjustments on same resource:** All apply (stacked)
- **Remove adjustment after solve:** Marks stale, next solve uses original availability

## Test Plan

1. Click resource → "Add Availability" → dialog → green overlay on Gantt
2. "Block Time" → red striped overlay on Gantt
3. "Speed Factor" → badge on resource label
4. Solve → solver respects adjustments
5. Blocked window: tasks that were there become infeasible
6. Added window: solver can schedule into overtime
7. Speed factor: task durations effectively longer
8. Remove adjustment → overlay removed, marked stale
9. Adjustments persist after solve (not cleared)
10. Multiple adjustments on same resource stack correctly

## Depends On

- Sprint 3: Resource interaction (clicking resources to see details)
- API: Capacity adjustment DTO in solve request
- Engine: Runtime availability modifications (may need engine work)
