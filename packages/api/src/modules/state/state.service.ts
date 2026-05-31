import { Injectable } from '@nestjs/common';
import { SchedulingLandscape } from '@ctp/engine';
import { StateHydratorService } from './state-hydrator.service';
import { ConfigService } from '../../config/config.service';
import { SyncService } from '../integration/sync.service';
import { IRawDataPayload } from '../integration/adapter.interface';
import { validateReferences } from '../integration/validation-pass';
import { MappingError } from '../integration/mapping-error';
import { AttributeSourceMap } from '../integration/mapping-engine';
import {
  SyncResult,
  emptyValidationSummary,
  summarizeValidation,
} from '../integration/sync-result';
import { IWorkOrderGroupData } from '../../config/interfaces/config-store.interface';

@Injectable()
export class StateService {
  private landscapes = new Map<string, SchedulingLandscape>();
  private attributeSourcesByTenant = new Map<string, AttributeSourceMap>();

  constructor(
    private readonly hydrator: StateHydratorService,
    private readonly configService: ConfigService,
    private readonly syncService: SyncService,
  ) {}

  private syncFromConfig(): SyncResult {
    this.configService.reloadConfig();
    const tenantId = this.configService.getTenantId();
    const workOrderGroupsData = this.configService.getWorkOrderGroupsData();
    const landscape = this.hydrator.buildLandscape(undefined, workOrderGroupsData);
    validateReferences(landscape);
    this.landscapes.set(tenantId, landscape);
    return this.buildSyncResult(landscape, []);
  }

  // Applies a pre-fetched and mapped payload onto the landscape.
  // When payload has data (REST adapter), hydrates from the payload arrays.
  // When payload is empty (file adapter), falls back to configService reads.
  applyTransformed(
    payload: IRawDataPayload,
    workOrderGroups: IWorkOrderGroupData[] = [],
    mappingErrors: MappingError[] = [],
    attributeSources: AttributeSourceMap = new Map(),
  ): SyncResult {
    const tenantId = this.configService.getTenantId();
    const landscape = this.hydrator.buildLandscape(payload, workOrderGroups);
    validateReferences(landscape);
    this.landscapes.set(tenantId, landscape);
    this.attributeSourcesByTenant.set(tenantId, attributeSources);
    return this.buildSyncResult(landscape, mappingErrors);
  }

  // Sync via the configured adapter (REST or file).
  // REST tenants: fetch → map → hydrate from payload.
  // File tenants with no adapter.json: falls back to syncFromConfig().
  async syncFromAdapter(): Promise<SyncResult> {
    const adapterConfig = this.configService.getAdapterConfig();
    if (!adapterConfig || adapterConfig.adapterType !== 'rest') {
      return this.syncFromConfig();
    }
    const { payload, workOrderGroups, attributeSources, errors: mappingErrors } = await this.syncService.sync();
    return this.applyTransformed(payload, workOrderGroups, mappingErrors, attributeSources);
  }

  async reloadAndSync(): Promise<SyncResult> {
    this.configService.reloadConfig();
    return this.syncFromAdapter();
  }

  getLandscape(): SchedulingLandscape | null {
    const tenantId = this.configService.getTenantId();
    return this.landscapes.get(tenantId) ?? null;
  }

  /** Profile-level attribute-source sidecar from the last successful sync. Empty Map when no mapping profile or no attributes were declared. */
  getAttributeSources(): AttributeSourceMap {
    const tenantId = this.configService.getTenantId();
    return this.attributeSourcesByTenant.get(tenantId) ?? new Map();
  }

  getSummary(): SyncResult {
    const landscape = this.getLandscape();
    if (!landscape) {
      return {
        status: 'not_loaded',
        mappingErrors: [],
        validationSummary: emptyValidationSummary(),
      };
    }
    // getSummary reports the current landscape; no transform ran, so no mappingErrors.
    return this.buildSyncResult(landscape, []);
  }

  isLoaded(): boolean {
    return this.getLandscape() !== null;
  }

  private buildSyncResult(ls: SchedulingLandscape, mappingErrors: MappingError[]): SyncResult {
    return {
      status: 'ok',
      summary: {
        resources: ls.resources.size(),
        tasks: ls.tasks.size(),
        horizon: {
          start: ls.horizon.startDate.toISO(),
          end: ls.horizon.endDate.toISO(),
        },
        stateChanges: ls.stateChanges.size(),
        settings: {
          scheduleDirection: ls.appSettings?.scheduleDirection ?? 1,
        },
      },
      mappingErrors,
      validationSummary: summarizeValidation(ls),
    };
  }
}
