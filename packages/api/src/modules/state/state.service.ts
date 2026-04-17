import { Injectable } from '@nestjs/common';
import { SchedulingLandscape } from '@ctp/engine';
import { StateHydratorService } from './state-hydrator.service';
import { ConfigService } from '../../config/config.service';
import { SyncService } from '../integration/sync.service';
import { IRawDataPayload } from '../integration/adapter.interface';

@Injectable()
export class StateService {
  private landscapes = new Map<string, SchedulingLandscape>();

  constructor(
    private readonly hydrator: StateHydratorService,
    private readonly configService: ConfigService,
    private readonly syncService: SyncService,
  ) {}

  private syncFromConfig() {
    this.configService.reloadConfig();
    const tenantId = this.configService.getTenantId();
    const landscape = this.hydrator.buildLandscape();
    this.landscapes.set(tenantId, landscape);
    return this.buildSummaryResponse(landscape);
  }

  // Applies a pre-fetched and mapped payload onto the landscape.
  // When payload has data (REST adapter), hydrates from the payload arrays.
  // When payload is empty (file adapter), falls back to configService reads.
  applyTransformed(payload: IRawDataPayload) {
    const tenantId = this.configService.getTenantId();
    const landscape = this.hydrator.buildLandscape(payload);
    this.landscapes.set(tenantId, landscape);
    return this.buildSummaryResponse(landscape);
  }

  // Sync via the configured adapter (REST or file).
  // REST tenants: fetch → map → hydrate from payload.
  // File tenants with no adapter.json: falls back to syncFromConfig().
  async syncFromAdapter() {
    const adapterConfig = this.configService.getAdapterConfig();
    if (!adapterConfig || adapterConfig.adapterType !== 'rest') {
      return this.syncFromConfig();
    }
    const payload = await this.syncService.sync();
    return this.applyTransformed(payload);
  }

  async reloadAndSync() {
    this.configService.reloadConfig();
    return this.syncFromAdapter();
  }

  getLandscape(): SchedulingLandscape | null {
    const tenantId = this.configService.getTenantId();
    return this.landscapes.get(tenantId) ?? null;
  }

  getSummary() {
    const landscape = this.getLandscape();
    if (!landscape) {
      return { status: 'not_loaded' };
    }
    return this.buildSummaryResponse(landscape);
  }

  isLoaded(): boolean {
    return this.getLandscape() !== null;
  }

  private buildSummaryResponse(ls: SchedulingLandscape) {
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
    };
  }
}
