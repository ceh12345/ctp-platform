# Prompt 1: Top-N Ranked Contexts

## Goal

Create a `RankedScheduleContexts` class that stores the top N (default 5) scored schedule contexts for a task, sorted by blended score. This replaces the current pattern of keeping only the single best `BestScheduleContext`. The class also detects **neighborhood boundaries** — score gaps that separate clusters of similar alternatives from genuinely different ones.

## Why This Matters

Today the solver evaluates all feasible contexts for a task, picks the best one, and throws the rest away. When backtracking needs to try an alternative (because the best choice caused a downstream infeasibility), there's nothing to fall back to — it would have to rebuild and re-score all contexts from scratch. Storing the top 5 means backtracking can instantly say "try rank 1 instead of rank 0" without recomputing.

The neighborhood boundary matters for Thorough strategy (tabu search, future prompt). When the solver wants to escape a local optimum, it needs to know: "are ranks 0-2 basically the same resource at slightly different times (same neighborhood), or is rank 3 a completely different resource (different neighborhood)?" The boundary tells it where a genuine alternative starts.

## Context — Existing Code

The solver currently produces `BestScheduleContext` objects:

```typescript
// From schedulecontext.ts
export class BestScheduleContext {
  public best: ScheduleContext;        // the winning context (task + resource slot combo)
  public startTimes: CTPStartTime;     // earliest/latest start/end times
  public startTime: number;            // the chosen start time
  public subType: number;
}
```

And `ScheduleContext` contains:
```typescript
export class ScheduleContext extends CTPEntityHashed {
  public landscape: ILandscape;
  public task: CTPTask;
  public slot: CTPResourceSlots;       // which resources are assigned
  public scores: CTPScores;            // individual scoring rule results
  public blendedScore: IScore;         // the composite score
}
```

The blended score (`blendedScore.score`) is what determines ranking. Lower score = better.

## New Files

### File 1: `RankedScheduleContexts.ts`

Create in the same directory as `schedulecontext.ts` (likely `Entities/` or `Solver/`).

```typescript
import { BestScheduleContext } from './schedulecontext';

export interface IRankedEntry {
  rank: number;                         // 0 = best, 1 = second best, etc.
  context: BestScheduleContext;
  score: number;                        // blendedScore.score for quick access
  resourceKeys: string[];               // resource keys for quick comparison
  isNeighborhoodBoundary: boolean;      // true if this entry starts a new neighborhood
}

export class RankedScheduleContexts {
  public taskKey: string;
  public ranked: IRankedEntry[];
  private maxN: number;
  private gapThreshold: number;        // % gap that defines a neighborhood boundary

  constructor(taskKey: string, maxN: number = 5, gapThreshold: number = 0.15) {
    this.taskKey = taskKey;
    this.ranked = [];
    this.maxN = maxN;
    this.gapThreshold = gapThreshold;   // 15% score gap = new neighborhood
  }
  // ... methods below
}
```

### Required Methods

**`addCandidate(context: BestScheduleContext): void`**

Insert a scored context in rank order (ascending by score — lowest = best). If the list exceeds `maxN`, drop the worst. After insertion, recompute neighborhood boundaries.

The resource keys for comparison should be extracted from `context.best.slot.resources` — concatenate each resource's key.

**`best(): BestScheduleContext | null`**

Return rank 0, or null if empty.

**`alternative(rank: number): BestScheduleContext | null`**

Return the context at the given rank, or null if rank is out of bounds.

**`hasAlternatives(): boolean`**

True if there are 2+ entries (something beyond the best).

**`count(): number`**

Number of stored entries.

**`neighborhoodBoundary(): number`**

Return the rank index where the first neighborhood boundary occurs. If scores are [1.0, 1.1, 1.15, 2.8, 3.0], the boundary is at rank 3 (the jump from 1.15 to 2.8 exceeds the gap threshold). If no boundary exists, return `this.ranked.length` (all entries are in the same neighborhood).

**`withinNeighborhood(): IRankedEntry[]`**

Return entries before the first boundary — the "similar alternatives" cluster.

**`outsideNeighborhood(): IRankedEntry[]`**

Return entries at or after the first boundary — the "genuinely different" alternatives.

**`clear(): void`**

Reset the ranked list.

**`removeByResourceKey(resourceKey: string): void`**

Remove any entry whose resource keys include the given key. Used when a resource becomes unavailable. Re-rank after removal.

### Neighborhood Boundary Detection Algorithm

After sorting by score, walk the list and compute the gap between adjacent entries as a percentage of the best score:

```
gap = (entry[i].score - entry[i-1].score) / entry[0].score
if gap > gapThreshold → mark entry[i] as neighborhood boundary
```

Only mark the FIRST boundary. This divides the list into two groups:
- **Within neighborhood** — similar placements (same resource, nearby times)
- **Outside neighborhood** — genuinely different (different resource, very different time)

Edge cases:
- If best score is 0, use absolute gap threshold (e.g., 0.5)
- If only 1 entry, no boundary
- If all entries have identical scores, no boundary

### File 2: `SolverState.ts`

A per-solve state container that holds the ranked contexts for every task.

