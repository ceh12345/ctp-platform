import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IDataAdapter, IRawDataPayload } from '../../adapter.interface';
import { appendHistoryEvent, historyPath, readHistory } from '../staging-history';
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
  constructor(private readonly data: IRawDataPayload) {}
  async fetchRawData() {
    return this.data;
  }
}

class ErrorAdapter implements IDataAdapter {
  readonly adapterType = 'erroring';
  async fetchRawData(): Promise<IRawDataPayload> {
    throw new Error('simulated adapter failure');
  }
}

describe('staging-history JSONL log', () => {
  let rootDir: string;
  let staging: StagingService;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `history-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    staging = new StagingService(rootDir);
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  describe('appendHistoryEvent + readHistory', () => {
    it('writes one JSON object per line', async () => {
      await appendHistoryEvent(rootDir, TENANT, {
        event: 'sync-started',
        adapterType: 'fake',
        ts: '2026-05-23-1430',
      });
      await appendHistoryEvent(rootDir, TENANT, {
        event: 'sync-promoted',
        ts: '2026-05-23-1430',
        recordCounts: { tasks: 1 },
      });

      const text = await fs.promises.readFile(historyPath(rootDir, TENANT), 'utf8');
      const lines = text.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).event).toBe('sync-started');
      expect(JSON.parse(lines[1]).event).toBe('sync-promoted');
    });

    it('readHistory returns parsed events in order', async () => {
      await appendHistoryEvent(rootDir, TENANT, {
        event: 'sync-started',
        adapterType: 'fake',
        ts: '2026-05-23-1430',
      });
      await appendHistoryEvent(rootDir, TENANT, {
        event: 'orphan-cleanup',
        removed: ['2026-05-22-1100.tmp'],
      });

      const events = await readHistory(rootDir, TENANT);
      expect(events.length).toBe(2);
      expect(events[0].event).toBe('sync-started');
      expect(events[1].event).toBe('orphan-cleanup');
      expect(events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('readHistory on missing file returns []', async () => {
      expect(await readHistory(rootDir, 'never-existed')).toEqual([]);
    });

    it('creates the tenant dir if absent', async () => {
      await appendHistoryEvent(rootDir, 'new-tenant', {
        event: 'sync-started',
        adapterType: 'fake',
        ts: 'X',
      });
      const events = await readHistory(rootDir, 'new-tenant');
      expect(events.length).toBe(1);
    });
  });

  describe('orchestrator integration', () => {
    it('happy path: sync-started → sync-promoted', async () => {
      const orch = new SyncOrchestrator(staging);
      await orch.runSync(TENANT, new FakeAdapter(payload()));
      const events = await staging.readHistory(TENANT);
      const types = events.map((e) => e.event);
      expect(types).toEqual(['sync-started', 'sync-promoted']);
    });

    it('validation failure: sync-started → sync-marked-failed', async () => {
      const orch = new SyncOrchestrator(staging);
      // Establish a previous snapshot so subsequent comparison can fail meaningfully.
      await orch.runSync(TENANT, new FakeAdapter(payload()));

      const bad = payload();
      bad.tasks = [{ WorkOrderCode: 'WO1', JobCode: 'J1' }]; // missing OperationCode
      const result = await orch.runSync(TENANT, new FakeAdapter(bad));
      expect(result.ok).toBe(false);

      const events = await staging.readHistory(TENANT);
      const types = events.map((e) => e.event);
      expect(types).toEqual(['sync-started', 'sync-promoted', 'sync-started', 'sync-marked-failed']);
      const failed = events[3] as { failedRules: string[] };
      expect(failed.failedRules).toContain('required-fields');
    });

    it('exception path: sync-started → sync-errored', async () => {
      const orch = new SyncOrchestrator(staging);
      await expect(orch.runSync(TENANT, new ErrorAdapter())).rejects.toThrow(/simulated/);

      const events = await staging.readHistory(TENANT);
      const types = events.map((e) => e.event);
      expect(types).toEqual(['sync-started', 'sync-errored']);
      const errored = events[1] as { phase: string; error: string };
      expect(errored.phase).toBe('fetch');
      expect(errored.error).toMatch(/simulated/);
    });
  });

  describe('survives orphan cleanup', () => {
    it('history file is preserved when *.tmp/ dirs are cleaned', async () => {
      const orch = new SyncOrchestrator(staging);
      await orch.runSync(TENANT, new FakeAdapter(payload()));

      // Create a stray .tmp/ dir manually and run cleanup.
      const tenantDir = path.join(rootDir, TENANT);
      await fs.promises.mkdir(path.join(tenantDir, '2026-05-23-1530.tmp'), { recursive: true });
      await staging.cleanupOrphans(TENANT);

      const events = await staging.readHistory(TENANT);
      expect(events.length).toBeGreaterThan(0);
      expect(events.find((e) => e.event === 'orphan-cleanup')).toBeDefined();
    });
  });
});
