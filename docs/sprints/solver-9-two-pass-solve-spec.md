# Spec: Two-Pass Solve — Commitment Anchoring + Solver

**Problem:** The current solver interleaves committed tasks (running, dispatched, pinned) with planned tasks during chain evaluation. This causes the chain engine to overwrite actual positions, and the solve replay shows committed tasks appearing in arbitrary order instead of upfront.

**Fix:** Split the solve into two explicit passes. Pass 1 anchors all committed tasks at their positions and consumes capacity. Pass 2 runs the normal solver on the remaining work. The replay shows the commitment stack locking in first, then the solver filling gaps.

**Size:** ~1.5 hours
**Depends on:** Commitment stack fields (done), applyCommitmentStack (done)

---

## Pass 1: Commitment Anchoring

Before the solver runs, iterate all tasks with commitment levels 1-4 in stack order. For each task, anchor it at its position, assign it to its resource, create the assignment on the resource timeline, and mark it as processed so the solver doesn't touch it.

### Ordering within Pass 1

```
1. Running (IN_PROCESS)     — anchor at actualStart + remainingDuration
2. On Hold (ON_HOLD)        — anchor at actualStart, block until estimatedResumeTime
3. Dispatched               — anchor at scheduled position
4. Pinned                   — anchor at scheduled position
```

Within each level, order by actualStart or scheduledStart (earliest first) so the replay shows a natural timeline.

### Implementation

Add a new method to `CTPService` or the base scheduler, called before the main solver pass:

```typescript
private anchorCommittedTasks(landscape: SchedulingLandscape): void {
  // Collect committed tasks grouped by level
  const committed: { level: number; task: CTPTask }[] = [];

  landscape.tasks.forEach(task => {
    if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) return;

    switch (task.commitmentLevel) {
      case 'running':   committed.push({ level: 1, task }); break;
      case 'on_hold':   committed.push({ level: 2, task }); break;
      case 'dispatched': committed.push({ level: 3, task }); break;
      case 'pinned':    committed.push({ level: 4, task }); break;
      default: break; // planned + unscheduled handled by solver
    }
  });

  // Sort: by level first, then by start time within each level
  committed.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    const aStart = this.getAnchorStart(a.task);
    const bStart = this.getAnchorStart(b.task);
    return aStart - bStart;
  });

  // Anchor each committed task
  for (const { task } of committed) {
    this.anchorTask(task, landscape);
  }
}

private getAnchorStart(task: CTPTask): number {
  // Running/On Hold: use actualStart
  if (task.actualStart) {
    return CTPDateTime.fromDateTime(task.actualStart);
  }
  // Dispatched/Pinned: use scheduled start
  if (task.scheduled) {
    return task.scheduled.startW;
  }
  // Fallback: window start
  return task.window?.startW ?? 0;
}
```

### Anchoring a Single Task

