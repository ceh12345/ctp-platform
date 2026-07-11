import { CTPTask } from "../../Models/Entities/task";
import { DispatchState } from "./dispatchstate";

/**
 * A dispatch (selection) rule — "what to make next". Given the ready set and the
 * live `DispatchState`, it orders candidate chain-head tasks.
 *
 * Expressed as a COMPARATOR rather than a scalar so the default rule can reproduce
 * the existing multi-key tie-break byte-for-byte (Phase 0e). Scalar rules
 * (ATC/DBR/Slack) implement `compare` via their priority value.
 *
 * Convention: `compare(a, b) < 0` ⇒ a is picked before b (a is more urgent).
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export interface IDispatchPriority {
  readonly name: string;
  /** Optional per-round precompute (e.g. DBR bottleneck index built once per round). */
  prepare?(state: DispatchState): void;
  compare(a: CTPTask, b: CTPTask, state: DispatchState): number;
}
