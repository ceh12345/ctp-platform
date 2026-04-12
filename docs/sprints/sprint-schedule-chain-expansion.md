# Sprint: Chain Expansion for the Schedule Path

**Status:** 📋 Ready
**Size:** ~3-4 hours CC work
**Depends on:** The unified `schedule()` service method and `POST /v1/ctp/tasks/schedule` endpoint from `sprint-unify-schedule-unschedule-endpoints.md`. If that sprint hasn't shipped, do it first.
**Triggered by:** UI filter hides SETUP/TEARDOWN by default. "Select all → Schedule" on PROCESS tasks sends only the visible PROCESS keys. The engine receives an incomplete request and returns `no_feasible_slot` because the chain's hidden predecessors are unscheduled. Investigation findings in `schedule-bulk-investigation.md` confirm the root cause and point at the right fix.

---

## Background — read this before anything else

The investigation that led to this sprint surfaced two things that shape every design decision below. Do not re-derive them; they are established facts for this sprint:

1. **`expandToChains` already exists in `ctp.service.ts` (~line 2564) and is called by `solve()`.** It pulls in *all* chain members unconditionally. This is correct for `solve()` because `solve()` runs in wipe-and-resolve mode — it clears the chain's assignments first, then re-solves with the full chain in scope. Unmovable tasks become movable for the duration of that pass. **Do not modify `expandToChains`.** It is correct for its current caller and tightening it would break `solve()`.

2. **The `schedule()` service method runs in additive mode**, not wipe-and-resolve. It schedules into a landscape that still has running, pinned, and committed tasks that must not be disturbed. It needs a different expansion semantics: contiguous movable neighborhood around the inputs, not the full chain. This sprint builds a **separate** helper — do not try to unify the two.

3. **The chain-walking primitives are confirmed to exist:**
   - `task.predLink` — backward pointer for chain walking. One hop per step.
   - `task.linkId.name` — chain identifier. Same key as `landscape.processes.getEntity(...)`.
   - `landscape.processes.getEntity(chainKey).tasks` — enumerate all tasks in a chain.
   - `task.canSolve()` — returns true iff `!pinned && includeInSolve && wipstate === NOT_STARTED`. **This is the stop predicate for the walk.** Do *not* use `canMove()` — it misses the `pinned` and `includeInSolve` checks.
   - No forward pointer (`succLink`) exists. Forward walking requires building a reverse index from the chain's task list.

4. **`expandToChains` is currently private to `ctp.service.ts` with `solve()` as its only caller.** There is no risk of breaking other code by adding a sibling helper next to it.

---

## Problem

With the task list filter in its default state (PROCESS tasks visible only), "Select all → Schedule" on a chain whose SETUP and TEARDOWN are unscheduled sends only the PROCESS keys to the API. The engine's chain-aware solver refuses to schedule a task whose predecessor is unscheduled (`tightenWindowFromPredecessor` → `ChainConstraint` error → retry loop exhausts → `no_feasible_slot`). The planner sees a vague failure toast and the chain does not advance.

The symptom is the UI's fault for hiding the tasks, but the fix doesn't belong in the UI. Any caller of the schedule endpoint — UI, external API consumer, AI recommendation, scripting client — that sends a partial chain list will hit the same failure. The fix belongs in the service layer, in front of the engine, where the request is assembled.

---

## Design

### The rule

For each input task key the schedule service receives, walk the task's chain outward from its position — backward via `predLink`, forward via a reverse index built from the chain's task list — gated on `canSolve()`. Stop each direction at the first task where `canSolve()` returns false (a "wall") or at the end of the chain. Add every `canSolve()`-eligible task encountered to a shared accumulator. Hand the deduplicated union of the accumulator and the original input list to `scheduleBulk`.

The walk includes SETUP, PROCESS, and TEARDOWN chain members uniformly — the chain doesn't care about task type, only about `canSolve()` eligibility and `predLink` connectivity.

### Why contiguous walking, not full chain membership

Three scenarios that a naive "pull in the whole chain" would get wrong:

