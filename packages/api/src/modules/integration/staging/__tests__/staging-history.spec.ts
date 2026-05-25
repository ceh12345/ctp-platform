import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendHistoryEvent, historyPath, readHistory } from '../staging-history';
import { StagingService } from '../staging.service';

const TENANT = 'acme';

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

  it('cleanupOrphans emits orphan-cleanup event', async () => {
    const tenantDir = path.join(rootDir, TENANT);
    await fs.promises.mkdir(path.join(tenantDir, '2026-05-23-1530.tmp'), { recursive: true });
    await staging.cleanupOrphans(TENANT);

    const events = await staging.readHistory(TENANT);
    expect(events.find((e) => e.event === 'orphan-cleanup')).toBeDefined();
  });
});
