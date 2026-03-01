# Engine Sprint: Chain Constraint Propagation

Before scheduling any task in a chain, propagate feasibility constraints bidirectionally across all linked phases. Eliminate infeasible contexts and tighten start-time ranges upfront — so that when the per-task loop runs, every option it considers is already mutually consistent with the rest of the chain. No unscheduling, no backtracking, no state mutation.

This is the engine equivalent of "arc consistency" from constraint satisfaction. It replaces trial-and-error with elimination.

This is a pure engine change. No API changes, no UI changes, no new endpoints.

---

## Why

Today the solver processes chains greedily: schedule SETUP, then tighten PROC's window based on where SETUP landed, then tighten REC based on PROC. Each decision is permanent. If SETUP picks Monday and PROC can't follow (Dr. Chen is Tue-Fri only), the chain fails with no recovery.

**The problem:** decisions made early in the chain constrain what's possible later, but the solver has no way to know that upfront. It commits to SETUP's best context without considering whether PROC and REC can follow.

**The solution:** Before committing to anything, compute feasible contexts for ALL phases in the chain, then propagate constraints between them:

```
Forward:  SETUP's latest end   → PROC must start within maxGap
Backward: PROC's earliest start → SETUP must end before that - maxGap
Forward:  PROC's latest end    → REC must start within maxGap
Backward: REC's earliest start → PROC must end before that - maxGap
```

Contexts that can't participate in any valid chain sequence get eliminated. Start-time ranges that violate gap constraints get truncated. By the time the per-task solver runs, every remaining context is pre-validated.

**What this enables:**
- Chains schedule correctly on the first attempt (no retry loops)
- Infeasible chains are detected before any scheduling happens (better error messages)
- Backtracking becomes simpler — it only handles cross-chain resource conflicts, not intra-chain timing failures
- Works with any neighborhood strategy (greedy, chain-aware, manual)

---

## Prerequisites

1. **maxGap on CTPLinkId** — the constraint that drives propagation
2. **Chain-aware ordering** — already implemented (Phase 1), chains process as units
3. **Contexts already exploded** — the setup phase builds resource combos and computes start times for all tasks before the per-task loop

---

## Part 1: Add maxGap to CTPLinkId

Extend the existing `CTPLinkId` class:

### `linkid.ts` changes

```typescript
export interface ILinkId {
  name: string;
  type: string;
  prevLink: string;
  maxGap: number;        // NEW: max seconds between predecessor end and successor start
  timing: ITimingSetting; // NEW: which anchors to use (END-to-START, START-to-START, etc.)
}

export interface ITimingSetting {
  fromTiming: 'START' | 'END';
  toTiming: 'START' | 'END';
}

export class CTPLinkId implements ILinkId {
  public name: string;
  public type: string;
  public prevLink: string;
  public maxGap: number;
  public timing: ITimingSetting;

  constructor(n?: string, t?: string, prev?: string, maxGap?: number) {
    this.name = n ?? '';
    this.type = t ?? '';
    this.prevLink = prev ?? '';
    this.maxGap = maxGap ?? Number.MAX_VALUE; // No constraint by default
    this.timing = { fromTiming: 'END', toTiming: 'START' }; // END-to-START default
  }

  public hasMaxGap(): boolean {
    return this.maxGap < Number.MAX_VALUE;
  }
}
```

### Hydration

During state sync, read `maxGap` from the task config:

```json
{
  "key": "C001-PROC",
  "linkId": {
    "name": "C001",
    "prevLink": "C001-SETUP",
    "maxGap": 3600
  }
}
```

If `maxGap` is not specified, default to `Number.MAX_VALUE` (no constraint). Healthcare chains should set maxGap to something reasonable — e.g., 3600 (1 hour) between Setup and Procedure, 7200 (2 hours) between Procedure and Recovery.

---

## Part 2: ChainFeasibilitySet

A lightweight data structure that holds, for each task in a chain, its set of feasible contexts with their time ranges. This is the working set that propagation operates on.

### `ChainFeasibilitySet.ts`

