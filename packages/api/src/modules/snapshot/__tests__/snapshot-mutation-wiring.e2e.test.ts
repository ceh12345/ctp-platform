/**
 * P4 — every schedule-state mutation promotes a snapshot.
 * Wires a real CTPService (slim-100 tenant) to a SnapshotService pointed at a
 * temp CTP_DATA_ROOT, then asserts solve + each non-solve mutation advances
 * `current` with the right eventType and an overlay that reflects the change.
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
import { CTPTask, CTPTaskStateConstants, CTPTaskTypeConstants } from '@ctp/engine';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'stafford-slim-100';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  const strategyConfigService = new StrategyConfigService(configService);
  const logger = new LoggerService();
  const schedConfigService = new ScheduleConfigurationService(configService);
  const snapshotService = new SnapshotService(configService);
  const ctpService = new CTPService(
    stateService, configService, strategyConfigService, logger, schedConfigService,
    undefined, snapshotService,
  );
  return { ctpService, stateService, snapshotService };
}

describe('P4 — mutation → snapshot promotion (slim-100)', () => {
  let dataRoot: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CTP_DATA_ROOT;
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-p4-'));
    process.env.CTP_DATA_ROOT = dataRoot;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CTP_DATA_ROOT;
    else process.env.CTP_DATA_ROOT = prevEnv;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('solve promotes a "solve" snapshot; each mutation promotes a "mutation" snapshot', async () => {
    const { ctpService, stateService, snapshotService } = createServices();

    // ── solve ──
    await ctpService.solve();
    const afterSolve = snapshotService.resolveCurrent();
    expect(afterSolve).not.toBeNull();
    expect(snapshotService.readPartition<any>('meta')!.eventType).toBe('solve');
    const overlay = snapshotService.readPartition<any>('overlay')!;
    expect(overlay.rows.length).toBeGreaterThan(0);

    // pick a scheduled, non-pinned PROCESS task to pin
    const landscape = stateService.getLandscape()!;
    let target: CTPTask | undefined;
    landscape.tasks.forEach((t: CTPTask) => {
      if (!target && t.state === CTPTaskStateConstants.SCHEDULED && !t.pinned &&
          t.type === CTPTaskTypeConstants.PROCESS) target = t;
    });
    expect(target).toBeDefined();

    // ── pin (mutation) ──
    ctpService.pinTask(target!.key, true);
    const afterPin = snapshotService.resolveCurrent();
    expect(afterPin).not.toBe(afterSolve);              // current advanced
    expect(snapshotService.readPartition<any>('meta')!.eventType).toBe('mutation');
    const pinnedRow = snapshotService
      .readPartition<any>('overlay')!
      .rows.find((r: any) => r.taskKey === target!.key);
    expect(pinnedRow.pinned).toBe(true);                // overlay reflects the change

    // ── unschedule (mutation) ──
    ctpService.unschedule([target!.key]);
    const afterUnsched = snapshotService.resolveCurrent();
    expect(afterUnsched).not.toBe(afterPin);
    expect(snapshotService.readPartition<any>('meta')!.eventType).toBe('mutation');
  });

  it('writes nothing when no SnapshotService is provided (direct-construction tests stay clean)', async () => {
    // Mirror the existing harness: construct CTPService WITHOUT a SnapshotService.
    const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
    const configService = new ConfigService(store);
    const hydrator = new StateHydratorService(configService);
    const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
    const ctpService = new CTPService(
      stateService, configService,
      new StrategyConfigService(configService), new LoggerService(),
      new ScheduleConfigurationService(configService),
    );
    await ctpService.solve();
    // no snapshots dir created for this tenant under the temp root
    const tenantSnaps = path.join(dataRoot, 'tenants', TENANT_ID, 'snapshots');
    expect(fs.existsSync(tenantSnaps)).toBe(false);
  });
});
