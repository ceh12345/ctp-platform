/**
 * Greedy Neighborhood Strategy
 *
 * Selects the next tasks to schedule based on a multi-factor sort:
 * earliest feasible end time -> best score -> priority rank -> window start -> shortest duration.
 *
 * Best for: General purpose scheduling, manufacturing environments without strict chain dependencies.
 * Trade-off: Optimizes individual task placement but may break chain continuity.
 * Default for: requiresPreds = false
 */
import { INeighborhoodStrategy } from "./neighborhood";
import { CTPScheduleDirectionConstants, CTPTaskStateConstants } from "../../Models/Core/constants";
import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPTask } from "../../Models/Entities/task";
import { IDependencyLookAhead } from "../Agents/LookAhead Agents/dependencylookahead";

export class GreedyNeighborhood implements INeighborhoodStrategy {
  public name: string = "Greedy";
  public chainCompatible: boolean = false;
  public dependencyLookAhead: IDependencyLookAhead | null = null;

  protected sortFn: (n1: CTPTask, n2: CTPTask) => number = (n1, n2) => {
    let n1et = n1.feasible ? n1.feasible.startW : n1.window?.startW;
    let n2et = n2.feasible ? n2.feasible.startW : n2.window?.startW;

    if (n1et && n2et && n1.duration && n2.duration) {
      n1et += n1.duration.duration();
      n2et += n2.duration.duration();
    }

    let result = 0;
    // sort by earliest end time
    if (n1et && n2et) result = n1et - n2et;
    // sort by best score
    if (result === 0) result = n1.score - n2.score;
    // by priority
    if (result == 0) result = n1.rank - n2.rank;
    // by window start
    if (result === 0)
      result =
        (n1.window ? n1.window.startW : Number.MAX_VALUE) -
        (n2.window ? n2.window.startW : Number.MAX_VALUE);
    // by duration
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

    tasks.sort(this.sortFn);

    let i = 0;
    tasks.forEach((task) => {
      if (!task.processed && task.canSolve() &&
        task.state === CTPTaskStateConstants.NOT_SCHEDULED
      ) {
        if (i < numToProcess) context.add(task);
        i = i + 1;
      }
    });

    if (this.dependencyLookAhead) {
      for (let j = 0; j < context.length; j++) {
        const task = context.index(j);
        if (!task) continue;
        if (task.state === CTPTaskStateConstants.NOT_SCHEDULED) {
          const predTask = this.dependencyLookAhead.earliestPredTaskNotScheduled(
            tasks,
            task.sequence,
            settings?.scheduleDirection ?? CTPScheduleDirectionConstants.FORWARD
          );
          if (predTask && !context.contains(predTask)) {
            context.splice(j, 0, predTask);
            if (context.length > numToProcess) context.splice(context.length - 1, 1);
          }
        }
      };
    }

    return context;
  }
}
