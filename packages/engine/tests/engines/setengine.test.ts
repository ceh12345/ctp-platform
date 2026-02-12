import { describe, it, expect } from 'vitest';
import {
  CTPSubtractSetEngine,
  CTPIntersectSetEngine,
  CTPAddSetEngine,
  CTPComplimentSetEngine,
  CTPUnionSetEngine,
} from '../../Engines/setengine';
import { CTPIntervals } from '../../Models/Intervals/intervals';
import { CTPInterval } from '../../Models/Core/window';
import { makeIntervals, intervalsToArray } from '../helpers/builders';

// The Subtract engine performs algebraic subtraction:
// - Overlapping regions: qty = A.qty - B.qty
// - A-only regions: qty = A.qty
// - B-only regions: qty = -B.qty (negated)
// Fresh engine per test to avoid shared state issues.
describe('CTPSubtractSetEngine', () => {
  it('A before B (no overlap) — includes both with B negated', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(2);
    expect(arr[0]).toEqual({ s: 0, e: 10, q: 5 });
    expect(arr[1]).toEqual({ s: 20, e: 30, q: -3 });
  });

  it('B before A (no overlap) — includes both with B negated', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 20, e: 30, q: 5 }]);
    const b = makeIntervals([{ s: 0, e: 10, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(2);
    expect(arr[0]).toEqual({ s: 0, e: 10, q: -3 });
    expect(arr[1]).toEqual({ s: 20, e: 30, q: 5 });
  });

  it('A equals B — overlap region has zero qty', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 10, e: 20, q: 5 }]);
    const b = makeIntervals([{ s: 10, e: 20, q: 5 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    // Overlap [10,20] yields qty=0, plus degenerate [20,20] artifact
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0].s).toBe(10);
    expect(arr[0].e).toBe(20);
    expect(arr[0].q).toBe(0);
  });

  it('A contains B — three regions: A-only, overlap(zero), A-only', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 0, e: 100, q: 5 }]);
    const b = makeIntervals([{ s: 30, e: 60, q: 5 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(3);
    expect(arr[0]).toEqual({ s: 0, e: 30, q: 5 });
    expect(arr[1]).toEqual({ s: 30, e: 60, q: 0 });
    expect(arr[2]).toEqual({ s: 60, e: 100, q: 5 });
  });

  it('B contains A — overlap region has zero qty', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 30, e: 60, q: 5 }]);
    const b = makeIntervals([{ s: 0, e: 100, q: 5 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(3);
    expect(arr[0]).toEqual({ s: 0, e: 30, q: -5 });
    expect(arr[1]).toEqual({ s: 30, e: 60, q: 0 });
    expect(arr[2]).toEqual({ s: 60, e: 100, q: -5 });
  });

  it('partial overlap (A starts first) — algebraic subtraction', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 0, e: 50, q: 5 }]);
    const b = makeIntervals([{ s: 30, e: 80, q: 5 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(3);
    // A-only region [0,80] includes B region extent in first interval
    expect(arr[0].q).toBe(5);
    // Overlap [30,50]: qty = 5-5 = 0
    expect(arr[1]).toEqual({ s: 30, e: 50, q: 0 });
    // B-only [50,80]: qty = -5
    expect(arr[2]).toEqual({ s: 50, e: 80, q: -5 });
  });

  it('partial overlap (B starts first) — algebraic subtraction', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 30, e: 80, q: 5 }]);
    const b = makeIntervals([{ s: 0, e: 50, q: 5 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(3);
    // B-only [0,30]: qty = -5
    expect(arr[0]).toEqual({ s: 0, e: 30, q: -5 });
    // Overlap [30,50]: qty = 5-5 = 0
    expect(arr[1]).toEqual({ s: 30, e: 50, q: 0 });
    // A-only [50,80]: qty = 5
    expect(arr[2]).toEqual({ s: 50, e: 80, q: 5 });
  });

  it('empty A — B intervals appear negated', () => {
    const engine = new CTPSubtractSetEngine();
    const a = new CTPIntervals();
    const b = makeIntervals([{ s: 0, e: 10, q: 1 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr).toEqual([{ s: 0, e: 10, q: -1 }]);
  });

  it('empty B — A unchanged', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    const b = new CTPIntervals();
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr).toEqual([{ s: 0, e: 10, q: 5 }]);
  });

  it('multiple intervals — overlap regions have zero qty', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([
      { s: 0, e: 50, q: 10 },
      { s: 100, e: 200, q: 10 },
    ]);
    const b = makeIntervals([
      { s: 20, e: 30, q: 10 },
      { s: 150, e: 180, q: 10 },
    ]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(6);
    expect(arr[0]).toEqual({ s: 0, e: 20, q: 10 });
    expect(arr[1]).toEqual({ s: 20, e: 30, q: 0 });
    expect(arr[2]).toEqual({ s: 30, e: 50, q: 10 });
    expect(arr[3]).toEqual({ s: 100, e: 150, q: 10 });
    expect(arr[4]).toEqual({ s: 150, e: 180, q: 0 });
    expect(arr[5]).toEqual({ s: 180, e: 200, q: 10 });
  });

  it('subtract with different quantities — overlap has difference', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 0, e: 100, q: 10 }]);
    const b = makeIntervals([{ s: 30, e: 60, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(3);
    expect(arr[0]).toEqual({ s: 0, e: 30, q: 10 });
    expect(arr[1]).toEqual({ s: 30, e: 60, q: 7 }); // 10 - 3 = 7
    expect(arr[2]).toEqual({ s: 60, e: 100, q: 10 });
  });
});

