import { Injectable } from '@nestjs/common';
import { IRollupEngineConfig, RollupEngine, SchedulingLandscape } from '@ctp/engine';
import { ConfigService } from '../../config/config.service';

/**
 * Wraps tenant config and constructs RollupEngine instances on demand.
 * Mirrors the strategy-config-service pattern: an @Injectable that
 * provides domain-shaped access to a tenant config slot.
 *
 * The engine itself stays pure (no NestJS dependency); this service is
 * the boundary that translates tenant config into the engine's
 * IRollupEngineConfig shape.
 */
@Injectable()
export class WorkOrderGroupService {
  /**
   * Default config for tenants that don't ship a workordergroups.json.
   * cancellationPredicate.values is empty → engine counts no orders as
   * cancelled, status derivation falls through to timing-based branches.
   */
  private static readonly DEFAULT_CONFIG: IRollupEngineConfig = {
    bufferDays: 3,
    cancellationPredicate: { field: 'wostatus', values: [] },
  };

  constructor(private readonly configService: ConfigService) {}

  private getConfig(): IRollupEngineConfig {
    return this.configService.getWorkOrderGroupsConfig() ?? WorkOrderGroupService.DEFAULT_CONFIG;
  }

  private buildEngine(): RollupEngine {
    return new RollupEngine(this.getConfig());
  }

  /** Sync-flow hook — call after orders/tasks/groups are hydrated into the landscape. */
  rebuildGroups(landscape: SchedulingLandscape): void {
    this.buildEngine().rebuildGroups(landscape.orders, landscape.tasks, landscape.groups);
  }

  /** Post-solve hook — call after the scheduler finishes to refresh rollup values. */
  refreshRollups(landscape: SchedulingLandscape, now: number): void {
    this.buildEngine().refreshRollups(landscape.groups, landscape.orders, landscape.tasks, now);
  }
}
