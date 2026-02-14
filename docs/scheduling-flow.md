# CTP Scheduling Flow

Complete reference for the CTP engine scheduling pipeline — from initialization through task commitment.

---

## Architecture Overview

The engine follows a layered architecture:

| Layer | Path | Role |
|-------|------|------|
| **Scheduler** | `AI/Scheduling/` | Orchestrates the entire flow |
| **Agents** | `AI/Agents/` | Decision-making: evaluate, sort, score, pick |
| **Engines** | `Engines/` | Computational workhorses: interval math, availability, scoring |
| **Models** | `Models/` | Data structures: tasks, resources, intervals, processes |
| **Scoring** | `AI/Scoring/` | Scoring rule implementations |
| **Factories** | `Factories/` | Object creation (tasks, scoring rules) |

---

## Phase 0: Initialization

### `initLandscape(horizon, tasks, resources, stateChanges, processes)`

Populates the `SchedulingLandscape` — the central data container.

| Field | Type | Description |
|-------|------|-------------|
| `horizon` | `CTPHorizon` | Time boundary (startW / endW as epoch seconds) |
| `tasks` | `CTPTasks` | EntityHashMap of all CTPTask objects |
| `resources` | `CTPResources` | EntityHashMap of all CTPResource objects |
| `stateChanges` | `CTPStateChanges` | Process changeover definitions |
| `processes` | `CTPProcesses` | Linked task groups (sequential routes) |

All resources are marked `recompute = true` so availability is calculated fresh.

### `initSettings(settings: CTPAppSettings)`

| Setting | Default | Description |
|---------|---------|-------------|
| `scheduleDirection` | FORWARD (1) | FORWARD = earliest first, BACKWARD = latest first |
| `topTasksToSchedule` | 2 | Batch size per iteration ("neighborhood size") |
| `requiresPreds` | false | Enforce process dependencies |
| `flowAround` | false | Flow around unavailable segments |
| `resetUageAfterProcessChange` | false | Reset usage counters after changeover |
| `tasksPerLoop` | — | Tasks per scheduling loop |
| `maxLateness` | — | Maximum allowed lateness |

### `initScoring(scoring: CTPScoring)`

Stores weighted scoring rules. Available rules:

| Rule | Scores By | Typical Objective |
|------|-----------|-------------------|
| `EarliestStartTimeScoringRule` | Earliest feasible start time | MINIMIZE |
| `LatestStartTimeScoringRule` | Latest feasible start time | MINIMIZE |
| `WhiteSpaceScoringRule` | Std deviation of slack across windows | MINIMIZE |
| `StateChangeScoringRule` | Total changeover duration | MINIMIZE |

All rule weights must sum to **1.0**. Each rule has: `weight`, `objective` (MINIMIZE/MAXIMIZE), `penaltyFactor`, `includeInSolve`.

---

## Phase 1: `schedule(tasks)` — Entry Point

**File:** `AI/Scheduling/basescheduler.ts`

```
tasks.forEach → reset processed flag and errors
initScheduling(tasks)         → clear contexts, handle dependencies, explode combos
assert()                      → validate landscape / settings / scoring
reComputeScheduleContexts()   → initial feasibility + scoring pass for all contexts
```

### `initScheduling(tasks)`

**File:** `AI/Scheduling/defaultscheduler.ts`

Three steps:

1. **Clear** all existing schedule contexts
2. **Dependency pre-scan** — if `requiresPreds` is true, `DependencyLookAheadAgent.preschedule()` scans tasks with `linkId`, identifies process groups, adds missing predecessors to the task list
3. **Explode combinations** — `explodeScheduleContexts(tasks)` generates all task-resource combinations for every task

### `assert()`

Validates that the landscape has a horizon and tasks, that settings and scoring are configured. Defaults to `new CTPAppSettings()` if missing.

### `reComputeScheduleContexts()` — Initial Computation Pass

1. Loops through all `ScheduleContext` objects where `recompute == true`
2. Resets each task's score to `Number.MAX_VALUE`
3. `ComputeScheduleContextsAgent.solve()` → computes start times and scores for all contexts
4. If `requiresPreds` → `applyRequiredTiming()` constrains successor tasks
5. `BestScoreForTaskAgent.solve()` → picks the best score per task across all resource combos

---

## Phase 2: Main Scheduling Loop

