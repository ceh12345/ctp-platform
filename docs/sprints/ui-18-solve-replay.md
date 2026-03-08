# Sprint 18: Solve Replay

**What it does:** After a solve completes, the planner can replay the solve step-by-step on the Gantt. Tasks appear one by one in the order the solver processed them. Chains build together. Bumps show bars disappearing and reappearing. Infeasible tasks flash red. Play/pause, step forward/back, speed control.

**Size:** ~2-3 hours CC work (engine logging + frontend player)  
**Depends on:** Phase 3 (chain context engine with bump-and-retry)  
**No new API endpoints** — solve response includes step log, frontend replays it

---

## Why

After a solve, planners ask: "Why is CASE-009 on OR-02 at 11:00 instead of OR-01 at 8:00?" Today they can only see the final result. With solve replay they rewind and watch:

```
Step 12: CASE-009 placed → OR-01 at 8:00      (bar appears)
...
Step 18: CASE-008 infeasible → needs OR-01     (flash)
Step 19: ⟳ BUMP CASE-009                       (bar disappears from OR-01)
Step 20: CASE-008 placed → OR-01 at 8:00       (bar appears)
Step 21: CASE-009 retried → OR-02 at 11:00     (bar appears on different row)
```

"Oh — CASE-008 had higher priority and needed that slot. Makes sense."

Also a powerful demo and sales tool. Watching the solver think is compelling.

---

## Part 1: Engine — Record Solve Steps

### 1a. SolveStep interface

```typescript
interface SolveStep {
  sequence: number;           // 1, 2, 3... in processing order
  action: SolveAction;        // what happened
  taskKey: string;            // which task
  chainKey: string | null;    // which chain (null for standalone tasks)
  resourceKey: string | null; // primary resource assigned (null if infeasible)
  resourceName: string | null;
  startTime: string | null;   // ISO datetime (null if infeasible)
  endTime: string | null;     // ISO datetime (null if infeasible)
  score: number | null;       // blended score (null if infeasible)
  reason: string | null;      // explanation for bumps, infeasible, skips
  chainPhase: string | null;  // "SETUP" | "PROCESS" | "TEARDOWN" | null
  bumpTarget: string | null;  // chain key that was bumped (only for bump actions)
}

type SolveAction = 
  | 'schedule'      // task placed successfully
  | 'infeasible'    // no feasible context found
  | 'bump'          // another chain was unscheduled to make room
  | 'bump-remove'   // the specific task being removed during a bump
  | 'retry'         // re-evaluation after a bump
  | 'retry-success' // retry succeeded
  | 'retry-fail'    // retry still infeasible
  | 'skip'          // task skipped (pinned, excluded, already scheduled)
  | 'chain-start'   // marks the beginning of a chain evaluation
  | 'chain-end'     // marks the end of a chain evaluation
  ;
```

### 1b. Recording steps in the solver loop

Add a `SolveStep[]` array to the solve context. Record steps at each decision point:

```typescript
const solveSteps: SolveStep[] = [];
let stepSequence = 0;

function recordStep(
  action: SolveAction,
  task: CTPTask,
  chain: CTPProcess | null,
  resource?: CTPResource | null,
  startTime?: number,
  endTime?: number,
  score?: number,
  reason?: string,
  bumpTarget?: string,
): void {
  stepSequence++;
  solveSteps.push({
    sequence: stepSequence,
    action,
    taskKey: task.key,
    chainKey: chain?.key || task.linkId?.name || null,
    resourceKey: resource?.key || null,
    resourceName: resource?.name || null,
    startTime: startTime ? CTPDateTime.toDateTime(startTime).toISO() : null,
    endTime: endTime ? CTPDateTime.toDateTime(endTime).toISO() : null,
    score: score ?? null,
    reason: reason ?? null,
    chainPhase: task.type || null,
    bumpTarget: bumpTarget ?? null,
  });
}
```

### 1c. Where to record steps

**Pass 1 — Chain evaluation:**

