import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  SchedulingLandscape,
  CTPHorizon,
  CTPResource,
  CTPResources,
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPInterval,
  CTPDuration,
  CTPDateTime,
  CTPAppSettings,
  CTPStateChange,
  CTPStateChanges,
  CTPAvailable,
  CTPAssignments,
  CTPLinkId,
  CTPResourcePreference,
} from '@ctp/engine';
import { ConfigService } from '../../config/config.service';
import {
  IHorizonConfig,
  ISettingsConfig,
  IResourceData,
  ITaskData,
  ICalendarData,
  IStateChangeData,
} from '../../config/interfaces/config-store.interface';

@Injectable()
export class StateHydratorService {
  constructor(private readonly configService: ConfigService) {}

  buildLandscape(): SchedulingLandscape {
    const horizonConfig = this.configService.getHorizon();
    const settingsConfig = this.configService.getSettings();
    const resourceData = this.configService.getResources();
    const taskData = this.configService.getTasks();
    const calendarData = this.configService.getCalendars();
    const stateChangeData = this.configService.getStateChanges();

    const horizon = this.hydrateHorizon(horizonConfig);
    const settings = this.hydrateSettings(settingsConfig);
    const resources = this.hydrateResources(resourceData);
    const tasks = this.hydrateTasks(taskData, horizon);

    this.hydrateCalendars(calendarData, resources);

    const stateChanges = this.hydrateStateChanges(stateChangeData);

    const landscape = new SchedulingLandscape(
      horizon.startDate,
      horizon.endDate,
      settings,
    );
    landscape.resources = resources;
    landscape.tasks = tasks;
    landscape.stateChanges = stateChanges;
    landscape.buildProcesses();

    return landscape;
  }

  private hydrateHorizon(config: IHorizonConfig | null): CTPHorizon {
    if (!config) {
      const now = DateTime.now();
      return new CTPHorizon(now, now.plus({ days: 14 }));
    }
    const startDt = DateTime.fromISO(config.startDate);
    const endDt = DateTime.fromISO(config.endDate);
    return new CTPHorizon(startDt, endDt);
  }

  private hydrateSettings(config: ISettingsConfig): CTPAppSettings {
    const settings = new CTPAppSettings();
    if (config.scheduleDirection !== undefined)
      settings.scheduleDirection = config.scheduleDirection;
    if (config.flowAround !== undefined)
      settings.flowAround = config.flowAround;
    if (config.maxLateness !== undefined)
      settings.maxLateness = config.maxLateness;
    if (config.tasksPerLoop !== undefined)
      settings.tasksPerLoop = config.tasksPerLoop;
    if (config.topTasksToSchedule !== undefined)
      settings.topTasksToSchedule = config.topTasksToSchedule;
    if (config.requiresPreds !== undefined)
      settings.requiresPreds = config.requiresPreds;
    if (config.resetUsageAfterProcessChange !== undefined)
      settings.resetUageAfterProcessChange = config.resetUsageAfterProcessChange;
    return settings;
  }

  private hydrateResources(data: IResourceData[]): CTPResources {
    const resources = new CTPResources();
    for (const item of data) {
      const resource = new CTPResource(
        item.class,
        item.type,
        item.name,
        item.key,
      );
      if (item.typedAttributes) {
        resource.typedAttributes.fromArray(item.typedAttributes);
      }
      resources.addEntity(resource);
    }
    return resources;
  }

  private hydrateTasks(data: ITaskData[], horizon: CTPHorizon): CTPTasks {
    const tasks = new CTPTasks();
    for (const item of data) {
      const task = new CTPTask(item.type ?? 'PROCESS', item.name, item.key);

      // Window
      const window = new CTPInterval();
      if (item.windowStart && item.windowEnd) {
        window.fromDates(
          DateTime.fromISO(item.windowStart),
          DateTime.fromISO(item.windowEnd),
          1,
        );
      } else {
        window.set(horizon.startW, horizon.endW, 1);
      }
      task.window = window;

      // Duration
      if (item.durationSeconds !== undefined) {
        task.duration = new CTPDuration(
          item.durationSeconds,
          item.durationQty ?? 1,
          item.durationType ?? 0,
        );
      }

      // Capacity resources
      if (item.capacityResources && item.capacityResources.length > 0) {
        const capList = new CTPTaskResourceList();
        for (let i = 0; i < item.capacityResources.length; i++) {
          const entry = item.capacityResources[i];
          const tr = new CTPTaskResource(entry.resource, entry.isPrimary, i);
          if (entry.qty !== undefined) tr.qty = entry.qty;
          tr.preferences.push(new CTPResourcePreference(entry.resource));
          capList.add(tr);
        }
        capList.sortBySequence();
        task.capacityResources = capList;
      }

      // Materials resources
      if (item.materialsResources && item.materialsResources.length > 0) {
        const matList = new CTPTaskResourceList();
        for (let i = 0; i < item.materialsResources.length; i++) {
          const entry = item.materialsResources[i];
          const tr = new CTPTaskResource(entry.resource, entry.isPrimary, i);
          if (entry.qty !== undefined) tr.qty = entry.qty;
          tr.preferences.push(new CTPResourcePreference(entry.resource));
          matList.add(tr);
        }
        matList.sortBySequence();
        task.materialsResources = matList;
      }

      // Process & subType
      if (item.process) task.process = item.process;
      if (item.subType) task.subType = item.subType;

      // Link ID
      if (item.linkId) {
        task.linkId = new CTPLinkId(
          item.linkId.name,
          item.linkId.type ?? '',
          item.linkId.prevLink,
        );
      }

      // Typed attributes
      if (item.typedAttributes) {
        task.typedAttributes.fromArray(item.typedAttributes);
      }

      tasks.addEntity(task);
    }
    return tasks;
  }

  private hydrateCalendars(
    data: ICalendarData[],
    resources: CTPResources,
  ): void {
    for (const cal of data) {
      const resource = resources.getEntity(cal.resourceKey);
      if (!resource) continue;

      const available = new CTPAvailable();
      for (const iv of cal.intervals) {
        const startW = CTPDateTime.fromDateTime(DateTime.fromISO(iv.start));
        const endW = CTPDateTime.fromDateTime(DateTime.fromISO(iv.end));
        const interval = new CTPInterval(startW, endW, iv.qty);
        if (iv.runRate !== undefined) interval.runRate = iv.runRate;
        available.add(interval);
      }

      resource.original = available;
      resource.assignments = new CTPAssignments();
      resource.available.setLists(resource.original, resource.assignments);
    }
  }

  private hydrateStateChanges(data: IStateChangeData[]): CTPStateChanges {
    const stateChanges = new CTPStateChanges();
    for (const item of data) {
      const sc = new CTPStateChange(
        item.resourceType,
        item.type,
        item.fromState,
        item.toState,
      );
      if (item.duration !== undefined) sc.duration = item.duration;
      if (item.penalty !== undefined) sc.penalty = item.penalty;
      stateChanges.addEntity(sc);
    }
    return stateChanges;
  }
}
