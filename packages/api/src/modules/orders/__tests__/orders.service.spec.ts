import { describe, it, expect } from 'vitest';
import { CTPDateTime } from '@ctp/engine';
import { OrdersService, ListOrdersParams } from '../orders.service';
import { OrdersController } from '../orders.controller';
import { IOrderData } from '../../../config/interfaces/config-store.interface';

// ── What this covers ─────────────────────────────────────────────────────────
//
// The orders grid joins three things that used to be one: config data, the
// customer promise off the mapped order, and the projected span off the SOLVED
// landscape. The status column is now derived from CTP's own schedule rather
// than from Genius's dates, which is a behaviour change big enough to pin down:
// on the 16 July book the old rule put 101 orders in LATE that CTP projects
// comfortably on time.
//
// Three areas, all previously untested:
//   1. projectedSpans()  — the landscape → order-span rollup
//   2. deriveStatuses()  — LATE / AT_RISK / ON_TRACK / null from the projection
//   3. resolveValue() + sortRows() — the CTP-derived columns being sortable,
//      filterable, and putting empties last in BOTH directions
//
// ── Time handling in these fixtures ──────────────────────────────────────────
//
// Everything is expressed in engine seconds off CTPDateTime.baseDate and the
// promise ISO is round-tripped back out of the same number. That keeps the
// arithmetic exact and machine-timezone / DST independent: the service compares
// Date.parse(promiseIso) against CTPDateTime.toDateTime(span.end).toMillis(),
// and both sides here derive from one instant.

const DAY = 86400;            // seconds
const DAY_MS = 86400000;

/** Engine seconds for a local wall-clock instant. */
const w = (isoLocal: string): number => CTPDateTime.fromDateTime(isoLocal);

/** Midnight at the START of the promised day — how sales-order DateCustomer arrives. */
const PROMISE_W = w('2026-09-10T00:00:00');
const PROMISE_ISO = CTPDateTime.toDateTime(PROMISE_W).toISO()!;

/** The commitment runs to the END of the promised day, i.e. promise + 24h. */
const DEADLINE_W = PROMISE_W + DAY;

const isoAt = (sec: number): string => CTPDateTime.toDateTime(sec).toISO()!;

// ── Fixture builders ─────────────────────────────────────────────────────────

interface FakeTask {
  linkId?: { name: string };
  scheduled?: { startW: number; endW: number } | null;
}

/**
 * Minimal stand-in for landscape.tasks (an EntityHashMap). Its forEach hands
 * the callback (value, key, map); the service reads only the value.
 */
function fakeLandscape(tasks: FakeTask[]) {
  return {
    tasks: {
      forEach: (cb: (t: FakeTask, k: string, m: unknown) => void) =>
        tasks.forEach((t, i) => cb(t, String(i), null)),
    },
  };
}

/** A scheduled task belonging to `orderKey`. linkId.name IS the order ref. */
const task = (orderKey: string, startW: number, endW: number): FakeTask => ({
  linkId: { name: orderKey },
  scheduled: { startW, endW },
});

