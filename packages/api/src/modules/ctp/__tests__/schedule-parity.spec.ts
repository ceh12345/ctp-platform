import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';
import { ScheduleConfigurationService } from '../../../config/schedule-configuration.service';
import { LoggerService } from '../../../logging/logger.service';

/**
 * Byte-for-byte schedule parity gate — SPRINT-dispatch-strategy-seam.md, Phase 1.
 *
 * Captures the exact scheduled placement of every task on a set of fixed-horizon
 * tenants as a committed golden, so the dispatch-seam refactor
 * (`DynamicNeighborhood(StaticRankPriority)` replacing `ChainNeighborhood`) can be
 * proven behavior-preserving. Fixed horizons make the solve deterministic (no
 * wall-clock input into the schedule), so equality is stable across machines/days.
 *
 * No tenant has standalone (no-`linkId`) tasks, so the chain-head sort is the
 * entire parity surface (Phase 0(e)); the standalone `greedySortFn` never runs.
 *
 * Regenerate goldens after an INTENTIONAL scheduler change, then review + commit:
 *   PARITY_REGEN=1 npx vitest run schedule-parity
 */
const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const GOLDEN_DIR = path.join(__dirname, '__parity__');
const REGEN = process.env.PARITY_REGEN === '1';

// Deterministic constructive-solve tenants. The excluded tenants
// (demo-manufacturing, summit-pharma, stafford-engineering) run the engine's
// optimization layer during solve, which is non-deterministic BY DESIGN
// (`perturbation.ts` uses Math.random(); `tabusearch.ts` terminates on a
// wall-clock time budget) — so their schedules vary run-to-run and cannot back a
// byte-for-byte gate. The dispatch seam changes the *constructive* selection, and
// these three tenants cover it: cross-WO chains (slim-100), healthcare chains
// (acme), and scale (hrmd, 133 tasks). See sprint spec Phase 1 finding.
const TENANTS = [
  'stafford-slim-100',
  'acme-outpatient',
  'hrmd-rec-sports',
];

function createServices(tenantId: string) {
  const store = new FileConfigStore(CONFIG_ROOT, tenantId);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  const strategyConfigService = new StrategyConfigService(configService);
  const logger = new LoggerService();
  const schedConfigService = new ScheduleConfigurationService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService, logger, schedConfigService);
  return { ctpService };
}

interface Placement {
  key: string;
  start: string | null;
  end: string | null;
  resources: string[];
}

function scheduleVector(result: any): Placement[] {
  return (result.tasks as any[])
    .filter((t) => t.feasible)
    .map((t) => ({
      key: t.key,
      start: t.scheduledStart ?? null,
      end: t.scheduledEnd ?? null,
      resources: ((t.assignedResources ?? []) as any[])
        .map((r) => r?.resourceKey ?? r?.resource ?? r?.key)
        .filter((x): x is string => typeof x === 'string')
        .sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

describe('schedule parity gate (dispatch-seam Phase 1)', () => {
  for (const tenant of TENANTS) {
    it(`${tenant}: schedule matches committed golden`, async () => {
      // Solve twice (fresh services) and assert equal — determinism is a
      // precondition of a byte-for-byte gate; this catches any future
      // non-determinism regression before it can corrupt the golden.
      const vec = scheduleVector(await createServices(tenant).ctpService.solve());
      const vec2 = scheduleVector(await createServices(tenant).ctpService.solve());
      expect(vec2, `${tenant} is non-deterministic across solves`).toEqual(vec);
      const goldenPath = path.join(GOLDEN_DIR, `${tenant}.golden.json`);

      if (REGEN) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(goldenPath, JSON.stringify(vec, null, 2) + '\n');
        // eslint-disable-next-line no-console
        console.log(`[parity] wrote golden ${tenant}: ${vec.length} scheduled tasks`);
        return;
      }

      if (!existsSync(goldenPath)) {
        throw new Error(
          `Missing parity golden for ${tenant}. Generate with: PARITY_REGEN=1 npx vitest run schedule-parity`,
        );
      }
      const golden: Placement[] = JSON.parse(readFileSync(goldenPath, 'utf8'));
      expect(vec.length, `${tenant} scheduled-task count`).toBe(golden.length);
      expect(vec, `${tenant} schedule vector`).toEqual(golden);
    });
  }
});
