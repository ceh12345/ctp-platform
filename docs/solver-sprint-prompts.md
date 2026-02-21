# Solver Sprint — 4 Sequential Prompts

These four prompts are designed to be executed **in order**. Each builds on the previous one. Do not skip ahead — the later prompts depend on code from earlier ones.

**Sequence:**
1. Top-N Ranked Contexts — new data structure + unit tests
2. Snapshot/Restore — save/restore schedule state + unit tests
3. Balanced Strategy (bump backtracking) — new solver strategy + unit tests
4. Stress Tests — complex scenarios comparing Quick vs Balanced

---

# Prompt 1: Top-N Ranked Contexts

## Goal

Create a `RankedScheduleContexts` class that stores the top N (default 5) scored schedule contexts for a task, sorted by blended score. This replaces the current pattern of keeping only the single best `BestScheduleContext`. The class also detects **neighborhood boundaries** — score gaps that separate clusters of similar alternatives from genuinely different ones.

## Why This Matters

Today the solver evaluates all feasible contexts for a task, picks the best one, and throws the rest away. When backtracking needs to try an alternative (because the best choice caused a downstream infeasibility), there's nothing to fall back to — it would have to rebuild and re-score all contexts from scratch. Storing the top 5 means backtracking can instantly say "try rank 1 instead of rank 0" without recomputing.

The neighborhood boundary matters for Thorough strategy (tabu search, future prompt). When the solver wants to escape a local optimum, it needs to know: "are ranks 0-2 basically the same resource at slightly different times (same neighborhood), or is rank 3 a completely different resource (different neighborhood)?" The boundary tells it where a genuine alternative starts.

## Context — Existing Code

The solver currently produces `BestScheduleContext` objects:

```typescript
// From schedulecontext.ts
export class BestScheduleContext {
  public best: ScheduleContext;        // the winning context (task + resource slot combo)
  public startTimes: CTPStartTime;     // earliest/latest start/end times
  public startTime: number;            // the chosen start time
  public subType: number;
}
```

And `ScheduleContext` contains:
```typescript
export class ScheduleContext extends CTPEntityHashed {
  public landscape: ILandscape;
  public task: CTPTask;
  public slot: CTPResourceSlots;       // which resources are assigned
  public scores: CTPScores;            // individual scoring rule results
  public blendedScore: IScore;         // the composite score
}
```

The blended score (`blendedScore.score`) is what determines ranking. Lower score = better.

## New Files

### File 1: `RankedScheduleContexts.ts`

Create in the same directory as `schedulecontext.ts` (likely `Entities/` or `Solver/`).

```typescript
import { BestScheduleContext } from './schedulecontext';

export interface IRankedEntry {
  rank: number;                         // 0 = best, 1 = second best, etc.
  context: BestScheduleContext;
  score: number;                        // blendedScore.score for quick access
  resourceKeys: string[];               // resource keys for quick comparison
  isNeighborhoodBoundary: boolean;      // true if this entry starts a new neighborhood
}

export class RankedScheduleContexts {
  public taskKey: string;
  public ranked: IRankedEntry[];
  private maxN: number;
  private gapThreshold: number;        // % gap that defines a neighborhood boundary

  constructor(taskKey: string, maxN: number = 5, gapThreshold: number = 0.15) {
    this.taskKey = taskKey;
    this.ranked = [];
    this.maxN = maxN;
    this.gapThreshold = gapThreshold;   // 15% score gap = new neighborhood
  }
  // ... methods below
}
```

### Required Methods

**`addCandidate(context: BestScheduleContext): void`**

Insert a scored context in rank order (ascending by score — lowest = best). If the list exceeds `maxN`, drop the worst. After insertion, recompute neighborhood boundaries.

The resource keys for comparison should be extracted from `context.best.slot.resources` — concatenate each resource's key.

**`best(): BestScheduleContext | null`**

Return rank 0, or null if empty.

**`alternative(rank: number): BestScheduleContext | null`**

Return the context at the given rank, or null if rank is out of bounds.

**`hasAlternatives(): boolean`**

True if there are 2+ entries (something beyond the best).

**`count(): number`**

Number of stored entries.

**`neighborhoodBoundary(): number`**

Return the rank index where the first neighborhood boundary occurs. If scores are [1.0, 1.1, 1.15, 2.8, 3.0], the boundary is at rank 3 (the jump from 1.15 to 2.8 exceeds the gap threshold). If no boundary exists, return `this.ranked.length` (all entries are in the same neighborhood).

