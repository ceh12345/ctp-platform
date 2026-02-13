import { ITypedAttribute } from '@ctp/engine';

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

// Terminology
export interface ITerminologyMap {
  mappings: Record<string, string>;
}

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
  requiresPreds: boolean;
}

// Tenant metadata
export interface ITenantConfig {
  tenantId: string;
  name: string;
  vertical: string;
  createdAt: string;
  updatedAt: string;
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
  durationSeconds?: number;
  durationType?: number;
  durationQty?: number;
  capacityResources?: { resource: string; isPrimary: boolean; qty?: number }[];
  materialsResources?: { resource: string; isPrimary: boolean; qty?: number }[];
  process?: string;
  subType?: string;
  linkId?: { name: string; type: string; prevLink: string };
  typedAttributes?: ITypedAttribute[];
  [key: string]: any;
}

export interface ICalendarData {
  resourceKey: string;
  intervals: { start: string; end: string; qty: number; runRate?: number }[];
}

export interface IStateChangeData {
  resourceType: string;
  type: string;
  fromState: string;
  toState: string;
  duration: number;
  penalty?: number;
}

export interface IHorizonConfig {
  startDate: string;
  endDate: string;
}

// The main interface
export interface IConfigStore {
  // Tenant
  getTenant(): ITenantConfig | null;

  // Schemas
  getSchema(entityType: string): IEntitySchema | null;
  saveSchema(entityType: string, schema: IEntitySchema): void;

  // KPIs
  getKPIs(): IKPIDefinition[];
  saveKPIs(kpis: IKPIDefinition[]): void;

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

  // Save entity data
  saveResources(resources: IResourceData[]): void;
  saveTasks(tasks: ITaskData[]): void;
  saveCalendars(calendars: ICalendarData[]): void;
  saveStateChanges(stateChanges: IStateChangeData[]): void;

  // Reload from disk
  reload(): void;
}
