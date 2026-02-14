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
    it('creates 25 tasks from demo-manufacturing data', () => {
      const landscape = hydrator.buildLandscape();
      expect(landscape.tasks.size()).toBe(25);
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
      expect(task!.process).toBe('WO-1001');
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
      expect(landscape.tasks.size()).toBe(25);
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
});
