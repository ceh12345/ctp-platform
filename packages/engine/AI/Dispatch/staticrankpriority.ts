import { CTPTask } from "../../Models/Entities/task";
import { BaseDispatchPriority, legacyCompare } from "./dispatchpriority";
import { DispatchState } from "./dispatchstate";

/**
 * The default selection rule and the **byte-for-byte parity anchor**. Governs on
 * `null` for every task, so under the two-class partition **every** comparison
 * lands in the both-backfill branch → `legacyCompare` → `(rank ASC, window.startW
 * ASC)`, exactly reproducing `ChainNeighborhood`'s chain-head ordering. Reads none
 * of `DispatchState` — "static vs dynamic" is just how much state a rule reads.
 *
 * `DynamicNeighborhood(StaticRankPriority)` is validated identical to
 * `ChainNeighborhood` by `schedule-parity.spec.ts`.
 */
export class StaticRankPriority extends BaseDispatchPriority {
  // Presents as "Chain" — the legacy strategy label this default plug reproduces,
  // so `DynamicNeighborhood(StaticRankPriority).name === "Chain"` and consumers
  // that key on the strategy name are unaffected. (ATC/DBR/Slack name themselves.)
  public readonly name = "Chain";

  // Governs on nothing → all tasks are backfill for this plug → the partition
  // always routes to legacyCompare. The default sort is literally the both-null branch.
  public governingDate(_state: DispatchState, _task: CTPTask): number | null {
    return null;
  }

  // Unreachable (governingDate is always null), but kept coherent: the same order.
  protected compareDated(a: CTPTask, b: CTPTask, _state: DispatchState): number {
    return legacyCompare(a, b);
  }
}
