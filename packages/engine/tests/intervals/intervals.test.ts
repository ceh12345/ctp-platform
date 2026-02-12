import { describe, it, expect } from 'vitest';
import { CTPInterval } from '../../Models/Core/window';
import { CTPIntervals } from '../../Models/Intervals/intervals';
import { intervalsToArray, makeIntervals } from '../helpers/builders';

describe('CTPIntervals', () => {
  describe('add (ordered insertion)', () => {
    it('inserts single interval', () => {
      const list = new CTPIntervals();
      list.add(new CTPInterval(10, 20, 5));
      expect(list.size()).toBe(1);
      expect(list.head?.data.startW).toBe(10);
    });

    it('inserts in sorted order by startW', () => {
      const list = new CTPIntervals();
      list.add(new CTPInterval(30, 40, 1));
      list.add(new CTPInterval(10, 20, 1));
      list.add(new CTPInterval(20, 30, 1));
      const arr = intervalsToArray(list);
      expect(arr.map((a) => a.s)).toEqual([10, 20, 30]);
    });

    it('multiple intervals maintain sorted order', () => {
      const list = makeIntervals([
        { s: 50, e: 60, q: 1 },
        { s: 10, e: 20, q: 1 },
        { s: 30, e: 40, q: 1 },
      ]);
      const arr = intervalsToArray(list);
      expect(arr.map((a) => a.s)).toEqual([10, 30, 50]);
    });
  });

  describe('atOrAfterStartTime', () => {
    it('finds interval at exact startW', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
        { s: 50, e: 60 },
      ]);
      const node = list.atOrAfterStartTime(30, 40);
      expect(node?.data.startW).toBe(30);
    });

    it('finds first interval after startW', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
        { s: 50, e: 60 },
      ]);
      const node = list.atOrAfterStartTime(25, 35);
      expect(node?.data.startW).toBe(30);
    });

    it('returns null when all before startW', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
      ]);
      const node = list.atOrAfterStartTime(50, 60);
      expect(node).toBeNull();
    });
  });

  describe('atStartTime', () => {
    it('returns head when startW >= head.data.startW', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
      ]);
      // atStartTime traverses forward while startW < node.startW,
      // so for startW >= head.startW it returns head
      const node = list.atStartTime(30);
      expect(node?.data.startW).toBe(10);
    });

    it('returns head when startW is before all intervals', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
      ]);
      const node = list.atStartTime(5);
      expect(node?.data.startW).toBe(10);
    });
  });

  describe('closestToEndTime', () => {
    it('finds tail when endW is past all intervals', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
      ]);
      const node = list.closestToEndTime(0, 100);
      expect(node?.data.endW).toBe(40);
    });

    it('finds last interval whose startW <= endW', () => {
      const list = makeIntervals([
        { s: 10, e: 20 },
        { s: 30, e: 40 },
        { s: 50, e: 60 },
      ]);
      // closestToEndTime traverses backward from tail while endW < node.startW
      // For endW=35: skips [50,60] (35<50), stops at [30,40] (35>=30)
      const node = list.closestToEndTime(0, 35);
      expect(node?.data.endW).toBe(40);
    });
  });

  describe('findEndTime', () => {
    it('accumulates duration across contiguous intervals', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 1 },
        { s: 10, e: 20, q: 1 },
        { s: 20, e: 30, q: 1 },
      ]);
      const et = list.findEndTime(0, 25, list.head!, 0);
      expect(et).toBe(25);
    });

    it('accumulates across non-contiguous intervals', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 1 },
        { s: 20, e: 30, q: 1 },
      ]);
      // Duration of 15: uses all of first (10) + 5 from second
      const et = list.findEndTime(0, 15, list.head!, 0);
      expect(et).toBe(25);
    });

    it('returns startW when duration is 0', () => {
      const list = makeIntervals([{ s: 10, e: 20, q: 1 }]);
      const et = list.findEndTime(10, 0, list.head!, 0);
      expect(et).toBe(10);
    });
  });

  describe('findStartTime (backward)', () => {
    it('traverses backward correctly', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 1 },
        { s: 10, e: 20, q: 1 },
        { s: 20, e: 30, q: 1 },
      ]);
      // From tail, looking for 15 units of duration backward
      const st = list.findStartTime(30, 15, list.tail!, 0);
      expect(st).toBe(15);
    });
  });

  describe('findDurationFromEnd', () => {
    it('accumulates from tail backward', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 1 },
        { s: 20, e: 30, q: 1 },
        { s: 40, e: 50, q: 1 },
      ]);
      // Need 15 duration, start from end: 50→40 (10 used), then 30→20 (5 more)
      const node = list.findDurationFromEnd(0, 50, 15, 1);
      expect(node).not.toBeNull();
      expect(node?.data.startW).toBe(20);
    });

    it('returns head when all duration is needed', () => {
      const list = makeIntervals([
        { s: 0, e: 10, q: 1 },
        { s: 20, e: 30, q: 1 },
      ]);
      const node = list.findDurationFromEnd(0, 30, 20, 1);
      expect(node?.data.startW).toBe(0);
    });

    it('handles single interval', () => {
      const list = makeIntervals([{ s: 0, e: 100, q: 1 }]);
      const node = list.findDurationFromEnd(0, 100, 50, 1);
      expect(node?.data.startW).toBe(0);
    });
  });

  describe('copy', () => {
    it('creates independent copy', () => {
      const original = makeIntervals([
        { s: 0, e: 10, q: 5 },
        { s: 20, e: 30, q: 3 },
      ]);
      const copy = new CTPIntervals();
      copy.copy(original);
      expect(copy.size()).toBe(2);
      expect(intervalsToArray(copy)).toEqual(intervalsToArray(original));
    });

    it('modifying copy does not affect original', () => {
      const original = makeIntervals([{ s: 0, e: 10, q: 5 }]);
      const copy = new CTPIntervals();
      copy.copy(original);
      copy.head!.data.qty = 999;
      expect(original.head?.data.qty).toBe(5);
    });
  });

  describe('whiteSpace', () => {
    it('sums all interval durations', () => {
      const list = makeIntervals([
        { s: 0, e: 10 },
        { s: 20, e: 35 },
        { s: 50, e: 60 },
      ]);
      expect(list.whiteSpace()).toBe(35); // 10 + 15 + 10
    });

    it('returns 0 for empty list', () => {
      const list = new CTPIntervals();
      expect(list.whiteSpace()).toBe(0);
    });
  });

  describe('sort', () => {
    it('sorts by startW', () => {
      const list = new CTPIntervals();
      // Insert out of order using insertAtEnd directly (bypass sorted add)
      list.insertAtEnd(new CTPInterval(30, 40, 1));
      list.insertAtEnd(new CTPInterval(10, 20, 1));
      list.insertAtEnd(new CTPInterval(20, 30, 1));
      list.sort();
      const arr = intervalsToArray(list);
      expect(arr.map((a) => a.s)).toEqual([10, 20, 30]);
    });
  });

  describe('remove', () => {
    it('removes a node and resets middle', () => {
      const list = makeIntervals([
        { s: 0, e: 10 },
        { s: 20, e: 30 },
        { s: 40, e: 50 },
      ]);
      const mid = list.head?.next ?? null;
      list.remove(mid);
      expect(list.size()).toBe(2);
      expect(intervalsToArray(list).map((a) => a.s)).toEqual([0, 40]);
    });
  });
});
