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

