# Engine Code Review — Solve Flow, Architecture, and Roadmap Readiness

**Scope:** Full review of the scheduling engine covering: detailed solve flow trace, architectural observations, optimization opportunities, and readiness for advanced algorithms (tabu search, ILS, multi-objective).

**Files reviewed:** `ctp_service.ts`, `basescheduler.ts`, `chaincontextengine.ts`, `scheduleengine.ts`, `scoringengine.ts`, `starttimeengine.ts`, `availableengine.ts`, `baseengine.ts`, `combinationengine.ts`, `statechangeerengine.ts`, `engines.ts`, all 5 neighborhood strategies

---

## Part 1: Detailed Solve Flow

### 1.1 API → Engine Entry

```
POST /v1/ctp/solve (with overrides)
│
└→ CTPService.solve()                              [ctp_service.ts:86]
   ├── stateService.syncFromConfig()                 ← reload fresh landscape every solve
   ├── Validate strategy against tenant config
   ├── Apply overrides in order:
   │   ├── 1a. taskUnschedules                       ← free capacity first
   │   ├── 1b. orderModes (INCLUDE/EXCLUDE/LOCKED)
   │   ├── 1c. taskPins
   │   ├── 1d. taskExcludes
   │   ├── 1e. resourceModes
   │   ├── 1f. materialModes
   │   ├── 1g. resourcePreferenceOverrides
   │   ├── 1h. priorityOverrides
   │   └── 1i. windowOverrides
   ├── landscape.propagateConstraints()              ← forward/backward window tightening
   ├── Build CTPScoring from config
   ├── Create CTPScheduler, init landscape/settings/scoring
   ├── buildTaskList() → filter/sort by priority
   └── scheduler.schedule(taskList) → returns EngineSolveResult
       └── extractResults() → builds full API response
```

### 1.2 Scheduler Main Loop

```
CTPBaseScheduler.schedule(tasks)                    [basescheduler.ts:526]
│
├── Reset: processed=false, errors=[] on all tasks
├── Auto-detect chains: any task with linkId → requiresPreds=true
├── initScheduling(tasks)                           ← subclass builds processes, applies batch rules
├── assert()                                        ← validate landscape + settings + scoring
├── reComputeScheduleContexts()                     ← initial pass (no-op if no contexts yet)
│
├── PASS 1: MANUAL PRIORITY                         [line 621]
│   ├── Collect tasks with manualPriority > 0
│   ├── Sort by manualPriority (lower = first)
│   ├── Auto-include chain predecessors
│   └── Schedule via scheduleTasksChainAware()
│
├── PASS 2: SOLVER                                  [line 572]
│   ├── requiresPreds=true → scheduleChainPass()    [line 692]
│   │   ├── Get chains sorted by priority
│   │   ├── For each chain:
│   │   │   ├── Single-task → scheduleTasksChainAware()
│   │   │   └── Multi-task → ChainContextEngine
│   │   │       ├── explodeScheduleContexts()
│   │   │       ├── reComputeScheduleContexts()
│   │   │       ├── evaluateChain()
│   │   │       │   ├── getContextsPerTask()
│   │   │       │   ├── detectLanes()
│   │   │       │   ├── buildLaneCombos() + cross-product
│   │   │       │   ├── propagateAll() → forward + backward per combo
│   │   │       │   ├── Filter infeasible
│   │   │       │   ├── scoreChainCombos()
│   │   │       │   └── Sort by score → try assignStartTimes → return first valid
│   │   │       ├── commitChain()
│   │   │       └── scheduleStateChanges() per task
│   │   ├── scheduleStandaloneTasks() → greedy for non-chain
│   │   └── bumpAndRetry() → Pass 2 for failed chains
│   │       ├── findBlockers()
│   │       ├── selectBumpCandidate()
│   │       ├── Unschedule blocker + state changes
│   │       ├── retryChain(failed)
│   │       └── retryChain(bumped)
│   │
│   └── requiresPreds=false → greedy loop
│       └── nextTasksToSchedule → explode → schedule → repeat
│
└── Build CTPSolveResult
```

### 1.3 Per-Task Scheduling Pipeline