```
while (unscheduled tasks remain) {
    next = nextTasksToSchedule(tasks, N)   → pick top N tasks (greedy sort)
    explodeScheduleContexts(next)          → Cartesian product of resource preferences
    scheduleTasks(next)                    → for each: select best → commit → recompute
}
```

---

### Step 2.1: Task Selection — NextNeighborhoodAgent

**File:** `AI/Agents/nextneighborhood.ts`

Greedy sort priority cascade:

```
1. Earliest feasible end time       (feasible start + duration, or window start + duration)
2. Best score                       (lowest blended score)
3. Rank / priority                  (lower number = higher priority)
4. Window start                     (earlier window = first)
5. Shortest duration                (shorter tasks first)
```

Picks the top **N** unprocessed, not-yet-scheduled tasks (N = `topTasksToSchedule`).

**Dependency look-ahead:** If `requiresPreds` is set, for each selected task with dependencies, `DependencyLookAheadAgent.earliestPredTaskNotScheduled()` finds the earliest unscheduled predecessor. If found, it is inserted before the current task in the batch.

---

### Step 2.2: Combination Explosion — CombinationEngine

**File:** `Engines/combinationengine.ts`

For each task (if not already exploded):

1. Gather `capacityResources[i].preferences[]` — alternative resources per slot
2. Compute the **Cartesian product** of all preference arrays
3. Filter out combos where the same resource appears twice (uniqueness constraint)
4. Each valid combo becomes a `ScheduleContext`

**Example:**
```
Task needs: [CNC-01 or CNC-02] + [ASM-01]
Combos:     [CNC-01, ASM-01], [CNC-02, ASM-01]  →  2 ScheduleContexts
```

The `BaseX` counter class implements a mixed-radix counter to iterate all combinations efficiently.

Each `ScheduleContext` contains:
- Reference to the `landscape`
- The `task`
- `CTPResourceSlots` with concrete `CTPResource` references

Contexts are stored in `ScheduleContexts` (EntityHashMap) with cross-reference maps:
- `byTask` — groups all contexts by task key
- `byResource` — groups all contexts by resource key

---

### Step 2.3: Schedule Each Task

**File:** `AI/Scheduling/basescheduler.ts`

```
for each task in batch:
    A. selectBestScheduleForTask(task)        → PickBestScheduleAgent
    B. scheduleTask(task, bestSchedule)       → commit to timeline
    C. reComputeScheduleContexts(task)        → re-evaluate remaining
```

#### A. Select Best — PickBestScheduleAgent

**File:** `AI/Agents/pickbestschedule.ts`

1. Retrieves all `ScheduleContext` objects for the task
2. Finds the context whose `blendedScore.score` equals the task's best score
3. Based on `scheduleDirection`:
   - **FORWARD** → picks `startTimes.head` (earliest segment)
   - **BACKWARD** → picks `startTimes.tail` (latest segment)
4. Based on scoring rules:
   - If no LatestStartTime rule active → uses `eStartW` (earliest start within segment)
   - Otherwise → uses `lStartW` (latest start within segment)
5. Returns `BestScheduleContext`: winning context + start time node + chosen start

#### B. Commit — ScheduleEngine

**File:** `Engines/scheduleengine.ts`

Three sub-steps:

**B1. `scheduleATask()`** — Place on timeline
```
FORWARD:  st = startTime + processChangeDuration
BACKWARD: st = startTime - processChangeDuration
et = st + task.duration.duration()

task.state = SCHEDULED
task.scheduled = new CTPInterval(st, et, 1)

For each resource in the winning combo:
  → create CTPAssignment(st, et, qty)
  → add to resource.assignments
  → mark resource.recompute = true
  → record capresource.scheduledResource = resource.key
```

**B2. `scheduleStateChanges()`** — Create changeover tasks
- If `BestScheduleContext.startTimes` has state change info:
  - `StateChangeEngine.getScheduleStateChangeTasks()` creates SET_UP / TEAR_DOWN tasks
  - Setup placed immediately before: `[task.start - changeover_duration, task.start]`
  - Teardown placed immediately after: `[task.end, task.end + changeover_duration]`
  - Changeover tasks assigned to the same resources

**B3. `updateRecompute()`** — Mark affected contexts
- For each resource in the scheduled context, looks up all other contexts using that resource
- Marks those contexts `recompute = true`
- Resets those tasks' scores to `Number.MAX_VALUE`

#### C. Recompute — Re-evaluate Remaining

