import { Injectable } from '@nestjs/common';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  SchedulingLandscape,
  serializeOverlay,
  reconstructOverlay,
  OverlayDoc,
  CTPTask,
  CTPTaskStateConstants,
  CTPAssignment,
  CTPAssignmentConstants,
} from '@ctp/engine';
import { ConfigService } from '../../config/config.service';
import { SnapshotStore, SnapshotMeta } from './snapshot-store';

/** Outcome of a version-pinned reconstruction attempt. */
export interface ReconstructResult {
  /** Overlay applied onto base → landscape rebuilt exactly. */
  applied: boolean;
  /** Overlay exists but its base version ≠ current base → stale; NOT applied. */
  staleFlag: boolean;
  /** No snapshot to reconstruct from (never solved). */
  coldStart: boolean;
  snapshotId?: string;
}

/**
 * SnapshotService — promotes a durable snapshot of the in-memory landscape after
 * every schedule-state mutation, and serves snapshot reads (P4; read endpoints
 * land in P7). One SnapshotStore per (dataRoot, tenant), cached.
 *
 * Data root resolves from `CTP_DATA_ROOT` (a mounted volume in deploy), falling
 * back to a gitignored local `.ctp-data/` for dev. Read fresh each call so tests
 * can repoint it via the env var.
 */
@Injectable()
export class SnapshotService {
  private readonly stores = new Map<string, SnapshotStore>();

  private readonly baseVersions = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  private dataRoot(): string {
    return process.env.CTP_DATA_ROOT ?? path.resolve('.ctp-data');
  }

  /**
   * A content version of the tenant's BASE inputs (tasks/resources/calendars/
   * orders). Changes only when source data changes (a re-pull), so an overlay
   * written against version V is valid to reconstruct only against base V — this
   * is the input to the reconciliation guard (§4). Cached per tenant; cleared by
   * clearBaseVersion() on a source re-sync. Deferred-population: a stable hash
   * now, the Genius feed's own version token later.
   */
  baseVersion(tenantId?: string): string {
    const tid = tenantId ?? this.configService.getTenantId();
    let v = this.baseVersions.get(tid);
    if (!v) {
      const inputs = {
        tasks: this.configService.getTasks(),
        resources: this.configService.getResources(),
        calendars: this.configService.getCalendars(),
        orders: this.configService.getOrders(),
      };
      v = crypto.createHash('sha1').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
      this.baseVersions.set(tid, v);
    }
    return v;
  }

  /** Invalidate the cached base version after a source re-sync. */
  clearBaseVersion(tenantId?: string): void {
    this.baseVersions.delete(tenantId ?? this.configService.getTenantId());
  }

  private storeFor(tenantId: string): SnapshotStore {
    const root = this.dataRoot();
    const key = `${root}::${tenantId}`;
    let store = this.stores.get(key);
    if (!store) {
      store = new SnapshotStore(root, tenantId);
      this.stores.set(key, store);
    }
    return store;
  }

  /**
   * Serialize the landscape's overlay and promote it as a new snapshot.
   * `eventType`: 'solve' | 'seed' (full recompute — earns a history row) or
   * 'mutation' (schedule/unschedule/pin/window/priority — no history row).
   * Returns the new snapshotId.
   */
  promote(landscape: SchedulingLandscape, eventType: 'solve' | 'seed' | 'mutation'): string {
    const overlay = serializeOverlay(landscape);
    const tenantId = this.configService.getTenantId();
    const meta: SnapshotMeta = {
      snapshotId: '',
      timestamp: new Date().toISOString(),
      eventType,
      sourceDataVersion: this.baseVersion(tenantId), // the base this overlay was written against
      staleFlag: false,
    };
    return this.storeFor(tenantId).promote({ meta, overlay });
  }

  /**
   * Rebuild a freshly-hydrated `base` landscape's scheduled state from `current`,
   * WITHOUT solving — the reconstruct-on-load path. Version-pinned (§4):
   *   - no snapshot         → coldStart (leave base unsolved)
   *   - version mismatch    → staleFlag, NOT applied (don't overlay stale state)
   *   - version match       → reconstructOverlay + consumption replay → applied
   * Mutates `base` in place when applied.
   */
  reconstruct(base: SchedulingLandscape, tenantId?: string): ReconstructResult {
    const tid = tenantId ?? this.configService.getTenantId();
    const store = this.storeFor(tid);
    const id = store.resolveCurrent();
    if (!id) return { applied: false, staleFlag: false, coldStart: true };

    const meta = store.readPartition<SnapshotMeta>('meta', id);
    const overlay = store.readPartition<OverlayDoc>('overlay', id);
    if (!meta || !overlay) return { applied: false, staleFlag: false, coldStart: true };

    // Reconciliation guard: overlay-overwrites-base is valid only within a version.
    if (meta.sourceDataVersion && meta.sourceDataVersion !== this.baseVersion(tid)) {
      return { applied: false, staleFlag: true, coldStart: false, snapshotId: id };
    }

    reconstructOverlay(base, overlay);
    SnapshotService.replayConsumption(base);
    return { applied: true, staleFlag: false, coldStart: false, snapshotId: id };
  }

  /**
   * Re-derive resource consumption from the applied placements (DERIVED bucket —
   * not persisted). For each scheduled task, re-book its interval on each assigned
   * resource, then recompute availability. Mirrors the engine's commit-time
   * addTaskToResource for capacity slots.
   */
  private static replayConsumption(landscape: SchedulingLandscape): void {
    if (!landscape.tasks || !landscape.resources) return;

    landscape.tasks.forEach((task: CTPTask) => {
      if (task.state !== CTPTaskStateConstants.SCHEDULED || !task.scheduled) return;
      const slots = task.capacityResources;
      if (!slots) return;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots.at(i);
        if (!slot?.scheduledResource) continue;
        const res = landscape.resources.getEntity(slot.scheduledResource);
        if (!res || !res.assignments) continue;
        const a = new CTPAssignment(task.scheduled.startW, task.scheduled.endW, slot.qty ?? 1);
        a.name = task.key;
        a.type = CTPAssignmentConstants.PROCESS;
        res.assignments.add(a);
        res.recompute = true;
      }
    });

    // Recompute availability for any resource whose assignments changed — task
    // bookings above OR downtime replayed by reconstructOverlay (both set recompute).
    landscape.resources.forEach((res) => {
      if (res.recompute && res.original) {
        res.available.setLists(res.original, res.assignments);
        res.recompute = false;
      }
    });
  }

  resolveCurrent(tenantId?: string): string | null {
    return this.storeFor(tenantId ?? this.configService.getTenantId()).resolveCurrent();
  }

  readPartition<T = unknown>(name: string, id?: string, tenantId?: string): T | null {
    return this.storeFor(tenantId ?? this.configService.getTenantId()).readPartition<T>(name, id);
  }
}