```typescript
import { CTPTask } from '../Entities/task';
import { CTPStartTime } from '../Entities/starttime';
import { ScheduleContext } from '../Entities/schedulecontext';

/**
 * One feasible option for a task: a specific resource combination
 * with a range of possible start/end times.
 */
export interface ChainContextEntry {
  context: ScheduleContext;
  startTimes: CTPStartTime[];   // All feasible start-time nodes for this context
  earliestStart: number;         // Min eStartW across all start-time nodes
  latestEnd: number;             // Max lEndW across all start-time nodes
  eliminated: boolean;           // Marked for removal during propagation
}

/**
 * All feasible options for one task in a chain.
 */
export interface ChainTaskFeasibility {
  task: CTPTask;
  entries: ChainContextEntry[];
  chainEarliestStart: number;   // Min earliestStart across all non-eliminated entries
  chainLatestEnd: number;       // Max latestEnd across all non-eliminated entries
}

/**
 * The feasibility set for an entire chain.
 * Tasks are ordered by sequence (SETUP → PROC → REC).
 */
export class ChainFeasibilitySet {
  public chainName: string;
  public phases: ChainTaskFeasibility[];

  constructor(chainName: string) {
    this.chainName = chainName;
    this.phases = [];
  }

  /**
   * Build from a chain's tasks and their pre-computed contexts/start-times.
   * Call this AFTER the setup phase has exploded contexts and computed start times.
   */
  public build(
    tasks: CTPTask[],
    getContexts: (task: CTPTask) => ScheduleContext[],
    getStartTimes: (context: ScheduleContext) => CTPStartTime[],
  ): void {
    this.phases = [];

    for (const task of tasks) {
      const contexts = getContexts(task);
      const entries: ChainContextEntry[] = [];

      for (const ctx of contexts) {
        if (!ctx.slot.hasStartTimes()) continue; // Skip infeasible

        const startTimes = getStartTimes(ctx);
        if (startTimes.length === 0) continue;

        let earliest = Number.MAX_VALUE;
        let latest = 0;
        for (const st of startTimes) {
          if (st.eStartW < earliest) earliest = st.eStartW;
          if (st.lEndW > latest) latest = st.lEndW;
        }

        entries.push({
          context: ctx,
          startTimes,
          earliestStart: earliest,
          latestEnd: latest,
          eliminated: false,
        });
      }

      this.phases.push({
        task,
        entries,
        chainEarliestStart: 0,
        chainLatestEnd: 0,
      });
    }

    this.recomputeBounds();
  }

  /**
   * Recompute the aggregate bounds for each phase
   * based on non-eliminated entries.
   */
  public recomputeBounds(): void {
    for (const phase of this.phases) {
      let earliest = Number.MAX_VALUE;
      let latest = 0;
      for (const entry of phase.entries) {
        if (entry.eliminated) continue;
        if (entry.earliestStart < earliest) earliest = entry.earliestStart;
        if (entry.latestEnd > latest) latest = entry.latestEnd;
      }
      phase.chainEarliestStart = earliest === Number.MAX_VALUE ? 0 : earliest;
      phase.chainLatestEnd = latest;
    }
  }

  /**
   * Count non-eliminated entries for a phase.
   */
  public feasibleCount(phaseIndex: number): number {
    return this.phases[phaseIndex].entries.filter(e => !e.eliminated).length;
  }

  /**
   * Total eliminated across all phases.
   */
  public totalEliminated(): number {
    let count = 0;
    for (const phase of this.phases) {
      count += phase.entries.filter(e => e.eliminated).length;
    }
    return count;
  }

  /**
   * Is the chain still feasible? Every phase must have at least one
   * non-eliminated entry.
   */
  public isFeasible(): boolean {
    return this.phases.every(p => p.entries.some(e => !e.eliminated));
  }

  /**
   * Get the phase index for a task key.
   */
  public phaseIndex(taskKey: string): number {
    return this.phases.findIndex(p => p.task.key === taskKey);
  }

  public debug(): void {
    console.log(`Chain ${this.chainName}: ${this.phases.length} phases`);
    for (let i = 0; i < this.phases.length; i++) {
      const p = this.phases[i];
      const feasible = p.entries.filter(e => !e.eliminated).length;
      const total = p.entries.length;
      console.log(
        `  [${i}] ${p.task.name}: ${feasible}/${total} contexts feasible, ` +
        `range [${p.chainEarliestStart} - ${p.chainLatestEnd}]`
      );
    }
  }
}
```

