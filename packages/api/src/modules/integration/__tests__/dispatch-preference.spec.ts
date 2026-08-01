import { describe, it, expect } from 'vitest';
import { MappingEngine } from '../mapping-engine';
import { IRawDataPayload } from '../adapter.interface';
import { IMappingProfile } from '../../../config/interfaces/config-store.interface';

// ── Fixtures — Stafford-shaped mini world ────────────────────────────────────
//
// Groups:
//   F   — header 'F' (Id 6) + finite welders FA-01 (41), FA-02 (42)
//   Q   — header 'Q' (Id 70, OperationsCode QC) + finite Q-01 (77)
//         (GroupCode 'Q' joins the header via Code)
//   P   — header 'P' (Id 100) + finite P-01 (101)
//   DR  — header-only group (Id 80), no finite members
//   OUT — header Code 'O' (Id 90), joins via OperationsCode === 'OUT'

const GENIUS_OPERATIONS = [
  { Code: 'F',    GroupCode: 'F',   Active: true },
  { Code: 'QC',   GroupCode: 'Q',   Active: true },
  { Code: 'P',    GroupCode: 'P',   Active: true },
  { Code: 'PDA',  GroupCode: 'P',   Active: true },
  { Code: 'DR',   GroupCode: 'DR',  Active: true },
  { Code: 'OUT',  GroupCode: 'OUT', Active: true },
];

const GENIUS_RESOURCES = [
  { Id: 6,   Code: 'F',     OperationsCode: 'F',   IsFinite: false, Efficiency: 75,  NumOfAvgResource: 2, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 41,  Code: 'FA-01', OperationsCode: 'F',   IsFinite: true,  Efficiency: 90,  NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 42,  Code: 'FA-02', OperationsCode: 'F',   IsFinite: true,  Efficiency: 90,  NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 70,  Code: 'Q',     OperationsCode: 'QC',  IsFinite: false, Efficiency: 100, NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 77,  Code: 'Q-01',  OperationsCode: 'QC',  IsFinite: true,  Efficiency: 100, NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 100, Code: 'P',     OperationsCode: 'P',   IsFinite: false, Efficiency: 90,  NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 101, Code: 'P-01',  OperationsCode: 'P',   IsFinite: true,  Efficiency: 90,  NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 80,  Code: 'DR',    OperationsCode: 'DR',  IsFinite: false, Efficiency: 100, NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
  { Id: 90,  Code: 'O',     OperationsCode: 'OUT', IsFinite: false, Efficiency: 100, NumOfAvgResource: 1, HourCapacityPerDay: 8, OperatingDayPerWeek: 5 },
];

function makeTask(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    WorkOrderCode: 'WO-1', Order: 10, OperationCode: 'F', MachineId: 6,
    TotalRemainingMachineHours: 2,
    ...overrides,
  };
}

function makeProfile(dispatch: Record<string, unknown> = {}): IMappingProfile {
  return {
    dispatch,
    tasks: {
      key: { from: ['WorkOrderCode', 'OperationCode', 'Order'], sep: '-' },
      mappings: { name: { from: 'WorkOrderCode' } },
      capacityResources: { from: 'MachineId' },
      linkId: { chainKey: 'WorkOrderCode', orderKey: 'Order' },
    },
  };
}

function makePayload(tasks: Record<string, unknown>[], overrides: Partial<IRawDataPayload> = {}): IRawDataPayload {
  return {
    orders: [], tasks, resources: GENIUS_RESOURCES, operations: GENIUS_OPERATIONS, jobs: [],
    calendars: [], stateChanges: [], products: [], materials: [], processes: [], cadences: [], uomConversions: null,
    ...overrides,
  };
}

const slotOf = (task: any) => task.capacityResources?.[0];
const prefsOf = (task: any) =>
  (slotOf(task)?.preferences ?? []).map((p: any) => `${p.resource}:${p.mode}`);

