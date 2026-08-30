/**
 * P5 — reconstruct on load + restart durability (version-pinned). The 2nd gate.
 * Proves: after solve + mutations, a freshly-hydrated base reconstructs the exact
 * scheduled state from `current` WITHOUT solving (pin + window-extend survive a
 * "restart"); the version guard refuses to overlay a stale snapshot; and an
 * unsolved tenant reports cold-start.
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
import { SnapshotStore } from '../snapshot-store';
import { serializeOverlay, CTPTask, CTPTaskStateConstants, CTPTaskTypeConstants } from '@ctp/engine';

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
  return { ctpService, stateService, snapshotService, configService, hydrator };
}

/** A fresh, unsolved base landscape — simulates a cold process after restart. */
function freshBase(hydrator: StateHydratorService, configService: ConfigService) {
  return hydrator.buildLandscape(undefined, configService.getWorkOrderGroupsData());
}

describe('P5 — reconstruct on load (slim-100)', () => {
  let dataRoot: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CTP_DATA_ROOT;
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-p5-'));
    process.env.CTP_DATA_ROOT = dataRoot;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CTP_DATA_ROOT;
    else process.env.CTP_DATA_ROOT = prevEnv;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('RESTART DURABILITY: pin + window-extend survive a reconstruct from disk, no solve', async () => {
    const { ctpService, stateService, snapshotService, configService, hydrator } = createServices();
    await ctpService.solve();
    const ls1 = stateService.getLandscape()!;

    // pin a scheduled, non-pinned PROCESS task
    let pinned: CTPTask | undefined;
    ls1.tasks.forEach((t: CTPTask) => {
      if (!pinned && t.state === CTPTaskStateConstants.SCHEDULED && !t.pinned &&
          t.type === CTPTaskTypeConstants.PROCESS) pinned = t;
    });
    expect(pinned).toBeDefined();
    ctpService.pinTask(pinned!.key, true);
    const pinnedStartW = pinned!.scheduled!.startW;

    // extend the window end on another scheduled task
    let win: CTPTask | undefined;
    ls1.tasks.forEach((t: CTPTask) => {
      if (!win && t.scheduled && t.key !== pinned!.key && t.window) win = t;
    });
    expect(win).toBeDefined();
    ctpService.setTaskWindow(win!.key, undefined, '2027-12-31T00:00:00Z');
    const extendedEndW = win!.window!.endW;

    // ── "restart": fresh, unsolved base ──
    const base = freshBase(hydrator, configService);
    expect(base.tasks.getEntity(pinned!.key)!.pinned).toBe(false);          // sanity: base is unsolved
    expect(base.tasks.getEntity(win!.key)!.window!.endW).not.toBe(extendedEndW);

    const result = snapshotService.reconstruct(base);
    expect(result.applied).toBe(true);
    expect(result.staleFlag).toBe(false);

    // exact scheduled state restored from disk — no solve ran
    const rPinned = base.tasks.getEntity(pinned!.key)!;
    expect(rPinned.pinned).toBe(true);
    expect(rPinned.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(rPinned.scheduled!.startW).toBe(pinnedStartW);
    expect(base.tasks.getEntity(win!.key)!.window!.endW).toBe(extendedEndW);
  });

  it('VERSION GUARD: a stale-version overlay is NOT applied (staleFlag set)', async () => {
    const { ctpService, stateService, snapshotService, configService, hydrator } = createServices();
    await ctpService.solve();
    const overlay = serializeOverlay(stateService.getLandscape()!);

    // write a snapshot whose base version does not match the current base
    new SnapshotStore(dataRoot, TENANT_ID).promote({
      meta: { snapshotId: '', timestamp: new Date().toISOString(), eventType: 'solve', sourceDataVersion: 'STALE-v0' },
      overlay,
    });

    const base = freshBase(hydrator, configService);
    const result = snapshotService.reconstruct(base);
    expect(result.staleFlag).toBe(true);
    expect(result.applied).toBe(false);
    // base was not overlaid — a normally-scheduled task stays unscheduled
    let anyScheduledNonPinned = false;
    base.tasks.forEach((t: CTPTask) => {
      if (t.state === CTPTaskStateConstants.SCHEDULED && !t.pinned) anyScheduledNonPinned = true;
    });
    expect(anyScheduledNonPinned).toBe(false);
  });

  it('COLD START: no snapshot → coldStart, base left unsolved', () => {
    const { snapshotService, configService, hydrator } = createServices();
    const base = freshBase(hydrator, configService);
    const result = snapshotService.reconstruct(base);
    expect(result.coldStart).toBe(true);
    expect(result.applied).toBe(false);
  });
});