**`withinNeighborhood(): IRankedEntry[]`**

Return entries before the first boundary — the "similar alternatives" cluster.

**`outsideNeighborhood(): IRankedEntry[]`**

Return entries at or after the first boundary — the "genuinely different" alternatives.

**`clear(): void`**

Reset the ranked list.

**`removeByResourceKey(resourceKey: string): void`**

Remove any entry whose resource keys include the given key. Used when a resource becomes unavailable. Re-rank after removal.

### Neighborhood Boundary Detection Algorithm

After sorting by score, walk the list and compute the gap between adjacent entries as a percentage of the best score:

```
gap = (entry[i].score - entry[i-1].score) / entry[0].score
if gap > gapThreshold → mark entry[i] as neighborhood boundary
```

Only mark the FIRST boundary. This divides the list into two groups:
- **Within neighborhood** — similar placements (same resource, nearby times)
- **Outside neighborhood** — genuinely different (different resource, very different time)

Edge cases:
- If best score is 0, use absolute gap threshold (e.g., 0.5)
- If only 1 entry, no boundary
- If all entries have identical scores, no boundary

### File 2: `SolverState.ts`

A per-solve state container that holds the ranked contexts for every task.

```typescript
import { RankedScheduleContexts } from './RankedScheduleContexts';
import { HashMap } from '../Core/hashmap';

export class SolverState {
  private rankedByTask: HashMap<string, RankedScheduleContexts>;

  constructor() {
    this.rankedByTask = new HashMap<string, RankedScheduleContexts>();
  }

  public getRanked(taskKey: string): RankedScheduleContexts {
    let ranked = this.rankedByTask.get(taskKey);
    if (!ranked) {
      ranked = new RankedScheduleContexts(taskKey);
      this.rankedByTask.set(taskKey, ranked);
    }
    return ranked;
  }

  public clear(): void {
    this.rankedByTask.clear();
  }

  public allTaskKeys(): string[] {
    const keys: string[] = [];
    for (const k of this.rankedByTask.keys()) keys.push(k);
    return keys;
  }
}
```

## Unit Tests

Create: `tests/engine/ranked-contexts.test.ts`

### Test Helpers

Build a helper that creates `BestScheduleContext` objects with controlled scores:

```typescript
function makeBestContext(
  taskKey: string,
  resourceKeys: string[],
  score: number,
  startTime: number = 0
): BestScheduleContext {
  // Create minimal ScheduleContext with the given score
  // Set blendedScore.score = score
  // Set slot.resources with the given resourceKeys
  // Return wrapped in BestScheduleContext
}
```

### Test Cases

**1. Insertion maintains rank order**
```
Add contexts with scores [3.0, 1.0, 2.0, 1.5, 4.0]
Assert ranked order is [1.0, 1.5, 2.0, 3.0, 4.0]
Assert rank 0 = score 1.0
Assert rank 4 = score 4.0
```

**2. maxN enforced — worst entry dropped**
```
maxN = 3
Add 5 contexts with scores [5.0, 1.0, 3.0, 2.0, 4.0]
Assert count() = 3
Assert ranked scores are [1.0, 2.0, 3.0]
Scores 4.0 and 5.0 should be dropped
```

**3. best() returns rank 0**
```
Add contexts with scores [3.0, 1.0, 2.0]
Assert best().blendedScore.score = 1.0
```

**4. best() returns null when empty**
```
New RankedScheduleContexts
Assert best() = null
```

**5. alternative(rank) returns correct entry**
```
Add scores [1.0, 2.0, 3.0]
Assert alternative(0).score = 1.0
Assert alternative(1).score = 2.0
Assert alternative(2).score = 3.0
Assert alternative(3) = null
Assert alternative(-1) = null
```

**6. hasAlternatives**
```
Empty → false
1 entry → false
2 entries → true
5 entries → true
```

**7. Neighborhood boundary — clear gap**
```
gapThreshold = 0.15 (15%)
Add scores [1.0, 1.05, 1.10, 2.5, 3.0]
neighborhoodBoundary() = 3
withinNeighborhood() = entries with scores [1.0, 1.05, 1.10]
outsideNeighborhood() = entries with scores [2.5, 3.0]
```

**8. Neighborhood boundary — no gap**
```
gapThreshold = 0.15
Add scores [1.0, 1.05, 1.08, 1.12, 1.14]
neighborhoodBoundary() = 5 (equals length — all same neighborhood)
withinNeighborhood().length = 5
outsideNeighborhood().length = 0
```