1. `ComputeScheduleContextsAgent.solve()` — recomputes start times + scores for all `recompute = true` contexts
2. If `requiresPreds` → `TimingSequenceAgent.applyRequiredTiming()` truncates successor start times
3. `BestScoreForTaskAgent.solve()` — re-picks best score per remaining task

---

## Phase 3: ComputeScheduleContextsAgent — Feasibility Engine

**File:** `AI/Agents/computeschedulecontexts.ts`

For each `ScheduleContext` needing recomputation, three sub-steps:

### 3.1 CommonStartTimesAgent — Find Where the Task Fits

**File:** `AI/Agents/commonstarttimes.ts`

For each resource in the combo:
1. If `resource.recompute == true` → `AvailableEngine.recalculate()` (see Phase 4)
2. `StartTimeEngine.computeStartTimes()` → find feasible windows (see Phase 5)
3. First resource → store as combined start times
4. Each additional resource → **intersect** with accumulated start times
5. If no feasible times remain → short-circuit with error

Converts raw `CTPIntervals` into `CTPStartTime` objects:
- `eStartW` / `eEndW` — earliest start window
- `lStartW` / `lEndW` — latest start window
- `duration` — task duration

### 3.2 StateChangeAgent — Annotate Changeover Costs

**File:** `AI/Agents/statechangeagent.ts`

For each feasible start time:
1. For each resource in the combo, check resource type for state change rules
2. Determine the "from" state (what the resource was last doing) via `resource.available.stateChanges`
3. Compare with the "to" state (`task.process`)
4. If different → look up changeover definition from `landscape.stateChanges`
5. Record `processChangeDuration` on the start time
6. Create `CTPStateChangeResource` entries
7. Check if changeover makes the start time infeasible (changeover > available window)

### 3.3 ScoringEngine — Multi-Criteria Weighted Score

**File:** `Engines/scoringengine.ts`

For each context with feasible start times:

**Raw scoring per rule:**

| Rule | Raw Score |
|------|-----------|
| EarliestStartTime | `startTimes.head.data.eStartW` |
| LatestStartTime | `startTimes.tail.data.lStartW` |
| WhiteSpace | Standard deviation of slack durations across segments |
| StateChange | `startTimes.changeOver()` — total changeover duration |

**Blended score calculation:**
```
For each rule:
  normalized = (raw - globalMin) / (globalMax - globalMin)    → [0, 1]
  weighted   = normalized * rule.weight
  if MAXIMIZE → weighted *= -1
  weighted  += weighted * penaltyFactor

blendedScore = sum of all weighted scores
```

**Lower blended score = better.**

---

## Phase 4: AvailableEngine — Resource Capacity

**File:** `Engines/availableengine.ts`

Each `CTPResource` has:

| Field | Type | Description |
|-------|------|-------------|
| `original` | `CTPAvailable` | Base capacity intervals (working hours with qty) |
| `assignments` | `CTPAssignments` | Already-scheduled work consuming capacity |
| `available` | `AvailableMatrix` | Computed availability = original - assignments |

### 4.1 `computeAvailable()` — Subtract Assignments from Original

Uses `SetEngine.subtract(original, assignments)` — interval arithmetic that walks two sorted linked lists, subtracting assignment quantities from original capacity where they overlap.

### 4.2 `calculate()` — Build Available Ranges

Walks `staticAvailable` intervals **tail to head** (right to left), building three range types:

| Index | Type | Description |
|-------|------|-------------|
| 0 | FIXED_DURATION | Single segments where a fixed-duration task fits |
| 1 | FLOAT_DURATION | Contiguous multi-segment spans for floating tasks |
| 2 | UNTRACKED | Segments for non-consuming tasks |

**FLOAT ranges** are the most complex — they group contiguous segments by quantity level, finding all runs of segments with sufficient capacity and tracking cumulative duration.

### 4.3 `addToStateChange()` — Track Process States

Walks the sorted assignments list. Between consecutive PROCESS assignments, creates `CTPStateChangeInterval` objects recording:
- Time gap between assignments
- "From" process and "to" process
- Usage counters (task count, runtime, changeover count)

---

## Phase 5: StartTimeEngine — Feasible Windows

**File:** `Engines/starttimeengine.ts`

`computeStartTimes(horizon, duration, matrix)`:

1. **Select range type** based on `durationType`:
   - FIXED_DURATION / FIXED_RUN_RATE → `matrix.index(FIXED_DURATION)`
   - UNTRACKED / STATIC → `matrix.index(UNTRACKED)`
   - FLOAT → `matrix.index(FLOAT_DURATION)`

