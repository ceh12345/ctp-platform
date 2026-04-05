# Session 4 Spec: Scheduler Subclasses + Service Wiring

**Sprint:** Optimization Scheduler  
**New files:**
- `Engines/Optimization/perturbation.ts`
- `AI/Schedulers/tabusearchscheduler.ts`
- `AI/Schedulers/ilsscheduler.ts`

**Modified files:**
- `Models/Entities/appsettings.ts` — add 7 optional config fields
- `Models/Entities/solveresult.ts` — add `optimization?` block
- `ctp/ctp.service.ts` — add `createScheduler()` factory method

**Effort:** ~2h  
**Depends on:** Sessions 1–3 (DisjunctiveGraph, tabuSearch, applyOptimizedGraph, computeDiff)

---

## What This Session Does

Wire the optimization engine into the existing scheduler pipeline. Two new scheduler subclasses override `endScheduling()` to run optimization after the constructive solve. A perturbation module supports ILS multi-pass. Three existing files get small additive modifications for config, results, and strategy routing.

---

## File 1: `Engines/Optimization/perturbation.ts` (new)

Single export: `perturbGraph()`.

### `perturbGraph()`

```typescript
export function perturbGraph(graph: DisjunctiveGraph, strength: number): DisjunctiveGraph
```

Randomly reverses a fraction of non-frozen disjunctive arcs to escape the current basin of attraction between ILS passes.

**Algorithm:**

1. **Collect swappable arcs.** Walk every resource sequence. For each adjacent pair `(seq[i], seq[i+1])`, include it if neither node is frozen.

