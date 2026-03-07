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
| Batch 4 — Polish | Experience levels (Standard/Detailed/Advanced/Diagnostic), terminology externalization | 2026-02-23 |
| Batch 5 — WhereTo / MoveTo | Right-click task → ghost bars → click to move; read-only evaluation + commit | 2026-02-23 |
| KPI Analytics Page | Analytics tab with KPI catalog, utilization, scheduling KPIs, chain integrity | 2026-02-24 |
| UI Sprint 11 — Process Category | Category column with dropdown filter; per-tenant terminology; HRMD timezone fix | 2026-02-24 |
| UI Sprint 12 — Advanced Filters | Enhanced filtering with process category, resource group, typed attribute popup | 2026-02-24 |
| Solver Sprint 1 — Ranked Contexts | Top-N ranked alternatives per task via RankedScheduleContexts | 2026-02-25 |
| Engine — maxGap on CTPLinkId | `maxGap: number \| null` — null=unconstrained, 0=back-to-back, >0=max seconds. Negative reserved for future overlap. | 2026-03-01 |
| Engine — Cadence Profiles | Boundary-snap filtering; replaces PB-TIMESLOT hack; tenant-level cadence config; process-level defaults | 2026-03-01 |
| Engine — Product / BOM Model | RAW/INTERMEDIATE/FINISHED product types, BOM inputs, scrap rates, gross/net calculations | 2026-03-01 |
| Phase 1 — Chain-Aware Ordering | Tasks processed chain-by-chain; chains sorted by priority | 2026-03-02 |
| Phase 2 — Window Tightening | Successor window tightened from predecessor scheduled end; maxGap ceiling | 2026-03-03 |
| Solver 2.5 — Chain Propagation | Implemented then **reverted** (fc1db41) — propagation without cross-product was ineffective | 2026-03-03 |
| UI Sprint 15 — Resource Agenda | Right-click resource → agenda slide-over; day navigation; availability gaps; end times | 2026-03-04 |
| UI Sprint 16 — WhereTo Resource Diversity | Best-per-resource selection; isBestOnResource flag; panel-only WhereTo; HRMD field availability | 2026-03-04 |
| Solver Phase 3 — Chain Context Engine | Lane detection, cross-product combos, forward/backward propagation, bump-and-retry, earliest-start selection, stratified combo sampling, cadence-aware placement | 2026-03-06 |
| Engine — Cadence Fix | Process-level cadence skips SETUP/TEARDOWN types; chain engine cadence-aware placement; HRMD switched to 30-min cadence | 2026-03-06 |
| Timezone-Aware Scheduling | Hydrator reads tenant timezone from locale.json for shift expansion; Agenda panel uses tz-aware day boundaries; all 3 tenants converted to America/Denver | 2026-03-06 |
| Engine Sprint 19 — Post-Review Cleanup | Context mutation fix, preCapContextSets sort fix, retryChain window reset, bounds cache, SolutionState snapshot, console.log removal, var→let/const | 2026-03-06 |

### Phase 3 Session Fixes (Mar 6)

1. **Priority hydration** — URGENT/ELECTIVE maps to `task.priority` not undeclared `task.rank`
2. **Forward simulation in assignStartTimes** — full chain validation with backward-derived candidates from successor start-time nodes
3. **evaluateChain integration** — tries combos in score order, returns first with valid placement
4. **Infeasible over violated** — chains with maxGap that can't place are marked infeasible, no greedy fallback
5. **`unscheduleChain`** — added `task.window?.reset()` before unscheduling
6. **Removed truncation** — `truncateContextStartTimes` was deleting start-time nodes needed by commitChain
7. **Combo selection** — sorts by earliest assignedStart then score (Monday OR-02 beats Tuesday OR-01)

## Up Next

| Sprint | Name | Notes |
|--------|------|-------|
| UI Sprint 14 | Error Display & API Error Handling | Surface engine errors in UI instead of generic 500 |
| UI Sprint 17 | Infeasible Task Bottleneck Display | Per-resource availability breakdown, auto-expand bottleneck |
| UI Sprint 13 | Resource Explorer | Calendar/Agenda sub-views under Schedule tab |
| WhereTo on task detail | Button on detail panel | Trigger WhereTo for setup/teardown/unscheduled tasks |

## Backlog

| Sprint | Name | Blocked By |
|--------|------|------------|
| UI Sprint 18 | Solve Replay | Phase 3 solve step logging |
| Solver Prompt 2 | Snapshot/Restore | May not be needed — Phase 3 replaced backtracking approach |
| Solver Prompt 3 | Balanced Strategy (Bump Backtracking) | Evaluate if still needed post-Phase 3 |
| Solver Prompt 4 | Stress Tests — Quick vs Chain | Phase 3 stable |
| UI Sprint 6 | What-If Mode | Solver Prompt 2 (if needed) |
| UI Sprint 7 | Time Fence | — |
| UI Sprint 8 | Task Swap | UI Sprint 4 |
| UI Sprint 9 | Capacity Adjustment | API work |
| UI Sprint 10 | Task Operations | API work |

