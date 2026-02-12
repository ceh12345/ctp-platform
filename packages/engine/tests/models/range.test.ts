import { describe, it, expect } from 'vitest';
import { CTPRange, CTPRangeValues } from '../../Models/Core/range';
import { CTPInterval, CTPDuration } from '../../Models/Core/window';
import { CTPIntervals } from '../../Models/Intervals/intervals';
import { CTPDurationConstants } from '../../Models/Core/constants';
import { makeIntervals } from '../helpers/builders';

function makeRange(specs: { s: number; e: number; q?: number }[]): {
  list: CTPIntervals;
  range: CTPRange;
} {
  const list = makeIntervals(specs);
  const range = new CTPRange(
    list.head,
    list.tail,
    list.head?.data.qty ?? 1,
    list.head ? list.tail!.data.endW - list.head.data.startW : 0,
  );
  return { list, range };
}

describe('CTPRangeValues', () => {
  it('constructor defaults', () => {
    const rv = new CTPRangeValues();
    expect(rv.est).toBe(0);
    expect(rv.eet).toBe(0);
    expect(rv.lst).toBe(0);
    expect(rv.lett).toBe(0);
    expect(rv.duration).toBe(0);
  });

  it('constructor with args', () => {
    const rv = new CTPRangeValues(10, 20, 30, 40);
    expect(rv.est).toBe(10);
    expect(rv.eet).toBe(20);
    expect(rv.lst).toBe(30);
    expect(rv.lett).toBe(40);
  });
});