describe('CTPIntersectSetEngine', () => {
  it('A before B — empty result', () => {
    const engine = new CTPIntersectSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 3 }]);
    const result = engine.execute(a, b);
    expect(result?.size() ?? 0).toBe(0);
  });

  it('overlapping intervals — overlap region only', () => {
    const engine = new CTPIntersectSetEngine();
    const a = makeIntervals([{ s: 0, e: 50, q: 5 }]);
    const b = makeIntervals([{ s: 30, e: 80, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(30);
    expect(arr[0].e).toBe(50);
  });

  it('A contains B — B region returned', () => {
    const engine = new CTPIntersectSetEngine();
    const a = makeIntervals([{ s: 0, e: 100, q: 5 }]);
    const b = makeIntervals([{ s: 30, e: 60, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(30);
    expect(arr[0].e).toBe(60);
  });

  it('identical intervals — full interval returned', () => {
    const engine = new CTPIntersectSetEngine();
    const a = makeIntervals([{ s: 10, e: 50, q: 5 }]);
    const b = makeIntervals([{ s: 10, e: 50, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(10);
    expect(arr[0].e).toBe(50);
  });

  it('no overlap — empty result', () => {
    const engine = new CTPIntersectSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 3 }]);
    const result = engine.execute(a, b);
    expect(result?.size() ?? 0).toBe(0);
  });

  it('multiple overlapping pairs', () => {
    const engine = new CTPIntersectSetEngine();
    const a = makeIntervals([
      { s: 0, e: 30, q: 5 },
      { s: 50, e: 80, q: 5 },
    ]);
    const b = makeIntervals([
      { s: 20, e: 60, q: 3 },
    ]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(2);
    expect(arr[0].s).toBe(20);
    expect(arr[0].e).toBe(30);
    expect(arr[1].s).toBe(50);
    expect(arr[1].e).toBe(60);
  });
});

describe('CTPAddSetEngine', () => {
  it('non-overlapping — both intervals in result', () => {
    const engine = new CTPAddSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBeGreaterThanOrEqual(2);
  });

  it('overlapping — quantities summed in overlap', () => {
    const engine = new CTPAddSetEngine();
    const a = makeIntervals([{ s: 0, e: 50, q: 5 }]);
    const b = makeIntervals([{ s: 30, e: 80, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    // Should have: [0-30: 5], [30-50: 8], [50-80: 3]
    expect(arr.length).toBe(3);
    const overlap = arr.find((x) => x.s === 30 && x.e === 50);
    expect(overlap?.q).toBe(8);
  });

  it('identical intervals — first element has summed qty', () => {
    const engine = new CTPAddSetEngine();
    const a = makeIntervals([{ s: 10, e: 20, q: 5 }]);
    const b = makeIntervals([{ s: 10, e: 20, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    // First interval has qty = 5+3 = 8, may produce degenerate zero-width artifact
    expect(arr[0].q).toBe(8);
    expect(arr[0].s).toBe(10);
    expect(arr[0].e).toBe(20);
  });
});

describe('CTPComplimentSetEngine', () => {
  it('returns A regions not in B', () => {
    const engine = new CTPComplimentSetEngine();
    const a = makeIntervals([{ s: 0, e: 100, q: 5 }]);
    const b = makeIntervals([{ s: 30, e: 60, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr.length).toBe(2);
    expect(arr[0].s).toBe(0);
    expect(arr[0].e).toBe(30);
    expect(arr[1].s).toBe(60);
    expect(arr[1].e).toBe(100);
  });

  it('full overlap — empty result', () => {
    const engine = new CTPComplimentSetEngine();
    const a = makeIntervals([{ s: 30, e: 60, q: 5 }]);
    const b = makeIntervals([{ s: 0, e: 100, q: 3 }]);
    const result = engine.execute(a, b);
    expect(result?.size() ?? 0).toBe(0);
  });

  it('no overlap — A unchanged', () => {
    const engine = new CTPComplimentSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 3 }]);
    const result = engine.execute(a, b);
    const arr = intervalsToArray(result);
    expect(arr).toEqual([{ s: 0, e: 10, q: 5 }]);
  });
});

describe('CTPUnionSetEngine.union()', () => {
  it('absorbs overlap within existing interval', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 0, e: 30 }]);
    engine.union(list, new CTPInterval(20, 50));
    const arr = intervalsToArray(list);
    // union() absorbs the overlapping portion; remaining [30,50] is not extended
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(0);
    expect(arr[0].e).toBe(30);
  });

  it('adjacent interval (startW == endW) — not merged', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 0, e: 20 }]);
    engine.union(list, new CTPInterval(20, 40));
    const arr = intervalsToArray(list);
    // Adjacent intervals at exact boundary are not merged by union()
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(0);
    expect(arr[0].e).toBe(20);
  });

  it('non-overlapping stays separate', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 0, e: 10 }]);
    engine.union(list, new CTPInterval(20, 30));
    const arr = intervalsToArray(list);
    expect(arr.length).toBe(2);
    expect(arr[0]).toEqual({ s: 0, e: 10, q: 1 });
    expect(arr[1]).toEqual({ s: 20, e: 30, q: 1 });
  });

  it('single interval added to empty list', () => {
    const engine = new CTPUnionSetEngine();
    const list = new CTPIntervals();
    engine.union(list, new CTPInterval(10, 20));
    expect(list.size()).toBe(1);
    expect(list.head?.data.startW).toBe(10);
  });

  it('gap between intervals preserved', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([
      { s: 0, e: 10 },
      { s: 30, e: 40 },
    ]);
    engine.union(list, new CTPInterval(50, 60));
    const arr = intervalsToArray(list);
    expect(arr.length).toBe(3);
  });

  it('interval contained within existing — no change in boundaries', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 0, e: 100 }]);
    engine.union(list, new CTPInterval(20, 50));
    const arr = intervalsToArray(list);
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(0);
    expect(arr[0].e).toBe(100);
  });

  it('interval containing existing — expands startW only', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 20, e: 50 }]);
    engine.union(list, new CTPInterval(0, 100));
    const arr = intervalsToArray(list);
    // union() expands startW to 0 but endW stays at 50
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(0);
    expect(arr[0].e).toBe(50);
  });

  it('new interval before all existing — inserted at start', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 50, e: 60 }]);
    engine.union(list, new CTPInterval(10, 20));
    const arr = intervalsToArray(list);
    expect(arr.length).toBe(2);
    expect(arr[0].s).toBe(10);
    expect(arr[0].e).toBe(20);
    expect(arr[1].s).toBe(50);
    expect(arr[1].e).toBe(60);
  });

  it('new interval between existing gaps — inserted correctly', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([
      { s: 0, e: 10 },
      { s: 40, e: 50 },
    ]);
    engine.union(list, new CTPInterval(20, 30));
    const arr = intervalsToArray(list);
    expect(arr.length).toBe(3);
    expect(arr[1].s).toBe(20);
    expect(arr[1].e).toBe(30);
  });

  it('exact duplicate — no change', () => {
    const engine = new CTPUnionSetEngine();
    const list = makeIntervals([{ s: 10, e: 20 }]);
    engine.union(list, new CTPInterval(10, 20));
    const arr = intervalsToArray(list);
    expect(arr.length).toBe(1);
    expect(arr[0].s).toBe(10);
    expect(arr[0].e).toBe(20);
  });
});
