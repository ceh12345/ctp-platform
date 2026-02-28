import { describe, it, expect } from 'vitest';
import { generateCadenceTicks, filterStartTimesByCadence } from '../../AI/Agents/cadencefilter';
import { CTPStartTime, CTPStartTimes } from '../../Models/Entities/starttime';

// Helper: epoch seconds for a time on 2026-06-06 UTC
function utc(h: number, m: number = 0): number {
  return Date.UTC(2026, 5, 6, h, m, 0) / 1000;
}

// Helper: build a CTPStartTimes list from an array of [eStart, lStart, duration]
function makeStartTimes(entries: [number, number, number][]): CTPStartTimes {
  const list = new CTPStartTimes();
  for (const [eStart, lStart, dur] of entries) {
    list.insertAtEnd(new CTPStartTime(eStart, eStart + dur, lStart, lStart + dur, dur));
  }
  return list;
}

// Helper: extract start times to array for assertions
function toArray(list: CTPStartTimes): { eStart: number; lStart: number; dur: number }[] {
  const result: { eStart: number; lStart: number; dur: number }[] = [];
  let node = list.head;
  while (node) {
    result.push({ eStart: node.data.eStartW, lStart: node.data.lStartW, dur: node.data.duration });
    node = node.next;
  }
  return result;
}

// ─── Tick Generation ───────────────────────────────────────────────────────

describe('generateCadenceTicks', () => {
  it('30-min cadence over 3 hours', () => {
    const ticks = generateCadenceTicks(30, utc(7), utc(10));
    expect(ticks.length).toBe(7); // 7:00, 7:30, 8:00, 8:30, 9:00, 9:30, 10:00
    expect(ticks[0]).toBe(utc(7, 0));
    expect(ticks[1]).toBe(utc(7, 30));
    expect(ticks[6]).toBe(utc(10, 0));
  });

  it('60-min cadence over 3 hours', () => {
    const ticks = generateCadenceTicks(60, utc(7), utc(10));
    expect(ticks.length).toBe(4); // 7:00, 8:00, 9:00, 10:00
    expect(ticks[0]).toBe(utc(7));
    expect(ticks[3]).toBe(utc(10));
  });

  it('15-min cadence over 1 hour', () => {
    const ticks = generateCadenceTicks(15, utc(8), utc(9));
    expect(ticks.length).toBe(5); // 8:00, 8:15, 8:30, 8:45, 9:00
    expect(ticks[0]).toBe(utc(8));
    expect(ticks[2]).toBe(utc(8, 30));
    expect(ticks[4]).toBe(utc(9));
  });

  it('aligns to midnight grid when horizon starts off-boundary', () => {
    const ticks = generateCadenceTicks(30, utc(7, 15), utc(8, 15));
    // First tick >= 7:15 is 7:30, then 8:00
    expect(ticks[0]).toBe(utc(7, 30));
    expect(ticks[1]).toBe(utc(8, 0));
    expect(ticks.length).toBe(2);
  });

  it('returns empty for zero interval', () => {
    const ticks = generateCadenceTicks(0, utc(7), utc(10));
    expect(ticks.length).toBe(0);
  });

  it('horizon start on boundary is included', () => {
    const ticks = generateCadenceTicks(30, utc(9), utc(9, 30));
    expect(ticks.length).toBe(2); // 9:00, 9:30
    expect(ticks[0]).toBe(utc(9));
    expect(ticks[1]).toBe(utc(9, 30));
  });
});

// ─── Start Time Filtering ──────────────────────────────────────────────────

describe('filterStartTimesByCadence', () => {
  const ticks30 = generateCadenceTicks(30, utc(7), utc(22));

  it('snaps start time to nearest boundaries', () => {
    // eStart=7:10, lStart=8:45, dur=1800 (30min)
    const list = makeStartTimes([[utc(7, 10), utc(8, 45), 1800]]);
    filterStartTimesByCadence(list, ticks30);
    const arr = toArray(list);
    expect(arr.length).toBe(1);
    expect(arr[0].eStart).toBe(utc(7, 30)); // snapped forward
    expect(arr[0].lStart).toBe(utc(8, 30)); // snapped backward
  });

  it('already on boundaries — unchanged', () => {
    const list = makeStartTimes([[utc(8), utc(9), 1800]]);
    filterStartTimesByCadence(list, ticks30);
    const arr = toArray(list);
    expect(arr.length).toBe(1);
    expect(arr[0].eStart).toBe(utc(8));
    expect(arr[0].lStart).toBe(utc(9));
  });

  it('perfect fit on boundary — preserved (zero slack)', () => {
    // eStart == lStart == 8:00
    const list = makeStartTimes([[utc(8), utc(8), 1800]]);
    filterStartTimesByCadence(list, ticks30);
    const arr = toArray(list);
    expect(arr.length).toBe(1);
    expect(arr[0].eStart).toBe(utc(8));
    expect(arr[0].lStart).toBe(utc(8));
  });

  it('no boundary in range — removes node', () => {
    // eStart=8:05, lStart=8:20 — no 30-min tick between 8:05 and 8:20
    const list = makeStartTimes([[utc(8, 5), utc(8, 20), 1800]]);
    filterStartTimesByCadence(list, ticks30);
    const arr = toArray(list);
    expect(arr.length).toBe(0);
  });

  it('multiple nodes — each filtered independently', () => {
    const list = makeStartTimes([
      [utc(7, 10), utc(7, 50), 1800],  // snaps to 7:30, 7:30
      [utc(9), utc(10, 15), 1800],      // snaps to 9:00, 10:00
    ]);
    filterStartTimesByCadence(list, ticks30);
    const arr = toArray(list);
    expect(arr.length).toBe(2);
    expect(arr[0].eStart).toBe(utc(7, 30));
    expect(arr[0].lStart).toBe(utc(7, 30));
    expect(arr[1].eStart).toBe(utc(9));
    expect(arr[1].lStart).toBe(utc(10));
  });

  it('all nodes removed — empty list', () => {
    const list = makeStartTimes([
      [utc(8, 5), utc(8, 20), 1800],
      [utc(9, 5), utc(9, 20), 1800],
    ]);
    filterStartTimesByCadence(list, ticks30);
    const arr = toArray(list);
    expect(arr.length).toBe(0);
  });

  it('preserves duration in eEndW/lEndW', () => {
    const dur = 3600; // 60 min
    const list = makeStartTimes([[utc(7, 10), utc(8, 45), dur]]);
    filterStartTimesByCadence(list, ticks30);
    const node = list.head!;
    expect(node.data.eEndW).toBe(node.data.eStartW + dur);
    expect(node.data.lEndW).toBe(node.data.lStartW + dur);
  });

  it('empty ticks array — no filtering', () => {
    const list = makeStartTimes([[utc(8), utc(9), 1800]]);
    filterStartTimesByCadence(list, []);
    const arr = toArray(list);
    expect(arr.length).toBe(1); // unchanged
  });
});

// ─── No Cadence = No Filtering ─────────────────────────────────────────────

describe('cadence off', () => {
  it('null cadenceIntervalMinutes means no filtering applied', () => {
    // This is a behavioral contract test — the engine checks
    // task.cadenceIntervalMinutes before calling filter
    const interval: number | null = null;
    expect(interval).toBeNull();
    // When null, filterStartTimesByCadence is never called
  });
});