```typescript
// Before evaluating a chain
recordStep('chain-start', chain.tasks.first(), chain);

// After committing each task in a chain combo
for (const ctx of bestCombo.contexts) {
  const task = ctx.task;
  const primarySlot = ctx.slot.resources?.find(/* isPrimary */);
  recordStep('schedule', task, chain, primarySlot?.resource,
    combo.startTimes[i].assignedStart, combo.startTimes[i].assignedEnd,
    ctx.blendedScore.score);
}

recordStep('chain-end', chain.tasks.first(), chain);

// If chain is infeasible on Pass 1
chain.tasks.forEach(task => {
  recordStep('infeasible', task, chain, null, undefined, undefined, undefined,
    'No feasible chain context combination');
});
```

**Pass 2 — Bump-and-retry:**

```typescript
// Bump event — record removal of each task in bumped chain
blockerChain.tasks.forEach(task => {
  if (task.state === CTPTaskStateConstants.SCHEDULED) {
    const primaryRes = /* find scheduled primary resource */;
    recordStep('bump-remove', task, blockerChain, primaryRes,
      task.scheduled?.startW, task.scheduled?.endW, undefined,
      `Bumped to free ${bumpCandidate.resourceKey} for ${failedChain.key}`,
      failedChain.key);
  }
});

// Retry — record the attempt
recordStep('retry', failedChain.tasks.first(), failedChain);

// Retry success — record each scheduled task
if (retryCombo) {
  for (const ctx of retryCombo.contexts) {
    recordStep('retry-success', ctx.task, failedChain, /* resource */,
      combo.startTimes[i].assignedStart, combo.startTimes[i].assignedEnd,
      ctx.blendedScore.score);
  }
}

// Retry fail
if (!retryCombo) {
  failedChain.tasks.forEach(task => {
    recordStep('retry-fail', task, failedChain, null, undefined, undefined, undefined,
      'Still infeasible after bump');
  });
}

// Bumped chain reschedule
if (bumperRetry) {
  for (const ctx of bumperRetry.contexts) {
    recordStep('schedule', ctx.task, blockerChain, /* resource */,
      combo.startTimes[i].assignedStart, combo.startTimes[i].assignedEnd,
      ctx.blendedScore.score, 'Rescheduled after bump');
  }
} else {
  blockerChain.tasks.forEach(task => {
    recordStep('infeasible', task, blockerChain, null, undefined, undefined, undefined,
      `Bumped by ${failedChain.key}, could not reschedule`);
  });
}
```

**Standalone tasks (per-task greedy):**

```typescript
// Task scheduled
recordStep('schedule', task, null, primaryResource, st, et, task.score);

// Task infeasible
recordStep('infeasible', task, null, null, undefined, undefined, undefined, errorReason);

// Task skipped
if (task.pinned) recordStep('skip', task, null, null, undefined, undefined, undefined, 'Pinned');
if (!task.includeInSolve) recordStep('skip', task, null, null, undefined, undefined, undefined, 'Excluded');
```

### 1d. Include in solve response

Add the steps array to the solve response:

```typescript
return {
  // ... existing response fields ...
  solveSteps: solveSteps,
};
```

---

## Part 2: Frontend — Replay Player

### 2a. Replay Mode Toggle

Add a replay button to the Schedule tab toolbar, next to the Solve button:

```
[▶ Solve]  [⟳ Replay]  [Strategy ▾]
```

The Replay button is only enabled after a solve completes. Clicking it enters replay mode.

### 2b. Replay State

```typescript
interface ReplayState {
  active: boolean;              // is replay mode on?
  steps: SolveStep[];           // the solve steps from the response
  currentStep: number;          // which step we're showing (0 = empty, 1 = first step)
  playing: boolean;             // auto-playing?
  speed: number;                // ms between steps (default 500)
  visibleTasks: Set<string>;    // task keys currently showing on Gantt
  flashingTasks: Set<string>;   // tasks currently flashing (infeasible, bump)
}
```

### 2c. Replay Controls

A control bar appears at the bottom of the Gantt when replay mode is active:

