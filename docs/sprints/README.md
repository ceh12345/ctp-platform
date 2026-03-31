# Sprint Status

## Active

| Sprint | Name | Notes |
|--------|------|-------|
| [Rolling Horizon](rolling-horizon-spec.md) | NOW-relative horizon config, task bucketing, past due extension, deferred tasks, UI indicators | In progress |

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
| UI Sprint 17 — Bottleneck Display | InfeasibilityReport interfaces, per-resource availability analysis, ResourceBottleneckPanel in task detail + Conflicts + Analytics KPI | 2026-03-07 |
| UI Sprint 20 — Conflict Categorization | ConflictType classification (availability/capacity/dependency), Conflicts page grouped by type with filter chips, Analytics type breakdown | 2026-03-07 |
| AI Sprint 1 — Read-Only Chat | Anthropic proxy endpoint, ChatPanel slide-over, system prompt with schedule context, Ask AI from task detail + Gantt context menu | 2026-03-07 |
| AI Sprint 2 — Investigation Tools | 7 tool-use functions (where_can_task_go, get_resource_agenda, get_chain_detail, analyze_impact, find_available_resources, compare_tasks, query_resources), tool-use loop (max 5 iterations), loading indicators | 2026-03-07 |
| AI Sprint 2b — query_resources | 7th tool: query resources by typed attributes with time-windowed availability; GET /ctp/resources/query endpoint; system prompt routing guidance | 2026-03-07 |
| AI Sprint 2C — Chat Action Buttons | 6 action types (whereTo, openTask, openResource, filterChain, openTab, navigateOrder); auto-collapse to strip; manual collapse chevron; action tag parsing | 2026-03-07 |
| AI Sprint 2C amendments | WhereTo time constraints (startAfter/startBefore) on tool + action buttons + handleWhereTo; time window resolution guidance; better error messages | 2026-03-07 |
| Logging Sprint 1 — Backend Logger | Pluggable LoggerService with 4 transports (memory/console/file/azure), 4 event types, AllExceptionsFilter, debug endpoint, solve + AI instrumentation | 2026-03-07 |
| UI Sprint 18 — Solve Replay | Engine SolveStep recording (gated, capped at 500), all solver paths instrumented, frontend replay player with controls at top of Gantt, collapsible step log, keyboard shortcuts, flash animations | 2026-03-08 |
| Engine — Primary-Anchor Placement | assignStartTimes anchors on most constrained task (smallest feasible duration) instead of Task 0; backward walk for predecessors; AI prompt includes task scheduling windows | 2026-03-08 |
| UI Sprint 19 — App Versioning | Build-time version.json generation, GET /health/version endpoint, logo hover About popover, fixed footer bar (version + tenant) | 2026-03-08 |
| What-If Sprint 1 — CTP Query | Stateless clone-from-chain query, need-by date promise status, resource-combo dedup, CTP Query dialog + AI tool | 2026-03-12 |
| Stafford Job Shop Rework | Strategy-aware scheduling gate (chainCompatible); Greedy bypass for job shops; per-task chain-aware scheduling with skip-and-retry; priority fix (numeric direct, tiers RUSH/HIGH/NORMAL/LOW); Gantt tenant timezone; tenant default strategy in API + UI | 2026-03-14 |
| Engine — Scoring Rules + Due Date Hydration | 3 new scoring rules (DueDateScoringRule, ResourceUtilizationScoringRule, ResourcePreferenceScoringRule); due date hydration from orders onto chain-terminal tasks; scoringOverrides on solve request; scoring config in solve response | 2026-03-15 |
| UI — Settings Panel + Scoring Rules Editor | Left-nav Settings panel (General, Scoring Rules, Solver); scoring weight sliders with add/remove/toggle; mini summary in nav; scoringOverrides via solve request (not persisted); solver timing consolidation | 2026-03-15 |
| Demo Tuning + Resource Preference Fixes | EXCLUDED preference mode passthrough (hydrator→engine→API→UI); Solve Preview shows preference changes; resource preference overrides send all modes (not just non-AVAILABLE); unscheduled tasks show compatible resources + duration; non-primary resource filter fix; Stafford demo dataset tuning (EQ-003/EQ-004 windows + due dates) | 2026-03-15 |
| Solver 7 — Preserve Landscape | `preserveLandscape` flag (skip syncFromConfig), `protectOthers` (temp-pin non-targets), `expandChains`, direct window/priority mutation endpoints (`PATCH tasks/:key/window`, `PATCH tasks/:key/priority`), task snapshot/rollback, landscape hash | 2026-03-17 |
| Solver 8 — Disjunctive Graph Phase A | DisjunctiveGraph engine class with critical path computation + multi-resource support; `GET /ctp/critical-path` + per-task slack/isOnCriticalPath in solve response; Analytics critical path KPIs + detail view; Gantt critical path toggle; task detail slack section; task table slack column; AI `get_critical_path` tool; Overview KPI card; WhereTo critical path banner | 2026-03-17 |
| Currency Locale Support | `currency` field on all tenant locale.json (NZD for Stafford, USD for rest); `fmtCurrency` frontend helper using Intl.NumberFormat | 2026-03-19 |
| Engine — Cost Scoring Model | 5 cost scoring rules (ResourceCost, ChangeoverCost, Overtime, Lateness, Material); `hourlyRate` on resources, `cost` on state changes, `latenessPenaltyPerDay` on orders, `unitCost` on materials; grouped scoring editor; cost KPIs in Analytics; per-task + schedule-level cost in solve response | 2026-03-20 |
| Sprint 22 — Schedule Configurations | Named saveable config bundles (scoring + strategy + tier); CRUD backend + UI manager tab + toolbar config switcher dropdown; compare view with color-coded diffs; Settings Panel integration (modified tracking, Save/Save As/Reset); `configurationKey` on solve request; Stafford 3 configs seed data; Duplicate-only creation (no Add) | 2026-03-21 |
| AI Sprint 3 — Recommendation Engine | `POST /ctp/diagnose` (root cause classification, ranked recs with tradeoffs); `POST /ctp/apply-recommendation` (command sequencer with staleness check + rollback); compound recs (window+redirect, bump+move, redirect-others); AI `diagnose_tasks` tool; token optimization — UI executes fixes via action buttons (55% token reduction) | 2026-03-23 |
| UI Sprint 23 — Unified Filter Bar | 4-row labeled filter bar (Status/When/Work/Where); ResourceHierarchyBrowser (Work Center → Type → Resource tree with checkboxes + utilization bars); AttributeSearch with autocomplete; Rush status chip; active filter summary with Clear all; resource attributes in solve response | 2026-03-23 |
| Engine — Commitment Stack | 6-layer commitment model (Running, On Hold, Dispatched, Pinned, Planned, Unscheduled); new task fields; solver respects layers 1-4 as fixed | 2026-03-27 |
| Solver 9 — Two-Pass Solve | Pass 1 anchors committed tasks (completed/running/on_hold/dispatched/pinned) at positions before solver Pass 2+3; clean API/engine split (classify in ctp.service, anchor in basescheduler); resource hierarchy filter fix (assigned vs compatible); Gantt replay anchor steps | 2026-03-27 |
| UI — Commitment State Machine | Merged status badge (8 levels with icons/colors); `deriveTaskStatus` with local override awareness; `canTransition` guards with toast messages; contextual toolbar (level-count approach, zero-count buttons hidden); Gantt context menu per commitment level; revert-dispatch endpoint; bulk count fix; Extend Window dialog (+1h/+4h/+1d/+2d/+1w presets, queue-aware); Hold dialog (reason + held-since + estimated resume presets, queue-aware); `holdStart` audit field on task model | 2026-03-29 |
| Resource Downtime | MAINTENANCE assignments (add/end/list/all); amber Gantt stripes; indefinite sentinel; agenda split around downtimes; Downtime History in detail + agenda panels; netAvailable subtracts MAINTENANCE; preserveLandscape solve design (unschedule planned before solver, recompute=true); bulk actions for unscheduled/infeasible (Schedule, Resource Pref, Extend Window, Rush); WhereTo + Resource Pref in context menu for infeasible | 2026-03-30 |

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
| Engine — Attribute-Based Resource Matching | Hard-filter preferences by attribute requirements | `requiredAttributes` on task slots, `AttributeMatcher` engine, rejection logging, bottleneck integration. Acme healthcare proof case. Makes AI recommendations correct. CC-ready prompt exists. |
| Data Integration — Phase 1 Inbound | Published schema + sync endpoint + CSV upload | `POST /v1/state/sync`, column mapper with saved profiles, import wizard, downloadable templates. Spec complete. |
| Data Integration — Phase 2 WIP Sync | Actuals + resource status | `POST /v1/state/wip-sync`, `PATCH /state/tasks/:key/wip`. Populates commitment stack fields from external systems. Spec complete. |
| UI — Action Queue | Batch command builder | Stage multiple actions and execute atomically via `POST /ctp/execute`. Presets/macros for common scenarios. Spec complete. |
| UI Sprint 24 — Gantt Resource Filtering | Filter Gantt rows by WHERE selection | Lift hierarchy selection state to ScheduleTab, pass to GanttChart, hide non-matching resource rows. |
| Solver Phase B — Metaheuristic Improvement | Tabu search + ILS on disjunctive graph | Critical-block neighborhood moves on Phase A graph. Powers Thorough (5-30s) and Best Quality (30s-5m) strategy tiers. Language TBD (TypeScript or C#). |
| UI Sprint 14 | Error Display & API Error Handling | Surface engine errors in UI instead of generic 500 |
| UI Sprint 13 | Resource Explorer | Calendar/Agenda sub-views under Schedule tab |

## Backlog

| Sprint | Name | Blocked By |
|--------|------|------------|
| ~~UI Sprint 18~~ | ~~Solve Replay~~ | Done (2026-03-08) |
| Solver Prompt 2 | Snapshot/Restore | May not be needed — Phase 3 replaced backtracking approach |
| Solver Prompt 3 | Balanced Strategy (Bump Backtracking) | Evaluate if still needed post-Phase 3 |
| Solver Prompt 4 | Stress Tests — Quick vs Chain | Phase 3 stable |
| Solver 5 | CP-SAT Global Optimizer | Replace greedy selection with OR-Tools CP-SAT for global combo optimization; C# exploration |
| Solver 9 — Phase B Tabu Search | Tabu search on disjunctive graph critical blocks | Depends on Phase A (done). Thorough tier: 100 iterations, 5-30s. Critical-block neighborhood (Taillard N7 / Nowicki-Smutnicki). |
| Solver 10 — Phase B ILS | Iterated Local Search (multi-pass) | Depends on Solver 9. Best Quality tier: perturbation + restart. 30s-5min. |
| Engine — Cost Analytics KPIs | Cost group in Analytics catalog | Depends on cost scoring rules. Total cost, cost by resource, cost by order, changeover cost, overtime premium. |
| Engine — Solve Snapshots | Store and compare solve outputs | Per-task assignments, scores, costs. Named snapshots with diff. Powers What-If comparison. |
| UI Sprint 6 | What-If Mode | Solve Snapshots (or simplified output comparison) |
| UI Sprint 7 | Time Fence | — |
| UI Sprint 8 | Task Swap | UI Sprint 4 |
| UI Sprint 9 | Capacity Adjustment | API work |
| UI Sprint 10 | Task Operations | API work |

## Tenants

| Tenant | Resources | Orders | Tasks | Status |
|--------|-----------|--------|-------|--------|
| Willoughby Manufacturing | ~8 machines + stations | ~25 work orders | ~50 tasks | ✅ Active |
| Acme Outpatient Healthcare | 2 ORs, 3 surgeons, 2 anesthesiologists, 3 nurses, 4 recovery bays | 13 cases | 39 tasks | ✅ Active (Phase 3) |
| HRMD Sports | 58 resources (courts, fields, equipment) | 77 orders | 141 tasks | ✅ Active (cadence) |
| Stafford Engineering | ~25 machines + operators | 15 orders | 100 tasks | ✅ Active (Greedy, job shop) |
| Summit Pharma | ~15 resources | 8 orders | ~30 tasks | ✅ Active |

## Parking Lot

See `parking-lot.md` for deferred items including:
- ~~**Attribute-based resource matching**~~ — promoted to Up Next (CC-ready prompt exists, Acme healthcare proof case)
- Negative maxGap (overlap support) — successor starts before predecessor ends
- Multi-lane support — explicit `lane: true` on non-primary resources
- Soft affinity scoring — prefer same nurse across chain phases
- `requiresPreds` deprecation — no longer needed, chain strategy + linkId handles it
- Solve time in API response — `solveTimeMs` + strategy name

## Dependency Map

```
SOLVER TRACK                          UI TRACK                              AI TRACK
────────────                          ────────                              ────────
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
                                └─────┼──→ Sprint 6: What-If (needs snapshots)
                                      │
✓ Engine: Cadence Profiles            ├──→ Sprint 9: Capacity Adjustment
✗ Solver 2.5: Reverted                │
✓ Phase 1: Chain Ordering             ├──→ Sprint 10: Task Operations
✓ Phase 2: Window Tightening          │
✓ Phase 3: Chain Context Engine      ✓ Sprint 11: Process Category
  + Bump-and-Retry                   ✓ Sprint 12: Advanced Filters
✓ Solver 7: Preserve Landscape        ├──→ Sprint 13: Resource Explorer
✓ Solver 8: Disjunctive Graph A       ├──→ Sprint 14: Error Handling
         │                          ✓ Sprint 15: Resource Agenda
         ├──→ Solver 9: Tabu Search  ✓ Sprint 16: WhereTo Resource Diversity
         │    (Phase B, TS or C#)   ✓ Sprint 17: Bottleneck Display       ✓ AI-1: Read-Only Chat
         │           │              ✓ Sprint 20: Conflict Categorization         │
         │    Solver 10: ILS             └──→ Sprint 18: Solve Replay     ✓ AI-2: Investigation Tools (7 tools)
         │    (Best Quality tier)          (needs Phase 3 steps)          + AI-2b: query_resources
         │                                                                       │
         └──→ Solver 5: CP-SAT                                           ✓ AI-2C: Chat Actions
              (C# / OR-Tools)                                                    │
                                                                           ✓ AI-3: Recommendations
                                                                                (diagnose + UI execute)
                                                                                     │
                                                                               └──→ UI: Action Queue
                                                                                    (batch command builder)

ENGINE SPRINTS (CURRENT + PLANNED)
──────────────────────────────────
✓ Cost Scoring Model (5 rules: ResourceCost, ChangeoverCost, Overtime, Lateness, Material)
✓ Schedule Configurations (named profiles, duplicate-only, compare view)
✓ AI Sprint 3 Recommendations (diagnose + apply sequencer + compound recs + token optimization)
✓ UI Sprint 23 Unified Filter Bar (4-row: Status/When/Work/Where, hierarchy browser, attribute search)
✓ Commitment Stack (6 layers: Running, On Hold, Dispatched, Pinned, Planned, Unscheduled)
✓ Solver 9 — Two-Pass Solve (anchor committed tasks before solver; hierarchy filter fix)
📋 Attribute-Based Resource Matching (CC-ready, Acme proof case)
   └──→ feeds into Bottleneck Display + AI explanation
📋 Data Integration Phase 1 (sync endpoint + CSV upload + column mapper + templates)
   └──→ Data Integration Phase 2 (WIP sync — populates commitment stack fields)
📋 UI Action Queue (batch command builder, presets/macros)
   └──→ reuses apply-recommendation command sequencer
📋 Scoring Dialog Nav (left-side click-to-scroll + pinned Add Rule)
✓ Currency Locale Support (fmtCurrency helper)

INFRA TRACK
───────────
✓ Logging 1: Backend Logger (memory/console/file/azure transports, debug endpoint)
  └──→ Logging 2: Frontend Debug Panel (planned)
```

## File Index

```
/docs/sprints/
  README.md                          ← You are here
  roadmap.md                         ← Overview of both tracks with timeline
  parking-lot.md                     ← Deferred items

  Engine Sprints:
  solver-1-ranked-contexts.md        ← Top-N ranked alternatives per task
  engine-scoring-rules-duedate.md    ← 3 new scoring rules + due date hydration (DueDate, ResourceUtilization, ResourcePreference)
  solver-2-snapshot-restore.md       ← Save/restore schedule state
  solver-phase3-complete.md          ← Chain context engine + bump-and-retry spec
  solver-phase3b-bump-retry.md       ← Bump-and-retry design (cross-chain conflict resolution)
  solver-3-balanced-strategy.md      ← Bump backtracking solver (evaluate post-Phase 3)
  solver-4-stress-tests.md           ← Quick vs Chain comparison scenarios
  engine-sprint-19-cleanup-foundation.md ← Correctness fixes, perf, SolutionState snapshot
  engine-cadence-profiles.md         ← Boundary-snap filtering (replaces PB-TIMESLOT)
  engine-sprint-chain-primary-anchor.md ← Primary-task-driven chain placement
  cpsat-integration-prompt.md          ← CP-SAT global optimizer exploration (C#, OR-Tools)
  solver-5-global-optimizer.md         ← Global optimizer spec
  solver-7-preserve-landscape-engine-prompt.md ← preserveLandscape, protectOthers, expandChains, window/priority endpoints, rollback
  solver-8-disjunctive-graph-design.md ← Phase A+B design: disjunctive graph, critical path, tabu search architecture
  disjunctive-graph-session1-prompt_1.md ← Session 1: graph construction, critical path computation, API endpoint
  disjunctive-graph-session2-prompt_1.md ← Session 2: analytics KPIs, AI get_critical_path tool
  disjunctive-graph-session3-prompt_3.md ← Session 3: Gantt highlighting, task detail slack, task table column
  cost-scoring-model-design.md           ← 5 cost rules design (ResourceCost, Changeover, Overtime, Lateness, Material)
  attribute-resource-matching-sprint.md  ← Attribute matching sprint prompt (CC-ready, Acme proof case)
  ai-recommendations-design.md           ← AI diagnose/apply pipeline, 8 action types, command sequencer
  ai-3-session1-diagnose-prompt.md       ← Session 1: diagnose endpoint, root cause, recommendation generators
  ai-3-session2-apply-prompt.md          ← Session 2: apply endpoint, command sequencer, rollback
  ai-3-session3-chat-wiring-prompt.md    ← Session 3: AI tool wiring, action buttons
  ai-diagnose-ui-execute-spec.md         ← Token optimization — AI diagnoses, UI executes (55% reduction)
  compound-recommendations-spec.md       ← Compound recs (window+redirect, bump+move, redirect-others)
  ui-action-queue-spec.md               ← Batch command builder, presets/macros, POST /ctp/execute
  preserve-landscape-engine-prompt.md    ← preserveLandscape, protectOthers, expandChains, window/priority endpoints
  edge-cases-state-management.md         ← 12 edge cases for multi-step operations + state management
  locale-currency-spec.md               ← Add currency to tenant locale config + fmtCurrency helper
  schedule-configurations-spec.md       ← Named solver profiles (scoring + strategy + tier + future fields); CRUD API + UI picker
  scoring-dialog-nav-spec.md            ← Scoring rules left-side nav + pinned Add Rule button + grouped display
  metaheuristic-scheduling-overview.docx ← 8-page overview document (executive summary, Phase A/B, cross-domain)
  stafford-demo-script.md               ← Demo script with critical path narration (5-Axis Mill bottleneck)
  commitment-stack-spec.md              ← 6-layer commitment model (Running, On Hold, Dispatched, Pinned, Planned, Unscheduled)
  solver-9-two-pass-solve-spec.md       ← Two-pass solve: anchor committed tasks (Pass 1) before solver (Pass 2+3)
  data-integration-design.md            ← Phase 1 (inbound sync + CSV) + Phase 2 (WIP sync), combined
  task-filter-hierarchy-attribute-spec.md ← Resource hierarchy browser + attribute search filter
  unified-task-filter-bar-spec.md       ← Four-row filter bar (Status, When, Work, Where)
  ui-19-versioning.md                    ← App versioning (footer, logo hover, /version endpoint)

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
  ui-20-conflict-categorization.md   ← Conflict type classification (availability/capacity/dependency)
  ui-scoring-rules.md                ← Settings panel with left-nav, scoring rules editor, solver stats

  AI Sprints:
  ai-1-readonly-chat.md              ← Read-only AI chat assistant with Anthropic proxy
  ai-2-investigation-tools.md        ← 7 investigation tools with tool-use loop
  ai-2b-query-resources-tool_1.md    ← query_resources tool with time-windowed availability
  ai-2c-chat-actions.md              ← Chat action buttons (original spec)
  ai-2c-chat-actions_1.md            ← Chat action buttons (updated spec with auto-collapse)

  What-If Sprints:
  what-if-sprint-1-ctp-query.md      ← Stateless CTP Query (clone-from-chain, AI tool, UI dialog)
  fix-ctp-needby-date.md             ← Need-by date & promise status quick fix

  Infrastructure:
  logging-1-backend.md               ← Pluggable LoggerService with transports + debug endpoint
  tenant-scoring-configs.md          ← All 5 tenant scoring.json configs with rationale
  scoring-rules-guide.md             ← Rule-by-rule guide with demo stories
```

## Review Cadence

After each sprint:
1. Demo the new capability
2. Review: Does it feel right? Is the interaction natural?
3. Adjust the next sprint based on what we learned
4. Reprioritize if a real planner scenario demands a different order
5. Update this README with new status

---

*Last updated: Mar 27, 2026 (Commitment Stack + Two-Pass Solve done — Attribute Matching + Data Integration + Action Queue + Phase B in Up Next)*
