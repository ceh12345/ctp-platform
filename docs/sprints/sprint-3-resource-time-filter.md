# UI Sprint 3: Filter by Resource + Time Window

## Status: WAITING (blocked by Sprint 1)

## What the Planner Gets

Click a resource row on the Gantt to filter the task table to that resource. Click+drag on the time axis to set a time window. Combined: "Show me everything on CNC-01 between 2pm and 6pm." The filtered view feeds directly into selection (Sprint 1) for bulk actions.

## Why This Matters

The planner's most common question when something goes wrong is: "What's on this machine right now?" Today they have to manually scan the Gantt or scroll through the task table searching. This sprint makes the Gantt the entry point for investigation — click a resource, see its tasks, act on them.

## User Flow — Machine Breakdown

1. Machine CNC-01 breaks down at 2pm
2. Planner clicks CNC-01's resource label on the Gantt
3. Task table filters to show only tasks assigned to CNC-01
4. Filter chip appears: `Resource: CNC-01 ✕`
5. Planner adds time filter: "After 2pm today" (from filter bar or Gantt drag)
6. Second chip: `After: Feb 21 2:00 PM ✕`
7. Now seeing only the 4 tasks on CNC-01 from 2pm onward
8. Select all → Unschedule 4 → Solve (or Redirect to Machine B via Sprint 4)

## UI Changes

### Gantt Resource Click

Clicking a resource name label on the Gantt sets a filter:

```tsx
// In GanttChart, on the resource label
<div onClick={() => onResourceFilter?.(resource.resourceKey)}
  style={{ cursor: 'pointer', /* existing label styles */ }}>
  {resource.resourceName}
</div>
```

In the parent (ScheduleTab), this sets a filter state that's shared with TaskTable:

```tsx
const [resourceFilter, setResourceFilter] = useState<string | null>(null);
const [timeFilter, setTimeFilter] = useState<{ after?: string; before?: string }>({});
```

### Gantt Time Range Selection

Click+drag on the time axis background to select a time range:

```tsx
// In GanttChart — drag to select time range
const [dragStart, setDragStart] = useState<number | null>(null);
const [dragEnd, setDragEnd] = useState<number | null>(null);

// On mousedown on the time axis area
onMouseDown={(e) => {
  const time = pixelToTime(e.clientX - ganttLeft);
  setDragStart(time);
}}

// On mousemove (while dragging)
onMouseMove={(e) => {
  if (dragStart !== null) {
    setDragEnd(pixelToTime(e.clientX - ganttLeft));
  }
}}

// On mouseup — set the filter
onMouseUp={() => {
  if (dragStart && dragEnd) {
    onTimeFilter?.({
      after: new Date(Math.min(dragStart, dragEnd)).toISOString(),
      before: new Date(Math.max(dragStart, dragEnd)).toISOString(),
    });
  }
  setDragStart(null);
  setDragEnd(null);
}}

// Visual: semi-transparent overlay during drag
{dragStart !== null && dragEnd !== null && (
  <div style={{
    position: 'absolute',
    left: Math.min(timeToPixel(dragStart), timeToPixel(dragEnd)),
    width: Math.abs(timeToPixel(dragEnd) - timeToPixel(dragStart)),
    top: 0, bottom: 0,
    background: `${C.accent}15`, border: `1px dashed ${C.accent}44`,
    pointerEvents: 'none',
  }} />
)}
```

### Filter Chips

Display active filters as dismissible chips above the task table:

```tsx
<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
  {resourceFilter && (
    <FilterChip
      label={`Resource: ${resources.find(r => r.resourceKey === resourceFilter)?.resourceName || resourceFilter}`}
      onClear={() => setResourceFilter(null)}
    />
  )}
  {timeFilter.after && (
    <FilterChip
      label={`After: ${fmtDate(timeFilter.after)}`}
      onClear={() => setTimeFilter(prev => ({ ...prev, after: undefined }))}
    />
  )}
  {timeFilter.before && (
    <FilterChip
      label={`Before: ${fmtDate(timeFilter.before)}`}
      onClear={() => setTimeFilter(prev => ({ ...prev, before: undefined }))}
    />
  )}
  {(resourceFilter || timeFilter.after || timeFilter.before) && (
    <button onClick={() => { setResourceFilter(null); setTimeFilter({}); }}
      style={{ fontSize: 11, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>
      Clear all
    </button>
  )}
</div>
```

