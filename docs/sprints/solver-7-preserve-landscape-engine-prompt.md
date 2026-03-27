# Engine Prompt: Live Landscape Solve — `preserveLandscape`, `protectOthers`, and Supporting Changes

**What it does:** Enables solving against the live in-memory landscape without reloading from config. Adds protection for non-target tasks during targeted solves. Adds direct mutation endpoints for window and priority. Adds chain expansion and rollback infrastructure.

**Size:** ~2-3 hours CC work
**Depends on:** Existing solve, unschedule, pin, moveTo endpoints
**Unlocks:** AI recommendation apply endpoint, UI live-mutation workflow, surgical solve-selected with chain safety

---

## Why

The current solve flow calls `this.stateService.syncFromConfig()` on every `solve()`, which reloads the entire landscape from disk. This is fine for the standard UI workflow where all mutations are sent as overrides in the request body. But it breaks multi-step operations where:

1. Step 1 mutates the live landscape (e.g. unschedule a task via the immediate action endpoint)
2. Step 2 mutates again (e.g. expand a window)
3. Step 3 needs to solve against those mutations — but `syncFromConfig()` wipes them

This pattern is needed by:
- The AI recommendation engine (diagnose → apply multi-step fix)
- The UI's live-mutation path (unschedule via action button → solve selected)
- Any future workflow that combines immediate actions with a targeted re-solve

Additionally, when solving a subset of tasks, the solver's backtracking strategies (Balanced, Thorough) may unschedule and rearrange non-target tasks. The `protectOthers` flag prevents this by temporarily pinning everything outside the target set.

---

## Part 1: `preserveLandscape` Flag on SolveRequestDto

### 1a. Add to SolveRequestDto

In `dto/solve-request.dto.ts`:

```typescript
export class SolveRequestDto {
  // ... existing fields ...

  /** When true, skip syncFromConfig() and solve against the current in-memory landscape.
   *  Use for multi-step operations where prior mutations must survive through the solve.
   *  Default: false (standard behavior — reload from config). */
  @ApiPropertyOptional({ description: 'Skip config reload — solve against live landscape state' })
  preserveLandscape?: boolean;
}
```

### 1b. Modify solve() in CTPService

In `ctp_service.ts`, change the top of `solve()`:

```typescript
solve(request?: SolveRequestDto): CTPSolveResult {
  const startTime = Date.now();

  // Only reload from config if NOT preserving landscape state
  if (!request?.preserveLandscape) {
    this.stateService.syncFromConfig();
  }

  const landscape = this.ensureLandscape();
  if (!landscape) {
    throw new HttpException('State not loaded.', HttpStatus.BAD_REQUEST);
  }

  // ... rest of solve continues unchanged ...
```

**That's it for the core change.** When `preserveLandscape: true`, the landscape in memory — with any mutations from prior unschedule/pin/moveTo/window/priority calls — is used directly.

### 1c. Swagger annotation

In `ctp_controller.ts`, update the solve endpoint docs:

```typescript
@Post('solve')
@ApiOperation({
  summary: 'Run scheduler with optional overrides and return results.',
  description: 'When preserveLandscape is true, solves against the current in-memory state without reloading from config. Use for multi-step operations where prior mutations must survive.',
})
```

---

## Part 2: `protectOthers` Flag on SolveRequestDto

### 2a. Add to SolveRequestDto

```typescript
export class SolveRequestDto {
  // ... existing fields ...

  /** When true and taskKeys is set, temporarily pin all other scheduled tasks
   *  so the solver only touches the target tasks. Pins are removed after solve.
   *  Only meaningful when taskKeys is also set.
   *  Default: false. */
  @ApiPropertyOptional({ description: 'Temp-pin non-target tasks during targeted solve' })
  protectOthers?: boolean;
}
```

### 2b. Add `_tempPinned` flag to CTPTask

In `task.ts`, add a transient flag (not serialized, not persisted):