---

## Part 3: ChainPropagationAgent

The core algorithm. Takes a `ChainFeasibilitySet` and propagates constraints forward and backward until no more entries can be eliminated.

### `ChainPropagationAgent.ts`

```typescript
import { ChainFeasibilitySet, ChainContextEntry, ChainTaskFeasibility } from './ChainFeasibilitySet';
import { CTPLinkId } from '../Core/linkid';
import { CTPStartTime } from '../Entities/starttime';

export interface PropagationResult {
  chainName: string;
  feasible: boolean;
  eliminated: number;          // Total contexts eliminated
  truncated: number;           // Total start-time nodes truncated
  passes: number;              // Number of forward+backward passes
  infeasiblePhase?: string;    // Which phase has zero options (if infeasible)
  infeasibleReason?: string;   // Why (for error reporting)
}

export class ChainPropagationAgent {

  /**
   * Run constraint propagation on a chain.
   * Alternates forward and backward passes until stable (no more eliminations).
   * Max 10 passes to prevent infinite loops.
   */
  public propagate(chain: ChainFeasibilitySet): PropagationResult {
    let totalEliminated = 0;
    let totalTruncated = 0;
    let passes = 0;
    const maxPasses = 10;

    let changed = true;
    while (changed && passes < maxPasses) {
      changed = false;
      passes++;

      // Forward pass: for each successor, eliminate entries that can't follow their predecessor
      const forwardResult = this.forwardPass(chain);
      if (forwardResult.eliminated > 0 || forwardResult.truncated > 0) {
        changed = true;
        totalEliminated += forwardResult.eliminated;
        totalTruncated += forwardResult.truncated;
      }

      // Check feasibility after forward
      if (!chain.isFeasible()) {
        return this.buildInfeasibleResult(chain, totalEliminated, totalTruncated, passes);
      }

      // Backward pass: for each predecessor, eliminate entries that can't precede their successor
      const backwardResult = this.backwardPass(chain);
      if (backwardResult.eliminated > 0 || backwardResult.truncated > 0) {
        changed = true;
        totalEliminated += backwardResult.eliminated;
        totalTruncated += backwardResult.truncated;
      }

      // Check feasibility after backward
      if (!chain.isFeasible()) {
        return this.buildInfeasibleResult(chain, totalEliminated, totalTruncated, passes);
      }

      chain.recomputeBounds();
    }

    return {
      chainName: chain.chainName,
      feasible: true,
      eliminated: totalEliminated,
      truncated: totalTruncated,
      passes,
    };
  }

  /**
   * Forward pass: SETUP → PROC → REC
   * For each successor phase (index > 0):
   *   - Get predecessor's aggregate latest end (across non-eliminated entries)
   *   - Get the maxGap from successor's linkId
   *   - Eliminate successor entries whose earliestStart is too late
   *     (successor.earliestStart > predecessor.latestEnd + maxGap)
   *   - Truncate successor start-time nodes that start before
   *     predecessor's earliest possible end
   */
  private forwardPass(chain: ChainFeasibilitySet): { eliminated: number; truncated: number } {
    let eliminated = 0;
    let truncated = 0;

    for (let i = 1; i < chain.phases.length; i++) {
      const pred = chain.phases[i - 1];
      const succ = chain.phases[i];
      const maxGap = succ.task.linkId?.maxGap ?? Number.MAX_VALUE;
      const hasMG = succ.task.linkId?.hasMaxGap() ?? false;

      // Predecessor's time bounds (non-eliminated entries only)
      const predEarliestEnd = this.earliestEndForPhase(pred);
      const predLatestEnd = this.latestEndForPhase(pred);

      if (predEarliestEnd === null) continue; // predecessor fully eliminated, will catch in feasibility check

      for (const entry of succ.entries) {
        if (entry.eliminated) continue;

        // Elimination: successor can't start before predecessor ends
        // If successor's LATEST possible end is before predecessor's EARLIEST end,
        // this entry is unreachable
        if (entry.latestEnd < predEarliestEnd) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Elimination: maxGap constraint
        // If the EARLIEST the successor can start is beyond maxGap after
        // the LATEST the predecessor can end, this entry is unreachable
        if (hasMG && entry.earliestStart > predLatestEnd + maxGap) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Truncation: tighten start times
        // Successor can't start before predecessor's earliest possible end
        truncated += this.truncateStartTimes(entry, predEarliestEnd, true);

        // Truncation: if maxGap, successor can't start after pred latest end + maxGap
        if (hasMG) {
          const latestAllowedStart = predLatestEnd + maxGap;
          truncated += this.truncateStartTimes(entry, latestAllowedStart, false);
        }
      }

      // Recompute successor bounds after elimination/truncation
      this.recomputeEntryBounds(succ);
    }

    chain.recomputeBounds();
    return { eliminated, truncated };
  }

  /**
   * Backward pass: REC → PROC → SETUP
   * For each predecessor phase (index < length - 1):
   *   - Get successor's aggregate earliest start (across non-eliminated entries)
   *   - Get the maxGap from successor's linkId
   *   - Eliminate predecessor entries whose latestEnd is too early
   *   - Truncate predecessor start-time nodes that end after successor's constraints
   */
  private backwardPass(chain: ChainFeasibilitySet): { eliminated: number; truncated: number } {
    let eliminated = 0;
    let truncated = 0;

    for (let i = chain.phases.length - 2; i >= 0; i--) {
      const pred = chain.phases[i];
      const succ = chain.phases[i + 1];
      const maxGap = succ.task.linkId?.maxGap ?? Number.MAX_VALUE;
      const hasMG = succ.task.linkId?.hasMaxGap() ?? false;

      // Successor's time bounds (non-eliminated entries only)
      const succEarliestStart = this.earliestStartForPhase(succ);
      const succLatestStart = this.latestStartForPhase(succ);

      if (succEarliestStart === null) continue;

      for (const entry of pred.entries) {
        if (entry.eliminated) continue;

        // Elimination: predecessor's earliest start is after successor's latest possible start
        // (no way for predecessor to end before successor needs to start)
        if (entry.earliestStart > succLatestStart!) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Elimination: maxGap backward
        // If predecessor's latest end + maxGap < successor's earliest start,
        // this predecessor can't reach the successor within maxGap
        if (hasMG && entry.latestEnd + maxGap < succEarliestStart) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Truncation: predecessor can't end after successor's latest start (for END-to-START)
        // This is looser but prevents obviously bad contexts from scoring well
        if (succLatestStart !== null) {
          truncated += this.truncateEndTimes(entry, succLatestStart, false);
        }
      }

      this.recomputeEntryBounds(pred);
    }

    chain.recomputeBounds();
    return { eliminated, truncated };
  }

  /**
   * Truncate start times that violate a time boundary.
   * @param entry The context entry to truncate
   * @param boundaryTime The time boundary
   * @param truncateBefore If true, remove start times before boundaryTime.
   *                       If false, remove start times after boundaryTime.
   * @returns Number of start-time nodes truncated
   */
  private truncateStartTimes(
    entry: ChainContextEntry,
    boundaryTime: number,
    truncateBefore: boolean,
  ): number {
    let truncated = 0;

    for (const st of entry.startTimes) {
      if (truncateBefore) {
        // Tighten: eStartW can't be before boundaryTime
        if (st.eStartW < boundaryTime) {
          st.eStartW = Math.min(boundaryTime, st.eEndW);
          truncated++;
        }
        if (st.lStartW < boundaryTime) {
          st.lStartW = Math.min(boundaryTime, st.lEndW);
          truncated++;
        }
      } else {
        // Tighten: lEndW can't be after boundaryTime
        if (st.lEndW > boundaryTime) {
          st.lEndW = Math.max(boundaryTime, st.lStartW);
          truncated++;
        }
        if (st.eEndW > boundaryTime) {
          st.eEndW = Math.max(boundaryTime, st.eStartW);
          truncated++;
        }
      }
    }

    // Remove start times where the range collapsed (eEnd <= eStart AND lEnd <= lStart)
    // This uses the existing CTPStartTime logic
    entry.startTimes = entry.startTimes.filter(st => {
      const eFeasible = (st.eEndW - st.eStartW) >= st.duration;
      const lFeasible = (st.lEndW - st.lStartW) >= st.duration;
      return eFeasible || lFeasible;
    });

    return truncated;
  }

  /**
   * Truncate end-time boundaries on a predecessor entry.
   */
  private truncateEndTimes(
    entry: ChainContextEntry,
    boundaryTime: number,
    truncateBefore: boolean,
  ): number {
    // For backward propagation: predecessor's end can't exceed
    // successor's latest start boundary
    let truncated = 0;
    for (const st of entry.startTimes) {
      if (!truncateBefore && st.lEndW > boundaryTime) {
        st.lEndW = Math.max(boundaryTime, st.lStartW);
        truncated++;
      }
    }
    return truncated;
  }

  // ─── Helper methods ───

  private earliestEndForPhase(phase: ChainTaskFeasibility): number | null {
    let earliest = Number.MAX_VALUE;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      for (const st of entry.startTimes) {
        // Earliest possible end = eStartW + duration
        const end = st.eStartW + st.duration;
        if (end < earliest) earliest = end;
      }
    }
    return earliest === Number.MAX_VALUE ? null : earliest;
  }

  private latestEndForPhase(phase: ChainTaskFeasibility): number {
    let latest = 0;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      if (entry.latestEnd > latest) latest = entry.latestEnd;
    }
    return latest;
  }

  private earliestStartForPhase(phase: ChainTaskFeasibility): number | null {
    let earliest = Number.MAX_VALUE;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      if (entry.earliestStart < earliest) earliest = entry.earliestStart;
    }
    return earliest === Number.MAX_VALUE ? null : earliest;
  }

  private latestStartForPhase(phase: ChainTaskFeasibility): number | null {
    let latest = 0;
    let found = false;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      for (const st of entry.startTimes) {
        if (st.lStartW > latest) { latest = st.lStartW; found = true; }
      }
    }
    return found ? latest : null;
  }

  private recomputeEntryBounds(phase: ChainTaskFeasibility): void {
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      if (entry.startTimes.length === 0) {
        entry.eliminated = true;
        continue;
      }
      let earliest = Number.MAX_VALUE;
      let latest = 0;
      for (const st of entry.startTimes) {
        if (st.eStartW < earliest) earliest = st.eStartW;
        if (st.lEndW > latest) latest = st.lEndW;
      }
      entry.earliestStart = earliest;
      entry.latestEnd = latest;
    }
  }

  private buildInfeasibleResult(
    chain: ChainFeasibilitySet,
    eliminated: number,
    truncated: number,
    passes: number,
  ): PropagationResult {
    let infeasiblePhase: string | undefined;
    let infeasibleReason: string | undefined;

    for (const phase of chain.phases) {
      if (!phase.entries.some(e => !e.eliminated)) {
        infeasiblePhase = phase.task.name;
        // Determine reason
        if (phase.entries.length === 0) {
          infeasibleReason = 'No feasible resource combinations';
        } else {
          infeasibleReason = 'All resource combinations eliminated by chain constraints (maxGap violation)';
        }
        break;
      }
    }

    return {
      chainName: chain.chainName,
      feasible: false,
      eliminated,
      truncated,
      passes,
      infeasiblePhase,
      infeasibleReason,
    };
  }
}
```

