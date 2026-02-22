# Engine: Priority Overrides (Sprint 5 Backend)

Add per-task priority override support to the scheduling engine. When a planner changes task priority or hits "Rush", the engine must respect those priorities when building the task scheduling order and scoring.

**This is engine-only work. No UI changes.**

Kill any existing node processes before starting:
```bash
killall node 2>/dev/null || true
```

---

## Part 1: Add `priority` Field to CTPTask

The base `CTPEntity` has `sequence` (used for task ordering) and `rank`. Add a dedicated `priority` field to `CTPTask` in `task.ts`. Priority is the planner-facing concept (1 = highest, 99 = lowest). Sequence is the internal solver ordering that may combine priority with other factors.

```typescript
export class CTPTask extends CTPKeyEntity implements ITask {
  // ... existing fields ...
  public priority: number;        // ← NEW: planner-facing priority (1 = highest, 99 = lowest)
  public originalPriority: number; // ← NEW: original value before overrides

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
    // ... existing init ...
    this.priority = 50;         // default mid-range
    this.originalPriority = 50;
  }
}
```

Also add to `ITask`:

```typescript
export interface ITask extends IKeyEntity {
  // ... existing fields ...
  priority: number;
}
```

---

## Part 2: `applyPriorityOverrides()` on Landscape

Add a new method to `SchedulingLandscape` in `landscape.ts`:

```typescript
public applyPriorityOverrides(overrides: Record<string, number>): void {
  for (const [taskKey, priority] of Object.entries(overrides)) {
    const task = this.tasks?.getEntity(taskKey);
    if (!task) continue;

    // Clamp to valid range
    const clamped = Math.max(1, Math.min(99, Math.round(priority)));
    task.priority = clamped;
  }
}
```

---

## Part 3: Priority Drives Task Scheduling Order

The solver processes tasks in order — the task list order determines who gets first pick of capacity. Priority must influence this order.

Update `CTPTaskList.sortBySequence()` in `task.ts` to sort by priority first, then sequence as tiebreaker:

```typescript
export class CTPTaskList extends List<CTPTask> {
  public sortBySequence(): void {
    this.sort((n1, n2) => {
      // Primary sort: priority (lower = higher priority = scheduled first)
      if (n1.priority !== n2.priority) {
        return n1.priority - n2.priority;
      }
      // Secondary sort: sequence (original order as tiebreaker)
      if (n1.sequence !== n2.sequence) {
        return n1.sequence - n2.sequence;
      }
      return 0;
    });
  }
}
```

This means a Rush task (priority 1) always gets scheduled before a default task (priority 50), regardless of sequence.

---

## Part 4: Priority Influences Scoring (Optional Enhancement)

When two tasks compete for the same resource and time slot, the solver picks the one with the better score. Priority should influence scoring so that higher-priority tasks get better slots even when multiple tasks are being evaluated in the same pass.

Add a `PriorityScoringRule` concept. In the context scoring step (wherever blended scores are computed), add a priority component:

```typescript
// Priority scoring: lower priority number = lower (better) score
// Normalize to 0-100 range: priority 1 → score 0, priority 99 → score 100
const priorityScore = ((task.priority - 1) / 98) * 100;
```

This should be added as a scoring rule in the scoring configuration, not hardcoded. If a `PriorityScoringRule` exists in the scoring config, apply it with its weight. If not, priority only affects task ordering (Part 3), not individual context scoring.

The scoring configuration entry would look like:

```typescript
new CTPScoringConfiguration("PriorityScoringRule", 10.0, CTPScoreObjectiveConstants.MINIMIZE)
```

Weight of 10.0 means priority moderately influences which resource/time combo is chosen. Higher weight = priority dominates over other scoring factors.

---

## Part 5: Wire Into Solve Flow

In `ctp.service.ts`, add the priority override step. Insert it early — before constraint propagation so that priority-driven task ordering is established:

```typescript
// ─── 1. Apply overrides in order ───

// 1a. Unschedules first — free up capacity
if (request?.taskUnschedules) {
  for (const taskKey of request.taskUnschedules) {
    landscape.unscheduleTask(taskKey, true);
  }
}

// 1b. Priority overrides (NEW — apply early so task ordering is set)
if (request?.priorityOverrides) {
  landscape.applyPriorityOverrides(request.priorityOverrides);
}

// 1c. Order modes (INCLUDE / EXCLUDE / LOCKED)
if (request?.orderModes) {
  landscape.applyOrderModes(request.orderModes);
}

// ... rest of overrides ...
```

