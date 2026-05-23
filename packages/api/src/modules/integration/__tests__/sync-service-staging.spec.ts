import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../config/config.service';
import { IStagingConfig } from '../../../config/interfaces/config-store.interface';
import { AdapterFactory } from '../adapter-factory';
import { IDataAdapter, IRawDataPayload } from '../adapter.interface';
import { MappingEngine } from '../mapping-engine';
import { StagingReadAdapter } from '../staging/staging-read.adapter';
import { StagingService } from '../staging/staging.service';
import { SyncOrchestrator } from '../staging/sync-orchestrator';
import { SyncService } from '../sync.service';

class FakeAdapter implements IDataAdapter {
  readonly adapterType = 'fake';
  constructor(private readonly payload: IRawDataPayload) {}
  async fetchRawData() {
    return this.payload;
  }
}

function payload(): IRawDataPayload {
  return {
    resources: [{ MachineCode: 'M1' }],
    tasks: [{ WorkOrderCode: 'WO1', TaskCode: 'T1', JobCode: 'J1' }],
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

class StubConfig {
  staging: IStagingConfig;
  constructor(rootDir: string, enabled: boolean) {
    this.staging = { enabled, rootDir, retentionDays: 30 };
  }
  getStagingConfig() {
    return this.staging;
  }
  getTenantId() {
    return 'acme';
  }
  getMappingProfile() {
    return null;
  }
  getAdapterConfig() {
    return null;
  }
}

class StubAdapterFactory {
  constructor(private readonly adapter: IDataAdapter) {}
  create() {
    return this.adapter;
  }
}

describe('SyncService — staging flag wiring', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `sync-svc-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it('staging.enabled=false uses direct adapter path (identity mapping)', async () => {
    const data = payload();
    const config = new StubConfig(rootDir, false) as unknown as ConfigService;
    const adapter = new FakeAdapter(data);
    const af = new StubAdapterFactory(adapter) as unknown as AdapterFactory;
    const me = new MappingEngine();
    const staging = new StagingService(rootDir);
    const orch = new SyncOrchestrator(staging);

    const svc = new SyncService(af, me, config, orch, staging);
    const result = await svc.sync();

    expect(result.errors).toEqual([]);
    expect(result.payload.tasks).toEqual(data.tasks);

    // Did NOT create any staging directories.
    const tenantDir = path.join(rootDir, 'acme');
    const exists = await fs.promises.access(tenantDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('staging.enabled=true routes through orchestrator and StagingReadAdapter', async () => {
    const data = payload();
    const config = new StubConfig(rootDir, true) as unknown as ConfigService;
    const adapter = new FakeAdapter(data);
    const af = new StubAdapterFactory(adapter) as unknown as AdapterFactory;
    const me = new MappingEngine();
    const staging = new StagingService(rootDir);
    const orch = new SyncOrchestrator(staging);

    const svc = new SyncService(af, me, config, orch, staging);
    const result = await svc.sync();

    expect(result.errors).toEqual([]);
    expect(result.payload.tasks).toEqual(data.tasks);

    // Snapshot was promoted; current resolves.
    const current = await staging.current('acme');
    expect(current).not.toBeNull();

    // StagingReadAdapter sees the same data.
    const reader = new StagingReadAdapter(staging, 'acme');
    const fromStaging = await reader.fetchRawData();
    expect(fromStaging.tasks).toEqual(data.tasks);
  });

  it('flag-on and flag-off return equivalent MappingResults for the same input', async () => {
    const data = payload();

    // Flag off.
    {
      const config = new StubConfig(rootDir, false) as unknown as ConfigService;
      const af = new StubAdapterFactory(new FakeAdapter(data)) as unknown as AdapterFactory;
      const me = new MappingEngine();
      const staging = new StagingService(rootDir);
      const orch = new SyncOrchestrator(staging);
      const svc = new SyncService(af, me, config, orch, staging);
      const direct = await svc.sync();

      // Flag on (fresh staging root).
      const root2 = path.join(os.tmpdir(), `sync-svc-cmp-${crypto.randomUUID()}`);
      await fs.promises.mkdir(root2, { recursive: true });
      try {
        const config2 = new StubConfig(root2, true) as unknown as ConfigService;
        const af2 = new StubAdapterFactory(new FakeAdapter(data)) as unknown as AdapterFactory;
        const me2 = new MappingEngine();
        const staging2 = new StagingService(root2);
        const orch2 = new SyncOrchestrator(staging2);
        const svc2 = new SyncService(af2, me2, config2, orch2, staging2);
        const viaStaging = await svc2.sync();

        expect(viaStaging.payload).toEqual(direct.payload);
        expect(viaStaging.errors).toEqual(direct.errors);
      } finally {
        await fs.promises.rm(root2, { recursive: true, force: true });
      }
    }
  });
});
