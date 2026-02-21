# Sprint Status

## Active

| Sprint | Name | Status | Notes |
|--------|------|--------|-------|
| Solver Prompt 1 | Top-N Ranked Contexts | READY | No dependencies, start anytime |
| UI Sprint 1 | Select & Act | READY | Prompt written, start anytime |

## Done

| Item | Tests | Date |
|------|-------|------|
| Range Refactor | 44 snapshot + 466 existing | — |
| Unschedule Integration | 14 new tests, 480 total engine | — |
| API test suite | 87 tests passing | — |

## Up Next

| Sprint | Name | Blocked By |
|--------|------|------------|
| Solver Prompt 2 | Snapshot/Restore | Solver Prompt 1 |
| UI Sprint 2 | Solve Selected | UI Sprint 1 |
| UI Sprint 3 | Resource + Time Filter | UI Sprint 1 |

## Backlog

| Sprint | Name | Blocked By |
|--------|------|------------|
| Solver Prompt 3 | Balanced Strategy | Solver Prompt 2 |
| Solver Prompt 4 | Stress Tests | Solver Prompt 3 |
| UI Sprint 4 | Redirect Work | UI Sprint 1, 2 |
| UI Sprint 5 | Reprioritize | UI Sprint 1 |
| UI Sprint 6 | What-If Mode | UI Sprints 1-5, Solver Prompt 2 |
| UI Sprint 7 | Time Fence | UI Sprint 1 |
| UI Sprint 8 | Task Swap | UI Sprint 1, 2, 4 |
| UI Sprint 9 | Capacity Adjustment | UI Sprint 3, API work |
| UI Sprint 10 | Task Operations | UI Sprint 1, 5, API work |

## Dependency Map

```
SOLVER TRACK                          UI TRACK
────────────                          ────────
Prompt 1: Ranked Contexts             Sprint 1: Select & Act
         │                                     │
         ▼                                     ├──→ Sprint 2: Solve Selected
Prompt 2: Snapshot/Restore ─────────┐  │       ├──→ Sprint 3: Resource + Time Filter
         │                          │  │       ├──→ Sprint 5: Reprioritize
         ▼                          │  │       └──→ Sprint 7: Time Fence
Prompt 3: Balanced Strategy         │  │
         │                          │  ├──→ Sprint 4: Redirect Work (needs 1+2)
         ▼                          │  │
Prompt 4: Stress Tests              │  ├──→ Sprint 8: Task Swap (needs 1+2+4)
                                    │  │
                                    └──┼──→ Sprint 6: What-If (needs 1-5 + Solver P2)
                                       │
                                       ├──→ Sprint 9: Capacity Adjustment (needs 3)
                                       │
                                       └──→ Sprint 10: Task Operations (needs 1+5)
```

## File Index

```
/docs/sprints/
  README.md                          ← You are here
  roadmap.md                         ← Overview of both tracks with timeline
  parking-lot.md                     ← Ideas not yet in a sprint
  solver-1-ranked-contexts.md        ← Top-N ranked alternatives per task
  solver-2-snapshot-restore.md       ← Save/restore schedule state
  solver-3-balanced-strategy.md      ← Bump backtracking solver
  solver-4-stress-tests.md           ← Quick vs Balanced comparison scenarios
  ui-1-select-and-act.md             ← Checkboxes, selection toolbar, unscheduled panel
  ui-2-solve-selected.md             ← Partial re-solve via taskKeys
  ui-3-resource-time-filter.md       ← Gantt-driven filtering
  ui-4-redirect-work.md              ← Resource preference overrides
  ui-5-reprioritize.md               ← Inline priority editing, rush
  ui-6-what-if.md                    ← Snapshot, compare, revert
  ui-7-time-fence.md                 ← Rolling freeze window
  ui-8-task-swap.md                  ← Swap two tasks on same resource
  ui-9-capacity-adjustment.md        ← Overtime, maintenance, speed factor
  ui-10-task-operations.md           ← Split, rerun, duration edit
```

## Review Cadence

After each sprint:
1. Demo the new capability
2. Review: Does it feel right? Is the interaction natural?
3. Adjust the next sprint based on what we learned
4. Reprioritize if a real planner scenario demands a different order
5. Update this README with new status
