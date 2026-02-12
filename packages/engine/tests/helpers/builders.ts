import { CTPInterval, CTPDuration, CTPRunRate } from '../../Models/Core/window';
import { CTPIntervals, CTPAvailable, CTPAssignments } from '../../Models/Intervals/intervals';
import { CTPDurationConstants, CTPResourceConstants } from '../../Models/Core/constants';
import { CTPResource } from '../../Models/Entities/resource';
import { CTPTask } from '../../Models/Entities/task';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { DateTime } from 'luxon';
import { CTPDateTime } from '../../Models/Core/date';
import { AvailableMatrix } from '../../Models/Intervals/availablematrix';
import { List } from '../../Models/Core/list';
import { CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResourcePreference } from '../../Models/Entities/resource';

/** Create a single CTPInterval */
export function makeInterval(startW: number, endW: number, qty?: number): CTPInterval {
  return new CTPInterval(startW, endW, qty);
}

/** Build a CTPIntervals linked list from an array of specs */
export function makeIntervals(specs: { s: number; e: number; q?: number }[]): CTPIntervals {
  const intervals = new CTPIntervals();
  for (const spec of specs) {
    intervals.add(new CTPInterval(spec.s, spec.e, spec.q));
  }
  return intervals;
}

/** Build a CTPAvailable linked list from specs */
export function makeAvailable(specs: { s: number; e: number; q?: number }[]): CTPAvailable {
  const avail = new CTPAvailable();
  for (const spec of specs) {
    avail.add(new CTPInterval(spec.s, spec.e, spec.q));
  }
  return avail;
}

/** Build a CTPAssignments linked list from specs */
export function makeAssignments(specs: { s: number; e: number; q?: number }[]): CTPAssignments {
  const assignments = new CTPAssignments();
  for (const spec of specs) {
    assignments.add(new CTPInterval(spec.s, spec.e, spec.q));
  }
  return assignments;
}

/** Create a CTPDuration */
export function makeDuration(
  duration: number,
  qty: number = 1,
  type: number = CTPDurationConstants.FIXED_DURATION,
): CTPDuration {
  return new CTPDuration(duration, qty, type);
}

/** Create a CTPHorizon from a fixed reference date */
export function makeHorizon(days: number = 14): CTPHorizon {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  const et = st.plus({ days });
  return new CTPHorizon(st, et);
}

/** Create a CTPResource with optional availability */
export function makeResource(
  name: string,
  key: string,
  availSpecs?: { s: number; e: number; q?: number }[],
): CTPResource {
  const res = new CTPResource(CTPResourceConstants.REUSABLE, 'Resource', name, key);
  if (availSpecs) {
    res.original = makeAvailable(availSpecs);
    res.available.setOriginal(res.original);
  }
  return res;
}

/** Create a CTPTask */
export function makeTask(
  name: string,
  key: string,
  duration: number,
  qty: number = 1,
  windowStart?: number,
  windowEnd?: number,
): CTPTask {
  const task = new CTPTask('PROCESS', name, key);
  task.duration = makeDuration(duration, qty);
  if (windowStart !== undefined && windowEnd !== undefined) {
    task.window = new CTPInterval(windowStart, windowEnd);
  }
  return task;
}

/** Convert CTPIntervals linked list to array for easy assertion */
export function intervalsToArray(
  intervals: CTPIntervals | null,
): { s: number; e: number; q: number | null }[] {
  if (!intervals) return [];
  const result: { s: number; e: number; q: number | null }[] = [];
  let ptr = intervals.head;
  while (ptr) {
    result.push({ s: ptr.data.startW, e: ptr.data.endW, q: ptr.data.qty });
    ptr = ptr.next;
  }
  return result;
}

/** Create a CTPScoring with rules */
export function makeScoring(
  rules: { name: string; weight: number; objective?: number }[],
): CTPScoring {
  const scoring = new CTPScoring('TestScoring', 'test-scoring');
  for (const rule of rules) {
    scoring.addConfig(new CTPScoringConfiguration(rule.name, rule.weight, rule.objective));
  }
  return scoring;
}

/** Build a deterministic landscape for end-to-end testing */
export function buildTestLandscape(opts: {
  days?: number;
  resources: { name: string; key: string; type: string; avail: { s: number; e: number; q?: number }[] }[];
  tasks: {
    name: string;
    key: string;
    duration: number;
    qty?: number;
    sequence?: number;
    rank?: number;
    resourceType: string;
  }[];
}): {
  horizon: CTPHorizon;
  resources: CTPResource[];
  tasks: CTPTask[];
} {
  const horizon = makeHorizon(opts.days ?? 14);

  const resources: CTPResource[] = [];
  for (const r of opts.resources) {
    const res = new CTPResource(CTPResourceConstants.REUSABLE, r.type, r.name, r.key);
    res.hierarchy.first = r.type;
    res.original = makeAvailable(r.avail);
    resources.push(res);
  }

  const tasks: CTPTask[] = [];
  for (const t of opts.tasks) {
    const task = new CTPTask('PROCESS', t.name, t.key);
    task.duration = makeDuration(t.duration, t.qty ?? 1);
    task.window = new CTPInterval(horizon.startW, horizon.endW);
    task.sequence = t.sequence ?? 0;
    task.rank = t.rank ?? 0;
    task.capacityResources = new CTPTaskResourceList();
    task.capacityResources.add(new CTPTaskResource(t.resourceType, true));

    // Add resource preferences: link task to all resources of matching type
    const taskRes = task.capacityResources.at(0);
    if (taskRes) {
      for (const r of resources) {
        if (r.hierarchy.first === t.resourceType) {
          taskRes.preferences.push(new CTPResourcePreference(r.key, 1));
        }
      }
    }

    tasks.push(task);
  }

  return { horizon, resources, tasks };
}