```typescript
export class CTPTask extends CTPKeyEntity implements ITask {
  // ... existing fields ...

  /** Transient: true if this task was temporarily pinned by protectOthers. Never serialized. */
  public _tempPinned: boolean = false;

  // In constructor, add:
  this._tempPinned = false;
}
```

### 2c. Implement in solve()

In `ctp_service.ts`, add the protect/cleanup logic around the solver run:

```typescript
solve(request?: SolveRequestDto): CTPSolveResult {
  const startTime = Date.now();

  if (!request?.preserveLandscape) {
    this.stateService.syncFromConfig();
  }

  const landscape = this.ensureLandscape();
  // ... existing validation, strategy setup, override application ...

  // ─── NEW: Protect non-target tasks ───
  if (request?.protectOthers && request?.taskKeys) {
    const targetSet = new Set(request.taskKeys);
    landscape.tasks.forEach(task => {
      if (!targetSet.has(task.key) &&
          task.state === CTPTaskStateConstants.SCHEDULED &&
          !task.pinned &&
          task.includeInSolve) {
        task.pinned = true;
        task.includeInSolve = false;
        task._tempPinned = true;
      }
    });
  }

  // ─── 2. Constraint propagation ─── (unchanged — runs on full landscape)
  const propStart = Date.now();
  stats.windowsTightened = landscape.propagateConstraints();
  stats.propagationTimeMs = Date.now() - propStart;

  // ─── 3. Build scoring ─── (unchanged)
  // ─── 4. Run solver ─── (unchanged)

  const taskList = this.buildTaskList(landscape, request);
  let engineSolveResult: EngineSolveResult | undefined;
  if (taskList.length > 0) {
    engineSolveResult = scheduler.schedule(taskList);
  }

  // ─── NEW: Cleanup temp pins ───
  landscape.tasks.forEach(task => {
    if (task._tempPinned) {
      task.pinned = false;
      task.includeInSolve = true;
      task._tempPinned = false;
    }
  });

  // ─── 5. Collect stats ─── (unchanged)
  // ─── 6. Build response ─── (unchanged)
```

**Important:** The cleanup runs even if the solver throws. Wrap in try/finally:

```typescript
  try {
    if (taskList.length > 0) {
      engineSolveResult = scheduler.schedule(taskList);
    }
  } finally {
    // Always clean up temp pins
    landscape.tasks.forEach(task => {
      if (task._tempPinned) {
        task.pinned = false;
        task.includeInSolve = true;
        task._tempPinned = false;
      }
    });
  }
```

---

## Part 3: `expandChains` Flag on SolveRequestDto

### 3a. Add to SolveRequestDto

```typescript
export class SolveRequestDto {
  // ... existing fields ...

  /** When true and taskKeys is set, auto-include all tasks in the same chain(s)
   *  as the specified tasks. Prevents breaking chain integrity.
   *  Default: true. */
  @ApiPropertyOptional({ description: 'Auto-include chain siblings in taskKeys', default: true })
  expandChains?: boolean;
}
```

### 3b. Implement chain expansion in buildTaskList

In `ctp_service.ts`, modify `buildTaskList()`:

```typescript
private buildTaskList(
  landscape: SchedulingLandscape,
  request?: SolveRequestDto,
): List<CTPTask> {
  const taskList = new List<CTPTask>();

  if (request?.taskKeys) {
    // Expand to include chain siblings if requested (default true)
    let keys = request.taskKeys;
    if (request.expandChains !== false) {
      keys = this.expandToChains(keys, landscape);
    }

    for (const key of keys) {
      const task = landscape.tasks.getEntity(key);
      if (task) taskList.add(task);
    }
    return taskList;
  }

  // ... rest unchanged (filter path, default all-tasks path) ...
}

private expandToChains(taskKeys: string[], landscape: SchedulingLandscape): string[] {
  const expanded = new Set(taskKeys);
  for (const key of taskKeys) {
    const task = landscape.tasks.getEntity(key);
    if (!task?.linkId?.name) continue;
    const chain = landscape.processes.getEntity(task.linkId.name);
    if (chain?.tasks) {
      chain.tasks.forEach(t => expanded.add(t.key));
    }
  }
  return [...expanded];
}
```

