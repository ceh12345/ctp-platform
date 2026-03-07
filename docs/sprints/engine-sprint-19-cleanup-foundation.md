# Engine Sprint 19: Post-Review Cleanup & Foundation

**What it does:** Fixes three correctness issues found in the code review, implements three performance optimizations, and builds the SolutionState snapshot class needed for future solver strategies. Cleans up code quality issues.

**Size:** ~2-3 hours CC work  
**Depends on:** Phase 3 stable  
**Enables:** Strategy comparison testing, solve replay, and future tabu search / ILS

---

## Part 1: Correctness Fixes

### 1a. Context mutation during chain scoring

**Problem:** `scoreChainCombos()` calls `scoringEngine.computeScores(landscape, combo.contexts, scoring)` which writes to `context.blendedScore.score` and `context.scores`. If the same context appears in multiple combos (e.g., a Recovery context shared across OR-01 and OR-02 lane combos), its score gets overwritten. The second combo sees the first combo's score.

**Fix:** Score only the per-combo task-level contribution, not the shared context object. Store chain-level scores on the combo itself, not on the context.

```typescript
private scoreChainCombos(
  combos: ChainContextCombo[],
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
): void {
  // Build scoring rules ONCE (also fixes optimization 2a)
  const rules = this.buildScoringRules(scoring);

  for (const combo of combos) {
    let chainScore = 0;

    for (const ctx of combo.contexts) {
      // Compute score for this context WITHOUT mutating context.blendedScore
      const taskScore = this.computeContextScore(ctx, rules, landscape);
      chainScore += taskScore;
    }

    // Gap penalty
    const gapPenalty = (combo.totalGap / 60) * 0.1;
    chainScore += gapPenalty;

    combo.chainScore = chainScore;
  }
}

// New: compute score without side effects
private computeContextScore(
  ctx: ScheduleContext,
  rules: BuiltScoringRule[],
  landscape: SchedulingLandscape,
): number {
  if (!ctx.slot?.hasStartTimes()) return Number.MAX_VALUE;

  let n = 0;
  for (const rule of rules) {
    try {
      const rawScore = rule.scoring.compute(ctx);
      // Normalize: min-max across... but we don't have global min/max
      // For chain scoring, use raw weighted score without normalization
      let s = rawScore.score * rule.scoring.weight;
      if (rule.scoring.objective === CTPScoreObjectiveConstants.MAXIMIZE) s *= -1;
      if (rule.scoring.penaltyFactor) s += s * rule.scoring.penaltyFactor;
      n += s;
    } catch {}
  }
  return n;
}
```

**Note:** This changes chain scoring from normalized-then-blended to raw-weighted. Chain combos are compared against each other (same task set), so relative ranking is preserved. If normalization is needed, compute min/max across all contexts in all combos for the chain before scoring.

**Alternative simpler fix:** Clone the blendedScore before overwriting:

```typescript
// Save and restore
const savedScores = combo.contexts.map(ctx => ctx.blendedScore.score);
scoringEngine.computeScores(landscape, combo.contexts, scoring);
// Read the blended scores for chain scoring
let chainScore = 0;
for (const ctx of combo.contexts) chainScore += ctx.blendedScore.score;
// Restore original scores
combo.contexts.forEach((ctx, i) => ctx.blendedScore.score = savedScores[i]);
```

CC can choose whichever approach is cleaner to implement.

### 1b. `capContextSets` sorting by uncomputed blendedScore

**Problem:** At cap time, blendedScore defaults to `Number.MAX_VALUE`. The "top 3 by score" is arbitrary.

**Fix:** Sort by earliest start time instead — this is a meaningful heuristic before scoring is available:

```typescript
private capContextSets(contextSets: ScheduleContext[][], maxCombos: number): void {
  let estimate = 1;
  for (const set of contextSets) estimate *= set.length;
  if (estimate <= maxCombos) return;

  // Use nth-root to determine per-task limit
  const n = contextSets.length;
  const perTaskLimit = Math.max(3, Math.floor(Math.pow(maxCombos, 1 / n)));

  for (let i = 0; i < contextSets.length; i++) {
    if (contextSets[i].length > perTaskLimit) {
      // Sort by earliest start time (meaningful before scoring)
      contextSets[i].sort((a, b) => {
        const aStart = a.slot.startTimes?.head?.data.eStartW ?? Number.MAX_VALUE;
        const bStart = b.slot.startTimes?.head?.data.eStartW ?? Number.MAX_VALUE;
        return aStart - bStart;
      });
      contextSets[i] = contextSets[i].slice(0, perTaskLimit);
    }
  }
}
```