```typescript
import { RankedScheduleContexts } from './RankedScheduleContexts';
import { HashMap } from '../Core/hashmap';

export class SolverState {
  private rankedByTask: HashMap<string, RankedScheduleContexts>;

  constructor() {
    this.rankedByTask = new HashMap<string, RankedScheduleContexts>();
  }

  public getRanked(taskKey: string): RankedScheduleContexts {
    let ranked = this.rankedByTask.get(taskKey);
    if (!ranked) {
      ranked = new RankedScheduleContexts(taskKey);
      this.rankedByTask.set(taskKey, ranked);
    }
    return ranked;
  }

  public clear(): void {
    this.rankedByTask.clear();
  }

  public allTaskKeys(): string[] {
    const keys: string[] = [];
    for (const k of this.rankedByTask.keys()) keys.push(k);
    return keys;
  }
}
```

## Unit Tests

Create: `tests/engine/ranked-contexts.test.ts`

### Test Helpers

Build a helper that creates `BestScheduleContext` objects with controlled scores:

```typescript
function makeBestContext(
  taskKey: string,
  resourceKeys: string[],
  score: number,
  startTime: number = 0
): BestScheduleContext {
  // Create minimal ScheduleContext with the given score
  // Set blendedScore.score = score
  // Set slot.resources with the given resourceKeys
  // Return wrapped in BestScheduleContext
}
```

### Test Cases

**1. Insertion maintains rank order**
```
Add contexts with scores [3.0, 1.0, 2.0, 1.5, 4.0]
Assert ranked order is [1.0, 1.5, 2.0, 3.0, 4.0]
Assert rank 0 = score 1.0
Assert rank 4 = score 4.0
```

**2. maxN enforced — worst entry dropped**
```
maxN = 3
Add 5 contexts with scores [5.0, 1.0, 3.0, 2.0, 4.0]
Assert count() = 3
Assert ranked scores are [1.0, 2.0, 3.0]
Scores 4.0 and 5.0 should be dropped
```

**3. best() returns rank 0**
```
Add contexts with scores [3.0, 1.0, 2.0]
Assert best().blendedScore.score = 1.0
```

**4. best() returns null when empty**
```
New RankedScheduleContexts
Assert best() = null
```

**5. alternative(rank) returns correct entry**
```
Add scores [1.0, 2.0, 3.0]
Assert alternative(0).score = 1.0
Assert alternative(1).score = 2.0
Assert alternative(2).score = 3.0
Assert alternative(3) = null
Assert alternative(-1) = null
```

**6. hasAlternatives**
```
Empty → false
1 entry → false
2 entries → true
5 entries → true
```

**7. Neighborhood boundary — clear gap**
```
gapThreshold = 0.15 (15%)
Add scores [1.0, 1.05, 1.10, 2.5, 3.0]
neighborhoodBoundary() = 3
withinNeighborhood() = entries with scores [1.0, 1.05, 1.10]
outsideNeighborhood() = entries with scores [2.5, 3.0]
```

**8. Neighborhood boundary — no gap**
```
gapThreshold = 0.15
Add scores [1.0, 1.05, 1.08, 1.12, 1.14]
neighborhoodBoundary() = 5 (equals length — all same neighborhood)
withinNeighborhood().length = 5
outsideNeighborhood().length = 0
```

**9. Neighborhood boundary — immediate gap**
```
gapThreshold = 0.15
Add scores [1.0, 5.0]
neighborhoodBoundary() = 1
withinNeighborhood() = [1.0]
outsideNeighborhood() = [5.0]
```

**10. Neighborhood boundary — all identical scores**
```
Add scores [2.0, 2.0, 2.0]
neighborhoodBoundary() = 3 (no boundary)
```

**11. Neighborhood boundary — best score is 0**
```
Add scores [0.0, 0.3, 0.4, 2.0]
Should not divide by zero
Should use absolute gap fallback
neighborhoodBoundary() should still detect the jump to 2.0
```

**12. removeByResourceKey**
```
Add: score 1.0 on [CNC-01], score 2.0 on [CNC-02], score 3.0 on [CNC-01, ASSY-01]
removeByResourceKey('CNC-01')
Assert count() = 1
Assert remaining entry has score 2.0
Assert ranks are recomputed (rank 0 = the surviving entry)
```

**13. clear()**
```
Add 3 entries
clear()
Assert count() = 0
Assert best() = null
```

**14. SolverState — getRanked creates on demand**
```
state = new SolverState()
ranked = state.getRanked('TASK-A')
Assert ranked is not null
Assert ranked.taskKey = 'TASK-A'
Assert same instance returned on second call
```

**15. SolverState — independent per task**
```
state.getRanked('TASK-A').addCandidate(... score 1.0 ...)
state.getRanked('TASK-B').addCandidate(... score 5.0 ...)
Assert state.getRanked('TASK-A').best().score = 1.0
Assert state.getRanked('TASK-B').best().score = 5.0
```

**16. Duplicate score handling**
```
Add scores [1.0, 1.0, 2.0]
Assert count() = 3
Assert rank 0 and rank 1 both have score 1.0
Both should be retrievable via alternative()
```

**17. Resource keys extracted correctly**
```
Add context where slot has resources CNC-01 + OPER-A
Assert ranked[0].resourceKeys = ['CNC-01', 'OPER-A']
```

## Integration Point

After this prompt is complete, the solver's main loop should be updated to populate `SolverState` during scoring. Where the solver currently picks the single best context and creates a `BestScheduleContext`, it should instead:

1. Create `BestScheduleContext` for ALL feasible scored contexts
2. Call `state.getRanked(task.key).addCandidate(bestCtx)` for each
3. Use `state.getRanked(task.key).best()` to get the winner

This integration will happen in the Balanced Strategy prompt (Prompt 3). For now, just build and test the data structures.

---

