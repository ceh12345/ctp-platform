import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from './config.service';
import { IScheduleConfiguration } from './interfaces/config-store.interface';

@Injectable()
export class ScheduleConfigurationService {
  /** Per-tenant active configuration key (session state) */
  private activeKeys = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  /** Get all configurations for the current tenant. Falls back to virtual default from scoring.json. */
  getAll(): { configurations: IScheduleConfiguration[]; activeKey: string } {
    let configs = this.configService.getConfigurations();
    if (configs.length === 0) {
      configs = [this.buildVirtualDefault()];
    }
    const activeKey = this.getActiveKey();
    // Sort: default first, then alphabetical
    configs.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
    return { configurations: configs, activeKey };
  }

  /** Get a single configuration by key */
  getByKey(key: string): IScheduleConfiguration | null {
    const configs = this.configService.getConfigurations();
    return configs.find(c => c.key === key) ?? null;
  }

  /** Create a new configuration */
  create(input: Partial<IScheduleConfiguration> & { name: string }): IScheduleConfiguration {
    let configs = this.configService.getConfigurations();
    // If no configs file exists yet, bootstrap with the virtual default
    if (configs.length === 0) {
      configs = [this.buildVirtualDefault()];
    }
    const key = this.slugify(input.name);
    if (configs.find(c => c.key === key)) {
      throw new HttpException(`Configuration "${key}" already exists`, HttpStatus.CONFLICT);
    }
    const config: IScheduleConfiguration = {
      key,
      name: input.name,
      description: input.description,
      owner: input.owner ?? 'tenant',
      isDefault: configs.length === 0,
      updatedAt: new Date().toISOString(),
      scoring: input.scoring ?? [],
      strategy: input.strategy ?? 'Chain',
      tier: input.tier ?? 'quick',
      suggestedExperienceLevel: input.suggestedExperienceLevel,
      solverDepth: input.solverDepth,
      constraints: input.constraints,
      horizon: input.horizon,
      defaultFilters: input.defaultFilters,
      costVisibility: input.costVisibility,
    };
    configs.push(config);
    this.configService.saveConfigurations(configs);
    return config;
  }

  /** Update an existing configuration (partial — preserves unset fields) */
  update(key: string, patch: Partial<IScheduleConfiguration>): IScheduleConfiguration {
    const configs = this.configService.getConfigurations();
    const idx = configs.findIndex(c => c.key === key);
    if (idx === -1) {
      throw new HttpException(`Configuration "${key}" not found`, HttpStatus.NOT_FOUND);
    }
    const updated = { ...configs[idx], ...patch, key, updatedAt: new Date().toISOString() };
    configs[idx] = updated;
    this.configService.saveConfigurations(configs);
    return updated;
  }

  /** Delete a configuration */
  delete(key: string): void {
    let configs = this.configService.getConfigurations();
    if (configs.length === 0) configs = [this.buildVirtualDefault()];
    const config = configs.find(c => c.key === key);
    if (!config) {
      throw new HttpException(`Configuration "${key}" not found`, HttpStatus.NOT_FOUND);
    }
    if (config.isDefault) {
      throw new HttpException('Cannot delete the default configuration', HttpStatus.BAD_REQUEST);
    }
    const filtered = configs.filter(c => c.key !== key);
    this.configService.saveConfigurations(filtered);
    // Clear active key if it was this one
    const tenantId = this.configService.getTenantId();
    if (this.activeKeys.get(tenantId) === key) {
      this.activeKeys.delete(tenantId);
    }
  }

  /** Set the active configuration for this session */
  activate(key: string): void {
    const configs = this.configService.getConfigurations();
    if (!configs.find(c => c.key === key)) {
      throw new HttpException(`Configuration "${key}" not found`, HttpStatus.NOT_FOUND);
    }
    this.activeKeys.set(this.configService.getTenantId(), key);
  }

  /** Set a configuration as the tenant default */
  setDefault(key: string): void {
    const configs = this.configService.getConfigurations();
    const target = configs.find(c => c.key === key);
    if (!target) {
      throw new HttpException(`Configuration "${key}" not found`, HttpStatus.NOT_FOUND);
    }
    for (const c of configs) {
      c.isDefault = c.key === key;
    }
    this.configService.saveConfigurations(configs);
  }

  /** Get the active configuration (or default) */
  getActive(): IScheduleConfiguration | null {
    const activeKey = this.getActiveKey();
    const configs = this.configService.getConfigurations();
    if (configs.length === 0) return this.buildVirtualDefault();
    return configs.find(c => c.key === activeKey) ?? configs.find(c => c.isDefault) ?? configs[0] ?? null;
  }

  /** Resolve a configuration for a solve request */
  resolveForSolve(configurationKey?: string): IScheduleConfiguration | null {
    if (configurationKey) {
      return this.getByKey(configurationKey);
    }
    return this.getActive();
  }

  private getActiveKey(): string {
    const tenantId = this.configService.getTenantId();
    const active = this.activeKeys.get(tenantId);
    if (active) return active;
    // Default to the default config
    const configs = this.configService.getConfigurations();
    const def = configs.find(c => c.isDefault);
    return def?.key ?? 'default';
  }

  /** Build a virtual default from scoring.json + settings when no configurations.json exists */
  private buildVirtualDefault(): IScheduleConfiguration {
    const scoring = this.configService.getScoring();
    const settings = this.configService.getSettings();
    return {
      key: 'default',
      name: 'Standard',
      description: 'Default configuration (from scoring.json)',
      owner: 'tenant',
      isDefault: true,
      updatedAt: new Date().toISOString(),
      scoring: scoring?.rules?.map((r: any) => ({
        ruleName: r.ruleName,
        weight: r.weight,
        objective: r.objective,
        includeInSolve: r.includeInSolve,
        penaltyFactor: r.penaltyFactor,
        group: r.group,
      })) ?? [],
      strategy: (settings as any)?.solverStrategy ?? 'Chain',
      tier: 'quick',
    };
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}
