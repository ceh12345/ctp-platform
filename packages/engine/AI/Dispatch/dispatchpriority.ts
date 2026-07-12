import { CTPTask } from "../../Models/Entities/task";
import { DispatchState } from "./dispatchstate";

/**
 * A dispatch (selection) rule — "what to make next". Given the ready set and the
 * live `DispatchState`, it orders candidate chain-head tasks.
 *
 * Expressed as a COMPARATOR rather than a scalar so the default rule can reproduce
 * the existing multi-key tie-break byte-for-byte (Phase 0e). Scalar rules
 * (ATC/DBR/Slack) implement priority via `compareDated` on top of the shared
 * two-class partition (see `BaseDispatchPriority`).
 *
 * Convention: `compare(a, b) < 0` ⇒ a is picked before b (a is more urgent).
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export interface IDispatchPriority {
  readonly name: string;
  /** Optional per-round precompute (e.g. DBR bottleneck index built once per round). */
  prepare?(state: DispatchState): void;
  /**
   * The date governing this plug for `task`, or **null** ⇒ the task is *backfill*
   * under this plug (off this plug's date axis — no demand deadline). Datedness is
   * **per-plug**: Slack→customer date, ATC→internal due date, DBR→non-null always
   * (resource-governed, never backfill), Static→null always (all-backfill → legacy).
   */
  governingDate(state: DispatchState, task: CTPTask): number | null;
  compare(a: CTPTask, b: CTPTask, state: DispatchState): number;
}

/**
 * The extracted Phase 0(e) legacy **chain-head** comparator — `(rank ASC,
 * window.startW ASC)`, null window last. This is the byte-for-byte parity anchor:
 * `StaticRankPriority` governs on `null`, so its every comparison lands in the
 * both-backfill branch, making this function the default plug's entire ordering.
 * (The 5-key standalone `greedySortFn` lives in `DynamicNeighborhood` and is a
 * separate, dead path — not this.)
 */
export function legacyCompare(a: CTPTask, b: CTPTask): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const aStart = a.window ? a.window.startW : Number.MAX_VALUE;
  const bStart = b.window ? b.window.startW : Number.MAX_VALUE;
  return aStart - bStart;
}

/**
 * Base for every dispatch plug. Provides the **two-class partition** so all plugs
 * partition identically and no plug hand-rolls it:
 *
 *   dated ≠ dated  → dated ranks first (backfill sinks below ALL dated work)
 *   both backfill  → `legacyCompare` (the parity anchor)
 *   both dated     → the plug's `compareDated`
 *
 * Backfill is a **class**, not a sentinel date — the priority arithmetic in
 * `compareDated` is unreachable for null-governed work by construction, so no
 * `MAX_SAFE_INTEGER`/end-of-horizon value ever leaks into slack math or KPIs.
 */
export abstract class BaseDispatchPriority implements IDispatchPriority {
  public abstract readonly name: string;
  public prepare?(state: DispatchState): void;

  public abstract governingDate(state: DispatchState, task: CTPTask): number | null;

  /** Order two DATED tasks (both `governingDate != null`). Reached only for dated work. */
  protected abstract compareDated(a: CTPTask, b: CTPTask, state: DispatchState): number;

  public compare(a: CTPTask, b: CTPTask, state: DispatchState): number {
    const aDated = this.governingDate(state, a) != null;
    const bDated = this.governingDate(state, b) != null;
    if (aDated !== bDated) return aDated ? -1 : 1; // dated first; backfill below all dated
    if (!aDated) return legacyCompare(a, b); // both backfill → legacy order (parity)
    return this.compareDated(a, b, state); // both dated → plug priority
  }
}
