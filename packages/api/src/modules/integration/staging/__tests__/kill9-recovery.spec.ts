import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../../config/config.service';
import { IStagingConfig } from '../../../../config/interfaces/config-store.interface';
import { IDataAdapter, IRawDataPayload } from '../../adapter.interface';
import { StagingLifecycleService } from '../staging-lifecycle.service';
import { StagingService } from '../staging.service';
import { SyncOrchestrator } from '../sync-orchestrator';

const TENANT = 'acme';

function payload(): IRawDataPayload {
  return {
    resources: [{ Code: 'R1' }],
    tasks: [{ WorkOrderCode: 'WO1', OperationCode: 'OP1', JobCode: 'J1' }],
    calendars: [],
    stateChanges: [],
    products: [],
    orders: [{ JobCode: 'J1' }],
    materials: [],
    processes: [],
    cadences: [],
    uomConversions: null,
  };
}

class FakeAdapter implements IDataAdapter {
  readonly adapterType = 'fake';
  async fetchRawData() {
    return payload();
  }
}

class StubConfig {
  constructor(private readonly cfg: IStagingConfig, private readonly tenant: string) {}
  getStagingConfig() {
    return this.cfg;
  }
  getTenantId() {
    return this.tenant;
  }
}

describe('kill-9 mid-sync recovery', () => {
  let rootDir: string;
  let staging: StagingService;
  let orch: SyncOrchestrator;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `kill9-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    staging = new StagingService(rootDir);
    orch = new SyncOrchestrator(staging);
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it('after orphaned .tmp from mid-sync abort, lifecycle init cleans it; prior current survives', async () => {
    // First: a clean sync establishes a good "previous" snapshot.
    const firstResult = await orch.runSync(TENANT, new FakeAdapter());
    expect(firstResult.ok).toBe(true);
    const goodCurrentPath = await staging.current(TENANT);
    expect(goodCurrentPath).not.toBeNull();

    // Simulate a kill-9 mid-sync: createSnapshot makes the tmp dirs, then
    // writeRaw writes some files, then the process dies before promote.
    // (Real kill-9 leaves the partial tmp dir on disk; we re-create that
    // state manually so the test is deterministic.)
    const orphanHandle = staging.createSnapshot(TENANT, new Date(2026, 4, 23, 14, 30));
    await staging.writeRaw(orphanHandle, 'resources', [{ MachineCode: 'M2' }]);
    // No promote, no markFailed — the process "died" here.

    // Confirm the orphan exists on disk.
    const orphanDir = path.join(rootDir, TENANT, '2026-05-23-1430.tmp');
    const orphanExistsBefore = await fs.promises
      .access(orphanDir)
      .then(() => true)
      .catch(() => false);
    expect(orphanExistsBefore).toBe(true);

    // Container restart: StagingLifecycleService.onModuleInit runs orphan cleanup.
    const config = new StubConfig(
      { enabled: true, rootDir, retentionDays: 30 },
      TENANT,
    ) as unknown as ConfigService;
    const lifecycle = new StagingLifecycleService(staging, config);
    await lifecycle.onModuleInit();

    // Orphan is gone.
    const orphanExistsAfter = await fs.promises
      .access(orphanDir)
      .then(() => true)
      .catch(() => false);
    expect(orphanExistsAfter).toBe(false);

    // Current still resolves to the prior good snapshot.
    const currentNow = await staging.current(TENANT);
    expect(currentNow).toBe(goodCurrentPath);

    lifecycle.onModuleDestroy();
  });

  it('orphan cleanup leaves .failed/ snapshots in place', async () => {
    // Simulate a sync that ran to validation, failed, and was marked .failed.
    const handle = staging.createSnapshot(TENANT, new Date(2026, 4, 22, 10, 0));
    await staging.writeRaw(handle, 'resources', []);
    await staging.markFailed(handle);

    const failedDir = path.join(rootDir, TENANT, '2026-05-22-1000.failed');
    await staging.cleanupOrphans(TENANT);

    const stillThere = await fs.promises.lstat(failedDir);
    expect(stillThere.isDirectory()).toBe(true);
  });

  it('mid-sync abort with no prior snapshot: current stays null, orphan cleaned', async () => {
    // No prior sync. Orphan only.
    const orphan = staging.createSnapshot(TENANT, new Date(2026, 4, 23, 14, 30));
    await staging.writeRaw(orphan, 'resources', [{ MachineCode: 'M1' }]);

    const config = new StubConfig(
      { enabled: true, rootDir, retentionDays: 30 },
      TENANT,
    ) as unknown as ConfigService;
    const lifecycle = new StagingLifecycleService(staging, config);
    await lifecycle.onModuleInit();

    expect(await staging.current(TENANT)).toBeNull();
    const orphanDir = path.join(rootDir, TENANT, '2026-05-23-1430.tmp');
    const exists = await fs.promises
      .access(orphanDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);

    lifecycle.onModuleDestroy();
  });
});