---

## Part 4: Integration Into the Solver

### Where It Runs

Chain propagation runs AFTER the setup phase (context explosion + initial start time computation) but BEFORE the per-task scheduling loop. It sits between steps 2 and 3 in the current flow:

```
SETUP PHASE:
  1. explodeScheduleContexts(allTasks)
  2. reComputeScheduleContexts()           ← start times + scores for ALL tasks
  
  >>> NEW: 2.5 chainPropagation()          ← propagate constraints, eliminate bad contexts
  
PER-TASK LOOP:
  3. For each task in chain order:
     a. enforceChainConstraint(task)       ← existing, still runs (handles predecessor.scheduled.endW)
     b. re-score task contexts             ← existing
     c. pick best context
     d. schedule task
     e. recompute shared-resource contexts
```

### Implementation

Add a method to the scheduler (wherever `explodeScheduleContexts` and `reComputeScheduleContexts` live):

```typescript
import { ChainFeasibilitySet } from './ChainFeasibilitySet';
import { ChainPropagationAgent, PropagationResult } from './ChainPropagationAgent';

private chainPropagation(
  landscape: SchedulingLandscape,
  contexts: ScheduleContexts,
): PropagationResult[] {
  const results: PropagationResult[] = [];
  const agent = new ChainPropagationAgent();

  if (!landscape.processes) return results;

  landscape.processes.forEach(process => {
    if (!process.tasks || process.tasks.length < 2) return; // Skip single-task "chains"

    // Sort tasks by sequence within the chain
    const tasks = [...process.tasks];
    tasks.sort((a, b) => a.sequence - b.sequence);

    // Check if any task in chain has maxGap
    const hasConstraints = tasks.some(t => t.linkId?.hasMaxGap());
    if (!hasConstraints) return; // Nothing to propagate

    // Build the feasibility set from pre-computed contexts
    const chainSet = new ChainFeasibilitySet(process.name);
    chainSet.build(
      tasks,
      (task) => this.getContextsForTask(task, contexts),
      (ctx) => this.getStartTimesForContext(ctx),
    );

    // Propagate
    const result = agent.propagate(chainSet);
    results.push(result);

    // Apply eliminations back to the contexts
    if (result.eliminated > 0) {
      this.applyEliminations(chainSet, contexts);
    }

    // If infeasible, mark all tasks in chain with error
    if (!result.feasible) {
      for (const task of tasks) {
        task.addError(
          'ChainPropagationAgent',
          `Chain ${process.name} infeasible: ${result.infeasibleReason} at ${result.infeasiblePhase}`
        );
        task.processed = true; // Don't try to schedule
      }
    }
  });

  return results;
}

/**
 * Get all ScheduleContext objects for a task from the pre-computed contexts map.
 */
private getContextsForTask(task: CTPTask, contexts: ScheduleContexts): ScheduleContext[] {
  const taskContexts = contexts.byTask.getEntity(task.key);
  if (!taskContexts) return [];
  return taskContexts.contexts.toArray();
}

/**
 * Get start time nodes from a context's slot.
 */
private getStartTimesForContext(ctx: ScheduleContext): CTPStartTime[] {
  if (!ctx.slot.startTimes) return [];
  const result: CTPStartTime[] = [];
  let node = ctx.slot.startTimes.head;
  while (node) {
    result.push(node.data);
    node = node.next;
  }
  return result;
}

/**
 * Apply eliminations from the feasibility set back to the actual contexts.
 * Eliminated entries get their start times cleared so the per-task solver skips them.
 */
private applyEliminations(chainSet: ChainFeasibilitySet, contexts: ScheduleContexts): void {
  for (const phase of chainSet.phases) {
    for (const entry of phase.entries) {
      if (entry.eliminated) {
        // Clear start times on the actual context so hasStartTimes() returns false
        if (entry.context.slot.startTimes) {
          entry.context.slot.startTimes.clear();
        }
        entry.context.slot.addToErrors(
          'Eliminated by chain constraint propagation'
        );
      }
    }
  }
}
```

