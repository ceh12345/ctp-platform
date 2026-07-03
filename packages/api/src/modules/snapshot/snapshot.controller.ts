import { Controller, Get, Query } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';
import { CTPService } from '../ctp/ctp.service';

/**
 * Read surface for the scheduling snapshot (P7). Purely additive GET routes —
 * they do not change any existing contract. Each resolves `?id` or `current`
 * and returns the partition wrapped with its resolved `snapshotId`, so a client
 * can pin a session to one snapshot. `snapshotId: null` signals cold-start
 * (nothing solved yet) rather than a 404, so the UI can render its empty state.
 *
 * Tenant is resolved per request by the tenant middleware (X-Tenant-Id), the
 * same as every other route.
 */
@Controller('snapshot')
export class SnapshotController {
  constructor(
    private readonly snapshotService: SnapshotService,
    private readonly ctpService: CTPService,
  ) {}

  /** Cheap probe: id + timestamp + staleness. UI reads this on landing. */
  @Get('meta')
  getMeta(@Query('id') id?: string) {
    return this.read('meta', id);
  }

  /** The KB-scale landing read (headline + bucketed utilization + alerts). */
  @Get('summary')
  getSummary(@Query('id') id?: string) {
    return this.read('summary', id);
  }

  /** The thin scheduled-state overlay (joined client-side to cached base). */
  @Get('overlay')
  getOverlay(@Query('id') id?: string) {
    return this.read('overlay', id);
  }

  /**
   * Full task detail (Option A — server-side projection). Returns the same shape
   * solve-and-sync did, projected READ-ONLY from the current/reconstructed
   * landscape — no solve. Lazy: the Schedule tab fetches this on entry, not on
   * landing. `snapshotId` is the current snapshot (the state being projected).
   */
  @Get('detail')
  async getDetail(@Query('detailLevel') detailLevel?: string) {
    const snapshotId = this.snapshotService.resolveCurrent();
    const data = await this.ctpService.getDetailFromSnapshot(detailLevel ?? 'novice');
    return { snapshotId, data };
  }

  private read(partition: string, id?: string): { snapshotId: string | null; data: unknown; staleFlag: boolean } {
    const snapshotId = id ?? this.snapshotService.resolveCurrent();
    if (!snapshotId) return { snapshotId: null, data: null, staleFlag: false };
    return {
      snapshotId,
      data: this.snapshotService.readPartition(partition, snapshotId),
      staleFlag: this.snapshotService.isStale(snapshotId),
    };
  }
}
