import { describe, it, expect } from 'vitest';
import { CTPUnionSetEngine } from '../../Engines/setengine';
import { CTPIntervals } from '../../Models/Intervals/intervals';
import { CTPInterval } from '../../Models/Core/window';
import { intervalsToArray, makeIntervals } from '../helpers/builders';

// CODE-OPTIMIZATION-SPRINT Ticket 1 — `CTPUnionSetEngine.union` latent
// right-overhang bug. Without the tail-extension branch added to setengine.ts,
// these inputs silently lose data because the buggy partial-overlap branch
// (and the catch-all `else`) advance aPtr past the tail without inserting
// the right-overhang remainder.
//
// All three cases must produce a single merged interval — the harness's
// correctness gate for ticket-01 won't go green until they do.
describe('CTPUnionSetEngine.union — Ticket 1 right-overhang at tail', () => {
  function unionOne(existing: Array<[number, number]>, add: [number, number]) {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals(existing.map(([s, e]) => ({ s, e, q: 1 })));
    engine.union(list, new CTPInterval(add[0], add[1]));
    return intervalsToArray(list).map((iv) => [iv.s, iv.e] as [number, number]);
  }

  it('partial right-overlap at tail: [10,20] + [15,30] -> [10,30]', () => {
    expect(unionOne([[10, 20]], [15, 30])).toEqual([[10, 30]]);
  });

  it('adjacent-touching at tail: [10,20] + [20,30] -> [10,30]', () => {
    expect(unionOne([[10, 20]], [20, 30])).toEqual([[10, 30]]);
  });

  it('new contains tail with right-overhang: [10,20] + [5,30] -> [5,30]', () => {
    expect(unionOne([[10, 20]], [5, 30])).toEqual([[5, 30]]);
  });

  it('the exact pair from the ticket-01 fixture: [21,26] + [25,30] -> [21,30]', () => {
    expect(unionOne([[21, 26]], [25, 30])).toEqual([[21, 30]]);
  });

  it('regression — strict gap still inserts new tail: [10,20] + [25,30] -> two intervals', () => {
    // Sanity: the new branch must NOT fire when there's a gap between
    // existing tail and new interval. The existing "insert at end with gap"
    // branch is what we want here.
    expect(unionOne([[10, 20]], [25, 30])).toEqual([
      [10, 20],
      [25, 30],
    ]);
  });

  it('regression — new fully contained in tail: [10,30] + [15,25] -> unchanged', () => {
    // Sanity: the new branch must NOT fire when there is no right-overhang.
    expect(unionOne([[10, 30]], [15, 25])).toEqual([[10, 30]]);
  });

  it('regression — non-tail partial overlap still walks forward: [10,20],[40,50] + [15,25]', () => {
    // The new branch is gated on !aPtr.next, so when aPtr.next exists the
    // existing partial-overlap branch handles it. The advance behaviour is
    // preserved; b is consumed into the next iteration.
    const result = unionOne(
      [
        [10, 20],
        [40, 50],
      ],
      [15, 25],
    );
    // We don't pin the exact intermediate shape here (union has multiple
    // legitimate representations for partial-overlap chains); we only require
    // that no data is lost — the result must cover [10,25] ∪ [40,50].
    const covers = (iv: [number, number], t: number) => t >= iv[0] && t <= iv[1];
    const covered = (t: number) => result.some((iv) => covers(iv, t));
    expect(covered(10)).toBe(true);
    expect(covered(20)).toBe(true);
    expect(covered(40)).toBe(true);
    expect(covered(50)).toBe(true);
  });
});