**Note:** When `protectOthers` is also true, the chain siblings that were auto-expanded should NOT be temp-pinned. The `protectOthers` logic runs before `buildTaskList`, so we need to apply expansion to the target set used by both:

```typescript
// In solve(), before the protectOthers block:
let effectiveTaskKeys = request?.taskKeys;
if (effectiveTaskKeys && request?.expandChains !== false) {
  effectiveTaskKeys = this.expandToChains(effectiveTaskKeys, landscape);
}

// Use effectiveTaskKeys for protectOthers:
if (request?.protectOthers && effectiveTaskKeys) {
  const targetSet = new Set(effectiveTaskKeys);
  // ... pin non-target tasks ...
}

// And for buildTaskList, pass the expanded keys:
// (override request.taskKeys temporarily or pass directly)
```

---

## Part 4: Direct Window Mutation Endpoint

### 4a. New endpoint in CTPController

```typescript
// ─── Endpoint 10: Set Task Window ───

@Patch('tasks/:taskKey/window')
@ApiOperation({
  summary: 'Directly modify a task\'s scheduling window on the live landscape',
  description: 'Mutates the task window in memory. Does NOT trigger a re-solve. Use with preserveLandscape solve for multi-step operations.',
})
@ApiParam({ name: 'taskKey', description: 'Task key to modify' })
@ApiBody({ type: SetTaskWindowDto })
@ApiResponse({ status: 200, description: 'Window updated' })
@ApiResponse({ status: 404, description: 'Task not found' })
setTaskWindow(@Param('taskKey') taskKey: string, @Body() body: SetTaskWindowDto) {
  return this.ctpService.setTaskWindow(taskKey, body.windowStart, body.windowEnd);
}
```

### 4b. DTO

```typescript
export class SetTaskWindowDto {
  @ApiPropertyOptional({ description: 'New window start (ISO datetime). Null to keep current.' })
  windowStart?: string;

  @ApiPropertyOptional({ description: 'New window end (ISO datetime). Null to keep current.' })
  windowEnd?: string;
}
```

### 4c. Service implementation

```typescript
setTaskWindow(taskKey: string, windowStart?: string, windowEnd?: string): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks?.getEntity(taskKey);

  if (!task) {
    throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
  }
  if (!task.window) {
    throw new HttpException(`Task ${taskKey} has no window`, HttpStatus.BAD_REQUEST);
  }

  const previousStart = CTPDateTime.toDateTime(task.window.startW).toISO()!;
  const previousEnd = CTPDateTime.toDateTime(task.window.endW).toISO()!;

  if (windowStart) {
    const newStartW = CTPDateTime.fromDateTime(windowStart);
    task.window.startW = newStartW;
    task.window.origStartW = newStartW;  // Update orig so propagation won't reset
  }
  if (windowEnd) {
    const newEndW = CTPDateTime.fromDateTime(windowEnd);
    task.window.endW = newEndW;
    task.window.origEndW = newEndW;  // Update orig so propagation won't reset
  }

  // Validate window is still valid
  if (task.window.startW >= task.window.endW) {
    // Revert
    task.window.startW = CTPDateTime.fromDateTime(previousStart);
    task.window.endW = CTPDateTime.fromDateTime(previousEnd);
    task.window.origStartW = task.window.startW;
    task.window.origEndW = task.window.endW;
    throw new HttpException(
      `Invalid window: start >= end after modification`,
      HttpStatus.BAD_REQUEST,
    );
  }

  // If task was previously marked infeasible due to window, clear errors
  if (task.state !== CTPTaskStateConstants.SCHEDULED) {
    task.clearErrors();
    task.includeInSolve = true;
  }

  return {
    taskKey,
    previousWindow: { start: previousStart, end: previousEnd },
    newWindow: {
      start: CTPDateTime.toDateTime(task.window.startW).toISO()!,
      end: CTPDateTime.toDateTime(task.window.endW).toISO()!,
    },
    requiresResolve: true,
  };
}
```

