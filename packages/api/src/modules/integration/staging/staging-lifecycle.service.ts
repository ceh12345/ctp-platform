import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service';
import { StagingService } from './staging.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StagingLifecycleService implements OnModuleInit, OnModuleDestroy {
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly staging: StagingService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const cfg = this.config.getStagingConfig();
    if (!cfg.enabled) return;

    const tenant = this.config.getTenantId();

    // Recover from unclean shutdowns: drop *.tmp/ and *.new/ that survived
    // a kill-9 mid-sync. Promoted snapshots and *.failed/ are preserved.
    await this.staging.cleanupOrphans(tenant);

    this.retentionTimer = setInterval(() => {
      this.runPrune(tenant, cfg.retentionDays).catch((err) => {
        // Log via console; the main logging pipeline isn't wired here yet.
        // eslint-disable-next-line no-console
        console.error('[staging] retention prune failed:', err);
      });
    }, DAY_MS);

    // setInterval's first tick is in DAY_MS; run once at startup too so
    // a long-running process doesn't wait a full day for the first prune.
    await this.runPrune(tenant, cfg.retentionDays).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[staging] initial retention prune failed:', err);
    });
  }

  onModuleDestroy(): void {
    if (this.retentionTimer != null) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  private async runPrune(tenant: string, retentionDays: number): Promise<void> {
    await this.staging.pruneOld(tenant, retentionDays);
  }
}
