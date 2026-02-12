import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  CTPHorizon,
  CTPResource,
  CTPResources,
  CTPTask,
  CTPTasks,
  CTPAvailable,
  CTPAssignments,
  CTPInterval,
  CTPDuration,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPResourcePreference,
  CTPStateChange,
  CTPStateChanges,
  CTPScoring,
  CTPScoringConfiguration,
  CTPAppSettings,
  CTPLinkId,
  CTPDateTime,
  SchedulingLandscape,
  CTPDurationConstants,
} from '@ctp/engine';
import { SyncStateDto } from './dto/sync-state.dto';
import { ResourceDto, IntervalDto } from './dto/resource.dto';
import { TaskDto } from './dto/task.dto';
import { StateChangeDto } from './dto/state-change.dto';

@Injectable()
export class StateService {
  private readonly landscapes = new Map<string, SchedulingLandscape>();

  sync(dto: SyncStateDto) {
    const tenantId = dto.tenantId ?? 'default';

    // 1. Hydrate horizon
    const startDt = DateTime.fromISO(dto.horizon.startDate);
    const endDt = DateTime.fromISO(dto.horizon.endDate);
    const horizon = new CTPHorizon(startDt, endDt);

    // 2. Hydrate resources
    const resources = new CTPResources();
    for (const rDto of dto.resources) {
      const resource = this.hydrateResource(rDto);
      resources.addEntity(resource);
    }

    // 3. Hydrate tasks
    const tasks = new CTPTasks();
    for (const tDto of dto.tasks) {
      const task = this.hydrateTask(tDto, horizon);
      tasks.addEntity(task);
    }

    // 4. Hydrate state changes
    const stateChanges = new CTPStateChanges();
    if (dto.stateChanges) {
      for (const scDto of dto.stateChanges) {
        const sc = this.hydrateStateChange(scDto);
        stateChanges.addEntity(sc);
      }
    }

    // 5. Hydrate scoring
    const scoring = new CTPScoring(dto.scoring.name, dto.scoring.key);
    for (const rule of dto.scoring.rules) {
      const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective ?? 0);
      if (rule.includeInSolve !== undefined) config.includeInSolve = rule.includeInSolve;
      if (rule.penaltyFactor !== undefined) config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }

    // 6. Hydrate settings
    const appSettings = new CTPAppSettings();
    if (dto.settings) {
      if (dto.settings.scheduleDirection !== undefined)
        appSettings.scheduleDirection = dto.settings.scheduleDirection;
      if (dto.settings.flowAround !== undefined)
        appSettings.flowAround = dto.settings.flowAround;
      if (dto.settings.maxLateness !== undefined)
        appSettings.maxLateness = dto.settings.maxLateness;
      if (dto.settings.tasksPerLoop !== undefined)
        appSettings.tasksPerLoop = dto.settings.tasksPerLoop;
      if (dto.settings.topTasksToSchedule !== undefined)
        appSettings.topTasksToSchedule = dto.settings.topTasksToSchedule;
      if (dto.settings.requiresPreds !== undefined)
        appSettings.requiresPreds = dto.settings.requiresPreds;
    }

    // 7. Build landscape
    const landscape = new SchedulingLandscape(startDt, endDt, appSettings);
    landscape.tasks = tasks;
    landscape.resources = resources;
    landscape.stateChanges = stateChanges;
    landscape.buildProcesses();

    // 8. Store
    this.landscapes.set(tenantId, landscape);

