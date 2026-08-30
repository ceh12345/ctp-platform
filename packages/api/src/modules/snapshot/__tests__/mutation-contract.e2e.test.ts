/**
 * P5.1 — mutation→snapshot CONTRACT (service-boundary, uniform).
 * Every schedule-state mutation must promote a snapshot via the same
 * promoteSnapshot chokepoint. This test exercises each wired mutation and
 * asserts `current` advanced — so the day someone adds a mutation without
 * wiring it (the exact bug that bit P4), this fails loudly.
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
  const snapshotService = new SnapshotService(configService);
  const ctpService = new CTPService(
    stateService, configService,
    new StrategyConfigService(configService), new LoggerService(),
    new ScheduleConfigurationService(configService), undefined, snapshotService,
  );
  return { ctpService, stateService, snapshotService };
}

describe('P5.1 — every mutation promotes a snapshot (contract)', () => {
  let dataRoot: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.CTP_DATA_ROOT;
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-contract-'));
    process.env.CTP_DATA_ROOT = dataRoot;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CTP_DATA_ROOT;
    else process.env.CTP_DATA_ROOT = prevEnv;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('advances `current` for solve + every wired mutation', async () => {
    const { ctpService, stateService, snapshotService } = createServices();

    // ── solve ──
    await ctpService.solve();
    let last = snapshotService.resolveCurrent();
    expect(last).not.toBeNull();

    const expectAdvances = (label: string, fn: () => void) => {
      fn();
      const now = snapshotService.resolveCurrent();
      expect(now, `${label} did not promote a snapshot`).not.toBe(last);
      last = now;
    };

    // collect scheduled, non-pinned PROCESS tasks to operate on
    const ls = stateService.getLandscape()!;
    const scheduled: CTPTask[] = [];
    ls.tasks.forEach((t: CTPTask) => {
      if (t.state === CTPTaskStateConstants.SCHEDULED && !t.pinned &&
          t.type === CTPTaskTypeConstants.PROCESS) scheduled.push(t);
    });
    expect(scheduled.length).toBeGreaterThanOrEqual(5);
    const [A, B, C, D, E] = scheduled;
    const bRes = B.capacityResources?.at(0)?.scheduledResource
      ?? B.capacityResources?.at(0)?.resource ?? '';

    // planning mutations
    expectAdvances('pinTask', () => ctpService.pinTask(A.key, true));
    expectAdvances('setTaskWindow', () => ctpService.setTaskWindow(B.key, undefined, '2027-12-31T00:00:00Z'));
    expectAdvances('setTaskPriority', () => ctpService.setTaskPriority(B.key, 1));
    if (bRes) expectAdvances('updateResourceMode', () => ctpService.updateResourceMode(B.key, bRes, 'MONITORED', 'capacity'));
    expectAdvances('updateProgress', () => ctpService.updateProgress(E.key, { percentComplete: 25 }));

    // schedule / unschedule (use a non-pinned task)
    expectAdvances('unschedule', () => ctpService.unschedule([E.key]));
    expectAdvances('schedule', () => ctpService.schedule([E.key]));

    // commitment stack: dispatch → start → hold → resume → complete
    expectAdvances('dispatchTasks', () => ctpService.dispatchTasks([C.key]));
    expectAdvances('startTask', () => ctpService.startTask(C.key));
    expectAdvances('holdTask', () => ctpService.holdTask(C.key, 'maintenance'));
    expectAdvances('resumeTask', () => ctpService.resumeTask(C.key));
    expectAdvances('completeTask', () => ctpService.completeTask(C.key));

    // dispatch → revert
    expectAdvances('dispatchTasks(2)', () => ctpService.dispatchTasks([D.key]));
    expectAdvances('revertDispatch', () => ctpService.revertDispatch([D.key]));

    // resource downtime (direct mutation, overlay-captured)
    const someResourceKey = ls.resources.toArray()[0].key;
    expectAdvances('addResourceDowntime', () => ctpService.addResourceDowntime(someResourceKey, { reason: 'PM' }));
    expectAdvances('endResourceDowntime', () => ctpService.endResourceDowntime(someResourceKey, {}));
  });
});
