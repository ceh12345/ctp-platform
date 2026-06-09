/**
 * Continuous-calendar scheduling — regression tests for the back-to-back /
 * single-interval bug.
 *
 * Background: subcontract resources (OUTWORK et al.) are 24/7 availability
 * with no shift breaks. The natural representations are:
 *   (a) one horizon-spanning interval, or
 *   (b) back-to-back daily intervals with no gaps.
 *
 * Field reproduction on 2026-06-09 against stafford-wo27978-only showed that
 * the engine fails to schedule a FLOAT task against either shape, while
 * shifts WITH gaps (8h evening shift, 5 days/week, with 16h overnight gaps)
 * worked fine. The same task placed cleanly when the calendar was given
 * 1-minute gaps between back-to-back intervals.
 *
 * Semantically a single interval is identical to back-to-back intervals,
 * which is identical to 24/7 with gaps — the engine must treat all three
 * the same. These tests pin that down.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  makeHorizon, makeFloatTask, solveScenario, monday,
} from '../helpers/float-helpers';
import { CTPDateTime } from '../../Models/Core/date';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPResource, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPAssignments, CTPAvailable } from '../../Models/Intervals/intervals';
import { CTPInterval } from '../../Models/Core/window';
import { CTPResourceConstants } from '../../Models/Core/constants';

const HOUR = 3600;
const DAY  = 86400;

/**
 * Build a resource whose calendar is ONE continuous interval covering the
 * full horizon. Mirrors the "single horizon-spanning interval" workaround
 * used for OUTWORK in stafford-engineering-test.
 */
function makeResourceWithSingleInterval(key: string, horizon: CTPHorizon): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', key, key);
  res.hierarchy.first = 'Machine';
  const avail = new CTPAvailable();
  avail.add(new CTPInterval(horizon.startW, horizon.endW, 1));
  res.original = avail;
  res.assignments = new CTPAssignments();
  res.available.setLists(res.original, res.assignments);
  return res;
}

/**
 * Build a resource whose calendar is N back-to-back daily 24h intervals
 * with NO gap between them. Semantically identical to a single interval
 * spanning the same range; tests that the engine handles back-to-back
 * intervals correctly.
 */
function makeResourceWithBackToBackDays(key: string, horizon: CTPHorizon): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', key, key);
  res.hierarchy.first = 'Machine';
  const avail = new CTPAvailable();
  const startW = horizon.startW;
  const endW   = horizon.endW;
  let t = startW;
  while (t < endW) {
    const next = Math.min(t + DAY, endW);
    avail.add(new CTPInterval(t, next, 1));
    t = next;
  }
  res.original = avail;
  res.assignments = new CTPAssignments();
  res.available.setLists(res.original, res.assignments);
  return res;
}

/**
 * Same as the back-to-back resource but with a 1-MINUTE gap between
 * consecutive intervals. This is the field-confirmed WORKING shape. Used
 * as a control to prove the test setup is correct.
 */
function makeResourceWithDayPlusGap(key: string, horizon: CTPHorizon, gapSeconds: number = 60): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', key, key);
  res.hierarchy.first = 'Machine';
  const avail = new CTPAvailable();
  const startW = horizon.startW;
  const endW   = horizon.endW;
  let t = startW;
  while (t + DAY <= endW) {
    avail.add(new CTPInterval(t, t + DAY - gapSeconds, 1));
    t += DAY;
  }
  res.original = avail;
  res.assignments = new CTPAssignments();
  res.available.setLists(res.original, res.assignments);
  return res;
}

