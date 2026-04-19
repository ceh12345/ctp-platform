import { describe, it, expect, beforeAll } from 'vitest';
import { MappingEngine } from '../mapping-engine';
import { IRawDataPayload } from '../adapter.interface';
import { IMappingProfile } from '../../../config/interfaces/config-store.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GENIUS_ORDERS = [
  { Id: 1001, JobCode: 'PV-001', CustomerName: 'Fonterra', ItemCode: 'PROD-PV', ItemDescription: '2000L Mix Tank', OrderQty: 1, DeliveryDate: '2026-03-21T01:00:00+13:00', LateDeliveryDate: '2026-03-23T01:00:00+13:00', Strategy: 'HIGH', ItemStatus: 'O' },
  { Id: 1002, JobCode: 'EQ-001', CustomerName: 'Sealed Air', ItemCode: 'PROD-EQ', ItemDescription: 'Conveyor Frame', OrderQty: 2, DeliveryDate: '2026-03-24T01:00:00+13:00', LateDeliveryDate: '2026-03-26T01:00:00+13:00', Strategy: 'RUSH', ItemStatus: 'O' },
  { Id: 1003, JobCode: 'MC-001', CustomerName: 'Dairy Co', ItemCode: 'PROD-MC', ItemDescription: 'Milk Chiller', OrderQty: 1, DeliveryDate: '2026-03-27T01:00:00+13:00', LateDeliveryDate: '2026-03-29T01:00:00+13:00', Strategy: 'NORMAL', ItemStatus: 'O' },
  { Id: 1004, JobCode: 'RP-001', CustomerName: 'Repair Co', ItemCode: 'PROD-RP', ItemDescription: 'Repair Job', OrderQty: 1, DeliveryDate: '2026-03-28T01:00:00+13:00', LateDeliveryDate: null, Strategy: 'LOW', ItemStatus: 'O' },
  { Id: 1005, JobCode: 'XX-001', CustomerName: 'Unknown', ItemCode: 'PROD-XX', ItemDescription: 'Mystery Job', OrderQty: 1, DeliveryDate: '2026-03-29T01:00:00+13:00', LateDeliveryDate: null, Strategy: 'UNKNOWN', ItemStatus: 'O' },
];

const GENIUS_RESOURCES = [
  { Id: 4001, MachineCode: 'CNC-LATHE-01', MachineName: 'Okuma LB3000 CNC Lathe', MachineType: 'CNCLathe', Active: true, HourlyRate: 95, IsLabour: false },
  { Id: 4021, MachineCode: 'MACH-JAMES',   MachineName: 'James T. (Machining Foreman)', MachineType: 'Machinist', Active: true, HourlyRate: 75, IsLabour: true },
  { Id: 4009, MachineCode: 'SAW-01',        MachineName: 'Behringer Band Saw', MachineType: 'Saw', Active: true, HourlyRate: 25, IsLabour: false },
];

