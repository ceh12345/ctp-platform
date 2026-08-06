# Sprint Status

## Active

_None_

## Up Next

### 🎯 Next sprint sequence (downloading in order — Jun 2026)

Run in this order; specs downloaded one at a time for review.

1. **[Cross-WO Linking — Hydrator-Derived Group Precedence](SPRINT-cross-wo-linking.md)** — Hydrator wires task-level `prevLink` across Work-Order boundaries from the BOM tree (`parentOrderKey`) when the tenant sets `crossWOLinking: "bomParentChild"` (default `none`; Stafford opts in). Cross-WO links become just longer chains, so the **engine is unchanged**; partial scheduling respects them for free. Scope: config schema + enum validation, hydrator chain head/tail identification + cross-WO wiring per Group, Stafford config update, tests. Out: `explicit` mode, DAG-within-WO (`successorOf` one-successor limit), cross-Group precedence, UI. Open issue OI-1 (unscheduled predecessors during partial scheduling) flagged for a quick CC check. Small sprint, additive on `main`. **Spec downloaded; ready for review.**
2. **[Snapshot as Partitioned Read Surface](snapshot-read-surface-sprint.md)** — Solve writes a **partitioned** on-disk snapshot; UI reads a **<100 KB summary partition** on landing and **lazy-reads heavy detail** on tab entry. Kills the **16.6 MB landing payload** and the **double `solve-and-sync`** (from `investigation-ui-at-scale.md`). Partitions: summary (headline + bucketed per-resource utilization + alerts) / detail (full tasks, lazy) / calendars (~3.8 MB intervals, on-demand) / meta (id+timestamp). New `GET /v1/snapshot/{summary,detail,calendars,meta}`; `POST /ctp/solve` rewrites the snapshot and returns light meta. Overview renders a utilization heatmap from `summary` only (no tasks array). 4 phases, engine read path untouched. **Supersedes** the prior "Engine — Solve Snapshots" backlog item. **Spec downloaded; ready for review.**

> Basis doc for #2: [`investigation-ui-at-scale.md`](investigation-ui-at-scale.md) (read-only scale findings; the spec references it as `ui-scale-investigation.md` — same content, filename differs).