```
For a single task (greedy or chain-aware fallback):

explodeScheduleContexts(task)                       [basescheduler.ts:135]
├── Get effective preferences per resource requirement
├── ResourceCombinationEngine.resourcecombinations() ← cartesian product
├── For each combo: create ScheduleContext with CTPResourceSlots
└── Register in ScheduleContexts (byTask + byResource indexes)

reComputeScheduleContexts()                         [basescheduler.ts:175]
├── ComputeScheduleContextsAgent.solve()
│   ├── For each context needing recompute:
│   │   ├── Compute start times per resource slot via CTPStartTimeEngine
│   │   ├── Intersect start times across slots (CommonStartTimesAgent)
│   │   ├── Apply state change durations (StateChangeEngine)
│   │   └── Store CTPStartTimes on the slot
│   └── ScoringEngine.computeScores() → blended score per context
├── Apply timing (if requiresPreds)
└── BestScoreForTaskAgent.solve() → pick best score per task

selectBestScheduleForTask(task)                     [basescheduler.ts:259]
└── PickBestScheduleAgent.solve() → returns BestScheduleContext

scheduleTask(task, best)                            [basescheduler.ts:325]
├── ScheduleEngine.schedule()
│   ├── Compute actual start/end with processChangeDuration offset
│   ├── task.state = SCHEDULED, task.scheduled = interval
│   └── Add CTPAssignment to each resource
├── scheduleStateChanges() → create SETUP/TEARDOWN if needed
└── scheduleContexts.updateRecompute() → cascade dirty flags
```

### 1.4 Chain Context Engine Pipeline

```
ChainContextEngine.evaluateChain()                  [chaincontextengine.ts:75]
│
├── Step 1: getContextsPerTask() → Map<taskKey, ScheduleContext[]>
│   └── Filter to contexts with feasible start times
│
├── Step 2: detectLanes() → LaneDefinition[]
│   └── Scan isPrimary resources, find overlapping preferences across tasks
│
├── Step 3: buildLaneCombos() → ChainContextCombo[]
│   ├── Per lane, per lane resource key:
│   │   ├── Filter lane tasks to contexts using that resource
│   │   ├── Float tasks keep all contexts
│   │   ├── capContextSets() → limit before cross-product
│   │   └── crossProductContexts() → cartesian product
│   └── Or simpleCrossProduct() if no lanes
│
├── Step 4: propagateAll() → forward + backward per combo
│   ├── Forward: floor (pred end → succ start), ceiling (maxGap)
│   ├── Backward: pred latest start from succ, pred earliest start from maxGap
│   ├── With processChangeDuration offsets
│   └── Mark infeasible if eStartW > lStartW after propagation
│
├── Step 5: Filter infeasible
│
├── Step 6: scoreChainCombos() → blended score + gap penalty
│
├── Step 7: Sort by score → try assignStartTimes for each
│   ├── Forward simulation with backward-derived candidates
│   ├── Validates maxGap compliance at assignment time
│   └── Returns first combo where all tasks get valid placement
│
└── Return winning combo or null
```

---

## Part 2: Architectural Observations

### 2.1 Strengths

**Clean separation of concerns.** The engine has clear layers: intervals (CTPRange/CTPInterval), availability (AvailableMatrix → AvailableEngine), start times (StartTimeEngine), contexts (ScheduleContexts), scoring (ScoringEngine), scheduling (ScheduleEngine), and the chain engine as an orchestrator on top.

**Pluggable neighborhood strategies.** The INeighborhoodStrategy interface with 5 implementations (Greedy, Chain, ChainFirstFit, DueDate, ShortestFirst) is well-designed. Adding a new strategy is clean — implement the interface, register in resolveStrategy().

**Profile algebra is already implemented.** The set engines (add, union, subtract, intersect, complement) operating on interval linked lists ARE the piecewise-constant profile algebra from the Willoughby tutorial. This is the right foundation.

**Recompute cascade is efficient.** The RecomputeTracker marks only contexts sharing resources with a newly scheduled task. Unaffected contexts skip recomputation.

**Solve response is comprehensive.** extractResults builds tasks, resource utilization, orders, materials, products, colors, terminology — everything the frontend needs in one response.

### 2.2 Concerns

**State engines are static singletons.** `theEngines` (engines.ts) holds static instances of all set engines, available engine, and start time engine. These have mutable state (aPtr, bPtr, matrix, duration). If the engine were ever made concurrent (e.g., parallel chain evaluation), this would break immediately. For now it's fine (single-threaded), but it's a landmine for the future.

**Landscape is reloaded from config every solve.** `stateService.syncFromConfig()` at the top of every solve. This means no state persists between solves — every solve starts fresh. Good for consistency but means there's no incremental solve capability. Adding one task to an existing schedule requires re-solving everything.

**No separation between "compute" and "commit."** The chain engine's evaluateChain does propagation, scoring, and start time assignment. Then commitChain writes to the landscape. But during evaluateChain, contexts' start time nodes get mutated (truncation was removed, but scoring still writes to blendedScore). This means evaluating a combo has side effects on the ScheduleContext objects, which could affect subsequent combo evaluations.

