import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import {
  CTPScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  CTPDateTime,
  CTPTaskStateConstants,
  List,
  CTPTask,
  SchedulingLandscape,
} from '@ctp/engine';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';
import { SolveRequestDto } from './dto/solve-request.dto';

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
  };
  tasks: any[];
  resourceUtilization: any[];
}

@Injectable()
export class CTPService {
  private lastResult: CTPSolveResult | null = null;

  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
  ) {}

  solve(request?: SolveRequestDto): CTPSolveResult {
    // Reload fresh landscape before each solve
    this.stateService.syncFromConfig();

    const landscape = this.stateService.getLandscape();
    if (!landscape) {
      throw new HttpException('State not loaded.', HttpStatus.BAD_REQUEST);
    }

    const scoringConfig = this.configService.getScoring();
    if (!scoringConfig) {
      throw new HttpException(
        'Scoring configuration not found.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Build scoring
    const scoring = new CTPScoring(scoringConfig.name, scoringConfig.key);
    for (const rule of scoringConfig.rules) {
      const config = new CTPScoringConfiguration(
        rule.ruleName,
        rule.weight,
        rule.objective,
      );
      config.includeInSolve = rule.includeInSolve;
      config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }

    // Create and initialize scheduler
    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon,
      landscape.tasks,
      landscape.resources,
      landscape.stateChanges,
      landscape.processes,
    );
    scheduler.initSettings(landscape.appSettings);
    scheduler.initScoring(scoring);

    // Build task list based on filter
    const taskList = this.buildTaskList(landscape, request);

    // Run scheduler
    if (taskList.length > 0) {
      scheduler.schedule(taskList);
    }

    // Extract results
    const result = this.extractResults(landscape, taskList);
    this.lastResult = result;
    return result;
  }

  getLastResult(): CTPSolveResult | null {
    return this.lastResult;
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
      return taskList;
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
      return taskList;
    }

    // Default: all tasks
    landscape.tasks.forEach((t) => taskList.add(t));
    return taskList;
  }

  private extractResults(
    landscape: SchedulingLandscape,
    scheduledTasks: List<CTPTask>,
  ): CTPSolveResult {
    // Build a set of included task keys for quick lookup
    const includedKeys = new Set<string>();
    scheduledTasks.forEach((t) => includedKeys.add(t.key));

    // Build per-task results
    const tasks: any[] = [];
    let scheduledCount = 0;
    let minStartW = Number.MAX_VALUE;
    let maxEndW = 0;

    landscape.tasks.forEach((task) => {
      const isScheduled =
        task.state === CTPTaskStateConstants.SCHEDULED;
      if (isScheduled) scheduledCount++;

      if (isScheduled && task.scheduled) {
        if (task.scheduled.startW < minStartW)
          minStartW = task.scheduled.startW;
        if (task.scheduled.endW > maxEndW) maxEndW = task.scheduled.endW;
      }

      const assignedResources: any[] = [];
      task.capacityResources?.forEach((entry) => {
        if (entry.scheduledResource) {
          assignedResources.push({
            resourceKey: entry.scheduledResource,
            isPrimary: entry.isPrimary,
          });
        }
      });

      tasks.push({
        key: task.key,
        name: task.name,
        state: task.state,
        included: includedKeys.has(task.key),
        scheduledStart: task.scheduled
          ? CTPDateTime.toDateTime(task.scheduled.startW).toISO()
          : null,
        scheduledEnd: task.scheduled
          ? CTPDateTime.toDateTime(task.scheduled.endW).toISO()
          : null,
        durationSeconds: task.scheduled ? task.scheduled.duration() : null,
        assignedResources,
        score:
          task.score === Number.MAX_VALUE ? null : task.score,
        feasible: isScheduled,
        errors: task.errors ?? [],
        typedAttributes: task.typedAttributes.toArray(),
      });
    });

    // Resource utilization
    const resourceUtilization: any[] = [];
    landscape.resources.forEach((resource) => {
      let totalAvailable = 0;
      if (resource.original) {
        let node = resource.original.head;
        while (node) {
          totalAvailable += node.data.duration();
          node = node.next;
        }
      }

      let totalAssigned = 0;
      if (resource.assignments) {
        let node = resource.assignments.head;
        while (node) {
          totalAssigned += node.data.duration();
          node = node.next;
        }
      }

      resourceUtilization.push({
        resourceKey: resource.key,
        resourceName: resource.name,
        totalAvailable,
        totalAssigned,
        utilization:
          totalAvailable > 0
            ? Math.round((totalAssigned / totalAvailable) * 10000) / 100
            : 0,
      });
    });

    // Summary
    const totalTasks = landscape.tasks.size();
    const includedTasks = scheduledTasks.length;
    const unscheduledTasks = includedTasks - scheduledCount;
    const skippedTasks = totalTasks - includedTasks;
    const makespan =
      scheduledCount > 0 && maxEndW > 0 ? maxEndW - minStartW : 0;

    return {
      status: 'ok',
      summary: {
        totalTasks,
        includedTasks,
        scheduledTasks: scheduledCount,
        unscheduledTasks,
        skippedTasks,
        feasibilityRate:
          includedTasks > 0
            ? Math.round((scheduledCount / includedTasks) * 10000) / 100
            : 0,
        horizonStart: CTPDateTime.toDateTime(
          landscape.horizon.startW,
        ).toISO()!,
        horizonEnd: CTPDateTime.toDateTime(landscape.horizon.endW).toISO()!,
        makespan,
      },
      tasks,
      resourceUtilization,
    };
  }
}