1. **Running task upstream of the selection.** Chain: `op1 → op2(running) → op3 → op4(requested)`. Full-chain expansion pulls in op1, which is on the wrong side of the running task. `canSolve()` is false for op1 transitively (its chain window is blocked by op2), and the solver will emit a vague skip reason for it. Contiguous walking stops the backward walk at op2 and op1 is never added.

2. **Already-scheduled predecessor.** Chain: `op1(scheduled) → op2(requested)`. Full-chain expansion pulls in op1. `canSolve()` is false for op1 because its wipstate is no longer `NOT_STARTED`. The solver correctly skips it, but it's wasted work and produces noise in the response. Contiguous walking sees `canSolve()` false and stops the backward walk immediately, leaving op1 out of the request entirely.

3. **Pinned neighbor.** Chain: `op1(requested) → op2(pinned) → op3`. Full-chain expansion pulls in op3. Contiguous forward walking from op1 hits op2, sees `canSolve()` false (pinned), stops. op3 is correctly left out — scheduling it would require bypassing op2, which isn't allowed.

The contiguous walk is always a subset of the full chain. In the simple case (chain with nothing running, pinned, or scheduled), it reduces to the full chain. In the non-trivial cases, it excludes exactly the tasks that would cause solver trouble.

### The walk's input tasks are never filtered

If the user requests a task that isn't `canSolve()`-eligible itself, that's a request the engine will skip. Expansion's job is to add neighbors, not to second-guess the input. A non-movable input still acts as a valid walk origin — its `canSolve()`-eligible neighbors are added normally. The engine will report the non-movable input as skipped via the existing `BulkTaskResult` mechanism.

### Multiple inputs in the same chain

