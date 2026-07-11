import { CTPTask } from "../../Models/Entities/task";
import { IDispatchPriority } from "./dispatchpriority";
import { DispatchState } from "./dispatchstate";

/**
 * The default selection rule and the **byte-for-byte parity anchor**. Reproduces
 * `ChainNeighborhood`'s chain-head ordering exactly: `(rank ASC, window.startW ASC)`,
 * with `null` window sorting last. Reads NONE of `DispatchState` — "static vs
 * dynamic" is just how much of the state a rule reads, and this reads nothing.
 *
 * `DynamicNeighborhood(StaticRankPriority)` is validated identical to
 * `ChainNeighborhood` by `schedule-parity.spec.ts`.
 */
export class StaticRankPriority implements IDispatchPriority {
  // Presents as "Chain" — the legacy strategy label this default plug reproduces,
  // so `DynamicNeighborhood(StaticRankPriority).name === "Chain"` and consumers
  // that key on the strategy name are unaffected. (ATC/DBR plugs name themselves.)
  public readonly name = "Chain";

  public compare(a: CTPTask, b: CTPTask, _state: DispatchState): number {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aStart = a.window ? a.window.startW : Number.MAX_VALUE;
    const bStart = b.window ? b.window.startW : Number.MAX_VALUE;
    return aStart - bStart;
  }
}
