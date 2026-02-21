# UI Sprint Roadmap — Planner Interactions

## Philosophy

Each sprint delivers a usable increment. The planner can do something new after each one. We review and adjust before starting the next. Sprints build on each other — later sprints assume earlier ones are done.

The solver sprint (Top-N → Snapshot → Balanced → Stress Tests) runs in parallel. Some UI sprints unlock better with solver capabilities, noted where relevant.

---

## Sprint 1: Select & Act

**What the planner gets:** Checkboxes in the task table, selection toolbar with contextual actions, unscheduled panel below Gantt, visual indicators for queued changes, batch-through-solve workflow.

**Prompt:** Already written (`prompt-planner-workspace.md`)

**Covers:**
- ✅ #3 — Lock the good parts (pin selected)
- ✅ #4 — Free up problem area (unschedule selected)
- Partial #1 — See impact (filter table to resource, see what's there)

**Depends on:** Nothing. Current codebase.

**Deliverable:** Planner can filter → select → queue actions → review → solve.

---

## Sprint 2: Solve Only Selected (Partial Re-Solve)

**What the planner gets:** A "Solve Selected" option in the selection toolbar. Instead of solving everything, the solver only schedules the selected tasks. Everything else stays exactly where it is.

**How it works:**
- Selection toolbar shows "▶ Solve Selected (N)" when tasks are selected
- Bypasses the full solve preview — directly calls `/ctp/solve` with `taskKeys` (already supported in the API)
- All non-selected tasks are implicitly pinned for this solve — they don't move
- Results refresh showing only the selected tasks rescheduled

**UI changes:**
- New button in selection toolbar: "▶ Solve Selected"
- Optional: confirmation dialog showing "Solve 5 tasks, keep 35 in place"
- Loading spinner during solve
- After solve: selection clears, results refresh

**Covers:**
- ✅ #7 — Partial re-solve
- Better #4 — Unschedule 3 tasks then solve just those 3

**Depends on:** Sprint 1 (selection)

---

## Sprint 3: Filter by Resource + Time Window

**What the planner gets:** On the Gantt chart, click a resource row to filter the task table to that resource. Click a time region to filter to that window. Combined: "Show me everything on CNC-01 between 2pm and 6pm."

**UI changes:**
- Click resource label on Gantt → task table filters to that resource
- Click + drag on Gantt time axis → sets a time window filter
- Combined filter shown as chips: `Resource: CNC-01` `Time: Feb 21 2pm – 6pm`
- Clear buttons on each chip
- Task table and unscheduled panel respect these filters

**Also add to task table:**
- Time range filter (start after / end before) in the filter bar
- Quick filter presets: "Next 4 hours", "Today", "Tomorrow", "This week"

**Covers:**
- ✅ #1 — See impact (filter to resource + time = see exactly what's affected)
- Better #3 — Lock by time window (filter to "next 4 hours" → select all → pin)
- Better #4 — Free up by resource + time (filter → select → unschedule)

**Depends on:** Sprint 1 (selection makes filtered results actionable)

---

## Sprint 4: Redirect Work (Resource Preference Override)

**What the planner gets:** When unscheduling tasks from one resource, they can specify "prefer Machine B" or "exclude Machine A" for the re-solve.

**UI changes:**
- In task detail panel, show resource preferences with editable modes:
  - `REQUIRED` — must use this resource
  - `PREFERRED` — try this first
  - `AVAILABLE` — can use if needed (default)
  - `EXCLUDED` — don't use this resource
- Bulk version: select tasks → "Set Resource Preference" → pick resource → pick mode
- These overrides pass to the solve request as `resourceModes` (already in the API)

**Scenario flow:**
1. Filter to Machine A → select all → Unschedule
2. Selection toolbar → "Set Resource: Machine B = PREFERRED, Machine A = EXCLUDED"
3. Solve → tasks move to Machine B

**Covers:**
- ✅ #4 — Redirect work to specific resource
- Supports machine breakdown scenario completely

