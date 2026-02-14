# CTP Platform — Engine Architecture

## Overview

The engine package (`packages/engine/`) is a pure TypeScript scheduling engine with zero framework dependencies. It takes a `SchedulingLandscape` (resources, tasks, availability, constraints) and produces an optimized schedule. The engine is stateless — all state lives in the landscape and schedule context objects passed through the solve loop.

---

## Directory Structure

```
packages/engine/
├── index.ts                          ← Barrel export (re-exports everything)
│
├── Models/                           ← Domain model layer
│   ├── Core/                         ← Foundation types
│   ├── Entities/                     ← Business objects
│   ├── Intervals/                    ← Availability tracking
│   └── Lists/                        ← Specialized list types
│
├── Engines/                          ← Computation engines (stateless workers)
├── Factories/                        ← Object creation
│
├── AI/                               ← Solver intelligence
│   ├── Agents/                       ← Pluggable solver agents
│   │   └── LookAhead Agents/         ← Dependency look-ahead
│   ├── Scheduling/                   ← Scheduler orchestration
│   └── Scoring/                      ← Scoring rules
│
├── Services/                         ← Utility services
└── tests/                            ← 314 tests
```

---

## Models/Core/ — Foundation Types

| File | Key Exports | Purpose |
|------|-------------|---------|
| `constants.ts` | `CTPTaskStateConstants`, `CTPScheduleDirectionConstants`, `CTPAssignmentConstants`, `CTPDurationConstants`, `CTPTaskTypeConstants` | Enums and magic values used throughout |
| `date.ts` | `CTPDateTime` | Static utility: ISO string ↔ luxon DateTime ↔ epoch seconds. `baseDate` is 2010-01-01. All internal times are seconds since baseDate. |
| `entity.ts` | `CTPKeyEntity`, `IKeyEntity` | Base class for all domain objects. Provides `key`, `name`, `hashKey`, `type`, `hierarchy`, `attributes`, `typedAttributes`. |
| `window.ts` | `CTPInterval`, `CTPDuration`, `CTPAssignment` | Time window primitives. `CTPInterval(startW, endW, qty)` — all times in epoch seconds. `CTPDuration` extends with `durationType`. |
| `typedattribute.ts` | `CTPTypedAttributes`, `ITypedAttribute`, `AttributeValue` | Phase 1 typed attribute system. 8 data types (string, number, integer, boolean, date, enum, list, object). Discriminated union values. |
| `linkid.ts` | `CTPLinkId` | Links tasks into process chains: `name` (process group), `prevLink` (predecessor task key). |
| `list.ts` | `List<T>` | Extends `Array<T>` with `add()`, `remove()`, `contains()`, `clear()`. |
| `linklist.ts` | `LinkedList<T>`, `ListNode<T>` | Doubly-linked list. Used for interval chains (availability, assignments). |
| `hashmap.ts` | `EntityHashMap<T>` | Key → entity lookup via `Map`. Provides `addEntity()`, `getEntity()`, `removeEntity()`, `forEach()`, `size()`. |
| `namevalue.ts` | `CTPAttributes`, `NameValue` | Legacy string key-value attribute pairs. |
| `preference.ts` | `CTPPreference` | Base class for resource preferences (rank, include flag). |
| `range.ts` | `Range` | Numeric range utilities. |

---

## Models/Entities/ — Business Objects

| File | Key Exports | Purpose |
|------|-------------|---------|
| `landscape.ts` | `SchedulingLandscape` | Top-level container: `horizon`, `tasks`, `resources`, `stateChanges`, `processes`, `appSettings`. Constructor takes `(startDt?, endDt?, settings?)`. `buildProcesses()` groups linked tasks. |
| `horizon.ts` | `CTPHorizon` | Scheduling date range: `startDate`, `endDate` (luxon DateTime), `startW`, `endW` (epoch seconds). |
| `resource.ts` | `CTPResource`, `CTPResources`, `CTPResourcePreference` | Resource entity: `class` (REUSABLE/CONSUMABLE), `type`, `original` (CTPAvailable), `assignments` (CTPAssignments), `available` (AvailableMatrix). |
| `task.ts` | `CTPTask`, `CTPTasks`, `CTPTaskResource`, `CTPTaskResourceList` | Task entity: `window` (feasible range), `duration`, `capacityResources`, `materialsResources`, `linkId`, `process`, `state`, `scheduled` (committed interval), `score`. |
| `appsettings.ts` | `CTPAppSettings` | Solver config: `scheduleDirection` (1=forward, 2=backward), `flowAround`, `tasksPerLoop`, `topTasksToSchedule`, `requiresPreds`. Note: field typo `resetUageAfterProcessChange`. |
| `statechange.ts` | `CTPStateChange`, `CTPStateChanges` | Changeover rules: `resourceType`, `fromState`, `toState`, `duration`, `penalty`. Hash key: `{resourceType}-{type}-{fromState}-{toState}`. |
| `score.ts` | `CTPScoring`, `CTPScoringConfiguration` | Scoring config: named rule set with `addConfig()`. Each config: `ruleName`, `weight`, `objective` (0=min, 1=max). |
| `schedulecontext.ts` | `ScheduleContext`, `BestScheduleContext`, `ScheduleContexts`, `TaskScheduleContexts` | Solver state: one context per task-resource-combo. Tracks feasibility, start times, scores. `ScheduleContexts` manages the full set with `byTask` lookup. |
| `slot.ts` | `CTPResourceSlot`, `CTPResourceSlots` | Resource assignments within a schedule context. |
| `starttime.ts` | `CTPStartTime` | Candidate start time with white space, earliest/latest bounds, process change duration. |
| `process.ts` | `CTPProcess`, `CTPProcesses` | Linked task group. Built by `landscape.buildProcesses()` from task `linkId` fields. |