2. **Filter ranges** — must be:
   - Within the scheduling horizon
   - Sufficient capacity: `range.qty >= task.duration.qty`
   - Sufficient total duration: `rangeDur >= task.duration.duration()`
   - Sufficient run rate: `range.runRateQty() >= task.duration.runRate`

3. **Compute start/end times** for each valid range:
   - **Forward walk** → Earliest Start Time (EST) and Earliest End Time (EET)
   - **Backward walk** → Latest Start Time (LST) and Latest End Time (LET)
   - If both succeed → range is `valid = true`

4. **Merge** via union → final `CTPIntervals` of feasible start-time windows

---

## Phase 6: Interval Arithmetic — SetEngine

**File:** `Engines/setengine.ts`

Foundation for all availability and start-time math. Five operations on sorted linked lists of `CTPIntervals`:

| Operation | Engine | Used For |
|-----------|--------|----------|
| **Add** | `CTPAddSetEngine` | Merge quantities where overlapping |
| **Subtract** | `CTPSubtractSetEngine` | Remove consumed capacity (original - assignments) |
| **Union** | `CTPUnionSetEngine` | Combine start-time windows |
| **Intersect** | `CTPIntersectSetEngine` | Common windows across multiple resources |
| **Complement** | `CTPComplimentSetEngine` | Uncovered portions of A not in B |

Each engine walks two sorted linked lists simultaneously using pointer advancement, handling ~12 geometric overlap cases.

---

## Phase 7: BestScoreForTaskAgent — Aggregate Across Combos

**File:** `AI/Agents/bestscorefortask.ts`

After all contexts are scored:

1. For each task, iterate all its `ScheduleContext` objects
2. Find the **minimum `blendedScore.score`**
3. Set `task.score` to this minimum
4. Compute the overall feasible window spanning from earliest `eStartW` to latest `lStartW`

This `task.score` drives the `NextNeighborhoodAgent` sorting in the next iteration.

---

## Phase 8: TimingSequenceAgent — Enforcing Dependencies

**File:** `AI/Agents/timing.ts`

Called after each task is scheduled when `requiresPreds` is true.

`applyRequiredTiming(task)`:
1. Verify task has `linkId` and is SCHEDULED
2. Look up the process from `landscape.processes`
3. **FORWARD**: for all NOT_SCHEDULED tasks in the same process with `sequence >= task.sequence`, truncate start times from `task.scheduled.startW` forward
4. **BACKWARD**: truncate from `task.scheduled.endW` backward

`CTPStartTime.truncate()` adjusts EST/LST windows, removing portions that violate the dependency. If truncation makes a segment completely infeasible, it is removed.

---

## Phase 9: DependencyLookAheadAgent — Process-Aware Scheduling

**File:** `AI/Agents/LookAhead Agents/dependencylookahead.ts`

Three roles:

| Method | When Called | Purpose |
|--------|------------|---------|
| `preschedule()` | `initScheduling()` | Scan tasks with `linkId`, identify process groups, add missing predecessors |
| `earliestPredTaskNotScheduled()` | `nextTasksToSchedule()` | Find earliest unscheduled predecessor for dependency insertion |
| `postschedule()` | After scheduling failure | Mark remaining tasks in failed process as "Predecessor not met" |

---

## Complete Journey of One Task