```typescript
private anchorTask(task: CTPTask, landscape: SchedulingLandscape): void {
  // 1. Determine the position
  let startW: number;
  let endW: number;

  if (task.commitmentLevel === 'running' || task.commitmentLevel === 'on_hold') {
    // Use actual position + remaining duration
    startW = task.actualStart
      ? CTPDateTime.fromDateTime(task.actualStart)
      : (task.scheduled?.startW ?? task.window?.startW ?? 0);

    const remaining = task.effectiveRemainingDuration();
    endW = startW + remaining;
  } else {
    // Dispatched/Pinned: use scheduled position
    if (!task.scheduled) return; // can't anchor without a position
    startW = task.scheduled.startW;
    endW = task.scheduled.endW;
  }

  // 2. Set the scheduled interval
  if (!task.scheduled) {
    task.scheduled = new CTPInterval();
  }
  task.scheduled.startW = startW;
  task.scheduled.endW = endW;

  // 3. Mark as scheduled
  task.state = CTPTaskStateConstants.SCHEDULED;
  task.pinned = true;
  task.processed = true;

  // 4. Assign resources and consume capacity
  const actualResources = task.actualResources ?? [];

  task.capacityResources?.forEach((tr, index) => {
    // Determine which resource to assign
    let resourceKey: string | null = null;

    // Check actualResources array first
    if (actualResources.length > 0) {
      // Match by index or by finding the resource in preferences
      if (index < actualResources.length) {
        resourceKey = actualResources[index];
      } else {
        // Try to match actual resource to this slot's preferences
        for (const ar of actualResources) {
          const matchesPref = tr.preferences?.some(p => p.resourceKey === ar);
          if (matchesPref) { resourceKey = ar; break; }
        }
      }
    }

    // Fall back to scheduledResource (from previous solve)
    if (!resourceKey) resourceKey = tr.scheduledResource ?? null;

    // Fall back to first preference
    if (!resourceKey && tr.preferences?.length > 0) {
      resourceKey = tr.preferences[0].resourceKey;
    }

    if (!resourceKey) return;

    // Set the scheduled resource on the slot
    tr.scheduledResource = resourceKey;

    // Create the resource assignment to consume capacity
    const resource = landscape.resources?.getEntity(resourceKey);
    if (resource) {
      const assignment = new CTPAssignment();
      assignment.startW = startW;
      assignment.endW = endW;
      assignment.name = task.key;
      assignment.type = task.commitmentLevel === 'on_hold'
        ? CTPAssignmentConstants.ONHOLD
        : CTPAssignmentConstants.PROCESS;
      resource.assignments.add(assignment);
      resource.recompute = true;
    }
  });

  // 5. Record a solve step for replay
  this.recordSolveStep({
    type: 'anchor',
    taskKey: task.key,
    taskName: task.name,
    commitmentLevel: task.commitmentLevel,
    resourceKey: task.capacityResources?.toArray().find(tr => tr.isPrimary)?.scheduledResource ?? null,
    startW,
    endW,
  });
}
```

---

## Pass 2: Solver Pass

The normal solver runs after the commitment pass. All committed tasks are already placed, pinned, and processed — the solver skips them and schedules the remaining planned + unscheduled tasks around the consumed capacity.

No changes to the solver itself — it already respects pinned tasks and reads the available matrix which now includes the committed assignments.

### Solve Method Update

```typescript
// In solve():

// Step 1: Load landscape, apply overrides
const landscape = this.loadLandscape(request);

// Step 2: Derive commitment levels
this.applyCommitmentStack(landscape);

// Step 3: PASS 1 — Anchor committed tasks (NEW)
this.anchorCommittedTasks(landscape);

// Step 4: Rebuild available matrix after anchoring
// (The resource assignments from Pass 1 need to be reflected)
landscape.resources?.forEach(r => {
  if (r.recompute) {
    // Trigger available matrix rebuild for this resource
    r.recompute = true;
  }
});

// Step 5: PASS 2 — Normal solver on remaining tasks
// The solver sees committed capacity as consumed and schedules around it
const result = this.scheduler.solve(landscape, scoring, strategy);
```

---

## Solve Replay Integration

### Step Types

Add a new solve step type for commitment anchoring. The replay player renders these differently from solver placement steps:

```typescript
interface SolveStep {
  type: 'anchor' | 'schedule' | 'unschedule' | 'bump' | 'backtrack';
  taskKey: string;
  taskName: string;
  commitmentLevel?: string;  // only for type: 'anchor'
  resourceKey?: string;
  startW?: number;
  endW?: number;
  detail?: string;
}
```

### Replay Rendering

Anchor steps render with commitment-level styling:

```typescript
function getStepLabel(step: SolveStep): string {
  if (step.type === 'anchor') {
    const levelLabels: Record<string, string> = {
      running: '● Anchor (running)',
      on_hold: '⚠ Anchor (on hold)',
      dispatched: '◆ Anchor (dispatched)',
      pinned: '📌 Anchor (pinned)',
    };
    return `${levelLabels[step.commitmentLevel!] || 'Anchor'}: ${step.taskName} → ${step.resourceKey}`;
  }
  // ... existing step labels for schedule/bump/etc
}

function getStepColor(step: SolveStep): string {
  if (step.type === 'anchor') {
    switch (step.commitmentLevel) {
      case 'running': return '#ef4444';
      case 'on_hold': return '#f59e0b';
      case 'dispatched': return '#f97316';
      case 'pinned': return '#3b82f6';
    }
  }
  return '#22c55e'; // solver steps are green
}
```

### Replay Timeline

