import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IDataAdapter, IRawDataPayload } from '../../adapter.interface';
import { StagingReadAdapter } from '../staging-read.adapter';
import { StagingService } from '../staging.service';
import { SyncOrchestrator } from '../sync-orchestrator';

const TENANT = 'acme';

class FakeAdapter implements IDataAdapter {
  readonly adapterType = 'fake';
  constructor(private readonly payload: IRawDataPayload) {}
  async fetchRawData() {
    return this.payload;
  }
}

describe('StagingReadAdapter', () => {
  let rootDir: string;
  let staging: StagingService;
  let orch: SyncOrchestrator;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `staging-read-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    staging = new StagingService(rootDir);
    orch = new SyncOrchestrator(staging);
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it('reads back the same payload the orchestrator wrote', async () => {
    const payload: IRawDataPayload = {
      resources: [{ MachineCode: 'M1' }],
      tasks: [{ WorkOrderCode: 'WO1', TaskCode: 'T1', JobCode: 'J1' }],
      calendars: [{ Id: 1 }],
      stateChanges: [],
      products: [{ ItemCode: 'P1' }],
      orders: [{ JobCode: 'J1' }],
      materials: [],
      processes: [{ ProcessCode: 'PROC1' }],
      cadences: [],
      uomConversions: { globalConversions: [{ from: 'HR', to: 's', factor: 3600 }] },
    };

    await orch.runSync(TENANT, new FakeAdapter(payload));

    const reader = new StagingReadAdapter(staging, TENANT);
    const round = await reader.fetchRawData();

    expect(round.resources).toEqual(payload.resources);
    expect(round.tasks).toEqual(payload.tasks);
    expect(round.calendars).toEqual(payload.calendars);
    expect(round.orders).toEqual(payload.orders);
    expect(round.products).toEqual(payload.products);
    expect(round.processes).toEqual(payload.processes);
    expect(round.uomConversions).toEqual(payload.uomConversions);
  });

  it('throws when no current snapshot exists', async () => {
    const reader = new StagingReadAdapter(staging, TENANT);
    await expect(reader.fetchRawData()).rejects.toThrow(/no current snapshot/);
  });

  it('returns empty arrays for entities missing on disk', async () => {
    // Promote a snapshot that only wrote a subset (orchestrator always writes all,
    // but this verifies StagingReadAdapter's tolerance if a snapshot is hand-crafted).
    const handle = staging.createSnapshot(TENANT);
    await staging.writeRaw(handle, 'tasks', [{ TaskCode: 'T1' }]);
    await staging.promote(handle);

    const reader = new StagingReadAdapter(staging, TENANT);
    const result = await reader.fetchRawData();
    expect(result.tasks).toEqual([{ TaskCode: 'T1' }]);
    expect(result.resources).toEqual([]);
    expect(result.orders).toEqual([]);
    expect(result.uomConversions).toBeNull();
  });
});
