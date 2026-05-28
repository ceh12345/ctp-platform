import { CTPOrders } from "../Models/Entities/order";
import { CTPTasks } from "../Models/Entities/task";
import {
  CTPWorkOrderGroup,
  CTPWorkOrderGroups,
  WorkOrderGroupStatus,
} from "../Models/Entities/workordergroup";

const SECONDS_PER_DAY = 86400;

export class RollupEngine {
  // Rebuilds group membership from order.groupKey + order.parentOrderKey.
  // Groups must already exist in `groups` (populated by the mapping layer);
  // this method resets membership and re-attaches every order with a
  // non-null groupKey to its matching group.
  //
  // Head WO rule (per sprint OI-2): a group's headWorkOrderKey is set to
  // the single order whose parentOrderKey is null. If 0 or 2+ candidates
  // exist, headWorkOrderKey stays null (group is "flat").
  public rebuildGroups(orders: CTPOrders, groups: CTPWorkOrderGroups): void {
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
      if (order.parentOrderKey === null) {
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
  }

  // Recomputes per-group rollup values after a solve. Membership unchanged.
  //
  // bufferDays is tenant-configurable (Decision 1, still open with Stafford);
  // default 3 days. Time unit on group dates / task.scheduled is epoch seconds
  // (matches CTPLinkId.maxGap and CTPOrder.dueDate).
  public refreshRollups(
    groups: CTPWorkOrderGroups,
    orders: CTPOrders,
    tasks: CTPTasks,
    now: number,
    bufferDays: number = 3,
  ): void {
    const tasksByOrder = new Map<string, ReturnType<typeof tasks.getEntity>[]>();
    tasks.forEach((task) => {
      const orderKey = task.linkId?.name;
      if (!orderKey) return;
      const arr = tasksByOrder.get(orderKey) ?? [];
      arr.push(task);
      tasksByOrder.set(orderKey, arr);
    });

    const bufferSeconds = bufferDays * SECONDS_PER_DAY;

    groups.forEach((group) => {
      let computedStart: number | null = null;
      let computedEnd: number | null = null;
      let totalDemand = 0;
      let totalScheduled = 0;
      let hasInfeasible = false;

      for (const orderKey of group.workOrderKeys) {
        const order = orders.getEntity(orderKey);
        if (!order) continue;

        totalDemand += order.demandQty;
        totalScheduled += order.scheduledQty;

        const orderTasks = tasksByOrder.get(orderKey) ?? [];
        for (const task of orderTasks) {
          if (!task) continue;
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

      // Status-count fields (completedWorkOrders / inProcessWorkOrders /
      // notStartedWorkOrders / cancelledWorkOrders) and totalProducedQty
      // depend on source-status fields not yet exposed on CTPOrder. These
      // populate in step 6 once the mapping layer surfaces Wostatus +
      // QuantityProduced (pending Decision 5 with Stafford).

      group.status = this.deriveStatus(group, now, bufferSeconds, hasInfeasible);
    });
  }

  private deriveStatus(
    group: CTPWorkOrderGroup,
    _now: number,
    bufferSeconds: number,
    hasInfeasible: boolean,
  ): WorkOrderGroupStatus {
    if (hasInfeasible) return WorkOrderGroupStatus.BLOCKED;

    // COMPLETED / CANCELLED detection requires source-status fields on
    // CTPOrder (Decision 5 + step 6 mapping). For now, falls through to
    // ON_TRACK / AT_RISK / LATE which depend only on computed timing.

    if (group.sourceEnd !== null && group.computedEnd !== null) {
      if (group.computedEnd > group.sourceEnd) return WorkOrderGroupStatus.LATE;
      if (group.computedEnd > group.sourceEnd - bufferSeconds) {
        return WorkOrderGroupStatus.AT_RISK;
      }
    }

    return WorkOrderGroupStatus.ON_TRACK;
  }
}
