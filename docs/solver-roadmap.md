# Solver Roadmap — Core Infrastructure & Strategy Tiers

This document defines the solver architecture: core components that always run, and pluggable strategy tiers that users select based on their needs.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SOLVE REQUEST                            │
│  strategy: quick | balanced | thorough | best                   │
│  timeLimit: 30s                                                 │
│  orderModes, taskPins, taskExcludes, scoringConfig              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CORE INFRASTRUCTURE                           │
│                   (always runs)                                  │
│                                                                 │
│  1. Apply Overrides (pins, excludes, unschedules, order modes)  │
│  2. Constraint Propagation (tighten all task windows)           │
│  3. Scoring Engine (rules + weights + flexibility)              │
│  4. Top-N Ranked Contexts (always compute top 5)                │
│  5. Profile Algebra (availability decrement/increment)          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   STRATEGY SELECTION                             │
│                                                                 │
│  ⚡ Quick      →  Greedy                                        │
│  🎯 Balanced   →  Greedy + Bump Backtracking                    │
│  🔬 Thorough   →  Greedy + Tabu Search                          │
│  🏆 Best       →  Iterated Local Search or Random Sampling      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SOLVE RESPONSE                                │
│                                                                 │
│  results, strategy used, iterations, backtracks, solveTimeMs    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Core Infrastructure (Always Runs)

These are not solver strategies. They are foundational components that every strategy depends on. Implement all of them.

### 1A. Constraint Propagation

**What:** Before the P-T-R loop starts, propagate timing constraints to tighten every task's window. This reduces the search space for all strategies.

**Algorithm:**

```
repeat until no changes:
  for each task T with predecessors:
    for each predecessor P of T:
      if timing is END-to-START:
        T.window.startW = max(T.window.startW, P.window.startW + P.duration)
      if timing is START-to-START:
        T.window.startW = max(T.window.startW, P.window.startW + offset)
      if timing is END-to-END:
        T.window.endW = min(T.window.endW, P.window.endW)
        
  // Backward propagation
  for each task T with successors:
    for each successor S of T:
      if timing is END-to-START:
        T.window.endW = min(T.window.endW, S.window.endW - S.duration)
      if timing is START-to-START:
        T.window.endW = min(T.window.endW, S.window.startW + S.duration)

  // Detect infeasibility early
  if T.window.startW >= T.window.endW:
    mark T infeasible (window collapsed)
```

**Implementation location:** New method on `SchedulingLandscape`:

```typescript
class SchedulingLandscape {
  public propagateConstraints(): void {
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;  // safety bound

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      this.tasks?.forEach(task => {
        if (!task.window || !task.includeInSolve) return;
        if (!task.linkId?.prevLink) return;

        const pred = this.tasks?.getEntity(task.linkId.prevLink);
        if (!pred || !pred.window || !pred.duration) return;

        // Forward: tighten successor start
        const earliestStart = pred.window.startW + pred.duration.duration();
        if (earliestStart > task.window.startW) {
          task.window.startW = earliestStart;
          changed = true;
        }

        // Backward: tighten predecessor end
        const latestEnd = task.window.endW - (task.duration?.duration() || 0);
        if (latestEnd < pred.window.endW) {
          pred.window.endW = latestEnd;
          changed = true;
        }

        // Detect collapsed window
        if (task.window.startW >= task.window.endW) {
          task.addError('ConstraintPropagation', 
            `Window collapsed: earliest start ${task.window.startW} >= latest end ${task.window.endW}`);
          task.includeInSolve = false;
        }
      });
    }
  }
}
```

**When to call:** After applying overrides, before any strategy runs. Every solve.

### 1B. Top-N Ranked Contexts

**What:** Always compute and store the top N scored schedule contexts per task, not just the best. This is the foundation for backtracking, alternatives display, and all advanced strategies.