This also fixes the "always caps to 3" problem — now uses nth-root of maxCombos.

### 1c. Missing window reset in `retryChain`

**Problem:** `retryChain()` (line 888) resets `t.processed` and `t.errors` but doesn't reset `t.window`. After propagation tightened the window in the first attempt, the retry starts from tightened bounds instead of originals.

**Fix:**

```typescript
private retryChain(...): 'rescheduled' | 'infeasible' {
  const chainTasks = chain.tasks;
  if (!chainTasks) return 'infeasible';

  const taskList = new List<CTPTask>();
  chainTasks.forEach(t => {
    t.processed = false;
    t.errors = [];
    t.window?.reset();         // ADD THIS — restore original window bounds
    t.resetScore();            // ADD THIS — clear stale scores
    taskList.add(t);
  });
  // ... rest unchanged
}
```

---

## Part 2: Performance Optimizations

### 2a. Pre-build scoring rules once per solve

**Problem:** `ScoringFactory.createScoringRule()` is called every time `computeScores()` runs. Weight validation runs every time too.

**Fix:** Extract rule building into a reusable method. Call it once per solve, pass the built rules to subsequent scoring calls.

```typescript
interface BuiltScoringRule {
  name: string;
  min: number;
  max: number;
  scoring: IScoringRule;
}

// New method on ScoringEngine or ChainContextEngine
private buildScoringRules(scoring: CTPScoring): BuiltScoringRule[] {
  const rules: BuiltScoringRule[] = [];
  let cum = 0;

  scoring.rules.forEach(rule => {
    if (rule.includeInSolve) {
      try {
        const i = ScoringFactory.createScoringRule(
          rule.ruleName, rule.weight, rule.objective, rule.penaltyFactor
        );
        rules.push({
          name: rule.ruleName,
          min: Number.MAX_SAFE_INTEGER,
          max: Number.MIN_SAFE_INTEGER,
          scoring: i,
        });
        cum += i.weight;
      } catch {}
    }
  });

  if (cum <= 0.99 || cum > 1.0) throw "Scoring Rules must sum to 100%";
  return rules;
}
```

Store the rules on the chain engine instance and reuse across all combo evaluations.

### 2b. Cache context time bounds

**Problem:** `getContextTimeBounds()` walks the CTPStartTimes linked list for every combo that includes a context. A context in 20 combos gets its linked list walked 20 times.

**Fix:** Compute bounds once per context before propagation:

```typescript
// In evaluateChain, after getContextsPerTask:
const boundsCache = new Map<string, ContextTimeBounds>();
taskContextsMap.forEach((contexts, taskKey) => {
  contexts.forEach(ctx => {
    const bounds = this.getContextTimeBounds(ctx);
    if (bounds) boundsCache.set(ctx.key || ctx.hashKey, bounds);
  });
});

// In propagateCombo, read from cache:
const bounds = combo.contexts.map(ctx => 
  boundsCache.get(ctx.key || ctx.hashKey) || null
);
```

### 2c. Early exit in `findBlockers`

**Problem:** Scanning all assignments on all resources even when past the task's window.

**Fix:** Add break when past window:

```typescript
let node = resource.assignments.head;
while (node) {
  const assignment = node.data;
  
  // Early exit: assignments past the task window
  // (only works if assignments are sorted by startW)
  if (assignment.startW >= task.window.endW) break;
  
  if (task.window && assignment.endW > task.window.startW && assignment.startW < task.window.endW) {
    // ... existing blocker logic
  }
  node = node.next;
}
```

**Note:** This only works if assignments are sorted by startW. Verify that the assignment linked list maintains order. If not, skip this optimization.

---

## Part 3: SolutionState Snapshot

This is the foundation for solve replay (Sprint 18), strategy comparison, and future tabu search / ILS.

### 3a. SolutionState class

A lightweight capture of the entire schedule state — what's scheduled where and when.

