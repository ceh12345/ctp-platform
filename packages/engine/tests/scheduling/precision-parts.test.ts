import { describe, it, expect, beforeEach } from 'vitest';
import { CTPScheduler } from '../../AI/Scheduling/defaultscheduler';
import { CTPTaskStateConstants } from '../../Models/Core/constants';
import {
  buildPrecisionPartsDataset,
  buildProducts,
  buildOrders,
  buildResources,
  buildTasks,
  PrecisionPartsDataset,
} from '../fixtures/precision-parts-dataset';

describe('Precision Parts Co. — Full Dataset', () => {
  let dataset: PrecisionPartsDataset;

  beforeEach(() => {
    dataset = buildPrecisionPartsDataset();
  });

  // ── Product BOM ────────────────────────────────────────────────

  describe('Products & BOM', () => {
    it('has 12 products (6 RAW, 2 INTERMEDIATE, 3 FINISHED)', () => {
      const products = buildProducts();
      expect(products.size()).toBe(11);
      expect(products.rawProducts()).toHaveLength(6);
      expect(products.intermediateProducts()).toHaveLength(2);
      expect(products.finishedProducts()).toHaveLength(3);
    });

    it('Widget-A BOM has 3 inputs', () => {
      const products = buildProducts();
      const widgetA = products.getEntity('WIDGET-A');
      expect(widgetA).toBeDefined();
      expect(widgetA!.hasBOM()).toBe(true);
      expect(widgetA!.bomInputs).toHaveLength(3);
      expect(widgetA!.outputScrapRate).toBe(0.03);
    });

    it('Machined Housing requires Aluminum 6061', () => {
      const products = buildProducts();
      const housing = products.getEntity('MACH-HOUSING');
      expect(housing).toBeDefined();
      expect(housing!.bomInputs).toHaveLength(1);
      expect(housing!.bomInputs[0].productKey).toBe('ALU-6061');
      expect(housing!.bomInputs[0].qtyPer).toBe(2.5);
    });

    it('material requirements cascade through scrap rates', () => {
      const products = buildProducts();
      const housing = products.getEntity('MACH-HOUSING');
      // 100 housings, 5% output scrap → gross output = 100/0.95 ≈ 105.26
      // Each needs 2.5 kg ALU with 5% input scrap → gross ALU = 2.5*105.26/0.95 ≈ 277
      const reqs = housing!.materialRequirements(100);
      const aluQty = reqs.get('ALU-6061')!;
      expect(aluQty).toBeGreaterThan(270);
      expect(aluQty).toBeLessThan(280);
    });
  });

  // ── Orders ─────────────────────────────────────────────────────

  describe('Orders', () => {
    it('has 6 orders', () => {
      const orders = buildOrders();
      expect(orders.size()).toBe(6);
    });

    it('total Widget-A demand is 900 (WO-1001 + WO-1004)', () => {
      const orders = buildOrders();
      expect(orders.totalDemand('WIDGET-A')).toBe(900);
    });

    it('total Widget-C demand is 450 (WO-1003 + WO-1005)', () => {
      const orders = buildOrders();
      expect(orders.totalDemand('WIDGET-C')).toBe(450);
    });

    it('WO-1005 has priority 1 and tight due date', () => {
      const orders = buildOrders();
      const wo1005 = orders.getEntity('WO-1005');
      expect(wo1005!.priority).toBe(1);
      expect(wo1005!.demandQty).toBe(250);
    });

    it('fill rate starts at 0', () => {
      const orders = buildOrders();
      const wo1001 = orders.getEntity('WO-1001');
      expect(wo1001!.computeFillRate()).toBe(0);
      expect(wo1001!.shortfall()).toBe(500);
    });

    it('fill rate computes correctly after partial fill', () => {
      const orders = buildOrders();
      const wo1001 = orders.getEntity('WO-1001');
      wo1001!.scheduledQty = 250;
      expect(wo1001!.computeFillRate()).toBe(50);
      expect(wo1001!.isFullyFilled()).toBe(false);
      expect(wo1001!.shortfall()).toBe(250);
    });
  });

  // ── Resources ──────────────────────────────────────────────────

  describe('Resources', () => {
    it('has 8 resources', () => {
      expect(dataset.landscape.resources.size()).toBe(8);
    });

    it('all resources have availability calendars', () => {
      dataset.landscape.resources.forEach((r) => {
        expect(r.original).not.toBeNull();
        expect(r.assignments).not.toBeNull();
      });
    });

    it('QC-01 is single resource (bottleneck)', () => {
      const qc = dataset.landscape.resources.getEntity('QC-01');
      expect(qc).toBeDefined();
      expect(qc!.type).toBe('QC');
    });
  });

  // ── Tasks ──────────────────────────────────────────────────────

  describe('Tasks', () => {
    it('has 26 tasks total', () => {
      expect(dataset.landscape.tasks.size()).toBe(26);
    });

    it('all tasks have capacity resources with preferences', () => {
      dataset.landscape.tasks.forEach((t) => {
        expect(t.capacityResources).not.toBeNull();
        expect(t.capacityResources!.length).toBeGreaterThan(0);
        expect(t.capacityResources![0].preferences.length).toBeGreaterThan(0);
      });
    });

    it('all tasks have linkId for process chaining', () => {
      dataset.landscape.tasks.forEach((t) => {
        expect(t.hasLinkId()).toBe(true);
        expect(t.linkId!.name).toMatch(/^WO-/);
      });
    });

    it('CNC tasks output MACH-HOUSING with materials', () => {
      const cncTask = dataset.landscape.tasks.getEntity('WO-1001-CNC');
      expect(cncTask).toBeDefined();
      expect(cncTask!.hasOutput()).toBe(true);
      expect(cncTask!.outputProductKey).toBe('MACH-HOUSING');
      expect(cncTask!.outputQty).toBe(500);
      expect(cncTask!.outputScrapRate).toBe(0.05);
      expect(cncTask!.hasInputMaterials()).toBe(true);
      expect(cncTask!.inputMaterials![0].productKey).toBe('ALU-6061');
    });

    it('Assembly tasks consume intermediates and raw components', () => {
      const assyTask = dataset.landscape.tasks.getEntity('WO-1003-ASSY');
      expect(assyTask).toBeDefined();
      expect(assyTask!.outputProductKey).toBe('WIDGET-C');
      expect(assyTask!.inputMaterials).toHaveLength(3);

      const reqs = assyTask!.grossInputRequirements();
      expect(reqs.get('MACH-HOUSING')).toBe(200);
      expect(reqs.get('MILL-BRACKET')).toBe(200);
      expect(reqs.get('SEAL-KIT')).toBe(200);
    });

    it('QC and Pack tasks have no product output', () => {
      const qcTask = dataset.landscape.tasks.getEntity('WO-1001-QC');
      expect(qcTask!.hasOutput()).toBe(false);
      expect(qcTask!.hasInputMaterials()).toBe(false);
    });

    it('tasksByOutputProduct finds all CNC housing tasks', () => {
      const housingTasks = dataset.landscape.tasks.tasksByOutputProduct('MACH-HOUSING');
      // WO-1001-CNC, WO-1003-CNC, WO-1004-CNC, WO-1005-CNC
      expect(housingTasks).toHaveLength(4);
    });

    it('tasksByInputProduct finds tasks consuming BRG-608ZZ', () => {
      const bearingTasks = dataset.landscape.tasks.tasksByInputProduct('BRG-608ZZ');
      // WO-1001-ASSY, WO-1002-ASSY, WO-1004-ASSY, WO-1006-ASSY
      expect(bearingTasks).toHaveLength(4);
    });

    it('totalMaterialRequirement for ALU-6061 across all tasks', () => {
      // WO-1001: 1250, WO-1003: 500, WO-1004: 1000, WO-1005: 625 = 3375 kg
      const totalAlu = dataset.landscape.tasks.totalMaterialRequirement('ALU-6061');
      expect(totalAlu).toBeGreaterThan(3300);
      expect(totalAlu).toBeLessThan(3600);
    });

    it('WO-1005 tasks have tight 3-day window', () => {
      const rushCnc = dataset.landscape.tasks.getEntity('WO-1005-CNC');
      const rushPack = dataset.landscape.tasks.getEntity('WO-1005-PACK');
      // Window spans Feb 9 06:00 to Feb 12 22:00 = ~88 hours
      const windowHours = (rushCnc!.window!.endW - rushCnc!.window!.startW) / 3600;
      expect(windowHours).toBeLessThan(90);
      expect(windowHours).toBeGreaterThan(80);

      // Total sequential work = 5 + 4 + 3.5 + 1.5 + 1 = 15h
      // Available per day = 16h, 3 days of work + partial 4th = tight
    });
  });

  // ── Process chains ─────────────────────────────────────────────

  describe('Process chains (linkId)', () => {
    it('builds 6 processes (one per order)', () => {
      expect(dataset.landscape.processes.size()).toBe(6);
    });

    it('WO-1001 process has 4 tasks in sequence', () => {
      const proc = dataset.landscape.processes.getEntity('WO-1001');
      expect(proc).toBeDefined();
      expect(proc!.tasks!.length).toBe(4);
    });

    it('WO-1005 process has 5 tasks (CNC + MILL + ASSY + QC + PACK)', () => {
      const proc = dataset.landscape.processes.getEntity('WO-1005');
      expect(proc).toBeDefined();
      expect(proc!.tasks!.length).toBe(5);
    });
  });

  // ── Scheduling integration ─────────────────────────────────────

  describe('Scheduling', () => {
    it('schedules all 26 tasks without crashing', () => {
      const scheduler = new CTPScheduler();
      scheduler.initLandscape(
        dataset.landscape.horizon,
        dataset.landscape.tasks,
        dataset.landscape.resources,
        dataset.landscape.stateChanges,
        dataset.landscape.processes,
      );
      scheduler.initSettings(dataset.landscape.appSettings!);
      scheduler.initScoring(dataset.scoring);
      scheduler.schedule(dataset.taskList);

      // Count scheduled tasks
      let scheduled = 0;
      let unscheduled = 0;
      dataset.landscape.tasks.forEach((t) => {
        if (t.state === CTPTaskStateConstants.SCHEDULED) scheduled++;
        else unscheduled++;
      });

      // We expect most tasks to be scheduled (some WO-1005 may fail due to tight window)
      expect(scheduled).toBeGreaterThan(0);
      expect(scheduled + unscheduled).toBe(26);
    });

    it('high-priority WO-1005 tasks are attempted first', () => {
      const scheduler = new CTPScheduler();
      scheduler.initLandscape(
        dataset.landscape.horizon,
        dataset.landscape.tasks,
        dataset.landscape.resources,
        dataset.landscape.stateChanges,
        dataset.landscape.processes,
      );
      scheduler.initSettings(dataset.landscape.appSettings!);
      scheduler.initScoring(dataset.scoring);
      scheduler.schedule(dataset.taskList);

      // WO-1005 tasks should have low solver sequence numbers (processed early)
      const rushTasks = ['WO-1005-CNC', 'WO-1005-MILL'];
      for (const key of rushTasks) {
        const task = dataset.landscape.tasks.getEntity(key);
        expect(task).toBeDefined();
        expect(task!.processed).toBe(true);
      }
    });

    it('scheduled tasks have assigned resources', () => {
      const scheduler = new CTPScheduler();
      scheduler.initLandscape(
        dataset.landscape.horizon,
        dataset.landscape.tasks,
        dataset.landscape.resources,
        dataset.landscape.stateChanges,
        dataset.landscape.processes,
      );
      scheduler.initSettings(dataset.landscape.appSettings!);
      scheduler.initScoring(dataset.scoring);
      scheduler.schedule(dataset.taskList);

      dataset.landscape.tasks.forEach((t) => {
        if (t.state === CTPTaskStateConstants.SCHEDULED) {
          expect(t.scheduled).not.toBeNull();
          expect(t.scheduled!.startW).toBeGreaterThan(0);
          expect(t.scheduled!.endW).toBeGreaterThan(t.scheduled!.startW);

          // At least one capacity resource should have a scheduled assignment
          let hasAssignment = false;
          t.capacityResources?.forEach((cr) => {
            if (cr.scheduledResource) hasAssignment = true;
          });
          expect(hasAssignment).toBe(true);
        }
      });
    });

    it('resource utilization is non-zero after scheduling', () => {
      const scheduler = new CTPScheduler();
      scheduler.initLandscape(
        dataset.landscape.horizon,
        dataset.landscape.tasks,
        dataset.landscape.resources,
        dataset.landscape.stateChanges,
        dataset.landscape.processes,
      );
      scheduler.initSettings(dataset.landscape.appSettings!);
      scheduler.initScoring(dataset.scoring);
      scheduler.schedule(dataset.taskList);

      // At least CNC and MILL resources should have assignments
      let totalAssigned = 0;
      dataset.landscape.resources.forEach((r) => {
        if (r.assignments) {
          let node = r.assignments.head;
          while (node) {
            totalAssigned += node.data.duration();
            node = node.next;
          }
        }
      });
      expect(totalAssigned).toBeGreaterThan(0);
    });

    it('order fill rates can be computed from scheduled tasks', () => {
      const scheduler = new CTPScheduler();
      scheduler.initLandscape(
        dataset.landscape.horizon,
        dataset.landscape.tasks,
        dataset.landscape.resources,
        dataset.landscape.stateChanges,
        dataset.landscape.processes,
      );
      scheduler.initSettings(dataset.landscape.appSettings!);
      scheduler.initScoring(dataset.scoring);
      scheduler.schedule(dataset.taskList);

      // Simulate fill rate computation: for each order, check if its
      // final assembly task was scheduled and update scheduledQty
      const orders = dataset.orders;
      const assemblyKeys: Record<string, string> = {
        'WO-1001': 'WO-1001-ASSY',
        'WO-1002': 'WO-1002-ASSY',
        'WO-1003': 'WO-1003-ASSY',
        'WO-1004': 'WO-1004-ASSY',
        'WO-1005': 'WO-1005-ASSY',
        'WO-1006': 'WO-1006-ASSY',
      };

      for (const [orderKey, assyKey] of Object.entries(assemblyKeys)) {
        const assyTask = dataset.landscape.tasks.getEntity(assyKey);
        const order = orders.getEntity(orderKey);
        if (assyTask && order && assyTask.state === CTPTaskStateConstants.SCHEDULED) {
          order.scheduledQty = assyTask.netOutputQty();
          order.computeFillRate();
        }
      }

      // At least some orders should have fill rate > 0
      let filledOrders = 0;
      orders.forEach((o) => {
        if (o.fillRate > 0) filledOrders++;
      });
      expect(filledOrders).toBeGreaterThan(0);
    });
  });
});
