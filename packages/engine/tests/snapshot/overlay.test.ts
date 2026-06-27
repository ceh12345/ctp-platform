import { describe, it, expect } from 'vitest';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import {
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
} from '../../Models/Entities/task';
import { CTPInterval } from '../../Models/Core/window';
import { TaskFactory } from '../../Factories/taskfactory';
import { serializeOverlay, OVERLAY_SCHEMA_VERSION } from '../../Snapshot/overlay';
import { makeDuration } from '../helpers/builders';

/**
 * P1 — overlay serialize. Asserts the overlay carries every OVERLAY-bucket field
 * (placement + overrides + inline actuals), includes solve-generated tasks as fat
 * rows, and EXCLUDES base/derived fields. See docs/sprints/snapshot-p0-field-classification.md.
 */

/** A fully-placed, override-laden, in-process task — exercises every overlay field. */
function makeScheduledTask(): CTPTask {
  const t = new CTPTask('PROCESS', 'Mill Op', 'T1');
  t.duration = makeDuration(3600);

  // placement
  t.state = 1; // SCHEDULED
  t.scheduled = new CTPInterval(1000, 4600);

  const slot = new CTPTaskResource('R1', true, 0, 'R1', 'REQUIRED');
  const slots = new CTPTaskResourceList();
  slots.add(slot);
  t.capacityResources = slots;

  // planning overrides
  t.pinned = true;
  t.includeInSolve = false;
  t.window = new CTPInterval(500, 9000);
  t.window.startW = 600;   // tightened by solve (differs from origStartW)
  t.priority = 5;
  t.manualPriority = 5;

  // actuals (inline)
  t.commitmentLevel = 'running';
  t.wipstate = 1;
  t.dispatched = true;
  t.dispatchedAt = '2026-06-27T10:00:00Z';
  t.materialsPulled = true;
  t.percentComplete = 40;
  t.remainingDuration = 2160;
  t.actualStart = '2026-06-27T10:05:00Z';
  t.actualResources = ['R1'];
  t.holdReason = null;

  return t;
}

describe('serializeOverlay (P1)', () => {
  it('captures every overlay-bucket field for a placed, overridden, in-process task', () => {
    const t = makeScheduledTask();
    const landscape = new SchedulingLandscape();
    landscape.tasks = new CTPTasks();
    landscape.tasks.addEntity(t);

    const doc = serializeOverlay(landscape);

    expect(doc.version).toBe(OVERLAY_SCHEMA_VERSION);
    expect(doc.taskCount).toBe(1);
    const row = doc.rows[0];

    // placement
    expect(row.taskKey).toBe('T1');
    expect(row.state).toBe(1);
    expect(row.scheduled).toEqual({ startW: 1000, endW: 4600 });
    expect(row.assignments).toEqual([{ slotIndex: 0, resourceKey: 'R1' }]);

    // overrides
    expect(row.pinned).toBe(true);
    expect(row.includeInSolve).toBe(false);
    expect(row.window).toEqual({ startW: 600, endW: 9000, origStartW: 500, origEndW: 9000 });
    expect(row.priority).toBe(5);
    expect(row.manualPriority).toBe(5);
    expect(row.slotModes).toEqual([{ slotIndex: 0, mode: 'REQUIRED' }]);

    // inline actuals
    expect(row.commitmentLevel).toBe('running');
    expect(row.wipstate).toBe(1);
    expect(row.dispatched).toBe(true);
    expect(row.dispatchedAt).toBe('2026-06-27T10:00:00Z');
    expect(row.percentComplete).toBe(40);
    expect(row.remainingDuration).toBe(2160);
    expect(row.actualStart).toBe('2026-06-27T10:05:00Z');
    expect(row.actualResources).toEqual(['R1']);

    // not a generated task
    expect(row.generated).toBeUndefined();
  });

  it('EXCLUDES base and derived fields from the overlay row', () => {
    const t = makeScheduledTask();
    const landscape = new SchedulingLandscape();
    landscape.tasks = new CTPTasks();
    landscape.tasks.addEntity(t);

    const row = serializeOverlay(landscape).rows[0];
    const keys = Object.keys(row);

    // base (definition) and derived must never appear in the overlay
    for (const forbidden of [
      'linkId', 'preds', 'succs', 'score', 'feasible', 'duration',
      'componentKey', 'sequence', 'name', 'type', 'inputMaterials',
      'capacityResources', 'errors', 'infeasibilityReport', 'dueDate',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('carries a solve-generated (CHANGEOVER) task as a fat row', () => {
    const parent = makeScheduledTask();

    // Mirror the engine: TaskFactory.createStateTask flags generated = true.
    const co = TaskFactory.createStateTask(parent, 'SETUP', 'Changeover', 900);
    expect(co.generated).toBe(true);
    co.state = 1;
    co.scheduled = new CTPInterval(100, 1000);
    const coSlots = new CTPTaskResourceList();
    coSlots.add(new CTPTaskResource('R1', true, 0, 'R1'));
    co.capacityResources = coSlots;

    const landscape = new SchedulingLandscape();
    landscape.tasks = new CTPTasks();
    landscape.tasks.addEntity(parent);
    landscape.tasks.addEntity(co);

    const doc = serializeOverlay(landscape);
    expect(doc.taskCount).toBe(2);

    const genRow = doc.rows.find(r => r.generated !== undefined);
    expect(genRow).toBeDefined();
    expect(genRow!.generated).toEqual({
      type: 'SETUP',
      subType: parent.subType ?? null,
      name: 'Changeover',
      process: parent.process,
      durationSeconds: 900,
    });
    // placement + assignment still captured so reconstruction can re-place it
    expect(genRow!.scheduled).toEqual({ startW: 100, endW: 1000 });
    expect(genRow!.assignments).toEqual([{ slotIndex: 0, resourceKey: 'R1' }]);
  });

  it('produces a JSON-safe document (no class instances, round-trips through JSON)', () => {
    const t = makeScheduledTask();
    const landscape = new SchedulingLandscape();
    landscape.tasks = new CTPTasks();
    landscape.tasks.addEntity(t);

    const doc = serializeOverlay(landscape);
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
