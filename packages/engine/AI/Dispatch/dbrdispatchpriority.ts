import { CTPTask } from "../../Models/Entities/task";
import { BaseDispatchPriority, legacyCompare } from "./dispatchpriority";
import { DispatchState, primaryResourceKey } from "./dispatchstate";

/**
 * Drum-Buffer-Rope dispatch priority.
 *
 * v1 semantics: **down-ranking, not gating.** We identify the constraint (the
 * "drum" — the highest-loaded resource across the schedulable set) once per solve,
 * then sink bottleneck-bound work behind non-bottleneck work in the pick order so
 * the non-constraint flow drains first (the "rope" pulling only what the drum can
 * consume). We never block: if every ready head is bottleneck-bound, they still
 * sort among themselves (rank, then window) and one is released — progress is
 * guaranteed by construction, no stall.
 *
 * **Orthogonal to the date axis:** DBR `governingDate` is non-null for every task,
 * so it never enters the dated/backfill partition — its priority is purely the
 * resource topology (a null-date stock task competes on bottleneck-boundness like
 * any other). Within each class (bottleneck-bound vs not) the tie-break is the
 * `legacyCompare` static order, so DBR is a pure reordering of the default.
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export class DBRDispatchPriority extends BaseDispatchPriority {
  public readonly name = "DBR";

  /** undefined = not yet computed; null = computed, no constraint found. */
  private bottleneckKey: string | null | undefined = undefined;

  /** Identify the drum once per solve (first round, when the load picture is whole). */
  public prepare(state: DispatchState): void {
    if (this.bottleneckKey !== undefined) return;
    const load = state.resourceLoad();
    let maxKey: string | null = null;
    let maxLoad = 0;
    // Sort keys for a deterministic argmax: the lowest key wins a load tie.
    for (const key of Array.from(load.keys()).sort()) {
      const v = load.get(key) ?? 0;
      if (v > maxLoad) {
        maxLoad = v;
        maxKey = key;
      }
    }
    this.bottleneckKey = maxKey;
  }

  // Resource-governed, never off-axis → never backfill. The constant value is
  // arbitrary (only its non-null-ness matters to the partition).
  public governingDate(_state: DispatchState, _task: CTPTask): number | null {
    return 1;
  }

  protected compareDated(a: CTPTask, b: CTPTask, _state: DispatchState): number {
    const aBound = this.isBottleneckBound(a);
    const bBound = this.isBottleneckBound(b);
    if (aBound !== bBound) return aBound ? 1 : -1; // non-bottleneck first
    return legacyCompare(a, b); // same class → default static order (a reordering)
  }

  private isBottleneckBound(task: CTPTask): boolean {
    if (!this.bottleneckKey) return false;
    return primaryResourceKey(task) === this.bottleneckKey;
  }
}
