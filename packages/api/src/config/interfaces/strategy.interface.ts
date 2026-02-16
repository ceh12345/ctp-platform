export interface StrategyConfig {
  key: string;
  label: string;
  icon: string;
  short: string;
  detail: string;
  bestFor: string;
  time: string;
  enabled: boolean;
  isGlobal: boolean;
  isPublic: boolean;
  sortOrder: number;
  tier?: string;
}

export interface TenantStrategyOverride {
  strategyKey: string;
  label?: string;
  icon?: string;
  short?: string;
  detail?: string;
  bestFor?: string;
  time?: string;
  enabled?: boolean;
}

export interface TenantCustomStrategy {
  key: string;
  label: string;
  icon: string;
  short: string;
  detail: string;
  bestFor: string;
  time: string;
  handler: string;
  sortOrder: number;
  tier: string;
  enabled: boolean;
}
