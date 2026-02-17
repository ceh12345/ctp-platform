# What is Feasibility?

Feasibility means the engine found at least one valid way to schedule a task — a time slot where all required resources are available simultaneously, within the task's allowed time window.

## Feasible vs. Infeasible

**Feasible** — The engine found one or more valid slots. It picked the best one based on scoring rules and assigned the task.

**Infeasible** — No valid slot exists. The engine tried every combination of resources and times within the task's window and none of them work.

## Why a task becomes infeasible

**All required resources are booked** — The task needs Resource A and Resource B at the same time, but there's no overlap in their availability.

**Time window too narrow** — The task must happen between Monday 8:00 and Monday 12:00, but the required resources are already committed during that window.

**Predecessor not scheduled** — The task depends on a predecessor that hasn't been placed yet. If the predecessor is infeasible, the successor is too.

**Chain gap constraint violated** — The task must start within X minutes of its predecessor ending (maxGap), but no resources are available in that narrow window.

**Capacity exhausted** — For consumable resources (materials), the required quantity isn't available. For reusable resources, all units are fully booked.

## How to fix infeasibility

1. **Read the error message** — Each infeasible task has a specific reason. Go to the Task List, filter by infeasible, and check the error column.

2. **Check the bottleneck resource** — Usually one specific resource is causing the problem. Check its utilization — if it's above 90%, that's your constraint.

3. **Widen the window** — If the task has a narrow time window, can it be relaxed? Moving the latest finish date out by a day might open up options.

4. **Add resource alternatives** — Can the task use a different resource? Adding a second-choice machine or a backup surgeon creates more scheduling options.

5. **Reschedule lower-priority work** — Something less important might be sitting in the slot you need. Unschedule it and re-solve.

6. **Use Balanced strategy** — The Balanced solver automatically tries bumping lower-priority work to make room. If you're using Quick, switch to Balanced.

7. **Add capacity** — If a resource type is chronically overloaded, the real fix is more capacity (another machine, another shift, another provider).

## Feasibility rate

The feasibility rate is the percentage of tasks successfully scheduled:

```
Feasibility Rate = Scheduled Tasks / Total Tasks × 100
```

| Rate | Assessment |
|------|------------|
| 100% | Everything placed — ideal |
| 95-99% | Very good — a few edge cases couldn't fit |
| 90-95% | Acceptable — some constraint issues to investigate |
| 80-90% | Concerning — significant capacity or constraint problems |
| < 80% | Serious issues — check data quality, calendar setup, resource availability |

A low feasibility rate often points to a data problem (calendars not set up, resource availability missing) rather than a genuine capacity problem.