function order(key: string, over: Record<string, unknown> = {}): IOrderData {
  return {
    key,
    name: `Order ${key}`,
    productKey: 'PROD-1',
    demandQty: 10,
    dueDate: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** An order carrying the customer promise (sales-order DateCustomer). */
const promised = (key: string, over: Record<string, unknown> = {}): IOrderData =>
  order(key, { customerDeliveryDate: PROMISE_ISO, ...over });

/**
 * `tasks: null` means no landscape at all — the pre-first-solve state.
 */
function makeService(
  orders: IOrderData[],
  tasks: FakeTask[] | null = [],
  groups: Record<string, unknown>[] = [],
): OrdersService {
  const configService = {
    getOrders: () => orders,
    getWorkOrderGroupsData: () => groups,
  };
  const stateService = {
    getLandscape: () => (tasks === null ? null : fakeLandscape(tasks)),
  };
  return new OrdersService(configService as any, stateService as any);
}

const list = (svc: OrdersService, over: Partial<ListOrdersParams> = {}) =>
  svc.listOrders({
    filters: {},
    sortBy: 'key',
    sortDir: 'asc',
    page: 1,
    pageSize: 100,
    ...over,
  });

const rowFor = (svc: OrdersService, key: string) =>
  list(svc).rows.find((r) => r.key === key)!;

const keysInOrder = (svc: OrdersService, over: Partial<ListOrdersParams>) =>
  list(svc, over).rows.map((r) => r.key);

// ── 1. Projected span rollup ─────────────────────────────────────────────────

describe('OrdersService — projected span from the solved landscape', () => {
  it('spans the earliest start and latest end across all of an order\'s tasks', () => {
    const svc = makeService(
      [order('WO-1')],
      [
        task('WO-1', PROMISE_W + 5 * DAY, PROMISE_W + 6 * DAY),
        task('WO-1', PROMISE_W + 1 * DAY, PROMISE_W + 2 * DAY),   // earliest start
        task('WO-1', PROMISE_W + 3 * DAY, PROMISE_W + 9 * DAY),   // latest end
      ],
    );
    const row = rowFor(svc, 'WO-1');
    expect(row.projectedStart).toBe(isoAt(PROMISE_W + 1 * DAY));
    expect(row.projectedEnd).toBe(isoAt(PROMISE_W + 9 * DAY));
  });

  it('is null for every order before the first solve (no landscape)', () => {
    const svc = makeService([promised('WO-1')], null);
    const row = rowFor(svc, 'WO-1');
    expect(row.projectedStart).toBeNull();
    expect(row.projectedEnd).toBeNull();
    // ...and with nothing projected there is no verdict to render.
    expect(row.statusLabel).toBeNull();
  });

  it('is null for an order with no tasks in the landscape', () => {
    const svc = makeService(
      [promised('WO-1'), promised('WO-2')],
      [task('WO-2', PROMISE_W, PROMISE_W + DAY)],
    );
    expect(rowFor(svc, 'WO-1').projectedEnd).toBeNull();
    expect(rowFor(svc, 'WO-2').projectedEnd).not.toBeNull();
  });

  it('ignores unscheduled tasks — no scheduled block, or zeroed start/end', () => {
    const svc = makeService(
      [order('WO-1')],
      [
        { linkId: { name: 'WO-1' } },                                  // never scheduled
        { linkId: { name: 'WO-1' }, scheduled: null },
        task('WO-1', 0, 0),
        task('WO-1', PROMISE_W + 2 * DAY, PROMISE_W + 3 * DAY),        // the only real one
      ],
    );
    const row = rowFor(svc, 'WO-1');
    expect(row.projectedStart).toBe(isoAt(PROMISE_W + 2 * DAY));
    expect(row.projectedEnd).toBe(isoAt(PROMISE_W + 3 * DAY));
  });

  it('ignores a half-zeroed task — both ends must be positive to contribute', () => {
    // Note the divergence from ctp.service.ts, which folds in each end
    // independently. Here a task missing either end contributes neither.
    const svc = makeService(
      [order('WO-1')],
      [
        task('WO-1', PROMISE_W - 10 * DAY, 0),                         // no end → skipped whole
        task('WO-1', PROMISE_W + 2 * DAY, PROMISE_W + 3 * DAY),
      ],
    );
    expect(rowFor(svc, 'WO-1').projectedStart).toBe(isoAt(PROMISE_W + 2 * DAY));
  });

  it('ignores tasks with no order ref', () => {
    const svc = makeService(
      [order('WO-1')],
      [
        { scheduled: { startW: PROMISE_W, endW: PROMISE_W + DAY } },   // no linkId
        { linkId: { name: '' }, scheduled: { startW: PROMISE_W, endW: PROMISE_W + DAY } },
      ],
    );
    expect(rowFor(svc, 'WO-1').projectedEnd).toBeNull();
  });
});

// ── 2. Status derivation ─────────────────────────────────────────────────────

describe('OrdersService — status from CTP\'s projection', () => {
  /** One promised order whose projection ends `offset` seconds past the deadline. */
  const withEnd = (endW: number, over: Record<string, unknown> = {}) =>
    makeService([promised('WO-1', over)], [task('WO-1', PROMISE_W - 10 * DAY, endW)]);

  const statusOf = (svc: OrdersService) => rowFor(svc, 'WO-1').statusLabel;

  it('LATE when projected completion runs past the end of the promised day', () => {
    expect(statusOf(withEnd(DEADLINE_W + 2 * DAY))).toBe('LATE');
  });

  it('LATE by even a second past the deadline', () => {
    expect(statusOf(withEnd(DEADLINE_W + 1))).toBe('LATE');
  });

  it('is NOT late when work finishes during the promised day', () => {
    // The regression this rule fixed: the promise is midnight at the START of
    // the day, so comparing against the raw timestamp called 8 same-day
    // completions late.
    expect(statusOf(withEnd(PROMISE_W + 12 * 3600))).toBe('AT_RISK');
  });

  it('is NOT late landing exactly on the deadline', () => {
    expect(statusOf(withEnd(DEADLINE_W))).toBe('AT_RISK');
  });

  it('AT_RISK at exactly the slack threshold (5 days)', () => {
    expect(statusOf(withEnd(DEADLINE_W - 5 * DAY))).toBe('AT_RISK');
  });

  it('ON_TRACK one second beyond the slack threshold', () => {
    expect(statusOf(withEnd(DEADLINE_W - 5 * DAY - 1))).toBe('ON_TRACK');
  });

  it('ON_TRACK with comfortable slack', () => {
    expect(statusOf(withEnd(DEADLINE_W - 30 * DAY))).toBe('ON_TRACK');
  });

  it('is null with no customer promise — internal / stock / rework work', () => {
    const svc = makeService(
      [order('WO-1')],                                                 // no customerDeliveryDate
      [task('WO-1', PROMISE_W, PROMISE_W + 400 * DAY)],                // wildly "late" by any date
    );
    expect(rowFor(svc, 'WO-1').statusLabel).toBeNull();
  });

  it('is null when the promise is unparseable', () => {
    const svc = makeService(
      [order('WO-1', { customerDeliveryDate: 'not-a-date' })],
      [task('WO-1', PROMISE_W, PROMISE_W + DAY)],
    );
    expect(rowFor(svc, 'WO-1').statusLabel).toBeNull();
  });

  it('COMPLETED and CANCELLED win over the projection', () => {
    // Lifecycle facts about the work order beat predictions about it — even a
    // wildly late projection must not overwrite them.
    const lateEnd = DEADLINE_W + 90 * DAY;
    for (const [wostatus, expected] of [
      ['COMPLETED', 'COMPLETED'],
      ['complete', 'COMPLETED'],
      ['CANCELLED', 'CANCELLED'],
      ['canceled', 'CANCELLED'],
    ] as const) {
      const svc = makeService(
        [promised('WO-1', { wostatus })],
        [task('WO-1', PROMISE_W, lateEnd)],
      );
      expect(rowFor(svc, 'WO-1').statusLabel).toBe(expected);
    }
  });

  it('COMPLETED still applies with no promise and no projection', () => {
    const svc = makeService([order('WO-1', { wostatus: 'COMPLETED' })], null);
    expect(rowFor(svc, 'WO-1').statusLabel).toBe('COMPLETED');
  });

  // ── Regression guards on the old Genius-date rule ──────────────────────────

  it('does not call an order LATE just because the Genius group end is in the past', () => {
    // The old rule: group.sourceEnd < now → LATE. This is exactly the shape
    // that produced 101 false LATEs on the 16 July book.
    const svc = makeService(
      [promised('WO-1', { groupKey: 'JOB-1' })],
      [task('WO-1', PROMISE_W - 40 * DAY, DEADLINE_W - 30 * DAY)],
      [{ key: 'JOB-1', name: 'Job 1', sourceEnd: '2020-01-01T00:00:00.000Z' }],
    );
    expect(rowFor(svc, 'WO-1').statusLabel).toBe('ON_TRACK');
  });

  it('does call an order LATE when Genius thinks it is fine but CTP projects a miss', () => {
    const svc = makeService(
      [promised('WO-1', { groupKey: 'JOB-1' })],
      [task('WO-1', PROMISE_W, DEADLINE_W + 10 * DAY)],
      [{
        key: 'JOB-1',
        name: 'Job 1',
        sourceEnd: '2099-01-01T00:00:00.000Z',
        promiseDate: '2099-01-01T00:00:00.000Z',
      }],
    );
    expect(rowFor(svc, 'WO-1').statusLabel).toBe('LATE');
  });
});

// ── 3. Row projection ────────────────────────────────────────────────────────

describe('OrdersService — row projection', () => {
  it('carries the promise and both projections onto the row', () => {
    const svc = makeService(
      [promised('WO-1', { groupKey: 'JOB-1', parentOrderKey: 'WO-1' })],
      [task('WO-1', PROMISE_W - 3 * DAY, PROMISE_W + 4 * DAY)],
      [{ key: 'JOB-1', name: 'Job One', sourceEnd: '2026-09-30T00:00:00.000Z' }],
    );
    const row = rowFor(svc, 'WO-1');
    expect(row.customerDeliveryDate).toBe(PROMISE_ISO);
    expect(row.projectedStart).toBe(isoAt(PROMISE_W - 3 * DAY));
    expect(row.projectedEnd).toBe(isoAt(PROMISE_W + 4 * DAY));
    // Untouched neighbours still project as before.
    expect(row.groupName).toBe('Job One');
    expect(row.isHead).toBe(true);
    expect(row.quantityPlanned).toBe(10);
  });

  it('nulls the promise on orders that have none', () => {
    const svc = makeService([order('WO-1')], []);
    expect(rowFor(svc, 'WO-1').customerDeliveryDate).toBeNull();
  });

  it('reports totalCount against the whole book and filteredCount against the filter', () => {
    const svc = makeService(
      [promised('WO-1'), promised('WO-2'), order('WO-3')],
      [
        task('WO-1', PROMISE_W, DEADLINE_W + DAY),        // LATE
        task('WO-2', PROMISE_W, DEADLINE_W - 40 * DAY),   // ON_TRACK
      ],
    );
    const res = list(svc, { filters: { statusLabel: ['LATE'] } });
    expect(res.totalCount).toBe(3);
    expect(res.filteredCount).toBe(1);
    expect(res.rows.map((r) => r.key)).toEqual(['WO-1']);
  });
});

// ── 4. CTP-derived columns: sort, filter, distinct ───────────────────────────

describe('OrdersService — CTP-derived columns are sortable and filterable', () => {
  /**
   * Three promised orders at different overruns, plus one with no promise at
   * all. WO-B is the latest, WO-A the least late, WO-C on time.
   */
  const book = () =>
    makeService(
      [
        promised('WO-A'),
        promised('WO-B'),
        promised('WO-C'),
        order('WO-D'),                                     // no customer promise
      ],
      [
        task('WO-A', PROMISE_W, DEADLINE_W + 2 * DAY),     // +2
        task('WO-B', PROMISE_W, DEADLINE_W + 10 * DAY),    // +10
        task('WO-C', PROMISE_W, DEADLINE_W - 30 * DAY),    //  0
        task('WO-D', PROMISE_W, DEADLINE_W + 99 * DAY),    // no promise → not a candidate
      ],
    );

  it('sorts Days Late by magnitude, not lexically', () => {
    // The bug this guards: '10' sorts before '2' as a string. Descending must
    // put the worst offender first.
    expect(keysInOrder(book(), { sortBy: 'daysLate', sortDir: 'desc' }))
      .toEqual(['WO-B', 'WO-A', 'WO-C', 'WO-D']);
    expect(keysInOrder(book(), { sortBy: 'daysLate', sortDir: 'asc' }))
      .toEqual(['WO-C', 'WO-A', 'WO-B', 'WO-D']);
  });

  it('sorts by projected end', () => {
    expect(keysInOrder(book(), { sortBy: 'projectedEnd', sortDir: 'asc' }))
      .toEqual(['WO-C', 'WO-A', 'WO-B', 'WO-D']);
  });

  it('sorts by the column\'s UI label as well as its id', () => {
    // The grid can send either; a miss here silently no-ops while the header
    // still draws its sort arrow.
    expect(keysInOrder(book(), { sortBy: 'Days Late', sortDir: 'desc' }))
      .toEqual(keysInOrder(book(), { sortBy: 'daysLate', sortDir: 'desc' }));
    expect(keysInOrder(book(), { sortBy: 'Projected End', sortDir: 'asc' }))
      .toEqual(keysInOrder(book(), { sortBy: 'projectedEnd', sortDir: 'asc' }));
    expect(keysInOrder(book(), { sortBy: 'Customer Promise', sortDir: 'asc' }))
      .toEqual(keysInOrder(book(), { sortBy: 'customerDeliveryDate', sortDir: 'asc' }));
  });

  it('counts an overrun of part of a day as a full day late', () => {
    const svc = makeService(
      [promised('WO-1')],
      [task('WO-1', PROMISE_W, DEADLINE_W + 3600)],        // one hour over
    );
    expect(svc.distinct({ column: 'daysLate', filters: {}, limit: 50 }).values)
      .toEqual([{ value: '1', count: 1 }]);
  });

  it('reports zero — not a negative — for orders that make their promise', () => {
    const svc = makeService(
      [promised('WO-1')],
      [task('WO-1', PROMISE_W, DEADLINE_W - 60 * DAY)],
    );
    expect(svc.distinct({ column: 'daysLate', filters: {}, limit: 50 }).values)
      .toEqual([{ value: '0', count: 1 }]);
  });

  it('filters on the derived status', () => {
    const res = list(book(), { filters: { Status: ['LATE'] } });
    expect(res.rows.map((r) => r.key)).toEqual(['WO-A', 'WO-B']);
  });

  it('filters unassessable rows via the (none) sentinel', () => {
    const res = list(book(), { filters: { statusLabel: ['(none)'] } });
    expect(res.rows.map((r) => r.key)).toEqual(['WO-D']);
  });

  it('filters on the customer promise', () => {
    const res = list(book(), { filters: { customerDeliveryDate: [PROMISE_ISO] } });
    expect(res.rows.map((r) => r.key)).toEqual(['WO-A', 'WO-B', 'WO-C']);
  });

  it('surfaces missing promises as a null distinct value, not a crash', () => {
    const res = book().distinct({ column: 'customerDeliveryDate', filters: {}, limit: 50 });
    expect(res.values).toContainEqual({ value: null, count: 1 });
    expect(res.values).toContainEqual({ value: PROMISE_ISO, count: 3 });
  });

  it('scopes distincts Excel-style — a column\'s own filter does not narrow its list', () => {
    const res = book().distinct({
      column: 'statusLabel',
      filters: { statusLabel: ['LATE'] },
      limit: 50,
    });
    const values = res.values.map((v) => v.value);
    expect(values).toContain('LATE');
    expect(values).toContain('ON_TRACK');
  });
});

// ── 5. Empties sort last in BOTH directions ──────────────────────────────────

describe('OrdersService — blank values sort last regardless of direction', () => {
  /**
   * Descending used to multiply compareValues' "empty last" by -1, floating
   * every blank to the top. On the real book that buried all 519 populated
   * rows under 129 promise-less ones; dueDate never exposed it because it is
   * always set.
   */
  const mixed = () =>
    makeService(
      [
        promised('WO-EARLY'),
        order('WO-BLANK-2'),
        order('WO-LATEST', { customerDeliveryDate: isoAt(PROMISE_W + 30 * DAY) }),
        order('WO-BLANK-1'),
      ],
      [
        task('WO-EARLY', PROMISE_W, PROMISE_W + DAY),
        task('WO-LATEST', PROMISE_W, PROMISE_W + DAY),
      ],
    );

  it('keeps blanks last when sorting the customer promise ascending', () => {
    expect(keysInOrder(mixed(), { sortBy: 'customerDeliveryDate', sortDir: 'asc' }))
      .toEqual(['WO-EARLY', 'WO-LATEST', 'WO-BLANK-1', 'WO-BLANK-2']);
  });

  it('keeps blanks last when sorting the customer promise descending', () => {
    expect(keysInOrder(mixed(), { sortBy: 'customerDeliveryDate', sortDir: 'desc' }))
      .toEqual(['WO-LATEST', 'WO-EARLY', 'WO-BLANK-1', 'WO-BLANK-2']);
  });

  it('keeps unprojected rows last in both directions', () => {
    const svc = makeService(
      [promised('WO-1'), promised('WO-2'), promised('WO-3')],
      [
        task('WO-1', PROMISE_W, PROMISE_W + 5 * DAY),
        task('WO-3', PROMISE_W, PROMISE_W + 1 * DAY),
        // WO-2 has nothing scheduled.
      ],
    );
    expect(keysInOrder(svc, { sortBy: 'projectedEnd', sortDir: 'asc' }))
      .toEqual(['WO-3', 'WO-1', 'WO-2']);
    expect(keysInOrder(svc, { sortBy: 'projectedEnd', sortDir: 'desc' }))
      .toEqual(['WO-1', 'WO-3', 'WO-2']);
  });

  it('orders the blanks among themselves by key, ascending, in both directions', () => {
    const keys = ['WO-BLANK-1', 'WO-BLANK-2'];
    expect(keysInOrder(mixed(), { sortBy: 'customerDeliveryDate', sortDir: 'asc' }).slice(-2))
      .toEqual(keys);
    expect(keysInOrder(mixed(), { sortBy: 'customerDeliveryDate', sortDir: 'desc' }).slice(-2))
      .toEqual(keys);
  });

  it('still sorts populated columns in both directions', () => {
    // Guard against the empties rule swallowing the normal path.
    const svc = makeService([order('WO-A'), order('WO-B'), order('WO-C')], []);
    expect(keysInOrder(svc, { sortBy: 'key', sortDir: 'asc' })).toEqual(['WO-A', 'WO-B', 'WO-C']);
    expect(keysInOrder(svc, { sortBy: 'key', sortDir: 'desc' })).toEqual(['WO-C', 'WO-B', 'WO-A']);
  });

  it('paginates the sorted-with-blanks-last order', () => {
    const res = list(mixed(), {
      sortBy: 'customerDeliveryDate',
      sortDir: 'desc',
      page: 2,
      pageSize: 2,
    });
    expect(res.rows.map((r) => r.key)).toEqual(['WO-BLANK-1', 'WO-BLANK-2']);
    expect(res.filteredCount).toBe(4);
  });
});

// ── 6. Controller query parsing ──────────────────────────────────────────────

describe('OrdersController — query clamping', () => {
  /** 12 orders, keys WO-01..WO-12, so pages of 5 are easy to eyeball. */
  const controller = () => {
    const orders = Array.from({ length: 12 }, (_, i) =>
      order(`WO-${String(i + 1).padStart(2, '0')}`));
    return new OrdersController(makeService(orders, []));
  };

  const pageKeys = (page: string, pageSize = '5') =>
    controller().list({ page, pageSize, sortBy: 'key', sortDir: 'asc' }).rows.map((r) => r.key);

  it('serves distinct slices for successive pages', () => {
    // The bug: `page` was clamped with a max of 1, so every page returned the
    // first slice and the grid's Next button appeared to do nothing.
    expect(pageKeys('1')).toEqual(['WO-01', 'WO-02', 'WO-03', 'WO-04', 'WO-05']);
    expect(pageKeys('2')).toEqual(['WO-06', 'WO-07', 'WO-08', 'WO-09', 'WO-10']);
    expect(pageKeys('3')).toEqual(['WO-11', 'WO-12']);
  });

  it('covers the whole book across pages with no gaps or repeats', () => {
    const seen = [...pageKeys('1'), ...pageKeys('2'), ...pageKeys('3')];
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('returns an empty page past the end rather than wrapping to the first', () => {
    expect(pageKeys('99')).toEqual([]);
  });

  it('falls back to page 1 for missing, zero, negative, and junk values', () => {
    const first = pageKeys('1');
    for (const bad of ['', '0', '-3', 'abc']) {
      expect(pageKeys(bad)).toEqual(first);
    }
    expect(controller().list({ sortBy: 'key', sortDir: 'asc' }).page).toBe(1);
  });

  it('still caps pageSize at 500', () => {
    const res = controller().list({ page: '1', pageSize: '99999' });
    expect(res.pageSize).toBe(500);
  });

  it('defaults pageSize to 100', () => {
    expect(controller().list({}).pageSize).toBe(100);
  });

  it('echoes the requested page back to the client', () => {
    expect(controller().list({ page: '3', pageSize: '5' }).page).toBe(3);
  });
});
