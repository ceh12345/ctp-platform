# Work Orders and Cases

## What is a work order?

A work order (called a "case" in healthcare) groups all the tasks needed to complete a piece of work. It's the top-level container that ties together the chain of tasks, tracks progress, and reports fill rate.

**Healthcare:** Case = patient surgical journey (Pre-Op → Procedure → Recovery)
**Manufacturing:** Work Order = production job (CNC → Assembly → QC → Pack)

## The Orders page

The Orders tab is the **case view** — it shows every work order with its scheduling status at a glance.

### Columns

| Column | What it shows |
|--------|--------------|
| Order | The work order or case ID (filterable) |
| Product | What this order produces or the procedure type (filterable) |
| Demand | Quantity ordered |
| Scheduled | Quantity scheduled so far |
| Progress | Visual bar showing scheduled/total tasks, with infeasible highlighted |
| Start | Earliest scheduled start across all tasks in the order |
| End | Latest scheduled end across all tasks in the order |
| Due Date | When the order needs to be complete |
| Priority | P1 (urgent) through P5 (low) |
| Fill Rate | Percentage of demand that's been scheduled |
| Status | On Track / At Risk / Late (filterable) |

### Filtering

Use the dropdown on the **Order** column to filter to a specific case. This shows just that one work order and its tasks — useful when investigating a specific case's scheduling.

## Navigating to a case

From the **Schedule → Task List**, click any task's order reference (shown in blue). This navigates directly to the Orders tab filtered to that case.

This makes it easy to go from "why is this task late?" to "what's the full picture for this case?"

The filter appears as a chip at the top of the Orders page. Click the **x** to clear it and see all orders again.

## Order status

| Status | Meaning | How it's determined |
|--------|---------|-------------------|
| On Track | All phases scheduled, fill rate healthy | Fill rate meets or exceeds target |
| At Risk | Some phases scheduled but gaps or partial coverage | Fill rate below target but not zero |
| Late | Order will miss its due date | Scheduled end exceeds due date, or critical tasks infeasible |

## Understanding infeasible tasks

When a task in an order can't be scheduled, the error tells you why:

- **"No feasible schedule: Could Not Find Availability for DR-CHEN"** — The required resource has no open slots in the task's time window
- **"Predecessor X is not scheduled"** — An earlier phase in the chain failed, so this one can't start
- **"Window collapsed"** — After tightening from the predecessor, there's not enough time left for this task

Check the task's error in the Schedule → Task List to see which resource is the bottleneck.

## Work order modes

Each order can be set to a mode that controls how the solver treats it:

| Mode | Effect |
|------|--------|
| Include | Normal — solver schedules all tasks in this order |
| Exclude | Solver ignores this order entirely (unschedules if previously scheduled) |
| Locked | Keep current schedule frozen — solver won't move these tasks |

Click the **Mode** badge on the Orders page to cycle between modes.
