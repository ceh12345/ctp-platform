import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../../config/config.service';
import { IStagingConfig } from '../../../../config/interfaces/config-store.interface';
import { StagingLifecycleService } from '../staging-lifecycle.service';
import { StagingService } from '../staging.service';

class StubConfig {
  constructor(private readonly cfg: IStagingConfig, private readonly tenant: string) {}
  getStagingConfig() {
    return this.cfg;
  }
  getTenantId() {
    return this.tenant;
  }
}

const TENANT = 'acme';

describe('StagingLifecycleService', () => {
  let rootDir: string;
  let staging: StagingService;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `staging-life-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    staging = new StagingService(rootDir);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it('does nothing when staging is disabled', async () => {
    const tenantDir = path.join(rootDir, TENANT);
    await fs.promises.mkdir(path.join(tenantDir, '2026-05-22-1000.tmp'), { recursive: true });

    const config = new StubConfig(
      { enabled: false, rootDir, retentionDays: 30 },
      TENANT,
    ) as unknown as ConfigService;
    const svc = new StagingLifecycleService(staging, config);
    await svc.onModuleInit();

    // Orphan still there.
    const remaining = await fs.promises.readdir(tenantDir);
    expect(remaining).toEqual(['2026-05-22-1000.tmp']);
    svc.onModuleDestroy();
  });

  it('cleans orphans on init when enabled', async () => {
    const tenantDir = path.join(rootDir, TENANT);
    await fs.promises.mkdir(path.join(tenantDir, '2026-05-22-1000.tmp'), { recursive: true });
    await fs.promises.mkdir(path.join(tenantDir, '2026-05-22-1100'), { recursive: true });
    await fs.promises.mkdir(path.join(tenantDir, '2026-05-22-1200.failed'), { recursive: true });

    const config = new StubConfig(
      { enabled: true, rootDir, retentionDays: 30 },
      TENANT,
    ) as unknown as ConfigService;
    const svc = new StagingLifecycleService(staging, config);
    await svc.onModuleInit();

    const remaining = await fs.promises.readdir(tenantDir);
    const dirsOnly = remaining.filter((n) => !n.startsWith('_'));
    expect(dirsOnly.sort()).toEqual(['2026-05-22-1100', '2026-05-22-1200.failed']);
    svc.onModuleDestroy();
  });

  it('schedules a 24h retention prune and clears it on destroy', async () => {
    const tenantDir = path.join(rootDir, TENANT);
    await fs.promises.mkdir(tenantDir, { recursive: true });

    const config = new StubConfig(
      { enabled: true, rootDir, retentionDays: 30 },
      TENANT,
    ) as unknown as ConfigService;
    const pruneSpy = vi.spyOn(staging, 'pruneOld');
    const svc = new StagingLifecycleService(staging, config);

    await svc.onModuleInit();
    // Initial prune ran at startup.
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenLastCalledWith(TENANT, 30);

    // Advance 24h; interval should fire.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(pruneSpy).toHaveBeenCalledTimes(2);

    svc.onModuleDestroy();
    // Further timer advances should not fire the interval after destroy.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(pruneSpy).toHaveBeenCalledTimes(2);
  });
});