```tsx
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 10px', borderRadius: 12, fontSize: 12, fontFamily: FONT,
      background: C.surface2, border: `1px solid ${C.border}`, color: C.text,
    }}>
      {label}
      <span onClick={onClear} style={{ cursor: 'pointer', color: C.textMuted, fontWeight: 700 }}>✕</span>
    </span>
  );
}
```

### Task Table Filtering

Apply the resource and time filters to the task table rows:

```tsx
let rows = tasks;

// Existing filters (status, search, etc.) apply first
// ...

// Resource filter
if (resourceFilter) {
  rows = rows.filter((t: any) =>
    t.assignedResources?.some((r: any) => r.resourceKey === resourceFilter)
  );
}

// Time filter
if (timeFilter.after) {
  const afterTime = new Date(timeFilter.after).getTime();
  rows = rows.filter((t: any) => {
    if (!t.scheduledEnd) return true; // show unscheduled tasks
    return new Date(t.scheduledEnd).getTime() > afterTime;
  });
}
if (timeFilter.before) {
  const beforeTime = new Date(timeFilter.before).getTime();
  rows = rows.filter((t: any) => {
    if (!t.scheduledStart) return true; // show unscheduled tasks
    return new Date(t.scheduledStart).getTime() < beforeTime;
  });
}
```

### Quick Time Presets

Add time preset buttons to the task table filter bar:

```tsx
<div style={{ display: 'flex', gap: 4, fontSize: 11 }}>
  <button onClick={() => setTimeFilter({ after: new Date().toISOString() })}
    style={presetStyle}>Now →</button>
  <button onClick={() => setTimeFilter({
    after: new Date().toISOString(),
    before: new Date(Date.now() + 4 * 3600_000).toISOString()
  })} style={presetStyle}>Next 4h</button>
  <button onClick={() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    setTimeFilter({ after: today.toISOString(), before: tomorrow.toISOString() });
  }} style={presetStyle}>Today</button>
  <button onClick={() => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0,0,0,0);
    const dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);
    setTimeFilter({ after: tomorrow.toISOString(), before: dayAfter.toISOString() });
  }} style={presetStyle}>Tomorrow</button>
</div>
```

### Gantt Highlight

When a resource filter is active, highlight the filtered resource row on the Gantt:

```tsx
// Resource row background
style={{
  ...(resourceFilter === resource.resourceKey && {
    background: `${C.accent}08`,
    borderLeft: `3px solid ${C.accent}`,
  }),
}}
```

### Unscheduled Panel Filter

The UnscheduledPanel (Sprint 1) also respects the resource filter — but shows tasks that WERE on that resource or COULD go on that resource:

```tsx
// In UnscheduledPanel, when resourceFilter is active
const filtered = unscheduled.filter(t => {
  if (!resourceFilter) return true;
  // Show if task's resource preferences include the filtered resource
  return t.assignedResources?.some(r => r.resourceKey === resourceFilter || r.requestedResource === resourceFilter);
});
```

## Cross-Tab Filter Persistence

The filter set on the Gantt tab should persist when switching to the Task List sub-tab within the Schedule tab. Both views share the same `resourceFilter` and `timeFilter` state.

Switching to a different top-level tab (Orders, Resources, etc.) does NOT clear the filter — it persists for when they come back.

## Edge Cases

- **Click resource with existing filter:** Replace, don't stack (one resource at a time)
- **Drag on Gantt with no tasks visible:** Still set the time filter
- **Unscheduled tasks:** Show in filtered view (they have resource preferences even if not assigned)
- **Resource filter + status filter:** Both apply (AND logic)
- **Clear filter:** Click ✕ on chip, or "Clear all" link

## Test Plan

1. Click resource label on Gantt → task table filters to that resource
2. Filter chip appears with resource name and ✕
3. Click ✕ → filter clears
4. Drag on Gantt time axis → time filter set, chips appear
5. Time presets (Now, Next 4h, Today, Tomorrow) set correct filters
6. Combined resource + time → only matching tasks shown
7. Select all (header checkbox) → selects only filtered rows
8. Switch from Gantt to Task List sub-tab → filter persists
9. Unscheduled panel respects resource filter
10. Gantt highlights filtered resource row

## Depends On

- Sprint 1: Select & Act (selection on filtered results)
