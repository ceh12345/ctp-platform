import { CTPOrder, CTPOrders } from "../Models/Entities/order";
import { CTPTask, CTPTasks } from "../Models/Entities/task";
import {
  CTPWorkOrderGroup,
  CTPWorkOrderGroups,
  WorkOrderGroupStatus,
} from "../Models/Entities/workordergroup";
import { NameValue } from "../Models/Core/namevalue";

const SECONDS_PER_DAY = 86400;

/**
 * Behaviour config for the rollup engine. Injected at construction time —
 * the engine never reads tenant config itself. API layer wraps tenant
 * config in this shape.
 */
export interface IRollupEngineConfig {
  /** Slack window (days) before sourceEnd that triggers AT_RISK status. */
  bufferDays: number;

  /**
   * Predicate matched against each order's rawFields to count cancellations.
   * `field` is the (mapped, lower-cased) key on CTPOrder.rawFields; `values`
   * lists exact-match strings that indicate cancellation. Empty `values`
   * means the predicate matches nothing — no orders are counted as
   * cancelled. Always present per design — empty array is the right
   * "Stafford until Decision 5" shape.
   */
  cancellationPredicate: {
    field: string;
    values: string[];
  };
}

export class RollupEngine {
  constructor(private readonly config: IRollupEngineConfig) {}

  /**
   * Rebuild group membership from order.groupKey + order.parentOrderKey
   * AND denormalise the group's hierarchy / attributes down to its member
   * orders and tasks.
   *
   * Head WO rule (per sprint OI-2): an order is a head candidate when
   * either its parentOrderKey is null OR it equals its own key (Stafford's
   * self-reference convention). A group's headWorkOrderKey is set when
   * exactly one candidate exists; if 0 or 2+, the head stays null and the
   * group is "flat".
   *
   * Denormalisation is by reference-share. group.hierarchy and
   * group.attributes are the single source of truth; orders and tasks
   * point at the group's instances so downstream readers (API payload,
   * KPI rollups) see one consistent picture without copies drifting.
   */
  public rebuildGroups(
    orders: CTPOrders,
    tasks: CTPTasks,
    groups: CTPWorkOrderGroups,
  ): void {
    groups.forEach((g) => {
      g.workOrderKeys = [];
      g.headWorkOrderKey = null;
    });

    const headCandidates = new Map<string, string[]>();

    orders.forEach((order) => {
      if (!order.groupKey) return;
      const group = groups.getEntity(order.groupKey);
      if (!group) return;
      group.workOrderKeys.push(order.key);
      const isHeadCandidate =
        order.parentOrderKey === null || order.parentOrderKey === order.key;
      if (isHeadCandidate) {
        const arr = headCandidates.get(order.groupKey) ?? [];
        arr.push(order.key);
        headCandidates.set(order.groupKey, arr);
      }
    });

    for (const [groupKey, candidates] of headCandidates) {
      if (candidates.length === 1) {
        const group = groups.getEntity(groupKey);
        if (group) group.headWorkOrderKey = candidates[0];
      }
    }

    // Mirror hierarchy values into each group's attributes. Written once
    // per group on the SHARED attributes list — orders + tasks pick it up
    // via reference share below. Regenerated each pass (strip-by-slot-name
    // then re-append) so config edits propagate without duplicates.
    groups.forEach((group) => this.writeHierarchyMirror(group));

    // Denormalise: group → member orders (reference share — single source
    // of truth for hierarchy + attributes including the mirror).
    orders.forEach((order) => {
      if (!order.groupKey) return;
      const group = groups.getEntity(order.groupKey);
      if (!group) return;
      order.hierarchy = group.hierarchy;
      order.attributes = group.attributes;
    });

    // Denormalise: order → its tasks (also sets task.groupKey).
    tasks.forEach((task) => {
      const orderKey = task.linkId?.name;
      if (!orderKey) return;
      const order = orders.getEntity(orderKey);
      if (!order || !order.groupKey) return;
      task.groupKey = order.groupKey;
      task.hierarchy = order.hierarchy;
      task.attributes = order.attributes;
    });
  }