**9. Neighborhood boundary — immediate gap**
```
gapThreshold = 0.15
Add scores [1.0, 5.0]
neighborhoodBoundary() = 1
withinNeighborhood() = [1.0]
outsideNeighborhood() = [5.0]
```

**10. Neighborhood boundary — all identical scores**
```
Add scores [2.0, 2.0, 2.0]
neighborhoodBoundary() = 3 (no boundary)
```

**11. Neighborhood boundary — best score is 0**
```
Add scores [0.0, 0.3, 0.4, 2.0]
Should not divide by zero
Should use absolute gap fallback
neighborhoodBoundary() should still detect the jump to 2.0
```

**12. removeByResourceKey**
```
Add: score 1.0 on [CNC-01], score 2.0 on [CNC-02], score 3.0 on [CNC-01, ASSY-01]
removeByResourceKey('CNC-01')
Assert count() = 1
Assert remaining entry has score 2.0
Assert ranks are recomputed (rank 0 = the surviving entry)
```

**13. clear()**
```
Add 3 entries
clear()
Assert count() = 0
Assert best() = null
```

**14. SolverState — getRanked creates on demand**
```
state = new SolverState()
ranked = state.getRanked('TASK-A')
Assert ranked is not null
Assert ranked.taskKey = 'TASK-A'
Assert same instance returned on second call
```

**15. SolverState — independent per task**
```
state.getRanked('TASK-A').addCandidate(... score 1.0 ...)
state.getRanked('TASK-B').addCandidate(... score 5.0 ...)
Assert state.getRanked('TASK-A').best().score = 1.0
Assert state.getRanked('TASK-B').best().score = 5.0
```

**16. Duplicate score handling**
```
Add scores [1.0, 1.0, 2.0]
Assert count() = 3
Assert rank 0 and rank 1 both have score 1.0
Both should be retrievable via alternative()
```

**17. Resource keys extracted correctly**
```
Add context where slot has resources CNC-01 + OPER-A
Assert ranked[0].resourceKeys = ['CNC-01', 'OPER-A']
```

## Integration Point

After this prompt is complete, the solver's main loop should be updated to populate `SolverState` during scoring. Where the solver currently picks the single best context and creates a `BestScheduleContext`, it should instead:

1. Create `BestScheduleContext` for ALL feasible scored contexts
2. Call `state.getRanked(task.key).addCandidate(bestCtx)` for each
3. Use `state.getRanked(task.key).best()` to get the winner

This integration will happen in the Balanced Strategy prompt (Prompt 3). For now, just build and test the data structures.

---

# Prompt 2: Snapshot/Restore

## Goal

Create a `SolutionSnapshot` class that captures the complete schedule state of a `SchedulingLandscape` and can restore it exactly. This enables strategies to try alternatives and roll back if they don't improve the schedule.

## Why This Matters

The Balanced strategy needs to: bump a task, retry, and if the retry fails, undo everything. The Thorough strategy (tabu search) needs to: try a move, evaluate, and if it's worse than the best solution found so far, restore the best. Without snapshot/restore, there's no way to undo landscape mutations.

## What Must Be Captured

A complete schedule state consists of:

**Per task:**
- `state` (SCHEDULED / NOT_SCHEDULED)
- `scheduled` (CTPInterval — startW, endW, qty)
- `feasible` (CTPInterval or null)
- `processed` (boolean)
- `score` (number)
- `capacityResources` — each entry's `scheduledResource`
- `materialsResources` — each entry's `scheduledResource` (if applicable)

**Per resource:**
- `assignments` — the full linked list of CTPAssignment intervals (nodes with startW, endW, qty, type, name, subType)
- `available.staticAvailable` — the available-after-assignments linked list
- `available.recalc` flag
- `available.recompute` flag
- `available.availableTimes` — the AvailableMatrix time lists (fixed/float/untracked)
- `available.stateChanges` — state change intervals

The snapshot does NOT need to capture:
- Original availability (`resource.original`) — this doesn't change during solving
- Task windows (`task.window`) — these are set by constraint propagation before solving starts
- Task definitions (duration, resources required, etc.) — these don't change
- Horizon — doesn't change

## New File

### `SolutionSnapshot.ts`

Create in the same directory as `schedulecontext.ts`.

