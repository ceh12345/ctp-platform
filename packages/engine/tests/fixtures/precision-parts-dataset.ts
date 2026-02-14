/**
 * Precision Parts Co. — Demo Dataset
 *
 * Factory producing 3 finished products (Widget-A, Widget-B, Widget-C)
 * with full BOM chains, 8 resources, 6 work orders, and ~26 linked tasks.
 *
 * Designed to exercise:
 *   - Product BOM with scrap rates (RAW → INTERMEDIATE → FINISHED)
 *   - Order fill-rate tracking
 *   - Task material input/output linkage
 *   - Task chaining via linkId (process dependencies)
 *   - Resource contention across concurrent orders
 *   - WO-1005 is deliberately tight (due Feb 12, priority 1)
 */

import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';
import { CTPInterval, CTPDuration, CTPRunRate } from '../../Models/Core/window';
import { CTPAvailable, CTPAssignments } from '../../Models/Intervals/intervals';
import { CTPResourceConstants, CTPDurationConstants } from '../../Models/Core/constants';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import {
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPTaskMaterialInput,
  CTPTaskMaterialInputList,
} from '../../Models/Entities/task';
import {
  CTPProduct,
  CTPProducts,
  CTPProductTypeConstants,
  CTPBOMInput,
  CTPBOMInputList,
} from '../../Models/Entities/product';
import { CTPOrder, CTPOrders } from '../../Models/Entities/order';
import { CTPStateChange, CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { List } from '../../Models/Core/list';

// ─── Time helpers ──────────────────────────────────────────────────

const HOUR = 3600; // seconds

function isoToW(iso: string): number {
  return CTPDateTime.fromDateTime(DateTime.fromISO(iso));
}

// ─── Horizon ───────────────────────────────────────────────────────

const HORIZON_START = DateTime.fromISO('2026-02-09T00:00:00');
const HORIZON_END = DateTime.fromISO('2026-02-23T00:00:00');

// ─── Calendar builder ──────────────────────────────────────────────

/**
 * Build 16-hour daily availability (06:00–22:00), Mon–Sat.
 * Sunday is off.
 */
function buildCalendar(
  startDate: DateTime,
  days: number,
): CTPAvailable {
  const avail = new CTPAvailable();
  for (let i = 0; i < days; i++) {
    const day = startDate.plus({ days: i });
    if (day.weekday === 7) continue; // skip Sunday
    const dayStart = day.set({ hour: 6, minute: 0, second: 0 });
    const dayEnd = day.set({ hour: 22, minute: 0, second: 0 });
    const startW = CTPDateTime.fromDateTime(dayStart);
    const endW = CTPDateTime.fromDateTime(dayEnd);
    avail.add(new CTPInterval(startW, endW, 1));
  }
  return avail;
}

// ─── Products ──────────────────────────────────────────────────────

export function buildProducts(): CTPProducts {
  const products = new CTPProducts();

  // ── RAW materials ──
  const alu6061 = new CTPProduct('RAW', 'Aluminum 6061', 'ALU-6061', CTPProductTypeConstants.RAW, 'kg');
  const ss304 = new CTPProduct('RAW', 'Stainless Steel 304', 'SS-304', CTPProductTypeConstants.RAW, 'kg');
  const brg608 = new CTPProduct('RAW', 'Bearing 608ZZ', 'BRG-608ZZ', CTPProductTypeConstants.RAW, 'pcs');
  const sealOring = new CTPProduct('RAW', 'O-Ring Seal', 'SEAL-ORING', CTPProductTypeConstants.RAW, 'pcs');
  const fastKit = new CTPProduct('RAW', 'Fastener Kit', 'FAST-KIT', CTPProductTypeConstants.RAW, 'pcs');
  const sealKit = new CTPProduct('RAW', 'Seal Kit', 'SEAL-KIT', CTPProductTypeConstants.RAW, 'pcs');

  products.addEntity(alu6061);
  products.addEntity(ss304);
  products.addEntity(brg608);
  products.addEntity(sealOring);
  products.addEntity(fastKit);
  products.addEntity(sealKit);

  // ── INTERMEDIATE ──

  // Machined Housing — needs 2.5 kg ALU-6061 per unit, 5% input scrap
  const machHousing = new CTPProduct(
    'INTERMEDIATE', 'Machined Housing', 'MACH-HOUSING',
    CTPProductTypeConstants.INTERMEDIATE, 'pcs',
  );
  machHousing.outputScrapRate = 0.05;
  machHousing.bomInputs.push(new CTPBOMInput('ALU-6061', 2.5, 0.05, 'kg'));

  // Milled Bracket — needs 1.8 kg SS-304 per unit, 3% input scrap
  const millBracket = new CTPProduct(
    'INTERMEDIATE', 'Milled Bracket', 'MILL-BRACKET',
    CTPProductTypeConstants.INTERMEDIATE, 'pcs',
  );
  millBracket.outputScrapRate = 0.03;
  millBracket.bomInputs.push(new CTPBOMInput('SS-304', 1.8, 0.03, 'kg'));

  products.addEntity(machHousing);
  products.addEntity(millBracket);

  // ── FINISHED ──

  // Widget-A — Housing + 2x Bearing + 1x O-Ring. 3% output scrap.
  const widgetA = new CTPProduct(
    'FINISHED', 'Widget-A', 'WIDGET-A',
    CTPProductTypeConstants.FINISHED, 'pcs',
  );
  widgetA.outputScrapRate = 0.03;
  widgetA.bomInputs.push(new CTPBOMInput('MACH-HOUSING', 1, 0, 'pcs'));
  widgetA.bomInputs.push(new CTPBOMInput('BRG-608ZZ', 2, 0, 'pcs'));
  widgetA.bomInputs.push(new CTPBOMInput('SEAL-ORING', 1, 0, 'pcs'));

  // Widget-B — Bracket + 1x Bearing + 2x Fastener Kit. 2% output scrap.
  const widgetB = new CTPProduct(
    'FINISHED', 'Widget-B', 'WIDGET-B',
    CTPProductTypeConstants.FINISHED, 'pcs',
  );
  widgetB.outputScrapRate = 0.02;
  widgetB.bomInputs.push(new CTPBOMInput('MILL-BRACKET', 1, 0, 'pcs'));
  widgetB.bomInputs.push(new CTPBOMInput('BRG-608ZZ', 1, 0, 'pcs'));
  widgetB.bomInputs.push(new CTPBOMInput('FAST-KIT', 2, 0, 'pcs'));

  // Widget-C — Housing + Bracket + 1x Seal Kit. 4% output scrap.
  const widgetC = new CTPProduct(
    'FINISHED', 'Widget-C', 'WIDGET-C',
    CTPProductTypeConstants.FINISHED, 'pcs',
  );
  widgetC.outputScrapRate = 0.04;
  widgetC.bomInputs.push(new CTPBOMInput('MACH-HOUSING', 1, 0, 'pcs'));
  widgetC.bomInputs.push(new CTPBOMInput('MILL-BRACKET', 1, 0, 'pcs'));
  widgetC.bomInputs.push(new CTPBOMInput('SEAL-KIT', 1, 0, 'pcs'));

  products.addEntity(widgetA);
  products.addEntity(widgetB);
  products.addEntity(widgetC);

  return products;
}

// ─── Resources ─────────────────────────────────────────────────────

export function buildResources(): CTPResources {
  const resources = new CTPResources();

  const defs: { key: string; name: string; type: string }[] = [
    { key: 'CNC-01', name: 'CNC Machine 01', type: 'CNC' },
    { key: 'CNC-02', name: 'CNC Machine 02', type: 'CNC' },
    { key: 'MILL-01', name: 'Milling Center 01', type: 'MILL' },
    { key: 'MILL-02', name: 'Milling Center 02', type: 'MILL' },
    { key: 'ASSY-01', name: 'Assembly Station 01', type: 'ASSEMBLY' },
    { key: 'ASSY-02', name: 'Assembly Station 02', type: 'ASSEMBLY' },
    { key: 'QC-01', name: 'Quality Control 01', type: 'QC' },
    { key: 'PACK-01', name: 'Packaging Station 01', type: 'PACKING' },
  ];

  for (const d of defs) {
    const res = new CTPResource(CTPResourceConstants.REUSABLE, d.type, d.name, d.key);
    const cal = buildCalendar(HORIZON_START, 14);
    res.original = cal;
    res.assignments = new CTPAssignments();
    res.available.setLists(res.original, res.assignments);
    resources.addEntity(res);
  }

  return resources;
}

// ─── Orders ────────────────────────────────────────────────────────

export function buildOrders(): CTPOrders {
  const orders = new CTPOrders();

  const defs: {
    key: string; name: string; productKey: string;
    qty: number; dueISO: string; priority: number;
  }[] = [
    { key: 'WO-1001', name: 'Widget-A Run 1', productKey: 'WIDGET-A', qty: 500, dueISO: '2026-02-14T22:00:00', priority: 1 },
    { key: 'WO-1002', name: 'Widget-B Run 1', productKey: 'WIDGET-B', qty: 300, dueISO: '2026-02-16T22:00:00', priority: 2 },
    { key: 'WO-1003', name: 'Widget-C Run 1', productKey: 'WIDGET-C', qty: 200, dueISO: '2026-02-13T22:00:00', priority: 1 },
    { key: 'WO-1004', name: 'Widget-A Run 2', productKey: 'WIDGET-A', qty: 400, dueISO: '2026-02-18T22:00:00', priority: 3 },
    { key: 'WO-1005', name: 'Widget-C Rush', productKey: 'WIDGET-C', qty: 250, dueISO: '2026-02-12T22:00:00', priority: 1 },
    { key: 'WO-1006', name: 'Widget-B Run 2', productKey: 'WIDGET-B', qty: 150, dueISO: '2026-02-20T22:00:00', priority: 4 },
  ];

  for (const d of defs) {
    const order = new CTPOrder('ORDER', d.name, d.key);
    order.productKey = d.productKey;
    order.demandQty = d.qty;
    order.dueDate = isoToW(d.dueISO);
    order.lateDueDate = isoToW(d.dueISO) + 2 * 24 * HOUR; // 2-day grace
    order.priority = d.priority;
    orders.addEntity(order);
  }

  return orders;
}

// ─── Task builder helpers ──────────────────────────────────────────

function makeCapResources(
  resourceType: string,
  resourceKeys: string[],
): CTPTaskResourceList {
  const list = new CTPTaskResourceList();
  const tr = new CTPTaskResource(resourceType, true, 0);
  for (const rk of resourceKeys) {
    tr.preferences.push(new CTPResourcePreference(rk));
  }
  list.add(tr);
  list.sortBySequence();
  return list;
}

function makeMaterialInputs(
  inputs: { productKey: string; qty: number; scrapRate?: number; uom?: string }[],
): CTPTaskMaterialInputList {
  const list = new CTPTaskMaterialInputList();
  for (const inp of inputs) {
    list.push(new CTPTaskMaterialInput(
      inp.productKey,
      inp.qty,
      inp.scrapRate ?? 0,
      inp.uom ?? 'pcs',
    ));
  }
  return list;
}

interface TaskDef {
  key: string;
  name: string;
  orderKey: string;
  durationH: number;
  outputProductKey: string | null;
  outputQty: number;
  outputScrapRate: number;
  inputMaterials: { productKey: string; qty: number; scrapRate?: number; uom?: string }[];
  resourceType: string;
  resourceKeys: string[];
  process: string;
  prevTaskKey: string;
  windowStartISO: string;
  windowEndISO: string;
  sequence: number;
  rank: number;
}

// ─── Task definitions ──────────────────────────────────────────────

function defineAllTasks(): TaskDef[] {
  const tasks: TaskDef[] = [];

  // ── WO-1001: 500 Widget-A, due Feb 14, priority 1 ─────────────
  const wo1001Window = { start: '2026-02-09T06:00:00', end: '2026-02-14T22:00:00' };

  tasks.push({
    key: 'WO-1001-CNC', name: 'CNC Housing (WO-1001)',
    orderKey: 'WO-1001', durationH: 6,
    outputProductKey: 'MACH-HOUSING', outputQty: 500, outputScrapRate: 0.05,
    inputMaterials: [{ productKey: 'ALU-6061', qty: 1250, scrapRate: 0.05, uom: 'kg' }],
    resourceType: 'CNC', resourceKeys: ['CNC-01', 'CNC-02'],
    process: 'MACH-HOUSING', prevTaskKey: '',
    windowStartISO: wo1001Window.start, windowEndISO: wo1001Window.end,
    sequence: 10, rank: 1,
  });
  tasks.push({
    key: 'WO-1001-ASSY', name: 'Assemble Widget-A (WO-1001)',
    orderKey: 'WO-1001', durationH: 4,
    outputProductKey: 'WIDGET-A', outputQty: 500, outputScrapRate: 0.03,
    inputMaterials: [
      { productKey: 'MACH-HOUSING', qty: 500 },
      { productKey: 'BRG-608ZZ', qty: 1000 },
      { productKey: 'SEAL-ORING', qty: 500 },
    ],
    resourceType: 'ASSEMBLY', resourceKeys: ['ASSY-01', 'ASSY-02'],
    process: 'WIDGET-A', prevTaskKey: 'WO-1001-CNC',
    windowStartISO: wo1001Window.start, windowEndISO: wo1001Window.end,
    sequence: 20, rank: 1,
  });
  tasks.push({
    key: 'WO-1001-QC', name: 'QC Widget-A (WO-1001)',
    orderKey: 'WO-1001', durationH: 2,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'QC', resourceKeys: ['QC-01'],
    process: 'QC', prevTaskKey: 'WO-1001-ASSY',
    windowStartISO: wo1001Window.start, windowEndISO: wo1001Window.end,
    sequence: 30, rank: 1,
  });
  tasks.push({
    key: 'WO-1001-PACK', name: 'Pack Widget-A (WO-1001)',
    orderKey: 'WO-1001', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'PACKING', resourceKeys: ['PACK-01'],
    process: 'PACKING', prevTaskKey: 'WO-1001-QC',
    windowStartISO: wo1001Window.start, windowEndISO: wo1001Window.end,
    sequence: 40, rank: 1,
  });

  // ── WO-1002: 300 Widget-B, due Feb 16, priority 2 ─────────────
  const wo1002Window = { start: '2026-02-09T06:00:00', end: '2026-02-16T22:00:00' };

  tasks.push({
    key: 'WO-1002-MILL', name: 'Mill Bracket (WO-1002)',
    orderKey: 'WO-1002', durationH: 4,
    outputProductKey: 'MILL-BRACKET', outputQty: 300, outputScrapRate: 0.03,
    inputMaterials: [{ productKey: 'SS-304', qty: 540, scrapRate: 0.03, uom: 'kg' }],
    resourceType: 'MILL', resourceKeys: ['MILL-01', 'MILL-02'],
    process: 'MILL-BRACKET', prevTaskKey: '',
    windowStartISO: wo1002Window.start, windowEndISO: wo1002Window.end,
    sequence: 10, rank: 2,
  });
  tasks.push({
    key: 'WO-1002-ASSY', name: 'Assemble Widget-B (WO-1002)',
    orderKey: 'WO-1002', durationH: 3,
    outputProductKey: 'WIDGET-B', outputQty: 300, outputScrapRate: 0.02,
    inputMaterials: [
      { productKey: 'MILL-BRACKET', qty: 300 },
      { productKey: 'BRG-608ZZ', qty: 300 },
      { productKey: 'FAST-KIT', qty: 600 },
    ],
    resourceType: 'ASSEMBLY', resourceKeys: ['ASSY-01', 'ASSY-02'],
    process: 'WIDGET-B', prevTaskKey: 'WO-1002-MILL',
    windowStartISO: wo1002Window.start, windowEndISO: wo1002Window.end,
    sequence: 20, rank: 2,
  });
  tasks.push({
    key: 'WO-1002-QC', name: 'QC Widget-B (WO-1002)',
    orderKey: 'WO-1002', durationH: 1.5,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'QC', resourceKeys: ['QC-01'],
    process: 'QC', prevTaskKey: 'WO-1002-ASSY',
    windowStartISO: wo1002Window.start, windowEndISO: wo1002Window.end,
    sequence: 30, rank: 2,
  });
  tasks.push({
    key: 'WO-1002-PACK', name: 'Pack Widget-B (WO-1002)',
    orderKey: 'WO-1002', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'PACKING', resourceKeys: ['PACK-01'],
    process: 'PACKING', prevTaskKey: 'WO-1002-QC',
    windowStartISO: wo1002Window.start, windowEndISO: wo1002Window.end,
    sequence: 40, rank: 2,
  });

  // ── WO-1003: 200 Widget-C, due Feb 13, priority 1 ─────────────
  // Widget-C needs BOTH CNC housing AND milled bracket
  const wo1003Window = { start: '2026-02-09T06:00:00', end: '2026-02-13T22:00:00' };

  tasks.push({
    key: 'WO-1003-CNC', name: 'CNC Housing (WO-1003)',
    orderKey: 'WO-1003', durationH: 4,
    outputProductKey: 'MACH-HOUSING', outputQty: 200, outputScrapRate: 0.05,
    inputMaterials: [{ productKey: 'ALU-6061', qty: 500, scrapRate: 0.05, uom: 'kg' }],
    resourceType: 'CNC', resourceKeys: ['CNC-01', 'CNC-02'],
    process: 'MACH-HOUSING', prevTaskKey: '',
    windowStartISO: wo1003Window.start, windowEndISO: wo1003Window.end,
    sequence: 10, rank: 1,
  });
  tasks.push({
    key: 'WO-1003-MILL', name: 'Mill Bracket (WO-1003)',
    orderKey: 'WO-1003', durationH: 3,
    outputProductKey: 'MILL-BRACKET', outputQty: 200, outputScrapRate: 0.03,
    inputMaterials: [{ productKey: 'SS-304', qty: 360, scrapRate: 0.03, uom: 'kg' }],
    resourceType: 'MILL', resourceKeys: ['MILL-01', 'MILL-02'],
    process: 'MILL-BRACKET', prevTaskKey: '',
    windowStartISO: wo1003Window.start, windowEndISO: wo1003Window.end,
    sequence: 10, rank: 1,
  });
  tasks.push({
    key: 'WO-1003-ASSY', name: 'Assemble Widget-C (WO-1003)',
    orderKey: 'WO-1003', durationH: 3,
    outputProductKey: 'WIDGET-C', outputQty: 200, outputScrapRate: 0.04,
    inputMaterials: [
      { productKey: 'MACH-HOUSING', qty: 200 },
      { productKey: 'MILL-BRACKET', qty: 200 },
      { productKey: 'SEAL-KIT', qty: 200 },
    ],
    resourceType: 'ASSEMBLY', resourceKeys: ['ASSY-01', 'ASSY-02'],
    process: 'WIDGET-C', prevTaskKey: 'WO-1003-MILL',
    windowStartISO: wo1003Window.start, windowEndISO: wo1003Window.end,
    sequence: 20, rank: 1,
  });
  tasks.push({
    key: 'WO-1003-QC', name: 'QC Widget-C (WO-1003)',
    orderKey: 'WO-1003', durationH: 1.5,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'QC', resourceKeys: ['QC-01'],
    process: 'QC', prevTaskKey: 'WO-1003-ASSY',
    windowStartISO: wo1003Window.start, windowEndISO: wo1003Window.end,
    sequence: 30, rank: 1,
  });
  tasks.push({
    key: 'WO-1003-PACK', name: 'Pack Widget-C (WO-1003)',
    orderKey: 'WO-1003', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'PACKING', resourceKeys: ['PACK-01'],
    process: 'PACKING', prevTaskKey: 'WO-1003-QC',
    windowStartISO: wo1003Window.start, windowEndISO: wo1003Window.end,
    sequence: 40, rank: 1,
  });

  // ── WO-1004: 400 Widget-A, due Feb 18, priority 3 ─────────────
  const wo1004Window = { start: '2026-02-09T06:00:00', end: '2026-02-18T22:00:00' };

  tasks.push({
    key: 'WO-1004-CNC', name: 'CNC Housing (WO-1004)',
    orderKey: 'WO-1004', durationH: 5,
    outputProductKey: 'MACH-HOUSING', outputQty: 400, outputScrapRate: 0.05,
    inputMaterials: [{ productKey: 'ALU-6061', qty: 1000, scrapRate: 0.05, uom: 'kg' }],
    resourceType: 'CNC', resourceKeys: ['CNC-01', 'CNC-02'],
    process: 'MACH-HOUSING', prevTaskKey: '',
    windowStartISO: wo1004Window.start, windowEndISO: wo1004Window.end,
    sequence: 10, rank: 3,
  });
  tasks.push({
    key: 'WO-1004-ASSY', name: 'Assemble Widget-A (WO-1004)',
    orderKey: 'WO-1004', durationH: 3.5,
    outputProductKey: 'WIDGET-A', outputQty: 400, outputScrapRate: 0.03,
    inputMaterials: [
      { productKey: 'MACH-HOUSING', qty: 400 },
      { productKey: 'BRG-608ZZ', qty: 800 },
      { productKey: 'SEAL-ORING', qty: 400 },
    ],
    resourceType: 'ASSEMBLY', resourceKeys: ['ASSY-01', 'ASSY-02'],
    process: 'WIDGET-A', prevTaskKey: 'WO-1004-CNC',
    windowStartISO: wo1004Window.start, windowEndISO: wo1004Window.end,
    sequence: 20, rank: 3,
  });
  tasks.push({
    key: 'WO-1004-QC', name: 'QC Widget-A (WO-1004)',
    orderKey: 'WO-1004', durationH: 1.5,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'QC', resourceKeys: ['QC-01'],
    process: 'QC', prevTaskKey: 'WO-1004-ASSY',
    windowStartISO: wo1004Window.start, windowEndISO: wo1004Window.end,
    sequence: 30, rank: 3,
  });
  tasks.push({
    key: 'WO-1004-PACK', name: 'Pack Widget-A (WO-1004)',
    orderKey: 'WO-1004', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'PACKING', resourceKeys: ['PACK-01'],
    process: 'PACKING', prevTaskKey: 'WO-1004-QC',
    windowStartISO: wo1004Window.start, windowEndISO: wo1004Window.end,
    sequence: 40, rank: 3,
  });

  // ── WO-1005: 250 Widget-C, due Feb 12, priority 1 (TIGHT) ─────
  // Only 3 working days (Feb 9–12) to complete 5-step chain.
  // Competes with WO-1001 and WO-1003 for CNC, MILL, ASSY, QC, PACK.
  const wo1005Window = { start: '2026-02-09T06:00:00', end: '2026-02-12T22:00:00' };

  tasks.push({
    key: 'WO-1005-CNC', name: 'CNC Housing (WO-1005 RUSH)',
    orderKey: 'WO-1005', durationH: 5,
    outputProductKey: 'MACH-HOUSING', outputQty: 250, outputScrapRate: 0.05,
    inputMaterials: [{ productKey: 'ALU-6061', qty: 625, scrapRate: 0.05, uom: 'kg' }],
    resourceType: 'CNC', resourceKeys: ['CNC-01', 'CNC-02'],
    process: 'MACH-HOUSING', prevTaskKey: '',
    windowStartISO: wo1005Window.start, windowEndISO: wo1005Window.end,
    sequence: 10, rank: 1,
  });
  tasks.push({
    key: 'WO-1005-MILL', name: 'Mill Bracket (WO-1005 RUSH)',
    orderKey: 'WO-1005', durationH: 4,
    outputProductKey: 'MILL-BRACKET', outputQty: 250, outputScrapRate: 0.03,
    inputMaterials: [{ productKey: 'SS-304', qty: 450, scrapRate: 0.03, uom: 'kg' }],
    resourceType: 'MILL', resourceKeys: ['MILL-01', 'MILL-02'],
    process: 'MILL-BRACKET', prevTaskKey: '',
    windowStartISO: wo1005Window.start, windowEndISO: wo1005Window.end,
    sequence: 10, rank: 1,
  });
  tasks.push({
    key: 'WO-1005-ASSY', name: 'Assemble Widget-C (WO-1005 RUSH)',
    orderKey: 'WO-1005', durationH: 3.5,
    outputProductKey: 'WIDGET-C', outputQty: 250, outputScrapRate: 0.04,
    inputMaterials: [
      { productKey: 'MACH-HOUSING', qty: 250 },
      { productKey: 'MILL-BRACKET', qty: 250 },
      { productKey: 'SEAL-KIT', qty: 250 },
    ],
    resourceType: 'ASSEMBLY', resourceKeys: ['ASSY-01', 'ASSY-02'],
    process: 'WIDGET-C', prevTaskKey: 'WO-1005-MILL',
    windowStartISO: wo1005Window.start, windowEndISO: wo1005Window.end,
    sequence: 20, rank: 1,
  });
  tasks.push({
    key: 'WO-1005-QC', name: 'QC Widget-C (WO-1005 RUSH)',
    orderKey: 'WO-1005', durationH: 1.5,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'QC', resourceKeys: ['QC-01'],
    process: 'QC', prevTaskKey: 'WO-1005-ASSY',
    windowStartISO: wo1005Window.start, windowEndISO: wo1005Window.end,
    sequence: 30, rank: 1,
  });
  tasks.push({
    key: 'WO-1005-PACK', name: 'Pack Widget-C (WO-1005 RUSH)',
    orderKey: 'WO-1005', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'PACKING', resourceKeys: ['PACK-01'],
    process: 'PACKING', prevTaskKey: 'WO-1005-QC',
    windowStartISO: wo1005Window.start, windowEndISO: wo1005Window.end,
    sequence: 40, rank: 1,
  });

  // ── WO-1006: 150 Widget-B, due Feb 20, priority 4 ─────────────
  const wo1006Window = { start: '2026-02-09T06:00:00', end: '2026-02-20T22:00:00' };

  tasks.push({
    key: 'WO-1006-MILL', name: 'Mill Bracket (WO-1006)',
    orderKey: 'WO-1006', durationH: 3,
    outputProductKey: 'MILL-BRACKET', outputQty: 150, outputScrapRate: 0.03,
    inputMaterials: [{ productKey: 'SS-304', qty: 270, scrapRate: 0.03, uom: 'kg' }],
    resourceType: 'MILL', resourceKeys: ['MILL-01', 'MILL-02'],
    process: 'MILL-BRACKET', prevTaskKey: '',
    windowStartISO: wo1006Window.start, windowEndISO: wo1006Window.end,
    sequence: 10, rank: 4,
  });
  tasks.push({
    key: 'WO-1006-ASSY', name: 'Assemble Widget-B (WO-1006)',
    orderKey: 'WO-1006', durationH: 2,
    outputProductKey: 'WIDGET-B', outputQty: 150, outputScrapRate: 0.02,
    inputMaterials: [
      { productKey: 'MILL-BRACKET', qty: 150 },
      { productKey: 'BRG-608ZZ', qty: 150 },
      { productKey: 'FAST-KIT', qty: 300 },
    ],
    resourceType: 'ASSEMBLY', resourceKeys: ['ASSY-01', 'ASSY-02'],
    process: 'WIDGET-B', prevTaskKey: 'WO-1006-MILL',
    windowStartISO: wo1006Window.start, windowEndISO: wo1006Window.end,
    sequence: 20, rank: 4,
  });
  tasks.push({
    key: 'WO-1006-QC', name: 'QC Widget-B (WO-1006)',
    orderKey: 'WO-1006', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'QC', resourceKeys: ['QC-01'],
    process: 'QC', prevTaskKey: 'WO-1006-ASSY',
    windowStartISO: wo1006Window.start, windowEndISO: wo1006Window.end,
    sequence: 30, rank: 4,
  });
  tasks.push({
    key: 'WO-1006-PACK', name: 'Pack Widget-B (WO-1006)',
    orderKey: 'WO-1006', durationH: 1,
    outputProductKey: null, outputQty: 0, outputScrapRate: 0,
    inputMaterials: [],
    resourceType: 'PACKING', resourceKeys: ['PACK-01'],
    process: 'PACKING', prevTaskKey: 'WO-1006-QC',
    windowStartISO: wo1006Window.start, windowEndISO: wo1006Window.end,
    sequence: 40, rank: 4,
  });

  return tasks;
}

// ─── Build CTPTasks from definitions ───────────────────────────────

export function buildTasks(): CTPTasks {
  const defs = defineAllTasks();
  const tasks = new CTPTasks();

  for (const d of defs) {
    const task = new CTPTask('PROCESS', d.name, d.key);

    // Window
    task.window = new CTPInterval();
    task.window.set(isoToW(d.windowStartISO), isoToW(d.windowEndISO), 1);

    // Duration
    task.duration = new CTPDuration(d.durationH * HOUR, 1, CTPDurationConstants.FIXED_DURATION);

    // Sequence & rank
    task.sequence = d.sequence;
    task.rank = d.rank;

    // Capacity resources
    task.capacityResources = makeCapResources(d.resourceType, d.resourceKeys);

    // Process (for state change tracking)
    task.process = d.process;

    // LinkId — chain tasks within same order
    task.linkId = new CTPLinkId(d.orderKey, 'PROCESS', d.prevTaskKey);

    // Product output
    task.outputProductKey = d.outputProductKey;
    task.outputQty = d.outputQty;
    task.outputScrapRate = d.outputScrapRate;

    // Material inputs
    if (d.inputMaterials.length > 0) {
      task.inputMaterials = makeMaterialInputs(d.inputMaterials);
    }

    tasks.addEntity(task);
  }

  return tasks;
}

// ─── State changes ─────────────────────────────────────────────────

export function buildStateChanges(): CTPStateChanges {
  const sc = new CTPStateChanges();

  // CNC process changes (switching between housing types)
  sc.addEntity(new CTPStateChange('CNC', 'PROCESS_CHANGE', 'DEFAULT', 'DEFAULT'));
  const cncChange = sc.getEntity('CNC_PROCESS_CHANGE_DEFAULT_DEFAULT');
  if (cncChange) {
    cncChange.duration = 1800; // 30 min changeover
    cncChange.penalty = 0.1;
  }

  // Mill process changes
  sc.addEntity(new CTPStateChange('MILL', 'PROCESS_CHANGE', 'DEFAULT', 'DEFAULT'));
  const millChange = sc.getEntity('MILL_PROCESS_CHANGE_DEFAULT_DEFAULT');
  if (millChange) {
    millChange.duration = 1200; // 20 min changeover
    millChange.penalty = 0.1;
  }

  // Assembly process changes (switching between widget types)
  sc.addEntity(new CTPStateChange('ASSEMBLY', 'PROCESS_CHANGE', 'DEFAULT', 'DEFAULT'));
  const assyChange = sc.getEntity('ASSEMBLY_PROCESS_CHANGE_DEFAULT_DEFAULT');
  if (assyChange) {
    assyChange.duration = 900; // 15 min changeover
    assyChange.penalty = 0.05;
  }

  return sc;
}

// ─── Scoring ───────────────────────────────────────────────────────

export function buildScoring(): CTPScoring {
  const scoring = new CTPScoring('PrecisionPartsScoring', 'pp-scoring');

  const earliest = new CTPScoringConfiguration('EarliestStartTimeScoringRule', 0.5, 0);
  earliest.includeInSolve = true;
  scoring.addConfig(earliest);

  const whitespace = new CTPScoringConfiguration('WhiteSpaceScoringRule', 0.3, 0);
  whitespace.includeInSolve = true;
  scoring.addConfig(whitespace);

  const stateChange = new CTPScoringConfiguration('StateChangeScoringRule', 0.2, 0);
  stateChange.includeInSolve = true;
  scoring.addConfig(stateChange);

  return scoring;
}

// ─── Settings ──────────────────────────────────────────────────────

export function buildSettings(): CTPAppSettings {
  const settings = new CTPAppSettings();
  settings.scheduleDirection = 1; // FORWARD
  settings.topTasksToSchedule = 2;
  settings.requiresPreds = true;
  settings.flowAround = false;
  return settings;
}

// ─── Full landscape assembly ───────────────────────────────────────

export interface PrecisionPartsDataset {
  landscape: SchedulingLandscape;
  products: CTPProducts;
  orders: CTPOrders;
  scoring: CTPScoring;
  taskList: List<CTPTask>;
}

export function buildPrecisionPartsDataset(): PrecisionPartsDataset {
  const resources = buildResources();
  const tasks = buildTasks();
  const stateChanges = buildStateChanges();
  const settings = buildSettings();
  const products = buildProducts();
  const orders = buildOrders();
  const scoring = buildScoring();

  const landscape = new SchedulingLandscape(HORIZON_START, HORIZON_END, settings);
  landscape.resources = resources;
  landscape.tasks = tasks;
  landscape.stateChanges = stateChanges;
  landscape.buildProcesses();

  // Build task list (all tasks)
  const taskList = new List<CTPTask>();
  tasks.forEach((t) => taskList.add(t));

  return { landscape, products, orders, scoring, taskList };
}