**Depends on:** Sprint 1 (selection), Sprint 2 (partial re-solve makes this targeted)

**API note:** `resourceModes` already exists in the solve request DTO. May need to extend to support per-task resource preferences if not already there.

---

## Sprint 5: Reprioritize

**What the planner gets:** Edit task priority inline, or bulk-change priority for selected tasks. Re-solve respects new priorities.

**UI changes:**
- Priority column in task table becomes editable (click to edit, or dropdown)
- Selection toolbar: "Set Priority" → dropdown or number input
- Priority changes are local overrides (like pins/excludes) — shown as pending until solve
- Visual indicator: priority badge changes color when modified
- Solve preview shows priority changes

**Also:**
- Drag to reorder tasks in a priority list view (optional, nice-to-have)
- "Rush" button — sets priority to highest and marks stale

**Covers:**
- ✅ #5 — Reprioritize tasks
- Supports rush order scenario: change priority → re-solve → high-priority task gets best slot

**Depends on:** Sprint 1 (selection for bulk), Sprint 2 (partial re-solve)

**API note:** Need to add `priorityOverrides` to the solve request DTO if not already there. Engine's scoring rules already respect priority.

---

## Sprint 6: What-If Mode

**What the planner gets:** A "What-If" toggle that snapshots the current schedule, lets them make changes and solve, then shows before/after comparison with an option to revert.

**UI changes:**
- "What-If" button in the toolbar → enters what-if mode
- Header/border changes color (amber) to indicate you're in hypothetical mode
- Banner: "What-If Mode — changes are temporary. Commit or Revert when done."
- Planner makes changes (unschedule, exclude, reprioritize, etc.) and solves
- Results show with delta indicators: tasks that moved, tasks that became feasible/infeasible
- Two buttons: "Commit" (keep this schedule) or "Revert" (go back to before)

**Comparison view:**
- Side-by-side Gantt (before | after) — or overlay mode with ghost bars for previous positions
- Summary: "+3 tasks scheduled, -1 infeasible, 2 tasks moved, makespan -2h"
- Per-task: "Task X: was CNC-01 8am-10am → now CNC-02 9am-11am"

**Covers:**
- ✅ #6 — What-if without committing
- ✅ #12 — Compare schedules (before/after)

**Depends on:** Sprint 1-5 (needs all the action capabilities), Solver Sprint Prompt 2 (Snapshot/Restore — the engine can save and restore state)

**This is the big one.** It turns the planner from "make a change and hope" to "explore freely and decide."

---

## Sprint 7: Time Fence

**What the planner gets:** A configurable freeze horizon. Everything starting within the fence is automatically pinned and can't be moved by the solver.

**UI changes:**
- Setting: "Time fence: next __ hours" (slider or input, default: 4)
- Visual: vertical red line on Gantt at the fence boundary
- Tasks left of the line get a lock icon — they're frozen
- Solver automatically pins everything inside the fence before solving
- Tasks can be manually unpinned inside the fence (override with confirmation)

**Behavior:**
- Time fence is a rolling window — it moves with the clock
- On each solve, tasks that have entered the fence since last solve get auto-pinned
- Planner can adjust the fence width in settings

**Covers:**
- ✅ #8 — Time fence / rolling freeze window

**Depends on:** Sprint 1 (pin mechanism)

**Note:** This is relatively simple to implement but high value for production use. Could be moved earlier if needed.

---

## Sprint 8: Task Swap

**What the planner gets:** Select two tasks on the same resource → "Swap" button → queues both for unschedule with each other's time slots as preferred.

**UI changes:**
- Selection toolbar shows "🔄 Swap" when exactly 2 scheduled tasks are selected on the same resource
- Click swap → both tasks queued for unschedule → resource preferences set to prefer each other's time slots
- Solve puts them in swapped positions

**Alternative (simpler):**
- Swap is really just: unschedule both, re-solve with time preferences
- Could implement as a macro that does the multi-step queue automatically

**Covers:**
- ✅ #9 — Swap two tasks

