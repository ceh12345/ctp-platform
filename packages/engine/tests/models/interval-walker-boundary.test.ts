import { describe, it, expect } from 'vitest';
import { workingEndForwardW } from '../../Models/Core/interval-walker';
import { CTPIntervals } from '../../Models/Intervals/intervals';
import { CTPInterval } from '../../Models/Core/window';
import { makeDuration } from '../helpers/builders';

/**
 * Floating-point boundary in the walker's accumulated-duration comparison.
 *
 * When `required` exactly exhausts the interval the walk starts in, `target`
 * (base + required) and `cum[j]` are the same quantity reached by different
 * additions. With fractional seconds they differ by ~1e-8, the `>=` test fails,
 * and the walk skips to the NEXT interval with capacity — then genuinely
 * consumes it.
 *
 * Observed in stafford-all: 30228-NT-1 (1814.4s) ate five days of shifts and
 * 30065-V-1 (2138.4s) ate fourteen, each claiming a full shift per day for
 * roughly half an hour of work. Two tasks of 1,439 — it needs a duration that
 * exactly exhausts an interval AND fractional seconds; integer durations land
 * cleanly.
 *
 * The two tasks took different tiers (binary search vs overlap accumulation),
 * so both comparison sites need the epsilon. Covered here.
 *
 * See docs/sprints/SPRINT-subtract-engine-phantom-availability.md
 */
function avail(spans: Array<{ s: number; e: number }>): CTPIntervals {
  const l = new CTPIntervals();
  for (const x of spans) l.add(new CTPInterval(x.s, x.e, 1));
  return l;
}

describe('workingEndForwardW — exact-exhaustion boundary', () => {
  it('a fractional duration that exactly fills the first interval ends inside it', () => {
    // Two shifts with a gap. Start so that exactly `required` remains in the
    // first — the case where target and cum[0] collide.
    const required = 1814.4;
    const firstEnd = 5000;
    const list = avail([{ s: 0, e: firstEnd }, { s: 100000, e: 128800 }]);

    const end = workingEndForwardW(list, firstEnd - required, makeDuration(required));

    // Must finish at the first interval's end, NOT jump the gap.
    expect(end).toBeCloseTo(firstEnd, 3);
  });

  it('the same holds for the other fractional duration seen in production', () => {
    const required = 2138.4;
    const firstEnd = 9000;
    const list = avail([{ s: 0, e: firstEnd }, { s: 200000, e: 228800 }]);

    const end = workingEndForwardW(list, firstEnd - required, makeDuration(required));

    expect(end).toBeCloseTo(firstEnd, 3);
  });

  it('an integer duration at the same boundary is unaffected (control)', () => {
    const required = 1800;
    const firstEnd = 5000;
    const list = avail([{ s: 0, e: firstEnd }, { s: 100000, e: 128800 }]);

    const end = workingEndForwardW(list, firstEnd - required, makeDuration(required));

    expect(end).toBeCloseTo(firstEnd, 3);
  });

  it('a real shortfall is not swallowed by the epsilon', () => {
    // Guards against over-correcting. 600s MORE than the first interval holds,
    // so the answer must lie beyond that interval's end — the epsilon is 1e-6
    // and must never absorb a genuine deficit.
    //
    // Note this shape returns `startW + required` (the walk's legacy fallback)
    // rather than spanning the gap to the second interval. That fallback is
    // pre-existing behaviour, unrelated to this boundary fix, and is recorded
    // in the sprint doc; asserted here only as "past the first interval".
    const firstEnd = 5000;
    const list = avail([{ s: 0, e: firstEnd }, { s: 100000, e: 128800 }]);

    const end = workingEndForwardW(list, firstEnd - 1814.4, makeDuration(1814.4 + 600));

    expect(end).toBeGreaterThan(firstEnd);
  });
});