  /**
   * Mirror populated hierarchy slots into the group's attributes list.
   * Strips any prior mirror entries (by name match against current slot
   * names) before re-writing, so repeated calls don't duplicate.
   *
   * Mirror entries are indistinguishable from authored attributes at the
   * read path — uniformity is the whole point. The MappingEngine config
   * validator blocks any AttributeMapping whose name collides with a
   * HierarchySlotMapping name on the same entity, so authored attributes
   * never share names with slots.
   *
   * Mutates `group.attributes` in place — orders + tasks reference-share
   * the same list, so they see the mirror without further work.
   */
  private writeHierarchyMirror(group: CTPWorkOrderGroup): void {
    const entries = group.hierarchy.populatedEntries();
    const slotNames = new Set(entries.map((e) => e.name));

    // Snapshot the authored (non-slot-name) entries before we clear.
    const authored: NameValue[] = [];
    group.attributes.forEach((nv) => {
      if (!slotNames.has(nv.name)) authored.push(nv);
    });

    // In-place rewrite — preserves the reference identity that
    // orders/tasks share.
    group.attributes.clear();
    for (const a of authored) group.attributes.add(a);
    for (const e of entries) group.attributes.add(new NameValue(e.name, e.value));
  }

  /**
   * Recompute per-group rollup values after a solve. Membership unchanged.
   * Reads bufferDays + cancellationPredicate from the injected config.
   */
  public refreshRollups(
    groups: CTPWorkOrderGroups,
    orders: CTPOrders,
    tasks: CTPTasks,
    now: number,
  ): void {
    const tasksByOrder = new Map<string, CTPTask[]>();
    tasks.forEach((task) => {
      const orderKey = task.linkId?.name;
      if (!orderKey) return;
      const arr = tasksByOrder.get(orderKey) ?? [];
      arr.push(task);
      tasksByOrder.set(orderKey, arr);
    });

    const predicate = this.config.cancellationPredicate;
    const cancellationSet = new Set(predicate.values);

    groups.forEach((group) => {
      let computedStart: number | null = null;
      let computedEnd: number | null = null;
      let totalDemand = 0;
      let totalScheduled = 0;
      let cancelled = 0;
      let hasInfeasible = false;

      for (const orderKey of group.workOrderKeys) {
        const order = orders.getEntity(orderKey);
        if (!order) continue;

        totalDemand += order.demandQty;
        totalScheduled += order.scheduledQty;

        // Cancellation check — always runs (cancellationSet may be empty,
        // in which case nothing matches and cancelled stays at 0).
        const fieldValue = order.rawFields[predicate.field];
        if (typeof fieldValue === 'string' && cancellationSet.has(fieldValue)) {
          cancelled++;
        }

        const orderTasks = tasksByOrder.get(orderKey) ?? [];
        for (const task of orderTasks) {
          if (task.infeasibilityReport !== null) hasInfeasible = true;
          if (task.scheduled) {
            const s = task.scheduled.startW;
            const e = task.scheduled.endW;
            if (computedStart === null || s < computedStart) computedStart = s;
            if (computedEnd === null || e > computedEnd) computedEnd = e;
          }
        }
      }

      group.computedStart = computedStart;
      group.computedEnd = computedEnd;
      group.totalWorkOrders = group.workOrderKeys.length;
      group.totalDemandQty = totalDemand;
      group.totalScheduledQty = totalScheduled;
      group.cancelledWorkOrders = cancelled;

      // completed / inProcess / notStarted counts still pending Decision 5
      // (no per-state predicates exposed yet — would mirror cancellation).
      // totalProducedQty pending source-field exposure on CTPOrder.

      group.status = this.deriveStatus(group, now, hasInfeasible);
    });
  }

  private deriveStatus(
    group: CTPWorkOrderGroup,
    _now: number,
    hasInfeasible: boolean,
  ): WorkOrderGroupStatus {
    if (hasInfeasible) return WorkOrderGroupStatus.BLOCKED;

    // CANCELLED when every member is cancelled. Today (empty predicate
    // values) this branch never triggers — falls through to timing-based
    // status. Once Decision 5 lands the same code path activates.
    if (group.totalWorkOrders > 0 && group.cancelledWorkOrders === group.totalWorkOrders) {
      return WorkOrderGroupStatus.CANCELLED;
    }

    // COMPLETED detection still pending — needs a "completed" predicate
    // or per-order wipState aggregation. Not in step 7 scope.

    const bufferSeconds = this.config.bufferDays * SECONDS_PER_DAY;
    if (group.sourceEnd !== null && group.computedEnd !== null) {
      if (group.computedEnd > group.sourceEnd) return WorkOrderGroupStatus.LATE;
      if (group.computedEnd > group.sourceEnd - bufferSeconds) {
        return WorkOrderGroupStatus.AT_RISK;
      }
    }

    return WorkOrderGroupStatus.ON_TRACK;
  }
}
