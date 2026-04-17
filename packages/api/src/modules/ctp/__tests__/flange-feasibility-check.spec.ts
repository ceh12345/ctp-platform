/**
 * Ad-hoc verification: PV-001-FLANGE on stafford-engineering is feasible
 * after the basescheduler.ts infeasibility-guard change.
 *
 * Asserts the task reaches SCHEDULED and is NOT flagged by the new
 * "all filtered out" error path.
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
import { CTPTaskStateConstants, CTPTask } from '@ctp/engine';

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

describe('Stafford Engineering — PV-001-FLANGE feasibility', () => {
  it('PV-001-FLANGE produces feasible slots (not tripped by all-filtered guard)', async () => {
    const { ctpService, stateService } = createServices();
    await ctpService.solve();

    const landscape = stateService.getLandscape()!;
    expect(landscape).not.toBeNull();

    const flange = landscape.tasks.getEntity('PV-001-FLANGE') as CTPTask | null;
    expect(flange, 'PV-001-FLANGE must exist in the stafford-engineering tenant').not.toBeNull();

    // Should NOT carry the new all-filtered error
    const allFilteredErr = (flange!.errors ?? []).find(e =>
      typeof e.reason === 'string' && e.reason.includes('all filtered out')
    );
    expect(allFilteredErr, `PV-001-FLANGE hit the all-filtered guard: ${JSON.stringify(allFilteredErr)}`).toBeUndefined();

    // Should be SCHEDULED — evidence that feasible slots were produced
    expect(flange!.state, `PV-001-FLANGE state=${flange!.state}, errors=${JSON.stringify(flange!.errors)}`)
      .toBe(CTPTaskStateConstants.SCHEDULED);
    expect(flange!.scheduled).not.toBeNull();
  });
});