// Two chains: PV-001 (3 tasks) and EQ-001 (2 tasks)
const GENIUS_TASKS = [
  { Id: 3001, JobCode: 'PV-001', WorkOrderCode: 'PV-001-WO', SequenceNumber: 10, OperationCode: 'CUT',   TaskType: 'SETUP',   MachineCode: 'SAW-01',       CycleTime: 1.5, WoPlannedQuantity: 1, Formula: 'HR/OP', IsCompleted: true,  IsSchedulingLocked: true,  LagHours: 0, TaskStartDate: '2026-03-16T09:00:00+13:00', TaskEndDate: '2026-03-16T10:30:00+13:00', WipState: 'COMPLETED' },
  { Id: 3002, JobCode: 'PV-001', WorkOrderCode: 'PV-001-WO', SequenceNumber: 20, OperationCode: 'FLANGE', TaskType: 'PROCESS', MachineCode: 'CNC-LATHE-01', CycleTime: 3.0, WoPlannedQuantity: 1, Formula: 'HR/OP', IsCompleted: false, IsSchedulingLocked: false, LagHours: 0, TaskStartDate: null, TaskEndDate: null, WipState: 'NOT_STARTED' },
  { Id: 3003, JobCode: 'PV-001', WorkOrderCode: 'PV-001-WO', SequenceNumber: 30, OperationCode: 'WELD',   TaskType: 'PROCESS', MachineCode: 'SAW-01',       CycleTime: 2.0, WoPlannedQuantity: 1, Formula: 'HR/OP', IsCompleted: false, IsSchedulingLocked: false, LagHours: 1, TaskStartDate: null, TaskEndDate: null, WipState: 'NOT_STARTED' },
  { Id: 3010, JobCode: 'EQ-001', WorkOrderCode: 'EQ-001-WO', SequenceNumber: 10, OperationCode: 'CUT',   TaskType: 'SETUP',   MachineCode: 'SAW-01',       CycleTime: 0.5, WoPlannedQuantity: 1, Formula: 'HR/OP', IsCompleted: false, IsSchedulingLocked: false, LagHours: 0, TaskStartDate: null, TaskEndDate: null, WipState: 'NOT_STARTED' },
  { Id: 3011, JobCode: 'EQ-001', WorkOrderCode: 'EQ-001-WO', SequenceNumber: 20, OperationCode: 'WELD',   TaskType: 'PROCESS', MachineCode: 'SAW-01',       CycleTime: 2.0, WoPlannedQuantity: 1, Formula: 'HR/OP', IsCompleted: false, IsSchedulingLocked: false, LagHours: 0, TaskStartDate: null, TaskEndDate: null, WipState: 'NOT_STARTED' },
];

const STAFFORD_PROFILE: IMappingProfile = {
  orders: {
    mappings: {
      key:         { from: 'JobCode' },
      name:        { from: 'ItemDescription' },
      productKey:  { from: 'ItemCode' },
      demandQty:   { from: 'OrderQty' },
      dueDate:     { from: 'DeliveryDate' },
      lateDueDate: { from: 'LateDeliveryDate' },
      priority:    { from: 'Strategy', lookup: { RUSH: 10, HIGH: 20, NORMAL: 50, LOW: 75, _default: 50 } },
    },
  },
  resources: {
    mappings: {
      key:       { from: 'MachineCode' },
      name:      { from: 'MachineName' },
      type:      { from: 'MachineType' },
      class:     { from: 'IsLabour', lookup: { true: 'LABOUR', false: 'REUSABLE', _default: 'REUSABLE' } },
      hourlyRate:{ from: 'HourlyRate' },
    },
  },
  tasks: {
    key: { from: ['JobCode', 'OperationCode'], sep: '-' },
    mappings: {
      name:            { from: ['JobCode', 'OperationCode'], sep: ' — ' },
      type:            { from: 'TaskType' },
      durationSeconds: { from: 'CycleTime', factor: 3600 },
      durationQty:     { from: 'WoPlannedQuantity' },
      durationType:    { value: 0 },
      wipState:        { from: 'WipState' },
      windowStart:     { from: 'TaskStartDate' },
      windowEnd:       { from: 'TaskEndDate' },
    },
    capacityResources: { from: 'MachineCode' },
    linkId: { chainKey: 'JobCode', orderKey: 'SequenceNumber', lagHoursField: 'LagHours' },
  },
};

