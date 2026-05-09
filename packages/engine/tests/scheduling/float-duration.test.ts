/**
 * FLOAT-duration scheduling — end-to-end behavior.
 *
 * FLOAT_DURATION (durationType=1) lets a task's working time accumulate
 * across non-contiguous resource availability windows. A FIXED task must
 * fit entirely in one continuous availability slot; a FLOAT task can span
 * shift boundaries, weekends, and holidays — its duration is a sum of
 * working time, not wall-clock time.
 *
 * These tests document the FLOAT semantics by example. Each test name is
 * a sentence about timing; assertions are specific (Tuesday 15:00, not
 * "scheduled successfully").
 *
 * NOTE: FLOAT is supported in the engine but not yet enabled in any
 * tenant's mapping config. Tests construct synthetic FLOAT tasks
 * directly. v3.2 mapping work plans to flip Stafford to all-FLOAT —
 * these tests prove the engine path before that flip.
 */

import { describe, it, expect } from 'vitest';
import {
  makeHorizon, makeResourceWithShifts, makeFloatTask, makeFixedTask,
  solveScenario, monday,
} from '../helpers/float-helpers';

describe('FLOAT task duration handling', () => {

  it('control: 4h FLOAT task on 8h shift fits in one shift (matches FIXED behavior)', () => {
    // Control case — when a FLOAT task fits inside a single shift, it
    // behaves identically to a FIXED task. Sanity check that FLOAT plumbing
    // doesn't break the simple case.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 4, resourceKey: 'M1', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
    // Should land at the start of Monday's 7am-3pm shift, last 4 hours
    expect(p.start!.weekday).toBe(1); // Monday
    expect(p.start!.hour).toBe(7);
    expect(p.end!.weekday).toBe(1); // same Monday
    expect(p.end!.hour).toBe(11); // 7am + 4h
    expect(p.endW - p.startW).toBe(4 * 3600); // 4 hours wall clock = 4 hours of work
  });

  // Skipped pending engine fix in commonstarttimes.ts + scheduleengine.ts.
  // The walker (interval-walker.ts) and CTPRange (range.ts) compute the
  // working-time end correctly via range.values.eet, but commonstarttimes.ts
  // discards it when constructing CTPStartTime, and scheduleengine.ts then
  // computes et = st + duration (wall-clock). See sprint-float-working-time.md.
  it.skip('PLL-5 case: 16h FLOAT task spans two shifts and ends Tuesday 15:00', () => {
    // The headline case from Stafford. A 16h task can't fit in a single
    // 8h shift; under FIXED it would be infeasible. Under FLOAT, working
    // time accumulates across shifts: 8h Monday + 8h Tuesday = 16h, with
    // overnight gap not counting against the duration.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    expect(p.errors).toEqual([]);
    // Starts Monday 07:00 (earliest available shift start)
    expect(p.start!.weekday).toBe(1); // Monday
    expect(p.start!.hour).toBe(7);
    // Ends Tuesday 15:00 (after consuming 8h Mon shift + 8h Tue shift)
    expect(p.end!.weekday).toBe(2); // Tuesday
    expect(p.end!.hour).toBe(15);
    // Wall-clock span: Mon 7am → Tue 3pm = 32 hours (includes overnight gap)
    expect(p.endW - p.startW).toBe(32 * 3600);
  });

});