**Critical detail: `origStartW` / `origEndW` must be updated.** The `propagateConstraints()` method (and `CTPInterval.reset()`) uses `origStartW`/`origEndW` to reset windows. If we only change `startW`/`endW` without updating the originals, the next propagation pass resets the window to its old values. This is an intentional override, not a temporary adjustment.

---

## Part 5: Direct Priority Mutation Endpoint

### 5a. New endpoint in CTPController

```typescript
// ─── Endpoint 11: Set Task Priority ───

@Patch('tasks/:taskKey/priority')
@ApiOperation({
  summary: 'Directly modify a task\'s priority on the live landscape',
  description: 'Mutates the task priority in memory. Does NOT trigger a re-solve.',
})
@ApiParam({ name: 'taskKey', description: 'Task key to modify' })
@ApiBody({ type: SetTaskPriorityDto })
@ApiResponse({ status: 200, description: 'Priority updated' })
@ApiResponse({ status: 404, description: 'Task not found' })
setTaskPriority(@Param('taskKey') taskKey: string, @Body() body: SetTaskPriorityDto) {
  return this.ctpService.setTaskPriority(taskKey, body.priority);
}
```

### 5b. DTO

```typescript
export class SetTaskPriorityDto {
  @ApiProperty({ description: 'New priority value (1 = highest/rush, 100 = normal)', minimum: 1 })
  priority: number;
}
```

### 5c. Service implementation

```typescript
setTaskPriority(taskKey: string, priority: number): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks?.getEntity(taskKey);

  if (!task) {
    throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
  }

  const previousPriority = task.priority;
  task.priority = priority;

  return {
    taskKey,
    previousPriority,
    newPriority: priority,
    requiresResolve: true,
  };
}
```

---

## Part 6: TaskSnapshot for Rollback

### 6a. Interface

Create in `ctp_service.ts` (or a separate utilities file):

```typescript
interface TaskSnapshot {
  key: string;
  state: number;
  priority: number;
  originalPriority: number;
  pinned: boolean;
  includeInSolve: boolean;
  score: number;

  // Window
  windowStartW: number;
  windowEndW: number;
  windowOrigStartW: number;
  windowOrigEndW: number;

  // Scheduled interval (null if not scheduled)
  scheduledStartW: number | null;
  scheduledEndW: number | null;

  // Resource assignments: [{ slotIndex, scheduledResource }]
  resourceAssignments: { index: number; scheduledResource: string | null }[];

  // Errors
  errors: { agent: string; reason: string }[];
}
```

### 6b. Capture snapshot

```typescript
private captureTaskSnapshot(task: CTPTask, landscape: SchedulingLandscape): TaskSnapshot {
  const resourceAssignments: { index: number; scheduledResource: string | null }[] = [];
  task.capacityResources?.forEach((tr, idx) => {
    resourceAssignments.push({ index: idx, scheduledResource: tr.scheduledResource ?? null });
  });

  return {
    key: task.key,
    state: task.state,
    priority: task.priority ?? 100,
    originalPriority: task.originalPriority ?? 100,
    pinned: task.pinned,
    includeInSolve: task.includeInSolve,
    score: task.score,
    windowStartW: task.window?.startW ?? 0,
    windowEndW: task.window?.endW ?? 0,
    windowOrigStartW: task.window?.origStartW ?? 0,
    windowOrigEndW: task.window?.origEndW ?? 0,
    scheduledStartW: task.scheduled?.startW ?? null,
    scheduledEndW: task.scheduled?.endW ?? null,
    resourceAssignments,
    errors: task.errors.map(e => ({ agent: e.agent, reason: e.reason })),
  };
}
```

