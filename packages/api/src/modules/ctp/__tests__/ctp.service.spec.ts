import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { CTPService } from '../ctp.service';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';

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
  const ctpService = new CTPService(stateService, configService);
  return { ctpService, stateService, configService };
}

describe('CTPService', () => {
  let ctpService: CTPService;

  beforeEach(() => {
    const services = createServices();
    ctpService = services.ctpService;
  });

  // ── Solve all tasks ──────────────────────────────────────────────

  it('solve all tasks (no filter)', () => {
    const result = ctpService.solve();
    expect(result.status).toBe('ok');
    expect(result.summary.totalTasks).toBe(5);
    expect(result.summary.includedTasks).toBe(5);
    expect(result.summary.skippedTasks).toBe(0);
    expect(result.summary.scheduledTasks).toBeGreaterThan(0);
    expect(result.tasks).toHaveLength(5);
    result.tasks.forEach((t) => {
      expect(t.included).toBe(true);
    });
  });

  // ── Solve specific tasks by key ──────────────────────────────────

  it('solve specific tasks by key', () => {
    const result = ctpService.solve({ taskKeys: ['OP-001', 'OP-003'] });
    expect(result.summary.includedTasks).toBe(2);
    expect(result.summary.skippedTasks).toBe(3);

    const op001 = result.tasks.find((t) => t.key === 'OP-001');
    expect(op001).toBeDefined();
    expect(op001!.included).toBe(true);

    const op002 = result.tasks.find((t) => t.key === 'OP-002');
    expect(op002).toBeDefined();
    expect(op002!.included).toBe(false);
    expect(op002!.feasible).toBe(false);
  });

  // ── Solve filtered by attribute (equals) ─────────────────────────

  it('solve filtered by attribute (equals)', () => {
    const result = ctpService.solve({
      filter: {
        attribute: 'productType',
        value: 'Widget-A',
        operator: 'equals',
      },
    });
    // OP-001 and OP-003 have productType=Widget-A
    expect(result.summary.includedTasks).toBe(2);
    expect(result.summary.skippedTasks).toBe(3);

    const included = result.tasks.filter((t) => t.included);
    included.forEach((t) => {
      const productType = t.typedAttributes.find(
        (a: any) => a.name === 'productType',
      );
      expect(productType?.value.value).toBe('Widget-A');
    });
  });

  // ── Solve filtered by attribute (in) ─────────────────────────────

  it('solve filtered by attribute (in)', () => {
    const result = ctpService.solve({
      filter: {
        attribute: 'priority',
        value: ['HIGH', 'CRITICAL'],
        operator: 'in',
      },
    });
    // OP-001=HIGH, OP-003=CRITICAL, OP-005=HIGH → 3 tasks
    const included = result.tasks.filter((t) => t.included);
    expect(included.length).toBe(3);

    included.forEach((t) => {
      const priority = t.typedAttributes.find(
        (a: any) => a.name === 'priority',
      );
      expect(['HIGH', 'CRITICAL']).toContain(priority?.value.value);
    });
  });

  // ── Resource utilization populated ───────────────────────────────

  it('resource utilization populated', () => {
    const result = ctpService.solve();
    expect(result.resourceUtilization).toHaveLength(3);
    result.resourceUtilization.forEach((r) => {
      expect(r.totalAvailable).toBeGreaterThan(0);
      expect(r.utilization).toBeGreaterThanOrEqual(0);
      expect(r.utilization).toBeLessThanOrEqual(100);
    });
  });

  // ── Typed attributes preserved ───────────────────────────────────

  it('typed attributes preserved in results', () => {
    const result = ctpService.solve();
    const op001 = result.tasks.find((t) => t.key === 'OP-001');
    expect(op001).toBeDefined();
    expect(op001!.typedAttributes.length).toBeGreaterThan(0);

    const productType = op001!.typedAttributes.find(
      (a: any) => a.name === 'productType',
    );
    expect(productType).toBeDefined();
  });

  // ── Cached results ───────────────────────────────────────────────

  it('cached results', () => {
    expect(ctpService.getLastResult()).toBeNull();
    ctpService.solve();
    const cached = ctpService.getLastResult();
    expect(cached).not.toBeNull();
    expect(cached!.status).toBe('ok');
  });

  // ── Makespan positive when tasks scheduled ───────────────────────

  it('makespan positive when tasks scheduled', () => {
    const result = ctpService.solve();
    if (result.summary.scheduledTasks > 0) {
      expect(result.summary.makespan).toBeGreaterThan(0);
    }
  });

  // ── Empty taskKeys returns empty solve ───────────────────────────

  it('empty taskKeys returns empty solve', () => {
    const result = ctpService.solve({ taskKeys: [] });
    expect(result.summary.includedTasks).toBe(0);
    expect(result.summary.scheduledTasks).toBe(0);
    expect(result.summary.skippedTasks).toBe(5);
  });
});
