# Engine Sprint — Commitment Stack: CC Build Prompt

**What you're building:** A 6-layer commitment model that teaches the solver which tasks are immovable (running, on hold, dispatched, pinned) and which are flexible (planned, unscheduled). Adds new fields to CTPTask, enriches the solve response with a capacity waterfall, enriches the infeasibility report with committed capacity breakdown, updates the diagnose engine, and adds UI indicators and progression buttons.

**Estimated time:** ~5 hours across 9 parts

**Key context:**
- `CTPWipStateConstants` already has: NOT_STARTED=0, IN_PROCESS=1, WAITING_NEXT=2, ON_HOLD=3, MAINTENTANCE=4, COMPLETED=5
- `CTPTask` already has: `wipstate`, `pinned`, `includeInSolve`, `state`, `canMove()`, `canSolve()`
- The existing `canSolve()` checks `pinned`, `includeInSolve`, and `wipstate !== NOT_STARTED`
- `CTPTaskStateConstants`: NOT_SCHEDULED=0, SCHEDULED=1
- `CTPTaskTypeConstants`: PROCESS, SETUP, TEARDOWN

---

## Part 1: New Fields on CTPTask

Add these fields to `CTPTask` in `task.ts`:

```typescript
// ─── Commitment Stack Fields ───

// Derived commitment level (set before each solve, also included in solve response)
public commitmentLevel: 'running' | 'on_hold' | 'dispatched' | 'pinned' | 'planned' | 'unscheduled' = 'unscheduled';

// Dispatch state — operationally committed, materials pulled
public dispatched: boolean = false;
public dispatchedAt: string | null = null;       // ISO timestamp
public materialsPulled: boolean = false;

// Progress tracking — all client-reported, never engine-computed
public percentComplete: number = 0;              // 0-100
public remainingDuration: number | null = null;  // seconds — client override
public actualStart: string | null = null;        // ISO timestamp
public actualEnd: string | null = null;          // ISO timestamp
public actualResource: string | null = null;     // resource key actually being used
public holdReason: string | null = null;         // why the task is on hold
public estimatedResumeTime: string | null = null; // ISO timestamp — when hold lifts
```

Initialize them all in the constructor:

```typescript
// In constructor, after existing initializations:
this.commitmentLevel = 'unscheduled';
this.dispatched = false;
this.dispatchedAt = null;
this.materialsPulled = false;
this.percentComplete = 0;
this.remainingDuration = null;
this.actualStart = null;
this.actualEnd = null;
this.actualResource = null;
this.holdReason = null;
this.estimatedResumeTime = null;
```

Add the remaining duration method:

```typescript
public effectiveRemainingDuration(): number {
  // 1. Client-provided remaining duration wins (most accurate)
  if (this.remainingDuration != null) return this.remainingDuration;

  // 2. Calculate from percentComplete
  const totalDuration = this.duration?.duration() ?? 0;
  if (this.percentComplete > 0) {
    return Math.max(0, totalDuration * (1 - this.percentComplete / 100));
  }

  // 3. Fall back to full duration
  return totalDuration;
}
```

---

## Part 2: Derive Commitment Level and Apply Stack in Solve

Add a method to `CTPService` that derives commitment levels and enforces the stack before solving. Call this at the start of `solve()`, after loading the landscape but before running the solver.

