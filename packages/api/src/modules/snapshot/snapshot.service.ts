import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { SchedulingLandscape, serializeOverlay } from '@ctp/engine';
import { ConfigService } from '../../config/config.service';
import { SnapshotStore, SnapshotMeta } from './snapshot-store';

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

  constructor(private readonly configService: ConfigService) {}

  private dataRoot(): string {
    return process.env.CTP_DATA_ROOT ?? path.resolve('.ctp-data');
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
    const meta: SnapshotMeta = {
      snapshotId: '',
      timestamp: new Date().toISOString(),
      eventType,
      sourceDataVersion: null, // wired to input versioning in a later phase
      staleFlag: false,
    };
    return this.storeFor(this.configService.getTenantId()).promote({ meta, overlay });
  }

  resolveCurrent(tenantId?: string): string | null {
    return this.storeFor(tenantId ?? this.configService.getTenantId()).resolveCurrent();
  }

  readPartition<T = unknown>(name: string, id?: string, tenantId?: string): T | null {
    return this.storeFor(tenantId ?? this.configService.getTenantId()).readPartition<T>(name, id);
  }
}
