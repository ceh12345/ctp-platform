import { CTPScheduleDirectionConstants, CTPTaskStateConstants } from "../../Models/Core/constants";
import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { ScheduleContexts } from "../../Models/Entities/schedulecontext";
import { CTPTask, CTPTasks } from "../../Models/Entities/task";
import { AIAgent } from "./agent";
import { IDependencyLookAhead } from "./LookAhead Agents/dependencylookahead";

export interface INextNeighborhoodAgent {
  solve(tasks: List<CTPTask>, numToProcess: number, settings: CTPAppSettings): List<CTPTask>;
  setDependencyLookAhead (i: IDependencyLookAhead): void;
}

export class NextNeighborhoodAgent
  extends AIAgent
  implements INextNeighborhoodAgent
{
  public theSortBy: (n1: CTPTask, n2: CTPTask) => number;
  public dependencyLookAhead: IDependencyLookAhead | null = null;

  constructor() {
    super("NextTasksToScheduleAgent");
    this.theSortBy = this.greedySortFn;
  }

  public setDependencyLookAhead (i: IDependencyLookAhead | null): void
  {
    this.dependencyLookAhead = i;
  }

  protected greedySortFn: (n1: CTPTask, n2: CTPTask) => number = (n1, n2) => {
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
    // by prioirty
    if (result == 0) result = n1.rank - n2.rank;
    // by window statrt
    if (result === 0)
      result =
        (n1.window ? n1.window.startW : Number.MAX_VALUE) -
        (n2.window ? n2.window.startW : Number.MAX_VALUE);
    // by duration
    if (result === 0 && n1.duration && n2.duration)
      result = n1.duration?.duration() - n2.duration?.duration();

    return result;
  };

  public solve(tasks: List<CTPTask>, numofNeighbors: number, settings: CTPAppSettings | null): List<CTPTask> {
    let context = new List<CTPTask>();

    if (!tasks) return context;
    tasks.sort(this.theSortBy);

    /*
    tasks.sort((n1, n2) => {
      // sort by best score
      let result = n1.score-n2.score;

      if (result === 0) 
      {
          // sort by priority
          result = n1.rank-n2.rank;
          //sort ny start time
          if (result === 0) 
              result = (n1.window ? n1.window.startW : Number.MAX_VALUE) -  (n2.window ? n2.window.startW : Number.MAX_VALUE);
          // sort by shortest duration
          if (result === 0 && n1.duration && n2.duration) result = (n1.duration?.duration() - n2.duration?.duration() );
      }
      
      return result;
    });
    */

    let i = 0;
    tasks.forEach((task) => {
      if (
        !task.processed &&
        task.state === CTPTaskStateConstants.NOT_SCHEDULED
      ) {
        if (i < numofNeighbors) context.add(task);
        i = i + 1;
      }
    });

    if (this.dependencyLookAhead) {
      for (let j = 0; j < context.length; j++) {
        const task = context.index(j);
        if (!task) continue;
        // If the task is not scheduled, check for dependencies
        if (task.state === CTPTaskStateConstants.NOT_SCHEDULED) {
          const predTask = this.dependencyLookAhead.earliestPredTaskNotScheduled(
            tasks,
            task.sequence,
            settings?.scheduleDirection ?? CTPScheduleDirectionConstants.FORWARD
          );
          // Insert predecessor before the current task, removing the last item to keep size
          if (predTask && !context.contains(predTask)) {
             context.splice(j, 0, predTask);
             if (context.length > numofNeighbors) context.splice(context.length - 1, 1);
          }
        }
      };
    }

    return context;
  }
}