```typescript
private applyCommitmentStack(landscape: SchedulingLandscape): void {
  landscape.tasks.forEach(task => {
    // ─── Derive commitment level ───
    if (task.wipstate === CTPWipStateConstants.IN_PROCESS) {
      task.commitmentLevel = 'running';
    } else if (task.wipstate === CTPWipStateConstants.ON_HOLD) {
      task.commitmentLevel = 'on_hold';
    } else if (task.wipstate === CTPWipStateConstants.COMPLETED) {
      task.commitmentLevel = 'unscheduled';
      task.includeInSolve = false;
      return;
    } else if (task.dispatched) {
      task.commitmentLevel = 'dispatched';
    } else if (task.pinned) {
      task.commitmentLevel = 'pinned';
    } else if (task.state === CTPTaskStateConstants.SCHEDULED) {
      task.commitmentLevel = 'planned';
    } else {
      task.commitmentLevel = 'unscheduled';
    }

    // ─── Enforce pinning for layers 1-4 ───
    switch (task.commitmentLevel) {
      case 'running':
        task.pinned = true;
        break;
      case 'on_hold':
        task.pinned = true;
        break;
      case 'dispatched':
        task.pinned = true;
        break;
      case 'pinned':
        // Already pinned
        break;
      case 'planned':
        // Solver CAN move these
        break;
      case 'unscheduled':
        // Solver needs to place these
        break;
    }
  });
}
```

Call it in `solve()`:

```typescript
// In solve(), after landscape is loaded and before the solver runs:
this.applyCommitmentStack(landscape);
```

---

## Part 3: Capacity Waterfall Computation

Add a method that computes the capacity waterfall per resource. Call this in `extractResults()` and include it in the solve response.

```typescript
private computeCapacityWaterfall(landscape: SchedulingLandscape): any[] {
  const waterfall: any[] = [];
  const resourceTasks = new Map<string, Map<string, { tasks: number; seconds: number }>>();

  landscape.tasks.forEach(task => {
    if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) return;

    // Find which resource this task is on
    let resourceKey: string | null = null;

    if (task.actualResource) {
      resourceKey = task.actualResource;
    } else if (task.state === CTPTaskStateConstants.SCHEDULED) {
      task.capacityResources?.forEach(tr => {
        if (tr.isPrimary && tr.scheduledResource) {
          resourceKey = tr.scheduledResource;
        }
      });
    }

    // For unscheduled tasks, use the first preferred resource (rough estimate)
    if (!resourceKey && task.commitmentLevel === 'unscheduled') {
      task.capacityResources?.forEach(tr => {
        if (!resourceKey && tr.isPrimary && tr.preferences?.length > 0) {
          resourceKey = tr.preferences[0].resourceKey;
        }
      });
    }

    if (!resourceKey) return;

    if (!resourceTasks.has(resourceKey)) {
      resourceTasks.set(resourceKey, new Map());
    }
    const levels = resourceTasks.get(resourceKey)!;

    const level = task.commitmentLevel;
    if (!levels.has(level)) {
      levels.set(level, { tasks: 0, seconds: 0 });
    }
    const entry = levels.get(level)!;
    entry.tasks += 1;

    // Duration depends on commitment level
    switch (level) {
      case 'running':
      case 'on_hold':
        entry.seconds += task.effectiveRemainingDuration();
        break;
      default:
        entry.seconds += task.duration?.duration() ?? 0;
        break;
    }
  });

  // Build waterfall entries
  const levelOrder = ['running', 'on_hold', 'dispatched', 'pinned', 'planned', 'unscheduled'];

  for (const [resourceKey, levels] of resourceTasks) {
    const resource = landscape.resources?.getEntity(resourceKey);
    if (!resource) continue;

    const horizonSeconds = landscape.horizon ? (landscape.horizon.endW - landscape.horizon.startW) : 0;
    const totalAvailableHours = horizonSeconds / 3600;

    const layers: any[] = [];
    let cumulative = 0;
    let deadCapacityHours = 0;

    for (const level of levelOrder) {
      const entry = levels.get(level);
      if (!entry) {
        layers.push({ level, tasks: 0, hours: 0, cumulative });
        continue;
      }
      const hours = entry.seconds / 3600;
      cumulative += hours;
      if (level === 'on_hold') deadCapacityHours += hours;
      layers.push({
        level,
        tasks: entry.tasks,
        hours: Math.round(hours * 10) / 10,
        cumulative: Math.round(cumulative * 10) / 10,
      });
    }

    waterfall.push({
      resourceKey,
      resourceName: resource.name || resourceKey,
      totalAvailableHours: Math.round(totalAvailableHours * 10) / 10,
      layers,
      remainingCapacity: Math.round((totalAvailableHours - cumulative) * 10) / 10,
      utilizationPercent: totalAvailableHours > 0
        ? Math.round((cumulative / totalAvailableHours) * 1000) / 10
        : 0,
      deadCapacityHours: Math.round(deadCapacityHours * 10) / 10,
    });
  }

  waterfall.sort((a, b) => b.utilizationPercent - a.utilizationPercent);
  return waterfall;
}
```