### 6c. Restore from snapshot

```typescript
private restoreTaskSnapshot(snapshot: TaskSnapshot, landscape: SchedulingLandscape): void {
  const task = landscape.tasks.getEntity(snapshot.key);
  if (!task) return;

  // If the task is currently scheduled but wasn't before, unschedule it
  if (task.state === CTPTaskStateConstants.SCHEDULED && snapshot.state !== CTPTaskStateConstants.SCHEDULED) {
    landscape.unscheduleTask(snapshot.key, true);
  }

  // Restore task fields
  task.state = snapshot.state;
  task.priority = snapshot.priority;
  task.originalPriority = snapshot.originalPriority;
  task.pinned = snapshot.pinned;
  task.includeInSolve = snapshot.includeInSolve;
  task.score = snapshot.score;

  // Restore window
  if (task.window) {
    task.window.startW = snapshot.windowStartW;
    task.window.endW = snapshot.windowEndW;
    task.window.origStartW = snapshot.windowOrigStartW;
    task.window.origEndW = snapshot.windowOrigEndW;
  }

  // Restore errors
  task.errors = snapshot.errors.map(e => ({ agent: e.agent, reason: e.reason, type: '' }));

  // Restore resource assignments
  snapshot.resourceAssignments.forEach(ra => {
    if (task.capacityResources) {
      let idx = 0;
      task.capacityResources.forEach(tr => {
        if (idx === ra.index) {
          tr.scheduledResource = ra.scheduledResource ?? undefined;
        }
        idx++;
      });
    }
  });

  // If the task was scheduled before, we need to re-place it
  // This is complex — for now, if the snapshot was scheduled and
  // the task is not, we mark it as needing a re-solve.
  // Full restore of resource availability profiles would require
  // replaying the schedule engine, which is expensive.
  // The practical approach: after rollback, flag requiresResolve.
}

private restoreSnapshots(
  snapshots: Map<string, TaskSnapshot>,
  landscape: SchedulingLandscape,
): void {
  // First pass: unschedule anything that wasn't scheduled before
  for (const [key, snapshot] of snapshots) {
    const task = landscape.tasks.getEntity(key);
    if (task && task.state === CTPTaskStateConstants.SCHEDULED && 
        snapshot.state !== CTPTaskStateConstants.SCHEDULED) {
      landscape.unscheduleTask(key, true);
    }
  }

  // Second pass: restore fields
  for (const [key, snapshot] of snapshots) {
    this.restoreTaskSnapshot(snapshot, landscape);
  }

  // Note: tasks that were scheduled before rollback and need to be
  // re-scheduled are NOT automatically re-placed. The rollback
  // restores the task metadata but the caller should re-solve
  // to get them back in position. In practice, full rollback
  // after a failed multi-step recommendation means "re-diagnose"
  // anyway, which triggers a fresh solve.
}
```

**Rollback limitation:** Perfectly restoring resource availability profiles (the assignment linked lists on each resource) after a partial multi-step operation is complex. The practical approach is:
1. Unschedule any task that got scheduled during the failed sequence
2. Restore task metadata (window, priority, state, errors)
3. Return `rolledBack: true` so the caller knows to re-diagnose

This is sufficient because after a rollback, the planner or AI agent will re-diagnose against the (mostly restored) landscape, which triggers a fresh evaluation.

---

## Part 7: Landscape Hash for Staleness Detection

### 7a. Implementation

A fast hash of the landscape state that changes when any task or resource is modified:

