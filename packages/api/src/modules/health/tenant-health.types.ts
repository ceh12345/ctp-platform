export type TenantHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type Presence = 'present' | 'absent' | 'invalid';
export type SymlinkState = 'resolves' | 'missing' | 'broken';

export interface ConfigChecks {
  tenantJson: Presence;
  mappingProfile: 'present' | 'absent';
  adapter: 'present' | 'absent';
  adapterType?: string;
}

export interface DataChecks {
  dataDir: 'present' | 'absent';
  currentSymlink: SymlinkState;
  currentTarget: string | null;
  fallbackInUse: boolean;
  snapshotCount: number;
  snapshots: string[];
}

export interface EntityCheck {
  present: boolean;
  count: number;
}

export type EntityChecks = Record<string, EntityCheck>;

export interface EngineChecks {
  landscapeLoaded: boolean;
  resources: number;
  tasks: number;
  stateChanges: number;
  horizon: { start: string | null; end: string | null } | null;
  validationErrorCount: number;
  validationWarningCount: number;
}

export interface TenantHealthReport {
  tenant: string;
  status: TenantHealthStatus;
  checks: {
    config: ConfigChecks;
    data: DataChecks;
    entities: EntityChecks;
    engine: EngineChecks;
  };
  warnings: string[];
  errors: string[];
}
