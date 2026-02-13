import { Injectable, Inject } from '@nestjs/common';
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
} from './interfaces/config-store.interface';
import { FileConfigStore } from './file-config-store';

@Injectable()
export class ConfigService {
  private store: IConfigStore;
  private readonly configRootPath: string;

  constructor(@Inject('CONFIG_STORE') store: IConfigStore) {
    this.store = store;
    this.configRootPath = (store as any).configRootPath ?? './config';
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

  reloadConfig(): void {
    this.store.reload();
  }

  switchTenant(tenantId: string): void {
    this.store = new FileConfigStore(this.configRootPath, tenantId);
  }
}