**Agent pattern is heavyweight.** Many agents (ComputeScheduleContextsAgent, ComputeScoreAgent, CommonStartTimesAgent, BestScoreForTaskAgent, PickBestScheduleAgent, etc.) are thin wrappers around a `solve()` method. The indirection makes the code harder to trace. For a future refactor, consider whether these should be methods on the scheduler rather than separate classes.

**ScoringEngine rebuilds rules from factory every call.** `ScoringFactory.createScoringRule()` is called every time `computeScores()` runs. For the chain engine scoring 100+ combos, this means 100+ factory instantiations of the same rules. Cache the rule set per solve.

---

## Part 3: Optimization Opportunities

### Priority 1: Bug Fixes / Correctness

**3.1 `capContextSets` sorts by uncomputed blendedScore**
Location: chaincontextengine.ts line 309
The cap runs before scoring. blendedScore.score defaults to Number.MAX_VALUE. The sort is meaningless — "top 3" is arbitrary.
Fix: Sort by earliest start time (from start time nodes), or skip capping before cross-product and sample after.

**3.2 Context mutation during chain evaluation**
When scoreChainCombos runs, it calls scoringEngine.computeScores() which writes to context.blendedScore.score and context.scores. If the same context appears in multiple combos (via different lanes), its score gets overwritten. The second combo sees the first combo's score, not its own.
Fix: Either clone contexts per combo, or score only the winning combo.

### Priority 2: Performance

**3.3 Merge propagation into cross-product build**
Build each combo, immediately propagate, discard if infeasible. Avoid allocating ChainContextCombo objects for combos that will be eliminated.
Savings: Fewer allocations, smaller array for scoring. ~30% less memory churn.

**3.4 Cache context time bounds**
`getContextTimeBounds()` walks the CTPStartTimes linked list. The same context appears in multiple combos. Cache bounds once per context.
Savings: Avoids repeated linked list traversal.

**3.5 Pre-build scoring rules once per solve**
Extract rule building from `computeScores()` into a setup phase. Reuse across all combo evaluations.
Savings: Eliminates factory instantiation per combo.

**3.6 Early exit in `findBlockers`**
Assignments are ordered by time. Once `assignment.startW >= task.window.endW`, break the inner loop.
Savings: Skip scanning assignments beyond the task's window.

**3.7 `contextUsesResource` repeated per context per lane**
Build a `Map<contextKey, Set<resourceKey>>` once, then do O(1) lookups.
Savings: Eliminates nested forEach per context.

### Priority 3: Memory / GC

**3.8 Cross-product creates many intermediate arrays**
`[...existing, ctx]` in crossProductContexts() creates a new array per partial combo. Use index arrays instead.
Savings: Reduces GC pressure at high combo counts.

**3.9 Contexts freed per chain after commit**
`chainTasks.forEach(t => this.scheduleContexts.removeByTask(t))` — good, this prevents heap accumulation across chains. Already implemented correctly.

---

## Part 4: Readiness for Advanced Algorithms

### 4.1 Tabu Search

**What it needs:** The solver iterates through "moves" (swap task A with B, move task to different resource, shift start time), evaluates each, accepts improvements, rejects recent moves (tabu list). Requires:

- **Move operators** — not yet built. Would need: SwapMove (two tasks on same resource), RelocateMove (task to different resource), ShiftMove (task to different time on same resource).
- **Neighborhood generation** — different from the current INeighborhoodStrategy. Tabu neighborhood = set of candidate moves from the current solution. Current strategies select TASKS to schedule, not MOVES to make.
- **Solution representation** — currently the "solution" is the landscape's assignment state. No lightweight solution object exists. To evaluate a move without committing, you'd need snapshot/restore or a shadow copy.
- **Tabu list** — simple data structure, not an engine concern. Store recently reversed moves.

**Readiness: 40%.** The scoring and start-time infrastructure works. Missing: move operators, solution representation, snapshot/restore. The chain engine's "try combos in score order" is a proto-neighborhood search but only operates within a single chain, not across the full schedule.

**Recommendation:** Build `SolutionState` class that captures the full assignment as a lightweight snapshot (Map<taskKey, { resourceKey, startW, endW }>). Move operators return a `Move` object that can be applied and reversed. Score deltas instead of full re-scoring where possible.

### 4.2 ILS (Iterated Local Search) / RBRS

**What it needs:** Multiple solve passes with perturbation between passes. Start from the current best solution, perturb (randomly unschedule a few chains, relax some constraints), re-solve, keep the better result.

