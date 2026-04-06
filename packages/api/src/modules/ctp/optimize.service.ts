import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DisjunctiveGraph,
  SchedulingLandscape,
  ScheduleEngine,
  StateChangeEngine,
  tabuSearch,
  perturbGraph,
  applyOptimizedGraph,
  computeDiff,
  TabuConfig,
  TaskDiff,
} from '@ctp/engine';

// ═══════════════════════════════════════════════════════════════
//  Job Interfaces
// ═══════════════════════════════════════════════════════════════

export interface OptimizeJobConfig {
  timeBudgetSeconds: number;
  passes: number;
  perturbStrength: number;
  freezeHorizon?: string;        // ISO datetime — converted to epoch internally
}

export interface OptimizeJobProgress {
  currentPass: number;
  totalPasses: number;
  bestMakespanSoFar: number;
  improvementPercent: number;
  elapsedSeconds: number;
}

export interface OptimizationResult {
  originalMakespan: number;
  optimizedMakespan: number;
  improvementPercent: number;
  iterations: number;
  movesEvaluated: number;
  passes: { pass: number; makespan: number; improvement: number; iterations: number }[];
  convergenceReason: string;
  tasksRescheduled: number;
  tasksFailed: number;
  diff: TaskDiff[];
  elapsedMs: number;
}

export interface OptimizeJob {
  jobId: string;
  tenantId: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  config: OptimizeJobConfig;
  progress?: OptimizeJobProgress;
  result?: OptimizationResult;
  /** Best graph found — held until accept/reject. Applied to live landscape on accept. */
  bestGraph?: DisjunctiveGraph;
  /** Original graph snapshot — used to compute diff on accept. */
  originalGraph?: DisjunctiveGraph;
  /** Hash of the landscape when the job was started — used to detect drift. */
  landscapeHashAtStart: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
//  Optimize Service
// ═══════════════════════════════════════════════════════════════

@Injectable()
export class OptimizeService {
  /** In-memory job store. Production: replace with Redis or Azure Service Bus. */
  private jobs = new Map<string, OptimizeJob>();

  // ─── Job Lifecycle ───

  /**
   * Create and start a background optimization job.
   * Returns the jobId immediately — caller polls for progress.
   *
   * Settings are read from landscape.appSettings so the optimization
   * runs with the same config as the constructive solve.
   *
   * @param tenantId           Tenant identifier for concurrency guard.
   * @param landscape          The current live landscape (graph built from it; not mutated).
   * @param landscapeHash      Hash of the landscape at job start — used for drift detection.
   * @param config             Job-level config (time budget, passes, etc.).
   * @returns                  The jobId.
   * @throws                   If a job is already running for this tenant.
   */
  startJob(
    tenantId: string,
    landscape: SchedulingLandscape,
    landscapeHash: string,
    config: OptimizeJobConfig,
  ): string {
    // ─── Concurrency guard: one job per tenant ───
    for (const [, job] of this.jobs) {
      if (job.tenantId === tenantId && (job.status === 'queued' || job.status === 'running')) {
        throw new Error(`Optimization job already running for tenant ${tenantId}: ${job.jobId}`);
      }
    }

    const jobId = randomUUID();
    const job: OptimizeJob = {
      jobId,
      tenantId,
      status: 'queued',
      startedAt: new Date(),
      config,
      landscapeHashAtStart: landscapeHash,
    };

    this.jobs.set(jobId, job);

    // ─── Launch async execution ───
    // setImmediate avoids blocking the current request — optimization runs on next tick.
    // The graph is built from the live landscape (read-only); the live landscape is never mutated.
    setImmediate(() => {
      this.executeJob(job, landscape).catch(err => {
        job.status = 'failed';
        job.completedAt = new Date();
        job.error = err?.message ?? 'Unknown error';
      });
    });

    return jobId;
  }

