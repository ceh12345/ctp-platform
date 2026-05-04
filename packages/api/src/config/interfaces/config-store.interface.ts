import { ITypedAttribute } from '@ctp/engine';
import { TenantStrategyOverride, TenantCustomStrategy } from './strategy.interface';

// Schema types
export interface IAttributeSchemaDefinition {
  name: string;
  displayName: string;
  dataType: string;
  required: boolean;
  defaultValue?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    allowedValues?: string[];
    listItemType?: 'string' | 'number';
    maxLength?: number;
  };
  category: string;
  group?: string;
  sequence: number;
  searchable: boolean;
  sortable: boolean;
  useInScheduling: boolean;
  useInScoring: boolean;
}

export interface IEntitySchema {
  entityType: string;
  version: number;
  attributes: IAttributeSchemaDefinition[];
}

// KPI types
export interface IKPIDefinition {
  name: string;
  displayName: string;
  description: string;
  computationType: 'built-in' | 'attribute-agg' | 'expression' | 'custom';
  formula?: string;
  sourceEntity: 'task' | 'resource' | 'schedule';
  sourceAttribute?: string;
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'ratio';
  filterCondition?: string;
  objective: 'minimize' | 'maximize' | 'target';
  targetValue?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  unit: string;
  format: string;
  visualizationType: string;
  category: string;
  sequence: number;
}

// KPI rates — business-value config (separate from display-KPI definitions above).
// Used to translate optimization improvements into dollar estimates on results screens.
export interface IKpiRates {
  /** ISO currency code for display. */
  currency: string;
  /** Flat per-day penalty for late orders, in the specified currency. */
  latePenaltyPerDay: number;
  /** Grace days allowed past due before penalty kicks in. */
  graceDays: number;
  /** Optional cap on total penalty per order; null = uncapped. */
  latePenaltyCapPerOrder: number | null;
  /** Fully-loaded labor $/hour for a secondary savings line (optional display). */
  laborRatePerHour: number;
}

// Terminology — flat key→label map
export type ITerminologyMap = Record<string, string>;

// Scoring config
export interface IScoringConfig {
  name: string;
  key: string;
  rules: {
    ruleName: string;
    weight: number;
    objective: number;
    includeInSolve: boolean;
    penaltyFactor: number;
  }[];
}

// App settings
export interface ISettingsConfig {
  flowAround: boolean;
  maxLateness: number;
  tasksPerLoop: number;
  topTasksToSchedule: number;
  resetUsageAfterProcessChange: boolean;
  scheduleDirection: number;
  solverStrategy?: string;
}

// Tenant metadata
export interface ITenantConfig {
  tenantId: string;
  name: string;
  vertical: string;
  createdAt: string;
  updatedAt: string;
}

// Product data
export interface IBOMInputData {
  productKey: string;
  qtyPer: number;
  scrapRate?: number;
}

export interface IProductData {
  key: string;
  name: string;
  productType: string;
  unitOfMeasure: string;
  outputScrapRate?: number;
  bomInputs?: IBOMInputData[];
}

// Order data
export interface IOrderData {
  key: string;
  name: string;
  productKey: string;
  demandQty: number;
  dueDate: string;
  lateDueDate?: string;
  priority?: number;
  latenessPenaltyPerDay?: number;
}

// Material inventory data
export interface IMaterialData {
  key: string;
  name: string;
  unit: string;
  onHand: number;
  incoming?: number;
  incomingDate?: string | null;
  unitCost?: number;
}

// Raw entity data shapes
export interface IResourceData {
  key: string;
  name: string;
  type?: string;
  class?: string;
  typedAttributes?: ITypedAttribute[];
  [key: string]: any;
}

export interface ITaskData {
  key: string;
  name: string;
  type?: string;
  windowStart?: string;
  windowEnd?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  durationSeconds?: number;
  durationType?: number;
  durationQty?: number;
  capacityResources?: {
    resource?: string;
    isPrimary: boolean;
    qty?: number;
    mode?: string;
    preferences?: string[] | { resource: string; rank?: number }[];
  }[];
  materialsResources?: { resource: string; isPrimary: boolean; qty?: number; mode?: string }[];
  process?: string;
  subType?: string;
  cadence?: string | null;
  linkId?: { name: string; type: string; prevLink: string; maxGap?: number };
  typedAttributes?: ITypedAttribute[];
  [key: string]: any;
}

export interface ICalendarShift {
  days: string[];
  start: string;
  end: string;
}