The replay shows a clear break between passes:

```
── Pass 1: Commitment Anchoring ──────────────────
Step 1:  ● WO-1001-DEBURR anchored on CNC-01 (running 40%)
Step 2:  ● WO-1005-ASSEMBLE anchored on ASM-01 (running 50%)
Step 3:  ⚠ WO-1003-H-MACHINE anchored on CNC-01 (on hold — tool breakage)
Step 4:  ◆ WO-1001-ASSEMBLE anchored on ASM-01 (dispatched)
Step 5:  ◆ WO-1003-ASSEMBLE anchored on ASM-01 (dispatched)
Step 6:  ◆ WO-1004-H-MACHINE anchored on CNC-01 (dispatched)
Step 7:  📌 WO-1001-QC anchored on ASM-01 (pinned)
── Pass 2: Solver ────────────────────────────────
Step 8:  ✓ WO-1005-QC placed on ASM-01
Step 9:  ✓ WO-1005-PACK placed on ASM-01
Step 10: ✓ WO-1002-ASSEMBLE placed on ASM-01
Step 11: ✓ WO-1001-PACK placed on ASM-01
...
```

The step log could show a separator or heading between the two passes. The Gantt replay shows committed tasks appearing first (in their commitment colors), then solver tasks filling in.

---

## Completed Tasks in Pass 1

Completed tasks are a special case. They don't consume future capacity, but they need to be present in the landscape so chain propagation works. In Pass 1:

```typescript
// Before the main anchor loop, handle completed tasks:
landscape.tasks.forEach(task => {
  if (task.wipstate === CTPWipStateConstants.COMPLETED) {
    // Set scheduled interval from actuals (for chain propagation)
    if (task.actualStart && task.actualEnd) {
      if (!task.scheduled) task.scheduled = new CTPInterval();
      task.scheduled.startW = CTPDateTime.fromDateTime(task.actualStart);
      task.scheduled.endW = CTPDateTime.fromDateTime(task.actualEnd);
    }
    task.state = CTPTaskStateConstants.SCHEDULED;
    task.pinned = true;
    task.processed = true;

    // Do NOT create resource assignments — capacity is freed
    // The scheduled position is only used for chain predecessor references

    this.recordSolveStep({
      type: 'anchor',
      taskKey: task.key,
      taskName: task.name,
      commitmentLevel: 'completed',
      resourceKey: task.actualResources?.[0] ?? null,
      startW: task.scheduled?.startW,
      endW: task.scheduled?.endW,
    });
  }
});
```

This ensures:
- Completed tasks have a scheduled position (successor windows can reference it)
- Completed tasks don't consume capacity (no assignment created)
- Completed tasks appear in the replay as the first items (before running tasks)
- Chain propagation sees predecessor actualEnd for window tightening

---

## Chain Engine Interaction

With the two-pass approach, the chain engine (Pass 2) encounters chains where some tasks are already anchored:

```
WO-1001: [MACHINE ✓] → [DEBURR ●] → [ASSEMBLE ◆] → [QC 📌] → [PACK ○]
          completed     running       dispatched     pinned     planned
          anchored      anchored      anchored       anchored   solver
```

The chain engine should:
1. See that MACHINE, DEBURR, ASSEMBLE, and QC are already `processed = true`
2. Skip them during context explosion and combo evaluation
3. Use their anchored positions as fixed constraints for PACK
4. Schedule PACK after QC's anchored end time

The existing `if (task.processed) continue` or `if (task.pinned && task.state === SCHEDULED) continue` guards in the chain engine handle this — no changes needed if Pass 1 sets `processed = true` on all anchored tasks.

---

## Sync / Solve Separation

The two-pass solve implies a clean separation between data loading and scheduling:

**Sync** loads data and derives commitment levels. After sync, the landscape has all committed tasks with their correct levels, actual positions, and resource assignments — but no solver-placed tasks. This is the "floor reality" state.

**Solve** runs the two passes. Pass 1 anchors commitments (creating capacity assignments). Pass 2 fills the rest.

### Sync Endpoint Behavior

```
POST /v1/state/sync  →  hydrate landscape
                     →  deriveCommitmentLevels() on every task
                     →  return state with commitment levels + committed positions

POST /ctp/solve      →  Pass 1: anchorCommittedTasks()
                     →  Pass 2: solver()
                     →  return full schedule
```

