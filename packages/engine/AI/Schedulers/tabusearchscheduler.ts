import { CTPScheduler } from './defaultscheduler';
import { DisjunctiveGraph } from '../../Engines/Optimization/disjunctivegraph';
import { tabuSearch } from '../../Engines/Optimization/tabusearch';
import { TabuConfig, TaskDiff } from '../../Engines/Optimization/types';
import { applyOptimizedGraph, computeDiff } from '../../Engines/Optimization/graphtranslation';
import { ScheduleEngine } from '../../Engines/scheduleengine';
import { StateChangeEngine } from '../../Engines/statechangeerengine';

// ═══════════════════════════════════════════════════════════════
//  TabuSearchScheduler
// ═══════════════════════════════════════════════════════════════

/**
 * Scheduler that runs a single tabu search pass after the constructive solve.
 * Used for the "Thorough" strategy (5–30s optimization).
 *
 * Inherits from CTPScheduler and overrides endScheduling() to hook the optimization
 * layer into the existing solve pipeline. The constructive solve runs unchanged via
 * the inherited schedule() method; endScheduling() is called after all passes complete.
 */
export class TabuSearchScheduler extends CTPScheduler {

  /** Set whenever tabu ran, regardless of whether improvement was found. */
  protected optimizationRan: { iterations: number; movesEvaluated?: number; elapsedMs: number; convergenceReason: string } | null = null;

  /** Optimization stats — populated only if improvement was found. */
  protected optimizationResult: {
    originalMakespan: number;
    optimizedMakespan: number;
    improvementPercent: number;
    iterations: number;
    movesEvaluated?: number;
    elapsedMs: number;
    passes?: { pass: number; makespan: number; improvement: number; iterations: number }[];
    convergenceReason: string;
    tasksRescheduled: number;
    tasksFailed: number;
    diff: TaskDiff[];
  } | null = null;

  /**
   * Called after the constructive solve completes.
   * Builds a disjunctive graph, runs tabu search, and translates improvements back.
   */
  protected endScheduling(): void {
    const freezeHorizon = this.settings?.freezeHorizon ?? 0;
    const graph = DisjunctiveGraph.buildFromLandscape(this.landscape, freezeHorizon);

    // Guard: need enough critical-path tasks to form meaningful neighborhoods
    if (!graph.criticalPath || graph.criticalPath.criticalTasks < 3) return;

    const config = this.buildTabuConfig();
    const originalMakespan = graph.criticalPath.makespan;

    // Snapshot the original graph BEFORE tabu search mutates it
    const originalGraph = DisjunctiveGraph.buildFromLandscape(this.landscape, freezeHorizon);

    // Run tabu search (mutates `graph`)
    const tabuStartMs = Date.now();
    const result = tabuSearch(graph, config, this.landscape.stateChanges);
    const elapsedMs = Date.now() - tabuStartMs;

    // Always record that tabu ran (shown in UI even when no improvement found)
    this.optimizationRan = {
      iterations: result.totalIterations,
      movesEvaluated: result.totalMovesEvaluated,
      elapsedMs,
      convergenceReason: result.convergenceReason,
    };

    // Only translate if we found an improvement
    if (result.bestMakespan < originalMakespan) {
      const translation = applyOptimizedGraph(
        result.bestGraph,
        this.landscape,
        new ScheduleEngine(),
        new StateChangeEngine(),
        this.settings!,
      );

      this.optimizationResult = {
        originalMakespan,
        optimizedMakespan: result.bestMakespan,
        improvementPercent: result.improvementPercent,
        iterations: result.totalIterations,
        movesEvaluated: result.totalMovesEvaluated,
        elapsedMs,
        convergenceReason: result.convergenceReason,
        tasksRescheduled: translation.tasksRescheduled,
        tasksFailed: translation.tasksFailed,
        diff: computeDiff(originalGraph, result.bestGraph),
      };
    }
  }

  /**
   * Build tabu search configuration from app settings with sensible defaults.
   * Tenure is sqrt(taskCount) clamped to [10, 25].
   */
  protected buildTabuConfig(): TabuConfig {
    const taskCount = this.landscape.tasks.size();
    return {
      tenure: Math.min(25, Math.max(10, Math.floor(Math.sqrt(taskCount)))),
      maxIterations: this.settings?.tabuIterations ?? 2000,
      stagnationLimit: this.settings?.tabuStagnation ?? 300,
      timeBudgetMs: this.settings?.tabuTimeBudgetMs ?? 30000,
      freezeHorizon: this.settings?.freezeHorizon ?? 0,
    };
  }

  /**
   * Return optimization stats for inclusion in the solve result.
   * Returns null if no optimization was run or no improvement was found.
   */
  public getOptimizationResult() {
    return this.optimizationResult;
  }

  public getOptimizationRan() {
    return this.optimizationRan;
  }
}
