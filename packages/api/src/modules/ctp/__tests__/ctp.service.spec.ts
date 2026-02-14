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
    // 25 data tasks submitted; scheduler may add state-change tasks to landscape
    expect(result.summary.includedTasks).toBe(25);
    expect(result.summary.totalTasks).toBeGreaterThanOrEqual(25);
    expect(result.summary.scheduledTasks).toBeGreaterThan(0);
    expect(result.tasks.length).toBe(result.summary.totalTasks);
  });

  // ── Solve specific tasks by key ──────────────────────────────────

  it('solve specific tasks by key', () => {
    const result = ctpService.solve({ taskKeys: ['T-1001-H-MACHINE', 'T-1001-ASSEMBLE'] });
    expect(result.summary.includedTasks).toBe(2);
    expect(result.summary.skippedTasks).toBe(23);

    const machineTask = result.tasks.find((t) => t.key === 'T-1001-H-MACHINE');
    expect(machineTask).toBeDefined();
    expect(machineTask!.included).toBe(true);

    const bracketTask = result.tasks.find((t) => t.key === 'T-1002-B-MACHINE');
    expect(bracketTask).toBeDefined();
    expect(bracketTask!.included).toBe(false);
    expect(bracketTask!.feasible).toBe(false);
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
    // Tasks with productType=Widget-A typed attribute
    const included = result.tasks.filter((t) => t.included);
    expect(included.length).toBeGreaterThan(0);

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
        attribute: 'productType',
        value: ['Widget-A', 'Widget-B'],
        operator: 'in',
      },
    });
    const included = result.tasks.filter((t) => t.included);
    expect(included.length).toBeGreaterThan(0);

    included.forEach((t) => {
      const productType = t.typedAttributes.find(
        (a: any) => a.name === 'productType',
      );
      expect(['Widget-A', 'Widget-B']).toContain(productType?.value.value);
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
    const task = result.tasks.find((t) => t.key === 'T-1001-H-MACHINE');
    expect(task).toBeDefined();
    expect(task!.typedAttributes.length).toBeGreaterThan(0);

    const productType = task!.typedAttributes.find(
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
    expect(result.summary.skippedTasks).toBe(result.summary.totalTasks);
  });

  // ── New fields: orderRef, outputProductKey, process ──────────────

  it('enriched task fields populated', () => {
    const result = ctpService.solve();
    const assembleTask = result.tasks.find((t) => t.key === 'T-1001-ASSEMBLE');
    expect(assembleTask).toBeDefined();
    expect(assembleTask!.orderRef).toBe('WO-1001');
    expect(assembleTask!.outputProductKey).toBe('PROD-WA');
    expect(assembleTask!.outputQty).toBe(500);
    expect(assembleTask!.outputScrapRate).toBe(0.03);
    expect(assembleTask!.process).toBe('WO-1001');
    expect(assembleTask!.inputMaterials.length).toBe(3);
  });

  // ── Orders array populated ────────────────────────────────────────

  it('orders array populated with fill rates', () => {
    const result = ctpService.solve();
    expect(result.orders).toBeDefined();
    expect(result.orders.length).toBe(6);
    result.orders.forEach((o: any) => {
      expect(o.orderKey).toBeDefined();
      expect(o.productKey).toBeDefined();
      expect(o.demandQty).toBeGreaterThan(0);
      expect(o.fillRate).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Materials array populated ─────────────────────────────────────

  it('materials array populated with consumption', () => {
    const result = ctpService.solve();
    expect(result.materials).toBeDefined();
    expect(result.materials.length).toBe(6);
    result.materials.forEach((m: any) => {
      expect(m.materialKey).toBeDefined();
      expect(m.onHand).toBeGreaterThanOrEqual(0);
      expect(typeof m.consumed).toBe('number');
      expect(typeof m.remaining).toBe('number');
    });
  });
});