```typescript
class RankedScheduleContexts {
  public ranked: BestScheduleContext[];
  public maxRank: number;

  constructor(max: number = 5) {
    this.ranked = [];
    this.maxRank = max;
  }

  public add(ctx: BestScheduleContext): void {
    this.ranked.push(ctx);
    this.ranked.sort((a, b) => a.best.blendedScore.score - b.best.blendedScore.score);
    if (this.ranked.length > this.maxRank) {
      this.ranked = this.ranked.slice(0, this.maxRank);
    }
  }

  public best(): BestScheduleContext | undefined {
    return this.ranked[0];
  }

  public alternative(rank: number): BestScheduleContext | undefined {
    return this.ranked[rank];
  }

  public hasAlternatives(): boolean {
    return this.ranked.length > 1;
  }

  // Neighborhood detection — gap between adjacent scores
  public neighborhoodBoundary(): number {
    if (this.ranked.length < 2) return 0;
    let maxGap = 0;
    let gapIndex = 1;
    for (let i = 1; i < this.ranked.length; i++) {
      const gap = this.ranked[i].best.blendedScore.score - this.ranked[i - 1].best.blendedScore.score;
      if (gap > maxGap) {
        maxGap = gap;
        gapIndex = i;
      }
    }
    return gapIndex;  // alternatives before this index are "in the neighborhood"
  }

  public inNeighborhood(): BestScheduleContext[] {
    const boundary = this.neighborhoodBoundary();
    return this.ranked.slice(0, boundary);
  }

  public outsideNeighborhood(): BestScheduleContext[] {
    const boundary = this.neighborhoodBoundary();
    return this.ranked.slice(boundary);
  }
}
```

**Storage:** Add to `ScheduleContext` or maintain a map keyed by task:

```typescript
class SolverState {
  public rankedByTask: Map<string, RankedScheduleContexts> = new Map();

  public getRanked(taskKey: string): RankedScheduleContexts {
    if (!this.rankedByTask.has(taskKey)) {
      this.rankedByTask.set(taskKey, new RankedScheduleContexts(5));
    }
    return this.rankedByTask.get(taskKey)!;
  }
}
```

### 1C. Flexibility Scoring Rule

**What:** A scoring rule that measures how much capacity remains for unscheduled tasks after a candidate assignment. Prefer assignments that preserve options.

```typescript
class FlexibilityScoringRule implements IScoringRule {
  public name = 'FlexibilityScoringRule';

  public score(
    context: ScheduleContext,
    landscape: SchedulingLandscape,
    startTime: CTPStartTime,
  ): number {
    let flexibility = 0;
    const horizon = landscape.horizon;
    if (!horizon) return 0;

    context.slot.resources?.forEach(slot => {
      if (!slot.resource) return;

      const available = slot.resource.available.staticAvailable;
      if (!available) return;

      // Remaining white space on this resource after proposed assignment
      const totalWhiteSpace = available.whiteSpace(startTime.eStartW);
      
      // Count unscheduled tasks that need this resource
      let pendingCount = 0;
      landscape.tasks?.forEach(t => {
        if (t.includeInSolve && !t.processed) {
          const needsThis = t.capacityResources?.some(
            r => r.resource === slot.resource?.key || 
                 r.scheduledResource === slot.resource?.key
          );
          if (needsThis) pendingCount++;
        }
      });

      // Flexibility = remaining capacity per pending task
      // Higher = more room for future tasks = better
      if (pendingCount > 0) {
        flexibility += totalWhiteSpace / pendingCount;
      } else {
        flexibility += totalWhiteSpace;
      }
    });

    return flexibility;
  }
}
```

**Configuration:**

```typescript
// Add to default scoring config
new CTPScoringConfiguration(
  'FlexibilityScoringRule',
  0.2,  // moderate weight — don't dominate start time and utilization
  CTPScoreObjectiveConstants.MAXIMIZE
)
```

### 1D. Solve Statistics

Every solve records statistics regardless of strategy:

```typescript
interface SolveStatistics {
  strategy: string;
  totalTimeMs: number;
  propagationTimeMs: number;
  scoringTimeMs: number;
  assignmentTimeMs: number;

  tasksProcessed: number;
  tasksFeasible: number;
  tasksInfeasible: number;
  tasksPinned: number;
  tasksExcluded: number;

  backtrackAttempts: number;
  backtrackSuccesses: number;
  bumpsPerformed: number;

  iterations: number;          // for ILS/RBRS
  bestIterationFound: number;  // which iteration found the best solution

  contextsEvaluated: number;
  contextsPerTask: number;     // average

  totalScore: number;
  scoreBreakdown: Record<string, number>;  // per-rule totals
}
```

Include in the solve response so the UI can display solver performance.

---

## Part 2: Strategy Tier — ⚡ Quick (Greedy)

**Status: IMPLEMENTED (current solver)**

**What:** Single forward pass through tasks in priority order. For each task, evaluate all schedule contexts, pick the best, assign it, move on. No backtracking.

**When to use:** CTP queries where speed matters more than optimality. Real-time "can I promise this?" scenarios. Simple problems with low contention.