### Calling It

In the main schedule method, after the setup phase:

```typescript
// After setup phase
this.explodeScheduleContexts(tasks);
this.reComputeScheduleContexts();

// NEW: Chain constraint propagation
if (landscape.appSettings?.requiresPreds) {
  const propResults = this.chainPropagation(landscape, this.contexts);
  
  // Log propagation results
  for (const r of propResults) {
    if (r.eliminated > 0 || !r.feasible) {
      console.log(
        `Chain ${r.chainName}: ${r.feasible ? 'feasible' : 'INFEASIBLE'}, ` +
        `${r.eliminated} contexts eliminated, ${r.truncated} truncated, ${r.passes} passes`
      );
    }
  }
  
  // Add to solve statistics
  if (stats) {
    stats.chainsPropagated = propResults.length;
    stats.chainsInfeasible = propResults.filter(r => !r.feasible).length;
    stats.contextsEliminated = propResults.reduce((sum, r) => sum + r.eliminated, 0);
  }
}

// Existing per-task loop continues...
```

---

## Part 5: Interaction With Existing Chain Enforcement

The existing `enforceChainConstraint` (Phase 2) runs during the per-task loop and clamps start times based on where the predecessor was *actually scheduled*. Chain propagation doesn't replace it — it runs before it.

The two work together:

