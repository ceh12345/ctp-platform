import { Injectable, Inject } from '@nestjs/common';
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
  ICadenceData,
  IScheduleConfiguration,
  IUOMConversionsFileData,
  IAdapterConfig,
  IMappingProfile,
} from './interfaces/config-store.interface';
import { IRollupEngineConfig } from '@ctp/engine';
import { TenantStrategyOverride, TenantCustomStrategy } from './interfaces/strategy.interface';
import { FileConfigStore } from './file-config-store';

@Injectable()
export class ConfigService {
  private store: IConfigStore;
  private readonly configRootPath: string;
  private currentTenantId: string;

  constructor(@Inject('CONFIG_STORE') store: IConfigStore) {
    this.store = store;
    this.configRootPath = (store as any).configRootPath ?? './config';
    this.currentTenantId = (store as any).tenantId ?? 'demo-manufacturing';
  }

  getTenantId(): string {
    return this.currentTenantId;
  }

  getTenantConfig(): ITenantConfig | null {
    return this.store.getTenant();
  }

  getSchema(entityType: string): IEntitySchema | null {
    return this.store.getSchema(entityType);
  }

  getKPIs(): IKPIDefinition[] {
    return this.store.getKPIs();
  }

  /** Returns business-value rates for savings estimates. null when not configured for this tenant. */
  getKPIRates(): IKpiRates | null {
    return this.store.getKPIRates();
  }

  getTerminology(): ITerminologyMap {
    return this.store.getTerminology();
  }

  getScoring(): IScoringConfig | null {
    return this.store.getScoring();
  }

  getSettings(): ISettingsConfig {
    return this.store.getSettings();
  }

  getHorizon(): IHorizonConfig | null {
    return this.store.getHorizon();
  }

  getResources(): IResourceData[] {
    return this.store.getResources();
  }

  getTasks(): ITaskData[] {
    return this.store.getTasks();
  }

  getCalendars(): ICalendarData[] {
    return this.store.getCalendars();
  }

  getStateChanges(): IStateChangeData[] {
    return this.store.getStateChanges();
  }

  getProducts(): IProductData[] {
    return this.store.getProducts();
  }

  getOrders(): IOrderData[] {
    return this.store.getOrders();
  }

  getMaterials(): IMaterialData[] {
    return this.store.getMaterials();
  }

  getProcesses(): any[] {
    return this.store.getProcesses();
  }

  getCadences(): ICadenceData[] {
    return this.store.getCadences();
  }

  getUomConversions(): IUOMConversionsFileData | null {
    return this.store.getUomConversions();
  }

  getCadence(key: string): ICadenceData | undefined {
    return this.store.getCadences().find(c => c.key === key);
  }

  getColors(): any {
    return this.store.getColors();
  }

  getLocale(): any {
    return this.store.getLocale();
  }

  getStrategyOverrides(): TenantStrategyOverride[] {
    return this.store.getStrategyOverrides();
  }

  getCustomStrategies(): TenantCustomStrategy[] {
    return this.store.getCustomStrategies();
  }

  getConfigurations(): IScheduleConfiguration[] {
    return this.store.getConfigurations();
  }

  saveConfigurations(configs: IScheduleConfiguration[]): void {
    this.store.saveConfigurations(configs);
  }

  getAdapterConfig(): IAdapterConfig | null {
    return this.store.getAdapterConfig?.() ?? null;
  }

  getMappingProfile(): IMappingProfile | null {
    return this.store.getMappingProfile?.() ?? null;
  }

  getWorkOrderGroupsConfig(): IRollupEngineConfig | null {
    return this.store.getWorkOrderGroupsConfig?.() ?? null;
  }

  reloadConfig(): void {
    this.store.reload();
  }

  getConfigRoot(): string {
    return this.configRootPath;
  }

  switchTenant(tenantId: string): void {
    if (tenantId !== this.currentTenantId) {
      this.store = new FileConfigStore(this.configRootPath, tenantId);
      this.currentTenantId = tenantId;
    }
  }
}
