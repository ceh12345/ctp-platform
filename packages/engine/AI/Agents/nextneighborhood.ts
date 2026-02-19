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

    if (settings?.requiresPreds) {
      // Chain-aware ordering: process chains together
      context = this.solveChainAware(tasks, numofNeighbors);
    } else {
      // Original global sort (unchanged)
      context = this.solveGlobal(tasks, numofNeighbors, settings);
    }

    return context;
  }

  private solveGlobal(tasks: List<CTPTask>, numofNeighbors: number, settings: CTPAppSettings | null): List<CTPTask> {
    let context = new List<CTPTask>();
    tasks.sort(this.theSortBy);

    let i = 0;
    tasks.forEach((task) => {
      if (!task.processed && task.canSolve() &&
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
        if (task.state === CTPTaskStateConstants.NOT_SCHEDULED) {
          const predTask = this.dependencyLookAhead.earliestPredTaskNotScheduled(
            tasks,
            task.sequence,
            settings?.scheduleDirection ?? CTPScheduleDirectionConstants.FORWARD
          );
          if (predTask && !context.contains(predTask)) {
             context.splice(j, 0, predTask);
             if (context.length > numofNeighbors) context.splice(context.length - 1, 1);
          }
        }
      };
    }

    return context;
  }

  private solveChainAware(tasks: List<CTPTask>, numofNeighbors: number): List<CTPTask> {
    let context = new List<CTPTask>();

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

    // Add one task per chain up to numofNeighbors
    for (const [chainName, info] of sortedChains) {
      if (context.length >= numofNeighbors) break;
      console.log("PROCESSING: " + info.nextTask.name + " chain=" + chainName + " seq=" + info.nextTask.sequence);
      context.add(info.nextTask);
    }

    // Fill remaining slots with standalone tasks (no linkId)
    if (context.length < numofNeighbors) {
      const standalones: CTPTask[] = [];
      tasks.forEach((task) => {
        if (!task.processed && task.canSolve()
            && task.state === CTPTaskStateConstants.NOT_SCHEDULED
            && !task.hasLinkId()) {
          standalones.push(task);
        }
      });
      standalones.sort(this.theSortBy);
      for (const task of standalones) {
        if (context.length >= numofNeighbors) break;
        context.add(task);
      }
    }

    return context;
  }
}
