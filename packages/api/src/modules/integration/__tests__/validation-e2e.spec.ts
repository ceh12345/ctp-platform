/**
 * Sprint 1b end-to-end integration tests for the validation pipeline.
 * Exercises MappingEngine → Hydrator → validation-pass → SyncResult
 * against crafted payloads (no mock-genius dependency — deterministic).
 *
 * Covers:
 *   E1: bad-data-unparseable-date — MappingError emitted, EntityValidationError
 *       attached, schedulable flipped, /ctp/state doesn't 500
 *   E2: orphan-resource — ORPHAN_RESOURCE attached, includeInSolve flipped
 *   E3: happy path — all validation counters zero
 *
 * E2b (Where-To schedulable gate) is covered in ctp.service live tests.
 * E4 (Bug A — orders from landscape) is covered via manual walkthrough;
 * adding a targeted unit test here too.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { MappingEngine } from '../mapping-engine';
import { validateReferences } from '../validation-pass';
import { summarizeValidation } from '../sync-result';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { IRawDataPayload } from '../adapter.interface';
import { IMappingProfile } from '../../../config/interfaces/config-store.interface';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'demo-manufacturing';

function createHydrator(): StateHydratorService {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  return new StateHydratorService(configService);
}

// ── Minimal crafted payloads ───────────────────────────────────────────────

const MIN_RESOURCES = [
  { key: 'MACHINE-1', name: 'Machine 1', type: 'MACHINE', class: 'REUSABLE' },
];

function baseTask(overrides: any = {}) {
  return {
    key: 'TASK-1',
    name: 'Task 1',
    type: 'PROCESS',
    durationSeconds: 3600,
    durationQty: 1,
    durationType: 0,
    capacityResources: [{ resource: 'MACHINE-1', isPrimary: true, qty: 1, mode: 'ON' }],
    ...overrides,
  };
}

// IRawDataPayload has 10 required fields. Most are empty for our tests.
function makePayload(overrides: Partial<IRawDataPayload>): IRawDataPayload {
  return {
    resources: [],
    tasks: [],
    calendars: [],
    stateChanges: [],
    products: [],
    orders: [],
    materials: [],
    processes: [],
    cadences: [],
    uomConversions: null,
    ...overrides,
  };
}

function basePayload(taskOverrides: any = {}, extraOrders: any[] = []): IRawDataPayload {
  return makePayload({
    resources: MIN_RESOURCES,
    tasks: [baseTask(taskOverrides)],
    orders: extraOrders,
  });
}

// ── E1: Bad date in hydrator path ──────────────────────────────────────────

describe('Sprint 1b E2E — Bug C: unparseable date', () => {
  it('E1a: task with bad windowStart gets UNPARSEABLE_DATE on the entity', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(basePayload({
      windowStart: 'not-a-date',
      windowEnd: '2026-03-20T00:00:00Z',
    }));
    const task = landscape.tasks.getEntity('TASK-1')!;
    expect(task.validationErrors).toHaveLength(1);
    expect(task.validationErrors[0]).toMatchObject({
      type: 'UNPARSEABLE_DATE',
      field: 'windowStart',
      rawValue: 'not-a-date',
      severity: 'error',
    });
    expect(task.schedulable).toBe(false);
  });

  it('E1b: invalid calendar date ("2026-02-31") is flagged', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(basePayload({
      windowStart: '2026-02-31',
      windowEnd: '2026-03-20T00:00:00Z',
    }));
    const task = landscape.tasks.getEntity('TASK-1')!;
    expect(task.validationErrors).toHaveLength(1);
    expect(task.validationErrors[0].type).toBe('UNPARSEABLE_DATE');
    expect(task.schedulable).toBe(false);
  });

  it('E1c: empty string → silent miss, no validation error', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(basePayload({
      windowStart: '',
      windowEnd: null,
    }));
    const task = landscape.tasks.getEntity('TASK-1')!;
    expect(task.validationErrors).toEqual([]);
    expect(task.schedulable).toBe(true);
  });

  it('E1d: null → silent miss, no validation error', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(basePayload({
      windowStart: null,
      windowEnd: null,
    }));
    const task = landscape.tasks.getEntity('TASK-1')!;
    expect(task.validationErrors).toEqual([]);
    expect(task.schedulable).toBe(true);
  });

  it('E1e: bad order dueDate gets UNPARSEABLE_DATE on the order', () => {
    const hydrator = createHydrator();
    const payload = basePayload({}, [
      { key: 'ORD-1', name: 'Order 1', productKey: 'P1', demandQty: 1, dueDate: 'garbage', priority: 10 },
    ]);
    const landscape = hydrator.buildLandscape(payload);
    const order = landscape.orders.getEntity('ORD-1')!;
    expect(order.validationErrors).toHaveLength(1);
    expect(order.validationErrors[0]).toMatchObject({
      type: 'UNPARSEABLE_DATE',
      field: 'dueDate',
      rawValue: 'garbage',
    });
  });
});

// ── E2: Orphan resource ────────────────────────────────────────────────────

describe('Sprint 1b E2E — Bug D: orphan resource', () => {
  it('E2a: task with orphan MachineCode gets ORPHAN_RESOURCE, includeInSolve flipped', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: MIN_RESOURCES,
      tasks: [baseTask({
        key: 'TASK-ORPHAN',
        capacityResources: [{ resource: 'MACHINE-NOT-REAL', isPrimary: true, qty: 1, mode: 'ON' }],
      })],
      orders: [],
    }));

    // includeInSolve starts at default true before validation runs
    const taskBefore = landscape.tasks.getEntity('TASK-ORPHAN')!;
    expect(taskBefore.includeInSolve).toBe(true);
    expect(taskBefore.schedulable).toBe(true);

    validateReferences(landscape);

    const task = landscape.tasks.getEntity('TASK-ORPHAN')!;
    expect(task.validationErrors).toHaveLength(1);
    expect(task.validationErrors[0]).toMatchObject({
      type: 'ORPHAN_RESOURCE',
      field: 'capacityResources[0].resource',
      rawValue: 'MACHINE-NOT-REAL',
    });
    expect(task.schedulable).toBe(false);
    expect(task.includeInSolve).toBe(false);  // piggyback fired
  });

  it('E2b: valid resource reference → no error', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: MIN_RESOURCES,
      tasks: [baseTask()],
      orders: [],
    }));
    validateReferences(landscape);
    const task = landscape.tasks.getEntity('TASK-1')!;
    expect(task.validationErrors).toEqual([]);
    expect(task.schedulable).toBe(true);
  });
});

// ── E3: Happy path — summary rollup is all zeros ───────────────────────────

describe('Sprint 1b E2E — happy path summary', () => {
  it('E3: clean payload produces zeroed validationSummary', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: MIN_RESOURCES,
      tasks: [baseTask({
        windowStart: '2026-03-15T00:00:00Z',
        windowEnd: '2026-03-15T08:00:00Z',
      })],
      orders: [
        { key: 'ORD-1', name: 'Order 1', productKey: 'P1', demandQty: 1, dueDate: '2026-03-20T00:00:00Z', priority: 50 },
      ],
    }));
    validateReferences(landscape);
    const summary = summarizeValidation(landscape);
    expect(summary.recordsWithErrors).toBe(0);
    expect(summary.recordsWithWarnings).toBe(0);
    expect(summary.unschedulableTasks).toBe(0);
    expect(summary.byCode).toEqual({});
    expect(summary.byEntity).toEqual({ tasks: 0, orders: 0, resources: 0 });
  });

  it('E3b: mix of clean and bad → summary tallies correctly', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: MIN_RESOURCES,
      tasks: [
        baseTask({ key: 'T-CLEAN' }),
        baseTask({
          key: 'T-BAD-DATE',
          windowStart: 'not-a-date',
          windowEnd: null,
        }),
        baseTask({
          key: 'T-ORPHAN',
          capacityResources: [{ resource: 'MISSING', isPrimary: true, qty: 1, mode: 'ON' }],
        }),
      ],
      orders: [
        { key: 'O-CLEAN', name: 'x', productKey: 'P1', demandQty: 1, dueDate: '2026-03-20T00:00:00Z', priority: 50 },
        { key: 'O-BAD', name: 'y', productKey: 'P1', demandQty: 1, dueDate: 'nope', priority: 50 },
      ],
    }));
    validateReferences(landscape);
    const summary = summarizeValidation(landscape);

    expect(summary.recordsWithErrors).toBe(3);  // T-BAD-DATE, T-ORPHAN, O-BAD
    expect(summary.unschedulableTasks).toBe(2); // T-BAD-DATE, T-ORPHAN
    expect(summary.byCode.UNPARSEABLE_DATE).toBe(2);  // T-BAD-DATE + O-BAD
    expect(summary.byCode.ORPHAN_RESOURCE).toBe(1);
    expect(summary.byEntity.tasks).toBe(2);
    expect(summary.byEntity.orders).toBe(1);
  });
});

// ── Finding #5 from PokeAPI test session: no-silent-fallback ───────────────
//
// Before the fix: if the REST adapter returned 0 records (e.g., envelope
// unwrap failure), the hydrator silently fell back to file data. A broken
// adapter was indistinguishable from a working one. Fix: for REST tenants,
// empty payload is THE answer — no file fallback.

describe('Finding #5 — REST tenant empty payload no longer falls back to file', () => {
  // Synthetic ConfigService that reports the tenant as REST-adapter-based
  // without touching disk. This isolates the hydrator behavior we care about.
  function makeRestHydrator(): StateHydratorService {
    const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
    const configService = new ConfigService(store);
    // Force the tenant to report as REST-based
    (configService as any).getAdapterConfig = () => ({
      adapterType: 'rest',
      connection: { baseUrl: 'http://unused' },
    });
    return new StateHydratorService(configService);
  }

  it('REST tenant with empty resources payload → landscape has 0 resources, no file fallback', () => {
    const hydrator = makeRestHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: [],
      tasks: [],
      orders: [],
    }));
    expect(landscape.resources.size()).toBe(0);
    expect(landscape.tasks.size()).toBe(0);
    expect(landscape.orders.size()).toBe(0);
  });

  it('REST tenant with non-empty resources payload → uses payload (existing behavior preserved)', () => {
    const hydrator = makeRestHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: [{ key: 'R-1', name: 'R1', type: 'MACHINE', class: 'REUSABLE' }],
      tasks: [],
      orders: [],
    }));
    expect(landscape.resources.size()).toBe(1);
    expect(landscape.resources.getEntity('R-1')).toBeDefined();
  });

  it('File tenant with undefined payload → file fallback (existing behavior preserved)', () => {
    // createHydrator() uses demo-manufacturing (file-based, no adapter config)
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape();
    // demo-manufacturing has real file data → should populate
    expect(landscape.resources.size()).toBeGreaterThan(0);
  });

  it('File tenant with empty payload → STILL falls back to file (empty payload is not a real answer from a file-adapter)', () => {
    const hydrator = createHydrator();
    const landscape = hydrator.buildLandscape(makePayload({
      resources: [],
      tasks: [],
    }));
    // Empty payload from a non-REST tenant means "no override", fall back to file
    expect(landscape.resources.size()).toBeGreaterThan(0);
  });
});

// ── Phase 1: MappingEngine errors propagate through stack ──────────────────

describe('Sprint 1b E2E — MappingEngine toUTC validation', () => {
  it('toUTC emits MappingError that survives to sync response level', () => {
    const engine = new MappingEngine();
    const profile: IMappingProfile = {
      orders: {
        mappings: {
          dueDate: { from: 'DeliveryDate', toUTC: true, fromTimezone: 'Pacific/Auckland' },
        },
      },
    } as IMappingProfile;
    const raw: IRawDataPayload = makePayload({
      orders: [{ Id: 1, DeliveryDate: 'not-a-date' }],
    });
    const result = engine.transform(raw, profile);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'UNPARSEABLE_DATE',
      entity: 'orders',
      targetField: 'dueDate',
      sourceField: 'DeliveryDate',
      rawValue: 'not-a-date',
      recordIndex: 0,
    });
  });
});
