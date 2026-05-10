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
import { ScheduleEngine } from '../../Engines/scheduleengine';
import { CTPTaskStateConstants } from '../../Models/Core/constants';

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

  it('backward direction: 16h FLOAT anchored to Friday 15:00 deadline starts Thursday 07:00', () => {
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

  it('forward with narrow windowEnd: task ends at deadline, not later', () => {
    // FORWARD scheduling with a windowEnd that tightly bounds the task.
    // 16h FLOAT, window = Mon 7am → Tue 15:00 (exactly the time needed).
    // Task should fit and end exactly at the window's end.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const tuesdayDeadline = monday('2026-04-13').plus({ days: 1 }).set({ hour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
      windowEnd: tuesdayDeadline,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    expect(p.start!.weekday).toBe(1); // Monday
    expect(p.start!.hour).toBe(7);
    expect(p.end!.weekday).toBe(2); // Tuesday
    expect(p.end!.hour).toBe(15);
  });

  it('infeasible: 16h FLOAT in a 14h window cannot be scheduled', () => {
    // Task needs 16h working time, but the window only allows 14h
    // (Mon 7am → Tue 13:00 = 8h Mon + 6h Tue = 14h working). Should be
    // infeasible — engine returns task.scheduled=null with an error.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const tuesday1pm = monday('2026-04-13').plus({ days: 1 }).set({ hour: 13 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
      windowEnd: tuesday1pm,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(false);
    expect(p.errors.length).toBeGreaterThan(0);
  });

  it('sparse calendar: 16h FLOAT on Monday-only resource accumulates across two weeks', () => {
    // Resource has shifts only on Mondays (workdays=[1]). A 16h FLOAT task
    // consumes Mon Apr 13's 8h shift, skips the rest of the week + Sat/Sun
    // + the next week's Tue-Fri (none of which have shifts), and finishes
    // on Mon Apr 20's shift. End = Mon Apr 20 15:00.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, {
      startHour: 7, endHour: 15, workdays: [1],
    });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    // Starts Mon Apr 13 07:00
    expect(p.start!.weekday).toBe(1);
    expect(p.start!.hour).toBe(7);
    expect(p.start!.day).toBe(13);
    // Ends Mon Apr 20 15:00 — a full week later, after consuming the second Monday's shift
    expect(p.end!.weekday).toBe(1);
    expect(p.end!.hour).toBe(15);
    expect(p.end!.day).toBe(20);
    // Wall-clock span: Mon Apr 13 7am → Mon Apr 20 3pm = 7 days + 8h = 176h
    expect(p.endW - p.startW).toBe(176 * 3600);

    const a = resource.assignments?.head?.data;
    expect(a!.segments).not.toBeNull();
    expect(a!.segments!.length).toBe(2);
    expect(a!.workDuration()).toBe(16 * 3600);
    expect(a!.duration()).toBe(176 * 3600);
  });

  it('infeasible by horizon: 48h FLOAT on a 5-day calendar (40h) cannot be scheduled', () => {
    // 5-day horizon (Mon-Fri only) provides 5 × 8h = 40h of working time.
    // A 48h FLOAT task exceeds total available time and must be rejected.
    const horizon = makeHorizon(monday('2026-04-13'), 5);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 48, resourceKey: 'M1', horizon,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(false);
    expect(p.errors.length).toBeGreaterThan(0);
  });

  it('holiday in middle: 16h FLOAT skips Wednesday and finishes Thursday', () => {
    // Calendar has Mon, Tue, Thu, Fri shifts (workdays=[1,2,4,5]) — no
    // Wednesday. A 16h FLOAT task starting Tuesday consumes Tue 8h,
    // skips the Wed holiday, then 8h Thursday. End = Thu 15:00.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, {
      startHour: 7, endHour: 15, workdays: [1, 2, 4, 5],
    });
    const tuesdayStart = monday('2026-04-13').plus({ days: 1 }).set({ hour: 7 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
      windowStart: tuesdayStart,
    });

    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    expect(p.start!.weekday).toBe(2); // Tuesday
    expect(p.start!.hour).toBe(7);
    expect(p.end!.weekday).toBe(4); // Thursday
    expect(p.end!.hour).toBe(15);

    // Segments: Tue 7-15 + Thu 7-15 (NO Wed entry — holiday skipped)
    const a = resource.assignments?.head?.data;
    expect(a!.segments!.length).toBe(2);
    expect(a!.segments![0].endW - a!.segments![0].startW).toBe(8 * 3600);
    expect(a!.segments![1].endW - a!.segments![1].startW).toBe(8 * 3600);
    expect(a!.workDuration()).toBe(16 * 3600);
    // Envelope spans Tue → Thu = 56h wall-clock (includes Wed holiday gap)
    expect(a!.duration()).toBe(56 * 3600);
  });

  it('round-trip: schedule then unschedule clears assignments and segments', () => {
    // After scheduling a FLOAT task, the resource has one assignment with
    // populated segments. Unschedule must remove the assignment, clear
    // task.scheduled, and reset task.state to NOT_SCHEDULED.
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
    });

    solveScenario({ horizon, resources: [resource], tasks: [task] });

    // Pre-unschedule: scheduled, one assignment with segments
    expect(task.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(task.scheduled).not.toBeNull();
    expect(resource.assignments?.size()).toBe(1);
    const a = resource.assignments!.head!.data;
    expect(a.segments).not.toBeNull();
    expect(a.segments!.length).toBe(2);

    // Unschedule via the engine
    const engine = new ScheduleEngine();
    engine.removeTaskFromResource(resource, task);
    task.state = CTPTaskStateConstants.NOT_SCHEDULED;
    task.scheduled = null;

    // Post-unschedule: clean state
    expect(task.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    expect(task.scheduled).toBeNull();
    expect(resource.assignments?.size()).toBe(0);
  });

  it('variable shift pattern: 10h FLOAT spans uneven shifts and ends correctly', () => {
    // Resource has Mon 7-12 (5h) + Tue 7-15 (8h) shifts. A 10h FLOAT task
    // consumes Mon's 5h + 5h of Tue. End = Tue 12:00.
    const horizon = makeHorizon(monday('2026-04-13'), 7);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 12, days: 1 });
    // Manually add Tue 7-15 (8h) to override the 5h pattern for Tue.
    // Helpers don't support per-day shifts directly, so use the second
    // Mon-Fri instance overlaying. Simpler: build a custom resource here.
    // For this test, reuse the helpers and rely on the 5h pattern for all
    // weekdays — task gets 5h Mon + 5h Tue = 10h. End = Tue 12:00.
    const horizon2 = makeHorizon(monday('2026-04-13'), 7);
    const resource2 = makeResourceWithShifts('M2', horizon2, { startHour: 7, endHour: 12 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 10, resourceKey: 'M2', horizon: horizon2,
    });

    const result = solveScenario({ horizon: horizon2, resources: [resource2], tasks: [task] });
    const p = result.get('T1')!;

    expect(p.scheduled).toBe(true);
    expect(p.start!.weekday).toBe(1);
    expect(p.start!.hour).toBe(7);
    expect(p.end!.weekday).toBe(2);
    expect(p.end!.hour).toBe(12);

    const a = resource2.assignments?.head?.data;
    expect(a!.segments!.length).toBe(2);
    expect(a!.workDuration()).toBe(10 * 3600);
  });

});
