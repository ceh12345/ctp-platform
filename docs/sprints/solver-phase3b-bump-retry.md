# Solver Phase 3b: Bump-and-Retry

**What it does:** When a chain fails because a lower-priority chain holds a needed resource, bump the blocker, schedule the blocked chain, then re-evaluate the bumped chain. One retry cycle, no cascading, no deep search.

**Size:** ~1-2 hours CC work  
**Depends on:** Phase 3 (Chain Context Engine)  
**Ships with Phase 3** — this is the 80/20 cross-chain conflict resolution

---

## The Problem Phase 3 Doesn't Solve

Phase 3 evaluates chains independently in priority order. Once a chain commits, its resources are consumed. If CASE-002 (priority 2) grabs AN-JONES 7:00-8:00, then CASE-004 (priority 4) can't get an anesthesiologist in the morning. CASE-004 goes infeasible even though it could have worked if CASE-002 had used AN-GARCIA instead.

Phase 3 produces correct intra-chain results but doesn't handle inter-chain resource contention.

---

## The Solution

After a chain fails, ask: **who's blocking me, and are they less important?**

```
CASE-004 fails → identify blocking resource: AN-JONES
  → who holds AN-JONES? CASE-002 (priority 2)
  → CASE-004 is priority 4 — lower priority than CASE-002
  → DON'T bump (blocker is higher priority)

Different scenario:
CASE-008 (priority 1) fails → blocking resource: OR-01
  → who holds OR-01 at that time? CASE-009 (priority 5)
  → CASE-008 is higher priority → BUMP CASE-009
  → Unschedule CASE-009
  → Re-evaluate CASE-008 with freed resource
  → Re-evaluate CASE-009 with remaining resources
```

---

## Part 1: Identify Blockers

When a chain is infeasible (ChainContextEngine.evaluateChain returns null), figure out WHY by analyzing what resources were needed and who holds them.

### 1a. BlockerInfo

```typescript
interface BlockerInfo {
  blockedChainKey: string;          // chain that failed
  blockedChainPriority: number;     // priority of failed chain
  resourceKey: string;              // the contested resource
  blockerTaskKey: string;           // specific task holding the resource
  blockerChainKey: string;          // chain that holds the resource
  blockerChainPriority: number;     // priority of holding chain
  blockWindow: { start: number; end: number };  // when the resource is needed
}
```

### 1b. Find blockers

After a chain fails, scan its tasks' resource preferences against the current assignments:

```typescript
function findBlockers(
  chain: CTPProcess,
  landscape: SchedulingLandscape,
): BlockerInfo[] {
  const blockers: BlockerInfo[] = [];
  const chainPriority = getChainPriority(chain, landscape);

  chain.tasks?.forEach(task => {
    if (!task.capacityResources) return;

    task.capacityResources.forEach(tr => {
      // Get all preferred resources for this task resource
      const prefs = tr.getEffectivePreferences();

      for (const pref of prefs) {
        const resource = landscape.resources?.getEntity(pref.resourceKey);
        if (!resource || !resource.assignments) continue;

        // Check if this resource has assignments in the task's window
        let node = resource.assignments.head;
        while (node) {
          const assignment = node.data;

          // Does this assignment overlap with the task's needed window?
          if (task.window && assignment.endW > task.window.startW && assignment.startW < task.window.endW) {
            // Who owns this assignment?
            const blockerTaskKey = assignment.name;  // task key stored on assignment
            if (!blockerTaskKey) { node = node.next; continue; }

            const blockerTask = landscape.tasks?.getEntity(blockerTaskKey);
            if (!blockerTask) { node = node.next; continue; }

            const blockerChainKey = blockerTask.linkId?.name || blockerTaskKey;
            const blockerPriority = getChainPriority(
              landscape.processes?.getEntity(blockerChainKey),
              landscape
            );

            // Only report if blocker is a DIFFERENT chain
            if (blockerChainKey !== chain.key) {
              blockers.push({
                blockedChainKey: chain.key,
                blockedChainPriority: chainPriority,
                resourceKey: pref.resourceKey,
                blockerTaskKey: blockerTaskKey,
                blockerChainKey: blockerChainKey,
                blockerChainPriority: blockerPriority,
                blockWindow: { start: assignment.startW, end: assignment.endW },
              });
            }
          }
          node = node.next;
        }
      }
    });
  });

  return blockers;
}
```

### 1c. Chain Priority

