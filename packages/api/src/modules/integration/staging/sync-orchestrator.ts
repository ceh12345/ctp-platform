import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { IDataAdapter, IRawDataPayload } from '../adapter.interface';
import { rawDir as rawDirOf } from './staging-paths';
import { StagingService } from './staging.service';
import { SnapshotHandle, SnapshotMetadata } from './staging-types';
import { defaultRules } from './validation/rules';
import { ValidationRunner } from './validation/validation-runner';
import { ValidationReport } from './validation/validation-types';

export interface SyncResult {
  ok: boolean;
  ts: string;
  report: ValidationReport;
  snapshotPath: string | null;  // null when markedFailed
}

@Injectable()
export class SyncOrchestrator {
  constructor(private readonly staging: StagingService) {}

  async runSync(tenant: string, adapter: IDataAdapter): Promise<SyncResult> {
    const handle = this.staging.createSnapshot(tenant);
    await this.staging.appendHistory(tenant, {
      event: 'sync-started',
      adapterType: adapter.adapterType,
      ts: handle.ts,
    });

    let phase = 'fetch';
    try {
      const raw = await adapter.fetchRawData();

      phase = 'writeRaw';
      await this.writeAllEntities(handle, raw);

      const recordCounts = this.countRecords(raw);
      const meta: SnapshotMetadata = {
        capturedAt: new Date().toISOString(),
        adapterType: adapter.adapterType,
        recordCounts,
      };
      phase = 'writeMetadata';
      await this.staging.writeMetadata(handle, meta);

      phase = 'validation';
      const previousRawDir = await this.previousRawDir(tenant);
      const runner = new ValidationRunner(defaultRules());
      const report = await runner.run({ rawDir: handle.rawDir, previousRawDir });
      await this.staging.writeReport(handle, report);

      if (!report.passed) {
        phase = 'markFailed';
        await this.staging.markFailed(handle);
        await this.staging.appendHistory(tenant, {
          event: 'sync-marked-failed',
          ts: handle.ts,
          failedRules: report.failedRules,
        });
        return { ok: false, ts: handle.ts, report, snapshotPath: null };
      }

      phase = 'promote';
      await this.staging.promote(handle);
      const promoted = await this.staging.current(tenant);
      await this.staging.appendHistory(tenant, {
        event: 'sync-promoted',
        ts: handle.ts,
        recordCounts,
      });
      return { ok: true, ts: handle.ts, report, snapshotPath: promoted };
    } catch (err) {
      await this.staging.appendHistory(tenant, {
        event: 'sync-errored',
        ts: handle.ts,
        phase,
        error: (err as Error).message ?? String(err),
      });
      throw err;
    }
  }

  private async writeAllEntities(handle: SnapshotHandle, raw: IRawDataPayload): Promise<void> {
    // Write each IRawDataPayload key as a separate entity JSON file.
    // uomConversions is the only non-array field; serialize as-is when non-null.
    await this.staging.writeRaw(handle, 'resources', raw.resources);
    await this.staging.writeRaw(handle, 'tasks', raw.tasks);
    await this.staging.writeRaw(handle, 'calendars', raw.calendars);
    await this.staging.writeRaw(handle, 'stateChanges', raw.stateChanges);
    await this.staging.writeRaw(handle, 'products', raw.products);
    await this.staging.writeRaw(handle, 'orders', raw.orders);
    await this.staging.writeRaw(handle, 'materials', raw.materials);
    await this.staging.writeRaw(handle, 'processes', raw.processes);
    await this.staging.writeRaw(handle, 'cadences', raw.cadences);
    if (raw.uomConversions != null) {
      await this.staging.writeRaw(handle, 'uomConversions', [raw.uomConversions]);
    }
  }

  private countRecords(raw: IRawDataPayload): Record<string, number> {
    return {
      resources: raw.resources.length,
      tasks: raw.tasks.length,
      calendars: raw.calendars.length,
      stateChanges: raw.stateChanges.length,
      products: raw.products.length,
      orders: raw.orders.length,
      materials: raw.materials.length,
      processes: raw.processes.length,
      cadences: raw.cadences.length,
      uomConversions: raw.uomConversions == null ? 0 : 1,
    };
  }

  private async previousRawDir(tenant: string): Promise<string | null> {
    const currentSnapshot = await this.staging.current(tenant);
    return currentSnapshot ? rawDirOf(currentSnapshot) : null;
  }
}