The sync endpoint should return enough data for the UI to render the committed state **before** a solve:

```typescript
// In the sync response or GET /ctp/state when no solve has run:
{
  "status": "synced",          // not "solved" — no solver has run
  "tasks": [
    // Committed tasks: have positions, resources, commitment levels
    {
      "key": "T-1001-H-MACHINE",
      "commitmentLevel": "completed",
      "scheduledStart": "2026-02-10T07:00:00Z",
      "scheduledEnd": "2026-02-10T11:00:00Z",
      "assignedResources": [{ "resourceKey": "CNC-01", "isPrimary": true }],
      "feasible": true,
      "percentComplete": 100,
    },
    {
      "key": "T-1001-H-DEBURR",
      "commitmentLevel": "running",
      "scheduledStart": "2026-02-10T11:00:00Z",
      "scheduledEnd": "2026-02-10T11:36:00Z",   // actualStart + remaining
      "assignedResources": [{ "resourceKey": "CNC-01", "isPrimary": true }],
      "feasible": true,
      "percentComplete": 40,
      "remainingDuration": 2160,
    },
    // ...
    // Uncommitted tasks: no positions, no resources
    {
      "key": "T-1005-QC",
      "commitmentLevel": "unscheduled",
      "scheduledStart": null,
      "scheduledEnd": null,
      "assignedResources": [],
      "feasible": false,
    },
  ],
  "summary": {
    "totalTasks": 29,
    "committedTasks": 12,       // running + on_hold + dispatched + pinned + completed
    "uncommittedTasks": 17,     // planned + unscheduled (awaiting solve)
    "solveRequired": true,      // flag telling the UI "hit solve to schedule the rest"
  },
  "capacityWaterfall": [...]    // can compute from committed tasks alone
}
```

### Pre-Solve Gantt

After sync but before solve, the Gantt renders a partial schedule showing only committed tasks:

```
CNC-01:  ┤✓ 1001-MACHINE│● 1001-DEBURR (40%)│⚠ 1003-H-MACH (hold)│◆ 1004-H-MACH│         │
CNC-02:  ┤✓ 1003-B-MACH │✓ 1005-B-MACH      │✓ 1002-B-MACH       │             │         │
ASM-01:  ┤● 1005-ASSM (50%)│◆ 1001-ASSM     │◆ 1003-ASSM          │📌 1001-QC   │         │
                                                                                    ↑
                                                                              empty = unsolved
```

The Gantt shows:
- Committed tasks in their commitment-level colors at their actual/scheduled positions
- Empty resource rows where no committed work exists
- A subtle "unsolved" indicator (dimmed empty space or a banner)

The unscheduled panel shows all uncommitted tasks: "17 tasks awaiting solve"

The planner sees the floor reality — what's done, what's running, what's blocked, what's staged — and can review it before hitting solve. This is valuable because:

1. **Verification** — "Is this what the floor actually looks like?" before the solver optimizes around it
2. **Hold resolution** — the planner sees the WO-1003 hold blocking CNC-01 and can resolve it before solving
3. **Dispatch review** — "Are these the right tasks to dispatch next?" before committing
4. **Capacity preview** — the waterfall shows how much capacity is already consumed vs. available for the solver

### UI State Machine

The UI needs to handle three states:

```
┌─────────────────────────────────────────────────────┐
│ State 1: NO DATA                                     │
│ Before any sync. Empty Gantt. "Import data to begin" │
├─────────────────────────────────────────────────────┤
│ State 2: SYNCED (not solved)                         │
│ After sync, before solve. Gantt shows committed      │
│ tasks only. Unscheduled panel shows uncommitted.     │
│ Banner: "17 tasks awaiting schedule — [Solve Now]"   │
├─────────────────────────────────────────────────────┤
│ State 3: SOLVED                                      │
│ After solve. Gantt shows full schedule. Normal view.  │
│ Re-sync returns to State 2 (new data, stale solve).  │
└─────────────────────────────────────────────────────┘
```

The transition from State 2 → State 3 is the solve. The transition from State 3 → State 2 happens when new data arrives (sync, WIP update, CSV upload) that invalidates the current solve.