```
P: Select highest-priority unprocessed task
T+R: Evaluate all contexts, pick best scored
Assign and continue
```

**Pseudocode:**

```typescript
function solveGreedy(landscape: SchedulingLandscape, state: SolverState): SolveStatistics {
  const stats = new SolveStatistics('quick');

  const tasks = getSortedTasks(landscape);  // P decision

  for (const task of tasks) {
    if (!task.includeInSolve || task.processed) continue;

    const contexts = buildScheduleContexts(task, landscape);
    const ranked = scoreAndRank(contexts, landscape, state);  // T+R decision
    
    state.getRanked(task.key).ranked = ranked.ranked;  // store top-N even though we only use #1

    const best = ranked.best();
    if (best) {
      assignTask(task, best, landscape);
      stats.tasksFeasible++;
    } else {
      task.addError('Solver', 'No feasible context found');
      stats.tasksInfeasible++;
    }
    stats.tasksProcessed++;
  }

  return stats;
}
```

**Time complexity:** O(T × R × W) where T=tasks, R=resource combinations, W=time windows.

---

## Part 3: Strategy Tier — 🎯 Balanced (Greedy + Bump Backtracking)

**Status: TO IMPLEMENT (V1 priority)**

**What:** Same as Greedy, but when a task is infeasible, attempt to bump lower-priority tasks off the bottleneck resource and retry.

**When to use:** Default for production scheduling. Best balance of speed and quality. Handles contention well.

```
P: Select highest-priority unprocessed task
T+R: Evaluate all contexts, pick best scored
If infeasible:
  C: Identify bottleneck resource
     Find lowest-priority task on that resource
     Unschedule it (bump)
     Retry current task
     Try to reschedule bumped task elsewhere
```

**Pseudocode:**

```typescript
function solveBalanced(
  landscape: SchedulingLandscape, 
  state: SolverState,
  maxBumps: number = 3,
): SolveStatistics {
  const stats = new SolveStatistics('balanced');

  const tasks = getSortedTasks(landscape);

  for (const task of tasks) {
    if (!task.includeInSolve || task.processed) continue;

    let assigned = false;
    let bumpAttempts = 0;

    while (!assigned && bumpAttempts <= maxBumps) {
      const contexts = buildScheduleContexts(task, landscape);
      const ranked = scoreAndRank(contexts, landscape, state);
      state.getRanked(task.key).ranked = ranked.ranked;

      const best = ranked.best();
      if (best) {
        assignTask(task, best, landscape);
        assigned = true;
        stats.tasksFeasible++;
      } else if (bumpAttempts < maxBumps) {
        // C decision — find who to bump
        const bumped = findBumpCandidate(task, landscape);
        if (bumped) {
          unscheduleTask(bumped, landscape);
          stats.bumpsPerformed++;
          bumpAttempts++;
          stats.backtrackAttempts++;
        } else {
          break;  // no one to bump
        }
      } else {
        break;  // exhausted bump attempts
      }
    }

    if (!assigned) {
      task.addError('Solver', `Infeasible after ${bumpAttempts} bump attempts`);
      stats.tasksInfeasible++;
    }
    stats.tasksProcessed++;
  }

  // Attempt to reschedule all bumped tasks
  const bumpedTasks = tasks.filter(t => t.includeInSolve && !t.processed);
  for (const bumped of bumpedTasks) {
    const contexts = buildScheduleContexts(bumped, landscape);
    const ranked = scoreAndRank(contexts, landscape, state);
    const best = ranked.best();
    if (best) {
      assignTask(bumped, best, landscape);
      stats.backtrackSuccesses++;
    } else {
      bumped.addError('Solver', 'Bumped and could not be rescheduled');
    }
  }

  return stats;
}
```

**Bump candidate selection:**

