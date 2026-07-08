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
import { InfeasibilityReport } from '../Models/Entities/infeasibilityreport';
import { CTPAssignmentConstants, CTPTaskStateConstants } from '../Models/Core/constants';

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
 *
 * Every field except the placement core is **omitted when at its CTPTask default**
 * (see DEFAULTS below) and restored on reconstruct — a task's whole actuals/hold/
 * dispatch envelope and unset overrides drop out, so a plain planned task is a
 * handful of bytes instead of 23 keys. The round-trip identity holds because
 * serialize and reconstruct agree on the same defaults.
 */
export interface OverlayRow {
  taskKey: string;

  // ── placement core (always present) ──
  state: number;
  scheduled: { startW: number; endW: number } | null;
  assignments: OverlayAssignment[];
  slotModes: OverlaySlotMode[];
  window: OverlayWindow | null;

  // ── planning overrides (omitted at default) ──
  pinned?: boolean;             // default false
  includeInSolve?: boolean;     // default true
  priority?: number;            // default 100
  manualPriority?: number;      // default 0

  // ── actuals (omitted at default; inline for v1, extracted to the actuals layer in v2) ──
  commitmentLevel?: string;     // default 'unscheduled'
  wipstate?: number;            // default 0
  dispatched?: boolean;         // default false
  dispatchedAt?: string | null; // default null
  materialsPulled?: boolean;    // default false
  percentComplete?: number;     // default 0
  remainingDuration?: number | null;   // default null
  actualStart?: string | null;  // default null
  actualEnd?: string | null;    // default null
  actualResources?: string[];   // default []
  holdReason?: string | null;   // default null
  holdStart?: string | null;    // default null
  estimatedResumeTime?: string | null; // default null

  // ── generated tasks only ──
  generated?: OverlayGeneratedDef;

  // ── infeasibility (solve output; present only on unschedulable tasks) ──
  // The report is the solver's placement-attempt result — it CANNOT be re-derived
  // without re-solving, so it is an overlay field, not a derived one. Absent on
  // scheduled/feasible tasks, so the vast majority of rows are unaffected.
  infeasibilityReport?: InfeasibilityReport;
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

  // Placement core — always present.
  const row: OverlayRow = {
    taskKey: task.key,
    state: task.state,
    scheduled: task.scheduled
      ? { startW: task.scheduled.startW, endW: task.scheduled.endW }
      : null,
    assignments,
    slotModes,
    window: task.window
      ? {
          startW: task.window.startW,
          endW: task.window.endW,
          origStartW: task.window.origStartW,
          origEndW: task.window.origEndW,
        }
      : null,
  };

  // Everything else — write only when it differs from the CTPTask default, so a
  // plain planned task doesn't carry 15 default-valued keys. reconstruct() applies
  // the same defaults on absence, keeping the round-trip identity exact.
  if (task.pinned) row.pinned = true;                             // default false
  if (!task.includeInSolve) row.includeInSolve = false;           // default true
  if (task.priority !== 100) row.priority = task.priority;        // default 100
  if (task.manualPriority !== 0) row.manualPriority = task.manualPriority; // default 0

  if (task.commitmentLevel !== 'unscheduled') row.commitmentLevel = task.commitmentLevel;
  if (task.wipstate !== 0) row.wipstate = task.wipstate;
  if (task.dispatched) row.dispatched = true;
  if (task.dispatchedAt !== null) row.dispatchedAt = task.dispatchedAt;
  if (task.materialsPulled) row.materialsPulled = true;
  if (task.percentComplete !== 0) row.percentComplete = task.percentComplete;
  if (task.remainingDuration !== null) row.remainingDuration = task.remainingDuration;
  if (task.actualStart !== null) row.actualStart = task.actualStart;
  if (task.actualEnd !== null) row.actualEnd = task.actualEnd;
  if (task.actualResources.length > 0) row.actualResources = [...task.actualResources];
  if (task.holdReason !== null) row.holdReason = task.holdReason;
  if (task.holdStart !== null) row.holdStart = task.holdStart;
  if (task.estimatedResumeTime !== null) row.estimatedResumeTime = task.estimatedResumeTime;

  if (task.generated) {
    row.generated = {
      type: task.type,
      subType: task.subType ?? null,
      name: task.name,
      process: task.process,
      durationSeconds: task.duration ? task.duration.duration() : 0,
    };
  }

  // Solve output for UNSCHEDULED tasks only — the placement-attempt result that
  // can't be re-derived without re-solving. A scheduled task's report is stale
  // bump-and-retry residue, not durable state, so it is not persisted.
  //
  // We persist the *classification* (conflictType, reason, bottleneckSlot, …) but
  // DROP the fat `slots` array (per-resource availability breakdown — ~97% of the
  // report's bytes). The classification is what the summary + Conflicts tab group
  // and label by; the slot breakdown only powers a card's expandable detail, which
  // a fresh solve always repopulates. This keeps the overlay lean on conflict-heavy
  // tenants. Deep-cloned so the overlay is a pure value snapshot, not a live ref.
  if (task.infeasibilityReport && task.state !== CTPTaskStateConstants.SCHEDULED) {
    const { slots, ...classification } = task.infeasibilityReport;
    row.infeasibilityReport = { ...JSON.parse(JSON.stringify(classification)), slots: [] };
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