describe('Continuous calendar (24/7) scheduling', () => {

  // ── Control: tiny gaps work ─────────────────────────────────────────
  it('CONTROL: 168h FLOAT task fits on daily-24h-with-1min-gaps calendar', () => {
    // Establishes the test setup works. This is the shape we know the
    // engine handles correctly today (per the on-disk probe).
    const horizon = makeHorizon(monday('2026-04-13'), 30);
    const resource = makeResourceWithDayPlusGap('SUB', horizon, 60);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 168, resourceKey: 'SUB', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  // ── Failing case #1: single horizon-spanning interval ────────────────
  it('168h FLOAT task fits on a single horizon-spanning interval', () => {
    // A continuous 24/7 calendar represented as one interval. Semantically
    // identical to the gapped-daily shape in the control. The engine
    // currently rejects this — that is the bug. When this test passes,
    // the bug is fixed.
    const horizon = makeHorizon(monday('2026-04-13'), 30);
    const resource = makeResourceWithSingleInterval('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 168, resourceKey: 'SUB', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  // ── Failing case #2: back-to-back daily intervals with no gap ────────
  it('168h FLOAT task fits on back-to-back daily 24h intervals (no gap)', () => {
    // Same 24/7 calendar represented as N daily intervals that touch
    // exactly at midnight. The engine currently rejects this — same bug
    // class as the single-interval case. When this passes, fixed.
    const horizon = makeHorizon(monday('2026-04-13'), 30);
    const resource = makeResourceWithBackToBackDays('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 168, resourceKey: 'SUB', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  // ── A small task should also fit on each shape ───────────────────────
  it('1h FLOAT task fits on a single horizon-spanning interval', () => {
    // Field repro showed even a 1h task on OUTWORK failed; this isolates
    // the bug from any large-duration interaction.
    const horizon = makeHorizon(monday('2026-04-13'), 30);
    const resource = makeResourceWithSingleInterval('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 1, resourceKey: 'SUB', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  it('1h FLOAT task fits on back-to-back daily 24h intervals', () => {
    const horizon = makeHorizon(monday('2026-04-13'), 30);
    const resource = makeResourceWithBackToBackDays('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 1, resourceKey: 'SUB', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  // ── Field-shape repros: calendar SPANS BEYOND the task window ────────
  //
  // Production failure shape: OUTWORK calendar spans ~13 months
  // (2025-12-23 → 2027-01-30) but the task window is only ~70 days
  // (2026-05-18 → 2026-07-27, starting AFTER calendar start). The matching
  // unit tests above pass; these fail-shape tests mimic the actual
  // production setup more closely.

  it('168h FLOAT task with window mid-calendar, single horizon-spanning interval', () => {
    // Horizon spans 90 days but the task's window is days 30-60 only.
    // Calendar is one big interval covering all 90 days. The bug should
    // surface here if it's a window-vs-calendar issue rather than a
    // calendar-shape issue.
    const horizon = makeHorizon(monday('2026-04-13'), 90);
    const resource = makeResourceWithSingleInterval('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 168, resourceKey: 'SUB', horizon,
      windowStart: horizon.startDate.plus({ days: 30 }),
      windowEnd:   horizon.startDate.plus({ days: 60 }),
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  it('168h FLOAT task with window mid-calendar, back-to-back daily intervals', () => {
    // Same window-vs-calendar mismatch but with the back-to-back daily
    // calendar shape. Other production-shape variant.
    const horizon = makeHorizon(monday('2026-04-13'), 90);
    const resource = makeResourceWithBackToBackDays('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 168, resourceKey: 'SUB', horizon,
      windowStart: horizon.startDate.plus({ days: 30 }),
      windowEnd:   horizon.startDate.plus({ days: 60 }),
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });

  it('1h FLOAT task with tight mid-calendar window, single interval', () => {
    // Smallest task, tight window. Isolates from any duration-related effect.
    const horizon = makeHorizon(monday('2026-04-13'), 90);
    const resource = makeResourceWithSingleInterval('SUB', horizon);
    const task = makeFloatTask({
      key: 'OUT', durationHours: 1, resourceKey: 'SUB', horizon,
      windowStart: horizon.startDate.plus({ days: 30 }),
      windowEnd:   horizon.startDate.plus({ days: 35 }),
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('OUT')!;
    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
  });
});