```typescript
function findBumpCandidate(
  blockedTask: CTPTask,
  landscape: SchedulingLandscape,
): CTPTask | null {
  // 1. Find the bottleneck resource — the one with least availability in task's window
  const bottleneck = findBottleneckResource(blockedTask, landscape);
  if (!bottleneck) return null;

  // 2. Find tasks assigned to that resource that overlap the blocked task's window
  const overlapping = findOverlappingTasks(bottleneck, blockedTask.window, landscape);
  if (overlapping.length === 0) return null;

  // 3. Filter: don't bump pinned, locked, or higher-priority tasks
  const bumpable = overlapping.filter(t => 
    !t.pinned &&
    t.includeInSolve &&
    t.sequence > blockedTask.sequence  // lower priority = higher sequence number
  );
  if (bumpable.length === 0) return null;

  // 4. Pick the lowest-priority bumpable task
  bumpable.sort((a, b) => b.sequence - a.sequence);  // highest sequence = lowest priority
  return bumpable[0];
}

function findBottleneckResource(
  task: CTPTask,
  landscape: SchedulingLandscape,
): CTPResource | null {
  let minAvail = Infinity;
  let bottleneck: CTPResource | null = null;

  task.capacityResources?.forEach(tr => {
    const resKey = tr.resource || tr.scheduledResource;
    if (!resKey) return;
    const resource = landscape.resources?.getEntity(resKey);
    if (!resource) return;

    const avail = resource.available.staticAvailable;
    if (!avail) return;

    const ws = avail.whiteSpace(task.window?.startW);
    if (ws < minAvail) {
      minAvail = ws;
      bottleneck = resource;
    }
  });

  return bottleneck;
}
```

**Configuration:**

```typescript
interface BalancedConfig {
  maxBumpsPerTask: number;      // default: 3
  bumpStrategy: 'lowest-priority' | 'highest-score' | 'most-flexible';  // default: lowest-priority
  allowCascadeBumps: boolean;   // default: false (V1), true later
}
```

---

## Part 4: Strategy Tier — 🔬 Thorough (Tabu Search)

**Status: V2**

**What:** Bump backtracking with memory. Maintains a tabu list of recent moves to prevent cycling. Explores neighborhoods systematically using the ranked context scores.

**When to use:** Complex problems with many changeovers, tight capacity, lots of contention. When Balanced produces too many infeasibilities or suboptimal changeover sequences.

```
Same as Balanced, plus:
  - Tabu list tracks recent moves (task + resource + time window)
  - When backtracking, skip moves on the tabu list
  - Use neighborhood detection from ranked contexts
  - Within neighborhood: try alternatives sequentially
  - Outside neighborhood: make a "jump" to escape local optima
```

**Key data structures:**

```typescript
interface TabuMove {
  taskKey: string;
  resourceKey: string;
  timeWindow: { startW: number; endW: number };
  expiry: number;  // iteration at which this move leaves the tabu list
}

class TabuList {
  private moves: TabuMove[] = [];
  private tenure: number;  // how many iterations a move stays tabu

  constructor(tenure: number = 7) {
    this.tenure = tenure;
  }

  public add(move: TabuMove, iteration: number): void {
    move.expiry = iteration + this.tenure;
    this.moves.push(move);
  }

  public isTabu(taskKey: string, resourceKey: string, startW: number, iteration: number): boolean {
    // Clean expired
    this.moves = this.moves.filter(m => m.expiry > iteration);
    
    return this.moves.some(m => 
      m.taskKey === taskKey && 
      m.resourceKey === resourceKey &&
      Math.abs(m.timeWindow.startW - startW) < 3600  // within 1 hour = same move
    );
  }

  public clear(): void {
    this.moves = [];
  }
}
```

**Pseudocode:**

```typescript
function solveThorough(
  landscape: SchedulingLandscape,
  state: SolverState,
  config: TabuConfig,
): SolveStatistics {
  const stats = new SolveStatistics('thorough');
  const tabu = new TabuList(config.tabuTenure);

  let bestOverallScore = Infinity;
  let bestSolution: SolutionSnapshot | null = null;
  let iteration = 0;

  // Initial greedy pass
  const initialStats = solveBalanced(landscape, state, config.maxBumps);

  bestOverallScore = computeOverallScore(landscape);
  bestSolution = snapshotSolution(landscape);

  // Improvement iterations
  while (iteration < config.maxIterations && !isTimeUp(config.timeLimit)) {
    iteration++;

    // Find worst-scored tasks (candidates for rescheduling)
    const candidates = findWorstScoredTasks(landscape, 3);

    for (const candidate of candidates) {
      // Get ranked alternatives for this task
      const ranked = state.getRanked(candidate.key);
      if (!ranked.hasAlternatives()) continue;

      // Try alternatives not on tabu list
      for (let rank = 1; rank < ranked.ranked.length; rank++) {
        const alt = ranked.alternative(rank);
        if (!alt) continue;

        const resKey = alt.best.slot.resources?.index(0)?.resource?.key || '';
        if (tabu.isTabu(candidate.key, resKey, alt.startTime, iteration)) continue;

        // Unschedule current assignment
        const currentAssignment = getCurrentAssignment(candidate);
        unscheduleTask(candidate, landscape);

        // Try alternative
        assignTask(candidate, alt, landscape);

        // Evaluate
        const newScore = computeOverallScore(landscape);
        if (newScore < bestOverallScore) {
          bestOverallScore = newScore;
          bestSolution = snapshotSolution(landscape);
          stats.bestIterationFound = iteration;
        }

        // Add old move to tabu list (don't go back to what we just left)
        if (currentAssignment) {
          tabu.add({
            taskKey: candidate.key,
            resourceKey: currentAssignment.resourceKey,
            timeWindow: currentAssignment.timeWindow,
            expiry: 0,
          }, iteration);
        }

        break;  // made a move, continue to next candidate
      }
    }

    stats.iterations = iteration;
  }

  // Restore best solution found
  if (bestSolution) restoreSolution(bestSolution, landscape);

  return stats;
}
```

