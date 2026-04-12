import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import {
  CTPScheduler,
  TabuSearchScheduler,
  ILSScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  CTPDateTime,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  CTPWipStateConstants,
  CTPResourceModeConstants,
  SolveStatistics,
  List,
  CTPTask,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPProcess,
  CTPLinkId,
  CTPDuration,
  SchedulingLandscape,
  ScheduleEvaluator,
  ScheduleContexts,
  ChainContextEngine,
  WhereToConstraints,
  WhereToResult,
  BestScheduleContext,
  ScheduleEngine,
  CTPStartTime,
  CTPSolveResult as EngineSolveResult,
  CTPInterval,
  CTPAssignments,
  CTPResourcePreference,
  CTPAssignment,
  CTPAssignmentConstants,
  DisjunctiveGraph,
  BulkUnscheduleResult,
  BulkScheduleResult,
} from '@ctp/engine';
import { ErrorCodes } from '../../common/error-codes';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';
import { StrategyConfigService } from '../../config/strategy-config.service';
import { LoggerService } from '../../logging/logger.service';
import { SolveRequestDto } from './dto/solve-request.dto';
import {
  DiagnoseRequestDto, DiagnoseResponse, TaskDiagnosis, RootCause,
  Recommendation, RecommendationCommand, BlockingTaskSummary,
  ApplyRecommendationRequestDto, ApplyRecommendationResponse,
  ExecuteCommandsRequestDto,
} from './dto/diagnose.dto';
import { ScheduleConfigurationService } from '../../config/schedule-configuration.service';
import { WhereToRequestDto, WhereToResponseDto, MoveToRequestDto, MoveToResponseDto } from './dto/whereto.dto';
import { CTPQueryDto, CTPQueryResponse, CTPQueryOption, CTPQuerySummary, ChainTemplatesResponse } from './dto/ctp-query.dto';

export interface TaskSnapshot {
  key: string;
  state: number;
  priority: number;
  originalPriority: number;
  pinned: boolean;
  includeInSolve: boolean;
  score: number;
  windowStartW: number;
  windowEndW: number;
  windowOrigStartW: number;
  windowOrigEndW: number;
  scheduledStartW: number | null;
  scheduledEndW: number | null;
  resourceAssignments: { index: number; scheduledResource: string | null }[];
  errors: { agent: string; reason: string }[];
}

export interface CTPSolveResult {
  status: string;
  summary: {
    totalTasks: number;
    includedTasks: number;
    scheduledTasks: number;
    unscheduledTasks: number;
    skippedTasks: number;
    feasibilityRate: number;
    horizonStart: string;
    horizonEnd: string;
    makespan: number;
    setupTasks?: number;
    pinnedTasks?: number;
    excludedTasks?: number;
  };
  stats?: {
    strategy: string;
    totalTimeMs: number;
    propagationTimeMs?: number;
    windowsTightened?: number;
    backtrackAttempts?: number;
    backtrackSuccesses?: number;
    bumpsPerformed?: number;
    iterations?: number;
    bestIterationFound?: number;
    contextsEvaluated?: number;
    contextsPerTask?: number;
    totalScore?: number;
    scoreBreakdown?: Record<string, number>;
  };
  tasks: any[];
  resourceUtilization: any[];
  orders: any[];
  materials: any[];
  products?: any[];
  colors?: any;
  terminology?: Record<string, string>;
  locale?: any;
  scoring?: {
    source: string;
    rules: {
      ruleName: string;
      weight: number;
      objective: number;
      includeInSolve: boolean;
      penaltyFactor: number;
    }[];
  };
  solveResult?: EngineSolveResult;
  solveSteps?: any[];
  criticalPath?: {
    taskKeys: string[];
    makespan: number;
    makespanFormatted: string;
    bottleneckResource: { resourceKey: string; resourceName: string; totalCriticalTime: number; percentOfCriticalPath: number };
    criticalTasks: number;
    totalTasks: number;
    avgSlack: number;
    nearCriticalTasks: number;
    segments: { resourceKey: string; resourceName: string; taskKeys: string[]; totalDuration: number }[];
  };
}

