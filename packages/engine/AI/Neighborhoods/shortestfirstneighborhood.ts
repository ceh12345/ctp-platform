/**
 * Shortest First Neighborhood Strategy (SPT — Shortest Processing Time)
 *
 * Selects tasks with the shortest duration first. Classic scheduling heuristic
 * that minimizes average flow time and maximizes the number of tasks completed early.
 *
 * Best for: High-volume environments with many small tasks, minimizing average wait time.
 * Trade-off: Long tasks get pushed to the end, potentially missing their due dates.
 */
import { INeighborhoodStrategy } from "./neighborhood";
import { List } from "../../Models/Core/list";
import { CTPTask } from "../../Models/Entities/task";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPTaskStateConstants } from "../../Models/Core/constants";
import { SchedulingLandscape } from "../../Models/Entities/landscape";

export class ShortestFirstNeighborhood implements INeighborhoodStrategy {
  public name: string = "ShortestFirst";
  public chainCompatible: boolean = false;

  public solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null
  ): List<CTPTask> {
    let context = new List<CTPTask>();
    if (!tasks) return context;

    tasks.sort((a, b) => {
      const aDur = a.duration?.duration() ?? Number.MAX_VALUE;
      const bDur = b.duration?.duration() ?? Number.MAX_VALUE;
      return aDur - bDur;
    });

    let i = 0;
    tasks.forEach((task) => {
      if (!task.processed && task.canSolve() &&
        task.state === CTPTaskStateConstants.NOT_SCHEDULED
      ) {
        if (i < numToProcess) context.add(task);
        i++;
      }
    });

    return context;
  }
}
