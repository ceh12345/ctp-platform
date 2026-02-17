# Your First Solve

This guide walks you through building your first schedule.

## Before you start

Make sure your data is loaded:
- **Resources** with availability calendars (shifts, working hours)
- **Cases/Orders** with their tasks and resource requirements
- **Scoring rules** configured (defaults work fine to start)

## Building the schedule

1. Click **Build Schedule** (▶) in the header bar
2. Select a solver strategy (Balanced is recommended)
3. The engine processes all unscheduled tasks and places them

After the solve completes, you'll see:
- **Summary stats** in the header — tasks scheduled, feasibility rate
- **Gantt chart** showing all assignments on a timeline
- **Task list** with status, assigned resources, and scheduled times
- **Analytics** with utilization, chain integrity, and scheduling metrics

## Reading the results

**Scheduled tasks** — Successfully placed with a time and resource assignment. Shown as colored bars on the Gantt.

**Unscheduled tasks** — The engine couldn't find a feasible slot within the task's time window. Check the task's errors for the reason.

**Infeasible tasks** — No valid combination of time and resources exists. Common causes: resource fully booked, predecessor not scheduled, time window too narrow.

## What to check first

1. **Feasibility rate** — What percentage of tasks were placed? 100% is ideal. Below 90% means you have constraint issues to investigate.
2. **Chain integrity** — Go to Analytics → Chain Integrity. Are your cases running back-to-back or do gaps exist between phases?
3. **Bottleneck** — Check Analytics → Utilization. Which resource group is most loaded? That's your constraint.
4. **Infeasible tasks** — Switch to the Task List, filter by "Infeasible". Read the error messages to understand why.

## Re-solving

After making changes (unscheduling tasks, adjusting windows, adding resources), click Build Schedule again. The engine re-evaluates everything. Previously scheduled tasks that are still valid will be kept; only unscheduled work is re-placed.

## Tips

- Start with the **Balanced** strategy until you're comfortable with the results
- Use the **Analytics page** to understand your schedule quality before making manual changes
- If a case has gaps between phases, the bottleneck is usually one shared resource (like an anesthesiologist or a specific machine)
- The **Gantt by Case** view is the fastest way to see whether your chains are flowing properly