1. **Chain propagation (Part 3)** — before any scheduling. Uses aggregate bounds (earliest/latest across all options). Eliminates obviously bad contexts.
2. **Chain enforcement (existing Phase 2)** — during per-task loop. Uses the actual scheduled time of the predecessor. Clamps to the exact time.

Think of propagation as the coarse filter and enforcement as the fine filter. Propagation might say "PROC can't start before Monday 10am" (because that's the earliest SETUP can end). Enforcement says "PROC can't start before Monday 10:47am" (because that's exactly when SETUP was placed).

---

## Part 6: Healthcare Walkthrough

### Case 5 — Rivera Knee Replacement

```
Chain: C005 (SETUP → PROCEDURE → RECOVERY)
Tasks: C005-SETUP, C005-PROC, C005-REC
maxGap: 3600 seconds (1 hour) between each phase
```

**Before propagation:**
```
C005-SETUP:  4 contexts (OR-01/02/03 + various nurses)
             Start ranges: Mon 06:00 - Fri 17:00
C005-PROC:   6 contexts (OR-01/02/03 × Dr.Chen/Dr.Patel + nurses)
             Start ranges: Tue 07:00 - Fri 17:00 (Dr. Chen is Tue-Fri)
C005-REC:    3 contexts (REC-01/02/03)
             Start ranges: Mon 06:00 - Fri 17:00
```

**Forward pass 1:**
- SETUP → PROC: SETUP's earliest possible end = Mon ~06:30. PROC's earliest start = Tue 07:00. Gap = ~24.5 hours > maxGap (1 hour).
  - But PROC *also* has contexts starting Tue 07:00. SETUP has contexts ending Tue+ too.
  - SETUP contexts that end Monday only? Eliminated — PROC can't follow within 1 hour.
  - 1 SETUP context eliminated (Mon-only OR-03 slot that ends Mon 06:30 with no Tue option)
- PROC → REC: PROC's earliest end = Tue ~09:30. REC contexts starting before Tue 09:30? Truncated (can't start before PROC ends). No eliminations — REC bays are flexible.

