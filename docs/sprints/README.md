# Sprint Status

## Active

| Sprint | Name | Status | Notes |
|--------|------|--------|-------|
| Solver Prompt 1 | Top-N Ranked Contexts | READY | No dependencies, start anytime |

## Done

| Item | Tests | Date |
|------|-------|------|
| Range Refactor | 44 snapshot + 466 existing | — |
| Unschedule Integration | 14 new tests, 480 total engine | — |
| API test suite | 87 tests passing | — |
| UI Sprint 1 — Select & Act | Checkboxes, selection toolbar, unscheduled panel, visual indicators | 2026-02-21 |
| UI Sprint 1.1 — Immediate Actions | Single-task and bulk unschedule/pin/schedule via API; toast; loading state; Unschedule Order context menu | 2026-02-21 |
| UI Sprint 2 — Solve Selected | Covered by 1.1 bulk immediate actions (Schedule N, Unschedule N, Pin N from selection toolbar) | 2026-02-21 |
| UI Sprint 3 — Resource + Time Filter | Click resource label → filter task table; time presets (Now, Next 4h, Today, Tomorrow); filter chips with ✕; Gantt row highlight; unscheduled panel respects filter | 2026-02-22 |
| UI Sprint 11 — Process Category | Category column (Sport/Specialty/Work Center) with dropdown filter; process name fallback for Product column; per-tenant terminology for column headers; HRMD timezone fix; removed pickleball PREP/RESET tasks; courts 8 AM–8 PM | 2026-02-24 |

## Up Next

| Sprint | Name | Blocked By |
|--------|------|------------|
| Solver Prompt 2 | Snapshot/Restore | Solver Prompt 1 |
| UI Sprint 4 | Redirect Work | — |
| UI Sprint 5 | Reprioritize | — |
| UI Sprint 12 | Advanced Filters | — |

## Backlog

| Sprint | Name | Blocked By |
|--------|------|------------|
| Solver Prompt 2.5 | Chain Constraint Propagation | Solver Prompt 2 |
| Solver Prompt 3 | Balanced Strategy (Bump Backtracking) | Solver Prompt 2.5 |
| Solver Prompt 4 | Stress Tests | Solver Prompt 3 |
| UI Sprint 6 | What-If Mode | UI Sprints 3-5, Solver Prompt 2 |
| UI Sprint 7 | Time Fence | — |
| UI Sprint 8 | Task Swap | UI Sprint 4 |
| UI Sprint 9 | Capacity Adjustment | UI Sprint 3, API work |
| UI Sprint 10 | Task Operations | UI Sprint 5, API work |

## Dependency Map

```
SOLVER TRACK                          UI TRACK
────────────                          ────────
Prompt 1: Ranked Contexts             ✓ Sprint 1: Select & Act
         │                            ✓ Sprint 1.1: Immediate Actions
         ▼                            ✓ Sprint 2: Solve Selected (via 1.1)
Prompt 2: Snapshot/Restore ───────┐   ✓ Sprint 3: Resource + Time Filter
         │                        │           │
         ▼                        │           ├──→ Sprint 4: Redirect Work
Prompt 2.5: Chain Propagation     │           ├──→ Sprint 5: Reprioritize
         │                        │           └──→ Sprint 7: Time Fence
         ▼                        │
Prompt 3: Balanced Strategy       │   ├──→ Sprint 8: Task Swap (needs 4)
         │                        │   │
         ▼                        └───┼──→ Sprint 6: What-If (needs 3-5 + Solver P2)
Prompt 4: Stress Tests                │
                                      ├──→ Sprint 9: Capacity Adjustment (needs 3)
                                      │
                                      ├──→ Sprint 10: Task Operations (needs 5)
                                      │
                                    ✓ Sprint 11: Process Category
                                      │           │
                                      │           ▼
                                      └──→ Sprint 12: Advanced Filters (needs 11)
```

## File Index

```
/docs/sprints/
  README.md                          ← You are here
  roadmap.md                         ← Overview of both tracks with timeline
  parking-lot.md                     ← Ideas not yet in a sprint
  solver-1-ranked-contexts.md        ← Top-N ranked alternatives per task
  solver-2-snapshot-restore.md       ← Save/restore schedule state
  solver-2.5-chain-propagation.md    ← Arc consistency across linked chains (maxGap)
  solver-3-balanced-strategy.md      ← Bump backtracking solver (cross-chain contention only)
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
  ui-11-process-category.md          ← Category column (Sport/Specialty/Work Center)
  ui-12-advanced-filters.md          ← Typed attribute filter popup
```

## Review Cadence

After each sprint:
1. Demo the new capability
2. Review: Does it feel right? Is the interaction natural?
3. Adjust the next sprint based on what we learned
4. Reprioritize if a real planner scenario demands a different order
5. Update this README with new status
