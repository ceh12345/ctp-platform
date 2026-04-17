/**
 * Stafford Engineering — Unschedule-All Integration Test
 *
 * Verifies that after a full solve followed by bulk unschedule of all
 * non-pinned PROCESS tasks, no orphaned SETUP or TEARDOWN tasks remain
 * scheduled on any resource.
 *
 * The only tasks allowed to remain scheduled are those that are pinned
 * (i.e. running or dispatched — anchored by the engine before solve).
 *
 * This is a standalone regression test for the cascade sweep fix in
 * BaseScheduler.unschedule() — it exercises the solver-path entry point
 * directly, using the real Stafford tenant dataset.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';
import { ScheduleConfigurationService } from '../../../config/schedule-configuration.service';
import { LoggerService } from '../../../logging/logger.service';
import {
  CTPScheduler,
  List,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  CTPTask,
  CTPScoring,
  CTPScoringConfiguration,
  CTPAppSettings,
} from '@ctp/engine';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'stafford-engineering';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  const strategyConfigService = new StrategyConfigService(configService);
  const logger = new LoggerService();
  const schedConfigService = new ScheduleConfigurationService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService, logger, schedConfigService);
  return { ctpService, stateService };
}

describe('Stafford Engineering — bulk unschedule cascade', () => {
  it('leaves no scheduled SETUP or TEARDOWN tasks after unscheduling all non-pinned PROCESS tasks', async () => {
    const { ctpService, stateService } = createServices();

    // 1. Solve — schedules all tasks, anchors committed (running/dispatched) tasks with pinned=true
    await ctpService.solve();

    const landscape = stateService.getLandscape()!;
    expect(landscape).not.toBeNull();

    // 2. Collect all scheduled, non-pinned PROCESS tasks
    //    (this mirrors the UI "select all process tasks → unschedule" action)
    const processTasksToUnschedule: CTPTask[] = [];
    landscape.tasks.forEach((task: CTPTask) => {
      if (
        task.state === CTPTaskStateConstants.SCHEDULED &&
        !task.pinned &&
        task.type === CTPTaskTypeConstants.PROCESS
      ) {
        processTasksToUnschedule.push(task);
      }
    });

    expect(processTasksToUnschedule.length).toBeGreaterThan(0);

    // 3. Build a List<CTPTask> and call scheduler.unschedule() — the solver-path entry point
    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon,
      landscape.tasks,
      landscape.resources,
      landscape.stateChanges,
      landscape.processes,
    );
    const scoring = new CTPScoring('test', 'test');
    scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
    scheduler.initScoring(scoring);
    scheduler.initSettings(new CTPAppSettings());

    const taskList = new List<CTPTask>();
    for (const t of processTasksToUnschedule) taskList.add(t);
    scheduler.unschedule(taskList);

    // 4. Collect all tasks still scheduled after unschedule
    const stillScheduled: CTPTask[] = [];
    landscape.tasks.forEach((task: CTPTask) => {
      if (task.state === CTPTaskStateConstants.SCHEDULED) {
        stillScheduled.push(task);
      }
    });

    // 5a. No un-pinned SETUP or TEARDOWN should remain scheduled whose chain has
    //     no scheduled PROCESS task (including pinned/running ones).
    //     A TEARDOWN is legitimate if its chain's PROCESS is still running (pinned).
    //     A SETUP/TEARDOWN is pinned itself if it has a terminal WIP state (e.g. completed).
    const allTasks: CTPTask[] = landscape.tasks.toArray();
    const orphanedStateChanges = stillScheduled.filter(t => {
      if (t.type !== CTPTaskTypeConstants.SET_UP && t.type !== CTPTaskTypeConstants.TEAR_DOWN) return false;
      if (t.pinned) return false; // legitimately committed
      const chainName = t.linkId?.name;
      if (!chainName) return false;
      const chainHasScheduledProcess = allTasks.some(
        ct => ct.linkId?.name === chainName &&
              ct.type === CTPTaskTypeConstants.PROCESS &&
              ct.state === CTPTaskStateConstants.SCHEDULED
      );
      return !chainHasScheduledProcess; // orphaned: no process left in the chain
    });
    if (orphanedStateChanges.length > 0) {
      const keys = orphanedStateChanges.map(t => `${t.key} (${t.type}, chain: ${t.linkId?.name ?? 'none'})`).join(', ');
      throw new Error(`Orphaned route-defined state change tasks remain scheduled: ${keys}`);
    }
    expect(orphanedStateChanges.length).toBe(0);

    // 5b. All remaining scheduled PROCESS tasks must be pinned
    //     (running or dispatched tasks anchored before solve).
    //     SETUP/TEARDOWN covered by 5a. PROCESS CHANGE (Type 1 dynamic) excluded — separate concern.
    const unpinnedScheduled = stillScheduled.filter(
      t => t.type === CTPTaskTypeConstants.PROCESS && !t.pinned
    );
    if (unpinnedScheduled.length > 0) {
      const keys = unpinnedScheduled.map(t => `${t.key} (${t.type}, commitment: ${t.commitmentLevel})`).join(', ');
      throw new Error(`Non-pinned tasks remain scheduled after bulk unschedule: ${keys}`);
    }
    expect(unpinnedScheduled.length).toBe(0);
  });
});