  /** Get job status and results. Returns null if not found. */
  getJob(jobId: string): OptimizeJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Accept the optimization result — apply the stored best graph to the live landscape.
   *
   * Translation happens at accept time (not at job completion), so the live landscape
   * is never held in memory as a snapshot. The tradeoff: accept takes 500ms–2s at
   * large task counts, which is fine for a deliberate planner action.
   *
   * @param jobId              The job to accept.
   * @param liveLandscape      The current live landscape reference.
   * @param currentHash        Current hash of the live landscape (drift check).
   * @returns                  The optimization result, or null if job not found / not complete.
   * @throws                   If the landscape has changed since the job started.
   */
  acceptJob(
    jobId: string,
    liveLandscape: SchedulingLandscape,
    currentHash: string,
  ): OptimizationResult | null {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'complete' || !job.bestGraph) return null;

    // ─── Drift guard ───
    if (currentHash !== job.landscapeHashAtStart) {
      throw new Error(
        'Schedule has changed since optimization started — re-run optimization to get accurate results.',
      );
    }

    // ─── Translate optimized graph into live landscape ───
    const translation = applyOptimizedGraph(
      job.bestGraph,
      liveLandscape,
      new ScheduleEngine(),
      new StateChangeEngine(),
      liveLandscape.appSettings!,
    );

    // Build result with final translation counts
    const result: OptimizationResult = {
      ...job.result!,
      diff: job.originalGraph ? computeDiff(job.originalGraph, job.bestGraph) : [],
      tasksRescheduled: translation.tasksRescheduled,
      tasksFailed: translation.tasksFailed,
    };

    // Release stored graphs — snapshot no longer needed
    job.bestGraph = undefined;
    job.originalGraph = undefined;

    return result;
  }

