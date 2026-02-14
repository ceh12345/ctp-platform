import { Injectable } from '@nestjs/common';
import { SchedulingLandscape } from '@ctp/engine';
import { StateHydratorService } from './state-hydrator.service';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class StateService {
  private landscape: SchedulingLandscape | null = null;

  constructor(
    private readonly hydrator: StateHydratorService,
    private readonly configService: ConfigService,
  ) {}

  syncFromConfig() {
    this.landscape = this.hydrator.buildLandscape();
    return this.buildSummaryResponse();
  }

  reloadAndSync() {
    this.configService.reloadConfig();
    return this.syncFromConfig();
  }

  getLandscape(): SchedulingLandscape | null {
    return this.landscape;
  }

  getSummary() {
    if (!this.landscape) {
      return { status: 'not_loaded' };
    }
    return this.buildSummaryResponse();
  }

  isLoaded(): boolean {
    return this.landscape !== null;
  }

  private buildSummaryResponse() {
    const ls = this.landscape!;
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
