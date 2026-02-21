import { describe, it, expect } from 'vitest';
import {
  clipDuration,
  walkForward,
  walkBackward,
  accumulateRangeValues,
} from '../../Models/Core/interval-walker';
import { CTPInterval } from '../../Models/Core/window';
import { CTPIntervals } from '../../Models/Intervals/intervals';

function makeIntervalsList(specs: { s: number; e: number; q?: number; r?: number }[]): CTPIntervals {
  const list = new CTPIntervals();
  for (const spec of specs) {
    const iv = new CTPInterval(spec.s, spec.e, spec.q);
    if (spec.r !== undefined) iv.runRate = spec.r;
    list.add(iv);
  }
  return list;
}

// ═══════════════════════════════════════════════════════════════
// clipDuration
// ═══════════════════════════════════════════════════════════════

describe('clipDuration', () => {
  it('interval fully inside range → full duration', () => {
    const iv = new CTPInterval(20, 60, 5);
    expect(clipDuration(iv, 0, 100, false)).toBe(40);
  });

  it('interval extends past rangeEnd → clipped', () => {
    const iv = new CTPInterval(0, 100, 5);
    expect(clipDuration(iv, 0, 60, false)).toBe(60);
  });

  it('interval extends before rangeStart → clipped', () => {
    const iv = new CTPInterval(0, 100, 5);
    expect(clipDuration(iv, 30, 100, false)).toBe(70);
  });

  it('both ends clipped', () => {
    const iv = new CTPInterval(0, 100, 5);
    expect(clipDuration(iv, 20, 80, false)).toBe(60);
  });

  it('with runRate multiplier', () => {
    const iv = new CTPInterval(0, 100, 5);
    iv.runRate = 0.5;
    expect(clipDuration(iv, 0, 100, true)).toBe(50); // 100 * 0.5
  });

  it('with runRate and clipping', () => {
    const iv = new CTPInterval(0, 100, 5);
    iv.runRate = 2.0;
    expect(clipDuration(iv, 20, 80, true)).toBe(120); // 60 * 2.0
  });

  it('null runRate with useRunRate → 0', () => {
    const iv = new CTPInterval(0, 100, 5);
    // runRate is null by default
    expect(clipDuration(iv, 0, 100, true)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// walkForward
// ═══════════════════════════════════════════════════════════════

describe('walkForward', () => {
  it('single interval, exact fit', () => {
    const list = makeIntervalsList([{ s: 0, e: 100, q: 5 }]);
    const result = walkForward(list.head, list.tail, 100, 0, 100, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(0);
    expect(result.end).toBe(100);
  });

  it('single interval, partial consumption', () => {
    const list = makeIntervalsList([{ s: 0, e: 100, q: 5 }]);
    const result = walkForward(list.head, list.tail, 50, 0, 100, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(0);
    expect(result.end).toBe(50);
  });

  it('single interval, insufficient → infeasible', () => {
    const list = makeIntervalsList([{ s: 0, e: 10, q: 5 }]);
    const result = walkForward(list.head, list.tail, 50, 0, 10, false, false);

    expect(result.feasible).toBe(false);
  });

  it('multiple intervals, float accumulation', () => {
    const list = makeIntervalsList([
      { s: 0, e: 10, q: 5 },
      { s: 20, e: 30, q: 5 },
      { s: 40, e: 50, q: 5 },
    ]);
    const result = walkForward(list.head, list.tail, 25, 0, 50, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(0);
    expect(result.end).toBe(45);
  });

  it('fixed reset: first interval too small, skips to second', () => {
    const list = makeIntervalsList([
      { s: 0, e: 5, q: 5 },
      { s: 10, e: 30, q: 5 },
    ]);
    const result = walkForward(list.head, list.tail, 10, 0, 30, false, true);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(10);
    expect(result.end).toBe(20);
  });

  it('fixed reset: all intervals too small → infeasible', () => {
    const list = makeIntervalsList([
      { s: 0, e: 5, q: 5 },
      { s: 10, e: 14, q: 5 },
    ]);
    const result = walkForward(list.head, list.tail, 10, 0, 14, false, true);

    expect(result.feasible).toBe(false);
  });

  it('zero consumed → feasible immediately', () => {
    const list = makeIntervalsList([{ s: 0, e: 100, q: 5 }]);
    const result = walkForward(list.head, list.tail, 0, 0, 100, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(0);
    expect(result.end).toBe(100); // initialized to endW, inner loop doesn't execute
  });

  it('with runRate', () => {
    const list = makeIntervalsList([
      { s: 0, e: 50, q: 5, r: 1.0 },
      { s: 50, e: 100, q: 5, r: 1.0 },
    ]);
    const result = walkForward(list.head, list.tail, 75, 0, 100, true, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(0);
    expect(result.end).toBe(75);
  });

  it('clipped range boundaries', () => {
    const list = makeIntervalsList([{ s: 0, e: 100, q: 5 }]);
    const result = walkForward(list.head, list.tail, 50, 0, 100, false, false);
    // rangeStart=0, rangeEnd=100 → no clipping
    expect(result.feasible).toBe(true);
    expect(result.end).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// walkBackward
// ═══════════════════════════════════════════════════════════════

describe('walkBackward', () => {
  it('single interval, fits from end', () => {
    const list = makeIntervalsList([{ s: 10, e: 110, q: 5 }]);
    const result = walkBackward(list.tail, list.head, 50, 10, 110, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(60);
    expect(result.end).toBe(110);
  });

  it('single interval, insufficient → infeasible', () => {
    const list = makeIntervalsList([{ s: 10, e: 20, q: 5 }]);
    const result = walkBackward(list.tail, list.head, 50, 10, 20, false, false);

    expect(result.feasible).toBe(false);
  });

  it('multiple intervals, float accumulation backward', () => {
    const list = makeIntervalsList([
      { s: 10, e: 20, q: 5 },
      { s: 20, e: 30, q: 5 },
      { s: 30, e: 40, q: 5 },
    ]);
    const result = walkBackward(list.tail, list.head, 25, 10, 40, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(15);
    expect(result.end).toBe(40);
  });

  it('fixed reset backward: last interval too small', () => {
    const list = makeIntervalsList([
      { s: 10, e: 30, q: 5 },
      { s: 35, e: 40, q: 5 },
    ]);
    const result = walkBackward(list.tail, list.head, 10, 10, 40, false, true);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(20);
    expect(result.end).toBe(30);
  });

  it('zero consumed backward → feasible immediately', () => {
    const list = makeIntervalsList([{ s: 10, e: 110, q: 5 }]);
    const result = walkBackward(list.tail, list.head, 0, 10, 110, false, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(10);
    expect(result.end).toBe(110);
  });

  it('with runRate backward', () => {
    const list = makeIntervalsList([
      { s: 10, e: 60, q: 5, r: 1.0 },
      { s: 60, e: 110, q: 5, r: 1.0 },
    ]);
    const result = walkBackward(list.tail, list.head, 75, 10, 110, true, false);

    expect(result.feasible).toBe(true);
    expect(result.start).toBe(35);
    expect(result.end).toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════
// accumulateRangeValues
// ═══════════════════════════════════════════════════════════════

describe('accumulateRangeValues', () => {
  it('multiple intervals, full coverage', () => {
    const list = makeIntervalsList([
      { s: 0, e: 10, q: 5 },
      { s: 20, e: 30, q: 3 },
      { s: 40, e: 50, q: 7 },
    ]);
    // estPtr to lstPtr exclusive → covers first two intervals
    const result = accumulateRangeValues(list.head, list.tail, 0, 50);

    expect(result.duration).toBe(20);
    expect(result.minAvail).toBe(3);
    expect(result.maxAvail).toBe(5);
    expect(result.runRateQty).toBe(0);
  });

  it('partial overlap: st clips first interval', () => {
    const list = makeIntervalsList([
      { s: 0, e: 10, q: 5 },
      { s: 20, e: 30, q: 3 },
      { s: 40, e: 50, q: 7 },
    ]);
    const result = accumulateRangeValues(list.head, list.tail, 5, 50);

    expect(result.duration).toBe(15); // 5 + 10
    expect(result.minAvail).toBe(3);
    expect(result.maxAvail).toBe(5);
  });

  it('partial overlap: et clips last covered interval', () => {
    const list = makeIntervalsList([
      { s: 0, e: 10, q: 5 },
      { s: 20, e: 30, q: 3 },
      { s: 40, e: 50, q: 7 },
    ]);
    const result = accumulateRangeValues(list.head, list.tail, 0, 25);

    expect(result.duration).toBe(15); // 10 + 5
    expect(result.minAvail).toBe(3);
    expect(result.maxAvail).toBe(5);
  });

  it('intervals with runRate', () => {
    const list = makeIntervalsList([
      { s: 0, e: 10, q: 5, r: 2.0 },
      { s: 20, e: 30, q: 3, r: 0.5 },
      { s: 40, e: 50, q: 7 },
    ]);
    const result = accumulateRangeValues(list.head, list.tail, 0, 50);

    expect(result.duration).toBe(20);
    expect(result.runRateQty).toBe(25); // 10*2.0 + 10*0.5
  });

  it('single interval (estPtr === lstPtr) → loop does not execute', () => {
    const list = makeIntervalsList([{ s: 0, e: 100, q: 5 }]);
    const result = accumulateRangeValues(list.head, list.head, 0, 100);

    expect(result.duration).toBe(0);
    expect(result.minAvail).toBe(Number.MAX_VALUE);
    expect(result.maxAvail).toBe(0);
  });

  it('intervals outside st-et range are skipped', () => {
    const list = makeIntervalsList([
      { s: 0, e: 10, q: 5 },
      { s: 20, e: 30, q: 3 },
      { s: 40, e: 50, q: 7 },
    ]);
    const result = accumulateRangeValues(list.head, list.tail, 15, 35);

    expect(result.duration).toBe(10); // only second interval
    expect(result.minAvail).toBe(3);
    expect(result.maxAvail).toBe(3);
  });
});