```typescript
// New file: Models/Entities/solutionstate.ts

export interface TaskAssignment {
  taskKey: string;
  resourceKeys: string[];           // all assigned resources
  primaryResourceKey: string;       // lane resource
  startW: number;
  endW: number;
  score: number;
  chainKey: string | null;
}

export interface SolutionState {
  id: string;                       // unique snapshot ID (uuid or timestamp)
  label: string;                    // "Best found", "Pre-bump", "Iteration 3"
  timestamp: number;                // when snapshot was taken
  assignments: Map<string, TaskAssignment>;  // taskKey → assignment
  totalScore: number;               // sum of all task scores
  feasibilityRate: number;          // scheduled / total
  scheduledCount: number;
  infeasibleCount: number;
  totalGap: number;                 // sum of chain gaps
  bumpCount: number;
}

export class SolutionStateBuilder {

  /**
   * Capture the current landscape state as a SolutionState.
   */
  static capture(
    landscape: SchedulingLandscape,
    label: string = 'snapshot'
  ): SolutionState {
    const assignments = new Map<string, TaskAssignment>();
    let totalScore = 0;
    let scheduledCount = 0;
    let infeasibleCount = 0;

    landscape.tasks?.forEach(task => {
      if (task.state === CTPTaskStateConstants.SCHEDULED && task.scheduled) {
        const resourceKeys: string[] = [];
        let primaryKey = '';

        task.capacityResources?.forEach(tr => {
          if (tr.scheduledResource) {
            resourceKeys.push(tr.scheduledResource);
            if (tr.isPrimary) primaryKey = tr.scheduledResource;
          }
        });

        assignments.set(task.key, {
          taskKey: task.key,
          resourceKeys,
          primaryResourceKey: primaryKey,
          startW: task.scheduled.startW,
          endW: task.scheduled.endW,
          score: task.score !== Number.MAX_VALUE ? task.score : 0,
          chainKey: task.linkId?.name || null,
        });

        totalScore += task.score !== Number.MAX_VALUE ? task.score : 0;
        scheduledCount++;
      } else {
        infeasibleCount++;
      }
    });

    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      label,
      timestamp: Date.now(),
      assignments,
      totalScore,
      feasibilityRate: (scheduledCount + infeasibleCount) > 0
        ? scheduledCount / (scheduledCount + infeasibleCount)
        : 0,
      scheduledCount,
      infeasibleCount,
      totalGap: 0,  // computed from chain integrity if needed
      bumpCount: 0,
    };
  }

  /**
   * Restore a SolutionState to the landscape.
   * Unschedules everything, then re-assigns from the snapshot.
   */
  static restore(
    landscape: SchedulingLandscape,
    state: SolutionState,
    scheduleEngine: ScheduleEngine,
  ): void {
    // Unschedule all currently scheduled tasks
    landscape.tasks?.forEach(task => {
      if (task.state === CTPTaskStateConstants.SCHEDULED) {
        landscape.unscheduleTask(task.key, true);
      }
    });

    // Restore assignments from snapshot
    for (const [taskKey, assignment] of state.assignments) {
      const task = landscape.tasks?.getEntity(taskKey);
      if (!task || !task.duration) continue;

      // Rebuild minimal ScheduleContext for the assignment
      task.state = CTPTaskStateConstants.SCHEDULED;
      if (!task.scheduled) task.scheduled = new CTPInterval();
      task.scheduled.set(assignment.startW, assignment.endW, 1);

      // Add assignments to resources
      let index = 0;
      task.capacityResources?.forEach(tr => {
        const resKey = assignment.resourceKeys[index];
        if (resKey) {
          const resource = landscape.resources?.getEntity(resKey);
          if (resource) {
            scheduleEngine.addTaskToResource(
              resource, task,
              assignment.startW, assignment.endW,
              CTPAssignmentConstants.PROCESS, index
            );
            tr.scheduledResource = resKey;
          }
        }
        index++;
      });
    }
  }

  /**
   * Compare two solution states.
   * Returns a delta showing what changed.
   */
  static compare(a: SolutionState, b: SolutionState): SolutionDelta {
    const moved: TaskMovement[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    // Tasks in B but not A (newly scheduled)
    for (const [key, bAssign] of b.assignments) {
      const aAssign = a.assignments.get(key);
      if (!aAssign) {
        added.push(key);
      } else if (aAssign.startW !== bAssign.startW ||
                 aAssign.primaryResourceKey !== bAssign.primaryResourceKey) {
        moved.push({
          taskKey: key,
          fromResource: aAssign.primaryResourceKey,
          toResource: bAssign.primaryResourceKey,
          fromStartW: aAssign.startW,
          toStartW: bAssign.startW,
          scoreDelta: bAssign.score - aAssign.score,
        });
      }
    }

    // Tasks in A but not B (unscheduled)
    for (const key of a.assignments.keys()) {
      if (!b.assignments.has(key)) removed.push(key);
    }

    return {
      moved,
      added,
      removed,
      scoreDelta: b.totalScore - a.totalScore,
      feasibilityDelta: b.feasibilityRate - a.feasibilityRate,
      scheduledDelta: b.scheduledCount - a.scheduledCount,
    };
  }
}

export interface TaskMovement {
  taskKey: string;
  fromResource: string;
  toResource: string;
  fromStartW: number;
  toStartW: number;
  scoreDelta: number;
}

export interface SolutionDelta {
  moved: TaskMovement[];
  added: string[];
  removed: string[];
  scoreDelta: number;
  feasibilityDelta: number;
  scheduledDelta: number;
}
```

