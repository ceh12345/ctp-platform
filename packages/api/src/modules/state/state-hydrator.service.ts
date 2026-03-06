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
  CTPTaskMaterialInput,
  CTPTaskMaterialInputList,
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

    const locale = this.configService.getLocale();
    const tenantTimezone: string = locale?.timezone ?? 'UTC';
    this.hydrateCalendars(calendarData, resources, horizon, tenantTimezone);

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

    // Resolve cadence profiles per task
    this.hydrateCadences(landscape);

    return landscape;
  }

  private hydrateCadences(landscape: SchedulingLandscape): void {
    // Build cadence key → intervalMinutes lookup
    const cadences = this.configService.getCadences();
    const cadenceMap = new Map<string, number>();
    for (const c of cadences) {
      cadenceMap.set(c.key, c.intervalMinutes);
    }
    if (cadenceMap.size === 0) return;

    // Build process key → cadence key lookup
    const processConfigs = this.configService.getProcesses();
    const processCadenceMap = new Map<string, string>();
    for (const p of processConfigs) {
      if (p.cadence) processCadenceMap.set(p.key, p.cadence);
    }

    // Build task key → cadence override lookup
    const taskConfigs = this.configService.getTasks();
    const taskCadenceMap = new Map<string, string | null>();
    for (const t of taskConfigs) {
      if (t.cadence !== undefined) taskCadenceMap.set(t.key, t.cadence ?? null);
    }

    // Resolve effective cadence for each task
    landscape.tasks?.forEach(task => {
      // Task-level override takes priority
      if (taskCadenceMap.has(task.key)) {
        const override = taskCadenceMap.get(task.key);
        if (override === null) return; // explicitly disabled
        const interval = cadenceMap.get(override!);
        if (interval) task.cadenceIntervalMinutes = interval;
        return;
      }

      // Fall back to process-level cadence (skip SETUP/TEARDOWN — only PROCESS tasks)
      if (task.process && task.type !== 'SETUP' && task.type !== 'TEARDOWN') {
        const cadenceKey = processCadenceMap.get(task.process);
        if (cadenceKey) {
          const interval = cadenceMap.get(cadenceKey);
          if (interval) task.cadenceIntervalMinutes = interval;
        }
      }
    });
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

  /**
   * Convert typedAttributes from either format:
   * - Array format (manufacturing): [{ name, dataType, value: { type, value }, category, sequence }]
   * - Object format (healthcare): { key: value, key2: [v1, v2] }
   * Returns the array format expected by CTPTypedAttributes.fromArray()
   */
  private normalizeTypedAttributes(attrs: any): any[] | null {
    if (!attrs) return null;
    if (Array.isArray(attrs)) return attrs;
    // Convert plain object to array format
    const result: any[] = [];
    let seq = 0;
    for (const [key, val] of Object.entries(attrs)) {
      let dataType: string;
      let value: any;
      if (Array.isArray(val)) {
        dataType = 'list';
        value = { type: 'list', value: val };
      } else if (typeof val === 'number') {
        dataType = 'number';
        value = { type: 'number', value: val };
      } else {
        dataType = 'enum';
        value = { type: 'enum', value: String(val) };
      }
      result.push({ name: key, dataType, value, category: '', sequence: seq++ });
    }
    return result;
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
      if (item.hierarchy?.level1) resource.hierarchy.first = item.hierarchy.level1;
      if (item.hierarchy?.level2) resource.hierarchy.second = item.hierarchy.level2;
      const resAttrs = this.normalizeTypedAttributes(item.typedAttributes);
      if (resAttrs) {
        resource.typedAttributes.fromArray(resAttrs);
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

      // Capacity resources — supports two formats:
      // FLAT (manufacturing):   { resource: "CNC-01", isPrimary: true, preferences?: ["CNC-01","CNC-02"] }
      // GROUPED (healthcare):   { isPrimary: true, preferences: [{ resource: "OR-01", rank: 1 }, ...] }
      if (item.capacityResources && item.capacityResources.length > 0) {
        const capList = new CTPTaskResourceList();
        for (let i = 0; i < item.capacityResources.length; i++) {
          const entry: any = item.capacityResources[i];
          const isGrouped = Array.isArray(entry.preferences) &&
            entry.preferences.length > 0 &&
            typeof entry.preferences[0] === 'object';

          if (isGrouped) {
            // Grouped format: preferences are { resource, rank } objects
            const tr = new CTPTaskResource(
              entry.preferences[0].resource,
              entry.isPrimary ?? (i === 0),
              i,
            );
            if (entry.qty !== undefined) tr.qty = entry.qty;
            if (entry.mode) tr.mode = entry.mode;
            for (const pref of entry.preferences) {
              tr.preferences.push(
                new CTPResourcePreference(pref.resource, pref.rank ?? 0),
              );
            }
            capList.add(tr);
          } else {
            // Flat format: resource is a string, preferences are optional string[]
            const tr = new CTPTaskResource(entry.resource, entry.isPrimary, i);
            if (entry.qty !== undefined) tr.qty = entry.qty;
            if (entry.mode) tr.mode = entry.mode;
            const prefs: string[] = entry.preferences ?? [entry.resource];
            for (let p = 0; p < prefs.length; p++) {
              tr.preferences.push(new CTPResourcePreference(prefs[p], p + 1));
            }
            capList.add(tr);
          }
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
          if (entry.mode) tr.mode = entry.mode;
          tr.preferences.push(new CTPResourcePreference(entry.resource));
          matList.add(tr);
        }
        matList.sortBySequence();
        task.materialsResources = matList;
      }

      // Sequence (chain ordering)
      if (item.sequence !== undefined) task.sequence = item.sequence;

      // Process & subType
      if (item.process) task.process = item.process;
      if (item.subType) task.subType = item.subType;

      // Link ID
      if (item.linkId) {
        task.linkId = new CTPLinkId(
          item.linkId.name,
          item.linkId.type ?? '',
          item.linkId.prevLink,
          item.linkId.maxGap ?? null,
        );
      }

      // Product output linkage
      if (item.outputProductKey) task.outputProductKey = item.outputProductKey;
      if (item.outputQty !== undefined) task.outputQty = item.outputQty;
      if (item.outputScrapRate !== undefined) task.outputScrapRate = item.outputScrapRate;

      // Material inputs
      if (item.inputMaterials && Array.isArray(item.inputMaterials)) {
        const matInputs = new CTPTaskMaterialInputList();
        for (const mi of item.inputMaterials) {
          matInputs.add(
            new CTPTaskMaterialInput(
              mi.productKey,
              mi.requiredQty,
              mi.scrapRate ?? 0,
              mi.unitOfMeasure ?? 'pcs',
            ),
          );
        }
        task.inputMaterials = matInputs;
      }

      // Typed attributes
      const taskAttrs = this.normalizeTypedAttributes(item.typedAttributes);
      if (taskAttrs) {
        task.typedAttributes.fromArray(taskAttrs);
      }

      // Map typedAttributes.priority → task.rank for scheduling order
      if (item.typedAttributes) {
        const attrs: any = item.typedAttributes;
        const rawPriority = Array.isArray(attrs)
          ? attrs.find((a: any) => a.name === 'priority')?.value?.value
          : attrs.priority;
        if (rawPriority) {
          const priorityRank: Record<string, number> = { URGENT: 1, 'ADD-ON': 2, ELECTIVE: 3 };
          const rank = priorityRank[String(rawPriority).toUpperCase()] ?? 3;
          task.priority = rank;
        }
      }

      // Numeric priority from config overrides text-based rank
      if (item.typedAttributes) {
        const attrs: any = item.typedAttributes;
        const numPri = Array.isArray(attrs)
          ? attrs.find((a: any) => a.name === 'numericPriority')?.value?.value
          : attrs.numericPriority;
        if (typeof numPri === 'number') task.priority = numPri;
      }
      task.originalPriority = task.priority;

      tasks.addEntity(task);
    }
    return tasks;
  }

  private static readonly DAY_MAP: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };

  private hydrateCalendars(
    data: ICalendarData[],
    resources: CTPResources,
    horizon: CTPHorizon,
    tenantTimezone: string = 'UTC',
  ): void {
    for (const cal of data) {
      const resource = resources.getEntity(cal.resourceKey);
      if (!resource) continue;

      const available = new CTPAvailable();

      // Explicit intervals format
      if (cal.intervals) {
        for (const iv of cal.intervals) {
          const startW = CTPDateTime.fromDateTime(DateTime.fromISO(iv.start));
          const endW = CTPDateTime.fromDateTime(DateTime.fromISO(iv.end));
          const interval = new CTPInterval(startW, endW, iv.qty);
          if (iv.runRate !== undefined) interval.runRate = iv.runRate;
          available.add(interval);
        }
      }

      // Shift-based format — expand across horizon
      // Shift times are in tenant-local time; convert to UTC for the engine
      if (cal.shifts) {
        const hStart = horizon.startDate.setZone(tenantTimezone);
        const hEnd = horizon.endDate.setZone(tenantTimezone);
        for (const shift of cal.shifts) {
          const dayNums = shift.days.map(d => StateHydratorService.DAY_MAP[d]).filter(Boolean);
          const [startH, startM] = shift.start.split(':').map(Number);
          const [endH, endM] = shift.end.split(':').map(Number);

          let day = hStart.startOf('day');
          while (day < hEnd) {
            if (dayNums.includes(day.weekday)) {
              const intervalStart = day.set({ hour: startH, minute: startM, second: 0 }).toUTC();
              const intervalEnd = day.set({ hour: endH, minute: endM, second: 0 }).toUTC();
              const startW = CTPDateTime.fromDateTime(intervalStart);
              const endW = CTPDateTime.fromDateTime(intervalEnd);
              available.add(new CTPInterval(startW, endW, 1));
            }
            day = day.plus({ days: 1 });
          }
        }
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