```typescript
import { SchedulingLandscape } from './landscape';
import { CTPTask } from './task';
import { CTPResource } from './resource';
import { CTPInterval, CTPAssignment } from '../Core/window';
import { CTPIntervals, CTPAssignments, CTPAvailable, CTPAvailableTimes } from '../Intervals/intervals';
import { AvailableMatrix } from '../Intervals/availablematrix';

interface TaskSnapshot {
  taskKey: string;
  state: number;
  scheduled: { startW: number; endW: number; qty: number | null } | null;
  feasible: { startW: number; endW: number; qty: number | null } | null;
  processed: boolean;
  score: number;
  capacityResourceAssignments: (string | undefined)[];   // scheduledResource per index
  materialsResourceAssignments: (string | undefined)[];
}

interface IntervalSnapshot {
  startW: number;
  endW: number;
  qty: number | null;
  runRate: number | null;
  flowLeft: boolean;
  flowRight: boolean;
  name: string | null;
  type: number;
  subType: number | null;
}

interface ResourceSnapshot {
  resourceKey: string;
  assignments: IntervalSnapshot[];
  recalc: boolean;
  recompute: boolean;
}

export class SolutionSnapshot {
  public tasks: TaskSnapshot[];
  public resources: ResourceSnapshot[];
  public timestamp: number;

  constructor() {
    this.tasks = [];
    this.resources = [];
    this.timestamp = Date.now();
  }
}
```

### Required Functions

**`snapshotSolution(landscape: SchedulingLandscape): SolutionSnapshot`**

Walk every task and resource, extract the mutable state into plain objects (no references to live objects — deep copy all values).

For assignments linked list: walk head to tail, copy each node's data into an `IntervalSnapshot`. Do NOT store references to `ListNode` objects — they are part of the live linked list.

For CTPInterval snapshots: copy `startW`, `endW`, `qty`, `runRate`, `flowLeft`, `flowRight`, `name`, `type`, `subType`.

**`restoreSolution(snapshot: SolutionSnapshot, landscape: SchedulingLandscape): void`**

Apply the snapshot back to the landscape:

1. **Tasks:** For each `TaskSnapshot`, find the task in `landscape.tasks`, set `state`, `processed`, `score`. If `scheduled` is not null, create a new `CTPInterval` and assign it; otherwise set `scheduled = null`. Same for `feasible`. Restore each `capacityResource[i].scheduledResource` and `materialsResource[i].scheduledResource`.

2. **Resources:** For each `ResourceSnapshot`, find the resource in `landscape.resources`. Clear the resource's `assignments` linked list entirely. Rebuild it by creating new `CTPAssignment` nodes from the `IntervalSnapshot` array and inserting them in order. Set `available.recalc` and `available.recompute` flags. Also clear and rebuild `available.availableTimes` and `available.staticAvailable` as needed — or simply set `available.recalc = true` to force the engine to recompute on next access.

**Important:** After restoring, the landscape must produce **identical** solver behavior. If you restore and re-score the same task, you should get the same scores as when the snapshot was taken.

**`computeOverallScore(landscape: SchedulingLandscape): number`**

Compute a single number representing the quality of the current schedule. Sum of all scheduled tasks' blended scores + penalty for each infeasible task.

```typescript
function computeOverallScore(landscape: SchedulingLandscape): number {
  let score = 0;
  const INFEASIBILITY_PENALTY = 1_000_000;

  landscape.tasks?.forEach(task => {
    if (!task.includeInSolve) return;
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      score += task.score !== Number.MAX_VALUE ? task.score : 0;
    } else {
      score += INFEASIBILITY_PENALTY;
    }
  });

  return score;
}
```

## Unit Tests

Create: `tests/engine/snapshot-restore.test.ts`

### Test Setup

Use the same landscape builder pattern from the unschedule tests — create a landscape with known resources and tasks, solve, then snapshot/restore.

### Test Cases

**1. Snapshot captures task state**
```
Solve landscape (tasks A, B, C)
snapshot = snapshotSolution(landscape)
Assert snapshot.tasks.length = 3
Assert snapshot.tasks[0].state = SCHEDULED
Assert snapshot.tasks[0].scheduled != null
Assert snapshot.tasks[0].score != MAX_VALUE
```

**2. Snapshot captures resource assignments**
```
Solve landscape
snapshot = snapshotSolution(landscape)
Find CNC-01 in snapshot.resources
Assert assignments.length > 0
Assert each assignment has valid startW, endW
```