```
┌──────────────────────────────────────────────────────────────────┐
│  ⏮  ◀  ▶/⏸  ▶▶  ⏭     Step 12 of 27     Speed: [━━━●━━]     │
│                                                                  │
│  CASE-002 PROC → OR-01 7:00-8:00  score: 2.3                    │
│                                                                  │
│  [Exit Replay]                                                   │
└──────────────────────────────────────────────────────────────────┘
```

Controls:
- **⏮** Jump to start (step 0, empty Gantt)
- **◀** Step backward one step
- **▶/⏸** Play/pause auto-advance
- **▶▶** Step forward one step
- **⏭** Jump to end (full solve result, same as exiting replay)
- **Speed slider** — 100ms (fast) to 2000ms (slow), default 500ms
- **Step counter** — "Step 12 of 27"
- **Step description** — what happened at this step
- **Exit Replay** — returns to normal view with full solve result

### 2d. Step Description Text

Generate a human-readable description for each step:

```typescript
function describeStep(step: SolveStep): string {
  switch (step.action) {
    case 'chain-start':
      return `Evaluating chain: ${step.chainKey}`;
    case 'schedule':
      return `${step.taskKey} → ${step.resourceName} ${fmtTime(step.startTime)}–${fmtTime(step.endTime)}`;
    case 'infeasible':
      return `${step.taskKey} — infeasible: ${step.reason}`;
    case 'bump-remove':
      return `⟳ Bumping ${step.chainKey}: removing ${step.taskKey} from ${step.resourceName}`;
    case 'retry':
      return `Retrying ${step.chainKey} with freed resources...`;
    case 'retry-success':
      return `✓ ${step.taskKey} → ${step.resourceName} ${fmtTime(step.startTime)}–${fmtTime(step.endTime)}`;
    case 'retry-fail':
      return `✗ ${step.taskKey} still infeasible: ${step.reason}`;
    case 'skip':
      return `Skipped ${step.taskKey} (${step.reason})`;
    case 'chain-end':
      return `Chain ${step.chainKey} complete`;
    default:
      return `${step.action}: ${step.taskKey}`;
  }
}
```

### 2e. Gantt Rendering in Replay Mode

In replay mode, the Gantt only shows tasks in the `visibleTasks` set. As the player advances, tasks are added or removed:

```typescript
function advanceToStep(targetStep: number, steps: SolveStep[]): Set<string> {
  const visible = new Set<string>();

  for (let i = 0; i < targetStep; i++) {
    const step = steps[i];

    switch (step.action) {
      case 'schedule':
      case 'retry-success':
        visible.add(step.taskKey);
        break;

      case 'bump-remove':
        visible.delete(step.taskKey);
        break;

      // infeasible, retry-fail, skip — task NOT visible
      // chain-start, chain-end, retry — no visibility change
    }
  }

  return visible;
}
```

The Gantt filters its task list:

```typescript
const displayTasks = replayState.active
  ? tasks.filter(t => replayState.visibleTasks.has(t.taskKey))
  : tasks.filter(t => t.state === 'SCHEDULED');
```

### 2f. Animations

When stepping forward:

| Action | Animation |
|--------|-----------|
| `schedule` | Bar slides in from left, lands at position. Brief green highlight. |
| `infeasible` | Red flash in the unscheduled panel or task table row. 200ms. |
| `bump-remove` | Bar flashes orange, then fades out / slides off. |
| `retry-success` | Bar slides in with green highlight (same as schedule). |
| `retry-fail` | Red flash (same as infeasible). |
| `chain-start` | Subtle highlight of chain name in sidebar/header. |
| `chain-end` | Brief checkmark animation next to chain name. |
| `skip` | Gray flash on task row. |

Keep animations simple — CSS transitions, 200-300ms. No heavy animation library needed.

When stepping backward: reverse the effect. Bar added on forward → removed on backward. Bar removed on forward → re-added on backward.

### 2g. Chain Grouping in Replay

When a `chain-start` step is reached, optionally highlight all resources involved in that chain on the Gantt (subtle background tint on the resource rows). Cleared on `chain-end`. This shows the planner which part of the schedule the solver is working on.

---

