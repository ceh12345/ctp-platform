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