Add to `extractResults()`:

```typescript
// Include in the returned object:
capacityWaterfall: this.computeCapacityWaterfall(landscape),
```

---

## Part 4: Include Commitment Fields in Solve Response Per-Task

In `extractResults()`, where per-task results are built, add:

```typescript
// Commitment stack fields on each task result:
commitmentLevel: task.commitmentLevel,
dispatched: task.dispatched || false,
dispatchedAt: task.dispatchedAt || null,
materialsPulled: task.materialsPulled || false,
percentComplete: task.percentComplete || 0,
remainingDuration: (task.commitmentLevel === 'running' || task.commitmentLevel === 'on_hold')
  ? task.effectiveRemainingDuration()
  : null,
actualStart: task.actualStart || null,
actualEnd: task.actualEnd || null,
actualResource: task.actualResource || null,
holdReason: task.commitmentLevel === 'on_hold' ? (task.holdReason || null) : null,
estimatedResumeTime: task.commitmentLevel === 'on_hold' ? (task.estimatedResumeTime || null) : null,
```

---

## Part 5: API Endpoints for State Transitions

Add to `ctp_controller.ts`:

```typescript
@Post('tasks/dispatch')
@ApiOperation({ summary: 'Mark tasks as dispatched (materials pulled, operator assigned)' })
dispatch(@Body() body: { taskKeys: string[], actualResource?: string }) {
  return this.ctpService.dispatchTasks(body.taskKeys, body.actualResource);
}

@Post('tasks/start')
@ApiOperation({ summary: 'Mark a task as running' })
startTask(@Body() body: { taskKey: string, actualStart?: string, actualResource?: string }) {
  return this.ctpService.startTask(body.taskKey, body.actualStart, body.actualResource);
}

@Post('tasks/hold')
@ApiOperation({ summary: 'Put a task on hold' })
holdTask(@Body() body: { taskKey: string, holdReason: string, estimatedResumeTime?: string }) {
  return this.ctpService.holdTask(body.taskKey, body.holdReason, body.estimatedResumeTime);
}

@Post('tasks/resume')
@ApiOperation({ summary: 'Resume a held task' })
resumeTask(@Body() body: { taskKey: string }) {
  return this.ctpService.resumeTask(body.taskKey);
}

@Post('tasks/complete')
@ApiOperation({ summary: 'Mark a task as completed' })
completeTask(@Body() body: { taskKey: string, actualEnd?: string }) {
  return this.ctpService.completeTask(body.taskKey, body.actualEnd);
}

@Patch('tasks/:taskKey/progress')
@ApiOperation({ summary: 'Update percent complete and/or remaining duration' })
updateProgress(@Param('taskKey') taskKey: string, @Body() body: { percentComplete?: number, remainingDuration?: number }) {
  return this.ctpService.updateProgress(taskKey, body);
}
```

Implement in `ctp_service.ts`:

```typescript
dispatchTasks(taskKeys: string[], actualResource?: string): any {
  const landscape = this.ensureLandscape();
  const results: any[] = [];
  for (const key of taskKeys) {
    const task = landscape.tasks.getEntity(key);
    if (!task) { results.push({ taskKey: key, result: 'not_found' }); continue; }
    if (task.state !== CTPTaskStateConstants.SCHEDULED) {
      results.push({ taskKey: key, result: 'skipped', detail: 'Must be scheduled first' });
      continue;
    }
    task.dispatched = true;
    task.dispatchedAt = DateTime.now().toISO()!;
    task.materialsPulled = true;
    task.pinned = true;
    if (actualResource) task.actualResource = actualResource;
    task.commitmentLevel = 'dispatched';
    results.push({ taskKey: key, result: 'ok' });
  }
  return { status: 'ok', results };
}

startTask(taskKey: string, actualStart?: string, actualResource?: string): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks.getEntity(taskKey);
  if (!task) throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
  task.wipstate = CTPWipStateConstants.IN_PROCESS;
  task.actualStart = actualStart || DateTime.now().toISO()!;
  if (actualResource) task.actualResource = actualResource;
  task.pinned = true;
  task.commitmentLevel = 'running';
  return { status: 'ok', taskKey, commitmentLevel: 'running', actualStart: task.actualStart };
}

holdTask(taskKey: string, holdReason: string, estimatedResumeTime?: string): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks.getEntity(taskKey);
  if (!task) throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
  task.wipstate = CTPWipStateConstants.ON_HOLD;
  task.holdReason = holdReason;
  task.estimatedResumeTime = estimatedResumeTime || null;
  task.pinned = true;
  task.commitmentLevel = 'on_hold';
  return { status: 'ok', taskKey, commitmentLevel: 'on_hold', holdReason };
}

resumeTask(taskKey: string): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks.getEntity(taskKey);
  if (!task) throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
  task.wipstate = CTPWipStateConstants.IN_PROCESS;
  task.holdReason = null;
  task.estimatedResumeTime = null;
  task.commitmentLevel = 'running';
  return { status: 'ok', taskKey, commitmentLevel: 'running' };
}

completeTask(taskKey: string, actualEnd?: string): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks.getEntity(taskKey);
  if (!task) throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
  task.wipstate = CTPWipStateConstants.COMPLETED;
  task.actualEnd = actualEnd || DateTime.now().toISO()!;
  task.percentComplete = 100;
  task.includeInSolve = false;
  return { status: 'ok', taskKey, actualEnd: task.actualEnd };
}

updateProgress(taskKey: string, body: { percentComplete?: number, remainingDuration?: number }): any {
  const landscape = this.ensureLandscape();
  const task = landscape.tasks.getEntity(taskKey);
  if (!task) throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
  if (body.percentComplete != null) task.percentComplete = body.percentComplete;
  if (body.remainingDuration != null) task.remainingDuration = body.remainingDuration;
  return { status: 'ok', taskKey, percentComplete: task.percentComplete, remainingDuration: task.effectiveRemainingDuration() };
}
```

---

## Part 6: Infeasibility Report Enrichment

In the infeasibility report generation, include commitment level on blocking task entries:

```typescript
// When building blockingTasks in the infeasibility report:
blockingTaskEntry.commitmentLevel = blockerTask?.commitmentLevel ?? 'planned';
blockingTaskEntry.dispatched = blockerTask?.dispatched ?? false;
blockingTaskEntry.materialsPulled = blockerTask?.materialsPulled ?? false;
blockingTaskEntry.holdReason = blockerTask?.holdReason ?? null;
blockingTaskEntry.percentComplete = blockerTask?.percentComplete ?? 0;
```

Add committed capacity summary per bottleneck resource:

```typescript
const committedBreakdown = {
  running: { tasks: 0, hours: 0 },
  on_hold: { tasks: 0, hours: 0 },
  dispatched: { tasks: 0, hours: 0 },
  pinned: { tasks: 0, hours: 0 },
  planned: { tasks: 0, hours: 0 },
};

for (const bt of blockingTasks) {
  const level = bt.commitmentLevel || 'planned';
  if (committedBreakdown[level]) {
    committedBreakdown[level].tasks += 1;
    committedBreakdown[level].hours += (bt.endW - bt.startW) / 3600;
  }
}

bottleneckEntry.committedBreakdown = committedBreakdown;
bottleneckEntry.deadCapacityHours = committedBreakdown.on_hold.hours;
```