**Backward pass 1:**
- REC → PROC: REC's latest start = Fri 17:00. PROC contexts ending after Fri 18:00 (17:00 + 1hr maxGap)? None — all within range.
- PROC → SETUP: PROC's earliest start = Tue 07:00. SETUP must end no later than Tue 07:00. SETUP contexts that can't end before Tue 07:00? Already eliminated in forward pass.

**After propagation:**
```
C005-SETUP:  3 contexts (Mon-only slot eliminated)
             Start ranges: Mon 06:00 - Thu 17:00 (tightened)
C005-PROC:   6 contexts (unchanged — all Tue-Fri compatible)
             Start ranges: Tue 07:00 - Fri 17:00
C005-REC:    3 contexts (start times truncated)
             Start ranges: Tue 09:30 - Fri 19:00 (earliest pushed to after PROC ends)
```

**Result:** When the per-task solver runs, SETUP won't waste time on the Monday-only slot. PROC's contexts are all valid. REC's start times already reflect the minimum gap. The chain schedules on the first attempt.

---

## Part 7: SolveStatistics Extensions

Add propagation stats to `SolveStatistics`:

```typescript
// Add to SolveStatistics
public chainsPropagated: number = 0;
public chainsInfeasible: number = 0;
public contextsEliminated: number = 0;
public startTimesTruncated: number = 0;
```

Include in API response at `intermediate` detail level and above:

```typescript
if (detailLevel !== 'novice') {
  responseStats.chainsPropagated = stats.chainsPropagated;
  responseStats.chainsInfeasible = stats.chainsInfeasible;
  responseStats.contextsEliminated = stats.contextsEliminated;
}
```

---

## What NOT to Change

- **Don't change the per-task scheduling loop** — it still runs exactly the same. Propagation is preprocessing.
- **Don't change scoring** — contexts that survive propagation are scored as before.
- **Don't change context explosion** — all contexts are still generated. Propagation eliminates some afterward.
- **Don't skip enforceChainConstraint** — it still runs for the precise clamping after predecessor scheduling.
- **Don't propagate for chains without maxGap** — if maxGap is Number.MAX_VALUE, skip the chain. The only constraint is "successor starts after predecessor ends," which enforceChainConstraint handles.
- **Don't mutate task.window** — propagation works on context start-time ranges, not the task's scheduling window.

