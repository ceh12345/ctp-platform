# Reading the Dashboard

The dashboard has several tabs, each showing a different view of your schedule.

## Header Bar

The header shows at-a-glance stats:
- **Tasks scheduled** — How many tasks have been placed
- **Feasibility rate** — Percentage of tasks successfully scheduled
- **Build Schedule** button — Run the solver
- **Settings** — Solver strategy, scoring rules, experience level

## Schedule Tab

Three views of the same data:

### Gantt by Resource
One row per resource. Each colored bar is a task assigned to that resource. Gaps between bars are idle time.

**What to look for:**
- Resources with no gaps = fully loaded (potential bottleneck)
- Resources with lots of gaps = underutilized (capacity available)
- Overlapping bars = should not happen (constraint violation)

### Gantt by Case
One row per case/order. Each bar is a phase in the case chain. This view shows how your cases flow end-to-end.

**What to look for:**
- Bars touching = back-to-back phases (good)
- Visible gaps between bars = delays between phases (investigate)
- Dashed outlines = unscheduled phases

### Task List
Sortable table of all tasks with full detail: status, assigned resource, scheduled time, duration, case, priority.

**Useful for:**
- Filtering by status (scheduled, unscheduled, infeasible)
- Finding specific tasks
- Seeing error messages on infeasible tasks
- Bulk actions (pin, exclude, unschedule)

## Analytics Tab

KPI catalog on the left, detail view on the right. Click any KPI to see its breakdown.

### Utilization
How loaded each resource group is. Shown as horizontal stacked bars:
- **Green** = assigned time (working)
- **Light grey** = available but idle
- **Dark grey** = unavailable (outside calendar)

High utilization (>85%) on a single resource or group usually indicates the bottleneck.

### Scheduling Metrics
- **On-Time Starts** — What percentage of tasks started within their target window
- **Avg Turnover** — Average time between consecutive tasks on the same resource
- **Tasks Scheduled / Infeasible** — Overall solve success

### Chain Integrity
The most important diagnostic view. Shows each case as a chain of phases with gap analysis.

- **✓ Back-to-back** — Phases flow seamlessly, no wasted time
- **⚠ Gap** — Time between phases where nothing is happening. The patient is waiting, the WIP is sitting idle
- **Total gap** — Sum of all gaps in a case. Sort by worst to find the biggest problems

Each case shows a mini Gantt inline so you can visually see the flow.

## Cases/Orders Tab

Table of all cases with:
- Status (on-track, at-risk, late)
- Fill rate (what percentage of phases are scheduled)
- Priority badge
- Due date

## Conflicts Tab

Active scheduling conflicts:
- **Capacity conflicts** — More demand than available capacity
- **Changeover conflicts** — Setup time violations
- **Chain violations** — Gaps between linked phases

Each conflict card shows root cause analysis and suggested resolutions.