export interface ICalendarData {
  resourceKey: string;
  intervals?: { start: string; end: string; qty: number; runRate?: number }[];
  shifts?: ICalendarShift[];
}

export interface IStateChangeData {
  resourceType: string;
  type: string;
  fromState: string;
  toState: string;
  duration: number;
  penalty?: number;
  cost?: number;
}

export interface IProcessData {
  key: string;
  name: string;
  category?: string;
  cadence?: string;
}

export interface ICadenceData {
  key: string;
  name: string;
  intervalMinutes: number;
}

export interface IUOMConversionsFileData {
  globalConversions: Array<{ unit: string; family: string; toBaseFactor: number }>;
  productConversions: Array<{ productKey: string; fromUnit: string; toUnit: string; toUnitFamily: string; factor: number }>;
}

export interface IHorizonConfig {
  start: string;
  maxDays: number;
  pastDueExtensionDays: number;
}

// The main interface
export interface IScheduleConfiguration {
  key: string;
  name: string;
  description?: string;
  owner: 'tenant' | string;
  isDefault: boolean;
  updatedAt: string;
  scoring: {
    ruleName: string;
    weight: number;
    objective: number;
    includeInSolve: boolean;
    penaltyFactor: number;
    group?: string;
  }[];
  strategy: string;
  tier: string;
  suggestedExperienceLevel?: string;
  solverDepth?: { bumpLimit?: number; tabuTenure?: number; iterationCount?: number };
  constraints?: { enforceMaxGap?: boolean; enforceMaterials?: boolean; enforceCadence?: boolean; enforceAttributes?: boolean };
  horizon?: { start?: string; end?: string };
  defaultFilters?: { resourceGroups?: string[]; orderKeys?: string[]; timeRangeDays?: number };
  costVisibility?: { resource?: boolean; changeover?: boolean; overtime?: boolean; lateness?: boolean; material?: boolean };
}

// Adapter + mapping profile config shapes
export interface IAdapterConfig {
  adapterType: 'file' | string;
  source?: string;
  connection?: Record<string, any>;
  endpoints?: Record<string, any>;
  schedule?: Record<string, any>;
  errorPolicy?: Record<string, any>;
}

export interface IMappingProfile {
  version?: string;
  tenantId?: string;
  source?: string;
  orders?: Record<string, any>;
  tasks?: Record<string, any>;
  resources?: Record<string, any>;
  calendars?: Record<string, any>;
  transforms?: Record<string, any>;
  [key: string]: any;
}

export interface IConfigStore {
  // Tenant
  getTenant(): ITenantConfig | null;

  // Schemas
  getSchema(entityType: string): IEntitySchema | null;
  saveSchema(entityType: string, schema: IEntitySchema): void;

  // KPIs
  getKPIs(): IKPIDefinition[];
  saveKPIs(kpis: IKPIDefinition[]): void;

  // KPI rates (business-value config for savings estimates). Returns null if file missing.
  getKPIRates(): IKpiRates | null;

  // Terminology
  getTerminology(): ITerminologyMap;
  saveTerminology(terminology: ITerminologyMap): void;

  // Scoring
  getScoring(): IScoringConfig | null;
  saveScoring(scoring: IScoringConfig): void;

  // Settings
  getSettings(): ISettingsConfig;
  saveSettings(settings: ISettingsConfig): void;

  // Horizon
  getHorizon(): IHorizonConfig | null;

  // Entity data
  getResources(): IResourceData[];
  getTasks(): ITaskData[];
  getCalendars(): ICalendarData[];
  getStateChanges(): IStateChangeData[];
  getProducts(): IProductData[];
  getOrders(): IOrderData[];
  getMaterials(): IMaterialData[];
  getProcesses(): IProcessData[];
  getCadences(): ICadenceData[];
  getUomConversions(): IUOMConversionsFileData | null;

  // Save entity data
  saveResources(resources: IResourceData[]): void;
  saveTasks(tasks: ITaskData[]): void;
  saveCalendars(calendars: ICalendarData[]): void;
  saveStateChanges(stateChanges: IStateChangeData[]): void;

  // Colors
  getColors(): any;

  // Locale
  getLocale(): any;

  // Strategies
  getStrategyOverrides(): TenantStrategyOverride[];
  getCustomStrategies(): TenantCustomStrategy[];

  // Configurations
  getConfigurations(): IScheduleConfiguration[];
  saveConfigurations(configs: IScheduleConfiguration[]): void;

  // Integration
  getAdapterConfig?(): IAdapterConfig | null;
  getMappingProfile?(): IMappingProfile | null;

  // Reload from disk
  reload(): void;
}
