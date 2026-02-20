/**
 * Due Date Neighborhood Strategy
 *
 * Selects tasks with the earliest due date first. Uses the task window end
 * as the due date proxy. Ensures urgent deadlines are addressed before later ones.
 *
 * Best for: Make-to-order manufacturing, environments with firm delivery commitments.
 * Trade-off: May underutilize resources if early-due tasks are on different machines.
 */
import { INeighborhoodStrategy } from "./neighborhood";
import { List } from "../../Models/Core/list";
import { CTPTask } from "../../Models/Entities/task";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPTaskStateConstants } from "../../Models/Core/constants";
import { SchedulingLandscape } from "../../Models/Entities/landscape";

export class DueDateNeighborhood implements INeighborhoodStrategy {
  public name: string = "DueDate";
  public chainCompatible: boolean = true;

  public solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null
  ): List<CTPTask> {
    let context = new List<CTPTask>();
    if (!tasks) return context;

    tasks.sort((a, b) => {
      const aDue = a.window?.endW ?? Number.MAX_VALUE;
      const bDue = b.window?.endW ?? Number.MAX_VALUE;
      return aDue - bDue;
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