**Configuration:**

```typescript
interface TabuConfig {
  maxIterations: number;       // default: 50
  timeLimit: number;           // default: 30 seconds
  tabuTenure: number;          // default: 7 iterations
  maxBumps: number;            // default: 3 (for initial greedy pass)
  candidatesPerIteration: number;  // default: 3
}
```

---

## Part 5: Strategy Tier — 🏆 Best Quality

Two sub-strategies, selectable or auto-chosen based on problem size:

### 5A. Iterated Local Search (ILS)

**Status: V3**

**What:** Solve completely, then perturb (unschedule a chunk), re-solve, keep the best. Repeat. This is the "macro" version of backtracking — shakes up the entire schedule to find better global solutions.

```
1. Solve with Balanced strategy → Solution S₀
2. Perturb: unschedule 15-25% of tasks (worst-scored)
3. Re-solve with Balanced strategy → Solution S₁  
4. Accept: if score(S₁) < score(S₀), keep S₁
5. Repeat until time limit
6. Return best solution found
```

**Pseudocode:**

```typescript
function solveILS(
  landscape: SchedulingLandscape,
  state: SolverState,
  config: ILSConfig,
): SolveStatistics {
  const stats = new SolveStatistics('best-ils');

  // Initial solve
  solveBalanced(landscape, state, config.maxBumps);
  let bestScore = computeOverallScore(landscape);
  let bestSolution = snapshotSolution(landscape);
  stats.bestIterationFound = 0;

  let iteration = 0;
  while (iteration < config.maxIterations && !isTimeUp(config.timeLimit)) {
    iteration++;

    // Perturb: unschedule worst-scored tasks
    const perturbCount = Math.ceil(
      landscape.tasks!.size() * config.perturbRatio
    );
    const worst = findWorstScoredTasks(landscape, perturbCount);
    for (const task of worst) {
      unscheduleTask(task, landscape);
    }

    // Re-solve the unscheduled tasks
    solveBalanced(landscape, state, config.maxBumps);

    // Evaluate
    const newScore = computeOverallScore(landscape);
    if (newScore < bestScore) {
      bestScore = newScore;
      bestSolution = snapshotSolution(landscape);
      stats.bestIterationFound = iteration;
    } else {
      // Restore best
      restoreSolution(bestSolution, landscape);
    }

    stats.iterations = iteration;
  }

  restoreSolution(bestSolution!, landscape);
  return stats;
}
```

**Configuration:**

```typescript
interface ILSConfig {
  maxIterations: number;    // default: 20
  timeLimit: number;        // default: 60 seconds
  perturbRatio: number;     // default: 0.2 (unschedule 20% of tasks)
  maxBumps: number;         // default: 3
}
```

### 5B. Random Sampling (RBRS)

**Status: V3**

**What:** Run multiple greedy solves with weighted randomness. Instead of always picking the best context, pick randomly weighted by score (better scores = higher probability). Keep the best overall solution. Can run in parallel.

```
for i = 1 to N:
  for each task:
    Evaluate all contexts
    Pick randomly weighted by score (not always best)
  Record solution score
Return best solution across all N runs
```

**Pseudocode:**