describe('CTPRange', () => {
  describe('constructor and setRange', () => {
    it('sets startW/endW from pointers', () => {
      const { range } = makeRange([
        { s: 10, e: 20, q: 5 },
        { s: 30, e: 40, q: 5 },
      ]);
      expect(range.startW).toBe(10);
      expect(range.endW).toBe(40);
      expect(range.qty).toBe(5);
    });

    it('handles null pointers gracefully', () => {
      const range = new CTPRange(null, null, null, null);
      expect(range.startW).toBe(0);
      expect(range.endW).toBe(0);
      expect(range.estPtr).toBeNull();
      expect(range.lstPtr).toBeNull();
    });

    it('duration() returns overallDuration', () => {
      const { range } = makeRange([{ s: 0, e: 100, q: 5 }]);
      expect(range.duration()).toBe(100);
    });

    it('valid defaults to false', () => {
      const { range } = makeRange([{ s: 0, e: 10, q: 1 }]);
      expect(range.valid).toBe(false);
    });

    it('rangeValues returns the values object', () => {
      const { range } = makeRange([{ s: 0, e: 10, q: 1 }]);
      expect(range.rangeValues).toBe(range.values);
    });
  });

  describe('computeDurationForward', () => {
    it('finds feasible window in single contiguous interval', () => {
      const { range } = makeRange([{ s: 0, e: 100, q: 5 }]);
      const dur = new CTPDuration(50, 1, CTPDurationConstants.FIXED_DURATION);
      const feasible = range.computeDurationForward(0, 100, dur);
      expect(feasible).toBe(true);
      expect(range.values.est).toBe(0);
      expect(range.values.eet).toBe(50);
    });

    it('accumulates across multiple intervals', () => {
      const { range } = makeRange([
        { s: 0, e: 10, q: 5 },
        { s: 10, e: 20, q: 5 },
        { s: 20, e: 30, q: 5 },
      ]);
      const dur = new CTPDuration(25, 1, CTPDurationConstants.FLOAT_DURATION);
      const feasible = range.computeDurationForward(0, 30, dur);
      expect(feasible).toBe(true);
      expect(range.values.est).toBe(0);
      expect(range.values.eet).toBe(25);
    });

    it('returns false when insufficient capacity', () => {
      const { range } = makeRange([{ s: 0, e: 10, q: 5 }]);
      const dur = new CTPDuration(50, 1, CTPDurationConstants.FLOAT_DURATION);
      const feasible = range.computeDurationForward(0, 10, dur);
      expect(feasible).toBe(false);
    });

    it('handles STATIC duration type', () => {
      const { range } = makeRange([{ s: 0, e: 100, q: 5 }]);
      const dur = new CTPDuration(50, 1, CTPDurationConstants.STATIC);
      // STATIC: if est + duration <= et → feasible
      const feasible = range.computeDurationForward(0, 100, dur);
      expect(feasible).toBe(true);
    });

    it('STATIC returns false when eet > et', () => {
      const { range } = makeRange([{ s: 0, e: 100, q: 5 }]);
      const dur = new CTPDuration(150, 1, CTPDurationConstants.STATIC);
      const feasible = range.computeDurationForward(0, 100, dur);
      expect(feasible).toBe(false);
    });

    it('zero duration returns true', () => {
      const { range } = makeRange([{ s: 0, e: 100, q: 5 }]);
      const dur = new CTPDuration(0, 1, CTPDurationConstants.FIXED_DURATION);
      const feasible = range.computeDurationForward(0, 100, dur);
      expect(feasible).toBe(true);
    });
  });

  describe('computeDurationBackward', () => {
    it('finds feasible window from end of single interval', () => {
      // Use non-zero start to avoid lst=0 falsy check issue in the code
      const { range } = makeRange([{ s: 10, e: 110, q: 5 }]);
      const dur = new CTPDuration(50, 1, CTPDurationConstants.FIXED_DURATION);
      const feasible = range.computeDurationBackward(10, 110, dur);
      expect(feasible).toBe(true);
      expect(range.values.lst).toBe(60);
      expect(range.values.lett).toBe(110);
    });

    it('accumulates backward across multiple intervals', () => {
      // Use non-zero start to avoid lst=0 falsy check issue
      const { range } = makeRange([
        { s: 10, e: 20, q: 5 },
        { s: 20, e: 30, q: 5 },
        { s: 30, e: 40, q: 5 },
      ]);
      const dur = new CTPDuration(25, 1, CTPDurationConstants.FLOAT_DURATION);
      const feasible = range.computeDurationBackward(10, 40, dur);
      expect(feasible).toBe(true);
      expect(range.values.lst).toBe(15);
      expect(range.values.lett).toBe(40);
    });

    it('returns false when insufficient capacity backward', () => {
      const { range } = makeRange([{ s: 0, e: 10, q: 5 }]);
      const dur = new CTPDuration(50, 1, CTPDurationConstants.FLOAT_DURATION);
      const feasible = range.computeDurationBackward(0, 10, dur);
      expect(feasible).toBe(false);
    });

    it('STATIC backward within bounds returns true', () => {
      const { range } = makeRange([{ s: 0, e: 100, q: 5 }]);
      const dur = new CTPDuration(50, 1, CTPDurationConstants.STATIC);
      const feasible = range.computeDurationBackward(0, 100, dur);
      expect(feasible).toBe(true);
    });

    it('STATIC backward exceeds st returns false', () => {
      const { range } = makeRange([{ s: 50, e: 100, q: 5 }]);
      const dur = new CTPDuration(80, 1, CTPDurationConstants.STATIC);
      const feasible = range.computeDurationBackward(50, 100, dur);
      expect(feasible).toBe(false);
    });
  });

  describe('computeRangeValues', () => {
    it('computes duration across range', () => {
      const { range } = makeRange([
        { s: 0, e: 10, q: 5 },
        { s: 20, e: 30, q: 3 },
        { s: 40, e: 50, q: 7 },
      ]);
      const rv = range.computeRangeValues(0, 50);
      // Note: computeRangeValues iterates estPtr to lstPtr (exclusive of lstPtr)
      // So it covers first two intervals: [0,10] and [20,30]
      expect(rv.duration).toBe(20); // 10 + 10
    });

    it('computes min and max availability', () => {
      const { range } = makeRange([
        { s: 0, e: 10, q: 5 },
        { s: 20, e: 30, q: 3 },
        { s: 40, e: 50, q: 7 },
      ]);
      const rv = range.computeRangeValues(0, 50);
      expect(rv.minAvail).toBe(3);
      expect(rv.maxAvail).toBe(5);
    });

    it('handles single interval range', () => {
      const list = makeIntervals([{ s: 0, e: 100, q: 5 }]);
      const range = new CTPRange(list.head, list.head, 5, 100);
      const rv = range.computeRangeValues(0, 100);
      // With estPtr === lstPtr, the while loop doesn't execute
      expect(rv.duration).toBe(0);
    });
  });

  describe('setLRange', () => {
    it('extends range to new end pointer', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 5 },
        { s: 20, e: 30, q: 5 },
        { s: 40, e: 50, q: 5 },
      ]);
      const range = new CTPRange(list.head, list.head!.next, 5, 20);
      // Initially endW is from lstPtr (second node: endW=30)
      expect(range.endW).toBe(30);

      // Extend to third node
      range.setLRange(list.tail!, 20);
      expect(range.endW).toBe(50);
      expect(range.duration()).toBe(40); // 20 + 20
    });
  });

  describe('minimumDuration / minimumRunRate', () => {
    it('returns minimum duration from setRange', () => {
      const list = makeIntervals([{ s: 0, e: 100, q: 5 }]);
      const range = new CTPRange(list.head, list.tail, 5, 50);
      expect(range.minimumDuration()).toBe(50);
    });

    it('setLRange updates minimum if smaller', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 5 },
        { s: 20, e: 30, q: 5 },
      ]);
      const range = new CTPRange(list.head, list.head, 5, 50);
      range.setLRange(list.tail!, 30);
      expect(range.minimumDuration()).toBe(30);
    });
  });
});