### 3b. Capture snapshots during solve

Add snapshot capture at key points in the solve loop:

```typescript
// In basescheduler.ts schedule():

// After Pass 1 (manual):
const afterManual = SolutionStateBuilder.capture(this.landscape, 'After manual pass');

// After chain pass (before bump):
const afterChains = SolutionStateBuilder.capture(this.landscape, 'After chain pass');

// After bump-and-retry:
const afterBumps = SolutionStateBuilder.capture(this.landscape, 'After bumps');

// Final:
const finalState = SolutionStateBuilder.capture(this.landscape, 'Final');

// Store on solve result
result.snapshots = [afterManual, afterChains, afterBumps, finalState];
```

### 3c. Include in solve response (optional for now)

The snapshots can be included in the solve response for solve replay and strategy comparison. For V1, just capture the final state:

```typescript
// In CTPSolveResult:
finalState?: SolutionState;
```

---

## Part 4: Code Quality Cleanup

### 4a. Remove console.log statements

Replace with a debug flag check:

```typescript
// Add to appSettings:
public debugLogging: boolean = false;

// Replace console.log calls:
if (this.settings?.debugLogging) {
  console.log("SCHEDULED " + task.name);
}
```

Or better: create a simple logger utility:

```typescript
// utils/logger.ts
export class EngineLogger {
  static enabled = false;
  static log(msg: string) { if (this.enabled) console.log(msg); }
  static debug(msg: string) { if (this.enabled) console.debug(msg); }
}
```

Files to clean: `scheduleengine.ts` (lines 52, 64, 131), `chainneighborhood.ts` (line 100), `basescheduler.ts` (lines 480, 550).

### 4b. Replace `var` with `let`/`const`

Files: `scheduleengine.ts` (lines 113, 121)

### 4c. Log errors in empty catch blocks

Files: `scoringengine.ts` (lines 47, 63)

```typescript
// Replace: catch {}
// With:    catch (err) { EngineLogger.debug(`Scoring rule error: ${err}`); }
```

### 4d. Fix typos (optional, low priority)

- `CTPResourceConstants.RESUABLE` → `REUSABLE` (constants.ts, resource.ts)
- `statechangeerengine.ts` → `statechangeengine.ts` (filename)

These affect imports across the codebase — do in a dedicated cleanup commit if desired.

---

## Part 5: Verification

After implementing:

- [ ] Context mutation fix: same Recovery context in two lane combos gets correct independent scores
- [ ] capContextSets: contexts sorted by earliest start, not MAX_VALUE
- [ ] capContextSets: per-task limit uses nth-root of maxCombos, not hardcoded 3
- [ ] retryChain: window.reset() called before re-explosion
- [ ] Scoring rules built once per evaluateChain call, reused across combos
- [ ] Context time bounds cached, not recomputed per combo
- [ ] Early exit in findBlockers when past window (if assignments are sorted)
- [ ] SolutionState.capture() correctly captures all scheduled task assignments
- [ ] SolutionState.restore() correctly restores a previous state
- [ ] SolutionState.compare() correctly identifies moved/added/removed tasks
- [ ] Console.log statements behind debug flag
- [ ] No `var` usage in engine files
- [ ] Empty catch blocks log errors
- [ ] All three tenants solve correctly after changes (regression test)
- [ ] Healthcare: 8/10+ chains still clean after scoring changes
- [ ] HRMD: cadence still works, no regression

---

## Size Estimate

- Part 1 (correctness fixes): 30 min
- Part 2 (performance optimizations): 30 min
- Part 3 (SolutionState snapshot): 45 min
- Part 4 (code quality): 15 min
- Testing: 15 min
- Total: ~2-2.5 hours CC work