**3. Restore produces identical task state**
```
Solve landscape
snapshot = snapshotSolution(landscape)
Unschedule all tasks (mutate landscape)
Assert all tasks: state = NOT_SCHEDULED
restoreSolution(snapshot, landscape)
Assert all tasks: state = SCHEDULED
Assert all tasks: scheduled.startW matches snapshot values
Assert all tasks: score matches snapshot values
```

**4. Restore produces identical resource assignments**
```
Solve landscape
Capture: assignmentCount = getAssignmentCount(cnc01)
snapshot = snapshotSolution(landscape)
Unschedule all tasks
Assert getAssignmentCount(cnc01) = 0
restoreSolution(snapshot, landscape)
Assert getAssignmentCount(cnc01) = assignmentCount
```

**5. Restore produces identical assignment linked list**
```
Solve landscape
Walk CNC-01 assignments, collect [startW, endW] pairs into array
snapshot = snapshotSolution(landscape)
Unschedule all tasks
restoreSolution(snapshot, landscape)
Walk CNC-01 assignments again, collect [startW, endW] pairs
Assert both arrays are identical
```

**6. Overall score is identical after restore**
```
Solve landscape
score1 = computeOverallScore(landscape)
snapshot = snapshotSolution(landscape)
Unschedule all tasks
score2 = computeOverallScore(landscape)
Assert score2 >> score1 (infeasibility penalties)
restoreSolution(snapshot, landscape)
score3 = computeOverallScore(landscape)
Assert score3 = score1
```

**7. Snapshot is a deep copy — mutations don't affect it**
```
Solve landscape
snapshot = snapshotSolution(landscape)
Capture task A's start time from snapshot
Unschedule task A (mutate landscape)
Assert snapshot still has task A's original start time (not affected by mutation)
```

**8. Multiple snapshots are independent**
```
Solve landscape
snapshot1 = snapshotSolution(landscape)
Unschedule task A
snapshot2 = snapshotSolution(landscape)
Assert snapshot1.tasks differ from snapshot2.tasks (snapshot1 has A scheduled, snapshot2 doesn't)
restoreSolution(snapshot1, landscape) — restores A
Assert task A is scheduled
restoreSolution(snapshot2, landscape) — removes A again
Assert task A is not scheduled
```

**9. Empty landscape snapshot**
```
Create landscape with tasks but don't solve
snapshot = snapshotSolution(landscape)
Assert all tasks in snapshot: state = NOT_SCHEDULED, scheduled = null
restoreSolution(snapshot, landscape)
Assert landscape unchanged
```

**10. Partial solve snapshot**
```
Solve only task A (exclude B and C)
snapshot = snapshotSolution(landscape)
Assert snapshot has A scheduled, B and C not scheduled
Solve B and C (now all 3 scheduled)
restoreSolution(snapshot, landscape)
Assert A is scheduled, B and C are NOT scheduled (restored to partial state)
```

**11. computeOverallScore — all feasible**
```
Solve landscape (3 tasks, all feasible)
score = computeOverallScore(landscape)
Assert score < 1_000_000 (no penalties)
Assert score > 0 (sum of real scores)
```

**12. computeOverallScore — some infeasible**
```
Solve landscape (3 tasks, 1 infeasible)
score = computeOverallScore(landscape)
Assert score >= 1_000_000 (at least one penalty)
```

---

# Prompt 3: Balanced Strategy (Bump Backtracking)

## Goal

Implement the `Balanced` solver strategy. This extends the existing greedy (Quick) solver with bump backtracking: when a task is infeasible, find the lowest-priority task on the bottleneck resource, unschedule it, retry, then attempt to reschedule the bumped task elsewhere.

## Prerequisites

- **Top-N Ranked Contexts** (Prompt 1) — `RankedScheduleContexts` and `SolverState` must exist
- **Snapshot/Restore** (Prompt 2) — `snapshotSolution` and `restoreSolution` must exist
- **Unschedule** — `landscape.unscheduleTask()` must work correctly

## Strategy Overview

```
For each task in priority order:
  1. Build contexts, score, rank into SolverState
  2. If best context is feasible → assign it, done
  3. If infeasible AND bump attempts < maxBumps:
     a. Find bottleneck resource (least available capacity in task's window)
     b. Find lowest-priority scheduled task on that resource overlapping task's window
     c. Snapshot current state
     d. Unschedule the bump candidate
     e. Rebuild contexts for current task and retry
     f. If now feasible → assign it, increment bump count
     g. If still infeasible → restore snapshot, try next bump candidate
  4. If all bumps exhausted → mark infeasible

After main loop:
  Collect all bumped tasks that are still unscheduled
  Attempt to reschedule each one
  Track bumped-and-rescheduled vs bumped-and-lost
```