---

## Models/Intervals/ — Availability Tracking

| File | Key Exports | Purpose |
|------|-------------|---------|
| `intervals.ts` | `CTPAvailable`, `CTPAssignments`, `CTPIntervals` | Linked lists of `CTPInterval`. `CTPAvailable` = original availability windows. `CTPAssignments` = committed task assignments. Methods: `add()`, `whiteSpace()`, `atStartTime()`, `findStartTime()`, `findEndTime()`. |
| `availablematrix.ts` | `AvailableMatrix` | Per-resource availability state: `staticOriginal` (never changes), `staticAssignments` (committed), `staticAvailable` (computed remaining). `setLists(original, assignments)` wires them up. Used by engines to find feasible slots. |

---

## Engines/ — Computation Engines

Stateless workers that perform specific calculations. Called by agents during the solve loop.

| File | Key Exports | Purpose |
|------|-------------|---------|
| `baseengine.ts` | `BaseEngine` | Base class for all engines. |
| `engines.ts` | `theEngines`, `theSetEngines` | Engine registries. |
| `setengine.ts` | `SetEngine` | Interval set operations: intersect, subtract, merge availability windows. |
| `availableengine.ts` | `AvailableEngine` | Computes available time for a resource given its original availability minus assignments. |
| `starttimeengine.ts` | `StartTimeEngine` | Finds feasible start times for a task on a resource, respecting duration and availability. |
| `scheduleengine.ts` | `ScheduleEngine` | Commits a task to a schedule (updates resource assignments, task state) or uncommits (unschedule). |
| `scoringengine.ts` | `ScoringEngine` | Evaluates schedule quality by running scoring rules against a schedule context. |
| `statechangeerengine.ts` | `StateChangeEngine` | Handles changeover/setup logic: finds applicable state changes, creates setup/teardown tasks. |
| `combinationengine.ts` | `CombinationEngine`, `ResourceCombinationEngine` | Generates all permutations of resource assignments for multi-resource tasks. |

---

## AI/Agents/ — Pluggable Solver Agents

Each agent performs one step of the solve loop. They are instantiated by `CTPBaseScheduler` via factory methods (easy to override/swap).

| File | Key Exports | Purpose |
|------|-------------|---------|
| `agent.ts` | Base agent | Agent interface/base class. |
| `nextneighborhood.ts` | `NextNeighborhoodAgent` | Selects the next batch of unscheduled tasks to evaluate. Respects `topTasksToSchedule` and dependency ordering. |
| `commonstarttimes.ts` | `CommonStartTimesAgent` | Finds common feasible start times across multiple resources for a task. |
| `computeschedulecontexts.ts` | `ComputeScheduleContextsAgent` | Computes feasibility (start times, availability) for all schedule contexts that need recomputation. |
| `computescores.ts` | `ComputeScoreAgent` | Runs scoring rules against schedule contexts to produce numeric scores. |
| `bestscorefortask.ts` | `BestScoreForTaskAgent` | Picks the best-scoring context for each task across all its resource combos. |
| `pickbestschedule.ts` | `PickBestScheduleAgent` | Selects the single best schedule context to commit for a given task. |
| `statechangeagent.ts` | `StateChangeAgent` | Handles state change scheduling decisions. |
| `timing.ts` | `TimingSequenceAgent` | Adjusts timing for linked tasks (predecessor dependencies). |
| `LookAhead Agents/dependencylookahead.ts` | `DependencyLookAheadAgent` | Look-ahead evaluation for predecessor dependencies. Checks if scheduling a task now will block dependent tasks later. |