---

## Verification

### Unit Tests

**ChainFeasibilitySet:**

1. **Build from 3-phase chain** — verify phases ordered by sequence, entries populated from contexts
2. **recomputeBounds** — verify chainEarliestStart/chainLatestEnd correct after entry elimination
3. **isFeasible** — returns true when all phases have entries, false when any phase is empty
4. **feasibleCount** — counts non-eliminated entries correctly

**ChainPropagationAgent — Forward Pass:**

5. **No elimination when no maxGap** — chain with maxGap=MAX_VALUE, all entries survive
6. **Eliminate predecessor-only contexts** — SETUP context ending Mon, PROC starts Tue-only, maxGap=1hr → SETUP Mon context eliminated
7. **Truncate successor start times** — PROC start times before SETUP's earliest end get truncated forward
8. **maxGap elimination** — successor entry whose earliest start > pred latest end + maxGap → eliminated

**ChainPropagationAgent — Backward Pass:**

9. **Tighten predecessor end times** — SETUP contexts ending after last possible REC start → end times truncated
10. **Eliminate unreachable predecessors** — predecessor whose latest end + maxGap < successor earliest start → eliminated

**ChainPropagationAgent — Convergence:**

11. **Single pass sufficient for simple chain** — 3 phases, no circular dependencies → converges in 1 pass
12. **Multiple passes for cascading constraints** — eliminating PROC context reveals SETUP context can also be eliminated → 2 passes
13. **Max pass limit** — contrived scenario that would loop → stops at 10 passes

**ChainPropagationAgent — Infeasible Chain:**

14. **Detect infeasible chain** — PROC has only Tue contexts, SETUP has only Fri contexts, maxGap=1hr → infeasible, correct phase/reason reported
15. **All phases get error on infeasible** — every task in chain gets error message, all marked processed=true

**ChainPropagationAgent — Edge Cases:**

16. **Single-task chain** — skipped (nothing to propagate)
17. **Two-task chain** — works correctly with one forward + one backward pass
18. **Chain without maxGap** — skipped entirely, no changes
19. **All entries eliminated in one phase** — detected as infeasible, doesn't crash on subsequent phases

### Integration Tests

20. **Healthcare 10-case solve — before vs. after propagation:**
    - Same tasks scheduled (or more, if propagation prevents bad first choices)
    - Gaps between phases within maxGap constraint
    - Solve time comparable or faster (fewer wasted attempts)

21. **Manufacturing solve — no chains, no impact:**
    - Run with requiresPreds=false
    - Propagation doesn't run, results identical to current

22. **Chain with tight maxGap — Rivera Case 5:**
    - Set maxGap=1800 (30 min)
    - SETUP and PROC must be back-to-back
    - Propagation eliminates contexts where gap would exceed 30 min
    - If no valid combination exists, chain reported infeasible with clear error

23. **Propagation + enforceChainConstraint together:**
    - Propagation narrows ranges
    - Per-task enforcement clamps to exact predecessor end time
    - Start times are a subset of what propagation allowed (tighter, not wider)

24. **Stats reported correctly:**
    - `contextsEliminated` > 0 for constrained chains
    - `chainsInfeasible` > 0 when chains can't meet maxGap
    - Values appear in API response at intermediate+ detail level

Commit: "feat(engine): chain constraint propagation — eliminate infeasible contexts before scheduling"

---

## Relationship to Other Engine Sprints

```
maxGap + Chain Propagation (THIS SPRINT)
    ↓
    Narrows the option space upfront
    ↓
Top-N Ranked Contexts (PREVIOUS SPRINT)
    ↓
    Stores the surviving alternatives
    ↓
Backtracking / Bump (NEXT SPRINT)
    ↓
    Only needed for CROSS-CHAIN resource conflicts
    ↓
    Much simpler — doesn't need to handle intra-chain timing failures
```

Chain propagation handles the "timing" dimension. Backtracking handles the "contention" dimension. They're complementary, not overlapping. With propagation, the bump heuristic never needs to ask "should I unschedule SETUP to fix PROC?" — propagation already ensured every SETUP context has at least one valid PROC follow-up.
