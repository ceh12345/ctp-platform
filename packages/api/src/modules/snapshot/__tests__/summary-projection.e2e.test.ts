/**
 * P6 — summary projection: the KB-scale landing read. Asserts the summary
 * partition stays under 100 KB and its headline is CONSISTENT with the
 * landscape it was projected from (drift between the denormalized summary and
 * the source is the predictable bug).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CTPService } from '../../ctp/ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';
import { ScheduleConfigurationService } from '../../../config/schedule-configuration.service';
import { LoggerService } from '../../../logging/logger.service';
import { SnapshotService } from '../snapshot.service';
import { CTPTask, CTPTaskStateConstants } from '@ctp/engine';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'stafford-slim-100';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  const snapshotService = new SnapshotService(configService);
  const ctpService = new CTPService(
    stateService, configService,
    new StrategyConfigService(configService), new LoggerService(),
    new ScheduleConfigurationService(configService), undefined, snapshotService,
  );
  return { ctpService, stateService, snapshotService };
}

describe('P6 — summary projection (slim-100)', () => {
  let dataRoot: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CTP_DATA_ROOT;
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-p6-'));
    process.env.CTP_DATA_ROOT = dataRoot;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CTP_DATA_ROOT;
    else process.env.CTP_DATA_ROOT = prevEnv;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('writes a <100 KB summary partition, consistent with the landscape, with bare-number buckets', async () => {
    const { ctpService, stateService, snapshotService } = createServices();
    await ctpService.solve();

    const summary = snapshotService.readPartition<any>('summary')!;
    expect(summary).not.toBeNull();

    // size budget — the whole point of the landing read
    const bytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
    expect(bytes).toBeLessThan(100 * 1024);

    // consistency: headline matches a fresh recount of the landscape
    const ls = stateService.getLandscape()!;
    let scheduled = 0, total = 0;
    ls.tasks.forEach((t: CTPTask) => { total++; if (t.state === CTPTaskStateConstants.SCHEDULED) scheduled++; });
    expect(summary.headline.scheduledTasks).toBe(scheduled);
    expect(summary.headline.totalTasks).toBe(total);

    // buckets are bare numbers indexed to bucketMeta — no per-cell timestamps
    expect(summary.bucketMeta.count).toBeGreaterThan(0);
    for (const r of summary.resourceLoad) {
      expect(r.buckets).toHaveLength(summary.bucketMeta.count);
      expect(r.buckets.every((b: any) => typeof b === 'number')).toBe(true);
    }
    // bottleneck is the max-utilization resource in resourceLoad
    if (summary.resourceLoad.length) {
      const maxPct = Math.max(...summary.resourceLoad.map((r: any) => r.overallUtilizationPct));
      expect(summary.headline.bottleneck.pct).toBeCloseTo(maxPct, 4);
    }
  });
});