```
┌─────────────────────────────────────────────────────────────────────┐
│ Task X loaded: needs [MachA | MachB] + [Op1 | Op2]                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CombinationEngine: Cartesian product                                │
│   → [MachA+Op1], [MachA+Op2], [MachB+Op1], [MachB+Op2]            │
│   → 4 ScheduleContexts created                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ For each ScheduleContext:                                           │
│                                                                     │
│   AvailableEngine                                                   │
│   ├─ MachA: original - assignments = remaining capacity             │
│   └─ Op1:   original - assignments = remaining capacity             │
│                                                                     │
│   StartTimeEngine                                                   │
│   ├─ MachA: find ranges where Task X duration fits                  │
│   └─ Op1:   find ranges where Task X duration fits                  │
│                                                                     │
│   Intersect: common feasible windows across both resources          │
│                                                                     │
│   StateChangeAgent: annotate changeover costs if switching process  │
│                                                                     │
│   ScoringEngine: weighted multi-criteria → blendedScore             │
│     EarliestStart(0.6) + WhiteSpace(0.3) + StateChange(0.1)        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ BestScoreForTaskAgent                                               │
│   [MachA+Op1] = 0.15  ← best                                       │
│   [MachA+Op2] = 0.32                                                │
│   [MachB+Op1] = 0.41                                                │
│   [MachB+Op2] = 0.58                                                │
│   → task.score = 0.15                                               │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ NextNeighborhoodAgent: greedy sort                                  │
│   Task X rises to top (score 0.15, early end time)                  │
│   → Selected in next batch of 2                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PickBestScheduleAgent                                               │
│   → Selects [MachA+Op1] context (score = 0.15)                     │
│   → FORWARD: picks startTimes.head → eStartW = 3600                │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ScheduleEngine.schedule()                                           │
│   task.state = SCHEDULED                                            │
│   task.scheduled = [3600, 7200]  (1-hour task starting at hour 1)   │
│                                                                     │
│   MachA: + CTPAssignment [3600, 7200, qty=1]                        │
│   Op1:   + CTPAssignment [3600, 7200, qty=1]                        │
│   Both resources marked recompute = true                            │
│                                                                     │
│   If changeover needed:                                             │
│   → SET_UP task created at [3000, 3600] (10-min setup before)       │
│   → Assigned to same resources                                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Recompute                                                           │
│   All contexts using MachA or Op1 marked recompute = true           │
│   → Start times and scores recalculated with reduced availability   │
│   → BestScoreForTaskAgent re-picks best per remaining task          │
│                                                                     │
│   Loop continues → next batch of tasks                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

| File | Role |
|------|------|
| `AI/Scheduling/basescheduler.ts` | Abstract base with complete scheduling loop |
| `AI/Scheduling/defaultscheduler.ts` | Concrete `CTPScheduler` with `initScheduling` |
| `AI/Agents/nextneighborhood.ts` | Greedy task-selection with dependency look-ahead |
| `AI/Agents/commonstarttimes.ts` | Finds common start times across resource combos |
| `AI/Agents/computeschedulecontexts.ts` | Orchestrates start-time + state-change + scoring |
| `AI/Agents/computescores.ts` | Delegates to ScoringEngine |
| `AI/Agents/bestscorefortask.ts` | Picks best score per task across all combos |
| `AI/Agents/pickbestschedule.ts` | Selects winning context and start time |
| `AI/Agents/statechangeagent.ts` | Annotates start times with changeover costs |
| `AI/Agents/timing.ts` | Truncates successor start times after predecessor scheduled |
| `AI/Agents/LookAhead Agents/dependencylookahead.ts` | Process-level dependency management |
| `Engines/combinationengine.ts` | Cartesian product of resource preferences |
| `Engines/availableengine.ts` | Computes availability matrix (original - assignments) |
| `Engines/starttimeengine.ts` | Finds feasible start times within available ranges |
| `Engines/setengine.ts` | Interval arithmetic (add, subtract, union, intersect, complement) |
| `Engines/scheduleengine.ts` | Commits task to timeline (schedule / unschedule) |
| `Engines/scoringengine.ts` | Multi-criteria weighted scoring with normalization |
| `Engines/statechangeerengine.ts` | Changeover computation and task creation |
| `AI/Scoring/starttimescoring.ts` | Earliest / Latest start time scoring rules |
| `AI/Scoring/whitespacescoring.ts` | White space std deviation scoring rule |
| `AI/Scoring/changeoverscoring.ts` | Changeover duration scoring rule |
| `Factories/scorefactory.ts` | Factory for scoring rule instances |
| `Factories/taskfactory.ts` | Factory for cloning / creating tasks |
| `Models/Entities/landscape.ts` | Central data container |
| `Models/Entities/schedulecontext.ts` | Task + resource combo + scores + start times |
| `Models/Entities/task.ts` | Task entity with window, duration, state, resources, score |
| `Models/Entities/resource.ts` | Resource with original capacity, assignments, AvailableMatrix |
| `Models/Entities/slot.ts` | CTPResourceSlots: resources with combined start times |
| `Models/Entities/starttime.ts` | CTPStartTime: EST / EET / LST / LET + changeover info |
| `Models/Entities/statechange.ts` | State change definitions and intervals |
| `Models/Entities/process.ts` | CTPProcess: named group of linked tasks |
| `Models/Entities/score.ts` | Scoring configuration and score values |
| `Models/Entities/appsettings.ts` | Application settings |
| `Models/Intervals/availablematrix.ts` | AvailableMatrix: original, assignments, available, ranges |
| `Models/Core/constants.ts` | All constant definitions |
