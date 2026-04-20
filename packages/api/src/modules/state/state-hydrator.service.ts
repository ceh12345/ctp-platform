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
  CTPOrder,
  IValidationError,
  makeValidationError,
} from '@ctp/engine';
import { ConfigService } from '../../config/config.service';
import {
  IHorizonConfig,
  ISettingsConfig,
  IResourceData,
  ITaskData,
  ICalendarData,
  IStateChangeData,
  IOrderData,
} from '../../config/interfaces/config-store.interface';
import { IRawDataPayload } from '../integration/adapter.interface';

// Small target interface so the helper works with any entity that carries
// validationErrors (CTPTask, CTPOrder, CTPResource all qualify).
interface ValidationTarget {
  addValidationError(err: IValidationError): void;
}

@Injectable()
export class StateHydratorService {
  constructor(private readonly configService: ConfigService) {}

  // Defensive ISO-date parse for entity fields. Second-layer defense after
  // MappingEngine.toUTC — catches bad dates on flat-file tenants (no
  // MappingEngine) and fields the profile didn't mark `toUTC`.
  //
  // Returns null for missing (undefined/null/empty) values WITHOUT attaching
  // an error; callers fall back to sensible defaults. For truly unparseable
  // values, attaches an UNPARSEABLE_DATE validation error on `target` and
  // returns null so arithmetic sites never see NaN.
  private parseIsoDateOrRecord(
    raw: unknown,
    target: ValidationTarget | null,
    field: string,
  ): DateTime | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const dt = DateTime.fromISO(String(raw));
    if (dt.isValid) return dt;
    target?.addValidationError(makeValidationError({
      agent:    'Hydrator',
      type:     'UNPARSEABLE_DATE',
      reason:   `Field '${field}' is not a valid ISO date: ${JSON.stringify(raw)} (${dt.invalidReason ?? 'unknown'})`,
      severity: 'error',
      source:   'validation',
      field,
      rawValue: raw,
    }));
    return null;
  }

  buildLandscape(data?: IRawDataPayload): SchedulingLandscape {
    const horizonConfig = this.configService.getHorizon();
    const settingsConfig = this.configService.getSettings();
    const resourceData = (data?.resources?.length ? data.resources : this.configService.getResources()) as IResourceData[];
    const taskData     = (data?.tasks?.length     ? data.tasks     : this.configService.getTasks())     as ITaskData[];
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

    // Load orders into landscape for due date hydration
    const orderOverride = data?.orders?.length ? data.orders as IOrderData[] : undefined;
    this.hydrateOrders(landscape, orderOverride);

    // Resolve cadence profiles per task
    this.hydrateCadences(landscape);

    // Load tenant UOM overrides / product-specific conversions (optional file)
    const uomData = this.configService.getUomConversions();
    if (uomData) {
      if (uomData.globalConversions?.length > 0) {
        landscape.uomTable.fromGlobalArray(uomData.globalConversions);
      }
      if (uomData.productConversions?.length > 0) {
        landscape.uomTable.fromProductArray(uomData.productConversions);
      }
    }

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

  private hydrateOrders(landscape: SchedulingLandscape, orderOverride?: IOrderData[]): void {
    const orderData = orderOverride ?? this.configService.getOrders();
    if (!orderData || orderData.length === 0) return;

    for (const item of orderData) {
      const order = new CTPOrder('Order', item.name, item.key);
      order.productKey = item.productKey;
      order.demandQty = item.demandQty;
      const dueDt = this.parseIsoDateOrRecord(item.dueDate, order, 'dueDate');
      if (dueDt) order.dueDate = CTPDateTime.fromDateTime(dueDt);
      const lateDt = this.parseIsoDateOrRecord(item.lateDueDate, order, 'lateDueDate');
      if (lateDt) order.lateDueDate = CTPDateTime.fromDateTime(lateDt);
      order.priority = item.priority ?? 0;
      if (item.latenessPenaltyPerDay !== undefined) order.latenessPenaltyPerDay = item.latenessPenaltyPerDay;
      landscape.orders.addEntity(order);
    }
  }

  private hydrateHorizon(config: IHorizonConfig | null): CTPHorizon {
    if (!config) {
      const now = DateTime.now();
      return new CTPHorizon(now, now.plus({ days: 14 }));
    }
    const timezone = this.configService.getLocale()?.timezone || 'UTC';
    const startDt = this.resolveHorizonStart(config.start || 'NOW', timezone);
    const endDt = startDt.plus({ days: config.maxDays ?? 14 });
    return new CTPHorizon(startDt, endDt);
  }

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
    if (config.resetUsageAfterProcessChange !== undefined)
      settings.resetUageAfterProcessChange = config.resetUsageAfterProcessChange;
    if (config.solverStrategy !== undefined)
      settings.solverStrategy = config.solverStrategy;
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
      if (item.hourlyRate !== undefined) resource.hourlyRate = item.hourlyRate;
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

      // Window — defensive parse so arithmetic sites never see NaN.
      const window = new CTPInterval();
      const ws = this.parseIsoDateOrRecord(item.windowStart, task, 'windowStart');
      const we = this.parseIsoDateOrRecord(item.windowEnd,   task, 'windowEnd');
      if (ws && we) {
        window.fromDates(ws, we, 1);
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
                new CTPResourcePreference(pref.resource, pref.rank ?? 0, pref.mode),
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
          const matInput = new CTPTaskMaterialInput(
            mi.productKey,
            mi.requiredQty,
            mi.scrapRate ?? 0,
            mi.unitOfMeasure ?? 'pcs',
          );
          // Look up unitCost from materials config
          if (mi.unitCost !== undefined) {
            matInput.unitCost = mi.unitCost;
          } else {
            const matData = this.configService.getMaterials().find(m => m.key === mi.productKey);
            if (matData?.unitCost !== undefined) matInput.unitCost = matData.unitCost;
          }
          matInputs.add(matInput);
        }
        task.inputMaterials = matInputs;
      }

      // Commitment stack fields from config (for testing without WIP sync)
      if (item.dispatched) {
        task.dispatched = true;
        task.dispatchedAt = (item as any).dispatchedAt || null;
        task.materialsPulled = (item as any).materialsPulled ?? true;
        // Don't pin here — applyCommitmentStack handles pinning after first solve
      }
      if ((item as any).wipState === 'IN_PROCESS') {
        task.wipstate = 1; // CTPWipStateConstants.IN_PROCESS
        task.actualStart = (item as any).actualStart || null;
        task.actualResources = (item as any).actualResources ?? [];
        task.percentComplete = (item as any).percentComplete ?? 0;
        task.remainingDuration = (item as any).remainingDuration ?? null;
      }
      if ((item as any).wipState === 'ON_HOLD') {
        task.wipstate = 3; // CTPWipStateConstants.ON_HOLD
        task.holdReason = (item as any).holdReason || null;
        task.estimatedResumeTime = (item as any).estimatedResumeTime || null;
        task.actualStart = (item as any).actualStart || null;
        task.actualResources = (item as any).actualResources ?? [];
        task.percentComplete = (item as any).percentComplete ?? 0;
      }
      if ((item as any).wipState === 'COMPLETED') {
        task.wipstate = 5; // CTPWipStateConstants.COMPLETED
        task.actualStart = (item as any).actualStart || null;
        task.actualEnd = (item as any).actualEnd || null;
        task.actualResources = (item as any).actualResources ?? [];
        task.percentComplete = 100;
      }

      // Typed attributes
      const taskAttrs = this.normalizeTypedAttributes(item.typedAttributes);
      if (taskAttrs) {
        task.typedAttributes.fromArray(taskAttrs);
      }

      // Map typedAttributes.priority → task.priority for scheduling order
      if (item.typedAttributes) {
        const attrs: any = item.typedAttributes;
        const rawPriority = Array.isArray(attrs)
          ? attrs.find((a: any) => a.name === 'priority')?.value?.value
          : attrs.priority;
        if (rawPriority) {
          if (typeof rawPriority === 'number') {
            // Numeric priority: use directly (1-10 RUSH, 11-30 HIGH, 31-70 NORMAL, 71-100 LOW)
            task.priority = rawPriority;
          } else {
            // Text priority: map to numeric tier (1-10 RUSH, 11-30 HIGH, 31-70 NORMAL, 71-100 LOW)
            const priorityRank: Record<string, number> = { URGENT: 5, 'ADD-ON': 20, ELECTIVE: 50 };
            task.priority = priorityRank[String(rawPriority).toUpperCase()] ?? 50;
          }
        }
      }

      // Numeric priority from numericPriority attribute overrides above
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
      if (item.cost !== undefined) sc.cost = item.cost;
      stateChanges.addEntity(sc);
    }
    return stateChanges;
  }
}
