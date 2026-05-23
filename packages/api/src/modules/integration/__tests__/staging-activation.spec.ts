/**
 * E2E: pre-seeded staging consumed by SyncService via AdapterFactory.
 *
 * Models the M4 activation pattern (flavor C): `staging.enabled=false` +
 * `adapter.json.adapterType=staging-read`. SyncService takes the direct
 * adapter path; AdapterFactory returns StagingReadAdapter; engine receives
 * data from current/raw/ — no orchestrator, no HTTP, no live adapter.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../config/config.service';
import {
  IAdapterConfig,
  IStagingConfig,
} from '../../../config/interfaces/config-store.interface';
import { cmdSeed } from '../../../cli/staging';
import { AdapterFactory } from '../adapter-factory';
import { MappingEngine } from '../mapping-engine';
import { StagingService } from '../staging/staging.service';
import { SyncOrchestrator } from '../staging/sync-orchestrator';
import { SyncService } from '../sync.service';

const TENANT = 'stafford-slim-100-staging-test';

class StubConfig {
  constructor(
    private readonly staging: IStagingConfig,
    private readonly adapter: IAdapterConfig | null,
    private readonly tenant: string,
  ) {}
  getStagingConfig() {
    return this.staging;
  }
  getAdapterConfig() {
    return this.adapter;
  }
  getMappingProfile() {
    return null;
  }
  getTenantId() {
    return this.tenant;
  }
}

describe('staging activation — pre-seeded read-only path', () => {
  let rootDir: string;
  let sourceDir: string;
  let staging: StagingService;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `activate-${crypto.randomUUID()}`);
    sourceDir = path.join(os.tmpdir(), `activate-src-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    await fs.promises.mkdir(sourceDir, { recursive: true });
    staging = new StagingService(rootDir);

    // Author a WORK7-shape source directory (matches Stafford Genius capture).
    await fs.promises.writeFile(
      path.join(sourceDir, 'resources.json'),
      JSON.stringify([{ Code: 'R1' }, { Code: 'R2' }]),
    );
    await fs.promises.writeFile(
      path.join(sourceDir, 'tasks.json'),
      JSON.stringify([
        { WorkOrderCode: 'WO1', OperationCode: 'OP1', JobCode: 'J1' },
        { WorkOrderCode: 'WO2', OperationCode: 'OP2', JobCode: 'J2' },
      ]),
    );
    await fs.promises.writeFile(
      path.join(sourceDir, 'orders.json'),
      JSON.stringify([{ JobCode: 'J1' }, { JobCode: 'J2' }]),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
    await fs.promises.rm(sourceDir, { recursive: true, force: true });
  });

  it('seed → SyncService.sync() returns the seeded data with no live adapter', async () => {
    // Step 1: seed.
    const seedCode = await cmdSeed(staging, TENANT, sourceDir, true);
    expect(seedCode).toBe(0);

    // Step 2: configure SyncService to take the direct-adapter path with a
    // staging-read adapter — matches the M4 tenant's integration/staging.json
    // (enabled: false) + integration/adapter.json (adapterType: staging-read).
    const config = new StubConfig(
      { enabled: false, rootDir, retentionDays: 30 },
      { adapterType: 'staging-read' },
      TENANT,
    ) as unknown as ConfigService;

    const adapterFactory = new AdapterFactory(config, staging);
    const mapping = new MappingEngine();
    const orchestrator = new SyncOrchestrator(staging); // dormant; flag is off
    const sync = new SyncService(adapterFactory, mapping, config, orchestrator, staging);

    // Step 3: sync. Should read seeded data via StagingReadAdapter (returned
    // by AdapterFactory because adapterType === 'staging-read').
    const result = await sync.sync();

    expect(result.errors).toEqual([]);
    expect(result.payload.tasks).toEqual([
      { WorkOrderCode: 'WO1', OperationCode: 'OP1', JobCode: 'J1' },
      { WorkOrderCode: 'WO2', OperationCode: 'OP2', JobCode: 'J2' },
    ]);
    expect(result.payload.resources).toEqual([
      { Code: 'R1' },
      { Code: 'R2' },
    ]);
    expect(result.payload.orders).toEqual([{ JobCode: 'J1' }, { JobCode: 'J2' }]);
  });

  it('without seed, SyncService.sync() throws (no current snapshot)', async () => {
    const config = new StubConfig(
      { enabled: false, rootDir, retentionDays: 30 },
      { adapterType: 'staging-read' },
      TENANT,
    ) as unknown as ConfigService;

    const adapterFactory = new AdapterFactory(config, staging);
    const mapping = new MappingEngine();
    const orchestrator = new SyncOrchestrator(staging);
    const sync = new SyncService(adapterFactory, mapping, config, orchestrator, staging);

    await expect(sync.sync()).rejects.toThrow(/no current snapshot/);
  });

});