**Depends on:** Sprint 1 (selection), Sprint 2 (partial re-solve), Sprint 4 (resource preferences)

---

## Sprint 9: Capacity Adjustment

**What the planner gets:** Temporarily modify resource availability — add overtime, reduce speed, block a time window for maintenance.

**UI changes:**
- Resource detail panel gets "Adjust Capacity" section:
  - "Add Availability" — date/time range + capacity (e.g., Saturday 6am-2pm, 1 unit)
  - "Block Time" — date/time range (e.g., maintenance Tuesday 10am-12pm)
  - "Speed Factor" — percentage (e.g., 80% = running slow today)
- Changes shown as overlays on the resource's Gantt row
- These are temporary overrides — not saved to source data
- Passed to solve as resource availability modifications

**Covers:**
- ✅ #11 — Capacity adjustment (overtime, speed, maintenance)
- Better #4 — Machine breakdown = block the resource's availability, not just unschedule tasks

**Depends on:** Sprint 3 (resource interaction), Solver work (engine needs to accept availability overrides in solve request)

**API note:** May need new endpoint or extension to solve request for availability overrides. Engine already has the concepts (CTPAvailable, AvailableMatrix) but might not support runtime patches from the API.

---

## Sprint 10: Task Operations (Split, Rerun, Duration Edit)

**What the planner gets:** Modify task characteristics before re-solving.

**UI changes:**
- Task detail panel:
  - "Edit Duration" — override the planned duration
  - "Split Task" — break into two tasks with a gap (shift break, etc.)
  - "Add Rerun" — create a copy of the task (quality issue, need to redo)
- Duration edit is a local override like priority — shown as pending until solve
- Split creates two linked tasks from one — preserves the total work
- Rerun duplicates the task with a new key, linked to the original

**Covers:**
- ✅ #10 — Split a task across shifts
- Supports quality rerun scenario

**Depends on:** Sprint 1 (basics), Sprint 5 (inline editing pattern)

**API note:** Split and rerun require creating new tasks in the landscape. Need API endpoints for task creation/modification, not just solve overrides.

---

## Sprint Summary

| Sprint | Name | Key Capability | Planner Scenario |
|--------|------|---------------|-----------------|
| 1 | Select & Act | Checkboxes, queue actions, visual feedback | Basic workflow foundation |
| 2 | Solve Selected | Partial re-solve | "Fix just these 5 tasks" |
| 3 | Resource + Time Filter | Gantt-driven filtering | "What's on Machine A tomorrow?" |
| 4 | Redirect Work | Resource preference overrides | "Move tasks from A to B" |
| 5 | Reprioritize | Inline priority editing | "This order is now urgent" |
| 6 | What-If Mode | Snapshot, compare, revert | "What happens if I drop Order-009?" |
| 7 | Time Fence | Rolling freeze window | "Don't touch the next 4 hours" |
| 8 | Task Swap | Swap two tasks | "Switch Task A and B on CNC-01" |
| 9 | Capacity Adjustment | Runtime availability changes | "Add Saturday overtime" |
| 10 | Task Operations | Split, rerun, duration edit | "Split across two shifts" |

## Parallel Track: Solver ↔ UI Dependencies

```
Solver Sprint                     UI Sprint
─────────────                     ─────────
Prompt 1: Top-N Contexts    ──→   (no UI dependency)
Prompt 2: Snapshot/Restore   ──→   Enables Sprint 6 (What-If)
Prompt 3: Balanced Strategy  ──→   Better results for Sprint 2 (partial re-solve)
Prompt 4: Stress Tests       ──→   (no UI dependency)
```

UI Sprints 1-5 can proceed without waiting for solver sprints.
UI Sprint 6 (What-If) needs Solver Prompt 2 (Snapshot/Restore).
UI Sprints 7-10 are independent of solver sprints.

## Review Cadence

After each sprint:
1. Demo the new capability
2. Review: Does it feel right? Is the interaction natural?
3. Adjust the next sprint based on what we learned
4. Reprioritize if a real planner scenario demands a different order
