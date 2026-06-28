import * as fs from 'fs';
import * as path from 'path';

/**
 * SnapshotStore — persistence + atomic promotion + bounded retention for the
 * scheduling snapshot (P3 of the Scheduling Snapshot sprint).
 *
 * On-disk layout (per tenant, under a mounted CTP_DATA_ROOT — outside the image):
 *   $root/tenants/<tenant>/snapshots/<snapshotId>/<partition>.json
 *   $root/tenants/<tenant>/snapshots/current        (pointer file → snapshotId)
 *
 * Atomic promotion: write the full partition set into <id>.tmp/, fsync, rename
 * to seal <id>/ (appears complete or not at all), then atomically swap the
 * `current` pointer (write current.tmp, rename over current). A read concurrent
 * with a promote resolves entirely to the old snapshot or entirely to the new
 * one — never a mix.
 *
 * Pointer mechanism: a POINTER FILE (not a POSIX symlink). Equally atomic
 * (rename), but portable across NTFS (Windows dev) and ext4 (Linux/Docker
 * prod) — symlink *creation* needs privileges on Windows and would break local
 * tests. Behaviour is identical on the deploy target.
 */

/** Partitions classified HEAVY are pruned aggressively (kept for current+prior only). */
const HEAVY_PARTITIONS = new Set(['overlay', 'detail', 'calendars', 'resources']);

const CURRENT = 'current';

export interface SnapshotMeta {
  snapshotId: string;
  timestamp: string;
  /** 'seed' | 'solve' | 'mutation' — drives light-partition history retention. */
  eventType: string;
  sourceDataVersion?: string | null;
  staleFlag?: boolean;
  parentSnapshotId?: string | null;
  [k: string]: unknown;
}

/** Map of partition name → JSON-serializable content. Must include `meta`. */
export interface SnapshotPartitions {
  meta: SnapshotMeta;
  [partition: string]: unknown;
}

export interface RetentionPolicy {
  /** Heavy partitions kept for this many newest snapshots (current + prior). */
  heavyKeep: number;
  /** Light partitions (meta/summary/…) kept for this many newest solve/seed snapshots. */
  lightKeepSolves: number;
  /** …or within this many days, whichever the deployment sets (0 = ignore). */
  lightKeepDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  heavyKeep: 2,
  lightKeepSolves: 50,
  lightKeepDays: 30,
};

export class SnapshotStore {
  private readonly snapshotsDir: string;

  constructor(
    private readonly dataRoot: string,
    private readonly tenantId: string,
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION,
    /** Injectable clock for deterministic ids in tests. */
    private readonly now: () => Date = () => new Date(),
  ) {
    this.snapshotsDir = path.join(path.resolve(dataRoot), 'tenants', tenantId, 'snapshots');
  }

  /** Stable, sortable UTC id: 20260627T175437Z (lexical order == chronological). */
  private generateId(): string {
    const iso = this.now().toISOString();          // 2026-06-27T17:54:37.123Z
    return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // 20260627T175437Z
  }

  private snapshotDir(id: string): string {
    return path.join(this.snapshotsDir, id);
  }

  private fsyncedWrite(filePath: string, data: string): void {
    const fd = fs.openSync(filePath, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Write a new snapshot and promote it to `current`. Returns the new snapshotId.
   * `opts.snapshotId` overrides id generation (tests / explicit naming).
   */
  promote(partitions: SnapshotPartitions, opts?: { snapshotId?: string }): string {
    fs.mkdirSync(this.snapshotsDir, { recursive: true });

    const id = opts?.snapshotId ?? this.generateId();
    const sealed = this.snapshotDir(id);
    const tmp = sealed + '.tmp';

    // 1. Stage into a temp dir on the same filesystem.
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const meta: SnapshotMeta = { ...partitions.meta, snapshotId: id };
    for (const [name, content] of Object.entries({ ...partitions, meta })) {
      if (content === undefined) continue;
      this.fsyncedWrite(path.join(tmp, `${name}.json`), JSON.stringify(content));
    }

    // 2. Seal: atomic rename. The id'd dir now appears complete or not at all.
    fs.rmSync(sealed, { recursive: true, force: true });
    fs.renameSync(tmp, sealed);

    // 3. Promote: atomically swap the `current` pointer.
    const pointer = path.join(this.snapshotsDir, CURRENT);
    const pointerTmp = pointer + '.tmp';
    this.fsyncedWrite(pointerTmp, id);
    fs.renameSync(pointerTmp, pointer);

    // 4. Prune.
    this.applyRetention();
    return id;
  }

  /** The current snapshotId, or null if none has been promoted. */
  resolveCurrent(): string | null {
    const pointer = path.join(this.snapshotsDir, CURRENT);
    try {
      const id = fs.readFileSync(pointer, 'utf-8').trim();
      return id.length > 0 && fs.existsSync(this.snapshotDir(id)) ? id : null;
    } catch {
      return null;
    }
  }

  /** Read a partition from a snapshot (defaults to `current`). Null if absent. */
  readPartition<T = unknown>(name: string, id?: string): T | null {
    const sid = id ?? this.resolveCurrent();
    if (!sid) return null;
    try {
      const raw = fs.readFileSync(path.join(this.snapshotDir(sid), `${name}.json`), 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** All sealed snapshot ids, newest first. Excludes any `*.tmp` staging dirs. */
  listSnapshots(): string[] {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    return fs
      .readdirSync(this.snapshotsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.endsWith('.tmp'))
      .map(d => d.name)
      .sort()
      .reverse();
  }

  private readMetaSafe(id: string): SnapshotMeta | null {
    return this.readPartition<SnapshotMeta>('meta', id);
  }

  private deleteHeavyPartitions(id: string): void {
    const dir = this.snapshotDir(id);
    for (const name of HEAVY_PARTITIONS) {
      fs.rmSync(path.join(dir, `${name}.json`), { force: true });
    }
  }

  /**
   * Bounded retention. Heavy partitions kept for the newest `heavyKeep`
   * snapshots; light partitions kept for the newest `lightKeepSolves` solve/seed
   * snapshots (or within `lightKeepDays`). Mutation-only snapshots earn no
   * history row — beyond `heavyKeep` they are deleted whole.
   */
  private applyRetention(): void {
    const all = this.listSnapshots(); // newest first
    let solveSeen = 0;
    const cutoffMs =
      this.retention.lightKeepDays > 0
        ? this.now().getTime() - this.retention.lightKeepDays * 86_400_000
        : -Infinity;

    all.forEach((id, idx) => {
      if (idx < this.retention.heavyKeep) return; // newest N: keep everything

      this.deleteHeavyPartitions(id);

      const meta = this.readMetaSafe(id);
      const isSolve = !meta || meta.eventType === 'solve' || meta.eventType === 'seed';
      if (!isSolve) {
        // mutation snapshot beyond heavyKeep → no history; delete whole
        fs.rmSync(this.snapshotDir(id), { recursive: true, force: true });
        return;
      }

      solveSeen++;
      const tsMs = meta?.timestamp ? Date.parse(meta.timestamp) : NaN;
      const tooOld = Number.isFinite(tsMs) && tsMs < cutoffMs;
      if (solveSeen > this.retention.lightKeepSolves || tooOld) {
        fs.rmSync(this.snapshotDir(id), { recursive: true, force: true });
      }
    });
  }
}
