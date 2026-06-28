/**
 * P7 — snapshot read endpoints (additive). Each GET resolves ?id/current and
 * returns the partition wrapped with its resolved snapshotId; cold-start returns
 * snapshotId:null (not a 404).
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
import { SnapshotController } from '../snapshot.controller';

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
  return { ctpService, snapshotService, controller: new SnapshotController(snapshotService) };
}

describe('P7 — SnapshotController (slim-100)', () => {
  let dataRoot: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CTP_DATA_ROOT;
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-p7-'));
    process.env.CTP_DATA_ROOT = dataRoot;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CTP_DATA_ROOT;
    else process.env.CTP_DATA_ROOT = prevEnv;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('serves meta / summary / overlay for current, each carrying the resolved snapshotId', async () => {
    const { ctpService, snapshotService, controller } = createServices();
    await ctpService.solve();
    const current = snapshotService.resolveCurrent();

    const meta = controller.getMeta();
    expect(meta.snapshotId).toBe(current);
    expect((meta.data as any).eventType).toBe('solve');

    const summary = controller.getSummary();
    expect(summary.snapshotId).toBe(current);
    expect((summary.data as any).headline.totalTasks).toBeGreaterThan(0);

    const overlay = controller.getOverlay();
    expect(overlay.snapshotId).toBe(current);
    expect((overlay.data as any).rows.length).toBeGreaterThan(0);
  });

  it('resolves an explicit ?id, and reports cold-start as snapshotId:null', async () => {
    const { ctpService, snapshotService, controller } = createServices();
    await ctpService.solve();
    const id = snapshotService.resolveCurrent()!;

    // explicit id pins to that snapshot
    expect(controller.getSummary(id).snapshotId).toBe(id);
    // unknown id → resolved id echoed, data null
    const unknown = controller.getOverlay('20990101T000000000Z');
    expect(unknown.snapshotId).toBe('20990101T000000000Z');
    expect(unknown.data).toBeNull();
  });

  it('cold-start: no snapshot → snapshotId:null, data:null (not a 404)', () => {
    const { controller } = createServices();
    const meta = controller.getMeta();
    expect(meta.snapshotId).toBeNull();
    expect(meta.data).toBeNull();
  });
});