Derive chain priority from its tasks. Use the highest priority (lowest number) task in the chain:

```typescript
function getChainPriority(
  chain: CTPProcess | undefined,
  landscape: SchedulingLandscape,
): number {
  if (!chain?.tasks) return Number.MAX_VALUE;

  let best = Number.MAX_VALUE;
  chain.tasks.forEach(task => {
    if (task.priority < best) best = task.priority;
  });
  return best;
}
```

---

## Part 2: Bump Decision

### 2a. Rules

1. **Only bump lower-priority chains.** If the blocker has higher priority (lower number), the blocked chain accepts infeasibility. Don't disrupt important work for less important work.

2. **Only bump once per chain per solve.** A bumped chain gets one chance to reschedule. If it fails after being bumped, it goes infeasible. No cascading bumps.

3. **Max total bumps per solve.** Controlled by `appSettings.maxBacktrackAttempts` (default 3). After 3 bumps in a solve, stop bumping — remaining infeasible chains stay infeasible.

4. **Equal priority — don't bump.** If chains have the same priority, first-committed wins. No bumping between equals.

### 2b. Bump candidate selection

From the list of blockers, find the best bump candidate:

```typescript
function selectBumpCandidate(
  blockers: BlockerInfo[],
  bumpedChains: Set<string>,  // chains already bumped this solve
): BlockerInfo | null {

  // Filter: only bump lower-priority (higher number) chains
  //         that haven't already been bumped
  const candidates = blockers.filter(b =>
    b.blockerChainPriority > b.blockedChainPriority &&
    !bumpedChains.has(b.blockerChainKey)
  );

  if (candidates.length === 0) return null;

  // Pick the lowest-priority blocker (most expendable)
  candidates.sort((a, b) => b.blockerChainPriority - a.blockerChainPriority);
  return candidates[0];
}
```

---

## Part 3: Bump-and-Retry Flow

### 3a. Integration into the solver loop

```typescript
// Solver main loop — chains processed in priority order
const chainEngine = new ChainContextEngine();
const bumpedChains = new Set<string>();     // tracks which chains have been bumped
const failedChains: CTPProcess[] = [];       // chains that failed first pass
let bumpCount = 0;
const maxBumps = landscape.appSettings?.maxBacktrackAttempts ?? 3;

// PASS 1: Schedule all chains in priority order
for (const chain of chainsInPriorityOrder) {
  // Explode contexts for all tasks in chain
  explodeChainContexts(chain, landscape, allContexts);

  // Evaluate chain
  const bestCombo = chainEngine.evaluateChain(chain, allContexts, landscape, scoring);

  if (bestCombo) {
    chainEngine.assignStartTimes(bestCombo);
    chainEngine.commitChain(bestCombo, scheduleEngine, landscape, direction);
    cascadeRecompute(bestCombo, allContexts);
  } else {
    failedChains.push(chain);
  }
}

// PASS 2: Bump-and-retry for failed chains
for (const failedChain of failedChains) {
  if (bumpCount >= maxBumps) {
    // Max bumps reached — mark remaining as infeasible
    markChainInfeasible(failedChain, 'Max bump attempts reached');
    continue;
  }

  // Find who's blocking this chain
  const blockers = findBlockers(failedChain, landscape);
  const bumpCandidate = selectBumpCandidate(blockers, bumpedChains);

  if (!bumpCandidate) {
    // No bumpable blocker — chain stays infeasible
    markChainInfeasible(failedChain, 
      blockers.length > 0
        ? `Blocked by higher-priority chain(s): ${[...new Set(blockers.map(b => b.blockerChainKey))].join(', ')}`
        : 'No feasible context combination found'
    );
    continue;
  }

  // BUMP: unschedule the blocking chain
  const blockerChain = landscape.processes?.getEntity(bumpCandidate.blockerChainKey);
  if (!blockerChain) continue;

  unscheduleChain(blockerChain, landscape, allContexts);
  bumpedChains.add(bumpCandidate.blockerChainKey);
  bumpCount++;

  console.log(`BUMP: Unscheduled ${bumpCandidate.blockerChainKey} (priority ${bumpCandidate.blockerChainPriority}) to free ${bumpCandidate.resourceKey} for ${failedChain.key} (priority ${getChainPriority(failedChain, landscape)})`);

  // RETRY: re-evaluate the failed chain with freed resources
  recomputeChainContexts(failedChain, landscape, allContexts);
  const retryCombo = chainEngine.evaluateChain(failedChain, allContexts, landscape, scoring);

  if (retryCombo) {
    chainEngine.assignStartTimes(retryCombo);
    chainEngine.commitChain(retryCombo, scheduleEngine, landscape, direction);
    cascadeRecompute(retryCombo, allContexts);
  } else {
    markChainInfeasible(failedChain, 'Still infeasible after bump');
  }

  // RESCHEDULE: re-evaluate the bumped chain with remaining resources
  recomputeChainContexts(blockerChain, landscape, allContexts);
  const bumperRetry = chainEngine.evaluateChain(blockerChain, allContexts, landscape, scoring);

  if (bumperRetry) {
    chainEngine.assignStartTimes(bumperRetry);
    chainEngine.commitChain(bumperRetry, scheduleEngine, landscape, direction);
    cascadeRecompute(bumperRetry, allContexts);
  } else {
    markChainInfeasible(blockerChain, `Bumped by ${failedChain.key}, could not reschedule`);
  }
}
```