### Stale Solve Banner

When in State 2 (synced but not solved), show a banner:

```
┌──────────────────────────────────────────────────────────────┐
│ ℹ  Schedule shows committed tasks only. 17 tasks awaiting   │
│    schedule.                                    [Solve Now]  │
└──────────────────────────────────────────────────────────────┘
```

When in State 3 but data has changed since the last solve (e.g., a dispatch or hold was applied):

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠  Floor state has changed since last solve.                 │
│    2 tasks dispatched, 1 task on hold.          [Re-Solve]   │
└──────────────────────────────────────────────────────────────┘
```

---

## Verification

### Pass 1 — Commitment Anchoring
- [ ] Running tasks anchored at actualStart + remainingDuration
- [ ] On Hold tasks anchored at actualStart, capacity blocked
- [ ] Dispatched tasks anchored at scheduled position
- [ ] Pinned tasks anchored at scheduled position
- [ ] Completed tasks have scheduled position but no capacity assignment
- [ ] Resource assignments created for running/on_hold/dispatched/pinned
- [ ] `resource.recompute = true` set for all affected resources
- [ ] All anchored tasks have `processed = true` and `pinned = true`
- [ ] Anchoring order: completed → running → on_hold → dispatched → pinned
- [ ] Within each level, ordered by start time (earliest first)

### Pass 2 — Solver
- [ ] Solver skips all anchored tasks (processed = true)
- [ ] Solver sees committed capacity as consumed
- [ ] Solver schedules planned/unscheduled tasks around committed work
- [ ] Chain propagation uses anchored predecessor positions for window tightening
- [ ] No overlap between committed and solver-placed tasks on same resource

### Replay
- [ ] Anchor steps appear before solver steps
- [ ] Anchor steps show commitment-level colors and labels
- [ ] Clear visual separation between Pass 1 and Pass 2 in step log
- [ ] Gantt replay shows committed tasks appearing first, then solver filling in
- [ ] Completed tasks show as first replay steps (position only, no capacity bar)

### Resource Capacity
- [ ] Running task consumes only remaining duration on its resource
- [ ] On Hold task blocks capacity (dead capacity)
- [ ] Dispatched task consumes full scheduled window
- [ ] Completed task does NOT consume capacity
- [ ] Available matrix correctly reflects all committed capacity before solver runs
- [ ] No double-booking between committed and solver-placed tasks

### Chain Handling
- [ ] Chains with mixed commitment levels solve correctly
- [ ] WO-1001 chain: PACK schedules after pinned QC
- [ ] WO-1003 chain: QC schedules after dispatched ASSEMBLE (which waits for ON_HOLD)
- [ ] Completed predecessor: successor window starts at actualEnd
- [ ] Running predecessor: successor window starts at actualStart + remaining

### Edge Cases
- [ ] Task dispatched but not yet scheduled (no scheduled position) — skip or warn
- [ ] All tasks in a chain are committed — solver has nothing to do for that chain
- [ ] No committed tasks at all — Pass 1 is a no-op, Pass 2 runs normally
- [ ] Committed task references a resource that doesn't exist — skip with warning

### Sync / Pre-Solve State
- [ ] After sync (no solve), committed tasks have positions and resources in response
- [ ] After sync (no solve), uncommitted tasks have null positions
- [ ] Response includes `status: 'synced'` and `summary.solveRequired: true`
- [ ] Capacity waterfall computable from committed tasks alone
- [ ] Gantt renders committed tasks at correct positions before solve
- [ ] Unscheduled panel shows uncommitted task count
- [ ] "Awaiting solve" banner shown in synced-not-solved state
- [ ] Stale solve banner shown when floor state changes after last solve
- [ ] Solve transitions UI from synced state to solved state
- [ ] Re-sync after solve transitions UI back to synced state (stale solve)

---

*Build order: `anchorCommittedTasks()` method (~30 min), completed task handling (~15 min), wire into solve() before solver pass (~15 min), sync response with commitment state (~30 min), solve replay step recording (~15 min), replay UI rendering for anchor steps (~15 min), pre-solve Gantt + state banners (~30 min), testing with sandbox data (~15 min). Total: ~2.5 hours.*
