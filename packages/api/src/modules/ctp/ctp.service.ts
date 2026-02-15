import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import {
  CTPScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  CTPDateTime,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
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
    setupTasks?: number;
  };
  tasks: any[];
  resourceUtilization: any[];
  orders: any[];
  materials: any[];
  colors?: any;
  terminology?: Record<string, string>;
  locale?: any;
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

    // Track scheduled output per order (orderKey → scheduledQty)
    const orderScheduledQty = new Map<string, number>();

    // Track material consumption (materialKey → consumed qty)
    const materialConsumed = new Map<string, number>();

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

      // Extract new fields
      const orderRef = task.linkId?.name ?? null;
      const outputProductKey = task.outputProductKey ?? null;
      const outputQty = task.outputQty > 0 ? task.outputQty : null;
      const outputScrapRate = task.outputScrapRate > 0 ? task.outputScrapRate : null;
      const process = task.process ?? null;

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

          // Track consumption for scheduled tasks
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
        orderRef,
        outputProductKey,
        outputQty,
        outputScrapRate,
        inputMaterials,
        process,
        type: task.type || CTPTaskTypeConstants.PROCESS,
        subType: task.subType ?? null,
        materialResources,
      });
    });

    // Resource utilization
    const resourceConfigs = this.configService.getResources();
    const resourceConfigMap = new Map(resourceConfigs.map((r) => [r.key, r]));
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

      const resConfig = resourceConfigMap.get(resource.key);
      resourceUtilization.push({
        resourceKey: resource.key,
        resourceName: resource.name,
        totalAvailable,
        totalAssigned,
        utilization:
          totalAvailable > 0
            ? Math.round((totalAssigned / totalAvailable) * 10000) / 100
            : 0,
        workCenter: resConfig?.hierarchy?.level1 ?? '',
        line: resConfig?.hierarchy?.level2 ?? '',
        resourceClass: resConfig?.class ?? resource.class ?? 'REUSABLE',
      });
    });

    // Order fill rates
    const orderData = this.configService.getOrders();
    const orders = orderData.map((order) => {
      const scheduledQty = orderScheduledQty.get(order.key) ?? 0;
      return {
        orderKey: order.key,
        productKey: order.productKey,
        demandQty: order.demandQty,
        scheduledQty: Math.round(scheduledQty * 100) / 100,
        fillRate:
          order.demandQty > 0
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

      // Find scheduled tasks consuming this material, sorted by start
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
    const makespan =
      scheduledCount > 0 && maxEndW > 0 ? maxEndW - minStartW : 0;

    // Colors, terminology, locale
    const colors = this.configService.getColors();
    const terminology = this.configService.getTerminology();
    const locale = this.configService.getLocale();

    return {
      status: 'ok',
      summary: {
        totalTasks,
        includedTasks: includedProcessTasks,
        scheduledTasks: scheduledProcessTasks.length,
        unscheduledTasks: includedProcessTasks - scheduledProcessTasks.length,
        skippedTasks,
        feasibilityRate:
          includedProcessTasks > 0
            ? Math.round(
                (scheduledProcessTasks.length / includedProcessTasks) * 10000,
              ) / 100
            : 0,
        horizonStart: CTPDateTime.toDateTime(
          landscape.horizon.startW,
        ).toISO()!,
        horizonEnd: CTPDateTime.toDateTime(landscape.horizon.endW).toISO()!,
        makespan,
        setupTasks: setupTaskCount,
      },
      tasks,
      resourceUtilization,
      orders,
      materials,
      colors,
      terminology,
      locale,
    };
  }
}