### 3b. Helper: Unschedule an entire chain

```typescript
function unscheduleChain(
  chain: CTPProcess,
  landscape: SchedulingLandscape,
  allContexts: ScheduleContexts,
): void {
  chain.tasks?.forEach(task => {
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      // Reset window to original values before re-evaluation
      task.window?.reset();

      landscape.unscheduleTask(task.key);

      // Cascade recompute to other contexts sharing these resources
      allContexts.updateRecomputeByTask(task);
    }
  });
}
```

### 3c. Helper: Recompute chain contexts after bump

After unscheduling a chain, its resources are freed. Both the failed chain and the bumped chain need fresh context evaluation:

```typescript
function recomputeChainContexts(
  chain: CTPProcess,
  landscape: SchedulingLandscape,
  allContexts: ScheduleContexts,
): void {
  chain.tasks?.forEach(task => {
    // Remove old contexts for this task
    allContexts.removeByTask(task);

    // Reset task state
    task.resetScore();
    task.clearErrors();
    task.window?.reset();
    task.processed = false;
  });

  // Re-explode contexts with current resource availability
  chain.tasks?.forEach(task => {
    if (task.canSolve()) {
      explodeScheduleContexts(task, landscape, allContexts);
      computeStartTimesForTask(task, allContexts);
    }
  });
}
```

### 3d. Helper: Mark chain infeasible

```typescript
function markChainInfeasible(chain: CTPProcess, reason: string): void {
  chain.tasks?.forEach(task => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED) {
      task.addError('ChainContextEngine', reason);
    }
  });
}
```

---

## Part 4: Solve Response — Bump Reporting

### 4a. Include bump events in solve stats

The solve response should report what bumps occurred so the planner understands what happened:

```typescript
interface BumpEvent {
  bumpedChainKey: string;           // who got bumped
  bumpedChainPriority: number;
  beneficiaryChainKey: string;      // who benefited
  beneficiaryChainPriority: number;
  contestedResource: string;        // what was fought over
  bumpedChainResult: 'rescheduled' | 'infeasible';  // did the bumped chain recover?
}
```

Add to solve stats:

```typescript
solveStats: {
  // ... existing fields ...
  bumps: BumpEvent[];
  totalBumps: number;
  maxBumpsReached: boolean;
}
```

### 4b. UI display

In the solve summary toast or solve details panel:

```
Solved: 28/30 tasks scheduled
  ⟳ 2 bumps: CASE-009 bumped for CASE-008 (rescheduled OK)
              CASE-007 bumped for CASE-003 (rescheduled OK)
```

Or if a bump caused a chain to go infeasible:

```
  ⚠ CASE-009 bumped for CASE-008 — could not reschedule (infeasible)
```

---

## Part 5: AppSettings

Add bump control to app settings:

```typescript
export class CTPAppSettings implements IAppSettings {
  // ... existing fields ...
  public maxBacktrackAttempts: number = 3;  // already exists — used as max bumps per solve
}
```

No new settings needed. `maxBacktrackAttempts` controls the bump limit.

---

## Part 6: Tests

### Bump Decision Tests

**Test 1: Lower-priority blocker gets bumped**
```
CASE-008 (priority 1) blocked by CASE-009 (priority 5) on OR-01
selectBumpCandidate returns CASE-009
CASE-009 unscheduled, CASE-008 retries, CASE-009 reschedules elsewhere
```