describe('dispatch preference pass', () => {
  const engine = new MappingEngine();

  it('R1 — finite assignment emits REQUIRED pin with group as AVAILABLE alternates', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'F', MachineId: 41 })]), makeProfile());
    const task: any = result.payload.tasks[0];
    expect(prefsOf(task)).toEqual(['41:REQUIRED', '42:AVAILABLE']);
    expect(slotOf(task).preferences[0].rank).toBe(1);
    expect(task.attributes).toEqual([
      { name: 'OperationCode', value: 'F' },
      { name: 'GroupCode', value: 'F' },
    ]);
    expect(result.dispatchReport!.summary.pinned).toBe(1);
    expect(result.dispatchReport!.summary.pinnedHours).toBe(2);
    expect(result.dispatchReport!.errors).toHaveLength(0);
  });

  it('R2 — header-parked task distributes across group members as PREFERRED', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'F', MachineId: 6 })]), makeProfile());
    const task: any = result.payload.tasks[0];
    expect(prefsOf(task)).toEqual(['41:PREFERRED', '42:PREFERRED']);
    expect(result.dispatchReport!.summary.distributed).toBe(1);
    expect(result.dispatchReport!.summary.floatHours).toBe(2);
  });

  it('R2 — missing machine id also distributes (unassigned task)', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'F', MachineId: null })]), makeProfile());
    expect(prefsOf(result.payload.tasks[0])).toEqual(['41:PREFERRED', '42:PREFERRED']);
  });

  it('group membership resolves through the op lookup (QC members found for group Q)', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'QC', MachineId: 70 })]), makeProfile());
    expect(prefsOf(result.payload.tasks[0])).toEqual(['77:PREFERRED']);
  });

  it('R3 — header-only group parks the task on the header', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'DR', MachineId: 80 })]), makeProfile());
    expect(prefsOf(result.payload.tasks[0])).toEqual(['80:AVAILABLE']);
    expect(result.dispatchReport!.summary.headerFallback).toBe(1);
    expect(result.dispatchReport!.headerOnlyGroups).toEqual({ DR: 1 });
  });

  it('header join falls back to OperationsCode (group OUT → header Code O)', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'OUT', MachineId: 90 })]), makeProfile());
    expect(prefsOf(result.payload.tasks[0])).toEqual(['90:AVAILABLE']);
  });

  it('R4 — machine missing from master warns and falls back to the group', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'F', MachineId: 999 })]), makeProfile());
    expect(prefsOf(result.payload.tasks[0])).toEqual(['41:PREFERRED', '42:PREFERRED']);
    expect(result.dispatchReport!.summary.machineFallback).toBe(1);
    expect(result.dispatchReport!.warnings.some(w => w.code === 'MACHINE_NOT_IN_MASTER')).toBe(true);
    expect(result.dispatchReport!.errors).toHaveLength(0);
  });

  it('cross-group pin — pin wins, op-group members ride along, finding recorded', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'PDA', MachineId: 41 })]), makeProfile());
    const task: any = result.payload.tasks[0];
    expect(prefsOf(task)).toEqual(['41:REQUIRED', '101:AVAILABLE']);
    expect(result.dispatchReport!.summary.crossGroupPins).toBe(1);
    expect(result.dispatchReport!.crossGroupPins[0]).toMatchObject({
      opCode: 'PDA', opGroup: 'P', machineCode: 'FA-01', machineGroup: 'F',
    });
  });

  it('unresolved op code — error finding, legacy flat emit preserved', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'ZZZ', MachineId: 41 })]), makeProfile());
    const task: any = result.payload.tasks[0];
    expect(task.capacityResources).toEqual([
      { resource: '41', isPrimary: true, qty: 1, mode: 'ON' },
    ]);
    expect(task.attributes).toEqual([{ name: 'OperationCode', value: 'ZZZ' }]);
    expect(result.dispatchReport!.summary.unresolved).toBe(1);
    expect(result.dispatchReport!.errors.some(e => e.code === 'OP_CODE_UNRESOLVED')).toBe(true);
  });

  it('empty operations master — OPERATIONS_MISSING error, tasks fall back to flat emit', () => {
    const result = engine.transform(
      makePayload([makeTask({})], { operations: [] }), makeProfile());
    const task: any = result.payload.tasks[0];
    expect(task.capacityResources).toEqual([
      { resource: '6', isPrimary: true, qty: 1, mode: 'ON' },
    ]);
    expect(result.dispatchReport!.errors.some(e => e.code === 'OPERATIONS_MISSING')).toBe(true);
  });

  it('distributeUnassigned: false — header-parked task stays on the header', () => {
    const result = engine.transform(
      makePayload([makeTask({ OperationCode: 'F', MachineId: 6 })]),
      makeProfile({ distributeUnassigned: false }));
    expect(prefsOf(result.payload.tasks[0])).toEqual(['6:AVAILABLE']);
    expect(result.dispatchReport!.summary.headerFallback).toBe(1);
  });

  it('capacity drift — header formula vs member sum beyond tolerance warns', () => {
    // F header: 2 × 8 × 5 × 0.75 = 60 hrs/wk; members: 2 × (8 × 5 × 0.9) = 72.
    const result = engine.transform(makePayload([makeTask({})]), makeProfile());
    const drift = result.dispatchReport!.capacityDrift.find(d => d.group === 'F');
    expect(drift).toBeDefined();
    expect(drift!.headerHrsPerWeek).toBe(60);
    expect(drift!.memberHrsPerWeek).toBe(72);
    expect(result.dispatchReport!.warnings.some(w => w.code === 'HEADER_CAPACITY_DRIFT' && w.group === 'F')).toBe(true);
  });

  it('no dispatch block — legacy flat emit, no report', () => {
    const profile = makeProfile();
    delete (profile as any).dispatch;
    const result = engine.transform(makePayload([makeTask({ MachineId: 41 })]), profile);
    const task: any = result.payload.tasks[0];
    expect(task.capacityResources).toEqual([
      { resource: '41', isPrimary: true, qty: 1, mode: 'ON' },
    ]);
    expect(task.attributes).toBeUndefined();
    expect(result.dispatchReport).toBeUndefined();
  });
});
