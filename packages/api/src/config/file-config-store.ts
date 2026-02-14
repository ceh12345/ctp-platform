import * as fs from 'fs';
import * as path from 'path';
import {
  IConfigStore,
  ITenantConfig,
  IEntitySchema,
  IKPIDefinition,
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
} from './interfaces/config-store.interface';

const DEFAULT_SETTINGS: ISettingsConfig = {
  flowAround: false,
  maxLateness: 0,
  tasksPerLoop: 50,
  topTasksToSchedule: 2,
  resetUsageAfterProcessChange: true,
  scheduleDirection: 1,
  requiresPreds: false,
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

  // ── Terminology ─────────────────────────────────────────────────────

  getTerminology(): ITerminologyMap {
    return this.getCached('terminology', () =>
      this.readJsonFile<ITerminologyMap>(
        path.join(this.tenantDir, 'terminology.json'),
      ) ?? { mappings: {} },
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

  // ── Entity data ─────────────────────────────────────────────────────

  getResources(): IResourceData[] {
    return this.getCached('resources', () =>
      this.readJsonFile<IResourceData[]>(
        path.join(this.tenantDir, 'data', 'resources.json'),
      ) ?? [],
    );
  }

  getTasks(): ITaskData[] {
    return this.getCached('tasks', () =>
      this.readJsonFile<ITaskData[]>(
        path.join(this.tenantDir, 'data', 'tasks.json'),
      ) ?? [],
    );
  }

  getCalendars(): ICalendarData[] {
    return this.getCached('calendars', () =>
      this.readJsonFile<ICalendarData[]>(
        path.join(this.tenantDir, 'data', 'calendars.json'),
      ) ?? [],
    );
  }

  getStateChanges(): IStateChangeData[] {
    return this.getCached('stateChanges', () =>
      this.readJsonFile<IStateChangeData[]>(
        path.join(this.tenantDir, 'data', 'state-changes.json'),
      ) ?? [],
    );
  }

  getProducts(): IProductData[] {
    return this.getCached('products', () =>
      this.readJsonFile<IProductData[]>(
        path.join(this.tenantDir, 'data', 'products.json'),
      ) ?? [],
    );
  }

  getOrders(): IOrderData[] {
    return this.getCached('orders', () =>
      this.readJsonFile<IOrderData[]>(
        path.join(this.tenantDir, 'data', 'orders.json'),
      ) ?? [],
    );
  }

  getMaterials(): IMaterialData[] {
    return this.getCached('materials', () =>
      this.readJsonFile<IMaterialData[]>(
        path.join(this.tenantDir, 'data', 'materials.json'),
      ) ?? [],
    );
  }

  // ── Save entity data ───────────────────────────────────────────────

  saveResources(resources: IResourceData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'resources.json');
    this.writeJsonFile(filePath, resources);
    this.cache.delete('resources');
  }

  saveTasks(tasks: ITaskData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'tasks.json');
    this.writeJsonFile(filePath, tasks);
    this.cache.delete('tasks');
  }

  saveCalendars(calendars: ICalendarData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'calendars.json');
    this.writeJsonFile(filePath, calendars);
    this.cache.delete('calendars');
  }

  saveStateChanges(stateChanges: IStateChangeData[]): void {
    const filePath = path.join(this.tenantDir, 'data', 'state-changes.json');
    this.writeJsonFile(filePath, stateChanges);
    this.cache.delete('stateChanges');
  }

  // ── Reload ──────────────────────────────────────────────────────────

  reload(): void {
    this.cache.clear();
  }
}