**Important:** Priority overrides should be applied before `buildTaskList()` is called, so that when the task list is sorted by sequence/priority, the overrides are already in effect.

---

## Part 6: Update Solve Request DTO

Add the new field to `SolveRequestDto`:

```typescript
export class SolveRequestDto {
  // ... existing fields ...

  @ApiProperty({
    description: 'Per-task priority overrides. Keys are task keys, values are priority numbers (1 = highest, 99 = lowest).',
    required: false,
    example: {
      'OP-001': 1,
      'OP-002': 1,
      'OP-003': 10,
    },
  })
  priorityOverrides?: Record<string, number>;
}
```

---

## Part 7: Include Priority in Solve Response

Update `extractResults()` in `ctp.service.ts` to include priority in the task result:

```typescript
const taskResult: any = {
  // ... existing fields ...
  priority: task.priority,                    // ← NEW: current priority
  originalPriority: task.originalPriority,    // ← NEW: original before override
  priorityOverridden: task.priority !== task.originalPriority,  // ← NEW: flag
};
```

---

## Part 8: Validation

Add validation in the service:

```typescript
private validatePriorityOverrides(
  landscape: SchedulingLandscape,
  overrides: Record<string, number>,
): string[] {
  const warnings: string[] = [];

  for (const [taskKey, priority] of Object.entries(overrides)) {
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) {
      warnings.push(`Task ${taskKey} not found — skipping priority override`);
      continue;
    }
    if (priority < 1 || priority > 99) {
      warnings.push(`Priority ${priority} for ${taskKey} clamped to 1-99 range`);
    }
    if (task.pinned) {
      warnings.push(`Task ${taskKey} is pinned — priority override has no effect`);
    }
  }

  return warnings;
}
```

---

## Part 9: Store Original Priority on Data Load

When tasks are loaded from config/state, store the original priority so the response can report whether it was overridden:

In the state service or wherever tasks are loaded from config:

```typescript
task.priority = configTask.priority ?? 50;
task.originalPriority = task.priority;
```

---

## Test Plan

### Unit Tests (Engine)

1. **applyPriorityOverrides sets priority on task**
   - Task starts at priority 50
   - Apply override: priority 1
   - Task.priority === 1, task.originalPriority === 50

2. **Priority clamped to 1-99**
   - Apply override: priority 0 → clamped to 1
   - Apply override: priority 150 → clamped to 99

3. **sortBySequence respects priority**
   - Tasks: A (priority 50, seq 1), B (priority 1, seq 2), C (priority 50, seq 3)
   - After sort: B, A, C (B first because priority 1)

4. **Same priority falls back to sequence**
   - Tasks: A (priority 10, seq 3), B (priority 10, seq 1), C (priority 10, seq 2)
   - After sort: B, C, A

5. **Unknown task key → warning, not error**

6. **Pinned task → warning in validation**

7. **No overrides → original priorities unchanged, sort by sequence only**

8. **Priority scoring rule produces correct score**
   - Priority 1 → score ≈ 0
   - Priority 50 → score ≈ 50
   - Priority 99 → score ≈ 100

### Integration Tests (API)

9. **Solve with Rush (priority 1) → task gets best slot**
   - Two tasks competing for same resource
   - Apply priority 1 to task B
   - Task B gets earlier/better slot than task A (priority 50)

10. **Solve response includes priority and originalPriority**

11. **Solve response shows priorityOverridden flag**

12. **Multiple priorities sort correctly**
    - 5 tasks with priorities [50, 1, 25, 1, 75]
    - Scheduled in order: [1, 1, 25, 50, 75] (with sequence tiebreak for the two priority-1 tasks)

13. **Invalid task key → warning in response**

---

## Summary

| Change | File | Type |
|--------|------|------|
| `priority` and `originalPriority` fields | task.ts | Add fields |
| `priority` on `ITask` interface | task.ts | Add to interface |
| `sortBySequence()` uses priority first | task.ts | Modify method |
| `applyPriorityOverrides()` | landscape.ts | New method |
| `validatePriorityOverrides()` | ctp.service.ts | New method |
| `priorityOverrides` on DTO | solve-request.dto.ts | Add field |
| `priority`, `originalPriority`, `priorityOverridden` in response | ctp.service.ts | Add to extractResults |
| Wire into solve flow (step 1b) | ctp.service.ts | Insert call |
| Store `originalPriority` on load | state service | Add assignment |
| PriorityScoringRule (optional) | scoring rules | New rule |
