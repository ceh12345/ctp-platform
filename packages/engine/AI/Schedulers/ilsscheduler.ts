import { TabuSearchScheduler } from './tabusearchscheduler';
import { DisjunctiveGraph } from '../../Engines/Optimization/disjunctivegraph';
import { tabuSearch } from '../../Engines/Optimization/tabusearch';
import { perturbGraph } from '../../Engines/Optimization/perturbation';
import { applyOptimizedGraph, computeDiff } from '../../Engines/Optimization/graphtranslation';
import { ScheduleEngine } from '../../Engines/scheduleengine';
import { StateChangeEngine } from '../../Engines/statechangeerengine';

// ═══════════════════════════════════════════════════════════════
//  ILSScheduler (Iterated Local Search)
// ═══════════════════════════════════════════════════════════════

/**
 * Scheduler that runs multiple tabu search passes with perturbation between passes.
 * Used for the "Best" / "ILS" strategy (minutes to hours of optimization).
 *
 * Algorithm:
 *  Pass 0: tabu search on the constructive solution (no perturbation).
 *  Pass 1+: clone the global best → perturb → tabu search → accept if improved.
 *
 * Each pass gets an equal share of the remaining time budget, with a 5s floor.
 * The global best graph is cloned before perturbation, so a bad perturbation
 * doesn't corrupt the best-known solution.
 */
export class ILSScheduler extends TabuSearchScheduler {

  protected endScheduling(): void {
    const freezeHorizon = this.settings?.freezeHorizon ?? 0;
    const graph = DisjunctiveGraph.buildFromLandscape(this.landscape, freezeHorizon);

    // Guard: need enough critical-path tasks to form meaningful neighborhoods
    if (!graph.criticalPath || graph.criticalPath.criticalTasks < 3) return;

    const config = this.buildTabuConfig();
    const passes = this.settings?.ilsPasses ?? 5;
    const perturbStrength = this.settings?.ilsPerturbStrength ?? 0.07;
    const totalBudgetMs = this.settings?.ilsTimeBudgetMs ?? 300000; // 5 min default
    const startMs = Date.now();

    const originalMakespan = graph.criticalPath.makespan;
    let globalBest = graph.clone();
    let globalBestMakespan = originalMakespan;
    // Objective-aware acceptance: lexicographic (tardiness, makespan) when
    // the weightedTardiness objective is active (tabuSearch supplies the
    // tardiness slots; null means makespan-only).
    let globalBestTardiness: number | null = null;
    let globalInitialized = false;
    let improvedAny = false;
    const betterPair = (tA: number | null, mA: number, tB: number | null, mB: number): boolean => {
      if (tA !== null && tB !== null && tA !== tB) return tA < tB;
      return mA < mB;
    };

    const passResults: {
      pass: number;
      makespan: number;
      improvement: number;
      iterations: number;
    }[] = [];

    // Snapshot original graph for diff computation (before any mutation)
    const originalGraph = DisjunctiveGraph.buildFromLandscape(this.landscape, freezeHorizon);

    for (let pass = 0; pass < passes; pass++) {
      // Pass 0: start from constructive solution.
      // Pass 1+: perturb a clone of the global best to escape the current basin.
      const working = (pass === 0)
        ? graph.clone()
        : perturbGraph(globalBest.clone(), perturbStrength);

      // Allocate per-pass time budget from remaining time
      const elapsed = Date.now() - startMs;
      const remaining = totalBudgetMs - elapsed;
      if (remaining <= 0) break;

      config.timeBudgetMs = Math.max(5000, Math.floor(remaining / (passes - pass)));

      // Run tabu search on the working graph
      const result = tabuSearch(working, config, this.landscape.stateChanges);

      passResults.push({
        pass: pass + 1,
        makespan: result.bestMakespan,
        improvement: originalMakespan > 0
          ? ((originalMakespan - result.bestMakespan) / originalMakespan) * 100
          : 0,
        iterations: result.totalIterations,
      });

      // Accept if this pass found a new global best (active objective)
      if (!globalInitialized) {
        globalBestTardiness = result.originalTardiness;
        globalInitialized = true;
      }
      if (betterPair(result.bestTardiness, result.bestMakespan,
                     globalBestTardiness, globalBestMakespan)) {
        globalBestMakespan = result.bestMakespan;
        globalBestTardiness = result.bestTardiness;
        globalBest = result.bestGraph;
        improvedAny = true;
      }

      if (Date.now() - startMs > totalBudgetMs) break;
    }

    const elapsedMs = Date.now() - startMs;

    // Translate back if we found any improvement across all passes
    if (improvedAny || globalBestMakespan < originalMakespan) {
      const translation = applyOptimizedGraph(
        globalBest,
        this.landscape,
        new ScheduleEngine(),
        new StateChangeEngine(),
        this.settings!,
      );

      this.optimizationResult = {
        originalMakespan,
        optimizedMakespan: globalBestMakespan,
        improvementPercent: originalMakespan > 0
          ? ((originalMakespan - globalBestMakespan) / originalMakespan) * 100
          : 0,
        iterations: passResults.reduce((sum, p) => sum + p.iterations, 0),
        elapsedMs,
        passes: passResults,
        convergenceReason: 'ils_complete',
        tasksRescheduled: translation.tasksRescheduled,
        tasksFailed: translation.tasksFailed,
        diff: computeDiff(originalGraph, globalBest),
      };
    }
  }
}
