import { describe, it, expect } from 'vitest';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import {
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
} from '../../Models/Entities/task';
import { CTPInterval } from '../../Models/Core/window';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPResource } from '../../Models/Entities/resource';
import { CTPAssignments } from '../../Models/Intervals/intervals';
import { CTPAssignmentConstants } from '../../Models/Core/constants';
import { TaskFactory } from '../../Factories/taskfactory';
import { serializeOverlay } from '../../Snapshot/overlay';
import { reconstructOverlay } from '../../Snapshot/reconstruct';
import { makeDuration } from '../helpers/builders';

/**
 * P2 — reconstruct + round-trip identity (the go/no-go gate).
 * Proves: serialize(reconstruct(base, serialize(L))) === serialize(L), i.e. the
 * scheduled state is recreated EXACTLY from disk without solving.
 */

/** A solved, override-laden landscape: T1 placed + pinned + window-tightened +
 *  in-process, with a generated CHANGEOVER task. */
function makeSolvedLandscape(): SchedulingLandscape {
  const t1 = new CTPTask('PROCESS', 'Mill Op', 'T1');
  t1.duration = makeDuration(3600);
  t1.state = 1;
  t1.scheduled = new CTPInterval(1000, 4600);
  const slots = new CTPTaskResourceList();
  slots.add(new CTPTaskResource('R1', true, 0, 'R1', 'MONITORED'));
  t1.capacityResources = slots;
  t1.pinned = true;
  t1.includeInSolve = false;
  t1.window = new CTPInterval(500, 9000);
  t1.window.startW = 600; // tightened by solve
  t1.priority = 5;
  t1.manualPriority = 5;
  t1.commitmentLevel = 'running';
  t1.wipstate = 1;
  t1.dispatched = true;
  t1.percentComplete = 40;
  t1.remainingDuration = 2160;
  t1.actualStart = '2026-06-27T10:05:00Z';
  t1.actualResources = ['R1'];

  const co = TaskFactory.createStateTask(t1, 'SETUP', 'Changeover', 900);
  co.state = 1;
  co.scheduled = new CTPInterval(100, 1000);
  const coSlots = new CTPTaskResourceList();
  coSlots.add(new CTPTaskResource('R1', true, 0, 'R1'));
  co.capacityResources = coSlots;

  const ls = new SchedulingLandscape();
  ls.tasks = new CTPTasks();
  ls.tasks.addEntity(t1);
  ls.tasks.addEntity(co);
  return ls;
}

/** A base landscape: T1's definition only (a slot to bind to), NO placement.
 *  The generated CHANGEOVER task has no base row. */
function makeBaseLandscape(): SchedulingLandscape {
  const t1 = new CTPTask('PROCESS', 'Mill Op', 'T1');
  t1.duration = makeDuration(3600);
  const slots = new CTPTaskResourceList();
  slots.add(new CTPTaskResource('R1', true, 0)); // definition: eligible R1, default mode, unscheduled
  t1.capacityResources = slots;

  const ls = new SchedulingLandscape();
  ls.tasks = new CTPTasks();
  ls.tasks.addEntity(t1);
  return ls;
}

describe('reconstructOverlay (P2)', () => {
  it('ROUND-TRIP IDENTITY: reconstruct onto a clean base reproduces the overlay exactly', () => {
    const solved = makeSolvedLandscape();
    const overlay1 = serializeOverlay(solved);

    const base = makeBaseLandscape(); // no placement, no generated task
    const rebuilt = reconstructOverlay(base, overlay1);
    const overlay2 = serializeOverlay(rebuilt);

    expect(overlay2).toEqual(overlay1);
  });

  it('is idempotent: reconstructing a landscape from its own overlay is a no-op', () => {
    const ls = makeSolvedLandscape();
    const overlay1 = serializeOverlay(ls);
    reconstructOverlay(ls, overlay1);
    expect(serializeOverlay(ls)).toEqual(overlay1);
  });

  it('recreates the solve-generated task from the overlay (no base row)', () => {
    const overlay = serializeOverlay(makeSolvedLandscape());
    const base = makeBaseLandscape();
    expect(base.tasks.size()).toBe(1); // only T1 in base

    reconstructOverlay(base, overlay);

    expect(base.tasks.size()).toBe(2); // changeover created
    const gen = base.tasks.toArray().find(t => t.generated);
    expect(gen).toBeDefined();
    expect(gen!.type).toBe('SETUP');
    expect(gen!.duration!.duration()).toBe(900);
    expect(gen!.scheduled).not.toBeNull();
  });

  it('produces a behaviorally-usable landscape (overrides honored, adjacency re-derived)', () => {
    const overlay = serializeOverlay(makeSolvedLandscape());
    const base = makeBaseLandscape();
    reconstructOverlay(base, overlay);

    const t1 = base.tasks.getEntity('T1')!;
    expect(t1.pinned).toBe(true);
    expect(t1.canSolve()).toBe(false); // pinned ⇒ not solvable — override took effect
    expect(t1.scheduled!.startW).toBe(1000);
  });

  it('round-trips resource downtime (MAINTENANCE intervals) through serialize/reconstruct', () => {
    // landscape with a resource carrying a downtime interval
    const res = new CTPResource('REUSABLE', 'Machine', 'M1', 'R1');
    res.assignments = new CTPAssignments();
    const dt = new CTPInterval(5000, 9000);
    dt.name = 'Planned PM';
    dt.type = CTPAssignmentConstants.MAINTENANCE;
    res.assignments.add(dt);

    const solved = new SchedulingLandscape();
    solved.resources.addEntity(res);
    const overlay1 = serializeOverlay(solved);
    expect(overlay1.resourceDowntime).toEqual([
      { resourceKey: 'R1', startW: 5000, endW: 9000, reason: 'Planned PM' },
    ]);

    // reconstruct onto a clean base resource (no downtime)
    const baseRes = new CTPResource('REUSABLE', 'Machine', 'M1', 'R1');
    baseRes.assignments = new CTPAssignments();
    const base = new SchedulingLandscape();
    base.resources.addEntity(baseRes);
    reconstructOverlay(base, overlay1);

    expect(serializeOverlay(base).resourceDowntime).toEqual(overlay1.resourceDowntime);
  });

  it('re-derives preds/succs adjacency from base precedence without solving', () => {
    // base: T1 → T2 chain (linkId precedence is BASE, carried by reconstruct's buildAdjacency)
    const a = new CTPTask('PROCESS', 'A', 'A');
    a.duration = makeDuration(100);
    a.linkId = new CTPLinkId('chain', 'ES', '', null);
    const b = new CTPTask('PROCESS', 'B', 'B');
    b.duration = makeDuration(100);
    b.linkId = new CTPLinkId('chain', 'ES', 'A', null); // B's predecessor = A

    const base = new SchedulingLandscape();
    base.tasks = new CTPTasks();
    base.tasks.addEntity(a);
    base.tasks.addEntity(b);

    // a minimal overlay that just places both
    const solved = new SchedulingLandscape();
    solved.tasks = new CTPTasks();
    const a2 = new CTPTask('PROCESS', 'A', 'A'); a2.state = 1; a2.scheduled = new CTPInterval(0, 100);
    const b2 = new CTPTask('PROCESS', 'B', 'B'); b2.state = 1; b2.scheduled = new CTPInterval(100, 200);
    solved.tasks.addEntity(a2);
    solved.tasks.addEntity(b2);

    reconstructOverlay(base, serializeOverlay(solved));

    expect(base.tasks.getEntity('B')!.preds).toContain('A');
    expect(base.tasks.getEntity('A')!.succs).toContain('B');
  });
});
