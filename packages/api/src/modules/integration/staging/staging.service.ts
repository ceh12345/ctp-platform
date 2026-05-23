import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  cleansedDir,
  failedDir,
  formatTimestamp,
  isFailedDirName,
  isPromotedSnapshotName,
  isTmpDirName,
  metadataPath,
  parseTimestamp,
  pointerPath,
  rawDir,
  reportPath,
  snapshotDir,
  tenantRoot,
  tmpDir,
} from './staging-paths';
import {
  PruneResult,
  SnapshotHandle,
  SnapshotInfo,
  SnapshotMetadata,
} from './staging-types';
import { createPointer } from './pointer/create-pointer';
import { IStagingPointer } from './pointer/staging-pointer.interface';
import { ValidationReport } from './validation/validation-types';

export const STAGING_ROOT_DIR = 'STAGING_ROOT_DIR';

@Injectable()
export class StagingService {
  constructor(@Inject(STAGING_ROOT_DIR) private readonly rootDir: string) {}

  createSnapshot(tenant: string, now: Date = new Date()): SnapshotHandle {
    const ts = formatTimestamp(now);
    const tmp = tmpDir(this.rootDir, tenant, ts);
    return {
      tenant,
      ts,
      tmpDir: tmp,
      rawDir: rawDir(tmp),
      cleansedDir: cleansedDir(tmp),
      metadataPath: metadataPath(tmp),
      reportPath: reportPath(tmp),
    };
  }

  async writeRaw(handle: SnapshotHandle, entity: string, data: unknown[]): Promise<void> {
    await fs.promises.mkdir(handle.rawDir, { recursive: true });
    const file = path.join(handle.rawDir, `${entity}.json`);
    await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  async writeMetadata(handle: SnapshotHandle, meta: SnapshotMetadata): Promise<void> {
    await fs.promises.mkdir(handle.tmpDir, { recursive: true });
    await fs.promises.writeFile(handle.metadataPath, JSON.stringify(meta, null, 2), 'utf8');
  }

  async writeReport(handle: SnapshotHandle, report: ValidationReport): Promise<void> {
    await fs.promises.mkdir(handle.tmpDir, { recursive: true });
    await fs.promises.writeFile(handle.reportPath, JSON.stringify(report, null, 2), 'utf8');
  }

  async promote(handle: SnapshotHandle): Promise<void> {
    const final = snapshotDir(this.rootDir, handle.tenant, handle.ts);
    await this.safeRename(handle.tmpDir, final);
    const pointer = this.pointerFor(handle.tenant);
    await pointer.point(final);
  }

  async markFailed(handle: SnapshotHandle): Promise<void> {
    const dest = failedDir(this.rootDir, handle.tenant, handle.ts);
    await this.safeRename(handle.tmpDir, dest);
  }

  async current(tenant: string): Promise<string | null> {
    return this.pointerFor(tenant).resolve();
  }

  async listSnapshots(tenant: string): Promise<SnapshotInfo[]> {
    const root = tenantRoot(this.rootDir, tenant);
    const currentPath = await this.current(tenant);

    let entries: string[];
    try {
      entries = await fs.promises.readdir(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const snapshots: SnapshotInfo[] = [];
    for (const name of entries) {
      if (!isPromotedSnapshotName(name)) continue;
      const fullPath = path.join(root, name);
      const stat = await fs.promises.lstat(fullPath);
      if (!stat.isDirectory()) continue;
      const metadata = await this.readMetadata(fullPath);
      snapshots.push({
        tenant,
        ts: name,
        fullPath,
        isCurrent: currentPath === fullPath,
        metadata,
      });
    }

    snapshots.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return snapshots;
  }

  async pruneOld(
    tenant: string,
    retentionDays: number,
    now: Date = new Date(),
  ): Promise<PruneResult> {
    const result: PruneResult = { deleted: [], skipped: [] };
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const snapshots = await this.listSnapshots(tenant);

    for (const snap of snapshots) {
      const parsed = parseTimestamp(snap.ts);
      if (parsed && parsed >= cutoff) {
        result.skipped.push({ ts: snap.ts, reason: 'within-retention' });
        continue;
      }
      const currentNow = await this.current(tenant);
      if (currentNow === snap.fullPath) {
        result.skipped.push({ ts: snap.ts, reason: 'current' });
        continue;
      }
      await this.safeRm(snap.fullPath);
      result.deleted.push(snap.ts);
    }

    return result;
  }

  async cleanupOrphans(tenant: string): Promise<void> {
    const root = tenantRoot(this.rootDir, tenant);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const name of entries) {
      if (!isTmpDirName(name)) continue;
      if (isFailedDirName(name)) continue;
      await this.safeRm(path.join(root, name));
    }
  }

  private pointerFor(tenant: string): IStagingPointer {
    return createPointer(pointerPath(this.rootDir, tenant));
  }

  private async readMetadata(snapshotPath: string): Promise<SnapshotMetadata | null> {
    try {
      const raw = await fs.promises.readFile(metadataPath(snapshotPath), 'utf8');
      return JSON.parse(raw) as SnapshotMetadata;
    } catch {
      return null;
    }
  }

  private async safeRm(target: string): Promise<void> {
    // Retry once on transient Windows lock failures (antivirus, Explorer handles).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fs.promises.rm(target, { recursive: true, force: true });
        return;
      } catch (err) {
        if (attempt === 1) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  private async safeRename(src: string, dest: string): Promise<void> {
    // Windows EPERM on rename can fire when a recently-closed file handle is
    // still draining (validation just read JSON from the dir we're renaming).
    // Retry with short backoff before giving up.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.promises.rename(src, dest);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt === 3 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }
}