## New File: `BalancedStrategy.ts`

### Configuration

```typescript
export interface BalancedConfig {
  maxBumpsPerTask: number;        // default: 3
  bumpStrategy: 'lowest-priority' | 'highest-score' | 'most-flexible';  // default: lowest-priority
}

const DEFAULT_CONFIG: BalancedConfig = {
  maxBumpsPerTask: 3,
  bumpStrategy: 'lowest-priority',
};
```

### Core Functions

**`solveBalanced(landscape, scoring, config?): SolveStatistics`**

The main entry point. Iterates tasks in priority/sequence order, calls the 7-step pipeline for each, uses bump backtracking when infeasible.

**`findBottleneckResource(task, landscape): CTPResource | null`**

For a given infeasible task, identify which required resource has the least available capacity within the task's time window. Walk the task's `capacityResources`, for each resource compute available hours in `[task.window.startW, task.window.endW]`, return the one with the least.

**`findBumpCandidates(task, bottleneckResource, landscape): CTPTask[]`**

Find all tasks currently scheduled on the bottleneck resource whose assignments overlap with the infeasible task's window. Sort by priority (ascending — lowest priority first for `lowest-priority` strategy), or by score (descending — highest score first for `highest-score` strategy).

**Filtering rules:**
- Never bump a pinned task
- Never bump a task with higher priority than the blocked task
- Never bump a task that was already bumped in this solve (prevent cascading bumps)

### Stats Integration

Update `SolveStatistics` (or use the existing one) to track:
- `bumpsPerformed: number` — total bump operations
- `backtrackAttempts: number` — total times a bump was attempted
- `backtrackSuccesses: number` — times a bumped task was successfully rescheduled elsewhere
- `bumpedAndLost: number` — bumped tasks that could NOT be rescheduled

## Unit Tests

Create: `tests/engine/balanced-strategy.test.ts`

### Scenario Builders

Build test scenarios with specific contention patterns:

```typescript
function buildContentionScenario() {
  // 1 resource (CNC-01), 9 hours/day for 2 days = 18 total hours
  // 3 tasks: A (10h, priority 1), B (10h, priority 2), C (6h, priority 3)
  // Total demand = 26h > 18h capacity = guaranteed contention
  // Quick strategy: A fills day 1 + 1h of day 2, B gets 8h → infeasible if needs contiguous
  // Balanced: should bump C to fit B, then C may or may not fit
}

function buildPriorityBumpScenario() {
  // 1 resource, 10 hours available
  // Task A: 6h, priority 3 (low priority, scheduled first by sequence)
  // Task B: 6h, priority 1 (high priority, scheduled second)
  // Quick: A gets 6h, B infeasible (only 4h left)
  // Balanced: should bump A (lower priority) to fit B
}
```

### Test Cases

**1. No bumping needed — all tasks fit**
```
Setup: 1 resource, 36 hours available, 3 tasks totaling 6 hours
Run balanced strategy
Assert: all 3 tasks scheduled
Assert: bumpsPerformed = 0
Assert: backtrackAttempts = 0
```

**2. Bump lowest-priority task**
```
Setup: 1 resource (10h), Task A (6h, priority 3), Task B (6h, priority 1)
Sequence: A is scheduled first by sequence, B second
Run balanced strategy
Assert: B is scheduled (higher priority won)
Assert: A is either rescheduled elsewhere or marked infeasible
Assert: bumpsPerformed >= 1
```

**3. Bumped task rescheduled elsewhere**
```
Setup: 2 resources (CNC-01: 10h, CNC-02: 10h)
Task A (6h, priority 3, can use CNC-01 or CNC-02)
Task B (6h, priority 1, can only use CNC-01)
Sequence: A scheduled first on CNC-01, B finds CNC-01 too full
Balanced: bump A from CNC-01, schedule B on CNC-01, reschedule A on CNC-02
Assert: both tasks scheduled
Assert: B on CNC-01, A on CNC-02
Assert: backtrackSuccesses = 1
```

