import { INeighborhoodStrategy } from "./neighborhood";
import { CTPTaskStateConstants } from "../../Models/Core/constants";
import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPTask } from "../../Models/Entities/task";

export class ChainNeighborhood implements INeighborhoodStrategy {
  public name: string = "Chain";

  protected greedySortFn: (n1: CTPTask, n2: CTPTask) => number = (n1, n2) => {
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
    landscape: SchedulingLandscape | null
  ): List<CTPTask> {
    let context = new List<CTPTask>();
    if (!tasks) return context;

    // Find the next unscheduled task per chain (lowest sequence)
    const chainProgress: Map<string, { nextTask: CTPTask, chainRank: number }> = new Map();

    tasks.forEach((task) => {
      if (!task.processed && task.canSolve()
          && task.state === CTPTaskStateConstants.NOT_SCHEDULED
          && task.hasLinkId() && task.linkId?.name) {
        const chainName = task.linkId.name;
        const existing = chainProgress.get(chainName);
        if (!existing || task.sequence < existing.nextTask.sequence) {
          chainProgress.set(chainName, {
            nextTask: task,
            chainRank: task.rank
          });
        }
      }
    });

    // Sort chains by rank (priority), then window start as tiebreaker
    const sortedChains = Array.from(chainProgress.entries()).sort((a, b) => {
      if (a[1].chainRank !== b[1].chainRank) return a[1].chainRank - b[1].chainRank;
      const aStart = a[1].nextTask.window?.startW ?? Number.MAX_VALUE;
      const bStart = b[1].nextTask.window?.startW ?? Number.MAX_VALUE;
      return aStart - bStart;
    });

    // Add one task per chain up to numToProcess
    for (const [chainName, info] of sortedChains) {
      if (context.length >= numToProcess) break;
      console.log("PROCESSING: " + info.nextTask.name + " chain=" + chainName + " seq=" + info.nextTask.sequence);
      context.add(info.nextTask);
    }

    // Fill remaining slots with standalone tasks (no linkId)
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
