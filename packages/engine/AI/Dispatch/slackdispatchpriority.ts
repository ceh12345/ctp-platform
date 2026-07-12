import { CTPTask } from "../../Models/Entities/task";
import { BaseDispatchPriority, legacyCompare } from "./dispatchpriority";
import { DispatchState } from "./dispatchstate";

/**
 * Slack / Critical-Ratio dispatch priority — Stafford's own rule, and the first
 * real consumer of the seam.
 *
 * Priority = **least slack first**, where
 *   `slack = customerDeliveryDate − asOf − remainingWork`
 * with `asOf` = the fixed snapshot clock (`state.asOf()`, shared with ATC) and
 * `remainingWork` = the task's processing time (v1 coarsening). Because `asOf` is
 * constant across the ready set, this ranks by `customerDeliveryDate −
 * remainingWork`: at equal delivery dates the heavier job (more remaining work) has
 * less slack and outranks the lighter one — the intended behaviour.
 *
 * **Axis:** the *customer* delivery date only (`customerDeliveryDate`, resolved off
 * the order). There is **no `dueDate` fallback** — a stock/internal order with an
 * internal `JobEndDate` but no customer promise is **backfill** under Slack (off the
 * customer axis, filling white space), handled by the base partition. Null customer
 * date is modeled as a *class*, never a sentinel date.
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export class SlackDispatchPriority extends BaseDispatchPriority {
  public readonly name = "Slack";

  public governingDate(state: DispatchState, task: CTPTask): number | null {
    const cdd = state.deliveryDateOf(task);
    return cdd != null && cdd > 0 ? cdd : null; // no customer date → backfill (no dueDate fallback)
  }

  protected compareDated(a: CTPTask, b: CTPTask, state: DispatchState): number {
    const sa = this.slack(a, state);
    const sb = this.slack(b, state);
    if (sa !== sb) return sa - sb; // least slack first
    return legacyCompare(a, b); // deterministic tie — the extracted legacy order
  }

  private slack(task: CTPTask, state: DispatchState): number {
    const remaining = task.duration ? task.duration.duration() : 0;
    const deliver = state.deliveryDateOf(task)!; // non-null by construction (dated)
    return deliver - state.asOf() - remaining;
  }
}