**4. Bumped task lost (no alternative)**
```
Setup: 1 resource (10h)
Task A (6h, priority 3), Task B (6h, priority 1)
No second resource available
Balanced: bump A, schedule B, try to reschedule A — fails (not enough room)
Assert: B scheduled, A infeasible
Assert: bumpedAndLost = 1
```

**5. maxBumpsPerTask respected**
```
Setup: 1 resource (10h), 4 tasks each 4h, only room for 2
maxBumpsPerTask = 2
Run balanced
Assert: backtrackAttempts <= 2 for any single task
```

**6. Pinned tasks never bumped**
```
Setup: 1 resource (10h)
Task A (6h, priority 3, PINNED), Task B (6h, priority 1)
Balanced: B is infeasible, tries to bump A — A is pinned, skip
Assert: A still scheduled at original time
Assert: B marked infeasible
Assert: bumpsPerformed = 0
```

**7. Higher priority never bumped for lower priority**
```
Setup: 1 resource (10h)
Task A (6h, priority 1), Task B (6h, priority 3)
Sequence: A scheduled first
Balanced: B is infeasible, considers bumping A — A has higher priority, skip
Assert: A still scheduled
Assert: B infeasible
Assert: bumpsPerformed = 0
```

**8. Snapshot/restore on failed bump**
```
Setup: 1 resource (10h), Task A (6h), Task B (8h)
Balanced tries to bump A for B, but B still doesn't fit (8h > 10h)
Assert: restore happens — A is still scheduled at original time
Assert: B infeasible
Assert: landscape state identical to pre-bump attempt
```

**9. Ranked contexts populated**
```
Setup: 2 resources, 1 task
Run balanced
Assert: state.getRanked(task.key).count() >= 1
Assert: each entry has valid score and resource keys
```

**10. Stats accuracy**
```
Run balanced on a contention scenario
Assert: stats.tasksProcessed = total tasks
Assert: stats.tasksFeasible + stats.tasksInfeasible = stats.tasksProcessed
Assert: stats.bumpsPerformed >= 0
Assert: stats.backtrackSuccesses <= stats.bumpsPerformed
```

**11. Balanced produces >= Quick feasibility**
```
Run Quick strategy on contention scenario, capture feasibility count
Run Balanced strategy on same scenario, capture feasibility count
Assert: balanced feasibility >= quick feasibility
(This is the key value proposition — bumping should never make things worse)
```

---

# Prompt 4: Stress Tests — Quick vs Balanced

## Goal

Build complex, realistic scheduling scenarios and run both Quick and Balanced strategies against them. Measure and compare: feasibility rate, total score, makespan, bump statistics. These tests prove that backtracking **actually helps** on hard problems.

## Important

This prompt should run AFTER Prompts 1-3 are complete and their unit tests pass. The stress tests depend on all three preceding components.

## Test File

Create: `tests/engine/stress-scenarios.test.ts`

## Scenario Builders

### Scenario 1: Resource Contention (10 tasks, 2 machines)

```
Resources: CNC-01 and CNC-02, each available 8am-5pm (9h) for 5 days = 45h each, 90h total
Tasks: 10 tasks, each 8-12 hours, all can use either CNC-01 or CNC-02
Total demand: ~100 hours (>90 available = guaranteed contention)
Task priorities: 1-10 (1 = highest)
All tasks have same window: full 5-day horizon

Expected: Quick schedules ~8-9 tasks (greedy fills both machines, last 1-2 don't fit)
Expected: Balanced schedules 9-10 tasks (bumping rearranges to pack tighter)
```

### Scenario 2: Chain Under Pressure

```
Resources: MACHINE-A, MACHINE-B, QC-STATION (each 8h/day, 3 days)
Chain: Order-1 has 4 tasks in sequence:
  OP-10 (4h on MACHINE-A) → OP-20 (4h on MACHINE-B) → OP-30 (2h on QC-STATION) → OP-40 (3h on MACHINE-A)
Blockers: 3 independent tasks, each 6h, already using these resources (lower priority)
Priority: chain tasks = 1, blocker tasks = 5

Expected: Quick may fail OP-40 (MACHINE-A full from OP-10 + blocker)
Expected: Balanced bumps the blocker off MACHINE-A to fit OP-40
```

### Scenario 3: Tight Capacity (95% utilization)

