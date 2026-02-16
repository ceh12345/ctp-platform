import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';

const CONFIG_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'config',
);
const TENANT_ID = 'demo-manufacturing';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService);
  const strategyConfigService = new StrategyConfigService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService);
  return { ctpService, stateService, configService };
}

describe('WhereTo API', () => {
  let ctpService: CTPService;

  beforeEach(() => {
    const services = createServices();
    ctpService = services.ctpService;
  });

  describe('whereTo', () => {
    it('should return options for a valid task', () => {
      // Solve first so landscape is populated, then test where-to on a known task
      ctpService.solve();

      // Unschedule a task so it has open options
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      const result = ctpService.whereTo('T-1001-H-MACHINE');

      expect(result.taskKey).toBe('T-1001-H-MACHINE');
      expect(result.options).toBeDefined();
      expect(Array.isArray(result.options)).toBe(true);
      expect(result.options.length).toBeGreaterThan(0);
      expect(result.stats).toBeDefined();
      expect(result.stats.contextsEvaluated).toBeGreaterThanOrEqual(1);
      expect(result.stats.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return 404 for unknown task', () => {
      ctpService.solve();

      expect(() => {
        ctpService.whereTo('DOES-NOT-EXIST');
      }).toThrow(/not found/);
    });

    it('should filter by onlyResources', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      // First call without filter to see what resources are available
      const allResult = ctpService.whereTo('T-1001-H-MACHINE');
      if (allResult.options.length === 0) return; // Skip if no options

      // Get a resource key from the options
      const firstResourceKey = allResult.options[0].resources[0].resourceKey;

      const result = ctpService.whereTo('T-1001-H-MACHINE', {
        constraints: { onlyResources: [firstResourceKey] },
      });

      result.options.forEach(opt => {
        const keys = opt.resources.map(r => r.resourceKey);
        expect(keys).toContain(firstResourceKey);
      });
    });

    it('should respect maxResults', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      const result = ctpService.whereTo('T-1001-H-MACHINE', {
        constraints: { maxResults: 2 },
      });

      expect(result.options.length).toBeLessThanOrEqual(2);
    });

    it('should return options sorted by score with sequential ranks', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      const result = ctpService.whereTo('T-1001-H-MACHINE');

      for (let i = 0; i < result.options.length; i++) {
        expect(result.options[i].rank).toBe(i + 1);
      }
      for (let i = 1; i < result.options.length; i++) {
        expect(result.options[i].score).toBeGreaterThanOrEqual(result.options[i - 1].score);
      }
    });

    it('should return ISO date strings', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      const result = ctpService.whereTo('T-1001-H-MACHINE');

      if (result.options.length > 0) {
        const opt = result.options[0];
        // Verify ISO format — should be parseable
        expect(new Date(opt.start).toISOString()).toBeTruthy();
        expect(new Date(opt.end).toISOString()).toBeTruthy();
        expect(new Date(opt.latestStart).toISOString()).toBeTruthy();
        expect(new Date(opt.latestEnd).toISOString()).toBeTruthy();
      }
    });

    it('should be idempotent (same results on repeat)', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      const result1 = ctpService.whereTo('T-1001-H-MACHINE');
      const result2 = ctpService.whereTo('T-1001-H-MACHINE');

      expect(result1.options.length).toBe(result2.options.length);
      for (let i = 0; i < result1.options.length; i++) {
        expect(result1.options[i].contextHash).toBe(result2.options[i].contextHash);
      }
    });
  });

  describe('moveTo', () => {
    it('should return 404 for unknown task', () => {
      ctpService.solve();

      expect(() => {
        ctpService.moveTo('DOES-NOT-EXIST', {
          contextHash: 'whatever',
          startTime: '2025-02-17T08:00:00',
        });
      }).toThrow(/not found/);
    });

    it('should return success:false for invalid contextHash', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      const result = ctpService.moveTo('T-1001-H-MACHINE', {
        contextHash: 'INVALID-HASH',
        startTime: '2025-02-17T08:00:00',
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(result.suggestRefresh).toBe(true);
    });

    it('should move task to a valid option', () => {
      ctpService.solve();
      ctpService.unscheduleTask('T-1001-H-MACHINE');

      // Get options
      const whereToResult = ctpService.whereTo('T-1001-H-MACHINE');

      if (whereToResult.options.length === 0) {
        console.log('No options available — skipping move-to test');
        return;
      }

      const bestOption = whereToResult.options[0];

      // Move to best option
      const moveResult = ctpService.moveTo('T-1001-H-MACHINE', {
        contextHash: bestOption.contextHash,
        startTime: bestOption.start,
      });

      expect(moveResult.success).toBe(true);
      expect(moveResult.taskKey).toBe('T-1001-H-MACHINE');
      expect(moveResult.assignment).toBeDefined();
      expect(moveResult.assignment!.resources.length).toBeGreaterThan(0);
      expect(moveResult.assignment!.start).toBeTruthy();
      expect(moveResult.assignment!.end).toBeTruthy();
    });
  });
});
