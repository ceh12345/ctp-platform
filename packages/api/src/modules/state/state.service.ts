import { Injectable } from '@nestjs/common';
import { SchedulingLandscape } from '@ctp/engine';
import { StateHydratorService } from './state-hydrator.service';
import { ConfigService } from '../../config/config.service';
import { SyncService } from '../integration/sync.service';
import { IRawDataPayload } from '../integration/adapter.interface';
import { validateReferences } from '../integration/validation-pass';
import { MappingError } from '../integration/mapping-error';
import {
  SyncResult,
  emptyValidationSummary,
  summarizeValidation,
} from '../integration/sync-result';

@Injectable()
export class StateService {
  private landscapes = new Map<string, SchedulingLandscape>();

  constructor(
    private readonly hydrator: StateHydratorService,
    private readonly configService: ConfigService,
    private readonly syncService: SyncService,
  ) {}

  private syncFromConfig(): SyncResult {
    this.configService.reloadConfig();
    const tenantId = this.configService.getTenantId();
    const landscape = this.hydrator.buildLandscape();
    validateReferences(landscape);
    this.landscapes.set(tenantId, landscape);
    return this.buildSyncResult(landscape, []);
  }

  // Applies a pre-fetched and mapped payload onto the landscape.
  // When payload has data (REST adapter), hydrates from the payload arrays.
  // When payload is empty (file adapter), falls back to configService reads.
  applyTransformed(payload: IRawDataPayload, mappingErrors: MappingError[] = []): SyncResult {
    const tenantId = this.configService.getTenantId();
    const landscape = this.hydrator.buildLandscape(payload);
    validateReferences(landscape);
    this.landscapes.set(tenantId, landscape);
    return this.buildSyncResult(landscape, mappingErrors);
  }

  // Sync via the configured adapter when the tenant uses an adapter-driven type.
  // 'rest': live HTTP fetch → map → hydrate from payload.
  // anything else (no adapter.json, or adapterType: 'file'): syncFromConfig() reads
  // tenant files via FileConfigStore (which now resolves through data/current/).
  async syncFromAdapter(): Promise<SyncResult> {
    const adapterConfig = this.configService.getAdapterConfig();
    if (adapterConfig?.adapterType !== 'rest') {
      return this.syncFromConfig();
    }
    const { payload, errors: mappingErrors } = await this.syncService.sync();
    return this.applyTransformed(payload, mappingErrors);
  }

  async reloadAndSync(): Promise<SyncResult> {
    this.configService.reloadConfig();
    return this.syncFromAdapter();
  }

  getLandscape(): SchedulingLandscape | null {
    const tenantId = this.configService.getTenantId();
    return this.landscapes.get(tenantId) ?? null;
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
