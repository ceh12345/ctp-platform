import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StagingService } from '../staging.service';
import { ValidationReport } from '../validation/validation-types';

function makeService(rootDir: string): StagingService {
  return new StagingService(rootDir);
}

const TENANT = 'acme';

describe('StagingService', () => {
  let rootDir: string;
  let service: StagingService;

  beforeEach(async () => {
    rootDir = path.join(os.tmpdir(), `staging-svc-${crypto.randomUUID()}`);
    await fs.promises.mkdir(rootDir, { recursive: true });
    service = makeService(rootDir);
  });

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  describe('createSnapshot', () => {
    it('returns a handle with expected paths', () => {
      const handle = service.createSnapshot(TENANT, new Date(2026, 4, 23, 14, 30));
      expect(handle.tenant).toBe(TENANT);
      expect(handle.ts).toBe('2026-05-23-1430');
      expect(handle.tmpDir).toContain(`${TENANT}${path.sep}2026-05-23-1430.tmp`);
      expect(handle.rawDir.endsWith(path.join('2026-05-23-1430.tmp', 'raw'))).toBe(true);
      expect(handle.cleansedDir.endsWith(path.join('2026-05-23-1430.tmp', 'cleansed'))).toBe(true);
    });
  });

  describe('writeRaw', () => {
    it('writes JSON content to {rawDir}/{entity}.json', async () => {
      const handle = service.createSnapshot(TENANT);
      await service.writeRaw(handle, 'orders', [{ OrderCode: 'O1' }]);
      const file = path.join(handle.rawDir, 'orders.json');
      const text = await fs.promises.readFile(file, 'utf8');
      expect(JSON.parse(text)).toEqual([{ OrderCode: 'O1' }]);
    });
  });

  describe('promote', () => {
    it('renames tmp dir to final and flips pointer', async () => {
      const handle = service.createSnapshot(TENANT);
      await service.writeRaw(handle, 'orders', [{ OrderCode: 'O1' }]);
      await service.promote(handle);

      const final = path.join(rootDir, TENANT, handle.ts);
      const finalStat = await fs.promises.lstat(final);
      expect(finalStat.isDirectory()).toBe(true);

      const tmpExists = await fs.promises
        .access(handle.tmpDir)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(false);

      const resolved = await service.current(TENANT);
      expect(resolved).not.toBeNull();
      expect(await fs.promises.realpath(resolved!)).toBe(await fs.promises.realpath(final));
    });

    it('metadata and report written into tmp survive promotion', async () => {
      const handle = service.createSnapshot(TENANT);
      await service.writeMetadata(handle, {
        capturedAt: '2026-05-23T14:30:00Z',
        adapterType: 'rest',
        recordCounts: { orders: 1 },
      });
      const report: ValidationReport = {
        ranAt: '2026-05-23T14:30:05Z',
        rules: [],
        passed: true,
        failedRules: [],
        warningRules: [],
      };
      await service.writeReport(handle, report);
      await service.promote(handle);

      const final = path.join(rootDir, TENANT, handle.ts);
      const meta = JSON.parse(await fs.promises.readFile(path.join(final, '_metadata.json'), 'utf8'));
      expect(meta.adapterType).toBe('rest');
      const rep = JSON.parse(
        await fs.promises.readFile(path.join(final, '_validation-report.json'), 'utf8'),
      );
      expect(rep.passed).toBe(true);
    });
  });

  describe('markFailed', () => {
    it('renames tmp to .failed and does not touch pointer', async () => {
      const handle = service.createSnapshot(TENANT);
      await service.writeRaw(handle, 'orders', []);
      await service.markFailed(handle);

      const failed = path.join(rootDir, TENANT, `${handle.ts}.failed`);
      const stat = await fs.promises.lstat(failed);
      expect(stat.isDirectory()).toBe(true);

      const resolved = await service.current(TENANT);
      expect(resolved).toBeNull();
    });
  });

  describe('listSnapshots', () => {
    it('returns promoted snapshots only, sorted descending, with current flagged', async () => {
      const older = service.createSnapshot(TENANT, new Date(2026, 4, 22, 10, 0));
      await service.writeRaw(older, 'orders', []);
      await service.promote(older);

      const newer = service.createSnapshot(TENANT, new Date(2026, 4, 23, 14, 30));
      await service.writeRaw(newer, 'orders', []);
      await service.promote(newer);

      const tmpOnly = service.createSnapshot(TENANT, new Date(2026, 4, 23, 15, 0));
      await service.writeRaw(tmpOnly, 'orders', []);
      // not promoted — should be excluded

      const failed = service.createSnapshot(TENANT, new Date(2026, 4, 23, 16, 0));
      await service.writeRaw(failed, 'orders', []);
      await service.markFailed(failed);

      const list = await service.listSnapshots(TENANT);
      expect(list.map((s) => s.ts)).toEqual(['2026-05-23-1430', '2026-05-22-1000']);
      expect(list[0].isCurrent).toBe(true);
      expect(list[1].isCurrent).toBe(false);
    });

    it('returns empty array when tenant dir does not exist', async () => {
      expect(await service.listSnapshots('nope')).toEqual([]);
    });
  });

  describe('pruneOld', () => {
    it('deletes snapshots older than retention but skips current target', async () => {
      const now = new Date(2026, 4, 23, 12, 0);
      const olderThanRetention = new Date(2026, 3, 1, 12, 0); // 52 days ago
      const recent = new Date(2026, 4, 20, 12, 0); // 3 days ago

      const old = service.createSnapshot(TENANT, olderThanRetention);
      await service.writeRaw(old, 'orders', []);
      await service.promote(old);

      const r = service.createSnapshot(TENANT, recent);
      await service.writeRaw(r, 'orders', []);
      await service.promote(r);

      // Current points at `recent` (most recent promote wins).
      const result = await service.pruneOld(TENANT, 30, now);
      expect(result.deleted).toContain(old.ts);
      expect(result.skipped.map((s) => s.ts)).toEqual([r.ts]);
      expect(result.skipped[0].reason).toBe('within-retention');
    });

    it('never deletes the snapshot current points at, even when older than retention', async () => {
      const ancient = new Date(2026, 0, 1, 12, 0);
      const handle = service.createSnapshot(TENANT, ancient);
      await service.writeRaw(handle, 'orders', []);
      await service.promote(handle);

      const result = await service.pruneOld(TENANT, 30, new Date(2026, 4, 23));
      expect(result.deleted).toEqual([]);
      expect(result.skipped).toEqual([{ ts: handle.ts, reason: 'current' }]);
    });
  });

  describe('cleanupOrphans', () => {
    it('removes *.tmp/ and *.new/ but leaves *.failed/ and promoted dirs alone', async () => {
      const tenantDir = path.join(rootDir, TENANT);
      await fs.promises.mkdir(path.join(tenantDir, '2026-05-22-1000'), { recursive: true });
      await fs.promises.mkdir(path.join(tenantDir, '2026-05-23-1100.tmp'), { recursive: true });
      await fs.promises.mkdir(path.join(tenantDir, 'current.new'), { recursive: true });
      await fs.promises.mkdir(path.join(tenantDir, '2026-05-23-1200.failed'), { recursive: true });

      await service.cleanupOrphans(TENANT);

      const remaining = await fs.promises.readdir(tenantDir);
      expect(remaining.sort()).toEqual(['2026-05-22-1000', '2026-05-23-1200.failed']);
    });

    it('is a no-op when tenant dir does not exist', async () => {
      await service.cleanupOrphans('nope');
    });
  });
});
