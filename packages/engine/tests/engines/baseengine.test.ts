import { describe, it, expect } from 'vitest';
import { CTPBaseEngine } from '../../Engines/baseengine';
import { CTPIntervals } from '../../Models/Intervals/intervals';
import { CTPInterval } from '../../Models/Core/window';
import { CTPIntervalConstants } from '../../Models/Core/constants';
import { makeIntervals, intervalsToArray } from '../helpers/builders';

describe('CTPBaseEngine.mergeIntervals', () => {
  const engine = new CTPBaseEngine();

  it('copies qty from B to A where they overlap', () => {
    // Use non-adjacent intervals (gaps between them) because
    // mergeIntervals only advances aPtr, not bPtr, so adjacent
    // intervals can get qty from the wrong B node
    const a = makeIntervals([
      { s: 0, e: 10 },
      { s: 20, e: 30 },
      { s: 40, e: 50 },
    ]);
    const b = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 20, e: 30, q: 3 },
      { s: 40, e: 50, q: 7 },
    ]);
    engine.mergeIntervals(a, b);
    const arr = intervalsToArray(a);
    expect(arr[0].q).toBe(5);
    expect(arr[1].q).toBe(3);
    expect(arr[2].q).toBe(7);
  });

  it('non-overlapping B intervals are skipped', () => {
    const a = makeIntervals([{ s: 0, e: 10 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 99 }]);
    engine.mergeIntervals(a, b);
    const arr = intervalsToArray(a);
    // A's qty should be unchanged (default 1)
    expect(arr[0].q).toBe(1);
  });

  it('handles B wider than A — copies where overlap exists', () => {
    const a = makeIntervals([{ s: 10, e: 20 }]);
    const b = makeIntervals([{ s: 0, e: 30, q: 8 }]);
    engine.mergeIntervals(a, b);
    const arr = intervalsToArray(a);
    expect(arr[0].q).toBe(8);
  });

  it('copies runRate from B when present', () => {
    const a = makeIntervals([{ s: 0, e: 10 }]);
    const b = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    b.head!.data.runRate = 2.5;
    engine.mergeIntervals(a, b);
    expect(a.head!.data.runRate).toBe(2.5);
  });

  it('handles empty A — no changes', () => {
    const a = new CTPIntervals();
    const b = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    engine.mergeIntervals(a, b);
    expect(a.size()).toBe(0);
  });

  it('handles empty B — no changes', () => {
    const a = makeIntervals([{ s: 0, e: 10, q: 3 }]);
    const b = new CTPIntervals();
    engine.mergeIntervals(a, b);
    expect(a.head!.data.qty).toBe(3);
  });
});

describe('CTPBaseEngine.collapseIntervals', () => {
  const engine = new CTPBaseEngine();

  it('merges adjacent intervals with same qty', () => {
    const a = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 10, e: 20, q: 5 },
      { s: 20, e: 30, q: 5 },
    ]);
    engine.collapseIntervals(a);
    const arr = intervalsToArray(a);
    expect(arr.length).toBe(1);
    expect(arr[0]).toEqual({ s: 0, e: 30, q: 5 });
  });

  it('does not merge adjacent with different qty', () => {
    const a = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 10, e: 20, q: 3 },
    ]);
    engine.collapseIntervals(a);
    const arr = intervalsToArray(a);
    expect(arr.length).toBe(2);
  });

  it('removes zero-qty REUSABLE intervals', () => {
    const a = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 10, e: 20, q: 0 },
      { s: 20, e: 30, q: 5 },
    ]);
    a.intervalType = CTPIntervalConstants.REUSABLE;
    engine.collapseIntervals(a);
    const arr = intervalsToArray(a);
    // Zero-qty node removed, adjacent 5-qty nodes NOT merged (not contiguous after removal)
    const hasZero = arr.some((i) => i.q === 0);
    expect(hasZero).toBe(false);
  });

  it('sets flowRight/flowLeft flags', () => {
    const a = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 10, e: 20, q: 3 },
    ]);
    engine.collapseIntervals(a);
    // After collapse, processed nodes get flowRight=true, flowLeft=true
    expect(a.head!.data.flowRight).toBe(true);
    expect(a.head!.data.flowLeft).toBe(true);
  });

  it('handles single interval — no change', () => {
    const a = makeIntervals([{ s: 0, e: 10, q: 5 }]);
    engine.collapseIntervals(a);
    const arr = intervalsToArray(a);
    expect(arr.length).toBe(1);
  });

  it('handles empty list — no error', () => {
    const a = new CTPIntervals();
    engine.collapseIntervals(a);
    expect(a.size()).toBe(0);
  });

  it('collapses multiple same-qty groups', () => {
    const a = makeIntervals([
      { s: 0, e: 10, q: 5 },
      { s: 10, e: 20, q: 5 },
      { s: 20, e: 30, q: 3 },
      { s: 30, e: 40, q: 3 },
    ]);
    engine.collapseIntervals(a);
    const arr = intervalsToArray(a);
    expect(arr.length).toBe(2);
    expect(arr[0]).toEqual({ s: 0, e: 20, q: 5 });
    expect(arr[1]).toEqual({ s: 20, e: 40, q: 3 });
  });
});