function makePayload(overrides: Partial<IRawDataPayload> = {}): IRawDataPayload {
  return {
    orders: GENIUS_ORDERS, tasks: GENIUS_TASKS, resources: GENIUS_RESOURCES,
    calendars: [], stateChanges: [], products: [], materials: [], processes: [], cadences: [], uomConversions: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MappingEngine', () => {
  const engine = new MappingEngine();

  // ── Identity pass-through ──────────────────────────────────────────────────

  describe('null profile', () => {
    it('returns raw payload unchanged and no errors', () => {
      const raw = makePayload();
      const result = engine.transform(raw, null);
      expect(result.payload).toBe(raw);
      expect(result.errors).toEqual([]);
    });
  });

  // ── Orders mapping ────────────────────────────────────────────────────────

  describe('orders mapping', () => {
    let orders: Record<string, any>[];

    beforeAll(() => {
      orders = engine.transform(makePayload(), STAFFORD_PROFILE).payload.orders as Record<string, any>[];
    });

    it('maps the correct number of orders', () => {
      expect(orders).toHaveLength(GENIUS_ORDERS.length);
    });

    it('maps JobCode → key', () => {
      expect(orders[0].key).toBe('PV-001');
      expect(orders[1].key).toBe('EQ-001');
    });

    it('maps ItemDescription → name', () => {
      expect(orders[0].name).toBe('2000L Mix Tank');
    });

    it('maps ItemCode → productKey', () => {
      expect(orders[0].productKey).toBe('PROD-PV');
    });

    it('maps OrderQty → demandQty', () => {
      expect(orders[1].demandQty).toBe(2);
    });

    it('maps DeliveryDate → dueDate (pass-through)', () => {
      expect(orders[0].dueDate).toBe('2026-03-21T01:00:00+13:00');
    });

    it('Strategy RUSH → priority 10', () => {
      expect(orders[1].priority).toBe(10);
    });

    it('Strategy HIGH → priority 20', () => {
      expect(orders[0].priority).toBe(20);
    });

    it('Strategy NORMAL → priority 50', () => {
      expect(orders[2].priority).toBe(50);
    });

    it('Strategy LOW → priority 75', () => {
      expect(orders[3].priority).toBe(75);
    });

    it('unknown Strategy → priority 50 (_default)', () => {
      expect(orders[4].priority).toBe(50);
    });

    it('null LateDeliveryDate is not written to output', () => {
      // RP-001 has LateDeliveryDate: null — should be absent, not set to null
      expect(orders[3].lateDueDate).toBeUndefined();
    });
  });

  // ── Resources mapping ─────────────────────────────────────────────────────

  describe('resources mapping', () => {
    let resources: Record<string, any>[];

    beforeAll(() => {
      resources = engine.transform(makePayload(), STAFFORD_PROFILE).payload.resources as Record<string, any>[];
    });

    it('maps the correct number of resources', () => {
      expect(resources).toHaveLength(GENIUS_RESOURCES.length);
    });

    it('maps MachineCode → key', () => {
      expect(resources[0].key).toBe('CNC-LATHE-01');
    });

    it('maps MachineName → name', () => {
      expect(resources[0].name).toBe('Okuma LB3000 CNC Lathe');
    });

    it('maps MachineType → type', () => {
      expect(resources[0].type).toBe('CNCLathe');
    });

    it('IsLabour false → class REUSABLE', () => {
      expect(resources[0].class).toBe('REUSABLE');
      expect(resources[2].class).toBe('REUSABLE');
    });

    it('IsLabour true → class LABOUR', () => {
      expect(resources[1].class).toBe('LABOUR');
    });

    it('maps HourlyRate', () => {
      expect(resources[0].hourlyRate).toBe(95);
      expect(resources[1].hourlyRate).toBe(75);
    });
  });

  // ── Tasks mapping — field transforms ─────────────────────────────────────

  describe('tasks mapping — field transforms', () => {
    let tasks: Record<string, any>[];

    beforeAll(() => {
      tasks = engine.transform(makePayload(), STAFFORD_PROFILE).payload.tasks as Record<string, any>[];
    });

    it('maps the correct number of tasks', () => {
      expect(tasks).toHaveLength(GENIUS_TASKS.length);
    });

    it('builds key as JobCode-OperationCode', () => {
      expect(tasks[0].key).toBe('PV-001-CUT');
      expect(tasks[1].key).toBe('PV-001-FLANGE');
      expect(tasks[3].key).toBe('EQ-001-CUT');
    });

    it('builds name as "JobCode — OperationCode"', () => {
      expect(tasks[0].name).toBe('PV-001 — CUT');
    });

    it('maps TaskType → type', () => {
      expect(tasks[0].type).toBe('SETUP');
      expect(tasks[1].type).toBe('PROCESS');
    });

    it('converts CycleTime hours → durationSeconds', () => {
      expect(tasks[0].durationSeconds).toBe(1.5 * 3600);  // 5400
      expect(tasks[1].durationSeconds).toBe(3.0 * 3600);  // 10800
    });

    it('sets durationType to 0 (const)', () => {
      expect(tasks[0].durationType).toBe(0);
      expect(tasks[1].durationType).toBe(0);
    });

    it('maps WipState', () => {
      expect(tasks[0].wipState).toBe('COMPLETED');
      expect(tasks[1].wipState).toBe('NOT_STARTED');
    });

    it('sets windowStart/windowEnd from TaskStartDate/TaskEndDate when present', () => {
      expect(tasks[0].windowStart).toBe('2026-03-16T09:00:00+13:00');
      expect(tasks[0].windowEnd).toBe('2026-03-16T10:30:00+13:00');
    });

    it('omits windowStart/windowEnd when TaskStartDate is null', () => {
      expect(tasks[1].windowStart).toBeUndefined();
      expect(tasks[1].windowEnd).toBeUndefined();
    });

    it('builds capacityResources from MachineCode', () => {
      const cap = tasks[0].capacityResources as any[];
      expect(cap).toHaveLength(1);
      expect(cap[0].resource).toBe('SAW-01');
      expect(cap[0].isPrimary).toBe(true);
    });
  });

  // ── Tasks mapping — chain linkId ──────────────────────────────────────────

  describe('tasks mapping — chain linkId', () => {
    let tasks: Record<string, any>[];
    let byKey: Map<string, Record<string, any>>;

    beforeAll(() => {
      tasks = engine.transform(makePayload(), STAFFORD_PROFILE).payload.tasks as Record<string, any>[];
      byKey = new Map(tasks.map(t => [t.key as string, t]));
    });

    it('first task in chain gets type START', () => {
      expect(byKey.get('PV-001-CUT')!.linkId.type).toBe('START');
    });

    it('first task in chain has empty prevLink', () => {
      expect(byKey.get('PV-001-CUT')!.linkId.prevLink).toBe('');
    });

    it('second task gets type LINK', () => {
      expect(byKey.get('PV-001-FLANGE')!.linkId.type).toBe('LINK');
    });

    it('second task prevLink points to first task', () => {
      expect(byKey.get('PV-001-FLANGE')!.linkId.prevLink).toBe('PV-001-CUT');
    });

    it('third task prevLink points to second task', () => {
      expect(byKey.get('PV-001-WELD')!.linkId.prevLink).toBe('PV-001-FLANGE');
    });

    it('linkId name is the chain key (JobCode)', () => {
      expect(byKey.get('PV-001-CUT')!.linkId.name).toBe('PV-001');
      expect(byKey.get('EQ-001-CUT')!.linkId.name).toBe('EQ-001');
    });

    it('two chains do not cross-link', () => {
      expect(byKey.get('EQ-001-CUT')!.linkId.type).toBe('START');
      expect(byKey.get('EQ-001-CUT')!.linkId.prevLink).toBe('');
      expect(byKey.get('EQ-001-WELD')!.linkId.prevLink).toBe('EQ-001-CUT');
    });

    it('LagHours 0 → maxGap null', () => {
      expect(byKey.get('PV-001-CUT')!.linkId.maxGap).toBeNull();
      expect(byKey.get('PV-001-FLANGE')!.linkId.maxGap).toBeNull();
    });

    it('LagHours 1 → maxGap 3600 seconds', () => {
      expect(byKey.get('PV-001-WELD')!.linkId.maxGap).toBe(3600);
    });
  });

  // ── toUTC transform ────────────────────────────────────────────────────────
  //
  // Stafford's Genius API returns dates with literal NZ offsets (+13:00 NZDT /
  // +12:00 NZST). The `toUTC: true` rule flag normalizes these to UTC Z-suffixed
  // ISO strings so everything downstream sees a single canonical format.

  describe('toUTC transform', () => {
    const makeRule = (extras: Record<string, any> = {}) => ({
      orders: { mappings: { dueDate: { from: 'DeliveryDate', toUTC: true, ...extras } } },
    }) as IMappingProfile;

    const oneOrder = (dd: unknown) => makePayload({
      orders: [{ Id: 1, JobCode: 'TEST', DeliveryDate: dd }],
    });

    it('#1 NZDT offset (+13:00) → Z-suffixed UTC (13h earlier)', () => {
      const out = engine.transform(oneOrder('2026-03-21T01:00:00+13:00'), makeRule()).payload.orders as any[];
      expect(out[0].dueDate).toBe('2026-03-20T12:00:00.000Z');
    });

    it('#2 NZST offset (+12:00) → Z-suffixed UTC (12h earlier)', () => {
      const out = engine.transform(oneOrder('2026-07-10T09:00:00+12:00'), makeRule()).payload.orders as any[];
      expect(out[0].dueDate).toBe('2026-07-09T21:00:00.000Z');
    });

    it('#3 bare date + fromTimezone Pacific/Auckland (NZDT day) → correct UTC', () => {
      const rule = makeRule({ fromTimezone: 'Pacific/Auckland' });
      const out = engine.transform(oneOrder('2026-03-21T01:00:00'), rule).payload.orders as any[];
      expect(out[0].dueDate).toBe('2026-03-20T12:00:00.000Z');
    });

    it('#4 bare date + fromTimezone Pacific/Auckland (NZST day) → correct UTC', () => {
      const rule = makeRule({ fromTimezone: 'Pacific/Auckland' });
      const out = engine.transform(oneOrder('2026-07-10T09:00:00'), rule).payload.orders as any[];
      expect(out[0].dueDate).toBe('2026-07-09T21:00:00.000Z');
    });

    it('#5 bare date with NO fromTimezone → passes through unchanged (no silent local interpretation)', () => {
      const out = engine.transform(oneOrder('2026-03-21T01:00:00'), makeRule()).payload.orders as any[];
      expect(out[0].dueDate).toBe('2026-03-21T01:00:00');
    });

    it('#6 unparseable date → passes through unchanged', () => {
      const out = engine.transform(oneOrder('not-a-date'), makeRule()).payload.orders as any[];
      expect(out[0].dueDate).toBe('not-a-date');
    });

    it('#7 null input → field is absent from output', () => {
      const out = engine.transform(oneOrder(null), makeRule()).payload.orders as any[];
      expect(out[0]).not.toHaveProperty('dueDate');
    });

    it('#8 empty string input → passes through as ""', () => {
      // The rule short-circuits on empty string, then applyMappings sees ""
      // which is defined-but-falsy. Current applyMappings writes it because
      // it only skips undefined/null. Test locks in that behavior.
      const out = engine.transform(oneOrder(''), makeRule()).payload.orders as any[];
      // Empty string is skipped by applyMappings (not undefined/null per its
      // filter, but the `toUTC` branch returns the value untouched — then
      // applyMappings' `if (val !== undefined && val !== null)` keeps it.
      // Either outcome is valid; the test asserts the current behavior.
      expect(out[0].dueDate).toBe('');
    });

    it('#9 NZDT/NZST transition boundary: luxon IANA zone picks the correct offset per instant', () => {
      const rule = makeRule({ fromTimezone: 'Pacific/Auckland' });
      // Sept 27, 2026 is start of NZDT (UTC+13). Before that date: NZST (UTC+12).
      const nzstSide = engine.transform(oneOrder('2026-09-26T10:00:00'), rule).payload.orders as any[];
      const nzdtSide = engine.transform(oneOrder('2026-09-28T10:00:00'), rule).payload.orders as any[];
      // NZST (+12): 10:00 NZ → 22:00 UTC previous day
      expect(nzstSide[0].dueDate).toBe('2026-09-25T22:00:00.000Z');
      // NZDT (+13): 10:00 NZ → 21:00 UTC previous day
      expect(nzdtSide[0].dueDate).toBe('2026-09-27T21:00:00.000Z');
    });

    it('existing rules (without toUTC) continue to pass dates through unchanged — no regression', () => {
      // This guards the original test at line 123: dueDate pass-through when
      // the rule has NO toUTC flag.
      const out = engine.transform(makePayload(), STAFFORD_PROFILE).payload.orders as any[];
      expect(out[0].dueDate).toBe('2026-03-21T01:00:00+13:00');
    });
  });
});
