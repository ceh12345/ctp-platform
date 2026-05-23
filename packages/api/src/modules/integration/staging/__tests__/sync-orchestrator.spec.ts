import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IDataAdapter, IRawDataPayload } from '../../adapter.interface';
import { StagingService } from '../staging.service';
import { SyncOrchestrator } from '../sync-orchestrator';

const TENANT = 'acme';

function emptyPayload(): IRawDataPayload {
  return {
    resources: [],
    tasks: [],
    calendars: [],
    stateChanges: [],
    products: [],
    orders: [],
    materials: [],
    processes: [],
    cadences: [],
    uomConversions: null,
  };
}

class FakeAdapter implements IDataAdapter {
  readonly adapterType = 'fake';
  constructor(private readonly payload: IRawDataPayload) {}
  async fetchRawData(): Promise<IRawDataPayload> {
    return this.payload;
  }
}

describe('SyncOrchestrator', () => {
  let rootDir: string;
  let staging: StagingService;
  let orch: SyncOrchestrator;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `sync-orch-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    staging = new StagingService(rootDir);
    orch = new SyncOrchestrator(staging);
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it('happy path: writes raw, metadata, report; promotes; current resolves', async () => {
    const payload = emptyPayload();
    payload.tasks = [{ WorkOrderCode: 'WO1', OperationCode: 'OP1', JobCode: 'J1' }];
    payload.orders = [{ JobCode: 'J1' }];
    payload.resources = [{ Code: 'R1' }];

    const result = await orch.runSync(TENANT, new FakeAdapter(payload));

    expect(result.ok).toBe(true);
    expect(result.snapshotPath).not.toBeNull();
    expect(result.report.passed).toBe(true);

    const current = await staging.current(TENANT);
    expect(current).not.toBeNull();

    const tasksOnDisk = JSON.parse(
      await fs.promises.readFile(path.join(current!, 'raw', 'tasks.json'), 'utf8'),
    );
    expect(tasksOnDisk).toEqual(payload.tasks);

    const meta = JSON.parse(await fs.promises.readFile(path.join(current!, '_metadata.json'), 'utf8'));
    expect(meta.adapterType).toBe('fake');
    expect(meta.recordCounts.tasks).toBe(1);

    const report = JSON.parse(
      await fs.promises.readFile(path.join(current!, '_validation-report.json'), 'utf8'),
    );
    expect(report.passed).toBe(true);
  });

  it('failure path: validation fails, snapshot marked .failed, current untouched', async () => {
    // First sync: clean snapshot to establish "previous".
    const good = emptyPayload();
    good.tasks = [{ WorkOrderCode: 'WO1', OperationCode: 'OP1', JobCode: 'J1' }];
    good.orders = [{ JobCode: 'J1' }];
    good.resources = [{ Code: 'R1' }];
    await orch.runSync(TENANT, new FakeAdapter(good));
    const firstCurrent = await staging.current(TENANT);

    // Second sync: bad data — task missing OperationCode (required-fields fails).
    const bad = emptyPayload();
    bad.tasks = [{ WorkOrderCode: 'WO1', JobCode: 'J1' }]; // missing OperationCode
    bad.orders = [{ JobCode: 'J1' }];
    bad.resources = [{ Code: 'R1' }];

    const result = await orch.runSync(TENANT, new FakeAdapter(bad));

    expect(result.ok).toBe(false);
    expect(result.snapshotPath).toBeNull();
    expect(result.report.failedRules).toContain('required-fields');

    // Current pointer untouched.
    expect(await staging.current(TENANT)).toBe(firstCurrent);

    // .failed/ directory exists with the report inside.
    const tenantRoot = path.join(rootDir, TENANT);
    const entries = await fs.promises.readdir(tenantRoot);
    const failedDirs = entries.filter((e) => e.endsWith('.failed'));
    expect(failedDirs.length).toBe(1);

    const failedReport = JSON.parse(
      await fs.promises.readFile(
        path.join(tenantRoot, failedDirs[0], '_validation-report.json'),
        'utf8',
      ),
    );
    expect(failedReport.passed).toBe(false);
  });

  it('records uomConversions when present', async () => {
    const payload = emptyPayload();
    payload.tasks = [{ WorkOrderCode: 'WO1', OperationCode: 'OP1', JobCode: 'J1' }];
    payload.orders = [{ JobCode: 'J1' }];
    payload.resources = [{ Code: 'R1' }];
    payload.uomConversions = { globalConversions: [{ from: 'HR', to: 's', factor: 3600 }] };

    const result = await orch.runSync(TENANT, new FakeAdapter(payload));
    expect(result.ok).toBe(true);

    const current = await staging.current(TENANT);
    const onDisk = JSON.parse(
      await fs.promises.readFile(path.join(current!, 'raw', 'uomConversions.json'), 'utf8'),
    );
    // Orchestrator wraps single value as 1-element array; reader unwraps.
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk[0]).toEqual(payload.uomConversions);
  });
});
