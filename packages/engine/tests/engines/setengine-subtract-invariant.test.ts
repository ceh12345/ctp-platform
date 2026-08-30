import { describe, it, expect } from 'vitest';
import { CTPSubtractSetEngine } from '../../Engines/setengine';
import { makeIntervals, intervalsToArray } from '../helpers/builders';

/**
 * Invariant for A − B, across every relative geometry of A and B.
 *
 * Subtraction must never OFFER capacity where A had none. A result interval
 * with real duration (e > s) and q > 0 outside A's support is fabricated
 * availability — the defect that let the scheduler place work outside a
 * resource's shifts.
 *
 * B-only regions are expected in the output (the engine keeps them negated so
 * downstream consumers can see the deficit); they must simply never be
 * positive.
 *
 * See docs/sprints/SPRINT-subtract-engine-phantom-availability.md
 */

type Span = { s: number; e: number; q: number };

/** Does [s,e) lie within any interval of A? */
function insideA(s: number, e: number, a: Span[]): boolean {
  return a.some((x) => s >= x.s && e <= x.e);
}

function fabricated(a: Span[], b: Span[]): Span[] {
  const result = intervalsToArray(new CTPSubtractSetEngine().execute(
    makeIntervals(a), makeIntervals(b),
  )) as Span[];
  return result.filter((r) => r.e > r.s && r.q > 0 && !insideA(r.s, r.e, a));
}

// One shift, 08:00–16:00 in arbitrary units.
const SHIFT: Span[] = [{ s: 100, e: 200, q: 1 }];

const cases: Array<{ name: string; a: Span[]; b: Span[] }> = [
  { name: 'B entirely before A',            a: SHIFT, b: [{ s: 0,   e: 50,  q: 1 }] },
  { name: 'B entirely after A',             a: SHIFT, b: [{ s: 300, e: 400, q: 1 }] },
  { name: 'B ends exactly where A starts',  a: SHIFT, b: [{ s: 50,  e: 100, q: 1 }] },
  { name: 'B starts exactly where A ends',  a: SHIFT, b: [{ s: 200, e: 300, q: 1 }] },
  { name: 'B overlaps A start',             a: SHIFT, b: [{ s: 50,  e: 150, q: 1 }] },
  { name: 'B overlaps A end',               a: SHIFT, b: [{ s: 150, e: 300, q: 1 }] },
  { name: 'B contains A',                   a: SHIFT, b: [{ s: 50,  e: 300, q: 1 }] },
  { name: 'B inside A',                     a: SHIFT, b: [{ s: 120, e: 180, q: 1 }] },
  { name: 'B identical to A',               a: SHIFT, b: [{ s: 100, e: 200, q: 1 }] },
  // The production shape: one B consumes the shift, the next starts exactly at
  // its end and runs far beyond (a booking spanning the night).
  { name: 'B consumes A, then B2 adjacent after',
    a: SHIFT, b: [{ s: 100, e: 200, q: 1 }, { s: 200, e: 900, q: 1 }] },
  { name: 'B consumes A, then B2 detached after',
    a: SHIFT, b: [{ s: 100, e: 200, q: 1 }, { s: 250, e: 900, q: 1 }] },
  { name: 'B2 adjacent after, differing qty',
    a: SHIFT, b: [{ s: 100, e: 200, q: 2 }, { s: 200, e: 900, q: 1 }] },
  { name: 'two shifts, booking spans the gap between them',
    a: [{ s: 100, e: 200, q: 1 }, { s: 300, e: 400, q: 1 }],
    b: [{ s: 100, e: 200, q: 1 }, { s: 200, e: 300, q: 1 }] },
  { name: 'two shifts, booking runs past the last',
    a: [{ s: 100, e: 200, q: 1 }, { s: 300, e: 400, q: 1 }],
    b: [{ s: 300, e: 400, q: 1 }, { s: 400, e: 900, q: 1 }] },
  { name: 'pooled shift (qty 2), single-unit booking adjacent after',
    a: [{ s: 100, e: 200, q: 2 }], b: [{ s: 200, e: 900, q: 1 }] },
  // Overhang geometries — a booking that runs past a shift's end into the gap.
  // The production signature of the remaining cases: tasks starting a few
  // minutes AFTER a shift closes, at odd times that look like an assignment end.
  { name: 'two shifts, B overhangs the first into the gap',
    a: [{ s: 100, e: 200, q: 1 }, { s: 300, e: 400, q: 1 }],
    b: [{ s: 190, e: 213, q: 1 }] },
  { name: 'two shifts, B overhangs then a second B follows in the gap',
    a: [{ s: 100, e: 200, q: 1 }, { s: 300, e: 400, q: 1 }],
    b: [{ s: 190, e: 213, q: 1 }, { s: 213, e: 260, q: 1 }] },
  { name: 'three shifts, B overhangs each',
    a: [{ s: 100, e: 200, q: 1 }, { s: 300, e: 400, q: 1 }, { s: 500, e: 600, q: 1 }],
    b: [{ s: 190, e: 213, q: 1 }, { s: 390, e: 415, q: 1 }] },
  { name: 'B overhangs the only shift, then continues',
    a: [{ s: 100, e: 200, q: 1 }],
    b: [{ s: 150, e: 900, q: 1 }, { s: 900, e: 950, q: 1 }] },
  { name: 'B wholly inside the gap between two shifts',
    a: [{ s: 100, e: 200, q: 1 }, { s: 300, e: 400, q: 1 }],
    b: [{ s: 220, e: 260, q: 1 }] },
];

describe('CTPSubtractSetEngine — never fabricates capacity outside A', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(fabricated(c.a, c.b)).toEqual([]);
    });
  }
});