  /**
   * Reject the optimization result — discard the stored graph, keep the original schedule.
   * @returns true if the job was found, false otherwise.
   */
  rejectJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.bestGraph = undefined;
    job.originalGraph = undefined;
    return true;
  }

  /** List jobs for a tenant. Optionally filter by status. */
  listJobs(tenantId: string, status?: OptimizeJob['status']): OptimizeJob[] {
    const results: OptimizeJob[] = [];
    for (const [, job] of this.jobs) {
      if (job.tenantId !== tenantId) continue;
      if (status && job.status !== status) continue;
      results.push(job);
    }
    return results;
  }

  /**
   * Remove completed/failed jobs older than maxAgeMs (default 24h).
   * Call at the start of startJob() to prevent unbounded memory growth.
   */
  cleanupJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;
    for (const [jobId, job] of this.jobs) {
      if (
        (job.status === 'complete' || job.status === 'failed') &&
        job.completedAt &&
        now - job.completedAt.getTime() > maxAgeMs
      ) {
        this.jobs.delete(jobId);
        removed++;
      }
    }
    return removed;
  }

  // ─── Async Execution ───

  /**
   * Run the ILS optimization in the background.
   * Updates job.progress as passes complete so the poll endpoint can report status.
   * The live landscape is never mutated — the graph is built from it read-only.
   */
  private async executeJob(
    job: OptimizeJob,
    landscape: SchedulingLandscape,
  ): Promise<void> {
    job.status = 'running';
    const startMs = Date.now();

    const settings = landscape.appSettings;
    const freezeHorizon = job.config.freezeHorizon
      ? Math.floor(new Date(job.config.freezeHorizon).getTime() / 1000)
      : settings?.freezeHorizon ?? 0;

    // Build graph from the landscape (read-only — graph is a separate data structure)
    const graph = DisjunctiveGraph.buildFromLandscape(landscape, freezeHorizon);

    if (!graph.criticalPath || graph.criticalPath.criticalTasks < 3) {
      job.status = 'complete';
      job.completedAt = new Date();
      job.result = {
        originalMakespan: graph.criticalPath?.makespan ?? 0,
        optimizedMakespan: graph.criticalPath?.makespan ?? 0,
        improvementPercent: 0,
        iterations: 0,
        movesEvaluated: 0,
        passes: [],
        convergenceReason: 'insufficient_critical_tasks',
        tasksRescheduled: 0,
        tasksFailed: 0,
        diff: [],
        elapsedMs: Date.now() - startMs,
      };
      return;
    }

    const originalMakespan = graph.criticalPath.makespan;
    const originalGraph = graph.clone();

    const taskCount = graph.nodes.length;
    const tabuConfig: TabuConfig = {
      tenure: Math.min(25, Math.max(10, Math.floor(Math.sqrt(taskCount)))),
      maxIterations: settings?.tabuIterations ?? 2000,
      stagnationLimit: settings?.tabuStagnation ?? 300,
      timeBudgetMs: 0, // set per-pass below
      freezeHorizon,
    };

    const totalPasses = job.config.passes;
    const totalBudgetMs = job.config.timeBudgetSeconds * 1000;
    const perturbStrength = job.config.perturbStrength ?? settings?.ilsPerturbStrength ?? 0.07;

    let globalBest = graph.clone();
    let globalBestMakespan = originalMakespan;
    const passResults: { pass: number; makespan: number; improvement: number; iterations: number }[] = [];
    let totalMovesEvaluated = 0;

    for (let pass = 0; pass < totalPasses; pass++) {
      const elapsed = Date.now() - startMs;
      const remaining = totalBudgetMs - elapsed;
      if (remaining <= 0) break;

      // Per-pass budget — divide remaining equally, minimum 5s
      tabuConfig.timeBudgetMs = Math.max(5000, Math.floor(remaining / (totalPasses - pass)));

      // Pass 0: search from original; passes 1+: perturb the current best
      const working = (pass === 0)
        ? graph.clone()
        : perturbGraph(globalBest.clone(), perturbStrength);

      // Yield to event loop before each pass so HTTP polls can be served
      await this.yieldToEventLoop();

      const result = tabuSearch(working, tabuConfig, landscape.stateChanges);
      totalMovesEvaluated += result.totalMovesEvaluated;

      passResults.push({
        pass: pass + 1,
        makespan: result.bestMakespan,
        improvement: originalMakespan > 0
          ? ((originalMakespan - result.bestMakespan) / originalMakespan) * 100
          : 0,
        iterations: result.totalIterations,
      });

      if (result.bestMakespan < globalBestMakespan) {
        globalBestMakespan = result.bestMakespan;
        globalBest = result.bestGraph;
      }

      job.progress = {
        currentPass: pass + 1,
        totalPasses,
        bestMakespanSoFar: globalBestMakespan,
        improvementPercent: originalMakespan > 0
          ? ((originalMakespan - globalBestMakespan) / originalMakespan) * 100
          : 0,
        elapsedSeconds: Math.round((Date.now() - startMs) / 1000),
      };

      if (Date.now() - startMs > totalBudgetMs) break;
    }

    const elapsedMs = Date.now() - startMs;

    if (globalBestMakespan < originalMakespan) {
      // Store best graph — translation happens at accept time, not here.
      // This keeps memory usage low (graph ~10KB) vs a full landscape clone (~10MB+).
      job.bestGraph = globalBest;
      job.originalGraph = originalGraph;

      job.result = {
        originalMakespan,
        optimizedMakespan: globalBestMakespan,
        improvementPercent: originalMakespan > 0
          ? ((originalMakespan - globalBestMakespan) / originalMakespan) * 100
          : 0,
        iterations: passResults.reduce((s, p) => s + p.iterations, 0),
        movesEvaluated: totalMovesEvaluated,
        passes: passResults,
        convergenceReason: 'ils_complete',
        tasksRescheduled: 0,   // filled in at accept time
        tasksFailed: 0,        // filled in at accept time
        diff: [],              // filled in at accept time
        elapsedMs,
      };
    } else {
      job.result = {
        originalMakespan,
        optimizedMakespan: originalMakespan,
        improvementPercent: 0,
        iterations: passResults.reduce((s, p) => s + p.iterations, 0),
        movesEvaluated: totalMovesEvaluated,
        passes: passResults,
        convergenceReason: 'no_improvement',
        tasksRescheduled: 0,
        tasksFailed: 0,
        diff: [],
        elapsedMs,
      };
    }

    job.status = 'complete';
    job.completedAt = new Date();
  }

  // ─── Helpers ───

  /** Yield to the event loop so HTTP polls can be served between passes. */
  private yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
  }
}