```typescript
function solveRBRS(
  landscape: SchedulingLandscape,
  state: SolverState,
  config: RBRSConfig,
): SolveStatistics {
  const stats = new SolveStatistics('best-rbrs');

  let bestScore = Infinity;
  let bestSolution: SolutionSnapshot | null = null;

  for (let run = 0; run < config.numRuns; run++) {
    if (isTimeUp(config.timeLimit)) break;

    // Reset landscape to initial state
    resetAllAssignments(landscape);

    const tasks = getSortedTasks(landscape);

    for (const task of tasks) {
      if (!task.includeInSolve) continue;

      const contexts = buildScheduleContexts(task, landscape);
      const ranked = scoreAndRank(contexts, landscape, state);

      if (ranked.ranked.length === 0) continue;

      // Weighted random selection using regret-based probabilities
      const selected = weightedRandomSelect(ranked.ranked, config.temperature);
      if (selected) {
        assignTask(task, selected, landscape);
      }
    }

    const score = computeOverallScore(landscape);
    if (score < bestScore) {
      bestScore = score;
      bestSolution = snapshotSolution(landscape);
      stats.bestIterationFound = run;
    }

    stats.iterations = run + 1;
  }

  if (bestSolution) restoreSolution(bestSolution, landscape);
  return stats;
}

function weightedRandomSelect(
  ranked: BestScheduleContext[],
  temperature: number,
): BestScheduleContext {
  // Convert scores to probabilities using softmax
  const scores = ranked.map(r => -r.best.blendedScore.score);  // negate because lower = better
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp((s - maxScore) / temperature));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sumExps);

  // Roulette wheel selection
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (r <= cumulative) return ranked[i];
  }
  return ranked[ranked.length - 1];
}
```

**Configuration:**

```typescript
interface RBRSConfig {
  numRuns: number;         // default: 10
  timeLimit: number;       // default: 60 seconds
  temperature: number;     // default: 1.0 (higher = more random, lower = more greedy)
}
```

**Parallelism note:** Each run is independent. In a Node.js environment, use worker threads. In a future C# port, use `Parallel.For`. The landscape needs to be cloneable for parallel execution.

---

## Part 6: Solution Snapshot & Restore

All advanced strategies need the ability to save and restore a complete solution state:

```typescript
interface TaskSnapshot {
  taskKey: string;
  scheduled: { startW: number; endW: number } | null;
  resourceAssignments: { resourceKey: string; startW: number; endW: number }[];
  state: number;
  processed: boolean;
  score: number;
}

interface SolutionSnapshot {
  tasks: TaskSnapshot[];
  overallScore: number;
  timestamp: number;
}

function snapshotSolution(landscape: SchedulingLandscape): SolutionSnapshot {
  const tasks: TaskSnapshot[] = [];

  landscape.tasks?.forEach(task => {
    tasks.push({
      taskKey: task.key,
      scheduled: task.scheduled ? {
        startW: task.scheduled.startW,
        endW: task.scheduled.endW,
      } : null,
      resourceAssignments: (task.capacityResources?.map(r => ({
        resourceKey: r.scheduledResource || r.resource || '',
        startW: task.scheduled?.startW || 0,
        endW: task.scheduled?.endW || 0,
      })) || []) as any[],
      state: task.state,
      processed: task.processed,
      score: task.score,
    });
  });

  return {
    tasks,
    overallScore: computeOverallScore(landscape),
    timestamp: Date.now(),
  };
}

function restoreSolution(snapshot: SolutionSnapshot, landscape: SchedulingLandscape): void {
  // Unschedule everything first
  landscape.tasks?.forEach(task => {
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      unscheduleTask(task, landscape);
    }
  });

  // Restore from snapshot
  for (const ts of snapshot.tasks) {
    const task = landscape.tasks?.getEntity(ts.taskKey);
    if (!task || !ts.scheduled) continue;

    // Rebuild the assignment from snapshot
    // This needs to call the actual assignment logic to properly update availability profiles
    reassignFromSnapshot(task, ts, landscape);
  }
}
```

---

## Part 7: Overall Score Computation

A global objective function that evaluates an entire schedule:

```typescript
function computeOverallScore(landscape: SchedulingLandscape): number {
  let totalScore = 0;

  const scoring = landscape.scoring;  // CTPScoring with rules
  if (!scoring) return totalScore;

  landscape.tasks?.forEach(task => {
    if (!task.includeInSolve) return;

    if (!task.processed || task.state !== CTPTaskStateConstants.SCHEDULED) {
      // Infeasible penalty — large number to discourage
      totalScore += 1_000_000;
      return;
    }

    totalScore += task.score;
  });

  // Global metrics
  // Late orders
  const lateOrders = countLateOrders(landscape);
  totalScore += lateOrders * 100_000;

  // Makespan (total time from first task start to last task end)
  const makespan = computeMakespan(landscape);
  totalScore += makespan * 0.001;  // small weight

  return totalScore;
}
```