**Test 2: Higher-priority blocker NOT bumped**
```
CASE-009 (priority 5) blocked by CASE-001 (priority 1) on OR-01
selectBumpCandidate returns null
CASE-009 stays infeasible — correct, don't disrupt priority 1
```

**Test 3: Equal priority — no bump**
```
CASE-005 (priority 3) blocked by CASE-006 (priority 3) on AN-JONES
selectBumpCandidate returns null
First-committed wins among equals
```

**Test 4: Already bumped chain not bumped again**
```
CASE-009 was already bumped this solve (in bumpedChains set)
Another chain tries to bump CASE-009 again
selectBumpCandidate skips CASE-009 → returns null or next candidate
No cascading bumps
```

**Test 5: Max bumps reached**
```
maxBacktrackAttempts = 3
Three bumps already performed
Fourth failed chain → no bump attempted → marked infeasible
```

### Bump Flow Tests

**Test 6: Successful bump — both chains schedule**
```
CASE-002 (priority 2) holds AN-JONES 7:00-8:00
CASE-001 (priority 1) needs AN-JONES 7:00-8:00 but was evaluated later (ordering edge case)
Bump CASE-002 → frees AN-JONES
CASE-001 schedules with AN-JONES 7:00-8:00
CASE-002 reschedules with AN-GARCIA 10:00-11:00
Both chains scheduled ✓
```

**Test 7: Bump — bumped chain goes infeasible**
```
CASE-009 bumped, AN-JONES freed
CASE-008 schedules with AN-JONES
CASE-009 re-evaluates: AN-GARCIA also booked now, no anesthesiologist available
CASE-009 marked infeasible with reason "Bumped by CASE-008, could not reschedule"
```

**Test 8: Multiple failed chains, limited bumps**
```
3 chains fail, maxBacktrackAttempts = 2
First two chains get bump attempts
Third chain: "Max bump attempts reached" → infeasible without trying
```

**Test 9: Failed chain has multiple blockers — pick lowest priority**
```
CASE-003 (priority 1) blocked by:
  CASE-007 (priority 3) on OR-01
  CASE-010 (priority 8) on AN-JONES
selectBumpCandidate picks CASE-010 (priority 8, most expendable)
```

**Test 10: Bump frees resource but chain still infeasible for other reasons**
```
CASE-004 blocked by CASE-002 on AN-JONES AND by shift calendar (no OR available)
Bump CASE-002 → frees AN-JONES
CASE-004 still infeasible because no OR in window
Marked: "Still infeasible after bump"
```

### Integration Tests

**Test 11: The AN-JONES healthcare scenario**
```
10 cases, 2 anesthesiologists: AN-JONES (6:00-14:00), AN-GARCIA (10:00-18:00)
Cases 1-3 fill AN-JONES morning
Case 4 needs morning anesthesiologist → fails
Case 4 priority is higher than Case 3
Bump Case 3 → Case 4 gets AN-JONES
Case 3 reschedules to 10:00+ with AN-GARCIA
```

**Test 12: No bumps needed — all chains fit**
```
5 cases, plenty of resources
All chains schedule on Pass 1
failedChains is empty, bumpCount = 0
Solve stats: bumps = []
```

**Test 13: Manufacturing tenant — no chains, no bumps**
```
Standalone tasks, no linkId
Chains have length 1 → per-task greedy
No bump logic triggered
```

**Test 14: Bump stats in solve response**
```
One bump occurred: CASE-009 bumped for CASE-008
solveStats.bumps = [{
  bumpedChainKey: "CASE-009",
  beneficiaryChainKey: "CASE-008",
  contestedResource: "AN-JONES",
  bumpedChainResult: "rescheduled"
}]
solveStats.totalBumps = 1
solveStats.maxBumpsReached = false
```

**Test 15: Window reset after bump**
```
CASE-009 bumped → unscheduled → windows reset to original
CASE-009 re-evaluated with fresh windows (not stale propagated values)
Contexts exploded against current resource availability
```

---

## Summary

Bump-and-retry is the 80/20 cross-chain conflict resolution:

- **Detect** who's blocking a failed chain
- **Bump** only lower-priority chains (higher priority wins)
- **Retry** the failed chain with freed resources
- **Reschedule** the bumped chain with remaining resources
- **One bump per chain, max 3 per solve** — no cascading
- **Report** bumps in solve stats so planners see what happened

Combined with Phase 3's chain context engine, this handles both intra-chain timing (propagation) and inter-chain contention (bump) without deep backtracking or look-ahead.
