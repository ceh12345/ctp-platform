import { describe, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  makeHorizon, makeResourceWithShifts, makeFloatTask, solveScenario, monday,
} from '../helpers/float-helpers';
import { CTPDateTime } from '../../Models/Core/date';
import { CTPDurationConstants } from '../../Models/Core/constants';

function fmt(sec: number): string {
  const dt = CTPDateTime.toDateTime(sec).toUTC();
  return dt.toFormat('ccc LLL dd HH:mm');
}

describe('FLOAT debug — backward direction', () => {
  // Diagnostic for the deferred backward-FLOAT story. Unskip + tweak prints
  // when investigating why the picker selects window.endW instead of
  // ranges.lst. Today the matrix is empty after solve (logs in post-solve
  // dumps); investigation needs in-engine instrumentation or a different
  // entry point.
  it.skip('dumps CTPStartTime entries + matrix for backward 16h FLOAT to deadline Fri 15', () => {
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const fridayDeadline = monday('2026-04-13').plus({ days: 4 }).set({ hour: 15 });
    const task = makeFloatTask({
      key: 'T1', durationHours: 16, resourceKey: 'M1', horizon,
      windowEnd: fridayDeadline,
    });

    const result = solveScenario({
      horizon, resources: [resource], tasks: [task],
      direction: -1,
      scoringRule: 'LatestStartTimeScoringRule',
    });
    const p = result.get('T1')!;
    console.log('\n=== Backward placement ===');
    console.log(`  start: ${p.start?.toISO()}  weekday=${p.start?.weekday} hour=${p.start?.hour}`);
    console.log(`  end:   ${p.end?.toISO()}  weekday=${p.end?.weekday} hour=${p.end?.hour}`);
    console.log(`  span:  ${(p.endW - p.startW)/3600}h wall-clock`);

    // Inspect the FLOAT range stored on the resource's matrix
    console.log('\n=== FLOAT ranges in matrix ===');
    const floatList = resource.available?.matrix?.index(CTPDurationConstants.FLOAT_DURATION);
    let r = floatList?.head;
    let i = 0;
    while (r && i < 5) {
      const range: any = r.data;
      console.log(`  range[${i}]: startW=${fmt(range.startW)} endW=${fmt(range.endW)} qty=${range.qty}`);
      console.log(`    overallDuration=${range.overallDuration}s (=${range.overallDuration/3600}h)`);
      console.log(`    values.est=${fmt(range.values.est)}, values.eet=${fmt(range.values.eet)}`);
      console.log(`    values.lst=${fmt(range.values.lst)}, values.lett=${fmt(range.values.lett)}`);
      console.log(`    valid=${range.valid}`);
      r = r.next; i++;
    }
  });
});

describe('FLOAT debug', () => {
  it('dumps the resource availability + task duration + matrix state', () => {
    const horizon = makeHorizon(monday('2026-04-13'), 14);
    const resource = makeResourceWithShifts('M1', horizon, { startHour: 7, endHour: 15 });
    const task = makeFloatTask({ key: 'T1', durationHours: 16, resourceKey: 'M1', horizon });

    // 1. Resource.original (the raw availability list — the calendar shifts)
    console.log('\n=== Resource.original (discrete shift intervals) ===');
    let n = resource.original?.head;
    let count = 0;
    while (n && count < 12) {
      console.log(`  ${fmt(n.data.startW)}  →  ${fmt(n.data.endW)}  (qty=${n.data.qty})`);
      n = n.next;
      count++;
    }

    // 2. Task duration type
    console.log('\n=== Task duration ===');
    console.log(`  durationType: ${task.duration?.durationType} (FLOAT_DURATION=${CTPDurationConstants.FLOAT_DURATION})`);
    console.log(`  duration seconds: ${task.duration?.endW}`);
    console.log(`  qty: ${task.duration?.qty}`);

    // 3. Run the solve
    const result = solveScenario({ horizon, resources: [resource], tasks: [task] });
    const p = result.get('T1')!;
    console.log('\n=== Placement ===');
    console.log(`  start: ${p.start?.toISO()}`);
    console.log(`  end:   ${p.end?.toISO()}`);
    console.log(`  span:  ${(p.endW - p.startW)/3600}h wall-clock`);

    // 4. Available matrix state for FIXED, FLOAT after solve
    console.log('\n=== After solve — resource.available.matrix lists ===');
    const matrix = resource.available?.matrix;
    if (matrix) {
      for (const slotName of ['FIXED_DURATION', 'FLOAT_DURATION', 'UNTRACKED']) {
        const slotIdx = (CTPDurationConstants as any)[slotName];
        const list = matrix.index(slotIdx);
        console.log(`  ${slotName} (idx=${slotIdx}):`);
        if (!list) { console.log('    <null>'); continue; }
        let nn = list.head; let cc = 0;
        while (nn && cc < 8) {
          console.log(`    ${fmt(nn.data.startW)}  →  ${fmt(nn.data.endW)}  (qty=${nn.data.qty}, dur=${nn.data.endW - nn.data.startW}s)`);
          nn = nn.next; cc++;
        }
      }
    }
  });
});