---

## Part 8: Solver Dispatcher

The entry point that routes to the correct strategy:

```typescript
interface SolveRequest {
  strategy?: 'quick' | 'balanced' | 'thorough' | 'best';
  timeLimit?: number;          // seconds, default varies by strategy
  maxBacktrackAttempts?: number;
  
  // Overrides
  orderModes?: Record<string, string>;
  taskPins?: Record<string, boolean>;
  taskExcludes?: Record<string, boolean>;
  taskUnschedules?: string[];
}

interface SolveResponse {
  // ... existing result fields ...
  stats: SolveStatistics;
}

class Solver {
  public solve(
    landscape: SchedulingLandscape,
    request: SolveRequest,
  ): SolveResponse {
    const state = new SolverState();
    const strategy = request.strategy || 'balanced';

    // ═══════════════════════════════════════
    // CORE INFRASTRUCTURE — always runs
    // ═══════════════════════════════════════

    // 1. Apply overrides
    applyOverrides(landscape, request);

    // 2. Constraint propagation
    landscape.propagateConstraints();

    // 3. Scoring engine is already configured via landscape.scoring

    // ═══════════════════════════════════════
    // STRATEGY DISPATCH
    // ═══════════════════════════════════════

    let stats: SolveStatistics;

    switch (strategy) {
      case 'quick':
        stats = solveGreedy(landscape, state);
        break;

      case 'balanced':
        stats = solveBalanced(landscape, state, request.maxBacktrackAttempts || 3);
        break;

      case 'thorough':
        stats = solveThorough(landscape, state, {
          maxIterations: 50,
          timeLimit: request.timeLimit || 30,
          tabuTenure: 7,
          maxBumps: 3,
          candidatesPerIteration: 3,
        });
        break;

      case 'best':
        // Auto-select ILS vs RBRS based on problem size
        const taskCount = landscape.tasks?.size() || 0;
        if (taskCount < 100) {
          // Small problem — RBRS explores well
          stats = solveRBRS(landscape, state, {
            numRuns: 10,
            timeLimit: request.timeLimit || 60,
            temperature: 1.0,
          });
        } else {
          // Larger problem — ILS is more efficient
          stats = solveILS(landscape, state, {
            maxIterations: 20,
            timeLimit: request.timeLimit || 60,
            perturbRatio: 0.2,
            maxBumps: 3,
          });
        }
        break;

      default:
        stats = solveBalanced(landscape, state, 3);
    }

    return {
      // ... build response from landscape ...
      stats,
    };
  }
}
```

---

## Part 9: API & UI Integration

### API — strategy selection in solve endpoint:

```typescript
// POST /v1/ctp/solve-and-sync
{
  "strategy": "balanced",
  "timeLimit": 30,
  "orderModes": { "WO-101": "LOCKED", "WO-103": "EXCLUDE" },
  "taskPins": { "OP-007": true },
  "taskExcludes": {},
  "taskUnschedules": ["OP-005"]
}
```

### API — strategy in response:

```typescript
{
  "summary": {
    "feasibilityRate": 96.2,
    "scheduledTasks": 25,
    "includedTasks": 26,
    // ...
  },
  "stats": {
    "strategy": "balanced",
    "totalTimeMs": 847,
    "propagationTimeMs": 12,
    "tasksProcessed": 26,
    "tasksFeasible": 25,
    "tasksInfeasible": 1,
    "backtrackAttempts": 3,
    "backtrackSuccesses": 2,
    "bumpsPerformed": 2,
    "iterations": 1,
    "contextsEvaluated": 312,
    "contextsPerTask": 12,
    "totalScore": 45230.5,
    "scoreBreakdown": {
      "EarliestStartTimeScoringRule": 23100.0,
      "ResourceUtilizationRule": 18200.5,
      "FlexibilityScoringRule": 3930.0
    }
  }
}
```

### UI — strategy selector in Solve Preview:

Add a strategy picker to the Solve Preview panel footer, before the Solve Now button:

