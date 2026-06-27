/**
 * Snapshot reconstruct — apply the thin overlay onto a base landscape to rebuild
 * the in-memory scheduled state WITHOUT solving (P2 of the Scheduling Snapshot
 * sprint). This is the primary purpose of the snapshot: the requirement is EXACT
 * reconstruction, proven by the round-trip identity
 *   serialize(reconstruct(base, serialize(L))) === serialize(L).
 *
 * Scope (P2): apply every OVERLAY-bucket field onto base tasks, create
 * solve-generated tasks that have no base row, and re-derive adjacency
 * (preds/succs) from the base precedence. The remaining DERIVED re-derivation
 * that lives at the API hydrator — cross-WO components, resource-consumption
 * replay, WO-group rollups — is orchestrated by the load path (P5) which reuses
 * those existing helpers; none of it affects the overlay round-trip identity
 * (they are derived/base, not overlay).
 */
import { SchedulingLandscape } from '../Models/Entities/landscape';
import {
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
} from '../Models/Entities/task';
import { CTPInterval, CTPDuration } from '../Models/Core/window';
import { CTPDurationConstants } from '../Models/Core/constants';
import { buildAdjacency } from '../Models/Entities/adjacency';
import { OverlayDoc, OverlayRow } from './overlay';

/** Create a solve-generated task (no base row) from its fat overlay definition. */
function createGeneratedTask(row: OverlayRow): CTPTask {
  const def = row.generated!;
  const task = new CTPTask(def.type, def.name, row.taskKey);
  task.generated = true;
  task.process = def.process;
  task.subType = def.subType;
  task.duration = new CTPDuration(def.durationSeconds, 1, CTPDurationConstants.FIXED_DURATION);

  // Generated tasks carry their own resource slots (none in base to join).
  task.capacityResources = new CTPTaskResourceList();
  for (const a of row.assignments) {
    task.capacityResources.add(
      new CTPTaskResource(a.resourceKey, true, a.slotIndex, a.resourceKey),
    );
  }
  return task;
}

/** Apply one overlay row's fields onto a task (overwrites the OVERLAY bucket). */
function applyRow(task: CTPTask, row: OverlayRow): void {
  // ── placement ──
  task.state = row.state;
  task.scheduled = row.scheduled
    ? new CTPInterval(row.scheduled.startW, row.scheduled.endW)
    : null;

  // assignments → scheduledResource on the slot at slotIndex (slots exist in
  // base; generated tasks created them above)
  for (const a of row.assignments) {
    const slot = task.capacityResources?.at(a.slotIndex);
    if (slot) slot.scheduledResource = a.resourceKey;
  }
  for (const m of row.slotModes) {
    const slot = task.capacityResources?.at(m.slotIndex);
    if (slot) slot.mode = m.mode;
  }

  // ── planning overrides ──
  task.pinned = row.pinned;
  task.includeInSolve = row.includeInSolve;
  if (row.window) {
    const w = new CTPInterval(row.window.origStartW, row.window.origEndW);
    w.startW = row.window.startW;
    w.endW = row.window.endW;
    task.window = w;
  } else {
    task.window = null;
  }
  task.priority = row.priority;
  task.manualPriority = row.manualPriority;

  // ── actuals (inline) ──
  task.commitmentLevel = row.commitmentLevel as CTPTask['commitmentLevel'];
  task.wipstate = row.wipstate;
  task.dispatched = row.dispatched;
  task.dispatchedAt = row.dispatchedAt;
  task.materialsPulled = row.materialsPulled;
  task.percentComplete = row.percentComplete;
  task.remainingDuration = row.remainingDuration;
  task.actualStart = row.actualStart;
  task.actualEnd = row.actualEnd;
  task.actualResources = [...row.actualResources];
  task.holdReason = row.holdReason;
  task.holdStart = row.holdStart;
  task.estimatedResumeTime = row.estimatedResumeTime;
}

/**
 * Apply the overlay onto `base` in place and return it. Base carries the static
 * task/resource/order definitions (the result of hydrating config); this overlays
 * the scheduled state. Mutates and returns `base`.
 */
export function reconstructOverlay(
  base: SchedulingLandscape,
  overlay: OverlayDoc,
): SchedulingLandscape {
  if (!base.tasks) base.tasks = new CTPTasks();

  for (const row of overlay.rows) {
    let task = base.tasks.getEntity(row.taskKey);
    if (!task) {
      // No base row → a solve-generated task; create it whole.
      task = createGeneratedTask(row);
      base.tasks.addEntity(task);
    }
    applyRow(task, row);
  }

  // Re-derive adjacency from base precedence (no solve). The remaining derived
  // re-derivation (components / consumption / rollups) is orchestrated at load (P5).
  buildAdjacency(base.tasks);

  return base;
}
