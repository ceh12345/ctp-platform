# WhereTo Ghost Bar Rendering — Start Window + Suggested Placement

## Context

When WhereTo returns options, each option has a feasible start window (earliest start to latest start) and a task duration. The ghost bar on the Gantt needs to show both the flexibility and the suggested placement.

Example: Setup task, 15 min duration, feasible start window 6:30–6:45, surgery follows at 7:00.
- The task CAN start anywhere from 6:30 to 6:45
- The BEST start is 6:45 (butts up against the surgery, no dead time)

## What to Render

For each WhereTo option on the Gantt, render two layers on the resource row:

### 1. Start Window (light background)

A subtle shaded region showing where the task is allowed to start:

```tsx
// Start window — light background showing flexibility
<div style={{
  position: 'absolute',
  left: timeToPixel(new Date(option.start).getTime()),
  width: timeToPixel(new Date(option.latestStart).getTime()) - timeToPixel(new Date(option.start).getTime()) + taskBarWidth,
  top: rowY,
  height: barHeight,
  borderRadius: 4,
  background: `${C.accent}08`,
  border: `1px dashed ${C.accent}22`,
  pointerEvents: 'none',
}} />
```

This spans from earliest start to latest end (latest start + duration).

### 2. Ghost Bar at Latest Start (solid suggestion)

The suggested placement at the latest start time — minimizes idle time before the next task:

```tsx
// Ghost bar — solid suggested placement at latest start
<div 
  onClick={() => onMoveTo(taskKey, { ...option, chosenStart: option.latestStart })}
  style={{
    position: 'absolute',
    left: timeToPixel(new Date(option.latestStart).getTime()),
    width: taskBarWidth,  // duration in pixels
    top: rowY,
    height: barHeight,
    borderRadius: 4,
    background: `${C.accent}25`,
    border: `2px solid ${C.accent}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 8px',
    transition: 'background 0.15s',
  }}
  onMouseEnter={e => (e.currentTarget.style.background = `${C.accent}40`)}
  onMouseLeave={e => (e.currentTarget.style.background = `${C.accent}25`)}
>
  <span style={{ fontSize: 10, fontWeight: 600, color: C.accent }}>
    {option.rank === 1 ? '★' : `#${option.rank}`} {fmtTime(option.latestStart)}
  </span>
  <span style={{ fontSize: 10, color: C.accent }}>
    Move Here
  </span>
</div>
```

### 3. Tooltip on Hover

When hovering the ghost bar, show the full detail:

```
Setup — Option #1
Start window: 6:30 AM – 6:45 AM
Suggested: 6:45 AM (latest, no idle time)
Duration: 15 min
End: 7:00 AM
Resources: OR-01, RN-01
Score: 0.85
```

## Computing taskBarWidth

```tsx
const durationMs = option.duration * 1000; // duration in seconds → ms
const taskBarWidth = timeToPixel(startMs + durationMs) - timeToPixel(startMs);
```

Or if `option.end` and `option.latestEnd` are available:
```tsx
const taskBarWidth = timeToPixel(new Date(option.latestEnd).getTime()) - timeToPixel(new Date(option.latestStart).getTime());
```

## Why Latest Start

For most tasks, latest start is the better default:
- **Setup tasks**: butt up against the process task, no dead time
- **Process tasks**: start as late as feasible, leaves earlier capacity open for other tasks
- **General**: latest start within feasibility = most flexible schedule (leaves room for things to shift left if needed)

The exception is when the scoring rule is "EarliestStartTimeScoringRule" — then earliest start is preferred. But for ghost bar display, latest start is the safer visual default because it shows the task fitting snugly into the available space.

## MoveTo Start Time

When the planner clicks the ghost bar, send `latestStart` as the requested start time:

```tsx
onClick={() => onMoveTo(taskKey, {
  contextHash: option.contextHash,
  startTime: option.latestStart,  // Use latest start as the chosen time
})}
```

## Multiple Options

If WhereTo returns multiple ranked options (e.g., 3 options on different resources), each gets its own start window + ghost bar on the appropriate resource row. The best option (rank 1) uses a brighter accent color. Lower-ranked options are more subtle:

```tsx
const opacity = option.rank === 1 ? 1.0 : 0.5;
const barBackground = option.rank === 1 ? `${C.accent}25` : `${C.accent}12`;
const borderStyle = option.rank === 1 ? `2px solid ${C.accent}` : `1px dashed ${C.accent}66`;
```

## Edge Cases

- **Start window is zero width** (earliest === latest): No light background, just the ghost bar. Task has exactly one valid start time.
- **Very small start window** (< 5 pixels wide): Don't render the light background — it would be invisible. Just show the ghost bar.
- **Ghost bar overlaps existing tasks**: Render on top with higher z-index. The ghost bar represents a future state where conflicting tasks may have moved.
- **Multiple resources per option**: Show ghost bar on the primary resource row. Show resource names in tooltip.