---

## Part 7: Diagnose Engine Update

In `generateBumpRecs()`, check commitment levels of blockers:

```typescript
const blockerTask = landscape.tasks.getEntity(blocker.taskKey);
if (!blockerTask) continue;
if (blockerTask.pinned) continue;

// Commitment level checks
if (blockerTask.commitmentLevel === 'running') continue;  // can't bump running

if (blockerTask.commitmentLevel === 'on_hold') {
  // Suggest resolving the hold instead of bumping
  recs.push({
    id: `resolve-hold-${task.key}-${blocker.taskKey}`,
    action: 'expand_window' as const,
    description: `Resolve hold on ${blockerTask.name} to recover capacity — ${blockerTask.holdReason || 'on hold'}`,
    score: 15,  // highest priority — dead capacity recovery
    rank: 0,
    tradeoffs: {
      gains: [`Recovers ${Math.round(blockerTask.effectiveRemainingDuration() / 3600 * 10) / 10}h of dead capacity`],
      costs: ['Requires resolving the hold issue'],
    },
    commands: [],  // Manual resolution — no auto-command
  });
  continue;
}

if (blockerTask.commitmentLevel === 'dispatched') {
  // Add material waste warning to tradeoff costs
  // Continue to generate the bump rec, but with extra cost warning
}

// Existing bump logic continues for 'pinned' and 'planned' blockers...
```

---

## Part 8: Frontend UI

### Task table — commitment level column

```typescript
const COMMITMENT_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  running:      { icon: '●', color: '#ef4444', label: 'Running' },
  on_hold:      { icon: '⚠', color: '#f59e0b', label: 'On Hold' },
  dispatched:   { icon: '◆', color: '#f97316', label: 'Dispatched' },
  pinned:       { icon: '📌', color: '#3b82f6', label: 'Pinned' },
  planned:      { icon: '✓', color: '#22c55e', label: 'Planned' },
  unscheduled:  { icon: '○', color: '#9ca3af', label: 'Unscheduled' },
};
```

### Gantt bars — commitment level styling

```typescript
switch (task.commitmentLevel) {
  case 'running':
    style.borderLeft = '4px solid #ef4444';
    // Add progress overlay: width = percentComplete%
    break;
  case 'on_hold':
    style.borderLeft = '4px solid #f59e0b';
    style.background = `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(245,158,11,0.2) 4px, rgba(245,158,11,0.2) 8px)`;
    break;
  case 'dispatched':
    style.borderLeft = '4px solid #f97316';
    break;
  case 'pinned':
    style.borderLeft = '4px solid #3b82f6';
    break;
}
```

Running tasks with percentComplete > 0 get a progress fill overlay inside the bar.

### Task detail panel — Commitment section

Show for non-planned tasks. Display level icon + label, then level-specific info:
- **Running:** progress bar, actualStart, actualResource, remaining duration
- **On Hold:** holdReason, estimatedResumeTime, dead capacity hours
- **Dispatched:** materialsPulled, dispatchedAt, actualResource

### Progression buttons in selection toolbar

Show contextually based on selected task commitment level:
- `🚀 Dispatch` — when planned/scheduled tasks selected
- `▶ Start` — when dispatched or pinned task selected
- `⏸ Hold` — when running or dispatched task selected
- `▶ Resume` — when on_hold task selected
- `✓ Complete` — when running task selected

Button handlers call the Part 5 API endpoints, then refresh state.

---

## Part 9: Hydrator — Test Data

Support commitment fields in tenant task config JSON so you can test without WIP sync:

```typescript
// In hydrator, after task creation:
if (taskData.dispatched) {
  task.dispatched = true;
  task.dispatchedAt = taskData.dispatchedAt || null;
  task.materialsPulled = taskData.materialsPulled ?? true;
  task.pinned = true;
}
if (taskData.wipState === 'IN_PROCESS') {
  task.wipstate = CTPWipStateConstants.IN_PROCESS;
  task.actualStart = taskData.actualStart || null;
  task.actualResource = taskData.actualResource || null;
  task.percentComplete = taskData.percentComplete ?? 0;
  task.remainingDuration = taskData.remainingDuration ?? null;
}
if (taskData.wipState === 'ON_HOLD') {
  task.wipstate = CTPWipStateConstants.ON_HOLD;
  task.holdReason = taskData.holdReason || null;
  task.estimatedResumeTime = taskData.estimatedResumeTime || null;
  task.actualStart = taskData.actualStart || null;
  task.actualResource = taskData.actualResource || null;
  task.percentComplete = taskData.percentComplete ?? 0;
}
if (taskData.wipState === 'COMPLETED') {
  task.wipstate = CTPWipStateConstants.COMPLETED;
  task.actualStart = taskData.actualStart || null;
  task.actualEnd = taskData.actualEnd || null;
  task.actualResource = taskData.actualResource || null;
  task.percentComplete = 100;
}
```

Add test data to Stafford tasks config:

```json
{
  "key": "PV-001-WELD",
  "wipState": "IN_PROCESS",
  "actualStart": "2026-03-18T08:15:00Z",
  "actualResource": "FAB-JACK",
  "percentComplete": 60,
  "remainingDuration": 5400
},
{
  "key": "PV-002-WELD",
  "dispatched": true,
  "materialsPulled": true,
  "actualResource": "FAB-JACK"
},
{
  "key": "PV-003-NOZZLE",
  "wipState": "ON_HOLD",
  "holdReason": "Quality hold — weld inspection failed",
  "actualStart": "2026-03-18T09:00:00Z",
  "actualResource": "FAB-JACK",
  "percentComplete": 30
}
```

---

## Verification

### Commitment levels
- [ ] `commitmentLevel` derived correctly from wipState + dispatched + pinned
- [ ] Running tasks: remaining duration used, pinned, can't move
- [ ] On Hold tasks: capacity blocked, deadCapacityHours calculated, pinned
- [ ] Dispatched tasks: full window consumed, pinned, materialsPulled set
- [ ] Pinned tasks: full window consumed
- [ ] Planned tasks: movable by solver
- [ ] Completed tasks: excluded from solve

### effectiveRemainingDuration()
- [ ] Client `remainingDuration` wins when provided
- [ ] Falls back to `duration * (1 - percentComplete/100)`
- [ ] Falls back to full duration when no progress info

### Solve behavior
- [ ] `applyCommitmentStack()` called before solver runs
- [ ] Solver skips Running/On Hold/Dispatched/Pinned (canSolve = false)
- [ ] Solver only rearranges Planned and Unscheduled
- [ ] Re-solve after dispatch doesn't move dispatched tasks

### Capacity waterfall
- [ ] In solve response with correct hours per layer per resource
- [ ] `deadCapacityHours` reflects On Hold time
- [ ] Resources sorted by utilization descending

### API endpoints
- [ ] dispatch, start, hold, resume, complete, progress all work
- [ ] Dispatch warns if task not scheduled
- [ ] Complete excludes task from solve

### Infeasibility & Diagnose
- [ ] Blocking tasks include commitmentLevel
- [ ] Running blockers: no bump
- [ ] On Hold blockers: resolve_hold recommendation (score 15)
- [ ] Dispatched blockers: bump with material waste warning

### Frontend
- [ ] Commitment icons in task table
- [ ] Gantt bar styling per level (running=red, on_hold=amber stripes, dispatched=orange, pinned=blue)
- [ ] Running bars show progress fill
- [ ] Task detail Commitment section
- [ ] Progression buttons appear contextually
- [ ] Hydrator loads test data correctly