| Sprint | Name | Notes |
|--------|------|-------|
| [Parallel Processes Within a Chain](sprint-parallel-processes-wo-groups.md) | Engine support for concurrent tasks in one `linkId.name` (Work Order Groups) | **Design captured (2026-06-17), no code.** Code-traced findings: precedence is enforced by `sequence` adjacency not `prevLink`; availability eval is a read-only snapshot with commit-deferred consumption; qty/capacity already models pooled (`qty>1`) and unit (`qty=1`) uniformly (reusable = windowed draw, consumable = horizon). Proposed model: `sequence`-as-rank with barrier (diamond) semantics. Only true new work = rank-aware `propagateCombo`/anchor + hydrator topological leveling; resource correctness reuses existing `revertAvailable()`/`subtractEngine` primitives (intra-combo soft allocation), deferrable under a disjoint-resource assumption + qty-aware guard. **Open decision: clean diamonds (rank model) vs unequal/partial-dep branches (true `prevLinks` DAG).** Depends on WO Group entity. |
| [Staging Architecture](staging-architecture-design.md) | ETL staging folder + atomic-promotion symlink | Layer between "what Genius API returned" and "what the engine consumes." Timestamped snapshot folders under `/var/ctp/staging/<tenant>/`, `current` symlink for atomic promotion, `_metadata.json` + `_validation-report.json` per snapshot. Enables pre-live cleansing, instant rollback, audit trail, sync/process decoupling. Design captured; needs sprint draft after Allan/Kaleb review. Est. 1-2 days. |
| [Cycle Time on Tasks](sprint-cycle-time.md) | Per-unit `cycleTime` field on CTPTask | Preserves original standard duration (cycle time) separately from active scheduling `duration`. Stored as **seconds per unit** matching Stafford's `Formula: "HR/UN"`; `theoreticalDurationSeconds() = cycleTime × qty` derived helper. Null falls back to `duration.duration()`. Mapping rule from Genius `CycleTime` field with 0/null passthrough for design/QC tasks. API ships `cycleTimeSecondsPerUnit` (raw) + `theoreticalDurationSeconds` (derived); UI task detail shows both when distinct from scheduling duration. Unblocks CTP queries against in-progress order chains. Pairs with Stafford v3.2 FLOAT mapping flip. Spec: `sprint-cycle-time.md`. || Engine — UOM Conversion Table | Unit of measure conversion system + data model foundations | Two-tier: global (HR→s, LB→kg, DZ→EA) + product-specific (1 EA of Product X = 2.5 kg). COUNT→EA and TIME→seconds on ingest; weight/length/volume store in source units, convert at runtime. New `Core/uom.ts`, 9th data file `uom-conversions.json`, landscape integration. Stafford ETL needs this for duration calc (Genius HR/UN formula) and future BOM rollups. CC-ready prompt exists. |
| Data Adapter Layer — Phase 2 | REST adapter + Genius connector | `RestAdapter` with retry/timeout/auth; Genius response unwrapping (`{ "Result": [...] }`); Stafford `adapter.json` + `mapping.json`; field transforms (toUTC, concat, lookup, durationCalc, deriveWipState, deriveCommitment, hoursToSeconds); per-field error policies; test with live Genius API + mock-genius server. Depends on Mock Genius Server. |
| Mock Genius Server | Test harness for the Data Adapter | Standalone Fastify HTTP server in `tools/mock-genius/` that mimics the 4 Genius API endpoints. Three modes: static fixtures (scenario directories), failure injection (500/timeout/malformed/auth/rate-limit via control endpoints), recording mode (proxy real Genius → capture to disk). 13 pre-built scenarios (stafford-clean, empty, bad-data-*, chain-cycle, large-dataset, paginated). Baked into a Docker image for CI (GitHub Actions sidecar). Adapter integration test suite runs against it. ~3-4h CC work (3 sessions). Depends on Data Adapter Layer. |
| Multi-Environment Tenant Config | `base.json` + `env.{local,fixtures,dev,prod}.json` overlays driven by `CTP_ENVIRONMENT` | Single env var swaps mock-genius / fixtures / Stafford dev / Stafford prod without editing tenant configs. Deep-merge (env overrides base), env-var credential resolution (`${STAFFORD_DEV_USERNAME}` etc.), startup validation, fail-loud on missing/unrecognized values. Anchored to Stafford four-environment workflow. Spec: `sprint-multi-environment-config.md`. Depends on bearer-session auth in RestAdapter. ~1.5-2 days. |
| Engine — Setup/Teardown Cascade Unschedule Fix | Orphaned SETUP/TEARDOWN tasks after bulk unschedule | Engine-level chain-scoped sweep: if a chain has no remaining scheduled PROCESS tasks after unschedule, all its SETUP/TEARDOWN tasks are removed too. API response includes cascade counts. UI shows confirmation dialog + toast + filter chip to reveal affected tasks. Spec: `sprint-setup-teardown-unschedule-fix.md`. |
| Data Integration — Phase 2 WIP Sync | Actuals + resource status | `POST /v1/state/wip-sync`, `PATCH /state/tasks/:key/wip`. Populates commitment stack fields from external systems. Depends on Data Adapter Layer. |
| Engine — Attribute-Based Resource Matching | Hard-filter preferences by attribute requirements | `requiredAttributes` on task slots, `AttributeMatcher` engine, rejection logging, bottleneck integration. Acme healthcare proof case. Makes AI recommendations correct. CC-ready prompt exists. |
| UI — Action Queue | Batch command builder | Stage multiple actions and execute atomically via `POST /ctp/execute`. Presets/macros for common scenarios. Spec complete. |
| UI Sprint 24 — Gantt Resource Filtering | Filter Gantt rows by WHERE selection | Lift hierarchy selection state to ScheduleTab, pass to GanttChart, hide non-matching resource rows. |
| UI Sprint 14 | Error Display & API Error Handling | Surface engine errors in UI instead of generic 500 |
| UI Sprint 13 | Resource Explorer | Calendar/Agenda sub-views under Schedule tab |

## Done

