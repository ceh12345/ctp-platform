import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StagingService } from '../../modules/integration/staging/staging.service';
import { cmdInspect, cmdList, cmdPromote, cmdRollback, parseArgs } from '../staging';

const TENANT = 'acme';

describe('staging CLI — parseArgs', () => {
  it('returns null for missing args', () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['list'])).toBeNull();
  });

  it('parses list', () => {
    const r = parseArgs(['list', 'acme']);
    expect(r).toEqual({ command: 'list', tenant: 'acme', positional: [], flags: {} });
  });

  it('parses promote with --yes flag', () => {
    const r = parseArgs(['promote', 'acme', '2026-05-22-1000', '--yes']);
    expect(r).toEqual({
      command: 'promote',
      tenant: 'acme',
      positional: ['2026-05-22-1000'],
      flags: { yes: true },
    });
  });

  it('rejects unknown commands', () => {
    expect(parseArgs(['delete', 'acme'])).toBeNull();
  });
});

describe('staging CLI — command handlers', () => {
  let rootDir: string;
  let staging: StagingService;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `cli-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    staging = new StagingService(rootDir);
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((m: string) => {
      logs.push(m);
    });
    vi.spyOn(console, 'error').mockImplementation((m: string) => {
      errors.push(m);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  async function seedSnapshot(date: Date, andPromote = true): Promise<string> {
    const handle = staging.createSnapshot(TENANT, date);
    await staging.writeRaw(handle, 'tasks', [{ TaskCode: 'T1', WorkOrderCode: 'WO1' }]);
    await staging.writeMetadata(handle, {
      capturedAt: date.toISOString(),
      adapterType: 'fake',
      recordCounts: { tasks: 1 },
    });
    await staging.writeReport(handle, {
      ranAt: date.toISOString(),
      rules: [],
      passed: true,
      failedRules: [],
      warningRules: [],
    });
    if (andPromote) await staging.promote(handle);
    return handle.ts;
  }

  describe('cmdList', () => {
    it('reports empty when no snapshots', async () => {
      const code = await cmdList(staging, TENANT);
      expect(code).toBe(0);
      expect(logs.some((l) => l.includes('no snapshots'))).toBe(true);
    });

    it('lists snapshots with current marker', async () => {
      const older = await seedSnapshot(new Date(2026, 4, 22, 10, 0));
      const newer = await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      const code = await cmdList(staging, TENANT);
      expect(code).toBe(0);
      const all = logs.join('\n');
      expect(all).toContain(older);
      expect(all).toContain(newer);
      expect(all).toMatch(/\* 2026-05-23-1430/);
    });
  });

  describe('cmdInspect', () => {
    it('prints validation report content', async () => {
      const ts = await seedSnapshot(new Date(2026, 4, 22, 10, 0));
      const code = await cmdInspect(staging, TENANT, ts);
      expect(code).toBe(0);
      expect(logs.join('\n')).toContain('"passed": true');
    });

    it('returns 1 for unknown ts', async () => {
      const code = await cmdInspect(staging, TENANT, '1999-01-01-0000');
      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('not found');
    });
  });

  describe('cmdPromote', () => {
    it('--yes promotes a snapshot to current', async () => {
      const older = await seedSnapshot(new Date(2026, 4, 22, 10, 0));
      await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      // Newer is current. Promote older.
      const code = await cmdPromote(staging, TENANT, older, true);
      expect(code).toBe(0);
      const current = await staging.current(TENANT);
      expect(current).toContain(older);
    });

    it('no-op when target is already current', async () => {
      const ts = await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      const code = await cmdPromote(staging, TENANT, ts, true);
      expect(code).toBe(0);
      expect(logs.join('\n')).toContain('already current');
    });

    it('aborts when confirmation declined', async () => {
      const older = await seedSnapshot(new Date(2026, 4, 22, 10, 0));
      await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      const code = await cmdPromote(staging, TENANT, older, false, async () => false);
      expect(code).toBe(1);
      expect(logs.join('\n')).toContain('aborted');
    });

    it('returns 1 for unknown ts', async () => {
      const code = await cmdPromote(staging, TENANT, '1999-01-01-0000', true);
      expect(code).toBe(1);
    });
  });

  describe('cmdRollback', () => {
    it('rolls back to prior snapshot when at newest', async () => {
      const older = await seedSnapshot(new Date(2026, 4, 22, 10, 0));
      const newer = await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      const code = await cmdRollback(staging, TENANT, true);
      expect(code).toBe(0);
      const current = await staging.current(TENANT);
      expect(current).toContain(older);
      expect(current).not.toContain(newer);
    });

    it('fails when only one snapshot exists', async () => {
      await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      const code = await cmdRollback(staging, TENANT, true);
      expect(code).toBe(1);
      expect(errors.join('\n')).toMatch(/at least 2/);
    });

    it('fails when current is the oldest', async () => {
      const oldest = await seedSnapshot(new Date(2026, 4, 22, 10, 0));
      await seedSnapshot(new Date(2026, 4, 23, 14, 30));
      // Move current to the oldest.
      await staging.repointAt(TENANT, path.join(rootDir, TENANT, oldest));
      const code = await cmdRollback(staging, TENANT, true);
      expect(code).toBe(1);
    });
  });
});