---

## AI/Scheduling/ — Scheduler Orchestration

| File | Key Exports | Purpose |
|------|-------------|---------|
| `basescheduler.ts` | `CTPBaseScheduler`, `IScheduler` | The main solve loop. `schedule(tasks)` iterates: pick next tasks → explode resource combos → compute scores → schedule best → repeat until all tasks scheduled or max iterations. Also handles `unschedule(tasks)`. |
| `defaultscheduler.ts` | `CTPScheduler` | Default implementation of `CTPBaseScheduler`. Overrides `initScheduling()` and `initUnScheduling()`. |

---

## AI/Scoring/ — Scoring Rules

Scoring rules evaluate how good a candidate schedule is. Multiple rules combine via weighted sum.

| File | Key Exports | Purpose |
|------|-------------|---------|
| `scoringrule.ts` | `IScoringRule`, `CTPScoringRule` | Interface and base class. `score(context)` returns a numeric value. |
| `starttimescoring.ts` | `EarliestStartTimeScoringRule`, `LatestStartTimeScoringRule` | Prefer earlier (or later) start times. Most common rule. |
| `whitespacescoring.ts` | `WhiteSpaceScoringRule` | Minimize gaps (white space) on resources. Packs tasks tightly. |
| `changeoverscoring.ts` | `ChangeoverScoringRule` | Penalize state changes (changeovers). Prefers grouping same-process tasks. |

---

## Solve Loop Flow

```
CTPScheduler.schedule(tasks)
        │
        ▼
    initScheduling()          Set up landscape, scoring, settings
        │
        ▼
    reComputeScheduleContexts()   Initial feasibility + scoring pass
        │
        ▼
    ┌─► nextTasksToSchedule()     NextNeighborhoodAgent picks top N tasks
    │       │
    │       ▼
    │   explodeScheduleContexts() CombinationEngine generates resource combos
    │       │                     Creates ScheduleContext per task-resource-combo
    │       ▼
    │   scheduleTasks()           For each task:
    │       │                       1. selectBestScheduleForTask()
    │       │                       2. scheduleTask() → ScheduleEngine.schedule()
    │       │                       3. scheduleStateChanges() (if applicable)
    │       │                       4. reComputeScheduleContexts() (update neighbors)
    │       │
    │       ▼
    └── more unscheduled tasks? ──► loop back
        │
        ▼
    endScheduling()               Done — all tasks have scheduled intervals
```

---

## Key Concepts

### Time Representation
All internal times are **seconds since 2010-01-01** (`CTPDateTime.baseDate`). Use `CTPDateTime.fromDateTime(luxonDt)` to convert in, `CTPDateTime.toDateTime(seconds)` to convert out.

### AvailableMatrix
Each resource has an `AvailableMatrix` with three interval lists:
- `staticOriginal` — the raw availability (never modified)
- `staticAssignments` — committed task assignments
- `staticAvailable` — computed remaining availability (original minus assignments)

The engines read from and write to these lists during scheduling.

### Schedule Context
A `ScheduleContext` represents one possible way to schedule a task (specific resource combination). The solver creates contexts for all feasible combos, scores them, and commits the best one.

### Linked Tasks (Processes)
Tasks with matching `linkId.name` form a process chain. `landscape.buildProcesses()` groups them. The `TimingSequenceAgent` enforces ordering, and `DependencyLookAheadAgent` does look-ahead to avoid blocking downstream tasks.

### State Changes (Changeovers)
When a resource switches between product types (e.g., Widget-A → Widget-B), a changeover task is inserted. Duration and penalty come from `CTPStateChanges`. The `DEFAULT CHANGE` entry is the fallback.

---

## Tests

```bash
cd packages/engine && npx vitest run
```

314 tests across 17 test files:

| Area | Files | Tests | What's covered |
|------|-------|-------|----------------|
| Models (core) | 6 | 99 | hashmap, interval, linklist, list, namevalue, range |
| Typed attributes | 1 | 68 | All 8 data types, type-safe getters, serialization, entity integration |
| Intervals | 2 | 35 | Available/assignments operations, available matrix |
| Engines | 3 | 55 | Base engine, set engine, combination engine |
| Agents | 4 | 32 | Best score, dependency look-ahead, next neighborhood, pick best |
| Scheduling | 1 | 11 | End-to-end: schedule, unschedule, round-trip, multi-resource |
| **Total** | **17** | **314** | |
