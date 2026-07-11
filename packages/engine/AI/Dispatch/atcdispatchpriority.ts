import { CTPTask } from "../../Models/Entities/task";
import { IDispatchPriority } from "./dispatchpriority";
import { DispatchState } from "./dispatchstate";

/**
 * Apparent Tardiness Cost (ATC) — a dynamic, look-ahead dispatch rule.
 *
 *   index(j) = (w_j / p_j) · exp( -max(0, d_j − p_j − now) / (k · p̄) )
 *
 * Blends WSPT (`w/p`, throughput) with due-date urgency (the exponential slack
 * term): when a job has lots of slack the factor is ~0 and it is deprioritized;
 * as slack collapses the WSPT priority passes through at full strength. `k` is the
 * look-ahead knob; `now` and `p̄` come from the shared `DispatchState` lens so the
 * value is computed once, one way. Higher index = more urgent.
 *
 * v1 approximations (see sprint spec Phase 2): `p` = the task's own duration (not
 * chain-remaining work), `now` = the global ready-set frontier, `w` = the order's
 * lateness penalty (falls back to 1).
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export class ATCDispatchPriority implements IDispatchPriority {
  public readonly name = "ATC";

  constructor(private readonly k: number = 3.0) {}

  public compare(a: CTPTask, b: CTPTask, state: DispatchState): number {
    const ia = this.index(a, state);
    const ib = this.index(b, state);
    if (ia !== ib) return ib - ia; // higher index first (more urgent)
    // Deterministic tie-break — same as the default plug, so ties are stable.
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aStart = a.window ? a.window.startW : Number.MAX_VALUE;
    const bStart = b.window ? b.window.startW : Number.MAX_VALUE;
    return aStart - bStart;
  }

  private index(task: CTPTask, state: DispatchState): number {
    const p = task.duration ? task.duration.duration() : 0;
    if (p <= 0) return 0;
    const w = task.latenessPenaltyPerDay > 0 ? task.latenessPenaltyPerDay : 1.0;
    const d = task.dueDate > 0 ? task.dueDate : Number.MAX_SAFE_INTEGER;
    const slack = Math.max(0, d - p - state.now());
    const pbar = state.avgRemainingDuration() > 0 ? state.avgRemainingDuration() : p;
    return (w / p) * Math.exp(-slack / (this.k * pbar));
  }
}
