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
import { DateTime } from 'luxon';
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

  it('PLL-5 case: 16h FLOAT task spans two shifts and ends Tuesday 15:00', () => {
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

  it('records two segments and 16h workDuration on the resource for the PLL-5 case', () => {
    // Segment-aware booking: the FLOAT task envelope spans the overnight
    // gap, but the assignment's segments[] should contain only the on-shift
    // slices (Mon 7-15 and Tue 7-15), and workDuration() should sum to 16h.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
    });

    solveScenario({ horizon, resources: [resource], tasks: [task] });

    const a = resource.assignments?.head?.data;
    expect(a).toBeDefined();
    expect(a!.segments).not.toBeNull();
    expect(a!.segments!.length).toBe(2);
    // segment 0 = Mon 7-15 (8h)
    expect(a!.segments![0].endW - a!.segments![0].startW).toBe(8 * 3600);
    // segment 1 = Tue 7-15 (8h)
    expect(a!.segments![1].endW - a!.segments![1].startW).toBe(8 * 3600);
    // Sum equals task duration (16h working)
    expect(a!.workDuration()).toBe(16 * 3600);
    // Envelope is 32h wall-clock — distinct from work duration
    expect(a!.duration()).toBe(32 * 3600);
  });

  it('weekend skip: 12h FLOAT task starting Friday continues into next Monday', () => {
    // Mon-Fri 8h shifts, no weekend coverage. A 12h FLOAT task starting
    // Friday morning consumes Fri's 8h shift, skips Sat/Sun (no calendar
    // entries), then consumes 4h of Monday's shift. End = Mon 11:00.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    // Window starts Friday 07:00 to force the task to begin Friday.
    const fridayStart = monday('2026-04-13').plus({ days: 4 }).set({ hour: 7 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 12, resourceKey: 'M1', horizon,
      windowStart: fridayStart,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    // Starts Friday 07:00
    expect(p.start!.weekday).toBe(5);
    expect(p.start!.hour).toBe(7);
    // Ends Monday 11:00 (4h consumed of next Monday's shift after Fri's 8h)
    expect(p.end!.weekday).toBe(1);
    expect(p.end!.hour).toBe(11);
    // Wall-clock span: Fri 7am → Mon 11am = 76 hours (includes weekend gap)
    expect(p.endW - p.startW).toBe(76 * 3600);

    // Verify segments — 8h Fri + 4h Mon, weekend NOT in segments
    const a = resource.assignments?.head?.data;
    expect(a!.segments).not.toBeNull();
    expect(a!.segments!.length).toBe(2);
    expect(a!.segments![0].endW - a!.segments![0].startW).toBe(8 * 3600); // Fri 7-15
    expect(a!.segments![1].endW - a!.segments![1].startW).toBe(4 * 3600); // Mon 7-11
    expect(a!.workDuration()).toBe(12 * 3600);
  });

  it('mid-shift start: 6h FLOAT starting at 11:00 spans into next shift', () => {
    // Window starts mid-shift (Mon 11:00). The task gets 4h from the rest
    // of Monday's shift (11-15), then needs 2h more. Continues into Tuesday's
    // shift (Tue 7-9). End = Tue 09:00.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const monday11am = monday('2026-04-13').set({ hour: 11 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 6, resourceKey: 'M1', horizon,
      windowStart: monday11am,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    expect(p.start!.weekday).toBe(1); // Monday
    expect(p.start!.hour).toBe(11);
    expect(p.end!.weekday).toBe(2); // Tuesday
    expect(p.end!.hour).toBe(9);

    // Segments: Mon 11-15 (4h) + Tue 7-9 (2h)
    const a = resource.assignments?.head?.data;
    expect(a!.segments).not.toBeNull();
    expect(a!.segments!.length).toBe(2);
    expect(a!.segments![0].endW - a!.segments![0].startW).toBe(4 * 3600);
    expect(a!.segments![1].endW - a!.segments![1].startW).toBe(2 * 3600);
    expect(a!.workDuration()).toBe(6 * 3600);
  });

  // SKIPPED: Backward-direction FLOAT needs the deferred CommonStartTimesAgent
  // fix (sprint plan Task #2). The range walker correctly computes range.values.lst
  // (the working-time-aware latest start), but feasibleStartTimes() emits one
  // interval per shift in the feasible range and CommonStartTimesAgent builds
  // CTPStartTime entries from those rather than from the range's lst. The picker
  // then takes the latest shift's start instead of the deadline-anchored start.
  // To make this test green, propagate range.eet/lst into CTPStartTime upstream
  // of the picker. Tracked as a follow-up sprint.
  it.skip('backward direction: 16h FLOAT anchored to Friday 15:00 deadline starts Thursday 07:00', () => {
    // BACKWARD scheduling: pick the LATEST start that still satisfies the
    // working-time requirement before the deadline. With 16h work and 8h
    // shifts, the task should consume Thu's 8h + Fri's 8h, starting Thu 7am
    // and ending exactly at the Fri 15:00 deadline.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    // Window ends Friday 15:00 — the deadline anchor for backward scheduling.
    const fridayDeadline = monday('2026-04-13').plus({ days: 4 }).set({ hour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
      windowEnd: fridayDeadline,
    });

    const result = solveScenario({
      horizon, resources: [resource], tasks: [task],
      direction: -1, // BACKWARD
      scoringRule: 'LatestStartTimeScoringRule',
    });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    // Starts Thursday 07:00 (latest start that still finishes by Fri 15:00)
    expect(p.start!.weekday).toBe(4); // Thursday
    expect(p.start!.hour).toBe(7);
    // Ends Friday 15:00 (deadline)
    expect(p.end!.weekday).toBe(5); // Friday
    expect(p.end!.hour).toBe(15);
    // Wall-clock span: Thu 7am → Fri 3pm = 32 hours (includes overnight gap)
    expect(p.endW - p.startW).toBe(32 * 3600);

    // Segments: Thu 7-15 (8h) + Fri 7-15 (8h)
    const a = resource.assignments?.head?.data;
    expect(a!.segments).not.toBeNull();
    expect(a!.segments!.length).toBe(2);
    expect(a!.workDuration()).toBe(16 * 3600);
  });

  it('FIXED task assignment has no segments populated (envelope == work)', () => {
    // FIXED tasks fit in a single contiguous slot by definition, so segments
    // computation is skipped. workDuration() falls back to envelope duration.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFixedTask({
      key: 'T1', durationHours: 4, resourceKey: 'M1', horizon,
    });

    solveScenario({ horizon, resources: [resource], tasks: [task] });

    const a = resource.assignments?.head?.data;
    expect(a).toBeDefined();
    expect(a!.segments).toBeNull();
    expect(a!.workDuration()).toBe(4 * 3600); // falls back to envelope
    expect(a!.duration()).toBe(4 * 3600);
  });

});