## Tenants

| Tenant | Resources | Orders | Tasks | Status |
|--------|-----------|--------|-------|--------|
| Willoughby Manufacturing | ~8 machines + stations | ~25 work orders | ~50 tasks | ✅ Active |
| Acme Outpatient Healthcare | 2 ORs, 2 surgeons, 2 anesthesiologists, 2 nurses, 2 recovery bays | 10 cases | 30 tasks | ✅ Active (Phase 3) |
| HRMD Sports | 58 resources (courts, fields, equipment) | 77 orders | 141 tasks | ✅ Active (cadence) |

## Parking Lot

See `parking-lot.md` for deferred items including:
- Negative maxGap (overlap support) — successor starts before predecessor ends
- Multi-lane support — explicit `lane: true` on non-primary resources
- Soft affinity scoring — prefer same nurse across chain phases
- `requiresPreds` deprecation — no longer needed, chain strategy + linkId handles it
- Rich infeasibility messages — intersection failure details per resource combo
- Solve time in API response — `solveTimeMs` + strategy name

## Dependency Map

```
SOLVER TRACK                          UI TRACK
────────────                          ────────
✓ Sprint 1: Ranked Contexts           ✓ Sprint 1: Select & Act
         │                            ✓ Sprint 1.1: Immediate Actions
         ▼                            ✓ Sprint 1.2: WhereTo Ghost Bars
  Prompt 2: Snapshot/Restore ───┐     ✓ Sprint 2: Solve Selected (via 1.1)
  (may not be needed)           │     ✓ Sprint 3: Resource + Time Filter
         │                      │             │
         ▼                      │     ✓ Sprint 4: Redirect Work
  Prompt 3: Balanced Strategy   │     ✓ Sprint 5: Reprioritize
  (evaluate post-Phase 3)      │             │
         │                      │             └──→ Sprint 7: Time Fence
         ▼                      │
  Prompt 4: Stress Tests        │     ├──→ Sprint 8: Task Swap (needs 4)
                                │     │
                                └─────┼──→ Sprint 6: What-If (needs 3-5 + P2?)
                                      │
✓ Engine: Cadence Profiles            ├──→ Sprint 9: Capacity Adjustment
✗ Solver 2.5: Reverted                │
✓ Phase 1: Chain Ordering             ├──→ Sprint 10: Task Operations
✓ Phase 2: Window Tightening          │
✓ Phase 3: Chain Context Engine      ✓ Sprint 11: Process Category
  + Bump-and-Retry                   ✓ Sprint 12: Advanced Filters
                                      ├──→ Sprint 13: Resource Explorer
                                      ├──→ Sprint 14: Error Handling
                                    ✓ Sprint 15: Resource Agenda
                                    ✓ Sprint 16: WhereTo Resource Diversity
                                      ├──→ Sprint 17: Bottleneck Display
                                      └──→ Sprint 18: Solve Replay (needs Phase 3 steps)
```

## File Index

```
/docs/sprints/
  README.md                          ← You are here
  roadmap.md                         ← Overview of both tracks with timeline
  parking-lot.md                     ← Deferred items

  Engine Sprints:
  solver-1-ranked-contexts.md        ← Top-N ranked alternatives per task
  solver-2-snapshot-restore.md       ← Save/restore schedule state
  solver-phase3-complete.md          ← Chain context engine + bump-and-retry spec
  solver-phase3b-bump-retry.md       ← Bump-and-retry design (cross-chain conflict resolution)
  solver-3-balanced-strategy.md      ← Bump backtracking solver (evaluate post-Phase 3)
  solver-4-stress-tests.md           ← Quick vs Chain comparison scenarios
  engine-sprint-19-cleanup-foundation.md ← Correctness fixes, perf, SolutionState snapshot
  engine-cadence-profiles.md         ← Boundary-snap filtering (replaces PB-TIMESLOT)

  UI Sprints:
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
  ui-17-bottleneck-display.md        ← Infeasible task bottleneck identification
  ui-18-solve-replay.md              ← Animated Gantt playback of solver sequence
```

## Review Cadence

After each sprint:
1. Demo the new capability
2. Review: Does it feel right? Is the interaction natural?
3. Adjust the next sprint based on what we learned
4. Reprioritize if a real planner scenario demands a different order
5. Update this README with new status

---

*Last updated: Mar 7, 2026*
