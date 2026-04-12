# Schedule Bulk Investigation Findings

**Date:** 2026-04-11
**Scope:** Read-only investigation into bulk schedule behavior, chain data model, and canMove() semantics.
**Triggered by:** UI symptom — selecting PROCESS tasks in a chain and clicking Schedule leaves predecessors/setup/teardown unscheduled.

---

## Group A — What does the schedule path actually do today?

### A1 — `scheduleBulk` behavior with unscheduled predecessors

**Behavior: skips the task, returns it as `no_feasible_slot`.**

Call path:
```
schedule(taskKeys: string[])             ctp.service.ts
  → scheduler.scheduleBulk(taskKeys)     basescheduler.ts
    → schedule(taskList)                 basescheduler.ts — single solver pass, taskList = only requested tasks
      → scheduleTasksChainAware()
        → tightenWindowFromPredecessor()
            if (!predecessor.scheduled)
              → addError('ChainConstraint', ...)
              → return false
          → task skipped (not marked processed, retried next loop iteration)
          → all retries exhausted → task.processed = true → infeasible
      ← result: success: false, skipReason: 'no_feasible_slot'
```

Predecessors are **not pulled in automatically**. The input list is treated as literal — only the keys handed to the engine are candidates for scheduling. Same behavior on both the single-task and bulk paths; `scheduleBulk` calls `schedule()` with only what was given to it.

**Key lines:** `basescheduler.ts` `scheduleTasksChainAware()` ~line 531, `tightenWindowFromPredecessor()` ~line 584.

### A2 — UI symptom on Stafford with PROCESS-only filter

Could not exercise live during investigation. Based on the code trace, the expected behavior is:

- Requested PROCESS tasks whose predecessors are unscheduled → `success: false, skipReason: 'no_feasible_slot'`
- SETUP/TEARDOWN tasks are not in the request, so they remain wherever they are (unscheduled)
- User sees a toast reporting N tasks could not be placed, with no cascade information
- Resource agenda afterward is coherent (nothing was moved) but the user's intent was not fulfilled

### A3 — Non-movable tasks in `scheduleBulk`

Best-effort — non-movable tasks are **skipped, not rejected**. `scheduleBulk` checks `task.pinned` before adding to the solver list and emits `skipReason: 'committed'` or `'running'`. The rest of the batch continues normally. A batch containing a pinned task plus two unscheduled neighbors will schedule the two neighbors and skip the pinned one.

---

## Group B — Chain data model

### B1 — No forward pointer (`succLink`)

`CTPLinkId` fields: `name`, `type`, `prevLink`, `maxGap`. **No `succLink` or equivalent.**

Forward walking requires building a reverse index from the landscape — scan all tasks sharing the same `linkId.name` and build a `prevLink → task` map. This is cheap for the process group (typically 3–8 tasks) but not a single pointer hop.

**File:** `packages/engine/Models/Core/linkid.ts`

### B2 — `process` field and `CTPProcess`

`task.process` is a string key. `CTPProcess` is the grouping entity with a `tasks: CTPTaskList` collection. Navigation:

```typescript
// Task → process group
const chain = landscape.processes.getEntity(task.linkId.name);

// Process → all member tasks
chain.tasks.forEach(t => { /* all tasks in this chain */ });
```

`CTPProcess` definition: a named group of tasks that share a production route. One process = one chain.

**File:** `packages/engine/Models/Entities/process.ts`

### B3 — `process` vs `linkId.name` — same key

`expandToChains` (see D1) looks up `landscape.processes.getEntity(task.linkId.name)` — it uses `linkId.name` as the process key directly. They are the **same identifier**. `linkId.name` is the join key between the task and its `CTPProcess` entry. Use either, but `linkId.name` is more accessible from a task reference.

---

## Group C — `canMove()` semantics

### C1 — `canMove()` implementation

```typescript
public canMove(): boolean {
  return this.wipstate == CTPWipStateConstants.NOT_STARTED;
}
```

Returns `false` for any wipstate other than `NOT_STARTED`. This includes: running (`IN_PROCESS`), dispatched, completed, on_hold, and any other non-zero wipstate. It does **not** check `pinned` or `includeInSolve`.

**File:** `packages/engine/Models/Entities/task.ts` ~line 257

### C2 — `canMove()` is not the canonical scheduler predicate

There are two predicates:

| Predicate | Checks | Used where |
|-----------|--------|-----------|
| `canMove()` | `wipstate === NOT_STARTED` only | `unscheduleTask()` inner loop guard |
| `canSolve()` | `!pinned && includeInSolve && wipstate === NOT_STARTED` | broader solver eligibility |

```typescript
public canSolve(): boolean {
  if (this.pinned) return false;
  if (!this.includeInSolve) return false;
  if (this.wipstate !== CTPWipStateConstants.NOT_STARTED) return false;
  return true;
}
```

**`canSolve()` is the correct stop predicate for chain expansion** — it captures all three reasons a task should not be touched: committed (pinned), excluded from solve, or actively in-progress. Using `canMove()` alone would miss the `pinned` and `includeInSolve` checks.

---

## Group D — Synthesis

### D1 — Existing code, wrong entry point

**`expandToChains` already exists in `ctp.service.ts` at line 2564 and does exactly what's needed.**

```typescript
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

It is called by `solve()` when `expandChains: true` is passed in the solve request (line 316–318). It uses `landscape.processes.getEntity(linkId.name)` to enumerate all chain members and add them to the task set.

The new `schedule()` service method (the bulk endpoint) simply does not call `expandToChains` before handing keys to the engine. The fix is to call `expandToChains` in `schedule()` before building the scheduler — the same two lines already in `solve()`.

**No new engine code required. No new chain walking logic. Wire up the existing helper.**

The one design question before implementing: `expandToChains` as written pulls in **all** chain members (SETUP + all PROCESS + TEARDOWN). If the intent is to expand only to unscheduled/movable predecessors (contiguous expansion), a filtered variant would be needed. The current `expandToChains` is all-or-nothing per chain.

---

## Summary

| Question | Finding |
|----------|---------|
| Does scheduleBulk auto-expand chains? | No — literal list, predecessors cause skip |
| Is there existing chain expansion logic? | Yes — `expandToChains` in ctp.service.ts |
| Fix location | API layer only — call `expandToChains` before `scheduleBulk` |
| Forward pointer on linkId? | No — reverse index required for forward walk |
| Process vs linkId.name | Same key |
| Correct stop predicate for expansion | `canSolve()`, not `canMove()` |
| New engine code needed? | No |
