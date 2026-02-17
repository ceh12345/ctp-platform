import { Injectable } from '@nestjs/common';
import { SchedulingLandscape } from '@ctp/engine';
import { StateHydratorService } from './state-hydrator.service';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class StateService {
  private landscapes = new Map<string, SchedulingLandscape>();

  constructor(
    private readonly hydrator: StateHydratorService,
    private readonly configService: ConfigService,
  ) {}

  syncFromConfig() {
    const tenantId = this.configService.getTenantId();
    const landscape = this.hydrator.buildLandscape();
    this.landscapes.set(tenantId, landscape);
    return this.buildSummaryResponse(landscape);
  }

  reloadAndSync() {
    this.configService.reloadConfig();
    return this.syncFromConfig();
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
