import { describe, it, expect } from 'vitest';
import { CTPScheduler } from '../../AI/Schedulers/defaultscheduler';
import {
  CTPTask, CTPTasks, CTPTaskResource, CTPTaskResourceList,
} from '../../Models/Entities/task';
import { CTPResource, CTPResources, CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPDuration, CTPInterval } from '../../Models/Core/window';
import { CTPAvailable } from '../../Models/Intervals/intervals';
import { CTPResourceConstants, CTPTaskStateConstants } from '../../Models/Core/constants';
import { CTPStateChanges } from '../../Models/Entities/statechange';
import { CTPProcesses, CTPProcess } from '../../Models/Entities/process';
import { CTPLinkId } from '../../Models/Core/linkid';
import { List } from '../../Models/Core/list';
import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';

const ONE_HOUR = 3600;

function makeHorizon(): CTPHorizon {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  return new CTPHorizon(st, st.plus({ days: 7 }));
}
function dayStartW(horizon: CTPHorizon, i: number): number {
  return CTPDateTime.fromDateTime(horizon.startDate.plus({ days: i }));
}
function makeResource8h(key: string, horizon: CTPHorizon): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Machine', key, key);
  res.hierarchy.first = 'Machine';
  const avail = new CTPAvailable();
  for (let i = 0; i < 7; i++) {
    const day = dayStartW(horizon, i);
    avail.add(new CTPInterval(day + 8 * ONE_HOUR, day + 16 * ONE_HOUR, 1));
  }
  res.original = avail;
  res.available.setOriginal(res.original);
  return res;
}
function makeScoring(): CTPScoring {
  const s = new CTPScoring('Test', 'test');
  s.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
  return s;
}
function withResource(task: CTPTask, resKey: string): CTPTask {
  task.capacityResources = new CTPTaskResourceList();
  const tr = new CTPTaskResource('Machine', true);
  tr.preferences.push(new CTPResourcePreference(resKey, 1));
  task.capacityResources.add(tr);
  return task;
}

/**
 * Cross-WO Enforcement: a PLANNED successor WO must schedule no earlier than its
 * cross-WO predecessor's committed end — even when that predecessor is pinned
 * (completed/running) outside the solve scope. This is the committed-predecessor
 * floor (D4/§6) that the slim-100 data does not naturally exercise (every
 * committed-predecessor edge there also has a committed successor).
 */
describe('cross-WO enforcement — planned successor behind a pinned predecessor', () => {
  it('floors the planned parent WO head behind the pinned child WO committed end', () => {
    const horizon = makeHorizon();
    const m1 = makeResource8h('M1', horizon);

    // CHILD WO — a single committed/pinned task ending day-2 16:00 (history).
    const childEnd = dayStartW(horizon, 2) + 16 * ONE_HOUR;
    const childTail = new CTPTask('PROCESS', 'Child Tail', 'CHILD-T');
    childTail.duration = new CTPDuration(2 * ONE_HOUR, 1.0);
    childTail.linkId = new CTPLinkId('CHILD', 'ES', '', null);
    childTail.sequence = 1;
    childTail.state = CTPTaskStateConstants.SCHEDULED;
    childTail.scheduled = new CTPInterval(dayStartW(horizon, 0) + 8 * ONE_HOUR, childEnd);
    childTail.pinned = true;
    childTail.processed = true;          // committed — scheduler must not touch it

    // PARENT WO — planned 2-task chain; its head carries the cross-WO prevLink
    // into the child's tail (maxGap null, as the hydrator would set).
    const parentHead = withResource(new CTPTask('PROCESS', 'Parent Head', 'PARENT-A'), 'M1');
    parentHead.duration = new CTPDuration(2 * ONE_HOUR, 1.0);
    parentHead.window = new CTPInterval(horizon.startW, horizon.endW);
    parentHead.linkId = new CTPLinkId('PARENT-WO', 'ES', 'CHILD-T', null); // cross-WO edge
    parentHead.sequence = 1;

    const parentTwo = withResource(new CTPTask('PROCESS', 'Parent 2', 'PARENT-B'), 'M1');
    parentTwo.duration = new CTPDuration(1 * ONE_HOUR, 1.0);
    parentTwo.window = new CTPInterval(horizon.startW, horizon.endW);
    parentTwo.linkId = new CTPLinkId('PARENT-WO', 'ES', 'PARENT-A', 0);
    parentTwo.sequence = 2;

    const tasks = new CTPTasks();
    [childTail, parentHead, parentTwo].forEach(t => tasks.addEntity(t));
    const resources = new CTPResources();
    resources.addEntity(m1);

    const childChain = new CTPProcess('CHILD');
    childChain.tasks?.add(childTail);
    const parentChain = new CTPProcess('PARENT-WO');
    parentChain.tasks?.add(parentHead);
    parentChain.tasks?.add(parentTwo);
    const processes = new CTPProcesses();
    processes.addEntity(childChain);
    processes.addEntity(parentChain);

    const settings = new CTPAppSettings();
    settings.scheduleDirection = 1; // FORWARD
    settings.hasChains = true;

    const scheduler = new CTPScheduler();
    scheduler.initLandscape(horizon, tasks, resources, new CTPStateChanges(), processes);
    scheduler.initScoring(makeScoring());
    scheduler.initSettings(settings);

    const toSchedule = new List<CTPTask>();
    toSchedule.add(parentHead);
    toSchedule.add(parentTwo);
    scheduler.schedule(toSchedule);

    // The planned parent head must be scheduled, and NOT before the pinned child end.
    expect(parentHead.state).toBe(CTPTaskStateConstants.SCHEDULED);
    expect(parentHead.scheduled).not.toBeNull();
    expect(parentHead.scheduled!.startW).toBeGreaterThanOrEqual(childEnd);

    // The pinned child must be untouched (still its committed interval).
    expect(childTail.scheduled!.endW).toBe(childEnd);
  });
});
