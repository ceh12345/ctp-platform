import { CTPTask } from "../../Models/Entities/task";
import { BaseDispatchPriority, legacyCompare } from "./dispatchpriority";
import { DispatchState } from "./dispatchstate";

/**
 * Apparent Tardiness Cost (ATC) — a dynamic, look-ahead dispatch rule.
 *
 *   index(j) = (w_j / p_j) · exp( -max(0, d_j − p_j − asOf) / (k · p̄) )
 *
 * Blends WSPT (`w/p`, throughput) with due-date urgency (the exponential slack
 * term): when a job has lots of slack the factor is ~0 and it is deprioritized; as
 * slack collapses the WSPT priority passes through at full strength. `k` is the
 * look-ahead knob; `asOf` (the fixed snapshot clock) and `p̄` come from the shared
 * `DispatchState` lens so the value is computed once, one way. Higher index = more urgent.
 *
 * **Axis:** ATC governs on the internal due date (`dueDate` = JobEndDate). A task
 * whose order has no `dueDate` (0) is **backfill** under ATC (handled by the base
 * partition — `compareDated` only ever sees dated work). The due date `d` and
 * weight `w` are the governing WO's, resolved off the order via the lens (a chain
 * head's own fields are 0 — `hydrateDueDates` stamps sinks only).
 *
 * v1 approximations (sprint spec Phase 2): `p` = the task's own duration (not
 * chain-remaining work); `w` = the order's lateness penalty (falls back to 1).
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export class ATCDispatchPriority extends BaseDispatchPriority {
  public readonly name = "ATC";

  constructor(private readonly k: number = 3.0) {
    super();
  }

  public governingDate(state: DispatchState, task: CTPTask): number | null {
    const d = state.dueDateOf(task);
    return d > 0 ? d : null; // no internal due date → backfill under ATC
  }

  protected compareDated(a: CTPTask, b: CTPTask, state: DispatchState): number {
    const ia = this.index(a, state);
    const ib = this.index(b, state);
    if (ia !== ib) return ib - ia; // higher index first (more urgent)
    return legacyCompare(a, b); // deterministic tie — the extracted legacy order
  }

  private index(task: CTPTask, state: DispatchState): number {
    const p = task.duration ? task.duration.duration() : 0;
    if (p <= 0) return 0;
    const penalty = state.penaltyOf(task);
    const w = penalty > 0 ? penalty : 1.0;
    const d = state.dueDateOf(task); // > 0 by construction (dated), off the order
    const slack = Math.max(0, d - p - state.asOf());
    const pbar = state.avgRemainingDuration() > 0 ? state.avgRemainingDuration() : p;
    return (w / p) * Math.exp(-slack / (this.k * pbar));
  }
}