- **Snapshot/Restore** — essential. Save the best solution found so far, perturb from it, restore if the new solution is worse.
- **Perturbation operators** — random chain unschedule, priority shuffling, resource exclusion.
- **Time budget** — solve for N seconds, return best found. The current solver has no time awareness — it runs until all tasks are processed.

**Readiness: 30%.** No snapshot/restore. No perturbation operators. No time budget control. The foundation (scoring, scheduling, unscheduling) is solid, but the meta-heuristic loop doesn't exist.

**Recommendation:** Build Snapshot/Restore first (Solver Prompt 2). Then add a time-budgeted solve loop that runs Phase 3 multiple times with perturbation. Each iteration saves the best solution.

### 4.3 Multi-Objective Optimization

**What it needs:** Instead of a single blended score, maintain a Pareto front of non-dominated solutions across multiple objectives (e.g., minimize makespan vs. maximize utilization vs. minimize changeovers).

- **Pareto front data structure** — not built. Currently single blended score.
- **Dominance comparison** — compare solutions across N dimensions.
- **Solution archive** — store non-dominated solutions.

**Readiness: 20%.** The scoring engine already computes per-rule scores before blending. The raw scores are available — you'd just stop blending and keep them separate. But the solver loop, chain engine, and combo selection all assume a single scalar score for comparison.

**Recommendation:** Park this. The blended score with configurable weights is sufficient for V1 and likely V2. Multi-objective is research territory.

### 4.4 What's Already Ready

| Capability | Status | Notes |
|---|---|---|
| Profile algebra (interval set operations) | ✅ | setengine.ts — add, union, subtract, intersect, complement |
| Feasible start time computation | ✅ | starttimeengine.ts — CTPRange intersection |
| Multi-resource context explosion | ✅ | combinationengine.ts + explodeScheduleContexts |
| Scored context selection | ✅ | scoringengine.ts with configurable rules + weights |
| Chain-level evaluation | ✅ | chaincontextengine.ts — lanes, cross-product, propagation |
| Cross-chain bump-and-retry | ✅ | basescheduler.ts bumpAndRetry() |
| State change handling | ✅ | statechangeerengine.ts — setup/teardown/changeover |
| Pluggable strategies | ✅ | 5 neighborhood strategies, resolveStrategy() |
| Recompute cascade | ✅ | recompute-tracker.ts — dirty flag propagation |
| Cadence filtering | ✅ | Post-filter on start times |
| maxGap constraints | ✅ | Forward + backward propagation in chain engine |

---

## Part 5: Recommended Actions

### Immediate (this sprint)

1. **Fix `capContextSets` sort** — sort by earliest start time, not blendedScore
2. **Fix context mutation in scoring** — score only the winning combo, or clone contexts
3. **Add `task.window?.reset()` in `retryChain`** — missing from line 899 (tasks are reset but windows aren't)

### Next sprint

4. **Cache scoring rules per solve** — extract from computeScores, reuse across chain combos
5. **Cache context time bounds** — compute once per context, lookup in propagation
6. **Merge propagation into cross-product** — eliminate infeasible combos immediately

### Before Tabu Search

7. **Build `SolutionState` snapshot class** — lightweight assignment capture for save/restore
8. **Build Move operators** — Swap, Relocate, Shift as first-class objects
9. **Add time budget to solve loop** — `maxSolveTimeMs` setting, check between chains

### Before ILS/RBRS

10. **Perturbation operators** — random chain unschedule, constraint relaxation
11. **Multi-pass solve loop** — iterate with perturbation, keep best solution
12. **`SolverState` container** — tracks current best, iteration count, improvement history

---

## Part 6: Code Quality Notes

- **Console.log statements** scattered throughout (scheduleengine.ts lines 52, 131; chainneighborhood.ts line 100). These should be behind a debug flag or use a logger.
- **`var` usage** in scheduleengine.ts (lines 113, 121). Should be `let` or `const`.
- **Empty catch blocks** in scoringengine.ts (lines 47, 63). Swallowing errors silently — at minimum log the error.
- **`CTPResourceConstants.RESUABLE`** — typo in the constant name (should be REUSABLE). Present in constants.ts and resource.ts. Low priority but worth fixing in a cleanup pass.
- **`statechangeerengine.ts`** — filename has "er" doubled. Minor but affects imports.
- **The `flowAround` method** in baseengine.ts is commented out. Either implement or remove the dead code path.
- **`tightenWindowFromPredecessor` in basescheduler.ts** — this is Phase 2 logic still present. It's used by the per-task fallback path and manual pass. If Phase 3 handles all chains, this is only needed for single-task chains and standalone tasks. Consider marking it clearly as "fallback only."

---

*Reviewed: Mar 6, 2026*