## Part 3: Step Log Panel (Optional Enhancement)

Below or beside the Gantt, show a scrolling log of all steps up to the current position:

```
┌──────────────────────────────────────────────────────────────┐
│  Solve Log                                                    │
│                                                              │
│  1. Evaluating chain: CASE-001                               │
│  2. ✓ C001-SETUP → OR-01 6:45-7:00          score: 1.2      │
│  3. ✓ C001-PROC  → OR-01 7:00-8:00          score: 2.3      │
│  4. ✓ C001-REC   → REC-01 8:00-9:30         score: 1.8      │
│  5. Chain CASE-001 complete                                   │
│  6. Evaluating chain: CASE-002                               │
│  7. ✓ C002-SETUP → OR-02 6:30-6:45          score: 1.4      │
│  8. ✓ C002-PROC  → OR-02 6:45-7:45          score: 2.1      │
│  9. ✓ C002-REC   → REC-02 7:45-9:15         score: 1.6      │
│ 10. Chain CASE-002 complete                                   │
│ 11. Evaluating chain: CASE-008                               │
│ 12. ✗ C008-PROC — infeasible: No anesthesiologist    ← red   │
│ 13. ⟳ Bumping CASE-009: removing C009-SETUP          ← orange│
│ 14. ⟳ Bumping CASE-009: removing C009-PROC                   │
│ 15. ⟳ Bumping CASE-009: removing C009-REC                    │
│ 16. Retrying CASE-008...                                     │
│ 17. ✓ C008-SETUP → OR-01 10:15-10:30        score: 3.1      │
│ 18. ✓ C008-PROC  → OR-01 10:30-12:00        score: 2.8  ──▶ │ ← current step
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The current step is highlighted. Clicking any step in the log jumps the Gantt to that step. Color coding: green for schedule, red for infeasible, orange for bump.

---

## Part 4: Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/pause |
| → | Step forward |
| ← | Step backward |
| Home | Jump to start |
| End | Jump to end (exit replay) |
| Escape | Exit replay mode |
| + / - | Speed up / slow down |

---

## Part 5: Data Size Considerations

A typical solve might produce 30-100 steps (10 chains × 3 tasks + bumps + skips). This is trivial data — a few KB in the response. No pagination or streaming needed.

For very large solves (500+ tasks), steps could be capped or grouped. But for V1 with healthcare (30 tasks) and HRMD (141 tasks), the full step log is fine.

---

## Part 6: Verification

After implementing:

- [ ] Solve completes → Replay button enabled
- [ ] Click Replay → Gantt clears to empty, controls appear at bottom
- [ ] Step forward → first task appears on Gantt with animation
- [ ] Each step shows correct task on correct resource at correct time
- [ ] Chain tasks appear in sequence (Setup, Proc, Rec)
- [ ] Infeasible tasks flash red, don't appear on Gantt
- [ ] Bump: bars disappear from Gantt, then retry shows new placement
- [ ] Step backward → reverses (removes last added task)
- [ ] Play → auto-advances at selected speed
- [ ] Pause → stops auto-advance
- [ ] Jump to end → shows full solve result (same as normal view)
- [ ] Exit Replay → returns to normal Gantt with full result
- [ ] Step description text is accurate and readable
- [ ] Speed slider works (100ms to 2000ms)
- [ ] Step counter shows correct position
- [ ] Keyboard shortcuts work (Space, arrows, Home, End, Escape)
- [ ] Healthcare tenant: replay shows chain-by-chain placement with bumps
- [ ] HRMD tenant: replay shows game-by-game placement
- [ ] Manufacturing tenant: replay shows per-task greedy placement
- [ ] Step log panel scrolls to current step, click to jump
- [ ] No performance issues with 100+ steps

---

## Size Estimate

- Engine: step recording in solver loop (~30 min)
- Frontend: replay state management + controls (~45 min)
- Frontend: Gantt filtering in replay mode (~20 min)
- Frontend: animations + step log panel (~30 min)
- Frontend: keyboard shortcuts (~10 min)
- Testing across tenants (~15 min)
- Total: ~2.5 hours CC work
