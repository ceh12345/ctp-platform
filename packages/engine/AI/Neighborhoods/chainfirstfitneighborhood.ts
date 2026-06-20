/**
 * Chain First Fit Neighborhood Strategy
 *
 * Finds the first chain with unscheduled tasks and returns the entire remaining
 * chain in sequence order. No scoring, no ranking across chains — first available
 * chain wins. Designed for speed.
 *
 * Best for: CTP (Capable to Promise) queries, WhereTo slot finding, fast feasibility checks.
 * Trade-off: No optimization — takes the first feasible option, not the best one.
 * Fastest strategy available.
 */
import { INeighborhoodStrategy } from "./neighborhood";
import { List } from "../../Models/Core/list";
import { CTPTask } from "../../Models/Entities/task";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPTaskStateConstants } from "../../Models/Core/constants";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { topoOrder } from "../../Models/Entities/adjacency";

export class ChainFirstFitNeighborhood implements INeighborhoodStrategy {
  public name: string = "ChainFirstFit";
  public chainCompatible: boolean = true;

  public solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null
  ): List<CTPTask> {
    let context = new List<CTPTask>();
    if (!tasks) return context;

    // Group tasks by chain (linkId name)
    const chains = new Map<string, CTPTask[]>();
    tasks.forEach((task) => {
      if (!task.processed && task.canSolve() &&
        task.state === CTPTaskStateConstants.NOT_SCHEDULED &&
        task.hasLinkId() && task.linkId?.name) {
        const chainName = task.linkId.name;
        if (!chains.has(chainName)) chains.set(chainName, []);
        chains.get(chainName)!.push(task);
      }
    });

    // Find first chain with unscheduled tasks
    for (const [, chainTasks] of chains) {
      if (chainTasks.length > 0) {
        // Edge-list refactor: execution order is the topological order over
        // preds[]/succs[]. On a linear chain this is identical to the legacy
        // sequence sort (topoOrder breaks ties by sequence, and falls back to
        // pure sequence order if no edges are present).
        topoOrder(chainTasks).forEach(t => context.add(t));
        return context;
      }
    }

    // If no chains found, pick standalone tasks
    let i = 0;
    tasks.forEach((task) => {
      if (!task.processed && task.canSolve() &&
        task.state === CTPTaskStateConstants.NOT_SCHEDULED &&
        !task.hasLinkId()
      ) {
        if (i < numToProcess) context.add(task);
        i++;
      }
    });

    return context;
  }
}
