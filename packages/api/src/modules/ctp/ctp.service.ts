import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  CTPScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  CTPDateTime,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
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
  CTPResourcePreference,
} from '@ctp/engine';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';
import { StrategyConfigService } from '../../config/strategy-config.service';
import { LoggerService } from '../../logging/logger.service';
import { SolveRequestDto } from './dto/solve-request.dto';
import { WhereToRequestDto, WhereToResponseDto, MoveToRequestDto, MoveToResponseDto } from './dto/whereto.dto';
import { CTPQueryDto, CTPQueryResponse, CTPQueryOption, ChainTemplatesResponse } from './dto/ctp-query.dto';

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
}

@Injectable()
export class CTPService {
  private results = new Map<string, CTPSolveResult>();

  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
    private readonly strategyConfigService: StrategyConfigService,
    private readonly logger: LoggerService,
  ) {}

  // ═══════════════════════════════════════
  // Endpoint 1: Solve with Overrides
  // ═══════════════════════════════════════

  solve(request?: SolveRequestDto): CTPSolveResult {
    const startTime = Date.now();

    // Reload fresh landscape before each solve
    this.stateService.syncFromConfig();

    const landscape = this.stateService.getLandscape();
    if (!landscape) {
      throw new HttpException('State not loaded.', HttpStatus.BAD_REQUEST);
    }

    // Hydrate due dates from orders onto tasks (terminal tasks only)
    landscape.hydrateDueDates();

    const requestedStrategy = request?.strategy || landscape.appSettings?.solverStrategy || 'Chain';

    // Validate strategy key against tenant config
    if (request?.strategy && !this.strategyConfigService.validateStrategy(request.strategy)) {
      const available = this.strategyConfigService.getStrategiesForTenant()
        .strategies.map(s => s.key).join(', ');
      throw new HttpException(
        `Invalid strategy '${request.strategy}'. Available: ${available}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Map to engine strategy (handles custom strategy → engine handler mapping)
    const strategy = this.strategyConfigService.getEngineStrategy(requestedStrategy);
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

    // ─── 2. Constraint propagation ───
    const propStart = Date.now();
    stats.windowsTightened = landscape.propagateConstraints();
    stats.propagationTimeMs = Date.now() - propStart;

    // ─── 3. Build scoring ───
    const scoringSource = request?.scoringOverrides ? 'override' : 'config';
    const scoringRules = request?.scoringOverrides ?? this.configService.getScoring()?.rules;
    if (!scoringRules || scoringRules.length === 0) {
      throw new HttpException(
        'Scoring configuration not found.',
        HttpStatus.BAD_REQUEST,
      );
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
    const scheduler = new CTPScheduler();
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

    const taskList = this.buildTaskList(landscape, request);

    let engineSolveResult: EngineSolveResult | undefined;
    if (taskList.length > 0) {
      engineSolveResult = scheduler.schedule(taskList);
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
    if (engineSolveResult) {
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
    });

    return result;
  }

  getLastResult(): CTPSolveResult | null {
    return this.results.get(this.configService.getTenantId()) ?? null;
  }

  // ═══════════════════════════════════════
  // Endpoint 2: Unschedule Single Task
  // ═══════════════════════════════════════

  unscheduleTask(taskKey: string, resetScore: boolean = true): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);

    if (!task) {
      throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
    }
    if (task.pinned) {
      throw new HttpException(`Task ${taskKey} is pinned and cannot be unscheduled`, HttpStatus.CONFLICT);
    }
    if (task.state !== CTPTaskStateConstants.SCHEDULED) {
      throw new HttpException(`Task ${taskKey} is not currently scheduled`, HttpStatus.BAD_REQUEST);
    }

    const previousStart = task.scheduled?.startW;
    const previousEnd = task.scheduled?.endW;
    const previousResources = task.capacityResources
      ?.map(tr => tr.scheduledResource)
      .filter(Boolean) as string[] || [];

    // Use scheduler to also remove associated state change tasks (SETUP/TEARDOWN/changeover)
    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon, landscape.tasks, landscape.resources,
      landscape.stateChanges, landscape.processes,
    );
    const success = scheduler.unscheduleTaskWithStateChanges(taskKey, resetScore);

    if (!success) {
      throw new HttpException(`Failed to unschedule task ${taskKey}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return {
      taskKey,
      success: true,
      previousSchedule: {
        start: previousStart ? CTPDateTime.toDateTime(previousStart).toISO() : null,
        end: previousEnd ? CTPDateTime.toDateTime(previousEnd).toISO() : null,
        resources: previousResources,
      },
      affectedResources: this.getAffectedResourceUtils(landscape, previousResources),
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 3: Schedule Single Task
  // ═══════════════════════════════════════

  scheduleTask(taskKey: string, request?: any): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);

    if (!task) {
      throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
    }
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      throw new HttpException(`Task ${taskKey} is already scheduled. Unschedule first.`, HttpStatus.BAD_REQUEST);
    }
    if (task.pinned) {
      throw new HttpException(`Task ${taskKey} is pinned`, HttpStatus.BAD_REQUEST);
    }

    // Propagate constraints
    landscape.propagateConstraints();

    // Build scoring
    const scoringConfig = this.configService.getScoring();
    if (!scoringConfig) {
      throw new HttpException('Scoring configuration not found.', HttpStatus.BAD_REQUEST);
    }
    const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
    for (const rule of scoringConfig.rules) {
      const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
      config.includeInSolve = rule.includeInSolve;
      config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }

    // Use existing scheduler to solve just this task
    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon, landscape.tasks, landscape.resources,
      landscape.stateChanges, landscape.processes,
    );
    scheduler.initSettings(landscape.appSettings);
    scheduler.initScoring(scoring);

    const taskList = new List<CTPTask>();
    taskList.add(task);
    scheduler.schedule(taskList);

    const isScheduled = task.state === CTPTaskStateConstants.SCHEDULED;

    return {
      taskKey,
      success: isScheduled,
      scheduledStart: task.scheduled ? CTPDateTime.toDateTime(task.scheduled.startW).toISO() : null,
      scheduledEnd: task.scheduled ? CTPDateTime.toDateTime(task.scheduled.endW).toISO() : null,
      assignedResources: task.capacityResources?.map(tr => ({
        resourceKey: tr.scheduledResource || tr.resource || '',
        mode: tr.mode,
      })) || [],
      blendedScore: task.score !== Number.MAX_VALUE ? task.score : null,
      errors: task.errors.map(e => ({ agent: e.agent, reason: e.reason })),
    };
  }

  // ═══════════════════════════════════════
  // Endpoint 4: Update Resource Mode
  // ═══════════════════════════════════════

  updateResourceMode(taskKey: string, resourceKey: string, mode: string, type: string): any {
    const landscape = this.ensureLandscape();
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) {
      throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
    }

    const resourceList = type === 'capacity' ? task.capacityResources : task.materialsResources;
    if (!resourceList) {
      throw new HttpException(`No ${type} resources on task ${taskKey}`, HttpStatus.NOT_FOUND);
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
      throw new HttpException(`Resource ${resourceKey} not found on task ${taskKey}`, HttpStatus.NOT_FOUND);
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
      throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
    }

    if (pinned && task.state !== CTPTaskStateConstants.SCHEDULED) {
      throw new HttpException(`Cannot pin task ${taskKey} — it is not currently scheduled`, HttpStatus.BAD_REQUEST);
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
      throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
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
      throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);
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
      throw new HttpException(
        `Chain "${request.sourceChainKey}" not found`,
        HttpStatus.NOT_FOUND,
      );
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

    // 8. Compute promise status if needByDate provided
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

    return {
      orderName: request.orderName,
      sourceChainKey: request.sourceChainKey,
      feasible: options.length > 0,
      options,
      infeasibilityReason: options.length === 0
        ? `No feasible placement found for "${request.orderName}" using chain ${request.sourceChainKey}`
        : null,
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
      if (!ls) throw new HttpException('State not loaded.', HttpStatus.BAD_REQUEST);
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

  private buildTaskList(
    landscape: SchedulingLandscape,
    request?: SolveRequestDto,
  ): List<CTPTask> {
    const taskList = new List<CTPTask>();

    // Priority: taskKeys > filter > all
    if (request?.taskKeys) {
      for (const key of request.taskKeys) {
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
      throw new HttpException('Scoring configuration not found.', HttpStatus.BAD_REQUEST);
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

    landscape.tasks.forEach((task) => {
      const isScheduled = task.state === CTPTaskStateConstants.SCHEDULED;
      if (isScheduled) scheduledCount++;
      if (task.pinned) pinnedCount++;
      if (!task.includeInSolve && !task.pinned) excludedCount++;

      if (isScheduled && task.scheduled) {
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
        scheduledStart: task.scheduled
          ? CTPDateTime.toDateTime(task.scheduled.startW).toISO()
          : null,
        scheduledEnd: task.scheduled
          ? CTPDateTime.toDateTime(task.scheduled.endW).toISO()
          : null,
        durationSeconds: task.scheduled ? task.scheduled.duration() : null,
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
      };

      // Add detail fields for intermediate+
      if (detailLevel !== 'novice') {
        taskResult.blendedScore = task.score !== Number.MAX_VALUE ? task.score : null;

        // Compatible resources — full preference list for each capacity slot
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
      }

      tasks.push(taskResult);
    });

    // Resource utilization
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
        while (node) { totalAssigned += node.data.duration(); node = node.next; }
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

      // Compute netAvailable = availability minus assignments (engine's staticAvailable can be stale)
      const netAvailable: IvOut[] = [];
      for (const orig of availability) {
        let slices = [{ s: new Date(orig.start).getTime(), e: new Date(orig.end).getTime() }];
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
        availability,
        assignments,
        netAvailable,
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

    // Feasibility: count only PROCESS tasks (exclude SETUP/TEARDOWN)
    const processTasks = tasks.filter(
      (t) => t.type === CTPTaskTypeConstants.PROCESS || !t.type,
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

    return {
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
}
