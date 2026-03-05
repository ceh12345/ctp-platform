# Sprint Status

## Active

_No sprints currently in progress._

## Done

| Item | Summary | Date |
|------|---------|------|
| Range Refactor | 44 snapshot + 466 existing tests | — |
| Unschedule Integration | 14 new tests, 480 total engine | — |
| API test suite | 87 tests passing | — |
| UI Sprint 1 — Select & Act | Checkboxes, selection toolbar, unscheduled panel, visual indicators | 2026-02-21 |
| UI Sprint 1.1 — Immediate Actions | Single-task and bulk unschedule/pin/schedule via API; toast; loading state | 2026-02-21 |
| UI Sprint 1.2 — WhereTo Ghost Bars | Ghost bars on Gantt for WhereTo options; "Move Here" click-to-place | 2026-02-21 |
| UI Sprint 2 — Solve Selected | Covered by 1.1 bulk immediate actions (Schedule N, Unschedule N, Pin N) | 2026-02-21 |
| UI Sprint 3 — Resource + Time Filter | Click resource label → filter task table; time presets; filter chips; Gantt highlight | 2026-02-22 |
| UI Sprint 4 — Redirect Work | Resource preference overrides (Required/Preferred/Available/Excluded) per task; engine + API + UI | 2026-02-23 |
| UI Sprint 5 — Reprioritize | Inline priority editing; Gantt time-range dropdown; priority labels | 2026-02-23 |
| UI Sprint 11 — Process Category | Category column with dropdown filter; per-tenant terminology; HRMD timezone fix | 2026-02-24 |
| Solver Sprint 1 — Ranked Contexts | Top-N ranked alternatives per task via RankedScheduleContexts | 2026-02-25 |
| Engine — Cadence Profiles | Boundary-snap filtering; replaces PB-TIMESLOT hack; tenant-level cadence config | 2026-03-01 |
| Solver 2.5 — Chain Propagation | Implemented then **reverted** (fc1db41) — did not add value | 2026-03-03 |
| UI Sprint 15 — Resource Agenda | Right-click resource → agenda slide-over; day navigation; availability gaps; end times | 2026-03-04 |
| UI Sprint 16 — WhereTo Resource Diversity | Best-per-resource selection; isBestOnResource flag; panel-only WhereTo; HRMD field availability | 2026-03-04 |

## Up Next

| Sprint | Name | Blocked By |
|--------|------|------------|
| Solver Prompt 2 | Snapshot/Restore | — |
| Solver Phase 3b | Bump-and-Retry | Solver Prompt 2 |
| UI Sprint 12 | Advanced Filters | — |
| UI Sprint 13 | Resource Explorer | — |
| UI Sprint 14 | Error Display & API Error Handling | — |

## Backlog

| Sprint | Name | Blocked By |
|--------|------|------------|
| Solver Prompt 3 | Balanced Strategy (Bump Backtracking) | Solver Phase 3b |
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
✓ Sprint 1: Ranked Contexts           ✓ Sprint 1: Select & Act
         │                            ✓ Sprint 1.1: Immediate Actions
         ▼                            ✓ Sprint 1.2: WhereTo Ghost Bars
Prompt 2: Snapshot/Restore ───────┐   ✓ Sprint 2: Solve Selected (via 1.1)
         │                        │   ✓ Sprint 3: Resource + Time Filter
         ▼                        │           │
Phase 3b: Bump-and-Retry          │   ✓ Sprint 4: Redirect Work
         │                        │   ✓ Sprint 5: Reprioritize
         ▼                        │           │
Prompt 3: Balanced Strategy       │           └──→ Sprint 7: Time Fence
         │                        │
         ▼                        │   ├──→ Sprint 8: Task Swap (needs 4)
Prompt 4: Stress Tests            │   │
                                  └───┼──→ Sprint 6: What-If (needs 3-5 + Solver P2)
                                      │
✓ Engine: Cadence Profiles            ├──→ Sprint 9: Capacity Adjustment (needs 3)
✗ Solver 2.5: Reverted                │
                                      ├──→ Sprint 10: Task Operations (needs 5)
                                      │
                                    ✓ Sprint 11: Process Category
                                      │
                                      ├──→ Sprint 12: Advanced Filters
                                      ├──→ Sprint 13: Resource Explorer
                                      ├──→ Sprint 14: Error Handling
                                    ✓ Sprint 15: Resource Agenda
                                    ✓ Sprint 16: WhereTo Resource Diversity
```

## File Index

```
/docs/sprints/
  README.md                          ← You are here
  roadmap.md                         ← Overview of both tracks with timeline
  parking-lot.md                     ← Ideas not yet in a sprint
  solver-1-ranked-contexts.md        ← Top-N ranked alternatives per task
  solver-2-snapshot-restore.md       ← Save/restore schedule state
  solver-phase3b-bump-retry.md       ← Bump blocker, schedule blocked chain, re-evaluate
  solver-3-balanced-strategy.md      ← Bump backtracking solver
  solver-4-stress-tests.md           ← Quick vs Balanced comparison scenarios
  engine-cadence-profiles.md         ← Boundary-snap filtering (replaces PB-TIMESLOT)
  ui-1-select-and-act.md             ← Checkboxes, selection toolbar, unscheduled panel
  ui-1.1-immediate-actions.md        ← Single-task and bulk actions via API
  ui-1.2-whereto-ghost-bars.md       ← Ghost bars on Gantt for WhereTo options
  ui-2-solve-selected.md             ← Partial re-solve via taskKeys
  ui-3-resource-time-filter.md       ← Gantt-driven filtering
  ui-4-redirect-work.md              ← Resource preference overrides
  ui-4.1-redirect-work.md            ← Resource preference overrides (incremental)
  ui-4.2-redirect-work.md            ← Resource preference overrides (incremental)
  ui-5-reprioritize.md               ← Inline priority editing, rush
  ui-5.1-reprioritize.md             ← Reprioritize (incremental)
  ui-5.2-reprioritize.md             ← Reprioritize (incremental)
  ui-6-what-if.md                    ← Snapshot, compare, revert
  ui-7-time-fence.md                 ← Rolling freeze window
  ui-8-task-swap.md                  ← Swap two tasks on same resource
  ui-9-capacity-adjustment.md        ← Overtime, maintenance, speed factor
  ui-10-task-operations.md           ← Split, rerun, duration edit
  ui-11-process-category.md          ← Category column (Sport/Specialty/Work Center)
  ui-12-advanced-filters.md          ← Typed attribute filter popup
  ui-13-resource-explorer.md         ← Resource hierarchy tree + calendar/agenda views
  ui-14-error-handling.md            ← Surface engine/API errors in UI
```

## Review Cadence

After each sprint:
1. Demo the new capability
2. Review: Does it feel right? Is the interaction natural?
3. Adjust the next sprint based on what we learned
4. Reprioritize if a real planner scenario demands a different order
5. Update this README with new status
