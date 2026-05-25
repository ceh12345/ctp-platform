import * as fs from 'fs';
import * as path from 'path';
import {
  IConfigStore,
  ITenantConfig,
  IEntitySchema,
  IKPIDefinition,
  IKpiRates,
  ITerminologyMap,
  IScoringConfig,
  ISettingsConfig,
  IHorizonConfig,
  IResourceData,
  ITaskData,
  ICalendarData,
  IStateChangeData,
  IProductData,
  IOrderData,
  IMaterialData,
  IProcessData,
  ICadenceData,
  IScheduleConfiguration,
  IUOMConversionsFileData,
  IAdapterConfig,
  IMappingProfile,
} from './interfaces/config-store.interface';
import { TenantStrategyOverride, TenantCustomStrategy } from './interfaces/strategy.interface';

const DEFAULT_SETTINGS: ISettingsConfig = {
  flowAround: false,
  maxLateness: 0,
  tasksPerLoop: 50,
  topTasksToSchedule: 2,
  resetUsageAfterProcessChange: true,
  scheduleDirection: 1,
};

export class FileConfigStore implements IConfigStore {
  private readonly tenantDir: string;
  private cache: Map<string, any> = new Map();

  constructor(
    private readonly configRootPath: string,
    private readonly tenantId: string,
  ) {
    this.configRootPath = path.resolve(configRootPath);
    this.tenantDir = path.join(this.configRootPath, 'tenants', tenantId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private readJsonFile<T>(filePath: string): T | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      // Fallback: paths under data/current/ resolve to data/initial-fixture/ when
      // the symlink hasn't been materialized yet (test runs without Nest boot,
      // or freshly-cloned worktree before first API start). The lifecycle service
      // creates the symlink in production; this keeps reads working without it.
      const fallback = filePath.replace(
        `${path.sep}data${path.sep}current${path.sep}`,
        `${path.sep}data${path.sep}initial-fixture${path.sep}`,
      );
      if (fallback !== filePath) {
        try {
          const content = fs.readFileSync(fallback, 'utf-8');
          return JSON.parse(content) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private writeJsonFile<T>(filePath: string, data: T): void {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private getCached<T>(key: string, loader: () => T): T {
    if (!this.cache.has(key)) {
      this.cache.set(key, loader());
    }
    return this.cache.get(key) as T;
  }

  // ── Tenant ──────────────────────────────────────────────────────────

  getTenant(): ITenantConfig | null {
    return this.getCached('tenant', () =>
      this.readJsonFile<ITenantConfig>(path.join(this.tenantDir, 'tenant.json')),
    );
  }

  // ── Schemas ─────────────────────────────────────────────────────────

  getSchema(entityType: string): IEntitySchema | null {
    return this.getCached(`schema:${entityType}`, () =>
      this.readJsonFile<IEntitySchema>(
        path.join(this.tenantDir, 'schemas', `${entityType}.schema.json`),
      ),
    );
  }

  saveSchema(entityType: string, schema: IEntitySchema): void {
    const filePath = path.join(this.tenantDir, 'schemas', `${entityType}.schema.json`);
    this.writeJsonFile(filePath, schema);
    this.cache.delete(`schema:${entityType}`);
  }

  // ── KPIs ────────────────────────────────────────────────────────────

  getKPIs(): IKPIDefinition[] {
    return this.getCached('kpis', () =>
      this.readJsonFile<IKPIDefinition[]>(
        path.join(this.tenantDir, 'kpis', 'kpis.json'),
      ) ?? [],
    );
  }

  saveKPIs(kpis: IKPIDefinition[]): void {
    const filePath = path.join(this.tenantDir, 'kpis', 'kpis.json');
    this.writeJsonFile(filePath, kpis);
    this.cache.delete('kpis');
  }

  // Business-value rates used for savings estimates (separate from display KPIs above).
  // Returns null if the file doesn't exist so callers can surface a "please configure" prompt.
  getKPIRates(): IKpiRates | null {
    return this.getCached('kpi-rates', () =>
      this.readJsonFile<IKpiRates>(
        path.join(this.tenantDir, 'kpis', 'rates.json'),
      ),
    );
  }

  // ── Terminology ─────────────────────────────────────────────────────

  getTerminology(): ITerminologyMap {
    return this.getCached('terminology', () =>
      this.readJsonFile<ITerminologyMap>(
        path.join(this.tenantDir, 'terminology.json'),
      ) ?? {},
    );
  }

  saveTerminology(terminology: ITerminologyMap): void {
    const filePath = path.join(this.tenantDir, 'terminology.json');
    this.writeJsonFile(filePath, terminology);
    this.cache.delete('terminology');
  }

  // ── Scoring ─────────────────────────────────────────────────────────

  getScoring(): IScoringConfig | null {
    return this.getCached('scoring', () =>
      this.readJsonFile<IScoringConfig>(
        path.join(this.tenantDir, 'scoring.json'),
      ),
    );
  }

  saveScoring(scoring: IScoringConfig): void {
    const filePath = path.join(this.tenantDir, 'scoring.json');
    this.writeJsonFile(filePath, scoring);
    this.cache.delete('scoring');
  }

  // ── Settings ────────────────────────────────────────────────────────

  getSettings(): ISettingsConfig {
    return this.getCached('settings', () =>
      this.readJsonFile<ISettingsConfig>(
        path.join(this.tenantDir, 'settings.json'),
      ) ?? { ...DEFAULT_SETTINGS },
    );
  }

  saveSettings(settings: ISettingsConfig): void {
    const filePath = path.join(this.tenantDir, 'settings.json');
    this.writeJsonFile(filePath, settings);
    this.cache.delete('settings');
  }

  // ── Horizon ─────────────────────────────────────────────────────────

  getHorizon(): IHorizonConfig | null {
    return this.getCached('horizon', () =>
      this.readJsonFile<IHorizonConfig>(
        path.join(this.tenantDir, 'horizon.json'),
      ),
    );
  }

  // ── Colors ─────────────────────────────────────────────────────────

  getColors(): any {
    return this.getCached('colors', () =>
      this.readJsonFile<any>(path.join(this.tenantDir, 'colors.json')) ?? {},
    );
  }

  // ── Locale ─────────────────────────────────────────────────────────

  getLocale(): any {
    return this.getCached('locale', () =>
      this.readJsonFile<any>(path.join(this.tenantDir, 'locale.json')) ?? {},
    );
  }

  // ── Strategies ───────────────────────────────────────────────────────

  getStrategyOverrides(): TenantStrategyOverride[] {
    return this.getCached('strategyOverrides', () =>
      this.readJsonFile<TenantStrategyOverride[]>(
        path.join(this.tenantDir, 'strategy-overrides.json'),
      ) ?? [],
    );
  }

  getCustomStrategies(): TenantCustomStrategy[] {
    return this.getCached('customStrategies', () =>
      this.readJsonFile<TenantCustomStrategy[]>(
        path.join(this.tenantDir, 'custom-strategies.json'),
      ) ?? [],
    );
  }

  // ── Entity data ─────────────────────────────────────────────────────

  getResources(): IResourceData[] {
    return this.getCached('resources', () =>
      this.readJsonFile<IResourceData[]>(
        path.join(this.tenantDir, 'data', 'current', 'resources.json'),
      ) ?? [],
    );
  }

  getTasks(): ITaskData[] {
    return this.getCached('tasks', () =>
      this.readJsonFile<ITaskData[]>(
        path.join(this.tenantDir, 'data', 'current', 'tasks.json'),
      ) ?? [],
    );
  }

  getCalendars(): ICalendarData[] {
    return this.getCached('calendars', () =>
      this.readJsonFile<ICalendarData[]>(
        path.join(this.tenantDir, 'data', 'current', 'calendars.json'),
      ) ?? [],
    );
  }

  getStateChanges(): IStateChangeData[] {
    return this.getCached('stateChanges', () =>
      this.readJsonFile<IStateChangeData[]>(
        path.join(this.tenantDir, 'data', 'current', 'state-changes.json'),
      ) ?? [],
    );
  }

  getProducts(): IProductData[] {
    return this.getCached('products', () =>
      this.readJsonFile<IProductData[]>(
        path.join(this.tenantDir, 'data', 'current', 'products.json'),
      ) ?? [],
    );
  }

  getOrders(): IOrderData[] {
    return this.getCached('orders', () =>
      this.readJsonFile<IOrderData[]>(
        path.join(this.tenantDir, 'data', 'current', 'orders.json'),
      ) ?? [],
    );
  }

  getMaterials(): IMaterialData[] {
    return this.getCached('materials', () =>
      this.readJsonFile<IMaterialData[]>(
        path.join(this.tenantDir, 'data', 'current', 'materials.json'),
      ) ?? [],
    );
  }

  getProcesses(): IProcessData[] {
    return this.getCached('processes', () =>
      this.readJsonFile<IProcessData[]>(
        path.join(this.tenantDir, 'data', 'current', 'processes.json'),
      ) ?? [],
    );
  }

  getCadences(): ICadenceData[] {
    return this.getCached('cadences', () =>
      this.readJsonFile<ICadenceData[]>(
        path.join(this.tenantDir, 'cadences.json'),
      ) ?? [],
    );
  }

  getUomConversions(): IUOMConversionsFileData | null {
    return this.getCached('uomConversions', () =>
      this.readJsonFile<IUOMConversionsFileData>(
        path.join(this.tenantDir, 'data', 'current', 'uom-conversions.json'),
      ) ?? null,
    );
  }

  // ── Save entity data ───────────────────────────────────────────────

  saveResources(resources: IResourceData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'current', 'resources.json');
    this.writeJsonFile(filePath, resources);
    this.cache.delete('resources');
  }

  saveTasks(tasks: ITaskData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'current', 'tasks.json');
    this.writeJsonFile(filePath, tasks);
    this.cache.delete('tasks');
  }

  saveCalendars(calendars: ICalendarData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'current', 'calendars.json');
    this.writeJsonFile(filePath, calendars);
    this.cache.delete('calendars');
  }

  saveStateChanges(stateChanges: IStateChangeData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'current', 'state-changes.json');
    this.writeJsonFile(filePath, stateChanges);
    this.cache.delete('stateChanges');
  }

  // ── Configurations ──────────────────────────────────────────────────

  getConfigurations(): IScheduleConfiguration[] {
    return this.getCached('configurations', () =>
      this.readJsonFile<IScheduleConfiguration[]>(
        path.join(this.tenantDir, 'configurations.json'),
      ),
    ) ?? [];
  }

  saveConfigurations(configs: IScheduleConfiguration[]): void {
    const filePath = path.join(this.tenantDir, 'configurations.json');
    this.writeJsonFile(filePath, configs);
    this.cache.delete('configurations');
  }

  // ── Integration ─────────────────────────────────────────────────────

  getAdapterConfig(): IAdapterConfig | null {
    return this.getCached('adapterConfig', () =>
      this.readJsonFile<IAdapterConfig>(
        path.join(this.tenantDir, 'integration', 'adapter.json'),
      ),
    );
  }

  getMappingProfile(): IMappingProfile | null {
    return this.getCached('mappingProfile', () =>
      this.readJsonFile<IMappingProfile>(
        path.join(this.tenantDir, 'integration', 'mapping.json'),
      ),
    );
  }

  // ── Reload ──────────────────────────────────────────────────────────

  reload(): void {
    this.cache.clear();
  }
}
