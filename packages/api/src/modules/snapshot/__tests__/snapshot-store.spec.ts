import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotStore, SnapshotPartitions } from '../snapshot-store';

const TENANT = 'test-tenant';

function partitions(eventType: string, overlayMarker: string): SnapshotPartitions {
  return {
    meta: { snapshotId: '', timestamp: '2026-06-27T00:00:00.000Z', eventType },
    overlay: { version: 1, rows: [{ taskKey: overlayMarker }] },
  };
}

describe('SnapshotStore (P3)', () => {
  let root: string;
  let store: SnapshotStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-snap-'));
    // heavyKeep=2, lightKeepSolves=3, days off
    store = new SnapshotStore(root, TENANT, { heavyKeep: 2, lightKeepSolves: 3, lightKeepDays: 0 });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('promotes a snapshot: current points to it and partitions are readable', () => {
    const id = store.promote(partitions('solve', 'A'), { snapshotId: '20260627T000001Z' });
    expect(id).toBe('20260627T000001Z');
    expect(store.resolveCurrent()).toBe(id);
    expect(store.readPartition('overlay')).toEqual({ version: 1, rows: [{ taskKey: 'A' }] });
    // store stamps meta.snapshotId
    expect(store.readPartition<any>('meta')!.snapshotId).toBe(id);
  });

  it('advances current on the next promote; no .tmp staging dir is left behind', () => {
    store.promote(partitions('solve', 'A'), { snapshotId: '20260627T000001Z' });
    store.promote(partitions('solve', 'B'), { snapshotId: '20260627T000002Z' });

    expect(store.resolveCurrent()).toBe('20260627T000002Z');
    expect(store.readPartition('overlay')).toEqual({ version: 1, rows: [{ taskKey: 'B' }] });

    const entries = fs.readdirSync(path.join(root, 'tenants', TENANT, 'snapshots'));
    expect(entries.some(e => e.endsWith('.tmp'))).toBe(false);
    expect(store.listSnapshots()).toEqual(['20260627T000002Z', '20260627T000001Z']);
  });

  it('no torn read: current always resolves a fully-sealed, self-consistent snapshot', () => {
    // The new dir is sealed (rename) BEFORE the pointer is swapped, so whatever
    // current points to has all its partitions. Assert overlay matches the meta's id.
    store.promote(partitions('solve', 'A'), { snapshotId: '20260627T000001Z' });
    store.promote(partitions('solve', 'B'), { snapshotId: '20260627T000002Z' });
    const cur = store.resolveCurrent()!;
    const meta = store.readPartition<any>('meta', cur)!;
    const overlay = store.readPartition<any>('overlay', cur)!;
    expect(meta.snapshotId).toBe(cur);
    expect(overlay.rows[0].taskKey).toBe('B'); // matches the same snapshot, not a mix
  });

  it('survives a "restart": a fresh store instance resolves the latest snapshot', () => {
    store.promote(partitions('solve', 'A'), { snapshotId: '20260627T000001Z' });
    store.promote(partitions('solve', 'B'), { snapshotId: '20260627T000002Z' });

    const restarted = new SnapshotStore(root, TENANT);
    expect(restarted.resolveCurrent()).toBe('20260627T000002Z');
    expect(restarted.readPartition('overlay')).toEqual({ version: 1, rows: [{ taskKey: 'B' }] });
  });

  it('bounded retention: heavy kept for current+prior; light kept for last N solves; older pruned', () => {
    for (let i = 1; i <= 6; i++) {
      store.promote(partitions('solve', `o${i}`), { snapshotId: `20260627T00000${i}Z` });
    }
    // heavyKeep=2 → overlay only on the two newest
    expect(store.readPartition('overlay', '20260627T000006Z')).not.toBeNull();
    expect(store.readPartition('overlay', '20260627T000005Z')).not.toBeNull();
    expect(store.readPartition('overlay', '20260627T000004Z')).toBeNull(); // heavy pruned

    // lightKeepSolves=3 beyond heavyKeep → meta on s6,s5 (kept-all) + s4,s3,s2; s1 deleted whole
    expect(store.readPartition('meta', '20260627T000002Z')).not.toBeNull();
    expect(store.readPartition('meta', '20260627T000001Z')).toBeNull();
    expect(store.listSnapshots()).toEqual([
      '20260627T000006Z', '20260627T000005Z', '20260627T000004Z',
      '20260627T000003Z', '20260627T000002Z',
    ]);
  });

  it('mutation snapshots earn no history row: deleted whole once beyond heavyKeep', () => {
    store.promote(partitions('mutation', 'm1'), { snapshotId: '20260627T000001Z' });
    store.promote(partitions('solve', 's2'), { snapshotId: '20260627T000002Z' });
    store.promote(partitions('solve', 's3'), { snapshotId: '20260627T000003Z' });
    store.promote(partitions('solve', 's4'), { snapshotId: '20260627T000004Z' });

    // s1 (mutation) is now 4th-newest, beyond heavyKeep=2 → deleted whole, no meta
    expect(store.readPartition('meta', '20260627T000001Z')).toBeNull();
    expect(store.listSnapshots()).not.toContain('20260627T000001Z');
    // a solve at the same depth keeps its meta
    expect(store.readPartition('meta', '20260627T000002Z')).not.toBeNull();
  });

  it('resolveCurrent returns null before anything is promoted', () => {
    expect(store.resolveCurrent()).toBeNull();
    expect(store.readPartition('overlay')).toBeNull();
    expect(store.listSnapshots()).toEqual([]);
  });
});
