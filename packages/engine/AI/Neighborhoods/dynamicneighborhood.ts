import { INeighborhoodStrategy } from "./neighborhood";
import { CTPTaskStateConstants } from "../../Models/Core/constants";
import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPTask } from "../../Models/Entities/task";
import { indexByKey } from "../../Models/Entities/adjacency";
import { IDispatchPriority } from "../Dispatch/dispatchpriority";
import { DispatchStateLens } from "../Dispatch/dispatchstate";

/**
 * Chain-safe neighborhood whose chain-head ordering is a pluggable dispatch rule
 * (`IDispatchPriority`). Structurally identical to `ChainNeighborhood` — the ONLY
 * difference is that the chain-head comparator is the injected rule instead of a
 * hardcoded `(rank, window.startW)` sort. So `DynamicNeighborhood(StaticRankPriority)`
 * reproduces `ChainNeighborhood` byte-for-byte (proven by `schedule-parity.spec.ts`),
 * and ATC / DBR / Slack are additive plugs — one class + one registry line each.
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export class DynamicNeighborhood implements INeighborhoodStrategy {
  public name: string;
  public chainCompatible: boolean = true;

  constructor(private readonly priority: IDispatchPriority) {
    this.name = priority.name;
  }

  // Standalone (no-linkId) backfill order — identical to ChainNeighborhood's
  // greedySortFn. No tenant currently has standalone tasks (Phase 0e), so this
  // path is preserved for correctness but does not run in practice.
  private greedySortFn = (n1: CTPTask, n2: CTPTask): number => {
    let n1et = n1.feasible ? n1.feasible.startW : n1.window?.startW;
    let n2et = n2.feasible ? n2.feasible.startW : n2.window?.startW;

    if (n1et && n2et && n1.duration && n2.duration) {
      n1et += n1.duration.duration();
      n2et += n2.duration.duration();
    }

    let result = 0;
    if (n1et && n2et) result = n1et - n2et;
    if (result === 0) result = n1.score - n2.score;
    if (result == 0) result = n1.rank - n2.rank;
    if (result === 0)
      result =
        (n1.window ? n1.window.startW : Number.MAX_VALUE) -
        (n2.window ? n2.window.startW : Number.MAX_VALUE);
    if (result === 0 && n1.duration && n2.duration)
      result = n1.duration.duration() - n2.duration.duration();

    return result;
  };

  public solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null,
  ): List<CTPTask> {
    let context = new List<CTPTask>();
    if (!tasks) return context;

    const state = new DispatchStateLens(landscape, settings);
    this.priority.prepare?.(state);

    // Next ready task per chain — every predecessor SCHEDULED (missing/cross-set
    // pred counts as satisfied); lowest sequence is the within-chain tiebreak.
    const chainProgress: Map<string, { nextTask: CTPTask }> = new Map();
    const byKey = indexByKey(tasks);

    tasks.forEach((task) => {
      if (!task.processed && task.canSolve()
          && task.state === CTPTaskStateConstants.NOT_SCHEDULED
          && task.hasLinkId() && task.linkId?.name) {
        const ready = task.preds.every((pk) => {
          const pred = byKey.get(pk);
          return !pred || pred.state === CTPTaskStateConstants.SCHEDULED;
        });
        if (!ready) return;
        const chainName = task.linkId.name;
        const existing = chainProgress.get(chainName);
        if (!existing || task.sequence < existing.nextTask.sequence) {
          chainProgress.set(chainName, { nextTask: task });
        }
      }
    });

    // The ONLY behavioral seam: order chain heads by the pluggable dispatch rule.
    // Map iteration is insertion order and Array.sort is stable, so with
    // StaticRankPriority this is identical to ChainNeighborhood's chain sort.
    const sortedChains = Array.from(chainProgress.values()).sort((a, b) =>
      this.priority.compare(a.nextTask, b.nextTask, state),
    );

    for (const info of sortedChains) {
      if (context.length >= numToProcess) break;
      context.add(info.nextTask);
    }

    // Fill remaining slots with standalone tasks (no linkId).
    if (context.length < numToProcess) {
      const standalones: CTPTask[] = [];
      tasks.forEach((task) => {
        if (!task.processed && task.canSolve()
            && task.state === CTPTaskStateConstants.NOT_SCHEDULED
            && !task.hasLinkId()) {
          standalones.push(task);
        }
      });
      standalones.sort(this.greedySortFn);
      for (const task of standalones) {
        if (context.length >= numToProcess) break;
        context.add(task);
      }
    }

    return context;
  }
}