Use a shared `Set<string>` accumulator across all input walks. Tasks already added by a previous walk are not re-walked (they're already in the accumulator and their neighbors have already been explored). Build the forward-walk reverse index once per chain, not once per input, since multiple inputs in the same chain reuse the same index.

### Chainless tasks pass through

A task with no `linkId.name` has no chain to expand. Pass it through unchanged — it appears in the final schedule request as-is, alongside any chain members that were added by expansion of other inputs.

---

## Deliverables

### 1. Service helper — `expandChainForSchedule` ⏳

**Location:** `ctp.service.ts`, next to the existing `expandToChains` method. Same file, same class, same visibility (private).

```typescript
/**
 * Expands an input task list to include the contiguous canSolve()-eligible
 * neighborhood around each input task within its chain. Used by schedule()
 * to turn a partial user selection into a solver-ready request.
 *
 * Semantics (additive / schedule-time):
 *   - Walks each input's chain outward via predLink (backward) and a
 *     per-chain reverse index (forward).
 *   - Stops each direction at the first task where canSolve() returns false
 *     or at the end of the chain.
 *   - Includes the original input keys unchanged, even if their own
 *     canSolve() is false (the engine will skip non-movable inputs in
 *     BulkTaskResult).
 *   - Deduplicates across multiple inputs in the same chain.
 *
 * Distinct from expandToChains(), which is used by solve() in
 * wipe-and-resolve mode and pulls in the full chain unconditionally.
 * Do not unify the two — they have different semantics on purpose.
 */
private expandChainForSchedule(
  taskKeys: string[],
  landscape: SchedulingLandscape,
): { requested: string[]; expanded: string[]; full: string[] } {
  const accumulator = new Set<string>(taskKeys);
  const reverseIndexCache = new Map<string, Map<string, CTPTask>>();

  for (const key of taskKeys) {
    const task = landscape.tasks.getEntity(key);
    if (!task?.linkId?.name) continue;

    const chain = landscape.processes.getEntity(task.linkId.name);
    if (!chain?.tasks) continue;

    // Backward walk via predLink
    let cursor = task.predLink
      ? landscape.tasks.getEntity(task.predLink)
      : null;
    while (cursor) {
      if (!cursor.canSolve()) break;
      if (accumulator.has(cursor.key)) break; // already covered by another walk
      accumulator.add(cursor.key);
      cursor = cursor.predLink
        ? landscape.tasks.getEntity(cursor.predLink)
        : null;
    }

    // Forward walk via reverse index (no succLink exists)
    let reverseIndex = reverseIndexCache.get(task.linkId.name);
    if (!reverseIndex) {
      reverseIndex = new Map<string, CTPTask>();
      chain.tasks.forEach(t => {
        if (t.predLink) reverseIndex!.set(t.predLink, t);
      });
      reverseIndexCache.set(task.linkId.name, reverseIndex);
    }

    let forwardCursor: CTPTask | undefined = reverseIndex.get(task.key);
    while (forwardCursor) {
      if (!forwardCursor.canSolve()) break;
      if (accumulator.has(forwardCursor.key)) break;
      accumulator.add(forwardCursor.key);
      forwardCursor = reverseIndex.get(forwardCursor.key);
    }
  }

  const full = Array.from(accumulator);
  const requestedSet = new Set(taskKeys);
  const expanded = full.filter(k => !requestedSet.has(k));

  return { requested: taskKeys, expanded, full };
}
```

The above is illustrative — CC should adapt field names, types, and null-handling to match what's actually in the codebase. The important invariants are: `canSolve()` as the stop predicate, `predLink` for backward, reverse index per chain for forward, shared accumulator across all input walks, input tasks pass through unfiltered.

### 2. Wire `schedule()` to call the new helper ⏳

**Location:** `ctp.service.ts`, the `schedule()` method created by the unify-endpoints sprint.

Before calling `scheduler.scheduleBulk`, call `expandChainForSchedule` on the input keys and hand the `full` array to the scheduler. Populate the response summary with `requestedCount` (input length) and `expandedCount` (expansion additions length) so the UI can surface the breakdown.

```typescript
async schedule(taskKeys: string[]): Promise<BulkScheduleResult> {
  const landscape = this.getLandscape();
  const expansion = this.expandChainForSchedule(taskKeys, landscape);
  const engineResult = this.scheduler.scheduleBulk(expansion.full);

  return {
    results: engineResult.results,
    summary: {
      requestedCount: expansion.requested.length,
      expandedCount: expansion.expanded.length,
      scheduledCount: engineResult.results.filter(r => r.success).length,
      skippedCount: engineResult.results.filter(r => !r.success).length,
      ...countByType(engineResult.results, landscape),
    },
  };
}
```

The `countByType` helper breaks down successful results into `processCount`, `setupCount`, and `teardownCount` by looking up each result's task type in the landscape. This is used by the toast builder in the consistent-toasts sprint.

### 3. Extend `BulkScheduleResult.summary` with expansion metadata ⏳

**Location:** `bulk-result.ts` (or wherever `BulkScheduleResult` is defined).

```typescript
interface BulkScheduleResult {
  results: BulkTaskResult[];
  summary: {
    requestedCount: number;     // What the caller originally sent
    expandedCount: number;      // How many tasks were added by expansion
    scheduledCount: number;     // Total successfully scheduled
    processCount: number;       // Of scheduledCount, PROCESS type
    setupCount: number;         // Of scheduledCount, SETUP type (added by expansion)
    teardownCount: number;      // Of scheduledCount, TEARDOWN type (added by expansion)
    skippedCount: number;
  };
}
```

Update any existing consumers of this type to handle the new fields (they can ignore them if they don't care — the fields are additive).

### 4. UI — confirmation dialog with expansion preview ⏳

**Location:** the schedule action handler in `App.tsx` (sibling to `handleBulkSchedule` at ~line 13338).

Before calling the API, compute a client-side preview of the expansion so the confirmation dialog can show an accurate count. Use the same walk logic as `expandChainForSchedule` — the landscape is already loaded in the UI, so the walk is local and fast. Keep the preview in a small helper next to the action handler so CC has one obvious place to keep it in sync with the server-side implementation.

**Dialog copy, no expansion:**
> Schedule 3 tasks?

**Dialog copy, with expansion:**
> Schedule 3 tasks and their 4 required setup/teardown? Setup and teardown tasks are normally hidden — they will be scheduled along with the process tasks they support.
>
> [Cancel] [Schedule 7 tasks]

The explanatory sentence matters. Planners who have never seen the filter in their lives will otherwise find the expanded count inexplicable.

If the drift between client-side and server-side walk logic becomes painful, fall back to a `POST /v1/ctp/tasks/schedule/preview` endpoint that calls `expandChainForSchedule` and returns the counts without actually scheduling. Don't build the preview endpoint preemptively — start with the client-side walk and only add the endpoint if you actually need it.

### 5. UI — toast reports the expansion breakdown ⏳

**Location:** `buildScheduleToast` in the consistent-toasts sprint's toast builder file.

Update the success branch to surface the expansion when it fired:

```typescript
if (skippedCount === 0 && expandedCount === 0) {
  return { severity: "success", message: `Scheduled ${scheduledCount} ${pluralize("task", scheduledCount)}` };
}
if (skippedCount === 0 && expandedCount > 0) {
  return {
    severity: "success",
    message: `Scheduled ${scheduledCount} tasks (${processCount} process + ${setupCount} setup + ${teardownCount} teardown)`,
  };
}
// ... existing partial/failure branches, unchanged
```

This is the one place the schedule path deliberately breaks the consistent-toasts sprint's "hide cascade, use processCount" rule — because unlike unschedule cascade, schedule expansion touches tasks the user couldn't see, and silent expansion would feel like the app made decisions behind their back. The asymmetry is intentional and is justified in the consistent-toasts sprint's `buildScheduleToast` comments.

---

## Testing Scenarios

| # | Scenario | Expected |
|---|---|---|
| 1 | Filter off, 1 PROCESS input, chain has unscheduled SETUP + TEARDOWN, nothing else in chain | Backward walk adds SETUP, forward walk adds TEARDOWN. Dialog: "Schedule 1 task and its 2 required setup/teardown? [Schedule 3]". Response: `requestedCount: 1, expandedCount: 2`. |
| 2 | Filter off, 5 PROCESS inputs from 5 separate chains, each with own SETUP/TEARDOWN | Expansion adds 10 tasks (2 per chain). 15 scheduled total. |
| 3 | Filter off, 3 PROCESS inputs in same chain, chain has shared SETUP + TEARDOWN | Expansion adds SETUP and TEARDOWN once each (shared accumulator deduplicates). 5 scheduled total. |
| 4 | Backward walk hits running task | Walk stops at the running task. Running task is NOT added. Tasks beyond the running task (on the far side) are NOT added. |
| 5 | Backward walk hits already-scheduled predecessor | Walk stops. Already-scheduled task is NOT added (avoiding wasted solver work). |
| 6 | Backward walk hits pinned task | Walk stops. Pinned task is NOT added. |
| 7 | Forward walk hits end of chain | Walk terminates cleanly, no error |
| 8 | Chain has no SETUP/TEARDOWN at all | Expansion is a no-op for that chain. Dialog uses simple "Schedule N tasks?" copy. |
| 9 | Input task has no `linkId.name` (chainless) | Task passes through to `full` unchanged. No walk attempted. |
| 10 | Input task is itself non-movable (e.g. pinned) | Walk still runs from its position and adds movable neighbors. Non-movable input is returned to the engine, which skips it in `BulkTaskResult`. |
| 11 | Multiple inputs in same chain, overlapping walks | Accumulator deduplicates. Reverse index is built once per chain, not once per input. |
| 12 | Chain with all members non-movable except inputs | Expansion is a no-op — walks hit walls immediately in both directions. Inputs still go to the engine. |
| 13 | Filter on, user selects PROCESS + SETUP + TEARDOWN explicitly | Expansion is a no-op (all chain members already in input). Behaves identically to a non-expanded call. |
| 14 | `solve()` still works exactly as before | Regression test — confirm `expandToChains` is untouched and `solve()` still pulls in full chains |
| 15 | API smoke test | `POST /v1/ctp/tasks/schedule` with partial chain keys returns `requestedCount` and `expandedCount` populated correctly |
| 16 | UI smoke test on Stafford | Filter off, select all on a PROCESS-only view, click Schedule, confirm dialog shows expansion count, confirm resource agenda after commit shows the full chain placed coherently |

---

## Files Changed

| File | Change |
|---|---|
| `ctp.service.ts` | **MODIFIED** — add `expandChainForSchedule` helper next to `expandToChains`; wire `schedule()` to call it before `scheduleBulk`; add `countByType` helper for the summary breakdown |
| `bulk-result.ts` | **MODIFIED** — extend `BulkScheduleResult.summary` with `expandedCount`, `processCount`, `setupCount`, `teardownCount` |
| `ctp.service.spec.ts` | **MODIFIED** — cover scenarios 1–13 against the service method |
| `basescheduler.test.ts` | **MODIFIED** — regression test for scenario 14 (`solve()` behavior unchanged) |
| `App.tsx` (schedule handler) | **MODIFIED** — client-side expansion preview, confirmation dialog with cascade-aware copy |
| `bulkActionToast.ts` | **MODIFIED** — `buildScheduleToast` surfaces the expansion breakdown |
| Toast builder tests | **MODIFIED** — scenarios for expansion-driven success messages |

Adjust file paths to match the actual codebase structure.

---

## Verification

1. Run service-layer tests — `expandChainForSchedule` scenarios pass
2. Run engine tests — `solve()` behavior unchanged (regression check)
3. Run toast builder tests — expansion-aware messages correct
4. Manual UI test on Stafford tenant:
   - Filter off (default)
   - Select 3 PROCESS tasks on a chain whose SETUP/TEARDOWN are hidden and unscheduled
   - Click Schedule → confirmation dialog shows the expanded count with the explanatory sentence
   - Click Schedule in the dialog → toast reports the breakdown
   - Resource agenda shows all tasks placed coherently — SETUP before PROCESS before TEARDOWN
5. Manual UI test — repeat with a chain where one task is running upstream; confirm expansion stops at the running task and the result is a coherent partial schedule, not an error
6. API smoke test — direct curl with partial chain keys returns correct expansion metadata

---

## Out of Scope

- Modifying `expandToChains` or the `solve()` path in any way (the investigation confirmed `solve()` needs its current full-chain behavior)
- Teaching the solver to distinguish transient vs permanent predecessor gaps (covered by a separate future sprint on permanent-wall detection in `scheduleTasksChainAware`)
- Removing the task list filter default (setup/teardown should still be hidden)
- Unifying the two expansion helpers — they have different semantics on purpose
- A preview endpoint (deferred — start with client-side walk, add the endpoint only if drift becomes painful)
- Any change to unschedule behavior (the parent setup/teardown sprint handles unschedule correctly)

---

## Notes for CC

- **Do not modify `expandToChains`.** Build a new helper next to it. They are different functions for different callers with different semantics.
- **Use `canSolve()`, not `canMove()`.** The investigation confirmed `canMove()` misses the `pinned` and `includeInSolve` checks.
- **The walk is read-only.** `expandChainForSchedule` does not mutate tasks, does not reschedule, does not log. It's a pure function of current landscape state.
- **Build the reverse index once per chain, not per input.** Multiple inputs in the same chain reuse the same index. The cache in the sample code is the right pattern.
- **Walk stops AT the wall, not after.** The non-movable task itself is never added. It's the boundary, not a member.
- **Input tasks are never filtered.** Even non-movable inputs pass through to the engine. The engine skips them in `BulkTaskResult`. Expansion's job is addition, not filtering.
- **There is a separate future sprint for the solver-side permanent-wall detection.** Don't try to do both fixes in this sprint. This one ships alone and handles the 80-90% case. The solver fix handles the edge case of a running task upstream producing a vague skip reason on the tasks just past it; it can wait.
- **The client-side preview duplicates the server-side walk.** On purpose, to avoid a round-trip for the confirmation dialog. If the duplication starts to drift, fall back to the preview endpoint. Don't try to share code between client and server unless there's a clean way to do it.

---

*One helper, one wire-up, one dialog, one toast. The investigation did the heavy lifting — this sprint is almost entirely assembly of known pieces.*
