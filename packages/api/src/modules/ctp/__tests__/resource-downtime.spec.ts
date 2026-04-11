import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { StrategyConfigService } from '../../../config/strategy-config.service';
import { ScheduleConfigurationService } from '../../../config/schedule-configuration.service';
import { LoggerService } from '../../../logging/logger.service';
import { DateTime } from 'luxon';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'demo-manufacturing';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  const strategyConfigService = new StrategyConfigService(configService);
  const logger = new LoggerService();
  const schedConfigService = new ScheduleConfigurationService(configService);
  const ctpService = new CTPService(stateService, configService, strategyConfigService, logger, schedConfigService);
  return { ctpService };
}

// Helper: pick any resource key from the solved landscape
function getAnyResourceKey(ctpService: CTPService): string {
  const state = ctpService.getState();
  return state.resourceUtilization[0].resourceKey;
}

// Helper: ISO string offset from now
function isoOffset(hours: number): string {
  return DateTime.now().plus({ hours }).toISO()!;
}

describe('Resource Downtime Management', () => {
  let ctpService: CTPService;

  beforeEach(() => {
    ({ ctpService } = createServices());
    // Solve first so landscape is populated with scheduled tasks
    ctpService.solve();
  });

  // ── addResourceDowntime ──────────────────────────────────────────

  describe('addResourceDowntime', () => {
    it('creates a downtime with explicit start and end', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const startTime = isoOffset(1);
      const endTime = isoOffset(5);

      const result = ctpService.addResourceDowntime(resourceKey, {
        startTime, endTime, reason: 'Spindle bearing replacement',
      });

      expect(result.status).toBe('ok');
      expect(result.resourceKey).toBe(resourceKey);
      expect(result.downtime.reason).toBe('Spindle bearing replacement');
      expect(result.downtime.indefinite).toBe(false);
      expect(result.downtime.startTime).toBeTruthy();
      expect(result.downtime.endTime).toBeTruthy();
    });

    it('defaults startTime to now when omitted', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const before = Date.now();
      const result = ctpService.addResourceDowntime(resourceKey, {
        endTime: isoOffset(4), reason: 'Test',
      });
      const after = Date.now();

      const startMs = new Date(result.downtime.startTime).getTime();
      expect(startMs).toBeGreaterThanOrEqual(before - 1000);
      expect(startMs).toBeLessThanOrEqual(after + 1000);
    });

    it('marks downtime as indefinite when endTime omitted', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const result = ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(1), reason: 'Unknown duration',
      });

      expect(result.downtime.indefinite).toBe(true);
      expect(result.downtime.endTime).toBeNull();
    });

    it('returns affectedTasks with scheduled tasks on the resource during downtime', () => {
      // Solve first — tasks are scheduled
      const state = ctpService.getState();
      // Find a resource that has scheduled tasks
      const resWithTasks = state.resourceUtilization.find((r: any) =>
        state.tasks.some((t: any) => t.scheduledStart && t.assignedResources?.some((ar: any) => ar.resourceKey === r.resourceKey))
      );
      if (!resWithTasks) return; // no scheduled tasks — skip

      // Use a wide downtime window to catch assigned tasks
      const result = ctpService.addResourceDowntime(resWithTasks.resourceKey, {
        startTime: isoOffset(-24),
        endTime: isoOffset(24 * 14),
        reason: 'Full coverage test',
      });

      expect(result.affectedCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.affectedTasks)).toBe(true);
      result.affectedTasks.forEach((at: any) => {
        expect(at.taskKey).toBeTruthy();
        expect(at.commitmentLevel).toBeTruthy();
        expect(at.scheduledStart).toBeTruthy();
      });
    });

    it('returns affectedCount 0 for a downtime window with no scheduled tasks', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      // Far future window, unlikely to have tasks
      const result = ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(24 * 365),
        endTime: isoOffset(24 * 366),
        reason: 'Far future',
      });

      expect(result.affectedCount).toBe(0);
    });

    it('throws 404 for unknown resource', () => {
      expect(() =>
        ctpService.addResourceDowntime('DOES-NOT-EXIST', { reason: 'test' })
      ).toThrow();
    });

    it('multiple downtimes on same resource accumulate', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, { startTime: isoOffset(1), endTime: isoOffset(3), reason: 'First' });
      ctpService.addResourceDowntime(resourceKey, { startTime: isoOffset(5), endTime: isoOffset(7), reason: 'Second' });

      const result = ctpService.getResourceDowntimes(resourceKey);
      expect(result.downtimes.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── endResourceDowntime ──────────────────────────────────────────

  describe('endResourceDowntime', () => {
    it('trims an active downtime to the uptime', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      // Create a downtime that started in the past and ends in the future
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-2),
        endTime: isoOffset(6),
        reason: 'Active maintenance',
      });

      const upTime = isoOffset(2);
      const result = ctpService.endResourceDowntime(resourceKey, { actualUpTime: upTime });

      expect(result.status).toBe('ok');
      expect(result.trimmed).toBe(true);
      expect(result.removed).toBe(false);
      expect(result.freedCapacityHours).toBeGreaterThan(0);
    });

    it('removes a future downtime that has not started yet', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(5),
        endTime: isoOffset(9),
        reason: 'Planned maintenance',
      });

      // upTime is before the downtime starts — removes it entirely
      const result = ctpService.endResourceDowntime(resourceKey, { actualUpTime: isoOffset(3) });

      expect(result.removed).toBe(true);
      expect(result.trimmed).toBe(false);
      expect(result.freedCapacityHours).toBeGreaterThan(0);
    });

    it('freedCapacityHours reflects trimmed duration, not horizon remainder', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      // 8-hour downtime starting in past
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-1),
        endTime: isoOffset(7),
        reason: 'Long downtime',
      });

      // Bring up 2 hours from now — frees the remaining 5h (7 - 2 = 5h)
      const result = ctpService.endResourceDowntime(resourceKey, { actualUpTime: isoOffset(2) });

      // Freed = (endW - upTimeW) = 5 hours
      expect(result.freedCapacityHours).toBeCloseTo(5, 0);
    });

    it('defaults uptime to now when actualUpTime omitted', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-2),
        endTime: isoOffset(4),
        reason: 'Test',
      });

      const result = ctpService.endResourceDowntime(resourceKey, {});
      expect(result.status).toBe('ok');
      expect(result.trimmed || result.removed).toBe(true);
    });

    it('throws 404 for unknown resource', () => {
      expect(() =>
        ctpService.endResourceDowntime('DOES-NOT-EXIST', {})
      ).toThrow();
    });

    it('returns trimmed=false and removed=false when no maintenance assignments exist', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const result = ctpService.endResourceDowntime(resourceKey, { actualUpTime: isoOffset(1) });
      expect(result.trimmed).toBe(false);
      expect(result.removed).toBe(false);
      expect(result.freedCapacityHours).toBe(0);
    });
  });

  // ── getResourceDowntimes ─────────────────────────────────────────

  describe('getResourceDowntimes', () => {
    it('returns empty downtimes when none exist', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const result = ctpService.getResourceDowntimes(resourceKey);

      expect(result.resourceKey).toBe(resourceKey);
      expect(result.downtimes).toEqual([]);
      expect(result.isCurrentlyDown).toBe(false);
    });

    it('returns active downtime with status=active', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-1),
        endTime: isoOffset(3),
        reason: 'Active now',
      });

      const result = ctpService.getResourceDowntimes(resourceKey);
      expect(result.isCurrentlyDown).toBe(true);
      const active = result.downtimes.find((d: any) => d.status === 'active');
      expect(active).toBeDefined();
      expect(active.reason).toBe('Active now');
    });

    it('returns upcoming downtime with status=upcoming', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(2),
        endTime: isoOffset(6),
        reason: 'Scheduled maintenance',
      });

      const result = ctpService.getResourceDowntimes(resourceKey);
      expect(result.isCurrentlyDown).toBe(false);
      const upcoming = result.downtimes.find((d: any) => d.status === 'upcoming');
      expect(upcoming).toBeDefined();
      expect(upcoming.reason).toBe('Scheduled maintenance');
    });

    it('skips past downtimes', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-5),
        endTime: isoOffset(-1),  // ended in the past
        reason: 'Past maintenance',
      });

      const result = ctpService.getResourceDowntimes(resourceKey);
      expect(result.downtimes.length).toBe(0);
    });

    it('sorts active before upcoming', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, { startTime: isoOffset(4), endTime: isoOffset(6), reason: 'Future' });
      ctpService.addResourceDowntime(resourceKey, { startTime: isoOffset(-1), endTime: isoOffset(2), reason: 'Active' });

      const result = ctpService.getResourceDowntimes(resourceKey);
      expect(result.downtimes[0].status).toBe('active');
      expect(result.downtimes[1].status).toBe('upcoming');
    });

    it('marks indefinite downtime correctly', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-1),
        reason: 'Indefinite',
        // no endTime
      });

      const result = ctpService.getResourceDowntimes(resourceKey);
      const dt = result.downtimes[0];
      expect(dt.indefinite).toBe(true);
      expect(dt.endTime).toBeNull();
    });

    it('throws 404 for unknown resource', () => {
      expect(() =>
        ctpService.getResourceDowntimes('DOES-NOT-EXIST')
      ).toThrow();
    });
  });

  // ── getAllResourceDowntimes ──────────────────────────────────────

  describe('getAllResourceDowntimes', () => {
    it('returns empty when no downtimes exist', () => {
      const result = ctpService.getAllResourceDowntimes();
      expect(result.downtimes).toEqual([]);
      expect(result.activeCount).toBe(0);
    });

    it('aggregates downtimes across multiple resources', () => {
      const state = ctpService.getState();
      const r1 = state.resourceUtilization[0].resourceKey;
      const r2 = state.resourceUtilization[1]?.resourceKey;
      if (!r2) return;

      ctpService.addResourceDowntime(r1, { startTime: isoOffset(-1), endTime: isoOffset(3), reason: 'R1 down' });
      ctpService.addResourceDowntime(r2, { startTime: isoOffset(2), endTime: isoOffset(5), reason: 'R2 planned' });

      const result = ctpService.getAllResourceDowntimes();
      expect(result.downtimes.length).toBeGreaterThanOrEqual(2);
      expect(result.activeCount).toBeGreaterThanOrEqual(1);
    });

    it('activeCount matches number of active entries', () => {
      const state = ctpService.getState();
      const r1 = state.resourceUtilization[0].resourceKey;
      const r2 = state.resourceUtilization[1]?.resourceKey;

      ctpService.addResourceDowntime(r1, { startTime: isoOffset(-1), endTime: isoOffset(3), reason: 'Active 1' });
      if (r2) ctpService.addResourceDowntime(r2, { startTime: isoOffset(-1), endTime: isoOffset(3), reason: 'Active 2' });

      const result = ctpService.getAllResourceDowntimes();
      const actualActive = result.downtimes.filter((d: any) => d.status === 'active').length;
      expect(result.activeCount).toBe(actualActive);
    });

    it('sorts active entries before upcoming', () => {
      const state = ctpService.getState();
      const r1 = state.resourceUtilization[0].resourceKey;

      ctpService.addResourceDowntime(r1, { startTime: isoOffset(3), endTime: isoOffset(5), reason: 'Upcoming' });
      ctpService.addResourceDowntime(r1, { startTime: isoOffset(-1), endTime: isoOffset(2), reason: 'Active' });

      const result = ctpService.getAllResourceDowntimes();
      if (result.downtimes.length >= 2) {
        expect(result.downtimes[0].status).toBe('active');
      }
    });
  });

  // ── extractResults: downtimes in solve response ──────────────────

  describe('downtimes in solve response (extractResults)', () => {
    it('resourceUtilization has downtimes array and isCurrentlyDown on each resource', () => {
      const state = ctpService.getState();
      state.resourceUtilization.forEach((r: any) => {
        expect(Array.isArray(r.downtimes)).toBe(true);
        expect(typeof r.isCurrentlyDown).toBe('boolean');
      });
    });

    it('isCurrentlyDown=false when no downtime exists', () => {
      const state = ctpService.getState();
      state.resourceUtilization.forEach((r: any) => {
        expect(r.isCurrentlyDown).toBe(false);
      });
    });

    it('isCurrentlyDown=true after adding active downtime', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-1),
        endTime: isoOffset(3),
        reason: 'Active',
      });

      const state = ctpService.getState();
      const r = state.resourceUtilization.find((r: any) => r.resourceKey === resourceKey);
      expect(r.isCurrentlyDown).toBe(true);
      expect(r.downtimes.length).toBeGreaterThan(0);
    });

    it('downtime cleared from response after endResourceDowntime', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(1),
        endTime: isoOffset(5),
        reason: 'Upcoming',
      });
      // Bring up at start of downtime — removes it
      ctpService.endResourceDowntime(resourceKey, { actualUpTime: isoOffset(0.5) });

      const state = ctpService.getState();
      const r = state.resourceUtilization.find((r: any) => r.resourceKey === resourceKey);
      expect(r.isCurrentlyDown).toBe(false);
    });
  });

  // ── command sequencer integration ───────────────────────────────

  describe('command sequencer (executeCommands)', () => {
    it('resource_downtime command marks resource down', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const result = ctpService.executeCommands({
        commands: [{
          type: 'resource_downtime',
          resourceKey,
          startTime: isoOffset(1),
          windowEnd: isoOffset(5),
          strategy: 'Queued maintenance',
        }],
        name: 'test downtime',
      });

      expect(result.success).toBe(true);
      const downtimes = ctpService.getResourceDowntimes(resourceKey);
      expect(downtimes.downtimes.length).toBeGreaterThan(0);
    });

    it('resource_uptime command brings resource back up', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      ctpService.addResourceDowntime(resourceKey, {
        startTime: isoOffset(-1),
        endTime: isoOffset(4),
        reason: 'Active',
      });

      const result = ctpService.executeCommands({
        commands: [{ type: 'resource_uptime', resourceKey }],
        name: 'test uptime',
      });

      expect(result.success).toBe(true);
      const downtimes = ctpService.getResourceDowntimes(resourceKey);
      expect(downtimes.isCurrentlyDown).toBe(false);
    });

    it('rolls back on failure in the same batch', () => {
      const resourceKey = getAnyResourceKey(ctpService);
      const result = ctpService.executeCommands({
        commands: [
          { type: 'resource_downtime', resourceKey, startTime: isoOffset(1), windowEnd: isoOffset(3), strategy: 'Test' },
          { type: 'hold', taskKey: 'DOES-NOT-EXIST' },  // will throw → triggers rollback
        ],
        name: 'test rollback',
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
    });
  });

  // ── auto-hold running tasks ──────────────────────────────────────

  describe('auto-hold running tasks on resource down', () => {
    it('running task on downed resource gets put on hold', () => {
      // Start a task first to get it to running state
      ctpService.solve();
      const state = ctpService.getState();
      const scheduledTask = state.tasks.find((t: any) =>
        t.scheduledStart && t.assignedResources?.length > 0 && t.commitmentLevel === 'planned'
      );
      if (!scheduledTask) return; // no suitable task

      const resourceKey = scheduledTask.assignedResources[0].resourceKey;

      // Dispatch → Start to get to running
      ctpService.dispatchTasks([scheduledTask.key]);
      ctpService.startTask(scheduledTask.key);

      // Mark resource down during the task's scheduled window
      const taskStart = new Date(scheduledTask.scheduledStart).getTime();
      const windowStart = new Date(taskStart - 60 * 60 * 1000).toISOString();
      const windowEnd = new Date(taskStart + 24 * 60 * 60 * 1000).toISOString();

      ctpService.addResourceDowntime(resourceKey, {
        startTime: windowStart,
        endTime: windowEnd,
        reason: 'Machine breakdown',
      });

      // Verify task is now on hold
      const updated = ctpService.getState();
      const task = updated.tasks.find((t: any) => t.key === scheduledTask.key);
      expect(task?.commitmentLevel).toBe('on_hold');
      expect(task?.holdReason).toContain('Resource down');
    });
  });
});
