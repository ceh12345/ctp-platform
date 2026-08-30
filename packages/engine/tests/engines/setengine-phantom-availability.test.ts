import { describe, it, expect } from 'vitest';
import { CTPSubtractSetEngine } from '../../Engines/setengine';
import { makeIntervals, intervalsToArray } from '../helpers/builders';

/**
 * Reproduces the phantom-availability defect behind off-calendar placement.
 *
 * Observed live in stafford-all (resource 49 = JACK R) at the moment the
 * scheduler placed 28372-F-2 at 21:00, the minute his shift ended:
 *
 *   staticOriginal  : [522158400,522187200)q=1  ...        <- one real shift
 *   staticAssign    : [522158400,522187200)q=1
 *                     [522187200,523548000)q=1             <- booking, outside any shift
 *   staticAvailable : [522158400,522187200)q=0
 *                     [522187200,523548000)q=1             <- FABRICATED capacity
 *
 * The overlapping region correctly cancels to q=0. The B-only region should
 * come out NEGATED (q=-1) per the documented contract in setengine.test.ts
 * ("B-only regions: qty = -B.qty"), which the interval walker's qty guard then
 * treats as no capacity. Instead it surfaced as q=+1 — read by
 * workingEndForwardW as 15.7 days of free time.
 *
 * See docs/sprints/SPRINT-subtract-engine-phantom-availability.md
 */
describe('CTPSubtractSetEngine — phantom availability (off-calendar placement)', () => {
  it('a B interval outside A must not surface as positive capacity', () => {
    const engine = new CTPSubtractSetEngine();
    // One shift, and two assignments: the first consumes it exactly, the
    // second falls entirely outside it (the night after the shift ends).
    const a = makeIntervals([{ s: 522158400, e: 522187200, q: 1 }]);
    const b = makeIntervals([
      { s: 522158400, e: 522187200, q: 1 },
      { s: 522187200, e: 523548000, q: 1 },
    ]);

    const arr = intervalsToArray(engine.execute(a, b));

    // Zero-width intervals (s === e) carry no time — duration() is 0, so the
    // walker can never find capacity in them. Only spans matter here.
    const spans = arr.filter((r: any) => r.e > r.s);

    // The consumed shift cancels to zero.
    const consumed = spans.find((r: any) => r.s === 522158400);
    expect(consumed).toBeDefined();
    expect(consumed!.q).toBe(0);

    // The region outside the shift must never read as available capacity.
    // Negated is the documented contract for a B-only region.
    const outside = spans.find((r: any) => r.s === 522187200);
    expect(outside).toBeDefined();
    expect(outside!.q).toBeLessThanOrEqual(0);

    // Nothing with real duration may offer capacity beyond A's support.
    const fabricated = spans.filter((r: any) => r.q > 0 && r.s >= 522187200);
    expect(fabricated).toEqual([]);
  });

  it('the simple two-interval case already behaves (regression guard)', () => {
    const engine = new CTPSubtractSetEngine();
    const a = makeIntervals([{ s: 0, e: 10, q: 1 }]);
    const b = makeIntervals([{ s: 20, e: 30, q: 1 }]);
    const arr = intervalsToArray(engine.execute(a, b));
    const outside = arr.find((r: any) => r.s === 20);
    expect(outside!.q).toBe(-1);
  });
});
