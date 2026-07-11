import { CTPTask } from "../../Models/Entities/task";
import { IDispatchPriority } from "./dispatchpriority";
import { DispatchState } from "./dispatchstate";

/**
 * Slack / Critical-Ratio dispatch priority — Stafford's own rule, and the first
 * real consumer of the seam.
 *
 * Priority = **least slack first**, where
 *   `slack = deliveryDate − asOf − remainingWork`
 * with `asOf` = the ready-set frontier (`state.now()`, shared with ATC) and
 * `remainingWork` = the task's own processing time (v1 coarsening, same as ATC).
 * Because `asOf` is constant across a round, this ranks by `deliveryDate −
 * remainingWork`: at equal delivery dates the heavier job (more remaining work)
 * has less slack and outranks the lighter one — the intended behaviour.
 *
 * **Date source (Phase 0.5).** `deliveryDate` is the customer promise
 * (`customerDeliveryDate`, inherited-not-authored from the WO). When absent we
 * fall back to the internal target `dueDate`; a task with neither date has no
 * scheduling pressure and sorts last (max slack) — it still schedules. Slack is
 * an absolute time quantity, so the ranking is globally comparable; Stafford's
 * "priority within the same operation code" is an output/placement convention,
 * not a ranking-scope constraint.
 *
 * Within equal slack the tie-break is the byte-for-byte static order (rank, then
 * window), keeping Slack a deterministic reordering of the default. Adds **no
 * new DispatchState accessor** — default / ATC / DBR are untouched.
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export class SlackDispatchPriority implements IDispatchPriority {
  public readonly name = "Slack";

  public compare(a: CTPTask, b: CTPTask, state: DispatchState): number {
    const sa = this.slack(a, state);
    const sb = this.slack(b, state);
    if (sa !== sb) return sa - sb; // least slack first

    if (a.rank !== b.rank) return a.rank - b.rank;
    const aStart = a.window ? a.window.startW : Number.MAX_VALUE;
    const bStart = b.window ? b.window.startW : Number.MAX_VALUE;
    return aStart - bStart;
  }

  private slack(task: CTPTask, state: DispatchState): number {
    const remaining = task.duration ? task.duration.duration() : 0;
    const asOf = state.now();

    let deliver: number | null = null;
    if (task.customerDeliveryDate != null && task.customerDeliveryDate > 0) {
      deliver = task.customerDeliveryDate; // customer promise (preferred)
    } else if (task.dueDate > 0) {
      deliver = task.dueDate; // internal target fallback
    }
    if (deliver === null) return Number.MAX_SAFE_INTEGER; // no date → no pressure → last

    return deliver - asOf - remaining;
  }
}