2. **Shuffle.** Use Fisher-Yates (not `.sort(() => Math.random() - 0.5)` — that's biased and O(n log n)). Fisher-Yates is unbiased and O(n).

3. **Pick a fraction.** `count = max(1, ceil(swappableArcs.length * strength))`. At 0.07 strength with 200 arcs → ~14 swaps per perturbation.

4. **Apply swaps with cycle guard.** For each selected arc:
   - **Validate the arc is still current.** A previous swap in this batch may have reordered this resource's sequence. Check that `nodeA` is still before `nodeB` in the sequence. If not, skip.
   - Call `graph.swapOnResource(...)`.
   - If `graph.hasCycle()`, immediately reverse.

5. **Recompute critical path once** at the end (not after each swap — the intermediate states don't need valid critical paths).

6. **Return the graph** (same reference, mutated).

**The graph is mutated.** Caller clones before calling: `perturbGraph(globalBest.clone(), strength)`.

**Stale arc validation (step 4) is important.** The sprint doc's pseudocode doesn't check this, but it's necessary for correctness. When arc X is swapped on resource R, it changes the sequence. If arc Y is also on resource R, the positions recorded when arcs were collected are now stale. Without validation, `swapOnResource` will throw because `posA >= posB`.

---

## File 2: `AI/Schedulers/tabusearchscheduler.ts` (new)

### `TabuSearchScheduler extends CTPScheduler`

```typescript
export class TabuSearchScheduler extends CTPScheduler {
  protected optimizationResult: { ... } | null = null;
  protected endScheduling(): void
  protected buildTabuConfig(): TabuConfig
  public getOptimizationResult(): { ... } | null
}
```

**`endScheduling()` — the optimization hook:**

1. Build graph: `DisjunctiveGraph.buildFromLandscape(this.landscape, freezeHorizon)`.
2. **Guard:** If `criticalPath` is null or `criticalTasks < 3`, return (not enough structure for meaningful optimization).
3. Snapshot original graph (for diff later): build a second graph from the same landscape.
4. Run `tabuSearch(graph, config, this.landscape.stateChanges)`.
5. If `result.bestMakespan < originalMakespan`:
   - Call `applyOptimizedGraph(result.bestGraph, this.landscape, ...)` to translate back.
   - Call `computeDiff(originalGraph, result.bestGraph)` for the diff.
   - Store everything in `this.optimizationResult`.

**`buildTabuConfig()`:**

```
tenure:          min(25, max(10, floor(sqrt(taskCount))))
maxIterations:   settings.tabuIterations   ?? 2000
stagnationLimit: settings.tabuStagnation   ?? 300
timeBudgetMs:    settings.tabuTimeBudgetMs ?? 30000
freezeHorizon:   settings.freezeHorizon    ?? 0
```

**`getOptimizationResult()`:** Public getter for the solve result builder to read optimization stats. Returns null if no optimization ran or no improvement found.

**`optimizationResult` shape:**

```typescript
{
  originalMakespan: number;
  optimizedMakespan: number;
  improvementPercent: number;
  iterations: number;
  movesEvaluated?: number;
  passes?: { pass: number; makespan: number; improvement: number; iterations: number }[];
  convergenceReason: string;
  tasksRescheduled: number;
  tasksFailed: number;
  diff: TaskDiff[];
}
```

**CC: check how `endScheduling()` is invoked.** The sprint doc says the constructive solve calls `endScheduling()` when all passes complete. Verify this hook exists in `CTPScheduler` (or `CTPBaseScheduler`) and that it's called at the right time. If it's currently a no-op method, overriding it is clean. If it doesn't exist, you'll need to add it to the base class (which is technically a modification — flag this).

**CC: check how `this.landscape`, `this.settings`, `this.scoring` are available.** The sprint doc assumes these are accessible as instance properties on CTPScheduler. Verify the property names and that they're populated by the time `endScheduling()` is called.

---

## File 3: `AI/Schedulers/ilsscheduler.ts` (new)

### `ILSScheduler extends TabuSearchScheduler`

```typescript
export class ILSScheduler extends TabuSearchScheduler {
  protected endScheduling(): void
}
```

Overrides `endScheduling()` completely (does not call `super.endScheduling()`). Runs multiple tabu passes with perturbation between passes.

**Algorithm:**

```
originalMakespan = graph.criticalPath.makespan
globalBest = graph.clone()
globalBestMakespan = originalMakespan

for pass = 0 to (passes - 1):
    if pass == 0:
        working = graph.clone()          // first pass: constructive solution
    else:
        working = perturbGraph(globalBest.clone(), perturbStrength)

    // Divide remaining time equally among remaining passes, floor 5s
    perPassBudget = max(5000, floor(remaining / (passes - pass)))
    config.timeBudgetMs = perPassBudget

    result = tabuSearch(working, config, stateChanges)
    record pass result

    if result.bestMakespan < globalBestMakespan:
        globalBestMakespan = result.bestMakespan
        globalBest = result.bestGraph

    if total time exceeded: break

if globalBestMakespan < originalMakespan:
    translate globalBest back to landscape
    store optimizationResult with passes array and convergenceReason 'ils_complete'
```

**Config defaults:**
- `passes`: `settings.ilsPasses ?? 5`
- `perturbStrength`: `settings.ilsPerturbStrength ?? 0.07`
- `totalBudgetMs`: `settings.ilsTimeBudgetMs ?? 300000` (5 min)

**Division-by-zero guard:** `improvementPercent` calc: if `originalMakespan === 0`, return `0`.

**`convergenceReason`** is always `'ils_complete'` for the ILS wrapper. Individual pass convergence reasons are captured in the `passResults` array.

**Total iterations** in the result is the sum across all passes: `passResults.reduce((s, p) => s + p.iterations, 0)`.

---

## Modification 1: `Models/Entities/appsettings.ts`

Add 7 optional fields to the `CTPAppSettings` interface/class:

```typescript
// Tabu search settings
tabuIterations?: number;         // Default: 2000
tabuStagnation?: number;         // Default: 300
tabuTimeBudgetMs?: number;       // Default: 30000 (30s for Thorough)
freezeHorizon?: number;          // Epoch seconds — don't move tasks before this

// ILS settings
ilsPasses?: number;              // Default: 5
ilsPerturbStrength?: number;     // Default: 0.07
ilsTimeBudgetMs?: number;        // Default: 300000 (5 min)
```

All optional with `?` — no defaults in the interface. Defaults are applied in `buildTabuConfig()` and `ILSScheduler.endScheduling()`.

**CC: determine whether `CTPAppSettings` is an interface or a class.** If it's a class, you may need to add these as properties with `undefined` default. If it's a DTO/interface, just add the optional fields.

---

## Modification 2: `Models/Entities/solveresult.ts`

Add an optional `optimization` block to `CTPSolveResult`:

```typescript
optimization?: {
  originalMakespan: number;
  optimizedMakespan: number;
  improvementPercent: number;
  iterations: number;
  movesEvaluated?: number;
  passes?: { pass: number; makespan: number; improvement: number; iterations: number }[];
  convergenceReason: string;
  tasksRescheduled: number;
  tasksFailed: number;
  diff: TaskDiff[];
};
```

Import `TaskDiff` from `../../Engines/Optimization/types`.

**CC: check where `CTPSolveResult` is populated.** After `endScheduling()` returns, the solve pipeline builds the result object. You need to wire `scheduler.getOptimizationResult()` into the result builder so the `optimization` field is populated. This may be in `ctp.service.ts` or in the scheduler's own result-building logic — find the right place and add:

```typescript
const optResult = scheduler.getOptimizationResult?.();
if (optResult) {
  solveResult.optimization = optResult;
}
```

---

## Modification 3: `ctp/ctp.service.ts`

Replace the direct `new CTPScheduler()` instantiation with a factory method:

```typescript
private createScheduler(strategy: string): CTPBaseScheduler {
  switch (strategy) {
    case 'Thorough':
      return new TabuSearchScheduler();
    case 'Best':
    case 'ILS':
      return new ILSScheduler();
    default:
      return new CTPScheduler();
  }
}
```

Add imports:
```typescript
import { TabuSearchScheduler } from '../AI/Schedulers/tabusearchscheduler';
import { ILSScheduler } from '../AI/Schedulers/ilsscheduler';
```

**CC: find the exact location** where `new CTPScheduler()` is called in the `solve()` method. Replace it with `this.createScheduler(strategy)`. The `strategy` value comes from the solve request — verify how it's passed in (likely `settings.strategy` or a parameter on the solve endpoint).

The existing interface (`initLandscape`, `initSettings`, `initScoring`, `schedule`) is identical across all three scheduler classes — no other changes needed.

---

## Behavioral Notes for CC

**`endScheduling()` is the only hook.** The optimization layer is entirely contained in the `endScheduling()` override. The constructive solve runs unchanged through the inherited `schedule()` method. If the optimization finds no improvement, the landscape is left as-is from the constructive solve.

**`new ScheduleEngine()` / `new StateChangeEngine()` — verify construction.** The sprint doc shows bare `new` calls. If these engines require constructor parameters (e.g., a logger, a config object), check the existing code and replicate the pattern.

**`buildTabuConfig()` is `protected`** so ILSScheduler can call it. ILSScheduler doesn't override it — it uses the same config with only `timeBudgetMs` modified per pass.

**The original graph snapshot must be taken BEFORE tabu search.** `tabuSearch()` mutates the graph. The sprint doc's code takes the snapshot after tabu search by rebuilding from the landscape — but at that point the landscape hasn't been modified yet (translation hasn't happened), so this is equivalent. My implementation takes the snapshot before tabu search for clarity, but either approach works.

**Fisher-Yates vs `.sort(random)`.** The sprint doc uses `.sort(() => Math.random() - 0.5)` for shuffling in `perturbGraph`. This is a known antipattern — it produces a biased distribution and is O(n log n). The implementation uses Fisher-Yates which is unbiased and O(n). This is a deliberate improvement over the sprint doc.

---

## Tests (Session 4 Verification)

1. **TabuSearchScheduler improves makespan.** Build a 50-task landscape, solve with `CTPScheduler`, record makespan. Solve again with `TabuSearchScheduler`. Verify `optimizationResult` exists and `optimizedMakespan <= originalMakespan`.

2. **ILSScheduler beats single pass.** Solve with `TabuSearchScheduler` (1 pass). Solve with `ILSScheduler` (3 passes). Verify ILS makespan ≤ tabu makespan (may be equal, but never worse since ILS includes the first pass).

3. **Strategy routing.** Call `createScheduler('Thorough')` → verify instance is `TabuSearchScheduler`. Call with `'Best'` → `ILSScheduler`. Call with `'ILS'` → `ILSScheduler`. Call with `'Standard'` → `CTPScheduler`. Call with `undefined`/default → `CTPScheduler`.

4. **Solve result includes optimization.** Run a Thorough solve. Verify `solveResult.optimization` is populated with `originalMakespan`, `optimizedMakespan`, `improvementPercent`, `iterations`, `convergenceReason`, `tasksRescheduled`, `diff`.

5. **Frozen tasks respected.** Set `freezeHorizon` to freeze half the tasks. Verify no frozen task appears in `optimization.diff`.

6. **Time budget termination.** Set `tabuTimeBudgetMs = 1000` (1 second). Verify tabu search terminates quickly and `convergenceReason` is `'time_budget'` or `'stagnation'`.

7. **ILS pass results.** Run ILS with 3 passes. Verify `optimization.passes` has 3 entries, each with `pass`, `makespan`, `improvement`, `iterations`.

8. **Perturbation doesn't corrupt.** Clone a graph, perturb the clone. Verify the original graph's `criticalPath.makespan` is unchanged. Verify the perturbed graph has no cycles (`hasCycle() === false`). Verify `recomputeCriticalPath()` succeeds on the perturbed graph.

9. **No optimization on trivial graph.** Build a landscape with 2 tasks (below the `criticalTasks < 3` guard). Verify `endScheduling()` returns without running tabu search and `optimizationResult` is null.