@Injectable()
export class CTPService {
  private results = new Map<string, CTPSolveResult>();

  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
    private readonly strategyConfigService: StrategyConfigService,
    private readonly logger: LoggerService,
    private readonly scheduleConfigService: ScheduleConfigurationService,
  ) {}

  // ═══════════════════════════════════════
  // Endpoint 1: Solve with Overrides
  // ═══════════════════════════════════════

  solve(request?: SolveRequestDto): CTPSolveResult {
    const startTime = Date.now();

    // Only reload from config if NOT preserving landscape state
    if (!request?.preserveLandscape) {
      this.stateService.syncFromConfig();
    }

    const landscape = this.ensureLandscape();

    // Hydrate due dates from orders onto tasks (terminal tasks only)
    landscape.hydrateDueDates();

    // Apply commitment stack — derive levels, enforce pinning for layers 1-4
    this.applyCommitmentStack(landscape);

    // Resolve horizon — always fresh so rolling 'NOW' configs stay current
    const horizonConfig = this.configService.getHorizon();
    const timezone = this.configService.getLocale()?.timezone || 'UTC';
    const horizonStart = this.resolveHorizonStart(horizonConfig?.start || 'NOW', timezone);
    const maxDays = horizonConfig?.maxDays ?? 14;
    const horizonEnd = horizonStart.plus({ days: maxDays });
    landscape.horizon.set(horizonStart, horizonEnd);

    // Bucket uncommitted tasks by horizon position.
    // Use horizonStartW (not now) as the "past due" reference — a task is past due
    // if its window expired before the planning horizon opens. This works correctly
    // for both rolling ('NOW') and fixed-date horizons: for 'NOW' horizons,
    // horizonStart ≈ today; for fixed-date horizons, horizonStart is the config date.
    const horizonStartW = landscape.horizon.startW;
    const pastDueExtensionDays = Math.max(1, horizonConfig?.pastDueExtensionDays ?? 5);
    const extensionEndW = horizonStartW + (pastDueExtensionDays * 86400);
    landscape.tasks?.forEach(task => {
      if (['running', 'on_hold', 'dispatched', 'pinned', 'completed'].includes(task.commitmentLevel)) {
        task.horizonBucket = 'active';
        return;
      }
      const bucket = this.bucketTask(task, landscape.horizon.startW, landscape.horizon.endW, horizonStartW);
      task.horizonBucket = bucket;
      if (bucket === 'past_due') {
        if (!task.originalWindowEnd) {
          task.originalWindowEnd = task.window?.endW ?? 0;
        }
        if (task.window) {
          task.window.endW = Math.max(task.window.endW, extensionEndW);
        }
        task.isPastDue = true;
        task.pastDueDays = Math.ceil((horizonStartW - task.originalWindowEnd) / 86400);
      } else if (bucket === 'beyond') {
        task.includeInSolve = false;
      } else {
        task.isPastDue = false;
        task.pastDueDays = 0;
      }
    });

    // Unschedule all planned (uncommitted) tasks — put them back in the pool.
    // This runs on every solve so the solver always re-places planned work
    // around committed tasks, downtimes, and any other resource state changes.
    // unscheduleTask() is a no-op for committed (pinned) tasks, so they are safe.
    // Generated SETUP/TEARDOWN tasks are also planned, so their assignments
    // are cleared here too — no orphaned changeover blocks remain.
    landscape.tasks?.forEach(task => {
      if (task.commitmentLevel === 'planned') {
        landscape.unscheduleTask(task.key, true);
        task.commitmentLevel = 'unscheduled';
      }
    });

    // Resolve configuration for strategy if configurationKey provided
    const configForStrategy = request?.configurationKey
      ? this.scheduleConfigService.resolveForSolve(request.configurationKey)
      : null;
    const requestedStrategy = request?.strategy || configForStrategy?.strategy || landscape.appSettings?.solverStrategy || 'Chain';

    // Validate strategy key against tenant config
    if (request?.strategy && !this.strategyConfigService.validateStrategy(request.strategy)) {
      const available = this.strategyConfigService.getStrategiesForTenant()
        .strategies.map(s => s.key).join(', ');
      throw new HttpException({ error: { code: ErrorCodes.INVALID_STRATEGY, message: `Invalid strategy '${request.strategy}'. Available: ${available}`, category: 'validation' } }, HttpStatus.BAD_REQUEST);
    }

    // Map to engine strategy (handles custom strategy → engine handler mapping)
    const strategy = this.strategyConfigService.getEngineStrategy(requestedStrategy);
    // Tier controls optimization depth: thorough→TabuSearch, best→ILS, else→constructive only
    const tier = request?.tier || configForStrategy?.tier || 'balanced';
    const stats = new SolveStatistics(strategy);

    // ─── 1. Apply overrides in order ───

    // 1a. Unschedules first — free up capacity
    if (request?.taskUnschedules) {
      for (const taskKey of request.taskUnschedules) {
        landscape.unscheduleTask(taskKey, true);
      }
    }

    // 1b. Order modes (INCLUDE / EXCLUDE / LOCKED)
    if (request?.orderModes) {
      landscape.applyOrderModes(request.orderModes);
    }

    // 1c. Task-level pins
    if (request?.taskPins) {
      landscape.applyTaskPins(request.taskPins);
    }

    // 1d. Task-level excludes
    if (request?.taskExcludes) {
      landscape.applyTaskExcludes(request.taskExcludes);
    }

    // 1e. Resource mode overrides
    if (request?.resourceModes) {
      landscape.applyResourceModes(request.resourceModes);
    }

    // 1f. Material mode overrides (applies to all task-material relationships)
    if (request?.materialModes) {
      this.applyMaterialModes(landscape, request.materialModes);
    }

    // 1g. Per-task resource preference overrides (REQUIRED/PREFERRED/AVAILABLE/EXCLUDED)
    if (request?.resourcePreferenceOverrides) {
      landscape.applyResourcePreferenceOverrides(request.resourcePreferenceOverrides);
    }

    // 1h. Per-task priority overrides
    if (request?.priorityOverrides) {
      for (const [key, pri] of Object.entries(request.priorityOverrides)) {
        const t = landscape.tasks?.getEntity(key);
        if (t) t.priority = pri;
      }
    }

    // 1i. Per-task window overrides
    if (request?.windowOverrides) {
      for (const [key, win] of Object.entries(request.windowOverrides)) {
        const t = landscape.tasks?.getEntity(key);
        if (t) {
          const sw = win.startW ? CTPDateTime.fromDateTime(win.startW) : undefined;
          const ew = win.endW ? CTPDateTime.fromDateTime(win.endW) : undefined;
          if (sw !== undefined || ew !== undefined) {
            if (!t.window) {
              t.window = new CTPInterval(
                sw ?? landscape.horizon.startW,
                ew ?? landscape.horizon.endW,
                1,
              );
            }
            if (sw !== undefined) { t.window.startW = sw; t.window.origStartW = sw; }
            if (ew !== undefined) { t.window.endW = ew; t.window.origEndW = ew; }
          }
        }
      }
    }

    // ─── 1j. Expand chains + protect others ───
    let effectiveTaskKeys = request?.taskKeys;
    if (effectiveTaskKeys && request?.expandChains !== false) {
      effectiveTaskKeys = this.expandToChains(effectiveTaskKeys, landscape);
    }

    if (request?.protectOthers && effectiveTaskKeys) {
      const targetSet = new Set(effectiveTaskKeys);
      landscape.tasks.forEach(task => {
        if (!targetSet.has(task.key) &&
            task.state === CTPTaskStateConstants.SCHEDULED &&
            !task.pinned &&
            task.includeInSolve) {
          task.pinned = true;
          task.includeInSolve = false;
          task._tempPinned = true;
        }
      });
    }

    // ─── 2. Constraint propagation ───
    const propStart = Date.now();
    stats.windowsTightened = landscape.propagateConstraints();
    stats.propagationTimeMs = Date.now() - propStart;

    // ─── 3. Build scoring (resolve from configuration if provided) ───
    const resolvedConfig = request?.configurationKey
      ? this.scheduleConfigService.resolveForSolve(request.configurationKey)
      : null;
    const scoringSource = request?.scoringOverrides ? 'override' : resolvedConfig ? 'configuration' : 'config';
    const scoringRules = request?.scoringOverrides
      ?? resolvedConfig?.scoring
      ?? this.configService.getScoring()?.rules;
    if (!scoringRules || scoringRules.length === 0) {
      throw new HttpException({ error: { code: ErrorCodes.SCORING_CONFIG_MISSING, message: 'Scoring configuration not found.', category: 'config' } }, HttpStatus.BAD_REQUEST);
    }

    const scoring = new CTPScoring('Scoring', 'scoring');
    for (const rule of scoringRules) {
      const config = new CTPScoringConfiguration(
        rule.ruleName,
        rule.weight,
        rule.objective,
      );
      config.includeInSolve = rule.includeInSolve;
      config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }

    // ─── 4. Run solver ───
    const scheduler = this.createScheduler(strategy, tier);
    scheduler.initLandscape(
      landscape.horizon,
      landscape.tasks,
      landscape.resources,
      landscape.stateChanges,
      landscape.processes,
    );
    // Pass requested strategy to the engine via appSettings
    if (landscape.appSettings) {
      landscape.appSettings.solverStrategy = strategy;
      if (request?.recordSolveSteps) {
        landscape.appSettings.recordSolveSteps = true;
      }
    }
    scheduler.initSettings(landscape.appSettings);
    scheduler.initScoring(scoring);

    const taskList = this.buildTaskList(landscape, request, effectiveTaskKeys);

    let engineSolveResult: EngineSolveResult | undefined;
    try {
      // Always run the scheduler — Pass 1 (anchor committed tasks) must execute
      // even when the task list is empty so committed capacity is consumed.
      engineSolveResult = scheduler.schedule(taskList);
    } finally {
      // Always clean up temp pins from protectOthers
      landscape.tasks.forEach(task => {
        if (task._tempPinned) {
          task.pinned = false;
          task.includeInSolve = true;
          task._tempPinned = false;
        }
      });
    }

    // ─── 5. Collect stats ───
    landscape.tasks?.forEach(task => {
      if (task.pinned) { stats.tasksPinned++; return; }
      if (!task.includeInSolve) { stats.tasksExcluded++; return; }
      stats.tasksProcessed++;
      if (task.state === CTPTaskStateConstants.SCHEDULED) {
        stats.tasksFeasible++;
      } else {
        stats.tasksInfeasible++;
      }
    });

    stats.totalTimeMs = Date.now() - startTime;
    stats.finalize();

    // ─── 6. Build response ───
    const detailLevel = request?.detailLevel || 'novice';
    const result = this.extractResults(landscape, taskList, stats, detailLevel);
    result.scoring = { source: scoringSource, rules: scoringRules };

    // Augment summary with horizon metadata
    let pastDueTasks = 0;
    let deferredTasks = 0;
    landscape.tasks?.forEach((t: CTPTask) => {
      if (t.isPastDue) pastDueTasks++;
      if (t.horizonBucket === 'beyond') deferredTasks++;
    });
    (result.summary as any).pastDueTasks = pastDueTasks;
    (result.summary as any).deferredTasks = deferredTasks;
    (result.summary as any).horizonMode = (horizonConfig?.start || 'NOW').startsWith('NOW') ? 'rolling' : 'fixed';
    if (engineSolveResult) {
      engineSolveResult.tier = tier;
      const optRan = (scheduler as any).getOptimizationRan?.();
      if (optRan) engineSolveResult.optimizationRan = optRan;
      const optResult = (scheduler as any).getOptimizationResult?.();
      if (optResult) engineSolveResult.optimization = optResult;
      result.solveResult = engineSolveResult;
      if (engineSolveResult.solveSteps?.length > 0) {
        result.solveSteps = engineSolveResult.solveSteps;
      }
    }
    this.results.set(this.configService.getTenantId(), result);

    // ─── 7. Log solve event ───
    this.logger.solve({
      tenantId: this.configService.getTenantId(),
      strategy: result.stats?.strategy ?? 'unknown',
      solveTimeMs: result.stats?.totalTimeMs ?? (Date.now() - startTime),
      propagationTimeMs: result.stats?.propagationTimeMs,
      taskCount: result.summary.totalTasks,
      scheduledCount: result.summary.scheduledTasks,
      infeasibleCount: result.summary.unscheduledTasks,
      feasibilityRate: result.summary.feasibilityRate,
      resourceCount: landscape.resources?.size() ?? 0,
      horizonDays: Math.round((new Date(result.summary.horizonEnd).getTime() -
        new Date(result.summary.horizonStart).getTime()) / 86400000),
      windowsTightened: result.stats?.windowsTightened,
      scoringSource,
    });

    if (result.summary.feasibilityRate < 70) {
      this.logger.systemError({
        tenantId: this.configService.getTenantId(),
        severity: 'warning',
        category: 'engine',
        message: `Low feasibility rate: ${result.summary.feasibilityRate}% (${result.summary.scheduledTasks}/${result.summary.includedTasks} tasks)`,
        context: {
          strategy: result.stats?.strategy,
          feasibilityRate: result.summary.feasibilityRate,
          scheduledTasks: result.summary.scheduledTasks,
          includedTasks: result.summary.includedTasks,
        },
      });
    }

    return result;
  }

  getLastResult(): CTPSolveResult | null {
    return this.results.get(this.configService.getTenantId()) ?? null;
  }

  // ═══════════════════════════════════════
  // Endpoint 2: Unschedule Tasks (list)
  // ═══════════════════════════════════════

  unschedule(taskKeys: string[]): BulkUnscheduleResult {
    const landscape = this.ensureLandscape();
    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon, landscape.tasks, landscape.resources,
      landscape.stateChanges, landscape.processes,
    );
    return scheduler.unscheduleBulk(taskKeys);
  }

  // ═══════════════════════════════════════
  // Endpoint 3: Schedule Tasks (list)
  // ═══════════════════════════════════════

  schedule(taskKeys: string[]): BulkScheduleResult {
    const landscape = this.ensureLandscape();

    // Ensure commitmentLevel is current before expansion — canExpand() depends on it.
    // applyCommitmentStack is normally called by getState(), but schedule() may be called
    // without a preceding state fetch (e.g., direct API call, queue executor).
    this.applyCommitmentStack(landscape);

    const expansion = this.expandChainForSchedule(taskKeys, landscape);

    landscape.propagateConstraints();

    const scoringConfig = this.configService.getScoring();
    if (!scoringConfig) {
      throw new HttpException({ error: { code: ErrorCodes.SCORING_CONFIG_MISSING, message: 'Scoring configuration not found.', category: 'config' } }, HttpStatus.BAD_REQUEST);
    }
    const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
    for (const rule of scoringConfig.rules) {
      const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
      config.includeInSolve = rule.includeInSolve;
      config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }

    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon, landscape.tasks, landscape.resources,
      landscape.stateChanges, landscape.processes,
    );
    scheduler.initSettings(landscape.appSettings);
    scheduler.initScoring(scoring);

    const result = scheduler.scheduleBulk(expansion.full);
    result.summary.requestedCount = expansion.requested.length;
    result.summary.expandedCount = expansion.expanded.length;
    return result;
  }

  // ═══════════════════════════════════════
  // Endpoint 4: Update Resource Mode
  // ═══════════════════════════════════════

  updateResourceMode(taskKey: string, resourceKey: string, mode: string, type: string): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    const resourceList = type === 'capacity' ? task.capacityResources : task.materialsResources;
    if (!resourceList) {
      throw new HttpException({ error: { code: ErrorCodes.RESOURCE_NOT_FOUND, message: `No ${type} resources on task ${taskKey}`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    let found = false;
    let previousMode = '';
    resourceList.forEach(tr => {
      if (tr.resource === resourceKey || tr.scheduledResource === resourceKey) {
        previousMode = tr.mode;
        tr.mode = mode;
        found = true;
      }
    });

    if (!found) {
      throw new HttpException({ error: { code: ErrorCodes.RESOURCE_NOT_FOUND, message: `Resource ${resourceKey} not found on task ${taskKey}`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    const requiresResolve = previousMode !== mode &&
      (previousMode === CTPResourceModeConstants.REQUIRED || mode === CTPResourceModeConstants.REQUIRED);

    return { taskKey, resourceKey, mode, requiresResolve };
  }

  // ═══════════════════════════════════════
  // Endpoint 5: Update Material Modes (Bulk)
  // ═══════════════════════════════════════

  updateMaterialModes(modes: Record<string, string>): any {
    const landscape = this.ensureLandscape();
    let requiresResolve = false;
    const updated: { materialKey: string; mode: string }[] = [];

    for (const [materialKey, mode] of Object.entries(modes)) {
      let found = false;
      landscape.tasks?.forEach(task => {
        task.materialsResources?.forEach(tr => {
          if (tr.resource === materialKey) {
            const wasRequired = tr.mode === CTPResourceModeConstants.REQUIRED;
            const nowRequired = mode === CTPResourceModeConstants.REQUIRED;
            if (wasRequired || nowRequired) requiresResolve = true;
            tr.mode = mode;
            found = true;
          }
        });
      });
      if (found) updated.push({ materialKey, mode });
    }

    return { updated, requiresResolve };
  }

  // ═══════════════════════════════════════
  // Endpoint 6: Pin/Unpin Task
  // ═══════════════════════════════════════

  pinTask(taskKey: string, pinned: boolean): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    if (pinned && task.state !== CTPTaskStateConstants.SCHEDULED) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_SCHEDULED, message: `Cannot pin task ${taskKey} — it is not currently scheduled`, category: 'validation' } }, HttpStatus.BAD_REQUEST);
    }

    task.pinned = pinned;
    task.includeInSolve = !pinned;

    return { taskKey, pinned, requiresResolve: true };
  }

  // ═══════════════════════════════════════
  // Endpoint 7: Get Solve State
  // ═══════════════════════════════════════

  getState(detailLevel: string = 'novice'): CTPSolveResult {
    const landscape = this.ensureLandscape();

    // Re-derive commitment levels so state reflects current flags
    this.applyCommitmentStack(landscape);

    const stats = new SolveStatistics('none');
    stats.totalTimeMs = 0;

    landscape.tasks?.forEach(task => {
      if (task.pinned) stats.tasksPinned++;
      else if (!task.includeInSolve) stats.tasksExcluded++;
      else if (task.state === CTPTaskStateConstants.SCHEDULED) stats.tasksFeasible++;
      else stats.tasksInfeasible++;
      stats.tasksProcessed++;
    });
    stats.finalize();

    // Build a dummy task list covering all tasks for extractResults
    const taskList = new List<CTPTask>();
    landscape.tasks?.forEach(t => taskList.add(t));

    return this.extractResults(landscape, taskList, stats, detailLevel);
  }

  // ═══════════════════════════════════════
  // Endpoint 8: Where-To (Read-Only Evaluation)
  // ═══════════════════════════════════════

  whereTo(taskKey: string, request?: WhereToRequestDto): WhereToResponseDto {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);

    if (!task) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    // Non-movable task types return empty options with a reason
    if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) {
      return this.formatWhereToResponse({
        taskKey, taskName: task.name, currentAssignment: null, options: [],
        stats: { contextsEvaluated: 0, feasibleCount: 0, infeasibleCount: 0, timeMs: 0 },
      }, 'Setup/teardown tasks cannot be moved independently');
    }

    if (!task.canMove()) {
      return this.formatWhereToResponse({
        taskKey, taskName: task.name, currentAssignment: null, options: [],
        stats: { contextsEvaluated: 0, feasibleCount: 0, infeasibleCount: 0, timeMs: 0 },
      }, 'Task is already in process and cannot be moved');
    }

    const scoring = this.buildScoring();

    // Convert date constraints to engine time
    const constraints: WhereToConstraints | undefined = request?.constraints ? {
      onlyResources: request.constraints.onlyResources,
      startAfter: request.constraints.startAfter
        ? CTPDateTime.fromDateTime(request.constraints.startAfter)
        : undefined,
      startBefore: request.constraints.startBefore
        ? CTPDateTime.fromDateTime(request.constraints.startBefore)
        : undefined,
      maxResults: request.constraints.maxResults,
    } : undefined;

    const evaluator = new ScheduleEvaluator();
    const result = evaluator.whereTo(task, landscape, scoring, constraints);

    return this.formatWhereToResponse(result);
  }

  // ═══════════════════════════════════════
  // Endpoint 9: Move-To (Commit Assignment)
  // ═══════════════════════════════════════

  moveTo(taskKey: string, request: MoveToRequestDto): MoveToResponseDto {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);

    if (!task) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    // Re-evaluate to confirm option is still feasible
    const scoring = this.buildScoring();
    const evaluator = new ScheduleEvaluator();
    const freshResult = evaluator.whereTo(task, landscape, scoring);
    const chosenOption = freshResult.options.find(o => o.contextHash === request.contextHash);

    if (!chosenOption) {
      return {
        taskKey,
        success: false,
        reason: 'Position no longer available — resource state has changed since your query',
        suggestRefresh: true,
      };
    }

    // Unschedule from current position if scheduled
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      landscape.unscheduleTask(taskKey, true);
    }

    // Find the matching context from a fresh evaluation to get the ScheduleContext object
    const contexts = evaluator.buildContexts(task, landscape);
    const matchingCtx = contexts.find(c => c.hashKey === request.contextHash);

    if (!matchingCtx) {
      return {
        taskKey,
        success: false,
        reason: 'Context no longer available after unschedule',
        suggestRefresh: true,
      };
    }

    // Compute start times for the matching context
    const startTimes = evaluator.computeStartTimes(matchingCtx, landscape);
    if (!startTimes || !startTimes.atleastOne()) {
      return {
        taskKey,
        success: false,
        reason: 'Start times no longer feasible after unschedule',
        suggestRefresh: true,
      };
    }

    // Build BestScheduleContext and assign
    const requestedStartW = CTPDateTime.fromDateTime(request.startTime);
    const startTimeNode = startTimes.head!.data;
    const bestSchedule = new BestScheduleContext(matchingCtx, startTimeNode, requestedStartW);

    const scheduleEngine = new ScheduleEngine();
    scheduleEngine.schedule(landscape, task, bestSchedule);

    // Find affected tasks (tasks sharing resources with the new assignment)
    const affectedTasks: string[] = [];
    const assignedResourceKeys = chosenOption.resources.map(r => r.resourceKey);
    landscape.tasks?.forEach(t => {
      if (t.key === taskKey) return;
      t.capacityResources?.forEach(tr => {
        if (tr.scheduledResource && assignedResourceKeys.includes(tr.scheduledResource)) {
          affectedTasks.push(t.key);
        }
      });
    });

    const endTime = task.scheduled
      ? CTPDateTime.toDateTime(task.scheduled.endW).toISO()!
      : CTPDateTime.toDateTime(requestedStartW + (task.duration?.duration() ?? 0)).toISO()!;

    return {
      taskKey,
      success: true,
      assignment: {
        resources: assignedResourceKeys,
        start: request.startTime,
        end: endTime,
      },
      changeover: chosenOption.changeover,
      affectedTasks,
      requiresResolve: affectedTasks.length > 0,
    };
  }

  queryResources(
    attribute: string,
    value: string | undefined,
    includeAvailability: boolean,
    startTime?: string,
    endTime?: string,
  ): any {
    const landscape = this.ensureLandscape();
    const resourceConfigs = this.configService.getResources();

    const windowStart = startTime ? new Date(startTime).getTime() : 0;
    const windowEnd = endTime ? new Date(endTime).getTime() : 0;
    const hasWindow = windowStart > 0 && windowEnd > windowStart;

    const results: any[] = [];

    for (const resConfig of resourceConfigs) {
      const attr = resConfig.typedAttributes?.find(
        (a: any) => a.name.toLowerCase() === attribute.toLowerCase()
      );
      if (!attr) continue;

      if (value !== undefined) {
        const attrVal = attr.value?.value;
        const match =
          String(attrVal).toLowerCase() === value.toLowerCase() ||
          (attrVal === true && (value === 'true' || value === '1')) ||
          (attrVal === false && (value === 'false' || value === '0'));
        if (!match) continue;
      }

      const h = (resConfig as any).hierarchy ?? {};
      const hierarchy: Record<string, string> = {};
      if (h.level1) hierarchy.level1 = h.level1;
      if (h.level2) hierarchy.level2 = h.level2;
      if (h.level3) hierarchy.level3 = h.level3;
      if (h.level4) hierarchy.level4 = h.level4;
      if (h.level5) hierarchy.level5 = h.level5;

      const entry: any = {
        resourceKey: resConfig.key,
        resourceName: resConfig.name,
        hierarchy,
        [attribute]: attr.value?.value,
      };

      if (includeAvailability || hasWindow) {
        const resource = landscape.resources.getEntity(resConfig.key);
        if (resource) {
          // Build net-available intervals (availability minus assignments)
          type Iv = { s: number; e: number };
          const availability: Iv[] = [];
          if (resource.original) {
            let node = resource.original.head;
            while (node) {
              availability.push({
                s: node.data.AbsoluteStartTime.toMillis(),
                e: node.data.AbsoluteEndTime.toMillis(),
              });
              node = node.next;
            }
          }
          const assignments: Iv[] = [];
          if (resource.available?.staticAssignments) {
            let node = resource.available.staticAssignments.head;
            while (node) {
              assignments.push({
                s: node.data.AbsoluteStartTime.toMillis(),
                e: node.data.AbsoluteEndTime.toMillis(),
              });
              node = node.next;
            }
          }

          // Subtract assignments from availability
          let netSlices: Iv[] = [];
          for (const orig of availability) {
            let slices: Iv[] = [{ s: orig.s, e: orig.e }];
            for (const asgn of assignments) {
              const next: Iv[] = [];
              for (const sl of slices) {
                if (asgn.e <= sl.s || asgn.s >= sl.e) { next.push(sl); continue; }
                if (asgn.s > sl.s) next.push({ s: sl.s, e: asgn.s });
                if (asgn.e < sl.e) next.push({ s: asgn.e, e: sl.e });
              }
              slices = next;
            }
            netSlices.push(...slices);
          }

          if (hasWindow) {
            // Clip to requested time window
            const clipped: Iv[] = [];
            for (const sl of netSlices) {
              const cs = Math.max(sl.s, windowStart);
              const ce = Math.min(sl.e, windowEnd);
              if (ce > cs) clipped.push({ s: cs, e: ce });
            }
            const windowFreeMin = Math.round(clipped.reduce((sum, sl) => sum + (sl.e - sl.s), 0) / 60000);
            entry.availableMinutes = windowFreeMin;
            entry.availableGaps = clipped.map(sl => ({
              start: DateTime.fromMillis(sl.s).toISO(),
              end: DateTime.fromMillis(sl.e).toISO(),
              durationMinutes: Math.round((sl.e - sl.s) / 60000),
            }));
          } else {
            // Overall availability
            let totalAvailSec = availability.reduce((s, iv) => s + (iv.e - iv.s) / 1000, 0);
            let totalAssignSec = assignments.reduce((s, iv) => s + (iv.e - iv.s) / 1000, 0);
            entry.utilization = totalAvailSec > 0
              ? Math.round((totalAssignSec / totalAvailSec) * 10000) / 100
              : 0;
            entry.availableMinutes = Math.round(netSlices.reduce((s, sl) => s + (sl.e - sl.s), 0) / 60000);
          }
        }
      }

      results.push(entry);
    }

    return {
      attribute,
      value: value ?? null,
      ...(hasWindow ? { startTime, endTime } : {}),
      count: results.length,
      resources: results,
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 11: CTP Query (Stateless)
  // ═══════════════════════════════════════

  ctpQuery(request: CTPQueryDto): CTPQueryResponse {
    const landscape = this.ensureLandscape();

    // 1. Find source chain
    const sourceChain = landscape.processes?.getEntity(request.sourceChainKey);
    if (!sourceChain || !sourceChain.tasks || sourceChain.tasks.length === 0) {
      throw new HttpException({ error: { code: ErrorCodes.CHAIN_EVALUATION_FAILED, message: `Chain "${request.sourceChainKey}" not found`, category: 'engine' } }, HttpStatus.NOT_FOUND);
    }

    // 2. Clone the source chain
    const cloned = this.cloneChainFromExisting(
      sourceChain, request.orderName, landscape,
    );

    // 3. Apply priority override
    if (request.priority != null) {
      cloned.tasks.forEach(t => { t.priority = request.priority!; });
    }

    // 4. Apply resource preference overrides
    if (request.preferredResources) {
      for (const task of cloned.tasks) {
        task.capacityResources?.forEach(tr => {
          const resourceType = tr.resource;
          if (!resourceType) return;
          const preferred = request.preferredResources![resourceType];
          if (preferred && preferred.length > 0) {
            // Set preferred resources to REQUIRED mode
            for (const pref of tr.preferences) {
              if (preferred.includes(pref.resourceKey)) {
                pref.mode = 'REQUIRED';
              }
            }
          }
        });
      }
    }

    // 5. Build contexts for each cloned task (without modifying landscape)
    const evaluator = new ScheduleEvaluator();
    const allContexts = new ScheduleContexts();

    for (const task of cloned.tasks) {
      const contexts = evaluator.buildContexts(task, landscape);
      for (const ctx of contexts) {
        // Compute start times (available time slots on resources)
        evaluator.computeStartTimes(ctx, landscape);
        allContexts.addEntity(ctx);
      }
    }

    // 6. Evaluate chain — get top-K valid combos
    const scoring = this.buildScoring();
    const chainEngine = new ChainContextEngine();
    const maxOptions = request.maxOptions ?? 3;
    const combos = chainEngine.evaluateChainAll(
      cloned.chain, allContexts, landscape, scoring, maxOptions,
    );

    // 7. Build response
    const options: CTPQueryOption[] = combos.map((combo, rank) => ({
      rank: rank + 1,
      feasible: true,
      chainScore: combo.chainScore,
      tasks: combo.startTimes.map((st, i) => {
        const task = cloned.tasks[i];
        const ctx = combo.contexts[i];
        const resources = ctx.slot.resources
          ? (() => {
              const res: { resourceKey: string; resourceName: string; resourceType: string }[] = [];
              ctx.slot.resources.forEach(r => {
                if (r.resource) {
                  res.push({
                    resourceKey: r.resource.key,
                    resourceName: r.resource.name,
                    resourceType: r.resource.type || '',
                  });
                }
              });
              return res;
            })()
          : [];
        return {
          taskKey: st.taskKey,
          taskName: task.name,
          taskType: task.type || 'PROCESS',
          start: CTPDateTime.toDateTime(st.assignedStart).toISO()!,
          end: CTPDateTime.toDateTime(st.assignedEnd).toISO()!,
          durationMinutes: Math.round((st.assignedEnd - st.assignedStart) / 60),
          resources,
        };
      }),
    }));

    // 8. Sort options by chain completion date (ascending = earliest first)
    options.sort((a, b) => {
      const aEnd = a.tasks[a.tasks.length - 1]?.end || '';
      const bEnd = b.tasks[b.tasks.length - 1]?.end || '';
      return new Date(aEnd).getTime() - new Date(bEnd).getTime();
    });
    options.forEach((opt, i) => { opt.rank = i + 1; });

    // 9. Compute promise status if needByDate provided
    if (request.needByDate) {
      const needBy = new Date(request.needByDate).getTime();
      for (const option of options) {
        const lastTask = option.tasks[option.tasks.length - 1];
        const completionDate = new Date(lastTask.end).getTime();
        const slackMs = needBy - completionDate;
        const slackDays = Math.round(slackMs / (24 * 60 * 60 * 1000));
        option.promiseStatus = {
          needByDate: request.needByDate,
          completionDate: lastTask.end,
          slackDays,
          status: slackDays > 1 ? 'early' : slackDays >= 0 ? 'on-time' : 'late',
        };
      }
    }

    // 10. Build summary
    const feasibleOptions = options.filter(o => o.feasible !== false);
    const earliest = feasibleOptions[0];
    const latest = feasibleOptions[feasibleOptions.length - 1];

    const summary: CTPQuerySummary = {
      totalOptions: options.length,
      feasibleOptions: feasibleOptions.length,
      earliestCompletionDate: earliest
        ? earliest.tasks[earliest.tasks.length - 1]?.end
        : null,
      earliestCompletionResources: earliest
        ? earliest.tasks
            .filter(t => t.taskType === 'PROCESS' || !t.taskType)
            .map(t => t.resources.map(r => r.resourceName || r.resourceKey).join(', '))
            .join(' → ')
        : '',
      latestCompletionDate: latest
        ? latest.tasks[latest.tasks.length - 1]?.end
        : null,
      promiseStatus: null,
      promiseSlackDays: null,
      needByDate: request.needByDate || null,
    };

    // Compute promise status relative to need-by date
    if (request.needByDate && summary.earliestCompletionDate) {
      const earliestMs = new Date(summary.earliestCompletionDate).getTime();
      const needByMs = new Date(request.needByDate).getTime();
      const slackDays = Math.round((needByMs - earliestMs) / (24 * 3600 * 1000) * 10) / 10;
      summary.promiseSlackDays = slackDays;
      if (slackDays >= 2) {
        summary.promiseStatus = 'on-time';
      } else if (slackDays >= 0) {
        summary.promiseStatus = 'tight';
      } else {
        summary.promiseStatus = 'cannot-meet';
      }
    }

    // 11. Build infeasibility report
    const infeasibilityReport = options.length === 0
      ? {
          reason: `No feasible placement found for "${request.orderName}" using chain ${request.sourceChainKey}`,
          shortSummary: 'No feasible resource combinations found within the planning horizon',
        }
      : null;

    return {
      orderName: request.orderName,
      sourceChainKey: request.sourceChainKey,
      feasible: feasibleOptions.length > 0,
      options,
      summary,
      infeasibilityReport,
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 12: Chain Templates
  // ═══════════════════════════════════════

  getChainTemplates(): ChainTemplatesResponse {
    const landscape = this.ensureLandscape();
    const templates: ChainTemplatesResponse['templates'] = [];

    landscape.processes?.forEach(process => {
      if (!process.tasks || process.tasks.length === 0) return;

      const tasks: { type: string; name: string; durationMinutes: number; resourceCount: number }[] = [];
      let totalDuration = 0;
      process.tasks.forEach(task => {
        const dur = task.duration?.duration() ?? 0;
        totalDuration += dur;
        tasks.push({
          type: task.type || 'PROCESS',
          name: task.name || task.key,
          durationMinutes: Math.round(dur / 60),
          resourceCount: task.capacityResources?.length ?? 0,
        });
      });

      templates.push({
        chainKey: process.key,
        name: process.name || process.key,
        category: process.category || '',
        taskCount: tasks.length,
        totalDurationMinutes: Math.round(totalDuration / 60),
        tasks,
      });
    });

    return { templates };
  }

  // ═══════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════

  private cloneChainFromExisting(
    sourceChain: CTPProcess,
    newOrderName: string,
    landscape: SchedulingLandscape,
  ): { chain: CTPProcess; tasks: CTPTask[] } {
    const newChainKey = `CTP-${Date.now()}`;
    const chain = new CTPProcess(newOrderName);
    chain.key = newChainKey;
    chain.category = sourceChain.category;
    chain.cadence = sourceChain.cadence;

    const tasks: CTPTask[] = [];
    const keyMap = new Map<string, string>();

    // First pass: clone tasks with new keys
    const sourceTaskArray: CTPTask[] = [];
    sourceChain.tasks!.forEach(t => sourceTaskArray.push(t));
    sourceTaskArray.sort((a, b) => a.sequence - b.sequence);

    for (let si = 0; si < sourceTaskArray.length; si++) {
      const sourceTask = sourceTaskArray[si];
      const suffix = sourceTask.key.split('-').pop() || `T${si}`;
      const newKey = `${newChainKey}-${suffix}`;
      keyMap.set(sourceTask.key, newKey);

      const task = new CTPTask();
      task.key = newKey;
      task.hashKey = newKey;
      task.name = `${newOrderName} - ${sourceTask.name?.split(' - ').pop() || sourceTask.type || 'Task'}`;
      task.type = sourceTask.type;
      task.duration = sourceTask.duration
        ? new CTPDuration(sourceTask.duration.duration())
        : null;
      task.priority = sourceTask.priority;
      task.process = newChainKey;
      task.cadenceIntervalMinutes = sourceTask.cadenceIntervalMinutes;
      task.sequence = sourceTask.sequence;

      // Clone resource requirements
      if (sourceTask.capacityResources && sourceTask.capacityResources.length > 0) {
        task.capacityResources = new CTPTaskResourceList();
        sourceTask.capacityResources.forEach(tr => {
          const clonedTr = new CTPTaskResource(
            tr.resource, tr.isPrimary, tr.index, undefined, tr.mode,
          );
          // Copy preferences
          for (const pref of tr.getEffectivePreferences()) {
            clonedTr.preferences.push(
              new CTPResourcePreference(pref.resourceKey, pref.rank, pref.mode),
            );
          }
          task.capacityResources!.add(clonedTr);
        });
      }

      // Clone window from horizon (full planning window)
      if (landscape.horizon) {
        task.window = new CTPInterval(landscape.horizon.startW, landscape.horizon.endW, 1);
      }

      tasks.push(task);
    }

    // Second pass: remap linkId references and add to chain
    for (let i = 0; i < sourceTaskArray.length; i++) {
      const sourceTask = sourceTaskArray[i];
      const task = tasks[i];

      if (sourceTask.linkId) {
        task.linkId = new CTPLinkId(
          newChainKey,
          sourceTask.linkId.type,
          sourceTask.linkId.prevLink ? keyMap.get(sourceTask.linkId.prevLink) || '' : '',
          sourceTask.linkId.maxGap,
        );
      }

      chain.tasks!.add(task);
    }

    return { chain, tasks };
  }

  private ensureLandscape(): SchedulingLandscape {
    const landscape = this.stateService.getLandscape();
    if (!landscape) {
      // Auto-sync if not loaded
      this.stateService.syncFromConfig();
      const ls = this.stateService.getLandscape();
      if (!ls) throw new HttpException({ error: { code: ErrorCodes.STATE_NOT_LOADED, message: 'State not loaded.', category: 'config' } }, HttpStatus.BAD_REQUEST);
      return ls;
    }
    return landscape;
  }

  private applyMaterialModes(landscape: SchedulingLandscape, materialModes: Record<string, string>): void {
    for (const [materialKey, mode] of Object.entries(materialModes)) {
      landscape.tasks?.forEach(task => {
        task.materialsResources?.forEach(tr => {
          if (tr.resource === materialKey) {
            tr.mode = mode;
          }
        });
      });
    }
  }

  private getAffectedResourceUtils(landscape: SchedulingLandscape, resourceKeys: string[]): any[] {
    const resourceConfigs = this.configService.getResources();
    const resourceConfigMap = new Map(resourceConfigs.map((r) => [r.key, r]));

    return resourceKeys.map(key => {
      const resource = landscape.resources.getEntity(key);
      if (!resource) return { resourceKey: key, utilization: 0 };

      let totalAvailable = 0;
      if (resource.original) {
        let node = resource.original.head;
        while (node) { totalAvailable += node.data.duration(); node = node.next; }
      }
      let totalAssigned = 0;
      if (resource.assignments) {
        let node = resource.assignments.head;
        while (node) { totalAssigned += node.data.duration(); node = node.next; }
      }

      return {
        resourceKey: key,
        utilization: totalAvailable > 0
          ? Math.round((totalAssigned / totalAvailable) * 10000) / 100
          : 0,
      };
    });
  }

  private sortByPriority(taskList: List<CTPTask>): List<CTPTask> {
    const arr: CTPTask[] = [];
    taskList.forEach((t) => arr.push(t));
    arr.sort((a, b) => a.priority - b.priority);
    const sorted = new List<CTPTask>();
    for (const t of arr) sorted.add(t);
    return sorted;
  }

  private createScheduler(strategy: string, tier: string = 'balanced'): CTPScheduler {
    switch (tier) {
      case 'thorough':
        return new TabuSearchScheduler();
      case 'best':
        return new ILSScheduler();
      default:
        return new CTPScheduler();
    }
  }

  private buildTaskList(
    landscape: SchedulingLandscape,
    request?: SolveRequestDto,
    effectiveTaskKeys?: string[],
  ): List<CTPTask> {
    const taskList = new List<CTPTask>();

    // Priority: effectiveTaskKeys (expanded) > taskKeys > filter > all
    const keysToUse = effectiveTaskKeys ?? request?.taskKeys;
    if (keysToUse) {
      for (const key of keysToUse) {
        const task = landscape.tasks.getEntity(key);
        if (task) taskList.add(task);
      }
      return this.sortByPriority(taskList);
    }

    if (request?.filter) {
      const { attribute, value, operator = 'equals' } = request.filter;
      landscape.tasks.forEach((task) => {
        const rawValue = task.typedAttributes.getRawValue(attribute);
        if (rawValue === undefined) return;

        let match = false;
        switch (operator) {
          case 'equals':
            match = rawValue === value;
            break;
          case 'in':
            match = Array.isArray(value) && value.includes(rawValue);
            break;
          case 'greaterThan':
            match = typeof rawValue === 'number' && rawValue > value;
            break;
          case 'lessThan':
            match = typeof rawValue === 'number' && rawValue < value;
            break;
        }
        if (match) taskList.add(task);
      });
      return this.sortByPriority(taskList);
    }

    // Default: all tasks
    landscape.tasks.forEach((t) => taskList.add(t));
    return this.sortByPriority(taskList);
  }

  private buildScoring(): CTPScoring {
    const scoringConfig = this.configService.getScoring();
    if (!scoringConfig) {
      throw new HttpException({ error: { code: ErrorCodes.SCORING_CONFIG_MISSING, message: 'Scoring configuration not found.', category: 'config' } }, HttpStatus.BAD_REQUEST);
    }
    const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
    for (const rule of scoringConfig.rules) {
      const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
      config.includeInSolve = rule.includeInSolve;
      config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }
    return scoring;
  }

  // ═══════════════════════════════════════
  // Endpoint 10: Set Task Window
  // ═══════════════════════════════════════

  setTaskWindow(taskKey: string, windowStart?: string, windowEnd?: string): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);

    if (!task) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }
    if (!task.window) {
      throw new HttpException({ error: { code: ErrorCodes.ENGINE_EXCEPTION, message: `Task ${taskKey} has no window`, category: 'validation' } }, HttpStatus.BAD_REQUEST);
    }

    const previousStart = CTPDateTime.toDateTime(task.window.startW).toISO()!;
    const previousEnd = CTPDateTime.toDateTime(task.window.endW).toISO()!;

    if (windowStart) {
      const newStartW = CTPDateTime.fromDateTime(windowStart);
      task.window.startW = newStartW;
      task.window.origStartW = newStartW;
    }
    if (windowEnd) {
      const newEndW = CTPDateTime.fromDateTime(windowEnd);
      task.window.endW = newEndW;
      task.window.origEndW = newEndW;
    }

    // Validate window is still valid
    if (task.window.startW >= task.window.endW) {
      // Revert
      task.window.startW = CTPDateTime.fromDateTime(previousStart);
      task.window.endW = CTPDateTime.fromDateTime(previousEnd);
      task.window.origStartW = task.window.startW;
      task.window.origEndW = task.window.endW;
      throw new HttpException({ error: { code: ErrorCodes.ENGINE_EXCEPTION, message: 'Invalid window: start >= end after modification', category: 'validation' } }, HttpStatus.BAD_REQUEST);
    }

    // If task was previously marked infeasible due to window, clear errors
    if (task.state !== CTPTaskStateConstants.SCHEDULED) {
      task.clearErrors();
      task.includeInSolve = true;
    }

    return {
      taskKey,
      previousWindow: { start: previousStart, end: previousEnd },
      newWindow: {
        start: CTPDateTime.toDateTime(task.window.startW).toISO()!,
        end: CTPDateTime.toDateTime(task.window.endW).toISO()!,
      },
      requiresResolve: true,
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 11: Set Task Priority
  // ═══════════════════════════════════════

  setTaskPriority(taskKey: string, priority: number): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);

    if (!task) {
      throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    }

    const previousPriority = task.priority;
    task.priority = priority;

    return {
      taskKey,
      previousPriority,
      newPriority: priority,
      requiresResolve: true,
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 15: Critical Path Analysis
  // ═══════════════════════════════════════

  getCriticalPath(): any {
    const landscape = this.ensureLandscape();

    let scheduledCount = 0;
    landscape.tasks.forEach(t => {
      if (t.state === CTPTaskStateConstants.SCHEDULED) scheduledCount++;
    });

    if (scheduledCount === 0) {
      throw new HttpException({ error: { code: ErrorCodes.ENGINE_EXCEPTION, message: 'No scheduled tasks — solve first', category: 'engine' } }, HttpStatus.BAD_REQUEST);
    }

    const graph = DisjunctiveGraph.buildFromLandscape(landscape);

    if (!graph.criticalPath) {
      return { status: 'no_critical_path', message: 'Could not compute critical path' };
    }

    return {
      status: 'ok',
      ...graph.criticalPath,
      nodes: graph.nodes.map(nd => ({
        key: nd.key,
        name: nd.name,
        type: nd.type,
        chainKey: nd.chainKey,
        resourceKey: nd.resourceKey,
        resourceName: nd.resourceName,
        start: CTPDateTime.toDateTime(nd.startW).toISO()!,
        end: CTPDateTime.toDateTime(nd.endW).toISO()!,
        duration: nd.duration,
        slack: nd.totalSlack,
        isOnCriticalPath: nd.isOnCriticalPath,
        criticalBlockId: nd.criticalBlockId,
      })),
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 16: Diagnose
  // ═══════════════════════════════════════

  diagnose(request: DiagnoseRequestDto): DiagnoseResponse {
    const landscape = this.ensureLandscape();
    const landscapeHash = this.computeLandscapeHash();
    const timestamp = new Date().toISOString();

    // 1. Identify target tasks
    let targetTasks: CTPTask[] = [];
    if (request.taskKeys?.length) {
      for (const k of request.taskKeys) {
        const t = landscape.tasks.getEntity(k);
        if (t) targetTasks.push(t);
      }
    } else {
      landscape.tasks.forEach(t => {
        if (t.state !== CTPTaskStateConstants.SCHEDULED && t.includeInSolve && !t.pinned) {
          targetTasks.push(t);
        }
      });
    }

    const maxRecs = request.maxRecommendations ?? 5;
    const allowedActions = request.actionTypes ?? null;
    const diagnoses: TaskDiagnosis[] = [];

    for (const task of targetTasks) {
      // 2. Classify root cause
      const rootCause = this.classifyRootCause(task, landscape);

      // 3. Generate recommendations
      const recommendations: Recommendation[] = [];

      if (!allowedActions || allowedActions.includes('move_resource')) {
        recommendations.push(...this.generateMoveResourceRecs(task, landscape));
      }
      if (!allowedActions || allowedActions.includes('expand_window')) {
        recommendations.push(...this.generateExpandWindowRecs(task, landscape));
      }
      if (!allowedActions || allowedActions.includes('bump_lower_priority')) {
        recommendations.push(...this.generateBumpRecs(task, landscape));
      }

      // 3e. Compound recommendations (when single actions are insufficient)
      if (!allowedActions || allowedActions.length > 1) {
        recommendations.push(...this.generateCompoundRecs(task, landscape, recommendations, rootCause));
      }

      // 4. Sort and rank
      recommendations.sort((a, b) => a.score - b.score);
      recommendations.forEach((r, i) => r.rank = i + 1);

      diagnoses.push({
        taskKey: task.key,
        taskName: task.name,
        orderKey: task.linkId?.name ?? null,
        chainKey: task.linkId?.name ?? null,
        status: task.state === CTPTaskStateConstants.SCHEDULED ? 'scheduled' : 'infeasible',
        rootCause,
        infeasibilityReport: task.infeasibilityReport ? this.serializeInfeasibilityReport(task.infeasibilityReport) : undefined,
        recommendations: recommendations.slice(0, maxRecs),
      });
    }

    // 5. Global recommendations
    const globalRecommendations = this.generateGlobalRecs(targetTasks, landscape);

    return { diagnoses, globalRecommendations, timestamp, landscapeHash };
  }

  private classifyRootCause(task: CTPTask, landscape: SchedulingLandscape): RootCause {
    const report = task.infeasibilityReport;
    const errorReasons = task.errors.map(e => e.reason.toLowerCase());

    // Material shortage?
    if (errorReasons.some(r => r.includes('material') || r.includes('shortage'))) {
      return { type: 'material_shortage', summary: 'Material shortage prevents scheduling' };
    }

    // All resources excluded?
    if (report?.slots?.every((s: any) => s.resources?.every((r: any) => r.status === 'blocked'))) {
      let hasExcluded = false;
      task.capacityResources?.forEach(tr => { if (tr.mode === 'EXCLUDED') hasExcluded = true; });
      if (hasExcluded) {
        return { type: 'resource_excluded', summary: 'All compatible resources are excluded or offline', bottleneckSlot: report.bottleneckSlot ?? undefined };
      }
    }

    if (report) {
      const bottleneck = report.slots?.find((s: any) => s.isBottleneck);
      const blockingTasks: BlockingTaskSummary[] = [];
      if (bottleneck?.resources) {
        for (const res of bottleneck.resources) {
          for (const bt of (res.blockingTasks || [])) {
            const blockerTask = landscape.tasks.getEntity(bt.taskKey);
            blockingTasks.push({
              taskKey: bt.taskKey,
              taskName: bt.taskName || bt.taskKey,
              orderKey: blockerTask?.linkId?.name ?? null,
              priority: blockerTask?.priority ?? 100,
              resourceKey: res.resourceKey || '',
              start: bt.startW ? CTPDateTime.toDateTime(bt.startW).toISO()! : '',
              end: bt.endW ? CTPDateTime.toDateTime(bt.endW).toISO()! : '',
            });
          }
        }
      }

      // Window too tight?
      const windowDuration = task.window ? (task.window.endW - task.window.startW) : 0;
      const taskDuration = task.duration?.duration() ?? 0;
      if (windowDuration > 0 && windowDuration < taskDuration * 1.5) {
        return {
          type: 'window_too_tight',
          summary: `Window is ${Math.round(windowDuration / 3600)}h but task needs ${Math.round(taskDuration / 3600)}h`,
          bottleneckSlot: report.bottleneckSlot ?? undefined,
          blockingTasks,
        };
      }

      return {
        type: 'no_capacity',
        summary: report.reason || `No capacity on ${report.bottleneckSlot} within window`,
        bottleneckSlot: report.bottleneckSlot ?? undefined,
        blockingTasks,
      };
    }

    return { type: 'unknown', summary: 'Unable to determine root cause' };
  }

  private generateMoveResourceRecs(task: CTPTask, landscape: SchedulingLandscape): Recommendation[] {
    try {
      const result = this.whereTo(task.key, {});
      if (!result?.options?.length) return [];

      return result.options.slice(0, 3).map((opt: any, i: number) => ({
        id: `move-${task.key}-${opt.contextHash || i}`,
        action: 'move_resource' as const,
        description: `Move to ${(opt.resources || []).map((r: any) => r.resourceName || r.resourceKey).join(' + ')} at ${opt.start}`,
        score: opt.score ?? (10 + i * 5),
        rank: i + 1,
        tradeoffs: {
          gains: [`Task becomes feasible`],
          costs: opt.changeover ? [`${opt.changeover.durationMinutes}min changeover`] : [],
          metrics: { changeoversAdded: opt.changeover ? 1 : 0 },
        },
        commands: [{
          type: 'move_to' as const,
          taskKey: task.key,
          contextHash: opt.contextHash,
          startTime: opt.start,
        }],
      }));
    } catch {
      return [];
    }
  }

  private generateExpandWindowRecs(task: CTPTask, landscape: SchedulingLandscape): Recommendation[] {
    if (!task.window) return [];
    const recs: Recommendation[] = [];

    const expansions = [
      { days: 1, label: '1 day' },
      { days: 2, label: '2 days' },
      { days: 5, label: '1 week' },
    ];

    for (const exp of expansions) {
      const newEndW = task.window.endW + (exp.days * 86400);
      const newEndDate = CTPDateTime.toDateTime(newEndW).toISO()!;

      // Check if any resource has availability in the expanded range
      let hasCapacity = false;
      let capResourceName = '';
      task.capacityResources?.forEach(tr => {
        if (hasCapacity) return;
        tr.preferences.forEach(pref => {
          if (hasCapacity) return;
          const res = landscape.resources.getEntity(pref.resourceKey);
          if (!res?.available?.staticOriginal) return;
          let ptr: any = res.available.staticOriginal.head;
          while (ptr) {
            if (ptr.data.endW > task.window!.endW && ptr.data.startW < newEndW) {
              const gap = Math.min(ptr.data.endW, newEndW) - Math.max(ptr.data.startW, task.window!.endW);
              if (gap >= (task.duration?.duration() ?? 0)) {
                hasCapacity = true;
                capResourceName = res.name || pref.resourceKey;
                return;
              }
            }
            ptr = ptr.next;
          }
        });
      });

      if (hasCapacity) {
        // Build window commands for the whole chain (siblings need expanded windows too)
        const windowCommands: RecommendationCommand[] = [];
        const chainTaskKeys: string[] = [task.key];
        windowCommands.push({ type: 'set_window' as const, taskKey: task.key, windowEnd: newEndDate });

        if (task.linkId?.name) {
          const chain = landscape.processes.getEntity(task.linkId.name);
          chain?.tasks?.forEach(sibling => {
            if (sibling.key !== task.key && sibling.window) {
              const sibEndW = sibling.window.endW;
              if (sibEndW < newEndW) {
                windowCommands.push({ type: 'set_window' as const, taskKey: sibling.key, windowEnd: newEndDate });
              }
              chainTaskKeys.push(sibling.key);
            }
          });
        }

        recs.push({
          id: `window-${task.key}-${exp.days}d`,
          action: 'expand_window',
          description: `Extend window by ${exp.label}${capResourceName ? ` — capacity on ${capResourceName}` : ''}`,
          score: 50 + (exp.days * 10),
          rank: 0,
          tradeoffs: {
            gains: ['Task becomes schedulable'],
            costs: [`Delivery may slip ${exp.days} day(s)`],
            metrics: { dueDateImpactDays: exp.days },
          },
          commands: [
            ...windowCommands,
            { type: 'solve' as const, taskKeys: chainTaskKeys, scope: 'targeted' as const, expandChains: true },
          ],
        });
        break; // only suggest smallest sufficient expansion
      }
    }

    return recs;
  }

  private generateBumpRecs(task: CTPTask, landscape: SchedulingLandscape): Recommendation[] {
    const report = task.infeasibilityReport;
    if (!report) return [];
    const taskPriority = task.priority ?? 100;
    const recs: Recommendation[] = [];

    const blockers = (report.slots || [])
      .flatMap((s: any) => s.resources || [])
      .flatMap((r: any) => r.blockingTasks || [])
      .filter((bt: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.taskKey === bt.taskKey) === i);

    for (const blocker of blockers) {
      const blockerTask = landscape.tasks.getEntity(blocker.taskKey);
      if (!blockerTask) continue;

      // Commitment level checks
      if (blockerTask.commitmentLevel === 'running') continue; // can't bump running tasks

      if (blockerTask.commitmentLevel === 'on_hold') {
        // Suggest resolving the hold instead of bumping
        recs.push({
          id: `resolve-hold-${task.key}-${blocker.taskKey}`,
          action: 'expand_window' as const,
          description: `Resolve hold on ${blockerTask.name} to recover capacity — ${blockerTask.holdReason || 'on hold'}`,
          score: 15, // highest priority — dead capacity recovery
          rank: 0,
          tradeoffs: {
            gains: [`Recovers ${Math.round(blockerTask.effectiveRemainingDuration() / 3600 * 10) / 10}h of dead capacity`],
            costs: ['Requires resolving the hold issue'],
          },
          commands: [], // Manual resolution — no auto-command
        });
        continue;
      }

      if (blockerTask.pinned && blockerTask.commitmentLevel !== 'dispatched') continue;

      const blockerPriority = blockerTask.priority ?? 100;
      if (blockerPriority <= taskPriority) continue; // only bump lower priority

      const dispatchedWarning = blockerTask.commitmentLevel === 'dispatched'
        ? `${blockerTask.name} is dispatched — materials may be pulled, operator assigned`
        : '';

      recs.push({
        id: `bump-${task.key}-${blocker.taskKey}`,
        action: 'bump_lower_priority',
        description: `Unschedule ${blockerTask.name} (priority ${blockerPriority}${blockerTask.commitmentLevel === 'dispatched' ? ', dispatched' : ''}) to free capacity`,
        score: 30 + (blockerPriority - taskPriority) + (blockerTask.commitmentLevel === 'dispatched' ? 20 : 0),
        rank: 0,
        tradeoffs: {
          gains: [`Frees capacity on ${report.bottleneckSlot || 'bottleneck resource'}`],
          costs: [
            `${blockerTask.name} must reschedule`,
            ...(dispatchedWarning ? [dispatchedWarning] : []),
          ],
          metrics: { tasksDisplaced: 1 },
        },
        commands: [
          { type: 'unschedule' as const, taskKey: blocker.taskKey },
          { type: 'solve' as const, taskKeys: [task.key, blocker.taskKey], scope: 'targeted' as const, expandChains: true },
        ],
      });
    }

    return recs;
  }

  private generateGlobalRecs(infeasibleTasks: CTPTask[], landscape: SchedulingLandscape): Recommendation[] {
    const recs: Recommendation[] = [];

    // If many infeasible share a bottleneck, suggest order deferral
    if (infeasibleTasks.length >= 3) {
      const bnCounts = new Map<string, number>();
      for (const t of infeasibleTasks) {
        const bn = t.infeasibilityReport?.bottleneckSlot;
        if (bn) bnCounts.set(bn, (bnCounts.get(bn) ?? 0) + 1);
      }
      const top = [...bnCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 3) {
        recs.push({
          id: `global-bottleneck-${top[0]}`,
          action: 'change_strategy',
          description: `${top[1]} tasks blocked by ${top[0]} — consider re-solving with Balanced strategy or deferring low-priority work`,
          score: 60,
          rank: 0,
          tradeoffs: {
            gains: ['May resolve multiple infeasibilities'],
            costs: ['Longer solve time', 'Some tasks may move'],
          },
          commands: [{ type: 'solve' as const, strategy: 'Chain', scope: 'full' as const }],
        });
      }
    }

    // Suggest strategy upgrade if using quick/greedy
    if (infeasibleTasks.length > 0) {
      const strategy = landscape.appSettings?.solverStrategy ?? 'Chain';
      if (strategy === 'Greedy' || strategy === 'ChainFirstFit') {
        recs.push({
          id: 'global-strategy-chain',
          action: 'change_strategy',
          description: 'Re-solve with Chain strategy — better chain-aware placement',
          score: 70,
          rank: 0,
          tradeoffs: {
            gains: ['Better chain integrity', 'May resolve infeasible tasks'],
            costs: ['Slightly longer solve time'],
          },
          commands: [{ type: 'solve' as const, strategy: 'Chain', scope: 'full' as const }],
        });
      }
    }

    recs.forEach((r, i) => r.rank = i + 1);
    return recs;
  }

  // ═══════════════════════════════════════
  // Compound Recommendation Generator
  // ═══════════════════════════════════════

  private generateCompoundRecs(
    task: CTPTask,
    landscape: SchedulingLandscape,
    existingRecs: Recommendation[],
    rootCause: RootCause,
  ): Recommendation[] {
    const recs: Recommendation[] = [];
    const hasMoveRecs = existingRecs.some(r => r.action === 'move_resource');
    const hasWindowRecs = existingRecs.some(r => r.action === 'expand_window');
    const hasBumpRecs = existingRecs.some(r => r.action === 'bump_lower_priority');

    // Compound 1: Extend Window + Redirect Resource
    if (!hasMoveRecs && rootCause.type === 'no_capacity') {
      const c = this.tryWindowPlusRedirect(task, landscape);
      if (c) recs.push(c);
    }

    // Compound 2: Bump Blocker + Move to Freed Slot
    if (!hasWindowRecs && hasBumpRecs && rootCause.blockingTasks?.length) {
      const c = this.tryBumpPlusMove(task, landscape, rootCause);
      if (c) recs.push(c);
    }

    // Compound 3: Redirect Others Off Bottleneck + Solve Target
    if (!hasMoveRecs && rootCause.type === 'no_capacity') {
      const c = this.tryRedirectOthersPlusSolve(task, landscape, rootCause);
      if (c) recs.push(c);
    }

    return recs;
  }

  private tryWindowPlusRedirect(task: CTPTask, landscape: SchedulingLandscape): Recommendation | null {
    if (!task.window) return null;

    const report = task.infeasibilityReport;
    const bottleneck = report?.slots?.find((s: any) => s.isBottleneck);
    const bottleneckResourceKey = bottleneck?.resources?.find(
      (r: any) => r.status === 'blocked'
    )?.resourceKey;
    if (!bottleneckResourceKey) return null;

    const expansions = [
      { seconds: 86400, label: '1 day' },
      { seconds: 172800, label: '2 days' },
    ];

    for (const exp of expansions) {
      const newEndW = task.window.endW + exp.seconds;

      // Find an alternative resource (not the bottleneck)
      let altKey = '';
      let altName = '';
      task.capacityResources?.forEach(tr => {
        if (altKey) return;
        tr.preferences?.forEach(pref => {
          if (altKey) return;
          if (pref.resourceKey === bottleneckResourceKey) return;
          const res = landscape.resources?.getEntity(pref.resourceKey);
          if (res) { altKey = pref.resourceKey; altName = res.name || pref.resourceKey; }
        });
      });
      if (!altKey) continue;

      const newEndISO = CTPDateTime.toDateTime(newEndW).toISO()!;
      const bnRes = landscape.resources?.getEntity(bottleneckResourceKey);
      const bnName = bnRes?.name || bottleneckResourceKey;

      // Build window commands for chain siblings too
      const windowCmds: RecommendationCommand[] = [
        { type: 'set_window' as const, taskKey: task.key, windowEnd: newEndISO },
      ];
      const chainTaskKeys = [task.key];
      if (task.linkId?.name) {
        const chain = landscape.processes.getEntity(task.linkId.name);
        chain?.tasks?.forEach(sib => {
          if (sib.key !== task.key && sib.window && sib.window.endW < newEndW) {
            windowCmds.push({ type: 'set_window' as const, taskKey: sib.key, windowEnd: newEndISO });
          }
          if (sib.key !== task.key) chainTaskKeys.push(sib.key);
        });
      }

      return {
        id: `compound-window-redirect-${task.key}-${exp.seconds}`,
        action: 'expand_window' as const,
        description: `Extend window ${exp.label} and redirect from ${bnName} to ${altName}`,
        score: 35 + (exp.seconds / 86400) * 5,
        rank: 0,
        tradeoffs: {
          gains: [
            `Task schedulable on ${altName} with wider window`,
            `Frees ${bnName} for higher-priority work`,
          ],
          costs: [
            `Window extends ${exp.label}`,
            `Task moves from ${bnName} to ${altName}`,
          ],
          metrics: { dueDateImpactDays: Math.ceil(exp.seconds / 86400), tasksDisplaced: 0 },
        },
        commands: [
          ...windowCmds,
          { type: 'set_resource_preference' as const, taskKeys: [task.key], resourceKey: bottleneckResourceKey, mode: 'EXCLUDED' },
          { type: 'set_resource_preference' as const, taskKeys: [task.key], resourceKey: altKey, mode: 'PREFERRED' },
          { type: 'solve' as const, taskKeys: chainTaskKeys, scope: 'targeted' as const, expandChains: true },
        ],
      };
    }
    return null;
  }

  private tryBumpPlusMove(
    task: CTPTask,
    landscape: SchedulingLandscape,
    rootCause: RootCause,
  ): Recommendation | null {
    if (!rootCause.blockingTasks?.length) return null;
    const taskPriority = task.priority ?? 100;

    const candidates = rootCause.blockingTasks
      .filter(bt => {
        const blocker = landscape.tasks.getEntity(bt.taskKey);
        if (!blocker) return false;
        if (blocker.commitmentLevel === 'running' || blocker.commitmentLevel === 'on_hold') return false;
        if (blocker.pinned && blocker.commitmentLevel !== 'dispatched') return false;
        return (blocker.priority ?? 100) > taskPriority;
      })
      .sort((a, b) => b.priority - a.priority);

    if (candidates.length === 0) return null;
    const best = candidates[0];
    const blockerTask = landscape.tasks.getEntity(best.taskKey);
    if (!blockerTask) return null;

    let blockerSlackDays = 0;
    if (blockerTask.dueDate && blockerTask.scheduled) {
      blockerSlackDays = Math.round((blockerTask.dueDate - blockerTask.scheduled.endW) / 86400);
    }

    return {
      id: `compound-bump-move-${task.key}-${best.taskKey}`,
      action: 'bump_lower_priority' as const,
      description: `Bump ${blockerTask.name} (priority ${best.priority}) and schedule ${task.name} in the freed slot`,
      score: 25 + (best.priority - taskPriority),
      rank: 0,
      tradeoffs: {
        gains: [
          `${task.name} gets the freed slot — no window extension needed`,
          'Due date unaffected',
        ],
        costs: [
          `${blockerTask.name} must reschedule`,
          blockerSlackDays <= 0
            ? `${blockerTask.name} has no slack — may become late`
            : `${blockerTask.name} has ${blockerSlackDays}d slack`,
        ],
        metrics: { tasksDisplaced: 1, dueDateImpactDays: 0 },
      },
      commands: [
        { type: 'unschedule' as const, taskKey: best.taskKey },
        { type: 'solve' as const, taskKeys: [task.key, best.taskKey], scope: 'targeted' as const, expandChains: true },
      ],
    };
  }

  private tryRedirectOthersPlusSolve(
    task: CTPTask,
    landscape: SchedulingLandscape,
    rootCause: RootCause,
  ): Recommendation | null {
    const report = task.infeasibilityReport;
    if (!report) return null;

    const bottleneck = report.slots?.find((s: any) => s.isBottleneck);
    const bnKey = bottleneck?.resources?.find((r: any) => r.status === 'blocked')?.resourceKey;
    if (!bnKey) return null;

    // Only for tasks with NO alternatives (like ASME welds → only Jack)
    let targetHasAlts = false;
    task.capacityResources?.forEach(tr => {
      if (tr.preferences && tr.preferences.length > 1) targetHasAlts = true;
    });
    if (targetHasAlts) return null;

    // Find other tasks on the bottleneck that CAN move
    const redirectCandidates: CTPTask[] = [];
    landscape.tasks.forEach(t => {
      if (t.key === task.key) return;
      if (t.state !== CTPTaskStateConstants.SCHEDULED) return;
      if (t.pinned) return;
      let isOnBn = false;
      let hasAlt = false;
      t.capacityResources?.forEach(tr => {
        if (tr.scheduledResource === bnKey) isOnBn = true;
        if (tr.preferences && tr.preferences.length > 1) hasAlt = true;
      });
      if (isOnBn && hasAlt) redirectCandidates.push(t);
    });

    if (redirectCandidates.length === 0) return null;

    redirectCandidates.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
    const toRedirect = redirectCandidates.slice(0, 3);
    const redirectKeys = toRedirect.map(t => t.key);
    const redirectNames = toRedirect.map(t => t.name).join(', ');
    const bnRes = landscape.resources?.getEntity(bnKey);
    const bnName = bnRes?.name || bnKey;

    return {
      id: `compound-redirect-others-${task.key}`,
      action: 'redirect_work' as const,
      description: `Move ${toRedirect.length} task(s) off ${bnName} to free capacity for ${task.name}: ${redirectNames}`,
      score: 30,
      rank: 0,
      tradeoffs: {
        gains: [
          `Frees capacity on ${bnName} for ${task.name}`,
          `${task.name} stays on its required resource`,
        ],
        costs: [
          `${toRedirect.length} task(s) redirected to alternative resources`,
        ],
        metrics: { tasksDisplaced: toRedirect.length, dueDateImpactDays: 0 },
      },
      commands: [
        { type: 'set_resource_preference' as const, taskKeys: redirectKeys, resourceKey: bnKey, mode: 'EXCLUDED' },
        { type: 'solve' as const, taskKeys: [...redirectKeys, task.key], scope: 'targeted' as const, expandChains: true },
      ],
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 17: Apply Recommendation
  // ═══════════════════════════════════════

  applyRecommendation(request: ApplyRecommendationRequestDto): ApplyRecommendationResponse {
    const landscape = this.ensureLandscape();

    // 1. Staleness check
    const currentHash = this.computeLandscapeHash();
    if (currentHash !== request.landscapeHash) {
      return {
        success: false,
        stale: true,
        actionsApplied: [],
        reason: 'Landscape has changed since diagnosis. Please re-diagnose.',
      };
    }

    // 2. Snapshot for rollback
    const snapshots = this.captureAllSnapshots();
    const actionsApplied: ApplyRecommendationResponse['actionsApplied'] = [];

    // 3. Execute commands
    try {
      for (const cmd of request.commands) {
        switch (cmd.type) {
          case 'move_to':
            this.moveTo(cmd.taskKey!, { contextHash: cmd.contextHash!, startTime: cmd.startTime! });
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'unschedule': {
            const task = landscape.tasks.getEntity(cmd.taskKey!);
            if (task?.type === CTPTaskTypeConstants.SET_UP || task?.type === CTPTaskTypeConstants.TEAR_DOWN) {
              actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'skipped', detail: 'Setup/teardown managed automatically' });
              break;
            }
            this.unschedule([cmd.taskKey!]);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;
          }

          case 'set_window':
            this.setTaskWindow(cmd.taskKey!, cmd.windowStart ?? undefined, cmd.windowEnd ?? undefined);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'set_priority': {
            this.setTaskPriority(cmd.taskKey!, cmd.priority!);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;
          }

          case 'set_resource_preference':
            for (const tk of (cmd.taskKeys || [cmd.taskKey!])) {
              this.updateResourceMode(tk, cmd.resourceKey!, cmd.mode!, 'capacity');
            }
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'set_order_mode':
            landscape.applyOrderModes({ [cmd.orderKey!]: cmd.mode! });
            actionsApplied.push({ type: cmd.type, taskKey: cmd.orderKey, result: 'ok' });
            break;

          case 'pin':
            this.pinTask(cmd.taskKey!, cmd.pinned ?? true);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'solve': {
            const solveRequest: any = {
              preserveLandscape: true,
              strategy: cmd.strategy,
              taskKeys: cmd.taskKeys,
            };
            if (cmd.scope === 'targeted') solveRequest.protectOthers = true;
            if (cmd.expandChains !== false) solveRequest.expandChains = true;
            this.solve(solveRequest);
            actionsApplied.push({ type: cmd.type, result: 'ok', detail: `scope=${cmd.scope || 'full'}` });
            break;
          }

          case 'dispatch':
            this.dispatchTasks([cmd.taskKey!]);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'start':
            this.startTask(cmd.taskKey!, cmd.startTime);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'hold':
            this.holdTask(cmd.taskKey!, 'Queued hold', undefined);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'resume':
            this.resumeTask(cmd.taskKey!);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'complete':
            this.completeTask(cmd.taskKey!);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'revert_dispatch':
            this.revertDispatch([cmd.taskKey!]);
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
            break;

          case 'resource_downtime':
            this.addResourceDowntime(cmd.resourceKey!, {
              startTime: cmd.startTime,
              endTime: cmd.windowEnd ?? undefined,
              reason: cmd.strategy,
            });
            actionsApplied.push({ type: cmd.type, result: 'ok' });
            break;

          case 'resource_uptime':
            this.endResourceDowntime(cmd.resourceKey!, {});
            actionsApplied.push({ type: cmd.type, result: 'ok' });
            break;
        }
      }
    } catch (err: any) {
      // 4. Rollback on failure
      this.restoreSnapshots(snapshots);
      return {
        success: false,
        rolledBack: true,
        actionsApplied,
        reason: err.message,
      };
    }

    // 5. Return refreshed state
    const newState = this.getState(request.detailLevel ?? 'novice');
    return { success: true, actionsApplied, newState };
  }

  // ═══════════════════════════════════════
  // Endpoint 18: Execute Command Sequence
  // ═══════════════════════════════════════

  executeCommands(request: ExecuteCommandsRequestDto): ApplyRecommendationResponse {
    this.ensureLandscape();

    // Reuse the apply sequencer — auto-populate landscapeHash to skip staleness check
    return this.applyRecommendation({
      recommendationId: request.name || 'manual',
      commands: request.commands,
      landscapeHash: this.computeLandscapeHash(),
      detailLevel: request.detailLevel,
    });
  }

  // ═══════════════════════════════════════
  // Commitment Stack Transitions
  // ═══════════════════════════════════════

  dispatchTasks(taskKeys: string[], actualResources?: string[]): any {
    const landscape = this.ensureLandscape();
    const results: any[] = [];
    for (const key of taskKeys) {
      const task = landscape.tasks.getEntity(key);
      if (!task) { results.push({ taskKey: key, result: 'not_found' }); continue; }
      if (task.state !== CTPTaskStateConstants.SCHEDULED) {
        results.push({ taskKey: key, result: 'skipped', detail: 'Must be scheduled first' });
        continue;
      }
      task.dispatched = true;
      task.dispatchedAt = new Date().toISOString();
      task.materialsPulled = true;
      task.pinned = true;
      if (actualResources?.length) {
        task.actualResources = actualResources;
        if (task.capacityResources) {
          const pairs = this.matchActualsToSlots(actualResources, task.capacityResources, landscape);
          pairs.forEach((resKey, idx) => { task.capacityResources![idx].scheduledResource = resKey; });
        }
      }
      task.commitmentLevel = 'dispatched';
      results.push({ taskKey: key, result: 'ok' });
    }
    return { status: 'ok', results };
  }

  startTask(taskKey: string, actualStart?: string, actualResources?: string[]): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks.getEntity(taskKey);
    if (!task) throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    task.wipstate = CTPWipStateConstants.IN_PROCESS;
    task.actualStart = actualStart || new Date().toISOString();
    if (actualResources?.length) {
      task.actualResources = actualResources;
      if (task.capacityResources) {
        const pairs = this.matchActualsToSlots(actualResources, task.capacityResources, landscape);
        pairs.forEach((resKey, idx) => { task.capacityResources![idx].scheduledResource = resKey; });
      }
    }
    task.pinned = true;
    task.commitmentLevel = 'running';
    return { status: 'ok', taskKey, commitmentLevel: 'running', actualStart: task.actualStart };
  }

  holdTask(taskKey: string, holdReason: string, estimatedResumeTime?: string, holdStart?: string): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks.getEntity(taskKey);
    if (!task) throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    task.wipstate = CTPWipStateConstants.ON_HOLD;
    task.holdReason = holdReason;
    task.estimatedResumeTime = estimatedResumeTime || null;
    task.holdStart = holdStart || new Date().toISOString();
    task.pinned = true;
    task.commitmentLevel = 'on_hold';
    return { status: 'ok', taskKey, commitmentLevel: 'on_hold', holdReason };
  }

  resumeTask(taskKey: string): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks.getEntity(taskKey);
    if (!task) throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    task.wipstate = CTPWipStateConstants.IN_PROCESS;
    task.holdReason = null;
    task.estimatedResumeTime = null;
    task.commitmentLevel = 'running';
    return { status: 'ok', taskKey, commitmentLevel: 'running' };
  }

  completeTask(taskKey: string, actualEnd?: string): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks.getEntity(taskKey);
    if (!task) throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    task.wipstate = CTPWipStateConstants.COMPLETED;
    task.actualEnd = actualEnd || new Date().toISOString();
    task.percentComplete = 100;
    task.includeInSolve = false;
    return { status: 'ok', taskKey, actualEnd: task.actualEnd };
  }

  revertDispatch(taskKeys: string[]): any {
    const landscape = this.ensureLandscape();
    const results: any[] = [];
    for (const key of taskKeys) {
      const task = landscape.tasks.getEntity(key);
      if (!task) { results.push({ taskKey: key, result: 'not_found' }); continue; }
      if (!task.dispatched) {
        results.push({ taskKey: key, result: 'skipped', detail: 'Task is not dispatched' });
        continue;
      }
      task.dispatched = false;
      task.dispatchedAt = null;
      task.materialsPulled = false;
      // Keep pinned — reverts to pinned, not planned
      task.pinned = true;
      results.push({ taskKey: key, result: 'ok' });
    }
    return { status: 'ok', results };
  }

  // ═══════════════════════════════════════
  // Resource Downtime Management
  // ═══════════════════════════════════════

  addResourceDowntime(resourceKey: string, body: { startTime?: string; endTime?: string; reason?: string }): any {
    const landscape = this.ensureLandscape();
    const resource = landscape.resources?.getEntity(resourceKey);
    if (!resource) throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);

    const startW = body.startTime
      ? CTPDateTime.fromDateTime(body.startTime)
      : CTPDateTime.fromDateTime(DateTime.now().toISO()!);
    const INDEFINITE = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER — sentinel for open-ended downtime
    const endW = body.endTime
      ? CTPDateTime.fromDateTime(body.endTime)
      : INDEFINITE;

    const assignment = new CTPInterval();
    assignment.startW = startW;
    assignment.endW = endW;
    assignment.name = body.reason || 'Downtime';
    assignment.type = CTPAssignmentConstants.MAINTENANCE;

    if (!resource.assignments) resource.assignments = new CTPAssignments();
    resource.assignments.add(assignment);

    // resource.available.staticAssignments IS resource.assignments (same reference via setLists).
    // Setting recompute=true tells the engine to call computeAvailable before scheduling,
    // which subtracts all assignments (including this MAINTENANCE one) from original availability.
    resource.recompute = true;

    // Find tasks affected by this downtime
    const affectedTasks: any[] = [];
    landscape.tasks.forEach(task => {
      if (task.state !== CTPTaskStateConstants.SCHEDULED) return;
      if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) return;
      task.capacityResources?.forEach(tr => {
        if (tr.scheduledResource === resourceKey && task.scheduled) {
          const taskStart = task.scheduled.startW;
          const taskEnd = task.scheduled.endW;
          if (taskStart < endW && taskEnd > startW) {
            affectedTasks.push({
              taskKey: task.key,
              taskName: task.name,
              orderKey: task.linkId?.name ?? null,
              commitmentLevel: task.commitmentLevel,
              scheduledStart: CTPDateTime.toDateTime(taskStart).toISO(),
              scheduledEnd: CTPDateTime.toDateTime(taskEnd).toISO(),
            });
          }
        }
      });
    });

    // Auto-hold running tasks
    affectedTasks.forEach(at => {
      if (at.commitmentLevel === 'running') {
        this.holdTask(at.taskKey, `Resource down: ${body.reason || 'Downtime'}`, body.endTime || undefined);
      }
    });

    return {
      status: 'ok',
      resourceKey,
      downtime: {
        startTime: CTPDateTime.toDateTime(startW).toISO(),
        endTime: body.endTime ? CTPDateTime.toDateTime(endW).toISO() : null,
        indefinite: !body.endTime,
        reason: body.reason || 'Downtime',
      },
      affectedTasks,
      affectedCount: affectedTasks.length,
    };
  }

  endResourceDowntime(resourceKey: string, body: { actualUpTime?: string }): any {
    const landscape = this.ensureLandscape();
    const resource = landscape.resources?.getEntity(resourceKey);
    if (!resource) throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);

    const upTimeW = body.actualUpTime
      ? CTPDateTime.fromDateTime(body.actualUpTime)
      : CTPDateTime.fromDateTime(DateTime.now().toISO()!);

    let trimmed = false;
    let removed = false;
    let freedHours = 0;

    if (resource.assignments) {
      let node = resource.assignments.head;
      while (node) {
        const next = node.next;
        const a = node.data;
        if (a.type === CTPAssignmentConstants.MAINTENANCE && a.endW > upTimeW) {
          if (a.startW >= upTimeW) {
            // Downtime hasn't started yet — remove entirely
            // resource.available.staticAssignments IS resource.assignments, so deleteNode covers both
            freedHours += Math.round((a.endW - a.startW) / 3600 * 10) / 10;
            resource.assignments.deleteNode(node);
            removed = true;
          } else if (!body.actualUpTime && upTimeW >= landscape.horizon.endW) {
            // Default bring-up (now) is past horizon end — trimming would still
            // block the full planning horizon, so remove entirely to restore availability
            const capEndW = Math.min(a.endW >= 9_007_199_254_740_991 ? landscape.horizon.endW : a.endW, landscape.horizon.endW);
            freedHours += Math.round(Math.max(0, capEndW - a.startW) / 3600 * 10) / 10;
            resource.assignments.deleteNode(node);
            removed = true;
          } else {
            // Downtime is active and upTime is within horizon — trim to end at up time
            // a.endW mutation propagates to staticAssignments since it's the same object reference
            const originalEndW = a.endW;
            a.endW = upTimeW;
            freedHours += Math.round((originalEndW - upTimeW) / 3600 * 10) / 10;
            trimmed = true;
          }
        }
        node = next;
      }
    }

    resource.recompute = true;
    return {
      status: 'ok',
      resourceKey,
      upTime: CTPDateTime.toDateTime(upTimeW).toISO(),
      trimmed,
      removed,
      freedCapacityHours: Math.round(freedHours * 10) / 10,
    };
  }

  getResourceDowntimes(resourceKey: string): any {
    const landscape = this.ensureLandscape();
    const resource = landscape.resources?.getEntity(resourceKey);
    if (!resource) throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);

    const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
    const downtimes: any[] = [];

    if (resource.assignments) {
      let node = resource.assignments.head;
      while (node) {
        const a = node.data;
        const isIndefinite = a.endW >= 9_007_199_254_740_991;
        const effectiveEndW = isIndefinite ? landscape.horizon.endW : a.endW;
        // Include: within horizon, currently active, or upcoming (endW > nowW)
        const inHorizon = effectiveEndW > landscape.horizon.startW && a.startW < landscape.horizon.endW;
        const currentlyActive = a.startW <= nowW && effectiveEndW > nowW;
        const upcoming = a.endW > nowW;
        if (a.type === CTPAssignmentConstants.MAINTENANCE && (inHorizon || currentlyActive || upcoming)) {
          const status = (a.startW <= nowW && effectiveEndW > nowW) ? 'active'
                       : a.startW > nowW ? 'upcoming' : 'ended';
          downtimes.push({
            startTime: CTPDateTime.toDateTime(a.startW).toISO(),
            endTime: isIndefinite ? null : CTPDateTime.toDateTime(a.endW).toISO(),
            indefinite: isIndefinite,
            reason: a.name || 'Downtime',
            status,
            durationHours: Math.round((a.endW - a.startW) / 3600 * 10) / 10,
          });
        }
        node = node.next;
      }
    }

    downtimes.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });

    return {
      resourceKey,
      resourceName: resource.name || resourceKey,
      downtimes,
      isCurrentlyDown: downtimes.some(d => d.status === 'active'),
    };
  }

  getAllResourceDowntimes(): any {
    const landscape = this.ensureLandscape();
    const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
    const results: any[] = [];

    landscape.resources?.forEach(resource => {
      if (!resource.assignments) return;
      let node = resource.assignments.head;
      while (node) {
        const a = node.data;
        const isIndefinite = a.endW >= 9_007_199_254_740_991;
        const effectiveEndW = isIndefinite ? landscape.horizon.endW : a.endW;
        const inHorizon = effectiveEndW > landscape.horizon.startW && a.startW < landscape.horizon.endW;
        const currentlyActive = a.startW <= nowW && effectiveEndW > nowW;
        const upcoming = a.endW > nowW;
        if (a.type === CTPAssignmentConstants.MAINTENANCE && (inHorizon || currentlyActive || upcoming)) {
          const status = (a.startW <= nowW && effectiveEndW > nowW) ? 'active'
                       : a.startW > nowW ? 'upcoming' : 'ended';
          results.push({
            resourceKey: resource.key,
            resourceName: resource.name || resource.key,
            startTime: CTPDateTime.toDateTime(a.startW).toISO(),
            endTime: isIndefinite ? null : CTPDateTime.toDateTime(a.endW).toISO(),
            indefinite: isIndefinite,
            reason: a.name || 'Downtime',
            status,
          });
        }
        node = node.next;
      }
    });

    results.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });

    return { downtimes: results, activeCount: results.filter(d => d.status === 'active').length };
  }

  updateProgress(taskKey: string, body: { percentComplete?: number; remainingDuration?: number }): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks.getEntity(taskKey);
    if (!task) throw new HttpException({ error: { code: ErrorCodes.TASK_NOT_FOUND, message: `Task ${taskKey} not found`, category: 'validation' } }, HttpStatus.NOT_FOUND);
    if (body.percentComplete != null) task.percentComplete = body.percentComplete;
    if (body.remainingDuration != null) task.remainingDuration = body.remainingDuration;
    return { status: 'ok', taskKey, percentComplete: task.percentComplete, remainingDuration: task.effectiveRemainingDuration() };
  }

  // ═══════════════════════════════════════
  // Chain Expansion
  // ═══════════════════════════════════════

  private expandToChains(taskKeys: string[], landscape: SchedulingLandscape): string[] {
    const expanded = new Set(taskKeys);
    for (const key of taskKeys) {
      const task = landscape.tasks.getEntity(key);
      if (!task?.linkId?.name) continue;
      const chain = landscape.processes.getEntity(task.linkId.name);
      if (chain?.tasks) {
        chain.tasks.forEach(t => expanded.add(t.key));
      }
    }
    return [...expanded];
  }

  // canSolve() is insufficient as an expansion stop predicate at the service layer:
  // dispatched tasks have wipstate=NOT_STARTED and pinned=false until anchorCommittedTasks()
  // runs inside the scheduler. commitmentLevel is set by applyCommitmentStack (called at the
  // top of schedule()) so we check it here to stop at any committed task before anchoring runs.
  private canExpand(task: CTPTask): boolean {
    if (task.commitmentLevel === 'dispatched') return false;
    if (task.commitmentLevel === 'running') return false;
    if (task.commitmentLevel === 'on_hold') return false;
    if (task.commitmentLevel === 'completed') return false;
    return task.canSolve();
  }

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

      // Backward walk via prevLink
      let cursor: CTPTask | null = task.linkId?.prevLink
        ? (landscape.tasks.getEntity(task.linkId.prevLink) ?? null)
        : null;
      while (cursor) {
        if (!this.canExpand(cursor)) break;
        if (accumulator.has(cursor.key)) break;
        accumulator.add(cursor.key);
        cursor = cursor.linkId?.prevLink
          ? (landscape.tasks.getEntity(cursor.linkId.prevLink) ?? null)
          : null;
      }

      // Forward walk via reverse index (successor lookup)
      let reverseIndex = reverseIndexCache.get(task.linkId.name);
      if (!reverseIndex) {
        reverseIndex = new Map<string, CTPTask>();
        chain.tasks.forEach((t: CTPTask) => {
          if (t.linkId?.prevLink) reverseIndex!.set(t.linkId.prevLink, t);
        });
        reverseIndexCache.set(task.linkId.name, reverseIndex);
      }

      let forwardCursor: CTPTask | undefined = reverseIndex.get(task.key);
      while (forwardCursor) {
        if (!this.canExpand(forwardCursor)) break;
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

  // ═══════════════════════════════════════
  // Task Snapshot / Rollback
  // ═══════════════════════════════════════

  captureTaskSnapshot(taskKey: string): TaskSnapshot | null {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return null;
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) return null;
    return this.snapshotTask(task);
  }

  captureAllSnapshots(): Map<string, TaskSnapshot> {
    const snapshots = new Map<string, TaskSnapshot>();
    const landscape = this.stateService.getLandscape();
    if (!landscape) return snapshots;
    landscape.tasks.forEach(task => {
      snapshots.set(task.key, this.snapshotTask(task));
    });
    return snapshots;
  }

  restoreSnapshots(snapshots: Map<string, TaskSnapshot>): void {
    const landscape = this.ensureLandscape();

    // First pass: unschedule anything that was scheduled during the failed sequence
    for (const [key, snapshot] of snapshots) {
      const task = landscape.tasks.getEntity(key);
      if (task && task.state === CTPTaskStateConstants.SCHEDULED &&
          snapshot.state !== CTPTaskStateConstants.SCHEDULED) {
        landscape.unscheduleTask(key, true);
      }
    }

    // Second pass: restore fields
    for (const [, snapshot] of snapshots) {
      this.restoreTaskFromSnapshot(snapshot, landscape);
    }
  }

  private snapshotTask(task: CTPTask): TaskSnapshot {
    const resourceAssignments: { index: number; scheduledResource: string | null }[] = [];
    let idx = 0;
    task.capacityResources?.forEach(tr => {
      resourceAssignments.push({ index: idx, scheduledResource: tr.scheduledResource ?? null });
      idx++;
    });

    return {
      key: task.key,
      state: task.state,
      priority: task.priority ?? 100,
      originalPriority: task.originalPriority ?? 100,
      pinned: task.pinned,
      includeInSolve: task.includeInSolve,
      score: task.score,
      windowStartW: task.window?.startW ?? 0,
      windowEndW: task.window?.endW ?? 0,
      windowOrigStartW: task.window?.origStartW ?? 0,
      windowOrigEndW: task.window?.origEndW ?? 0,
      scheduledStartW: task.scheduled?.startW ?? null,
      scheduledEndW: task.scheduled?.endW ?? null,
      resourceAssignments,
      errors: task.errors.map(e => ({ agent: e.agent, reason: e.reason })),
    };
  }

  private restoreTaskFromSnapshot(snapshot: TaskSnapshot, landscape: SchedulingLandscape): void {
    const task = landscape.tasks.getEntity(snapshot.key);
    if (!task) return;

    task.state = snapshot.state;
    task.priority = snapshot.priority;
    task.originalPriority = snapshot.originalPriority;
    task.pinned = snapshot.pinned;
    task.includeInSolve = snapshot.includeInSolve;
    task.score = snapshot.score;

    if (task.window) {
      task.window.startW = snapshot.windowStartW;
      task.window.endW = snapshot.windowEndW;
      task.window.origStartW = snapshot.windowOrigStartW;
      task.window.origEndW = snapshot.windowOrigEndW;
    }

    task.errors = snapshot.errors.map(e => ({ agent: e.agent, reason: e.reason, type: '' }));

    let ridx = 0;
    snapshot.resourceAssignments.forEach(ra => {
      if (task.capacityResources) {
        let i = 0;
        task.capacityResources.forEach(tr => {
          if (i === ra.index) {
            tr.scheduledResource = ra.scheduledResource ?? undefined;
          }
          i++;
        });
      }
      ridx++;
    });
  }

  // ═══════════════════════════════════════
  // Landscape Hash
  // ═══════════════════════════════════════

  computeLandscapeHash(): string {
    const landscape = this.stateService.getLandscape();
    if (!landscape) return '0';
    let hash = 0;
    landscape.tasks.forEach(task => {
      hash ^= this.simpleHash(task.key);
      hash ^= (task.state << 4);
      hash ^= ((task.priority ?? 100) << 8);
      hash ^= (task.pinned ? 0x10000 : 0);
      if (task.scheduled) {
        hash ^= (task.scheduled.startW & 0xFFFF);
        hash ^= ((task.scheduled.endW & 0xFFFF) << 16);
      }
      if (task.window) {
        hash ^= (task.window.startW & 0xFFFF);
      }
    });
    return hash.toString(36);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  // ═══════════════════════════════════════
  // Commitment Stack
  // ═══════════════════════════════════════

  private resolveHorizonStart(value: string, timezone: string): DateTime {
    const now = DateTime.now().setZone(timezone).startOf('day');
    if (value === 'NOW') return now;
    const offsetMatch = value.match(/^NOW([+-])(\d+)d$/i);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '+' ? 1 : -1;
      const days = parseInt(offsetMatch[2]) * sign;
      return now.plus({ days });
    }
    const parsed = DateTime.fromISO(value, { zone: timezone });
    if (parsed.isValid) return parsed.startOf('day');
    return now;
  }

  private bucketTask(
    task: CTPTask,
    horizonStartW: number,
    horizonEndW: number,
    pastDueRefW: number,  // reference point for "past due" — horizonStart for fixed, ≈now for rolling
  ): 'past_due' | 'active' | 'near_horizon' | 'beyond' {
    const windowStartW = task.window?.startW ?? 0;
    const windowEndW = task.window?.endW ?? 0;
    if (windowEndW < pastDueRefW) return 'past_due';
    if (windowStartW > horizonEndW) return 'beyond';
    if (windowStartW <= horizonEndW && windowEndW > horizonEndW) return 'near_horizon';
    return 'active';
  }

  /**
   * Derive commitmentLevel on every task from wipState + dispatched + pinned.
   * Classification only — no placement, no pinning, no resource assignments.
   * Physical anchoring is handled by basescheduler.anchorCommittedTasks().
   */
  private applyCommitmentStack(landscape: SchedulingLandscape): void {
    landscape.tasks.forEach(task => {
      if (task.wipstate === CTPWipStateConstants.IN_PROCESS) {
        task.commitmentLevel = 'running';
      } else if (task.wipstate === CTPWipStateConstants.ON_HOLD) {
        task.commitmentLevel = 'on_hold';
      } else if (task.wipstate === CTPWipStateConstants.COMPLETED) {
        task.commitmentLevel = 'completed';
      } else if (task.dispatched) {
        task.commitmentLevel = 'dispatched';
      } else if (task.pinned) {
        task.commitmentLevel = 'pinned';
      } else if (task.state === CTPTaskStateConstants.SCHEDULED) {
        task.commitmentLevel = 'planned';
      } else {
        task.commitmentLevel = 'unscheduled';
      }
    });
  }

  /**
   * Pair actual resources to capacity slots 1:1.
   * Returns a Map<slotIndex, actualResourceKey>.
   * Match strategy per slot:
   *   1. Exact key match (slot.resource === actual key)
   *   2. Type match (slot.resource is a type key, actual resource's type matches)
   * Each actual and each slot can only pair once.
   */
  private matchActualsToSlots(
    actualResources: string[],
    capacityResources: { resource: string | undefined; isPrimary: boolean }[],
    landscape: SchedulingLandscape,
  ): Map<number, string> {
    const result = new Map<number, string>();
    const claimed = new Set<string>(); // actual keys already paired

    // Pass 1: exact key matches (highest confidence)
    capacityResources.forEach((slot, idx) => {
      if (!slot.resource) return;
      const exact = actualResources.find(r => !claimed.has(r) && r === slot.resource);
      if (exact) {
        result.set(idx, exact);
        claimed.add(exact);
      }
    });

    // Pass 2: type matches for remaining unmatched slots
    capacityResources.forEach((slot, idx) => {
      if (result.has(idx) || !slot.resource) return;
      // If slot.resource resolves to a real resource, it wasn't matched in pass 1 — skip
      const slotRes = landscape.resources?.getEntity(slot.resource);
      if (slotRes) return;
      // slot.resource is a type/pool key — find an unclaimed actual whose type matches
      const typeMatch = actualResources.find(r => {
        if (claimed.has(r)) return false;
        const res = landscape.resources?.getEntity(r);
        return res && res.type === slot.resource;
      });
      if (typeMatch) {
        result.set(idx, typeMatch);
        claimed.add(typeMatch);
      }
    });

    return result;
  }

  private computeCapacityWaterfall(landscape: SchedulingLandscape): any[] {
    const resourceTasks = new Map<string, Map<string, { tasks: number; seconds: number }>>();

    landscape.tasks.forEach(task => {
      if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) return;

      let resourceKey: string | null = null;
      if (task.actualResources.length) {
        resourceKey = task.actualResources[0];
      } else if (task.state === CTPTaskStateConstants.SCHEDULED) {
        task.capacityResources?.forEach(tr => {
          if (tr.isPrimary && tr.scheduledResource) resourceKey = tr.scheduledResource;
        });
      }
      if (!resourceKey && task.commitmentLevel === 'unscheduled') {
        task.capacityResources?.forEach(tr => {
          if (!resourceKey && tr.isPrimary && tr.preferences?.length > 0) {
            resourceKey = tr.preferences[0].resourceKey;
          }
        });
      }
      if (!resourceKey) return;

      if (!resourceTasks.has(resourceKey)) resourceTasks.set(resourceKey, new Map());
      const levels = resourceTasks.get(resourceKey)!;
      const level = task.commitmentLevel;
      if (!levels.has(level)) levels.set(level, { tasks: 0, seconds: 0 });
      const entry = levels.get(level)!;
      entry.tasks += 1;

      if (level === 'running' || level === 'on_hold') {
        entry.seconds += task.effectiveRemainingDuration();
      } else {
        entry.seconds += task.duration?.duration() ?? 0;
      }
    });

    const levelOrder = ['completed', 'running', 'on_hold', 'dispatched', 'pinned', 'planned', 'unscheduled'];
    const waterfall: any[] = [];

    for (const [resourceKey, levels] of resourceTasks) {
      const resource = landscape.resources?.getEntity(resourceKey);
      if (!resource) continue;

      // Use actual shift availability, not raw horizon
      let totalAvailSec = 0;
      if (resource.original) {
        let ptr: any = resource.original.head;
        while (ptr) { totalAvailSec += (ptr.data.endW - ptr.data.startW); ptr = ptr.next; }
      }
      const totalAvailableHours = totalAvailSec / 3600;

      const layers: any[] = [];
      let cumulative = 0;
      let deadCapacityHours = 0;

      for (const level of levelOrder) {
        const e = levels.get(level);
        if (!e) { layers.push({ level, tasks: 0, hours: 0, cumulative: Math.round(cumulative * 10) / 10 }); continue; }
        const hours = e.seconds / 3600;
        cumulative += hours;
        if (level === 'on_hold') deadCapacityHours += hours;
        layers.push({ level, tasks: e.tasks, hours: Math.round(hours * 10) / 10, cumulative: Math.round(cumulative * 10) / 10 });
      }

      waterfall.push({
        resourceKey,
        resourceName: resource.name || resourceKey,
        totalAvailableHours: Math.round(totalAvailableHours * 10) / 10,
        layers,
        remainingCapacity: Math.round((totalAvailableHours - cumulative) * 10) / 10,
        utilizationPercent: totalAvailableHours > 0 ? Math.round((cumulative / totalAvailableHours) * 1000) / 10 : 0,
        deadCapacityHours: Math.round(deadCapacityHours * 10) / 10,
      });
    }

    waterfall.sort((a, b) => b.utilizationPercent - a.utilizationPercent);
    return waterfall;
  }

  private formatWhereToResponse(result: WhereToResult, reason?: string): WhereToResponseDto {
    const response: WhereToResponseDto = {
      taskKey: result.taskKey,
      taskName: result.taskName,
      currentAssignment: result.currentAssignment ? {
        resources: result.currentAssignment.resources,
        start: CTPDateTime.toDateTime(result.currentAssignment.start).toISO()!,
        end: CTPDateTime.toDateTime(result.currentAssignment.end).toISO()!,
      } : null,
      options: result.options.map(o => ({
        rank: o.rank,
        resources: o.resources,
        start: CTPDateTime.toDateTime(o.startTime).toISO()!,
        end: CTPDateTime.toDateTime(o.endTime).toISO()!,
        latestStart: CTPDateTime.toDateTime(o.latestStart).toISO()!,
        latestEnd: CTPDateTime.toDateTime(o.latestEnd).toISO()!,
        duration: o.duration,
        score: o.score,
        scoreBreakdown: o.scoreBreakdown,
        changeover: o.changeover,
        impact: o.impact,
        contextHash: o.contextHash,
        isBestOnResource: o.isBestOnResource,
      })),
      stats: result.stats,
    };
    if (reason) (response as any).reason = reason;
    return response;
  }

  private extractResults(
    landscape: SchedulingLandscape,
    scheduledTasks: List<CTPTask>,
    stats: SolveStatistics,
    detailLevel: string = 'novice',
  ): CTPSolveResult {
    // Build a set of included task keys for quick lookup
    const includedKeys = new Set<string>();
    scheduledTasks.forEach((t) => includedKeys.add(t.key));

    // Build per-task results
    const tasks: any[] = [];
    let scheduledCount = 0;
    let minStartW = Number.MAX_VALUE;
    let maxEndW = 0;
    let pinnedCount = 0;
    let excludedCount = 0;

    // Track scheduled output per order (orderKey → scheduledQty)
    const orderScheduledQty = new Map<string, number>();

    // Track material consumption (materialKey → consumed qty)
    const materialConsumed = new Map<string, number>();

    // Build process-key → category/name lookup from processes config
    const processCategoryMap = new Map<string, string>();
    const processNameMap = new Map<string, string>();
    const processesConfig = this.configService.getProcesses();
    for (const p of processesConfig) {
      if (p.key && p.category) processCategoryMap.set(p.key, p.category);
      if (p.key && p.name) processNameMap.set(p.key, p.name);
    }

    // Build chain completion map: chainKey → true if ALL tasks in chain are completed
    const chainAllCompleted = new Map<string, boolean>();
    landscape.tasks.forEach(task => {
      const chainKey = task.linkId?.name;
      if (!chainKey) return;
      const prev = chainAllCompleted.get(chainKey);
      const taskCompleted = task.wipstate === CTPWipStateConstants.COMPLETED;
      chainAllCompleted.set(chainKey, prev === undefined ? taskCompleted : (prev && taskCompleted));
    });

    // Post-solve: promote unscheduled → planned for tasks the solver scheduled
    landscape.tasks.forEach(task => {
      if (task.commitmentLevel === 'unscheduled' && task.state === CTPTaskStateConstants.SCHEDULED) {
        task.commitmentLevel = 'planned';
      }
    });

    landscape.tasks.forEach((task) => {
      const isScheduled = task.state === CTPTaskStateConstants.SCHEDULED;
      if (isScheduled) scheduledCount++;
      if (task.pinned) pinnedCount++;
      if (!task.includeInSolve && !task.pinned) excludedCount++;

      if (isScheduled && task.scheduled && task.scheduled.startW >= landscape.horizon.startW
          && task.wipstate !== CTPWipStateConstants.COMPLETED) {
        if (task.scheduled.startW < minStartW) minStartW = task.scheduled.startW;
        if (task.scheduled.endW > maxEndW) maxEndW = task.scheduled.endW;
      }

      const assignedResources: any[] = [];
      task.capacityResources?.forEach((entry) => {
        if (entry.scheduledResource) {
          const resEntity = landscape.resources.getEntity(entry.scheduledResource);
          assignedResources.push({
            resourceKey: entry.scheduledResource,
            isPrimary: entry.isPrimary,
            mode: entry.mode ?? 'ON',
            requestedResource: entry.resource ?? null,
            resourceName: resEntity?.name ?? null,
            resourceClass: resEntity?.type ?? null,
          });
        }
      });

      const materialResources: any[] = [];
      task.materialsResources?.forEach((entry) => {
        const resEntity = landscape.resources.getEntity(entry.resource ?? '');
        materialResources.push({
          resourceKey: entry.resource ?? '',
          isPrimary: entry.isPrimary,
          mode: entry.mode ?? 'ON',
          requestedResource: entry.resource ?? null,
          resourceName: resEntity?.name ?? null,
          resourceClass: resEntity?.type ?? null,
        });
      });

      const orderRef = task.linkId?.name ?? null;
      const outputProductKey = task.outputProductKey ?? null;
      const outputQty = task.outputQty > 0 ? task.outputQty : null;
      const outputScrapRate = task.outputScrapRate > 0 ? task.outputScrapRate : null;
      const process = task.process ?? null;
      const processCategory = process ? (processCategoryMap.get(process) ?? null) : null;
      const processName = process ? (processNameMap.get(process) ?? null) : null;

      // Build input materials array
      const inputMaterials: any[] = [];
      if (task.inputMaterials) {
        task.inputMaterials.forEach((input) => {
          inputMaterials.push({
            productKey: input.productKey,
            requiredQty: input.requiredQty,
            scrapRate: input.scrapRate,
            unitOfMeasure: input.unitOfMeasure,
          });

          if (isScheduled) {
            const existing = materialConsumed.get(input.productKey) ?? 0;
            materialConsumed.set(input.productKey, existing + input.grossQty());
          }
        });
      }

      // Track order fill for scheduled finished-good tasks
      if (isScheduled && orderRef && outputProductKey && task.outputQty > 0) {
        const existing = orderScheduledQty.get(orderRef) ?? 0;
        orderScheduledQty.set(orderRef, existing + task.netOutputQty());
      }

      const taskResult: any = {
        key: task.key,
        name: task.name,
        state: task.state,
        included: includedKeys.has(task.key),
        pinned: task.pinned,
        scheduledStart: task.scheduled && task.scheduled.startW >= landscape.horizon.startW
          ? CTPDateTime.toDateTime(task.scheduled.startW).toISO()
          : null,
        scheduledEnd: task.scheduled && task.scheduled.startW >= landscape.horizon.startW
          ? CTPDateTime.toDateTime(task.scheduled.endW).toISO()
          : null,
        durationSeconds: task.scheduled ? task.scheduled.duration() : (task.duration?.duration() ?? null),
        assignedResources,
        score: task.score === Number.MAX_VALUE ? null : task.score,
        feasible: isScheduled,
        errors: task.errors ?? [],
        infeasibilityReport: task.infeasibilityReport ? this.serializeInfeasibilityReport(task.infeasibilityReport) : null,
        typedAttributes: task.typedAttributes.toArray(),
        orderRef,
        outputProductKey,
        outputQty,
        outputScrapRate,
        inputMaterials,
        process,
        processName,
        processCategory,
        cadenceIntervalMinutes: task.cadenceIntervalMinutes ?? null,
        type: task.type || CTPTaskTypeConstants.PROCESS,
        subType: task.subType ?? null,
        materialResources,
        priority: task.priority,
        originalPriority: task.originalPriority,
        windowStart: task.window ? CTPDateTime.toDateTime(task.window.startW).toISO() : null,
        windowEnd: task.window ? CTPDateTime.toDateTime(task.window.endW).toISO() : null,
        commitmentLevel: task.commitmentLevel,
        dispatched: task.dispatched || false,
        dispatchedAt: task.dispatchedAt || null,
        materialsPulled: task.materialsPulled || false,
        percentComplete: task.percentComplete || 0,
        remainingDuration: (task.commitmentLevel === 'running' || task.commitmentLevel === 'on_hold')
          ? task.effectiveRemainingDuration() : null,
        actualStart: task.actualStart || null,
        actualEnd: task.actualEnd || null,
        actualResources: task.actualResources,
        holdReason: task.commitmentLevel === 'on_hold' ? (task.holdReason || null) : null,
        estimatedResumeTime: task.commitmentLevel === 'on_hold' ? (task.estimatedResumeTime || null) : null,
        isPastDue: task.isPastDue || false,
        pastDueDays: task.pastDueDays || 0,
        originalWindowEnd: task.originalWindowEnd ? CTPDateTime.toDateTime(task.originalWindowEnd).toISO() : null,
        horizonBucket: task.horizonBucket || '',
        predKey: task.linkId?.prevLink ?? null,
      };

      // Per-task cost breakdown (resource + material)
      if (isScheduled && task.scheduled) {
        let resourceCost = 0;
        let materialCost = 0;
        const durationHrs = task.scheduled.duration() / 3600;
        task.capacityResources?.forEach((entry) => {
          if (entry.scheduledResource) {
            const resEntity = landscape.resources.getEntity(entry.scheduledResource);
            if (resEntity?.hourlyRate) {
              resourceCost += resEntity.hourlyRate * durationHrs;
            }
          }
        });
        task.inputMaterials?.forEach((input) => {
          if (input.unitCost > 0) {
            materialCost += input.grossQty() * input.unitCost;
          }
        });
        const totalCost = resourceCost + materialCost;
        if (totalCost > 0) {
          taskResult.cost = {
            total: Math.round(totalCost * 100) / 100,
            resource: Math.round(resourceCost * 100) / 100,
            material: Math.round(materialCost * 100) / 100,
          };
        }
      }

      // Compatible resources — always included (needed for hierarchy filter on unscheduled tasks)
      const compatibleResources: any[] = [];
      task.capacityResources?.forEach((entry) => {
        entry.preferences.forEach((pref) => {
          if (!compatibleResources.find(c => c.resourceKey === pref.resourceKey)) {
            const resEntity = landscape.resources.getEntity(pref.resourceKey);
            compatibleResources.push({
              resourceKey: pref.resourceKey,
              resourceName: resEntity?.name ?? null,
              mode: pref.mode,
              rank: pref.rank,
              speedFactor: pref.speedFactor,
            });
          }
        });
      });
      taskResult.compatibleResources = compatibleResources;

      // Add detail fields for intermediate+
      if (detailLevel !== 'novice') {
        taskResult.blendedScore = task.score !== Number.MAX_VALUE ? task.score : null;
      }

      // Completed tasks: visible if chain has pending work, hidden if entire chain done or standalone
      if (task.wipstate === CTPWipStateConstants.COMPLETED) {
        const chainKey = task.linkId?.name;
        taskResult.visible = chainKey ? !(chainAllCompleted.get(chainKey)) : false;
      } else {
        taskResult.visible = true;
      }

      tasks.push(taskResult);
    });

    // Resource utilization — exclude completed task assignments
    const completedTaskKeys = new Set<string>();
    landscape.tasks.forEach(t => {
      if (t.wipstate === CTPWipStateConstants.COMPLETED) completedTaskKeys.add(t.key);
    });
    const resourceConfigs = this.configService.getResources();
    const resourceConfigMap = new Map(resourceConfigs.map((r) => [r.key, r]));
    const resourceUtilization: any[] = [];
    landscape.resources.forEach((resource) => {
      let totalAvailable = 0;
      if (resource.original) {
        let node = resource.original.head;
        while (node) { totalAvailable += node.data.duration(); node = node.next; }
      }
      let totalAssigned = 0;
      if (resource.assignments) {
        let node = resource.assignments.head;
        while (node) {
          if (!node.data.name || !completedTaskKeys.has(node.data.name)) totalAssigned += node.data.duration();
          node = node.next;
        }
      }

      // Extract interval linked list → array of { start, end, durationSec }
      type IvOut = { start: string; end: string; durationSec: number };
      const extractIntervals = (list: any): IvOut[] => {
        const out: IvOut[] = [];
        if (!list) return out;
        let node = list.head;
        while (node) {
          out.push({
            start: node.data.AbsoluteStartTime.toISO()!,
            end: node.data.AbsoluteEndTime.toISO()!,
            durationSec: node.data.duration(),
          });
          node = node.next;
        }
        return out;
      };

      const availability = extractIntervals(resource.original);
      const assignments = extractIntervals(resource.available.staticAssignments);

      // Compute netAvailable = availability minus task assignments minus MAINTENANCE downtimes
      // Collect MAINTENANCE intervals as ms ranges for subtraction
      const maintenanceRanges: { s: number; e: number }[] = [];
      if (resource.assignments) {
        let mNode = resource.assignments.head;
        while (mNode) {
          if (mNode.data.type === CTPAssignmentConstants.MAINTENANCE) {
            const endW = mNode.data.endW >= 9_007_199_254_740_991 ? landscape.horizon.endW : mNode.data.endW;
            maintenanceRanges.push({
              s: CTPDateTime.toDateTime(mNode.data.startW).toMillis(),
              e: CTPDateTime.toDateTime(endW).toMillis(),
            });
          }
          mNode = mNode.next;
        }
      }

      const netAvailable: IvOut[] = [];
      for (const orig of availability) {
        let slices = [{ s: new Date(orig.start).getTime(), e: new Date(orig.end).getTime() }];
        // Subtract task assignments
        for (const asgn of assignments) {
          const as = new Date(asgn.start).getTime();
          const ae = new Date(asgn.end).getTime();
          const next: { s: number; e: number }[] = [];
          for (const sl of slices) {
            if (ae <= sl.s || as >= sl.e) { next.push(sl); continue; } // no overlap
            if (as > sl.s) next.push({ s: sl.s, e: as }); // left remainder
            if (ae < sl.e) next.push({ s: ae, e: sl.e }); // right remainder
          }
          slices = next;
        }
        // Subtract MAINTENANCE downtimes
        for (const mt of maintenanceRanges) {
          const next: { s: number; e: number }[] = [];
          for (const sl of slices) {
            if (mt.e <= sl.s || mt.s >= sl.e) { next.push(sl); continue; }
            if (mt.s > sl.s) next.push({ s: sl.s, e: mt.s });
            if (mt.e < sl.e) next.push({ s: mt.e, e: sl.e });
          }
          slices = next;
        }
        for (const sl of slices) {
          const durSec = (sl.e - sl.s) / 1000;
          if (durSec > 0) {
            netAvailable.push({
              start: DateTime.fromMillis(sl.s).toISO()!,
              end: DateTime.fromMillis(sl.e).toISO()!,
              durationSec: durSec,
            });
          }
        }
      }

      // Collect all MAINTENANCE downtimes within the planning horizon for Gantt visualization
      const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
      const resourceDowntimes: any[] = [];
      if (resource.assignments) {
        let dtNode = resource.assignments.head;
        while (dtNode) {
          const a = dtNode.data;
          const isIndefiniteDt = a.endW >= 9_007_199_254_740_991;
          const effectiveEndW = isIndefiniteDt ? landscape.horizon.endW : a.endW;
          const inHorizon = effectiveEndW > landscape.horizon.startW && a.startW < landscape.horizon.endW;
          const currentlyActive = a.startW <= nowW && effectiveEndW > nowW;
          if (a.type === CTPAssignmentConstants.MAINTENANCE && (inHorizon || currentlyActive)) {
            resourceDowntimes.push({
              startTime: CTPDateTime.toDateTime(a.startW).toISO(),
              endTime: isIndefiniteDt ? null : CTPDateTime.toDateTime(a.endW).toISO(),
              indefinite: isIndefiniteDt,
              reason: a.name || 'Downtime',
              status: (a.startW <= nowW && effectiveEndW > nowW) ? 'active'
                    : a.startW > nowW ? 'upcoming' : 'ended',
            });
          }
          dtNode = dtNode.next;
        }
      }

      const resConfig = resourceConfigMap.get(resource.key);
      resourceUtilization.push({
        resourceKey: resource.key,
        resourceName: resource.name,
        totalAvailable,
        totalAssigned,
        utilization: totalAvailable > 0
          ? Math.round((totalAssigned / totalAvailable) * 10000) / 100
          : 0,
        workCenter: resConfig?.hierarchy?.level1 ?? '',
        line: resConfig?.hierarchy?.level2 ?? '',
        resourceClass: resConfig?.class ?? resource.class ?? 'REUSABLE',
        resourceType: resConfig?.type ?? resource.type ?? '',
        hourlyRate: resource.hourlyRate ?? 0,
        attributes: resource.typedAttributes?.toArray().map((a: any) => ({
          name: a.name,
          dataType: a.dataType,
          value: a.value?.value ?? a.value,
          category: a.category,
        })) ?? [],
        availability,
        assignments,
        netAvailable,
        downtimes: resourceDowntimes,
        isCurrentlyDown: resourceDowntimes.some(d => d.status === 'active'),
      });
    });

    // Order fill rates
    const orderData = this.configService.getOrders();
    const orders = orderData.map((order) => {
      const scheduledQty = orderScheduledQty.get(order.key) ?? 0;
      return {
        orderKey: order.key,
        name: order.name ?? order.key,
        productKey: order.productKey,
        demandQty: order.demandQty,
        scheduledQty: Math.round(scheduledQty * 100) / 100,
        fillRate: order.demandQty > 0
          ? Math.round((scheduledQty / order.demandQty) * 10000) / 10000
          : 0,
        dueDate: order.dueDate,
        lateDueDate: order.lateDueDate ?? null,
        priority: order.priority ?? 0,
      };
    });

    // Material consumption status with shortage detail
    const materialData = this.configService.getMaterials();
    const materials = materialData.map((mat) => {
      const consumed = materialConsumed.get(mat.key) ?? 0;
      const remaining = Math.round((mat.onHand - consumed) * 100) / 100;

      let firstShortageDate: string | null = null;
      let shortageQty: number | undefined;
      let firstNeedTaskKey: string | null = null;
      let firstNeedTaskName: string | null = null;

      const consumingTasks = tasks
        .filter((t: any) => t.feasible && t.inputMaterials?.some((m: any) => m.productKey === mat.key))
        .sort((a: any, b: any) => {
          const aT = a.scheduledStart ? new Date(a.scheduledStart).getTime() : Infinity;
          const bT = b.scheduledStart ? new Date(b.scheduledStart).getTime() : Infinity;
          return aT - bT;
        });

      let runningBalance = mat.onHand;
      for (const ct of consumingTasks) {
        const input = ct.inputMaterials.find((m: any) => m.productKey === mat.key);
        if (input) {
          const grossQty = input.requiredQty * (1 + (input.scrapRate || 0));
          runningBalance -= grossQty;
          if (runningBalance < 0) {
            firstShortageDate = ct.scheduledStart;
            shortageQty = Math.round(Math.abs(runningBalance) * 100) / 100;
            firstNeedTaskKey = ct.key;
            firstNeedTaskName = ct.name;
            break;
          }
        }
      }

      return {
        materialKey: mat.key,
        materialName: mat.name,
        unit: mat.unit,
        onHand: mat.onHand,
        consumed: Math.round(consumed * 100) / 100,
        remaining,
        incoming: mat.incoming ?? 0,
        incomingDate: mat.incomingDate ?? null,
        firstShortageDate,
        shortageQty,
        firstNeedTaskKey,
        firstNeedTaskName,
      };
    });

    // Products
    const productData = this.configService.getProducts();
    const products = productData.map((p) => ({ key: p.key, name: p.name }));

    // Feasibility: count only PROCESS tasks (exclude SETUP/TEARDOWN and COMPLETED)
    const processTasks = tasks.filter(
      (t) => (t.type === CTPTaskTypeConstants.PROCESS || !t.type)
        && t.commitmentLevel !== 'completed',
    );
    const scheduledProcessTasks = processTasks.filter((t) => t.feasible);
    const setupTaskCount = tasks.length - processTasks.length;

    // Summary
    const totalTasks = landscape.tasks.size();
    const includedProcessTasks = processTasks.length;
    const includedTasks = scheduledTasks.length;
    const skippedTasks = totalTasks - includedTasks;
    const makespan = scheduledCount > 0 && maxEndW > 0 ? maxEndW - minStartW : 0;

    // Colors, terminology, locale
    const colors = this.configService.getColors();
    const terminology = this.configService.getTerminology();
    const locale = this.configService.getLocale();

    // Build stats object for response based on detail level
    const responseStats: any = {
      strategy: stats.strategy,
      totalTimeMs: stats.totalTimeMs,
      engineVersion: 'primary-anchor-v1',
    };
    if (detailLevel !== 'novice') {
      responseStats.propagationTimeMs = stats.propagationTimeMs;
      responseStats.windowsTightened = stats.windowsTightened;
      responseStats.backtrackAttempts = stats.backtrackAttempts;
      responseStats.backtrackSuccesses = stats.backtrackSuccesses;
      responseStats.bumpsPerformed = stats.bumpsPerformed;
    }
    if (detailLevel === 'expert' || detailLevel === 'diagnostic') {
      responseStats.iterations = stats.iterations;
      responseStats.bestIterationFound = stats.bestIterationFound;
      responseStats.contextsEvaluated = stats.contextsEvaluated;
      responseStats.contextsPerTask = stats.contextsPerTask;
      responseStats.totalScore = stats.totalScore;
      responseStats.scoreBreakdown = stats.scoreBreakdown;
    }

    // ─── Critical path analysis ───
    let criticalPathResult: CTPSolveResult['criticalPath'] | undefined;

    if (scheduledCount > 0) {
      const graph = DisjunctiveGraph.buildFromLandscape(landscape);

      // Annotate per-task slack and critical path status
      if (graph.criticalPath) {
        for (const node of graph.nodes) {
          const taskResult = tasks.find((t: any) => t.key === node.key);
          if (taskResult) {
            taskResult.slack = node.totalSlack;
            taskResult.isOnCriticalPath = node.isOnCriticalPath;
            taskResult.criticalBlockId = node.criticalBlockId;
          }
        }

        // Always include — drives the KPI badge and optimizer banner at all detail levels
        criticalPathResult = {
            taskKeys: graph.criticalPath.path.map(p => p.key),
            makespan: graph.criticalPath.makespan,
            makespanFormatted: graph.criticalPath.makespanFormatted,
            bottleneckResource: graph.criticalPath.bottleneckResource,
            criticalTasks: graph.criticalPath.criticalTasks,
            totalTasks: graph.criticalPath.totalTasks,
            avgSlack: graph.criticalPath.avgSlack,
            nearCriticalTasks: graph.criticalPath.nearCriticalTasks,
            segments: graph.criticalPath.segments.map(s => ({
              resourceKey: s.resourceKey,
              resourceName: s.resourceName,
              taskKeys: s.tasks.map(t => t.key),
              totalDuration: s.totalDuration,
            })),
          };
      }
    }

    const result: CTPSolveResult = {
      status: 'ok',
      summary: {
        totalTasks,
        includedTasks: includedProcessTasks,
        scheduledTasks: scheduledProcessTasks.length,
        unscheduledTasks: includedProcessTasks - scheduledProcessTasks.length,
        skippedTasks,
        feasibilityRate: includedProcessTasks > 0
          ? Math.round((scheduledProcessTasks.length / includedProcessTasks) * 10000) / 100
          : 0,
        horizonStart: CTPDateTime.toDateTime(landscape.horizon.startW).toISO()!,
        horizonEnd: CTPDateTime.toDateTime(landscape.horizon.endW).toISO()!,
        makespan,
        setupTasks: setupTaskCount,
        pinnedTasks: pinnedCount,
        excludedTasks: excludedCount,
      },
      stats: responseStats,
      tasks,
      resourceUtilization,
      orders,
      materials,
      products,
      colors,
      terminology,
      locale,
    };

    if (criticalPathResult) {
      result.criticalPath = criticalPathResult;
    }

    // Capacity waterfall (commitment stack layers per resource)
    (result as any).capacityWaterfall = this.computeCapacityWaterfall(landscape);

    // Cost summary (aggregate from per-task costs)
    const tasksWithCost = tasks.filter((t: any) => t.cost?.total > 0);
    if (tasksWithCost.length > 0) {
      const totalCost = tasksWithCost.reduce((s: number, t: any) => s + t.cost.total, 0);
      const costByResource = new Map<string, { name: string; cost: number }>();
      for (const t of tasksWithCost) {
        for (const r of (t.assignedResources || [])) {
          const prev = costByResource.get(r.resourceKey);
          const portion = t.cost.total / (t.assignedResources?.length || 1);
          costByResource.set(r.resourceKey, {
            name: r.resourceName || r.resourceKey,
            cost: (prev?.cost ?? 0) + portion,
          });
        }
      }
      const costByOrder = new Map<string, { name: string; cost: number }>();
      for (const t of tasksWithCost) {
        if (t.orderRef) {
          const prev = costByOrder.get(t.orderRef);
          costByOrder.set(t.orderRef, {
            name: t.orderRef,
            cost: (prev?.cost ?? 0) + t.cost.total,
          });
        }
      }

      (result as any).costSummary = {
        totalScheduleCost: Math.round(totalCost * 100) / 100,
        resourceCost: Math.round(totalCost * 100) / 100,
        costByResource: [...costByResource.entries()]
          .map(([k, v]) => ({ resourceKey: k, resourceName: v.name, cost: Math.round(v.cost * 100) / 100 }))
          .sort((a, b) => b.cost - a.cost),
        costByOrder: [...costByOrder.entries()]
          .map(([k, v]) => ({ orderKey: k, cost: Math.round(v.cost * 100) / 100 }))
          .sort((a, b) => b.cost - a.cost),
      };
    }

    return result;
  }

  private serializeInfeasibilityReport(report: any): any {
    return {
      reason: report.reason,
      bottleneckSlot: report.bottleneckSlot,
      slots: report.slots.map((slot: any) => ({
        slotIndex: slot.slotIndex,
        slotLabel: slot.slotLabel,
        isPrimary: slot.isPrimary,
        status: slot.status,
        bestAvailableMinutes: slot.bestAvailableMinutes,
        isBottleneck: slot.isBottleneck,
        resources: slot.resources.map((r: any) => ({
          resourceKey: r.resourceKey,
          resourceName: r.resourceName,
          availableMinutes: r.availableMinutes,
          totalWindowMinutes: r.totalWindowMinutes,
          status: r.status,
          blockingTasks: r.blockingTasks.map((bt: any) => ({
            taskKey: bt.taskKey,
            taskName: bt.taskName,
            chainKey: bt.chainKey,
            start: CTPDateTime.toDateTime(bt.startW).toISO(),
            end: CTPDateTime.toDateTime(bt.endW).toISO(),
          })),
          note: r.note,
        })),
      })),
      combosGenerated: report.combosGenerated,
      combosSurvivedPropagation: report.combosSurvivedPropagation,
      combosPassedAssignment: report.combosPassedAssignment,
      conflictType: report.conflictType,
      conflictTypeReason: report.conflictTypeReason,
    };
  }

  // ═══════════════════════════════════════
  // Admin — Tenant Management
  // ═══════════════════════════════════════

  private tenantsDir(): string {
    return path.join(this.configService.getConfigRoot(), 'tenants');
  }

  listTenants(): { tenants: { tenantId: string; name: string; vertical: string }[] } {
    const dir = this.tenantsDir();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const tenants: { tenantId: string; name: string; vertical: string; clonedFrom: string | null }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const tenantJson = path.join(dir, entry.name, 'tenant.json');
      if (!fs.existsSync(tenantJson)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(tenantJson, 'utf-8'));
        tenants.push({
          tenantId: data.tenantId || entry.name,
          name: data.name || entry.name,
          vertical: data.vertical || '',
          clonedFrom: data.clonedFrom || null,
        });
      } catch {
        tenants.push({ tenantId: entry.name, name: entry.name, vertical: '', clonedFrom: null });
      }
    }
    return { tenants };
  }

  cloneTenant(sourceTenant: string, targetTenant: string, displayName?: string): { status: string; tenant: string; source: string } {
    // Validate target name
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(targetTenant) || targetTenant.length < 3) {
      throw new HttpException(
        { error: { code: 'INVALID_TENANT_NAME', message: 'Tenant name must be lowercase alphanumeric with hyphens, min 3 chars.', category: 'validation' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const dir = this.tenantsDir();
    const sourceDir = path.join(dir, sourceTenant);
    const targetDir = path.join(dir, targetTenant);

    if (!fs.existsSync(sourceDir)) {
      throw new HttpException(
        { error: { code: 'SOURCE_NOT_FOUND', message: `Source tenant '${sourceTenant}' not found.`, category: 'config' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (fs.existsSync(targetDir)) {
      throw new HttpException(
        { error: { code: 'TENANT_EXISTS', message: `Tenant '${targetTenant}' already exists.`, category: 'config' } },
        HttpStatus.CONFLICT,
      );
    }

    // Recursive copy
    fs.cpSync(sourceDir, targetDir, { recursive: true });

    // Patch tenant.json
    const tenantJsonPath = path.join(targetDir, 'tenant.json');
    if (fs.existsSync(tenantJsonPath)) {
      const data = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
      data.tenantId = targetTenant;
      data.name = displayName || targetTenant.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      data.clonedFrom = sourceTenant;
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(tenantJsonPath, JSON.stringify(data, null, 2), 'utf-8');
    }

    return { status: 'ok', tenant: targetTenant, source: sourceTenant };
  }

  // Protected tenants that shipped with the repo
  private static readonly PROTECTED_TENANTS = new Set([
    'demo-manufacturing', 'stafford-engineering', 'acme-outpatient',
  ]);

  deleteTenant(tenantId: string): { status: string; deleted: string } {
    if (CTPService.PROTECTED_TENANTS.has(tenantId)) {
      throw new HttpException(
        { error: { code: 'DELETE_PROTECTED', message: `Tenant '${tenantId}' is a source tenant and cannot be deleted.`, category: 'admin' } },
        HttpStatus.FORBIDDEN,
      );
    }

    const tenantDir = path.join(this.tenantsDir(), tenantId);
    if (!fs.existsSync(tenantDir)) {
      throw new HttpException(
        { error: { code: 'SOURCE_NOT_FOUND', message: `Tenant '${tenantId}' not found.`, category: 'config' } },
        HttpStatus.NOT_FOUND,
      );
    }

    fs.rmSync(tenantDir, { recursive: true, force: true });
    return { status: 'ok', deleted: tenantId };
  }

  resetTenant(tenantId: string): { status: string; tenant: string; source: string } {
    if (CTPService.PROTECTED_TENANTS.has(tenantId)) {
      throw new HttpException(
        { error: { code: 'DELETE_PROTECTED', message: `Tenant '${tenantId}' is a source tenant and cannot be reset.`, category: 'admin' } },
        HttpStatus.FORBIDDEN,
      );
    }

    const tenantDir = path.join(this.tenantsDir(), tenantId);
    const tenantJsonPath = path.join(tenantDir, 'tenant.json');
    if (!fs.existsSync(tenantJsonPath)) {
      throw new HttpException(
        { error: { code: 'SOURCE_NOT_FOUND', message: `Tenant '${tenantId}' not found.`, category: 'config' } },
        HttpStatus.NOT_FOUND,
      );
    }

    const data = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
    const sourceTenant = data.clonedFrom;
    if (!sourceTenant) {
      throw new HttpException(
        { error: { code: 'NOT_A_CLONE', message: `Tenant '${tenantId}' is not a clone and cannot be reset.`, category: 'admin' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const displayName = data.name;
    // Delete and re-clone
    fs.rmSync(tenantDir, { recursive: true, force: true });
    return this.cloneTenant(sourceTenant, tenantId, displayName);
  }
}
