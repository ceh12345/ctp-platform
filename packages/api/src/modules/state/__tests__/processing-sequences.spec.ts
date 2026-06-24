/**
 * Processing Sequences — composite weighted ranking + source-shaped path resolution
 * (SPRINT-processing-sequences). Unit-tests StateHydratorService.computeProcessingRanks.
 */
import { describe, it, expect } from 'vitest';
import { StateHydratorService } from '../state-hydrator.service';
import { CTPOrder } from '@ctp/engine';

function mkOrder(key: string, groupKey: string | null, dueDate: number, salesOrder: string | null): CTPOrder {
  const o = new CTPOrder('Order', key, key);
  o.groupKey = groupKey;
  o.dueDate = dueDate;
  o.rawFields = {
    hierarchies: salesOrder === null ? [] : [{ slot: 3, name: 'SalesOrder', value: salesOrder }],
    attributes: [{ name: 'Strategy', value: 'JIT' }],
  };
  return o;
}

const DELIVERY_FIRST = [{
  name: 'delivery-date-first',
  criteria: [
    { field: 'group.promiseDate', direction: 'asc' as const, importance: 'primary' as const },
    { field: 'hierarchy.SalesOrder', direction: 'asc' as const, importance: 'secondary' as const },
  ],
}];

// G2 promises earlier than G1.
const RAW_GROUPS = new Map<string, Record<string, unknown>>([
  ['G1', { promiseDate: '2026-06-18T12:00:00.000Z' }],
  ['G2', { promiseDate: '2026-06-10T12:00:00.000Z' }],
]);

const order = (rankBy: string) => (a: CTPOrder, b: CTPOrder) => a.processingRanks[rankBy] - b.processingRanks[rankBy];

describe('computeProcessingRanks', () => {
  it('ranks by primary (group.promiseDate asc) then secondary (hierarchy.SalesOrder asc)', () => {
    const A = mkOrder('A', 'G1', 0, '00012361'); // later promise
    const B = mkOrder('B', 'G2', 0, '00012160'); // earlier promise, lower SO
    const C = mkOrder('C', 'G2', 0, '00012999'); // earlier promise, higher SO
    const orders = [A, B, C];
    StateHydratorService.computeProcessingRanks(orders, RAW_GROUPS, DELIVERY_FIRST as any);

    // earlier promiseDate (G2) before later (G1); within G2, lower SalesOrder first
    expect([...orders].sort(order('delivery-date-first')).map(o => o.key)).toEqual(['B', 'C', 'A']);
  });

  it('primary dominates secondary (skewed importance weights)', () => {
    // A: earliest promise but highest SO; B: latest promise but lowest SO.
    const A = mkOrder('A', 'G2', 0, '99999999'); // earliest promise
    const B = mkOrder('B', 'G1', 0, '00000001'); // latest promise, tiny SO
    StateHydratorService.computeProcessingRanks([A, B], RAW_GROUPS, DELIVERY_FIRST as any);
    // primary (promiseDate) wins → A first despite its huge SalesOrder
    expect(A.processingRanks['delivery-date-first']).toBeLessThan(B.processingRanks['delivery-date-first']);
  });

  it('nullsHandling: a missing secondary value sorts last within its primary tier', () => {
    const B = mkOrder('B', 'G2', 0, '00012160');
    const C = mkOrder('C', 'G2', 0, '00012999');
    const D = mkOrder('D', 'G2', 0, null);       // missing SalesOrder → sorts last (default)
    StateHydratorService.computeProcessingRanks([B, C, D], RAW_GROUPS, DELIVERY_FIRST as any);
    expect([B, C, D].sort(order('delivery-date-first')).map(o => o.key)).toEqual(['B', 'C', 'D']);
  });

  it('platform default sequence ranks by order.dueDate asc', () => {
    const seq = [{ name: 'platform-default', criteria: [{ field: 'order.dueDate', direction: 'asc' as const, importance: 'primary' as const }] }];
    const late = mkOrder('late', null, 300, null);
    const early = mkOrder('early', null, 100, null);
    StateHydratorService.computeProcessingRanks([late, early], new Map(), seq as any);
    expect(early.processingRanks['platform-default']).toBeLessThan(late.processingRanks['platform-default']);
  });

  it('explicit weights are honoured (equal weights → secondary can flip a near-tie)', () => {
    const seq = [{ name: 'eq', criteria: [
      { field: 'group.promiseDate', direction: 'asc' as const, weight: 1 },
      { field: 'hierarchy.SalesOrder', direction: 'asc' as const, weight: 1 },
    ] }];
    const B = mkOrder('B', 'G2', 0, '00012160');
    const C = mkOrder('C', 'G2', 0, '00012999');
    StateHydratorService.computeProcessingRanks([B, C], RAW_GROUPS, seq as any);
    expect(B.processingRanks['eq']).toBeLessThan(C.processingRanks['eq']); // same date, lower SO first
  });

  it('a second sequence selects a different ordering (AC#8)', () => {
    const A = mkOrder('A', 'G1', 0, '00000001'); // later promise, lowest SalesOrder
    const B = mkOrder('B', 'G2', 0, '00000009'); // earlier promise, higher SalesOrder
    const seqs = [
      DELIVERY_FIRST[0],
      { name: 'salesorder-first', criteria: [{ field: 'hierarchy.SalesOrder', direction: 'asc' as const, importance: 'primary' as const }] },
    ];
    StateHydratorService.computeProcessingRanks([A, B], RAW_GROUPS, seqs as any);
    expect([A, B].sort(order('delivery-date-first')).map(o => o.key)).toEqual(['B', 'A']); // earlier promise wins
    expect([A, B].sort(order('salesorder-first')).map(o => o.key)).toEqual(['A', 'B']);   // lower SalesOrder wins
  });
});

describe('validateProcessingSequences', () => {
  const valid = [{ name: 's', criteria: [{ field: 'order.dueDate', importance: 'primary' as const }] }];
  it('accepts a valid config', () => {
    expect(() => StateHydratorService.validateProcessingSequences(valid as any, 's')).not.toThrow();
  });
  it('rejects duplicate sequence names', () => {
    expect(() => StateHydratorService.validateProcessingSequences([valid[0], valid[0]] as any)).toThrow(/duplicate/);
  });
  it('rejects a defaultSequence that is not defined', () => {
    expect(() => StateHydratorService.validateProcessingSequences(valid as any, 'nope')).toThrow(/defaultSequence/);
  });
  it('rejects a criterion with both weight and importance', () => {
    expect(() => StateHydratorService.validateProcessingSequences(
      [{ name: 'x', criteria: [{ field: 'order.dueDate', importance: 'primary', weight: 1 }] }] as any)).toThrow(/exactly one/);
  });
  it('rejects a criterion with neither weight nor importance', () => {
    expect(() => StateHydratorService.validateProcessingSequences(
      [{ name: 'x', criteria: [{ field: 'order.dueDate' }] }] as any)).toThrow(/exactly one/);
  });
  it('rejects an invalid importance value', () => {
    expect(() => StateHydratorService.validateProcessingSequences(
      [{ name: 'x', criteria: [{ field: 'order.dueDate', importance: 'huge' }] }] as any)).toThrow(/invalid importance/);
  });
});
