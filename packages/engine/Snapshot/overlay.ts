/**
 * Snapshot overlay — the thin, durable serialization of the scheduled-state of
 * the in-memory landscape (P1 of the Scheduling Snapshot sprint).
 *
 * The overlay is the OVERLAY bucket of the field classification
 * (docs/sprints/snapshot-p0-field-classification.md): per task, its placement +
 * planning overrides + inline actuals, plus the WHOLE definition of any
 * solve-generated (CHANGEOVER) task that has no base row to join to. BASE and
 * DERIVED fields are deliberately excluded — base is reloaded, derived is
 * re-derived on reconstruction (P2). The requirement this serves is EXACT
 * reconstruction: base ⋈ overlay → re-derive == the in-memory landscape, proven
 * by the P2 round-trip identity test.
 */
import { SchedulingLandscape } from '../Models/Entities/landscape';
import { CTPTask } from '../Models/Entities/task';
import { CTPAssignmentConstants } from '../Models/Core/constants';

/** Bump when the overlay shape changes; reconstruction reads it for migrations. */
export const OVERLAY_SCHEMA_VERSION = 1;

/** A resource scheduled to a task slot (capacityResources[i].scheduledResource). */
export interface OverlayAssignment {
  slotIndex: number;
  resourceKey: string;
}

/** A task slot's resource mode (capacityResources[i].mode) — override-capable. */
export interface OverlaySlotMode {
  slotIndex: number;
  mode: string;
}

/** Persisted window — overlay because the solve tightens it and setTaskWindow overrides it. */
export interface OverlayWindow {
  startW: number;
  endW: number;
  origStartW: number;
  origEndW: number;
}

/**
 * Fat definition of a solve-generated task (CHANGEOVER) — present only on rows
 * whose task is `generated`. There is no base row to join, so reconstruction
 * re-creates the task from this plus the row's placement (scheduled + assignments).
 */
export interface OverlayGeneratedDef {
  type: string;
  subType: string | null;
  name: string;
  process: string | undefined;
  durationSeconds: number;
}

/**
 * One overlay row per landscape task. Carries ONLY overlay-bucket fields.
 * (No linkId / preds / score / duration-definition / etc. — those are base or derived.)
 */
export interface OverlayRow {
  taskKey: string;

  // ── placement ──
  state: number;
  scheduled: { startW: number; endW: number } | null;
  assignments: OverlayAssignment[];

  // ── planning overrides ──
  pinned: boolean;
  includeInSolve: boolean;
  window: OverlayWindow | null;
  priority: number;
  manualPriority: number;
  slotModes: OverlaySlotMode[];

  // ── actuals (inline for v1; extracted to the actuals layer in v2) ──
  commitmentLevel: string;
  wipstate: number;
  dispatched: boolean;
  dispatchedAt: string | null;
  materialsPulled: boolean;
  percentComplete: number;
  remainingDuration: number | null;
  actualStart: string | null;
  actualEnd: string | null;
  actualResources: string[];
  holdReason: string | null;
  holdStart: string | null;
  estimatedResumeTime: string | null;

  // ── generated tasks only ──
  generated?: OverlayGeneratedDef;
}

/**
 * Resource-downtime (MAINTENANCE) interval — overlay sidecar. A durable, no-solve
 * resource override that reduces availability; not derived from task placements,
 * so it must be persisted and replayed on reconstruction.
 */
export interface OverlayResourceDowntime {
  resourceKey: string;
  startW: number;
  endW: number;
  reason: string | null;
}

/** The full overlay document written per snapshot. */
export interface OverlayDoc {
  version: number;
  taskCount: number;
  rows: OverlayRow[];
  resourceDowntime: OverlayResourceDowntime[];
}

function serializeTask(task: CTPTask): OverlayRow {
  const assignments: OverlayAssignment[] = [];
  const slotModes: OverlaySlotMode[] = [];
  const slots = task.capacityResources;
  if (slots) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots.at(i);
      if (!slot) continue;
      if (slot.scheduledResource) {
        assignments.push({ slotIndex: i, resourceKey: slot.scheduledResource });
      }
      if (slot.mode) {
        slotModes.push({ slotIndex: i, mode: slot.mode });
      }
    }
  }

  const row: OverlayRow = {
    taskKey: task.key,

    state: task.state,
    scheduled: task.scheduled
      ? { startW: task.scheduled.startW, endW: task.scheduled.endW }
      : null,
    assignments,

    pinned: task.pinned,
    includeInSolve: task.includeInSolve,
    window: task.window
      ? {
          startW: task.window.startW,
          endW: task.window.endW,
          origStartW: task.window.origStartW,
          origEndW: task.window.origEndW,
        }
      : null,
    priority: task.priority,
    manualPriority: task.manualPriority,
    slotModes,

    commitmentLevel: task.commitmentLevel,
    wipstate: task.wipstate,
    dispatched: task.dispatched,
    dispatchedAt: task.dispatchedAt,
    materialsPulled: task.materialsPulled,
    percentComplete: task.percentComplete,
    remainingDuration: task.remainingDuration,
    actualStart: task.actualStart,
    actualEnd: task.actualEnd,
    actualResources: [...task.actualResources],
    holdReason: task.holdReason,
    holdStart: task.holdStart,
    estimatedResumeTime: task.estimatedResumeTime,
  };

  if (task.generated) {
    row.generated = {
      type: task.type,
      subType: task.subType ?? null,
      name: task.name,
      process: task.process,
      durationSeconds: task.duration ? task.duration.duration() : 0,
    };
  }

  return row;
}

/**
 * Serialize the scheduled-state overlay of a landscape. Pure: reads the
 * landscape, returns a plain JSON-safe document; mutates nothing.
 */
export function serializeOverlay(landscape: SchedulingLandscape): OverlayDoc {
  const rows: OverlayRow[] = [];
  if (landscape.tasks) {
    landscape.tasks.forEach((task: CTPTask) => {
      rows.push(serializeTask(task));
    });
  }

  // Resource-downtime sidecar — extract MAINTENANCE intervals from each resource's
  // assignment list (task bookings are derived/replayed separately, not here).
  const resourceDowntime: OverlayResourceDowntime[] = [];
  if (landscape.resources) {
    landscape.resources.forEach((res) => {
      let node = res.assignments?.head ?? null;
      while (node) {
        if (node.data.type === CTPAssignmentConstants.MAINTENANCE) {
          resourceDowntime.push({
            resourceKey: res.key,
            startW: node.data.startW,
            endW: node.data.endW,
            reason: node.data.name ?? null,
          });
        }
        node = node.next;
      }
    });
  }

  return {
    version: OVERLAY_SCHEMA_VERSION,
    taskCount: rows.length,
    rows,
    resourceDowntime,
  };
}