| Item | Summary | Date |
|------|---------|------|
| Job Shop Technique Bake-off v1 | `SPRINT-jobshop-technique-bakeoff.md`. Scheduler-seam comparison harness with three contracts (determinism via placement fingerprint, feasibility-as-gate, discrimination). 8 techniques × 3 tenants → **2 distinct outcomes everywhere**: ATC/DBR/Slack proven inert on chained data (`basescheduler.ts:884`). Chain-vs-task is data-dependent (task-level +4 placed on acme, −18 on stafford-slim-100). Found `IdFactory` nondeterminism (`Date.now()` + `Math.random()` in synthesized keys). Adds seeded RNG (`Models/Core/rng.ts`); no new algorithms | 2026-08-06 |
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
| [Rolling Horizon](rolling-horizon-spec.md) | New horizon.json format (`start`/`maxDays`/`pastDueExtensionDays`); `resolveHorizonStart` (NOW/NOW±Nd/fixed ISO); task bucketing (past_due/active/near_horizon/beyond); past due window extension; past due ref = horizonStart (works for fixed + rolling); per-task isPastDue/pastDueDays/horizonBucket fields; UI "Nd late" + "Deferred" badges; Past Due + Deferred filter chips; remove CTPRollingHorizon; migrate all 6 tenant horizon.json files | 2026-03-31 |
| Optimization Session 1 — Mutable DisjunctiveGraph | `Engines/Optimization/` toolkit; `types.ts` (TabuConfig, TabuSearchResult, NeighborhoodMove, MoveEvaluation, CriticalBlock, SwapRecord, TranslationResult, TaskDiff); extended DisjunctiveGraph with adjacency arrays (disjPred/Succ, conjPred/Succ), isFrozen, changeoverBefore, processKey; Kahn's topo sort in recomputeCriticalPath; cycle-safe (criticalPath=null); swapOnResource + reverseSwap; recomputeChangeovers; hasCycle; clone; 43 tests | 2026-04-04 |
| Optimization Session 2 — Tabu Search | `tabusearch.ts`: TabuList (reverse-move tabu, tenure pruning, backward-scan early exit); generateNeighborhood (Taillard N7: block_first/block_last/internal, frozen guard); evaluateMove (swap→changeover→cycle→critical path→reverse, graph fully restored); tabuSearch main loop (aspiration criterion, worsening moves, stagnation/time/iter stopping); 29 tests | 2026-04-04 |
| Optimization Session 3 — Graph Translation | `graphtranslation.ts`: topologicalSort (Kahn's, head-pointer queue); findClosestStartTime (exact containment + closest edge); applyOptimizedGraph (unschedule→topo sort→reschedule at earliestStart, changeovers via scheduleStateChangeTask mirroring basescheduler setup/teardown); computeDiff (60s threshold, sorted by |delta|); 23 tests | 2026-04-04 |
| Optimization Session 4 — Scheduler Integration | TabuSearchScheduler + ILSScheduler wired into full pipeline; `optimizationRan` field (muted no-improvement banner); `elapsedMs` in optimization result; `tier` in solve request body + result; stale closure fix (selectedTier deps); critical path label fix; Settings → Solver optimization grid; 28 integration tests + chain integrity; 846 total tests | 2026-04-04 |
| Data Adapter Layer Phase 1 | IDataAdapter interface + FileAdapter + MappingEngine (identity) + SyncService + IntegrationModule; StateService `applyTransformed()` seam; ConfigService `getAdapterConfig()`/`getMappingProfile()`; zero behavioral change — 858 tests pass | 2026-04-10 |
| Bulk Schedule/Unschedule + Chain Auto-Expansion | Unified `POST /ctp/tasks/schedule` + `/unschedule` endpoints; service-layer backward + forward chain walks for reporting scope; `canExpand()` predicate; single-task 404 fix; UI confirmation dialog + expansion-aware toast; `scheduleBulk`/`unscheduleBulk` + `sweepChainOrphanedStateChangeTasks` on engine | 2026-04-13 |
| Optimization Session 5 — Batch Optimization API | `POST /v1/ctp/optimize` async job with ILS loop + event-loop yielding; `GET /:jobId` poll (progress per pass); `POST /:jobId/accept` (drift guard via landscapeHash, translate-on-demand); `POST /:jobId/reject`; bestGraph stored not landscape clone; Optimization DisjunctiveGraph promoted to primary engine export (replaces read-only version); critical path always returned in solve response at all detail levels; UI critical path badge ungated; 846 tests; Stafford: 71.25h → 59.50h (16.49% improvement, 21s) | 2026-04-05 |
| [Solver Live Convergence Chart + KPI Savings](../optimization/sprints/solver-live-convergence-chart.md) | Per-iteration `onSample` callback on `tabuSearch` (new best + heartbeat + first/last); `IterationSample` type; `OptimizeService` samples buffer (1000-cap, preserves isNewBest); `GET /v1/ctp/optimize/:jobId?since=N` incremental fetch; **DTO fix** — added `@IsOptional` + `@IsNumber`/`@IsString`/`@Min`/`@Max` decorators to StartOptimizeDto so global `ValidationPipe({whitelist:true})` stops silently stripping `passes`/`maxIterations`/`stagnationLimit`/`sampleEveryN`/`perturbStrength`/`timeBudgetSeconds`/`freezeHorizon`; per-pass `convergenceReason` + `elapsedMs` in `passResults`; `SavingsEstimate` field on result (configured/currency/ordersImproved/lateDaysAvoided/estimatedDollars) computed from origEnd (node.endW) vs optEnd (earliestStart+duration) grouped by chainKey, applied per-order penalty math with graceDays + cap; new `IKpiRates` interface + `ConfigService.getKPIRates()` reading `kpis/rates.json`; seeded defaults in all 7 tenants ($500/day, USD, 0 grace, $50/hr labor); `cloneTenant` seeds rates.json defensively; new Admin → Live Optimization settings page (Expert level) with preset dropdown (Quick/Default/Aggressive/Custom), live SVG convergence chart (best-so-far + current iteration series, baseline reference, pass boundaries, per-pass delta labels, color-coded legend), fullscreen mode with viewport resize + Esc, per-pass breakdown table (makespan/delta/iterations/stop reason/time), SavingsCard ($ with orders-improved + late-days-avoided, unconfigured → "please configure" prompt). 982 tests pass. | 2026-04-18 |
| [Code Optimization — Engine Runtime](CODE-OPTIMIZATION-SPRINT.md) | Engine runtime perf sprint landed via `feature/engine-optimization` (merge `23f1a3b`). P0/P1/P2 ticket fixes across `chaincontextengine`/`availableengine`/`starttimeengine`/`setengine`/`combinationengine`/`schedulecontext`; committed `benchmarks/` harness with built-in correctness gates (A/B deep-equal) + per-ticket speedup thresholds. **Verified behavior-preserving:** all 5 benchmark correctness gates PASS; full regression 1206/10; schedule output byte-identical to pre-merge `main` across 5 tenants (acme-outpatient, hrmd-rec-sports, stafford-slim-100, summit-pharma, demo-manufacturing). Speedup targets: ticket-01/03/04 pass; ticket-02 (1.19× vs 10×, pre-existing) and ticket-06 (~2× borderline) landed as-is — perf-target misses, not correctness. | 2026-06-18 |
| [Engine — Pred/Succ Edge-List Refactor](sprint-engine-edge-list-refactor.md) | Replaced implicit `i±1`/single-`prevLink` precedence with explicit in-memory `preds[]`/`succs[]` edge lists; every precedence decision is now `max(pred ends)`/`min(succ starts)`. **Phase 0** adjacency foundation (`Models/Entities/adjacency.ts`: `buildAdjacency`/`predsOf`/`succsOf`/`topoOrder`/`reachableKeys`). **Phase 1** mechanical site conversion in 4 batches — `propagateCombo`, `basescheduler` (`tightenWindowFromPredecessor`/retry-skip/`addChainPredecessors`), `landscape` (constraint propagation + `hydrateDueDates` multi-sink terminal detection), selection sites (`chainfirstfit` topoOrder, `chainneighborhood` ready-frontier, `timing` reachability). **Phase 2** `assignStartTimes` redesigned from single-spine anchor to topological backward(ancestors, latest)+forward(descendants & siblings, earliest) fill — reduces exactly to the old walk on linear data. **Phase 3** DAG capability fixtures (`assign-start-times-dag.test.ts`: diamond, multi-sink fork, deep unequal branches, exact-window). **Verified behavior-preserving:** suite 1219/10, byte-identical on tenant fixtures incl. acme multi-head; strict tsc clean; ticket-03 benchmark correctness gate PASS; live UI smoke test on acme-outpatient (20/20 engine edges, 76.92%) and stafford-slim-100 (68/68 engine edges incl. generated/pinned tasks, 90.91%) — 0 precedence violations. Deferred to a future sprint: `dependencylookahead`/`greedyneighborhood` (sequence contract pinned by unit tests, production-dead). Unblocks parallel WO Groups as a producer+semantics change. | 2026-06-20 |
| [Processing Sequences — Tenant-Defined Demand Prioritisation](SPRINT-processing-sequences.md) | Tenant-configurable **named demand-priority sequences** replacing the hardcoded inter-Group priority rule. Hydrator computes per-WO `processingRanks[sequenceName]` at sync; engine sorts demand by ascending rank at solve start; active sequence selectable per solve (Group rank = head WO). UI **processing-sequence selector** exposes + selects the demand sort (`8d41694`). Platform default `order.dueDate asc`; tenants declare their own explicitly (`5a5df72` demo-manufacturing, `ed5e2b0` backfill across existing tenants). **Fix** (`01716db`): platform default is only listed when a tenant declares no sequences of its own — stops the duplicate "Work Order Priority" entry — applied to both `/data/strategies` and solve-result `availableSequences`. **Stafford** (`3fe668e`): added `wo-priority` (`order.priority asc`) as a second selectable sequence alongside delivery-date-first (default stays delivery-date-first) across all Stafford tenants. Verified: demo-manufacturing → [Work Order Priority]; slim-100 → [Delivery Date Priority]. | 2026-06-24 |
| Engine — Accurate Infeasibility Reporting | Reworked *why* unscheduled tasks fail so the Conflicts page names the real cause instead of a misleading resource bottleneck. **Scheduled-task hygiene** (`scheduleengine`): `clearErrors()` on commit so a placed task never carries a stale chain "no valid placement" stamp. **Detection-time attribution** (`chaincontextengine`): when `evaluateChain` finds a chain task with zero feasible contexts, the report is attributed to *that* binding task (bottleneck from its own resources, flagged `attributed`) and every other chain task is marked "blocked by infeasible <task>"; only genuine non-pinned solvable tasks are blamed (pinned actuals have no contexts by design). **Post-solve refinement** (`basescheduler.reclassifyChainInfeasibility`) for the combo/propagation-failure path where no single empty-context task exists: **horizon** (window capped by horizon end and smaller than the work it needs — names the task + shortfall) and **dependency** cascade (blocked by an unscheduled predecessor); skips `attributed` tasks. **classifyConflict fallback** → `capacity` not `dependency` (a bottleneck was identified). New `ConflictType: 'horizon'` + Conflicts-page Horizon chip/group/badge (`web`). Verified 7 tenants: scheduling counts unchanged, every chain surfaces a root cause + cascade (acme C011-PROC = capacity "Nurse Team", SETUP/REC blocked-by-PROC; stafford-slim-100 F-16 = horizon 96h/14.5h). Suite 1219/10, strict tsc clean. Commits `f485740`, `38c11b0`, `03fe6ce`. | 2026-06-21 |

### Phase 3 Session Fixes (Mar 6)

1. **Priority hydration** — URGENT/ELECTIVE maps to `task.priority` not undeclared `task.rank`
2. **Forward simulation in assignStartTimes** — full chain validation with backward-derived candidates from successor start-time nodes
3. **evaluateChain integration** — tries combos in score order, returns first with valid placement
4. **Infeasible over violated** — chains with maxGap that can't place are marked infeasible, no greedy fallback
5. **`unscheduleChain`** — added `task.window?.reset()` before unscheduling
6. **Removed truncation** — `truncateContextStartTimes` was deleting start-time nodes needed by commitChain
7. **Combo selection** — sorts by earliest assignedStart then score (Monday OR-02 beats Tuesday OR-01)

## Backlog

| Sprint | Name | Blocked By |
|--------|------|------------|
| Engine — Partial-Chain Scheduler | "Planner controls scope" subclass of CTPBaseScheduler that only commits tasks in submittedKeys. Ship current sprint (auto-expand + full reporting). Future sprint: subclass overrides `scheduleChainPass` to skip commitChain for tasks outside submittedKeys; service-layer `schedule()` instantiates the new subclass; forward walk removed from `expandChainForSchedule` (engine now limits scope instead of service expanding it). Dialog, toast, API shape, and tests are unaffected. Also fix the deeper bug: `scheduleBulk` should collect results for all state-changed tasks post-solve, not just input-set tasks. | Chain expansion sprint (current) |
| ~~UI Sprint 18~~ | ~~Solve Replay~~ | Done (2026-03-08) |
| Solver Prompt 2 | Snapshot/Restore | May not be needed — Phase 3 replaced backtracking approach |
| Solver Prompt 3 | Balanced Strategy (Bump Backtracking) | Evaluate if still needed post-Phase 3 |
| Solver Prompt 4 | Stress Tests — Quick vs Chain | Phase 3 stable |
| Solver 5 | CP-SAT Global Optimizer | Replace greedy selection with OR-Tools CP-SAT for global combo optimization; C# exploration |
| Solver 9 — Phase B Tabu Search | Tabu search on disjunctive graph critical blocks | Depends on Phase A (done). Thorough tier: 100 iterations, 5-30s. Critical-block neighborhood (Taillard N7 / Nowicki-Smutnicki). |
| Solver 10 — Phase B ILS | Iterated Local Search (multi-pass) | Depends on Solver 9. Best Quality tier: perturbation + restart. 30s-5min. |
| Engine — Cost Analytics KPIs | Cost group in Analytics catalog | Depends on cost scoring rules. Total cost, cost by resource, cost by order, changeover cost, overtime premium. |
| ~~Engine — Solve Snapshots~~ | Store and compare solve outputs | **Superseded by [Snapshot as Partitioned Read Surface](snapshot-read-surface-sprint.md)** (Up Next #3) — redesigned around the UI-scale findings into a partitioned read surface. Original: per-task assignments, scores, costs; named snapshots with diff; powers What-If comparison (the diff/compare angle can fold back in later). |
| UI Sprint 6 | What-If Mode | Solve Snapshots (or simplified output comparison) |
| UI — Cross-WO Gantt arrows | Predecessor arrows between WO rows on the Case/Order Gantt | **Pure frontend** — cross-WO edges + component membership are already on the hydrated model after the Cross-WO Enforcement sprint; do NOT re-scope as engine work. Split out of `SPRINT-cross-wo-enforcement-rev.md` (D3). |
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
| Stafford Engineering | ~25 machines + operators | 15 orders | 100 tasks | ✅ Active (Greedy, job shop). ETL mapping spec v0.2 — Genius REST API field mapping, UOM + commitment + lagSeconds. Data Adapter Layer will pull live from Genius API. Kickoff pending. |
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
📋 Engine — UOM Conversion Table (CC-ready, Stafford ETL dependency)
   └──→ feeds into Data Adapter Layer (duration + BOM conversions in MappingEngine)
✓ Data Adapter Layer Phase 1 (IDataAdapter + FileAdapter + MappingEngine identity + SyncService; zero behavioral change)
📋 Data Adapter Layer Phase 2 (RestAdapter + Genius connector; CC-ready prompt exists)
   ├──→ CsvUploadAdapter (future — import wizard)
   ├──→ Data Integration Phase 2 (WIP sync — populates commitment stack fields)
   └──→ Mock Genius Server (tools/mock-genius/; Fastify; 3 modes; 13 scenarios; Docker + CI)
        └──→ Adapter integration test suite (RestAdapter against mock, 16 error scenarios)
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
  SPRINT-jobshop-technique-bakeoff.md ← Job shop technique comparison harness (v1, measurement only)
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
  sprint-parallel-processes-wo-groups.md ← Design note: concurrent tasks in one chain (sequence-as-rank + soft-allocation); code-traced engine findings, scope decisions, work items, open topology question
  SPRINT-cross-wo-linking.md          ← [Next-sprint #1] hydrator wires cross-WO prevLink from BOM tree (parentOrderKey) when tenant crossWOLinking="bomParentChild"; engine unchanged; default none, Stafford opts in
  SPRINT-processing-sequences.md      ← [Next-sprint #2] tenant-configurable named demand-priority sequences; composite weighted ranking (path-expr criteria + importance/weight); hydrator writes processingRanks[seq] per WO; engine sorts by rank; default order.dueDate asc
  snapshot-read-surface-sprint.md     ← [Next-sprint #3] partitioned solve snapshot; UI reads <100KB summary on landing + lazy detail on tab entry; kills 16.6MB payload + double solve-and-sync; GET /v1/snapshot/{summary,detail,calendars,meta}; supersedes "Engine — Solve Snapshots"
  investigation-ui-at-scale.md        ← Read-only findings: UI at ~2000 tasks (slim-2000) — full-array Gantt, no virtualization/memo, 16.6MB solve payload, double solve-and-sync on load; A-E report
  sprint-engine-edge-list-refactor.md ← DONE (2026-06-20): replaced implicit i±1/prevLink precedence with explicit preds[]/succs[] edge lists (behavior-preserving); Phase 0 adjacency.ts foundation, Phase 1 (4 batches) mechanical conversion, Phase 2 assignStartTimes topological fill, Phase 3 DAG fixtures (packages/engine/tests/engine/assign-start-times-dag.test.ts)
  cpsat-integration-prompt.md          ← CP-SAT global optimizer exploration (C#, OR-Tools)
  solver-5-global-optimizer.md         ← Global optimizer spec
  solver-7-preserve-landscape-engine-prompt.md ← preserveLandscape, protectOthers, expandChains, window/priority endpoints, rollback
  solver-8-disjunctive-graph-design.md ← Phase A+B design: disjunctive graph, critical path, tabu search architecture
  disjunctive-graph-session1-prompt_1.md ← Session 1: graph construction, critical path computation, API endpoint
  disjunctive-graph-session2-prompt_1.md ← Session 2: analytics KPIs, AI get_critical_path tool
  disjunctive-graph-session3-prompt_3.md ← Session 3: Gantt highlighting, task detail slack, task table column
  optimization-session3-graphtranslation.md ← Session 3: graph-to-landscape translation (topologicalSort, findClosestStartTime, applyOptimizedGraph, computeDiff)
  ../optimization/sprints/solver-live-convergence-chart.md ← Live convergence chart admin page (per-iteration sample streaming, preset dropdown, delta labels, per-pass table, Savings card backed by kpis/rates.json)
  cost-scoring-model-design.md           ← 5 cost rules design (ResourceCost, Changeover, Overtime, Lateness, Material)
  attribute-resource-matching-sprint.md  ← Attribute matching sprint prompt (CC-ready, Acme proof case)
  sprint-uom-conversion-table.md        ← UOM conversion table + data model foundations (CC-ready, Stafford ETL)
  sprint-data-adapter-layer.md          ← Pluggable data source abstraction (IDataAdapter, MappingEngine, SyncService; CC-ready)
  sprint-mock-genius-server.md          ← Mock Genius API server (Fastify, 3 modes, 13 scenarios, Docker + CI integration)
  sprint-multi-environment-config.md    ← base.json + env.{local,fixtures,dev,prod}.json overlays driven by CTP_ENVIRONMENT; deep-merge with env-var credential resolution
  stafford-ctp-etl-mapping.md           ← Stafford Genius ERP → CTP field mapping (kickoff doc)
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
  data-integration-design.md            ← Phase 1 (inbound sync + CSV) + Phase 2 (WIP sync) — superseded by sprint-data-adapter-layer.md
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

*Last updated: June 24, 2026 (Processing Sequences landed: tenant-defined named demand-priority sequences; hydrator processingRanks + engine demand sort + UI selector; platform-default dedup fix; Stafford gains wo-priority as a 2nd selectable sequence. Pushed to origin/main @ 3fe668e.)*