```
Resources: 5 resources, each 8h/day for 5 days = 200h total
Tasks: 25 tasks, each 7-9 hours, with resource preferences (each task can use 2 of the 5)
Total demand: ~190h (95% of 200h)
Priorities: random 1-5
Windows: each task has a 3-day window (not the full 5 days)

Expected: Quick gets ~20-22 feasible
Expected: Balanced gets ~23-25 feasible (bumping critical for tight capacity)
```

### Scenario 4: Mixed Priorities (Rush Order)

```
Resources: 3 machines, 8h/day for 3 days = 72h total
Phase 1: solve 8 normal-priority tasks (total ~60h demand, fills most capacity)
Phase 2: add 2 urgent tasks (priority 1, each 8h, can only use machine-1)
Re-solve with all 10 tasks

Expected: Quick may fail the urgent tasks (machine-1 full from phase 1)
Expected: Balanced bumps lower-priority work off machine-1 to accommodate urgents
```

### Scenario 5: Changeover Sensitivity

```
Resources: 1 resource (PAINT-LINE), 8h/day for 5 days = 40h
Tasks: 8 tasks, each 4h, requiring different setups
State changes: changing between product types requires 1h changeover
If poorly ordered: 7 changeovers × 1h = 7h wasted = only 33h productive
If well ordered: group by product type, 3 changeovers = 3h wasted = 37h productive

Expected: Quick may produce a bad ordering with many changeovers
Expected: Balanced can bump tasks to reduce total changeover time
(Note: this tests whether bump improves changeover, not just capacity)
```

## Test Structure

For each scenario, run this comparison:

```typescript
describe('Scenario N: [name]', () => {
  let landscape: SchedulingLandscape;
  let scoring: CTPScoring;

  beforeEach(() => {
    // Build the scenario fresh
    ({ landscape, scoring } = buildScenarioN());
  });

  it('Quick strategy — baseline', () => {
    const stats = solveQuick(landscape, scoring);
    console.log(`Quick: ${stats.tasksFeasible}/${stats.tasksProcessed} feasible`);
    console.log(`Quick: score = ${computeOverallScore(landscape)}`);
    // Record baseline numbers
    expect(stats.tasksFeasible).toBeGreaterThanOrEqual(QUICK_MIN_FEASIBLE);
  });

  it('Balanced strategy — should improve on Quick', () => {
    const stats = solveBalanced(landscape, scoring);
    console.log(`Balanced: ${stats.tasksFeasible}/${stats.tasksProcessed} feasible`);
    console.log(`Balanced: score = ${computeOverallScore(landscape)}`);
    console.log(`Balanced: bumps = ${stats.bumpsPerformed}, successes = ${stats.backtrackSuccesses}`);
    expect(stats.tasksFeasible).toBeGreaterThanOrEqual(BALANCED_MIN_FEASIBLE);
  });

  it('Balanced >= Quick feasibility', () => {
    // Run both on identical scenarios
    const landscapeQ = cloneLandscape(landscape);
    const landscapeB = cloneLandscape(landscape);

    const quickStats = solveQuick(landscapeQ, scoring);
    const balancedStats = solveBalanced(landscapeB, scoring);

    expect(balancedStats.tasksFeasible).toBeGreaterThanOrEqual(quickStats.tasksFeasible);
  });

  it('Balanced completes within time budget', () => {
    const start = Date.now();
    solveBalanced(landscape, scoring);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // 5 seconds max for balanced
  });
});
```

## Key Assertions Across All Scenarios

- **Balanced feasibility >= Quick feasibility** — bumping should never reduce feasibility
- **Balanced time < 5 seconds** — must stay within the strategy's time budget
- **Bumps performed > 0 on contention scenarios** — proves the mechanism actually fires
- **No crashes on any scenario** — even if infeasible, the solver should complete cleanly
- **All invariants hold** — assigned tasks have valid scheduled intervals, resource assignment totals are consistent, no phantom assignments

## Output Format

Each stress test should log a comparison table:

```
┌─────────────────────┬─────────┬──────────┐
│ Metric              │ Quick   │ Balanced │
├─────────────────────┼─────────┼──────────┤
│ Feasible            │ 8/10    │ 10/10   │
│ Overall Score       │ 2000045 │ 45.2    │
│ Makespan (hours)    │ 38.5    │ 41.0    │
│ Bumps               │ 0       │ 3       │
│ Bump Successes      │ 0       │ 2       │
│ Solve Time (ms)     │ 120     │ 450     │
└─────────────────────┴─────────┴──────────┘
```

This gives you concrete evidence that the balanced strategy is worth the extra solve time.