```typescript
<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
  <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>Strategy:</span>
  {[
    { key: 'quick', icon: '⚡', label: 'Quick', sub: '< 1s' },
    { key: 'balanced', icon: '🎯', label: 'Balanced', sub: '1-5s' },
    { key: 'thorough', icon: '🔬', label: 'Thorough', sub: '10-30s' },
    { key: 'best', icon: '🏆', label: 'Best Quality', sub: '30-60s' },
  ].map(s => (
    <button key={s.key}
      onClick={() => setStrategy(s.key)}
      style={{
        padding: '6px 12px', borderRadius: 8,
        border: `1px solid ${strategy === s.key ? C.accent : C.border}`,
        background: strategy === s.key ? `${C.accent}22` : 'transparent',
        color: strategy === s.key ? C.accent : C.textMuted,
        fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      }}
    >
      <span>{s.icon} {s.label}</span>
      <span style={{ fontSize: 10, opacity: 0.7 }}>{s.sub}</span>
    </button>
  ))}
</div>
```

### UI — stats display after solve:

Show solver stats in a collapsible section at the top of the Overview tab after a solve completes:

```
Solved in 847ms using Balanced strategy
  25 of 26 tasks scheduled · 2 backtracks · 312 contexts evaluated
  [Show Details ▼]
```

Expanding shows the full stats breakdown including per-rule scores.

---

## Part 10: Implementation Sequence

| Sprint | Deliverable | Dependencies |
|--------|-------------|--------------|
| **Now** | Top-N Ranked Contexts (`RankedScheduleContexts`) | None |
| **Now** | Flexibility Scoring Rule | Scoring engine |
| **Now** | Solve Statistics (`SolveStatistics`) | None |
| **S+1** | Constraint Propagation (`propagateConstraints`) | `CTPLinkId`, task windows |
| **S+1** | Bump Backtracking (Balanced strategy) | Top-N contexts, `findBumpCandidate` |
| **S+1** | Solver Dispatcher with strategy routing | Greedy + Balanced |
| **S+1** | UI: strategy selector in Solve Preview | Solve Preview prompt |
| **S+1** | UI: solve stats display | Stats in response |
| **S+2** | Solution Snapshot & Restore | Profile algebra (increment/decrement) |
| **S+2** | Tabu Search (Thorough strategy) | Snapshots, Top-N, Balanced |
| **S+3** | ILS (Best Quality — ILS variant) | Snapshots, Balanced |
| **S+3** | RBRS (Best Quality — parallel variant) | Snapshots, Greedy, worker threads |
| **S+3** | Overall Score computation (global objective) | All scoring rules |
| **Future** | Adaptive weight learning | Feedback capture, regression |
| **Future** | Parallel RBRS with worker threads | RBRS, landscape cloning |

---

## Part 11: User-Facing Strategy Descriptions

For the UI, settings panel, and API documentation:

| Strategy | Label | Description | Typical Time | Best For |
|----------|-------|-------------|-------------|----------|
| `quick` | ⚡ Quick | Single-pass scheduling. Fastest results, may miss opportunities in tight scenarios. | < 1 second | CTP queries, real-time promises, simple schedules |
| `balanced` | 🎯 Balanced | Schedules with smart backtracking — bumps lower-priority work when needed. Best default for most situations. | 1-5 seconds | Daily production scheduling, moderate complexity |
| `thorough` | 🔬 Thorough | Explores multiple alternatives systematically. Avoids repeating unsuccessful patterns. Better changeover optimization. | 10-30 seconds | Complex changeover environments, tight capacity |
| `best` | 🏆 Best Quality | Runs multiple passes to find the best overall schedule. Trades time for quality. | 30-60 seconds | Weekly planning, what-if scenarios, when quality matters most |

---

## Appendix: Willoughby Mapping

| Willoughby Concept | Our Implementation | Strategy |
|--------------------|-------------------|----------|
| P decision (processing sequence) | Task ranking via scoring weights + sequence | All |
| T decision (time selection) | CTPRange, CTPStartTimes, ranked contexts | All |
| R decision (resource selection) | ScheduleContext, CTPResourceSlots | All |
| C decision (backtracking) | Bump heuristic, tabu list | Balanced, Thorough |
| A decision (activity redefinition) | Not implemented | Future |
| Profile data structure | CTPIntervals linked list | Core infrastructure |
| Constraint space search | Pre-filter combinations, intersect intervals | Core infrastructure |
| Blended metrics | CTPScoringConfiguration with weights | Core infrastructure |
| Neighborhoods | RankedScheduleContexts.neighborhoodBoundary() | Thorough |
| Adaptive learning | Feedback capture → weight regression | Future |
| Flexibility look-ahead | FlexibilityScoringRule | Core infrastructure |
