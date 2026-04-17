/**
 * E2E test: Data Adapter Layer Phase 2 — RestAdapter + MappingEngine
 *
 * Requires the mock-genius server running on localhost:8080 (stafford-clean scenario).
 * Run: cd tools/mock-genius && npm run dev
 *
 * Tests the full path: RestAdapter.fetchRawData() → MappingEngine.transform()
 * → StateHydratorService.buildLandscape(payload) → SchedulingLandscape
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { AdapterFactory } from '../adapter-factory';
import { MappingEngine } from '../mapping-engine';
import { SyncService } from '../sync.service';
import { SchedulingLandscape, CTPWipStateConstants } from '@ctp/engine';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID   = 'stafford-engineering-test';

function createServices() {
  const store          = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService  = new ConfigService(store);
  const hydrator       = new StateHydratorService(configService);
  const mappingEngine  = new MappingEngine();
  const adapterFactory = new AdapterFactory(configService);
  const syncService    = new SyncService(adapterFactory, mappingEngine, configService);
  const stateService   = new StateService(hydrator, configService, syncService);
  return { stateService, configService };
}

// ── Skip all tests if mock-genius is unreachable ──────────────────────────────

let mockGeniusAvailable = false;

beforeAll(async () => {
  try {
    const res = await fetch('http://localhost:8080/_mock/health', { signal: AbortSignal.timeout(2000) });
    mockGeniusAvailable = res.ok;
  } catch {
    mockGeniusAvailable = false;
  }
});

function skipIfUnavailable() {
  if (!mockGeniusAvailable) {
    console.warn('  ⚠ mock-genius not running — skipping e2e tests');
  }
  return mockGeniusAvailable;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncFromAdapter e2e — stafford-engineering-test', () => {
  let landscape: SchedulingLandscape;

  beforeAll(async () => {
    if (!skipIfUnavailable()) return;
    const { stateService } = createServices();
    await stateService.syncFromAdapter();
    landscape = stateService.getLandscape()!;
  });

  // ── Record counts ─────────────────────────────────────────────────────────

  it('landscape has 28 resources from mock-genius', () => {
    if (!mockGeniusAvailable) return;
    expect(landscape.resources.size()).toBe(28);
  });

  it('landscape has 30 tasks from mock-genius', () => {
    if (!mockGeniusAvailable) return;
    expect(landscape.tasks.size()).toBe(30);
  });

  // ── Resource field mapping ────────────────────────────────────────────────

  it('resource keys use Genius MachineCode format', () => {
    if (!mockGeniusAvailable) return;
    const r = landscape.resources.getEntity('CNC-LATHE-01');
    expect(r).toBeDefined();
    expect(r!.key).toBe('CNC-LATHE-01');
  });

  it('resource name is mapped from MachineName', () => {
    if (!mockGeniusAvailable) return;
    const r = landscape.resources.getEntity('CNC-LATHE-01');
    expect(r!.name).toBe('Okuma LB3000 CNC Lathe');
  });

  it('person resource (IsLabour=true) has class LABOUR', () => {
    if (!mockGeniusAvailable) return;
    const r = landscape.resources.getEntity('MACH-JAMES');
    expect(r).toBeDefined();
    expect(r!.class).toBe('LABOUR');
  });

  it('machine resource (IsLabour=false) has class REUSABLE', () => {
    if (!mockGeniusAvailable) return;
    const r = landscape.resources.getEntity('SAW-01');
    expect(r).toBeDefined();
    expect(r!.class).toBe('REUSABLE');
  });

  // ── Task field mapping ────────────────────────────────────────────────────

  it('task keys use JobCode-OperationCode format', () => {
    if (!mockGeniusAvailable) return;
    const t = landscape.tasks.getEntity('PV-001-CUT');
    expect(t).toBeDefined();
  });

  it('task durationSeconds = CycleTime × 3600', () => {
    if (!mockGeniusAvailable) return;
    // PV-001-CUT has CycleTime 1.5h → 5400s
    const t = landscape.tasks.getEntity('PV-001-CUT');
    expect(t!.duration?.duration()).toBe(5400);
  });

  it('completed task has wipState COMPLETED', () => {
    if (!mockGeniusAvailable) return;
    const t = landscape.tasks.getEntity('PV-001-CUT');
    expect(t!.wipstate).toBe(CTPWipStateConstants.COMPLETED);
  });

  it('task has capacityResource from MachineCode', () => {
    if (!mockGeniusAvailable) return;
    const t = landscape.tasks.getEntity('PV-001-CUT');
    expect(t!.capacityResources).toBeDefined();
    expect(t!.capacityResources!.length).toBeGreaterThan(0);
    expect(t!.capacityResources![0].resource).toBeDefined();
  });

  // ── Chain linkId ──────────────────────────────────────────────────────────

  it('PV-001 chain has 10 tasks', () => {
    if (!mockGeniusAvailable) return;
    const chainTasks: any[] = [];
    landscape.tasks.forEach((t: any) => {
      if (t.linkId?.name === 'PV-001') chainTasks.push(t);
    });
    expect(chainTasks).toHaveLength(10);
  });

  it('first task in PV-001 chain has linkId type START', () => {
    if (!mockGeniusAvailable) return;
    const t = landscape.tasks.getEntity('PV-001-CUT');
    expect(t!.linkId?.type).toBe('START');
  });

  it('second task in PV-001 chain has prevLink pointing to PV-001-CUT', () => {
    if (!mockGeniusAvailable) return;
    const t = landscape.tasks.getEntity('PV-001-FLANGE');
    expect(t!.linkId?.prevLink).toBe('PV-001-CUT');
  });

  // ── Orders ────────────────────────────────────────────────────────────────

  it('orders are loaded into landscape', () => {
    if (!mockGeniusAvailable) return;
    // stafford-clean has 15 sales orders
    expect(landscape.orders.size()).toBe(15);
  });

  it('RUSH strategy order maps to priority 10', () => {
    if (!mockGeniusAvailable) return;
    // Find a RUSH order — in stafford-clean PV-009 is RUSH
    let rushOrder: any = null;
    landscape.orders.forEach((o: any) => {
      if (o.priority === 10) rushOrder = o;
    });
    expect(rushOrder).not.toBeNull();
  });

  // ── Solve on REST landscape ───────────────────────────────────────────────

  it('solve runs without error on the REST-hydrated landscape', async () => {
    if (!mockGeniusAvailable) return;
    const { stateService, configService } = createServices();
    await stateService.syncFromAdapter();

    // Import CTPService inline to avoid circular test dependency
    const { CTPService } = await import('../../ctp/ctp.service');
    const { StrategyConfigService } = await import('../../../config/strategy-config.service');
    const { ScheduleConfigurationService } = await import('../../../config/schedule-configuration.service');
    const { LoggerService } = await import('../../../logging/logger.service');

    const strategyConfigService = new StrategyConfigService(configService);
    const schedConfigService    = new ScheduleConfigurationService(configService);
    const logger                = new LoggerService();
    const ctpService            = new CTPService(stateService, configService, strategyConfigService, logger, schedConfigService);

    const result = await ctpService.solve({ preserveLandscape: true });
    expect(result.status).toBe('ok');
    expect(result.summary.totalTasks).toBe(30);
  });
});