    return {
      tenantId,
      taskCount: tasks.size(),
      resourceCount: resources.size(),
      horizon: {
        start: dto.horizon.startDate,
        end: dto.horizon.endDate,
      },
    };
  }

  getLandscape(tenantId: string): SchedulingLandscape | undefined {
    return this.landscapes.get(tenantId);
  }

  private hydrateResource(dto: ResourceDto): CTPResource {
    const resource = new CTPResource(dto.resourceClass, dto.type, dto.name, dto.key);

    if (dto.hierarchyGroup) {
      resource.hierarchy.first = dto.hierarchyGroup;
    }

    // Build availability linked list
    const available = new CTPAvailable();
    for (const iv of dto.availability) {
      const interval = this.toInterval(iv);
      available.add(interval);
    }
    resource.original = available;

    // Build assignments if present
    if (dto.assignments && dto.assignments.length > 0) {
      const assignments = new CTPAssignments();
      for (const iv of dto.assignments) {
        const interval = this.toInterval(iv);
        assignments.add(interval);
      }
      resource.assignments = assignments;
    }

    return resource;
  }

  private hydrateTask(dto: TaskDto, horizon: CTPHorizon): CTPTask {
    const task = new CTPTask(dto.type ?? 'PROCESS', dto.name, dto.key);
    task.sequence = dto.sequence;
    if (dto.rank !== undefined) task.rank = dto.rank;
    if (dto.process) task.process = dto.process;

    // Duration
    const dur = new CTPDuration(
      dto.duration.seconds,
      dto.duration.qty ?? 1.0,
      dto.duration.durationType ?? CTPDurationConstants.FIXED_DURATION,
    );
    task.duration = dur;

    // Window (default to horizon bounds)
    const window = new CTPInterval();
    if (dto.window) {
      window.fromDates(
        DateTime.fromISO(dto.window.startTime),
        DateTime.fromISO(dto.window.endTime),
        1,
      );
    } else {
      window.set(horizon.startW, horizon.endW, 1);
    }
    task.window = window;

    // Capacity resources
    if (dto.capacityResources && dto.capacityResources.length > 0) {
      const capList = new CTPTaskResourceList();
      for (let i = 0; i < dto.capacityResources.length; i++) {
        const crDto = dto.capacityResources[i];
        const tr = new CTPTaskResource(crDto.resourceType, crDto.isPrimary, i);
        for (const pref of crDto.preferences) {
          const rp = new CTPResourcePreference(pref.resourceKey);
          if (pref.speedFactor !== undefined) rp.speedFactor = pref.speedFactor;
          tr.preferences.push(rp);
        }
        capList.add(tr);
      }
      capList.sortBySequence();
      task.capacityResources = capList;
    }

    // Materials resources
    if (dto.materialsResources && dto.materialsResources.length > 0) {
      const matList = new CTPTaskResourceList();
      for (let i = 0; i < dto.materialsResources.length; i++) {
        const mrDto = dto.materialsResources[i];
        const tr = new CTPTaskResource(mrDto.resourceType, mrDto.isPrimary, i);
        for (const pref of mrDto.preferences) {
          const rp = new CTPResourcePreference(pref.resourceKey);
          if (pref.speedFactor !== undefined) rp.speedFactor = pref.speedFactor;
          tr.preferences.push(rp);
        }
        matList.add(tr);
      }
      matList.sortBySequence();
      task.materialsResources = matList;
    }

    // Link ID
    if (dto.linkId) {
      task.linkId = new CTPLinkId(dto.linkId.name, dto.linkId.type ?? '', dto.linkId.prevLink);
    }

    return task;
  }

  private hydrateStateChange(dto: StateChangeDto): CTPStateChange {
    const sc = new CTPStateChange(
      dto.resourceType,
      dto.changeType,
      dto.fromState,
      dto.toState,
    );
    if (dto.duration !== undefined) sc.duration = dto.duration;
    if (dto.penalty !== undefined) sc.penalty = dto.penalty;
    return sc;
  }

  private toInterval(dto: IntervalDto): CTPInterval {
    const startW = CTPDateTime.fromDateTime(DateTime.fromISO(dto.startTime));
    const endW = CTPDateTime.fromDateTime(DateTime.fromISO(dto.endTime));
    const interval = new CTPInterval(startW, endW, dto.qty ?? 1);
    if (dto.runRate !== undefined) interval.runRate = dto.runRate;
    return interval;
  }
}