```typescript
private computeLandscapeHash(landscape: SchedulingLandscape): string {
  let hash = 0;
  landscape.tasks.forEach(task => {
    hash ^= this.simpleHash(task.key);
    hash ^= (task.state << 4);
    hash ^= ((task.priority ?? 100) << 8);
    hash ^= (task.pinned ? 0x10000 : 0);
    if (task.scheduled) {
      hash ^= (task.scheduled.startW & 0xFFFF);
      hash ^= ((task.scheduled.endW & 0xFFFF) << 16);
    }
    if (task.window) {
      hash ^= (task.window.startW & 0xFFFF);
    }
  });
  return hash.toString(36);
}

private simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
```

This is intentionally fast and lossy — it's a change detector, not a cryptographic hash. False positives (hash matches when state changed) are extremely unlikely given the mix of task states, priorities, and scheduled times.

---

## Part 8: Verification

### Core flags
- [ ] `preserveLandscape: true` → `syncFromConfig()` NOT called, mutations survive
- [ ] `preserveLandscape: false` (default) → `syncFromConfig()` called, standard behavior
- [ ] `protectOthers: true` with `taskKeys` → non-target scheduled tasks are pinned during solve, unpinned after
- [ ] `protectOthers: true` without `taskKeys` → flag is ignored (no target set to protect against)
- [ ] `_tempPinned` flag cleaned up even if solver throws
- [ ] `expandChains: true` (default) → chain siblings added to effective task list
- [ ] `expandChains: false` → only specified taskKeys processed
- [ ] Chain siblings are NOT temp-pinned when they're part of the expanded target set

### Multi-step sequence test
```
1. POST /ctp/solve                          → full solve, get baseline
2. POST /ctp/tasks/TASK-018/unschedule      → mutates live landscape
3. PATCH /ctp/tasks/TASK-042/window         → expand window by 1 day
4. POST /ctp/solve { preserveLandscape: true, taskKeys: ["TASK-042", "TASK-018"], protectOthers: true }
   → TASK-018 still unscheduled going into solve (NOT reloaded)
   → TASK-042's window reflects the expansion
   → All other tasks stay exactly where they were
   → TASK-042 and TASK-018 get re-solved
5. GET /ctp/state → reflects all mutations + solve results
```

### Window endpoint
- [ ] `PATCH /tasks/:key/window` with new end → `task.window.endW` AND `task.window.origEndW` updated
- [ ] Constraint propagation doesn't reset the expanded window
- [ ] Invalid window (start >= end) → rejected, window reverted
- [ ] Infeasible task with expanded window → errors cleared, `includeInSolve` set true

### Priority endpoint
- [ ] `PATCH /tasks/:key/priority` → `task.priority` updated on live landscape
- [ ] Next solve respects new priority in dispatch order

### Rollback
- [ ] Snapshot captures: state, priority, window (start/end/orig), pinned, includeInSolve, resource assignments
- [ ] Restore unschedules tasks that were scheduled during the failed sequence
- [ ] Restore reverts window/priority/pin changes
- [ ] Response includes `rolledBack: true`

### Existing behavior unchanged
- [ ] `POST /ctp/solve` without new flags → same behavior as before (reload from config, solve all)
- [ ] `POST /ctp/tasks/:key/unschedule` → still works as before (mutates live landscape)
- [ ] `POST /ctp/tasks/:key/move-to` → still works as before (mutates live landscape)
- [ ] `POST /ctp/tasks/:key/schedule` → still works as before
- [ ] All existing UI flows (override accumulation → batch solve) → unchanged

### Edge cases
- [ ] `preserveLandscape: true` on first call before any landscape exists → falls through to `ensureLandscape()` which auto-syncs
- [ ] `protectOthers: true` when no tasks are scheduled → no temp pins, no cleanup needed
- [ ] Chain task with no chain siblings → `expandChains` is a no-op
- [ ] Pinned task in target set → `protectOthers` doesn't double-pin it (check `!task.pinned`)
- [ ] Excluded task in target set → stays excluded (protectOthers only pins `includeInSolve` tasks)

---

*Build order: Parts 1-3 first (the three flags), then Part 4 (window endpoint), then Part 5 (priority endpoint), then Part 6 (rollback). Test at each step.*
