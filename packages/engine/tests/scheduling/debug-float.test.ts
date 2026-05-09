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
