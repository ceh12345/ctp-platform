import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { StateHydratorService } from '../state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';

// Point at the demo-manufacturing tenant in the repo config/ directory
const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'demo-manufacturing';

function createConfigService(): ConfigService {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  return new ConfigService(store);
}

function createHydrator(): StateHydratorService {
  const configService = createConfigService();
  return new StateHydratorService(configService);
}

describe('StateHydratorService', () => {
  let hydrator: StateHydratorService;
  let configService: ConfigService;

  beforeAll(() => {
    configService = createConfigService();
    hydrator = new StateHydratorService(configService);
  });

  // ── Resources ─────────────────────────────────────────────────────

  describe('hydrateResources (via buildLandscape)', () => {
    it('creates 3 resources from demo-manufacturing data', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.resources.size()).toBe(3);
    });

    it('CNC-01 has correct key and name', () => {
      const landscape = hydrator.buildLandscape();
      const cnc01 = landscape.resources.getEntity('CNC-01');
      expect(cnc01).toBeDefined();
      expect(cnc01!.name).toBe('CNC Machine 01');
      expect(cnc01!.key).toBe('CNC-01');
    });

    it('CNC-01 has typedAttributes with machineType and maxSpeed', () => {
      const landscape = hydrator.buildLandscape();
      const cnc01 = landscape.resources.getEntity('CNC-01');
      expect(cnc01).toBeDefined();

      const machineType = cnc01!.typedAttributes.get('machineType');
      expect(machineType).toBeDefined();
      expect(machineType!.value.value).toBe('CNC');

      const maxSpeed = cnc01!.typedAttributes.get('maxSpeed');
      expect(maxSpeed).toBeDefined();
      expect(maxSpeed!.value.value).toBe(1200);
    });
  });

  // ── Tasks ─────────────────────────────────────────────────────────

  describe('hydrateTasks (via buildLandscape)', () => {
    it('creates 29 tasks from demo-manufacturing data', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.tasks.size()).toBe(29);
    });

    it('T-1001-H-MACHINE has window with non-zero startW and endW', () => {
      const landscape = hydrator.buildLandscape();
      const task = landscape.tasks.getEntity('T-1001-H-MACHINE');
      expect(task).toBeDefined();
      expect(task!.window).not.toBeNull();
      expect(task!.window!.startW).toBeGreaterThan(0);
      expect(task!.window!.endW).toBeGreaterThan(task!.window!.startW);
    });

    it('T-1001-H-MACHINE has duration set', () => {
      const landscape = hydrator.buildLandscape();
      const task = landscape.tasks.getEntity('T-1001-H-MACHINE');
      expect(task).toBeDefined();
      expect(task!.duration).not.toBeNull();
      expect(task!.duration!.endW).toBe(14400);
    });

    it('T-1001-H-MACHINE has capacityResources with CNC-01', () => {
      const landscape = hydrator.buildLandscape();
      const task = landscape.tasks.getEntity('T-1001-H-MACHINE');
      expect(task).toBeDefined();
      expect(task!.capacityResources).not.toBeNull();
      expect(task!.capacityResources!.length).toBe(1);

      const first = task!.capacityResources![0];
      expect(first).toBeDefined();
      expect(first.resource).toBe('CNC-01');
      expect(first.isPrimary).toBe(true);
    });

    it('T-1001-H-MACHINE has typedAttributes with productType and batchSize', () => {
      const landscape = hydrator.buildLandscape();
      const task = landscape.tasks.getEntity('T-1001-H-MACHINE');
      expect(task).toBeDefined();

      const productType = task!.typedAttributes.get('productType');
      expect(productType).toBeDefined();
      expect(productType!.value.value).toBe('Widget-A');

      const batchSize = task!.typedAttributes.get('batchSize');
      expect(batchSize).toBeDefined();
      expect(batchSize!.value.value).toBe(500);
    });

    it('T-1001-H-MACHINE has outputProductKey and inputMaterials', () => {
      const landscape = hydrator.buildLandscape();
      const task = landscape.tasks.getEntity('T-1001-H-MACHINE');
      expect(task).toBeDefined();
      expect(task!.outputProductKey).toBe('PROD-HOUSING');
      expect(task!.outputQty).toBe(500);
      expect(task!.outputScrapRate).toBe(0.05);
      expect(task!.inputMaterials).not.toBeNull();
      expect(task!.inputMaterials!.length).toBe(1);
      expect(task!.inputMaterials![0].productKey).toBe('MAT-AL6061');
      expect(task!.inputMaterials![0].requiredQty).toBe(1250);
    });

    it('T-1001-ASSEMBLE has linkId referencing WO-1001', () => {
      const landscape = hydrator.buildLandscape();
      const task = landscape.tasks.getEntity('T-1001-ASSEMBLE');
      expect(task).toBeDefined();
      expect(task!.linkId).toBeDefined();
      expect(task!.linkId!.name).toBe('WO-1001');
      expect(task!.process).toBe('assembly');
    });
  });

  // ── Calendars ─────────────────────────────────────────────────────

  describe('hydrateCalendars (via buildLandscape)', () => {
    it('CNC-01 has original availability with intervals', () => {
      const landscape = hydrator.buildLandscape();
      const cnc01 = landscape.resources.getEntity('CNC-01');
      expect(cnc01).toBeDefined();
      expect(cnc01!.original).not.toBeNull();
      expect(cnc01!.original!.head).not.toBeNull();
    });

    it('CNC-01 has available matrix with staticOriginal set', () => {
      const landscape = hydrator.buildLandscape();
      const cnc01 = landscape.resources.getEntity('CNC-01');
      expect(cnc01).toBeDefined();
      expect(cnc01!.available.staticOriginal).not.toBeNull();
    });

    it('CNC-01 has assignments initialized', () => {
      const landscape = hydrator.buildLandscape();
      const cnc01 = landscape.resources.getEntity('CNC-01');
      expect(cnc01).toBeDefined();
      expect(cnc01!.assignments).not.toBeNull();
    });
  });

  // ── State Changes ─────────────────────────────────────────────────

  describe('hydrateStateChanges (via buildLandscape)', () => {
    it('creates 2 state changes', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.stateChanges.size()).toBe(2);
    });

    it('state changes have correct durations', () => {
      const landscape = hydrator.buildLandscape();
      let found1800 = false;
      let found900 = false;
      landscape.stateChanges.forEach((sc) => {
        if (sc.duration === 1800) found1800 = true;
        if (sc.duration === 900) found900 = true;
      });
      expect(found1800).toBe(true);
      expect(found900).toBe(true);
    });
  });

  // ── buildLandscape (integration) ──────────────────────────────────

  describe('buildLandscape (integration)', () => {
    it('builds a complete landscape with correct counts', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.resources.size()).toBe(3);
      expect(landscape.tasks.size()).toBe(29);
      expect(landscape.stateChanges.size()).toBe(2);
    });

    it('horizon has non-zero startW and endW', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.horizon.startW).toBeGreaterThan(0);
      expect(landscape.horizon.endW).toBeGreaterThan(landscape.horizon.startW);
    });

    it('appSettings are loaded from config', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.appSettings).not.toBeNull();
      expect(landscape.appSettings!.scheduleDirection).toBe(1);
      expect(landscape.appSettings!.tasksPerLoop).toBe(50);
    });
  });

  // ── Window defaults + scheduledStart/End hydration ────────────────
  // The default lives in the engine layer (this hydrator), not in mapping config.
  // Mapping translates source fields → CTP fields; the engine layer completes
  // the landscape by defaulting absent windowStart/End to the tenant horizon.

  describe('window defaults + scheduled fields', () => {
    function basePayload(taskOverrides: any) {
      return {
        resources: [{ key: 'MACHINE-1', name: 'M1', type: 'MACHINE', class: 'REUSABLE' }],
        tasks: [{
          key: 'TASK-1', name: 'Task 1', type: 'PROCESS',
          durationSeconds: 3600, durationQty: 1, durationType: 0,
          capacityResources: [{ resource: 'MACHINE-1', isPrimary: true, qty: 1, mode: 'ON' }],
          ...taskOverrides,
        }],
        calendars: [], stateChanges: [], products: [], orders: [], jobs: [],
        materials: [], processes: [], cadences: [], uomConversions: null,
      };
    }

    it('windowStart/End from source pass through unchanged', () => {
      const landscape = hydrator.buildLandscape(basePayload({
        windowStart: '2026-02-10T00:00:00Z',
        windowEnd: '2026-02-15T00:00:00Z',
      }));
      const task = landscape.tasks.getEntity('TASK-1')!;
      expect(task.window).not.toBeNull();
      // 5 days = 432_000 seconds — verify via delta, not absolute (internal time base)
      expect(task.window!.endW - task.window!.startW).toBe(5 * 24 * 3600);
      // And the window is NOT the horizon default
      expect(task.window!.startW).not.toBe(landscape.horizon.startW);
    });

    it('absent windowStart/End defaults to horizon bounds', () => {
      const landscape = hydrator.buildLandscape(basePayload({}));
      const task = landscape.tasks.getEntity('TASK-1')!;
      expect(task.window).not.toBeNull();
      expect(task.window!.startW).toBe(landscape.horizon.startW);
      expect(task.window!.endW).toBe(landscape.horizon.endW);
    });

    it('null windowStart/End defaults to horizon bounds (same as absent)', () => {
      const landscape = hydrator.buildLandscape(basePayload({
        windowStart: null,
        windowEnd: null,
      }));
      const task = landscape.tasks.getEntity('TASK-1')!;
      expect(task.window!.startW).toBe(landscape.horizon.startW);
      expect(task.window!.endW).toBe(landscape.horizon.endW);
    });

    it('scheduledStart/End populated AND pinned=true → task.scheduled is set', () => {
      const landscape = hydrator.buildLandscape(basePayload({
        scheduledStart: '2026-03-01T08:00:00Z',
        scheduledEnd: '2026-03-01T16:00:00Z',
        pinned: true,
      }));
      const task = landscape.tasks.getEntity('TASK-1')!;
      expect(task.scheduled).not.toBeNull();
      expect(task.pinned).toBe(true);
      // 8h delta verifies dates parsed and ordered correctly
      expect(task.scheduled!.endW - task.scheduled!.startW).toBe(8 * 3600);
    });

    it('scheduledStart/End populated but pinned=false → task.scheduled stays null', () => {
      const landscape = hydrator.buildLandscape(basePayload({
        scheduledStart: '2026-03-01T08:00:00Z',
        scheduledEnd: '2026-03-01T16:00:00Z',
        // pinned omitted → defaults false
      }));
      const task = landscape.tasks.getEntity('TASK-1')!;
      expect(task.scheduled).toBeNull();
      expect(task.pinned).toBe(false);
    });

    it('absent scheduledStart/End → task.scheduled stays null', () => {
      const landscape = hydrator.buildLandscape(basePayload({}));
      const task = landscape.tasks.getEntity('TASK-1')!;
      expect(task.scheduled).toBeNull();
    });
  });

  // ── toString rule flag (mapping engine) ─────────────────────────
  // Verifies the rule.toString flag coerces numeric source values to
  // strings, so a tenant whose source FK is an integer (e.g. Genius's
  // Id field) can map cleanly into CTP's string-keyed entities.

  describe('toString rule coercion (engine indirect via mapping output → hydrator)', () => {
    // We test the mapping engine's output via direct unit, but the
    // contract is: numeric source + toString:true produces string.
    it('mapping engine: from + toString coerces number to string', async () => {
      const { MappingEngine } = await import('../../integration/mapping-engine');
      const engine = new MappingEngine();
      const profile = {
        version: '1.0',
        resources: { mappings: {
          key:  { from: 'Id', toString: true },
          name: { from: 'Description' },
        }},
      } as any;
      const result = engine.transform({
        resources: [{ Id: 42, Description: 'Test' }],
        tasks: [], orders: [], calendars: [], stateChanges: [],
        products: [], materials: [], processes: [], cadences: [], uomConversions: null,
      } as any, profile);
      expect((result.payload.resources[0] as any).key).toBe('42');
      expect(typeof (result.payload.resources[0] as any).key).toBe('string');
    });

    it('mapping engine: from without toString preserves number type', async () => {
      const { MappingEngine } = await import('../../integration/mapping-engine');
      const engine = new MappingEngine();
      const profile = {
        version: '1.0',
        resources: { mappings: {
          key:        { from: 'Description' },
          someNumber: { from: 'Id' },
        }},
      } as any;
      const result = engine.transform({
        resources: [{ Id: 42, Description: 'Test' }],
        tasks: [], orders: [], calendars: [], stateChanges: [],
        products: [], materials: [], processes: [], cadences: [], uomConversions: null,
      } as any, profile);
      expect((result.payload.resources[0] as any).someNumber).toBe(42);
      expect(typeof (result.payload.resources[0] as any).someNumber).toBe('number');
    });

    it('mapping engine: capacityResources stringifies numeric MachineId', async () => {
      const { MappingEngine } = await import('../../integration/mapping-engine');
      const engine = new MappingEngine();
      const profile = {
        version: '1.0',
        tasks: {
          key: { from: ['JobCode', 'OperationCode'], sep: '-' },
          mappings: { name: { from: 'OperationCode' } },
          capacityResources: { from: 'MachineId' },
        },
      } as any;
      const result = engine.transform({
        resources: [],
        tasks: [{ JobCode: 'J1', OperationCode: 'OP1', MachineId: 99 }],
        orders: [], calendars: [], stateChanges: [],
        products: [], materials: [], processes: [], cadences: [], uomConversions: null,
      } as any, profile);
      const task = result.payload.tasks[0] as any;
      expect(task.capacityResources[0].resource).toBe('99');
      expect(typeof task.capacityResources[0].resource).toBe('string');
    });
  });
});
