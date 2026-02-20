import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPTask } from "../../Models/Entities/task";
import { AIAgent } from "./agent";
import { INeighborhoodStrategy } from "../Neighborhoods/neighborhood";
import { GreedyNeighborhood } from "../Neighborhoods/greedyneighborhood";
import { IDependencyLookAhead } from "./LookAhead Agents/dependencylookahead";

export interface INextNeighborhoodAgent {
  solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null
  ): List<CTPTask>;
  setStrategy(strategy: INeighborhoodStrategy): void;
}

export class NextNeighborhoodAgent
  extends AIAgent
  implements INextNeighborhoodAgent
{
  private strategy: INeighborhoodStrategy;

  constructor() {
    super("NextTasksToScheduleAgent");
    this.strategy = new GreedyNeighborhood(); // default
  }

  public setStrategy(strategy: INeighborhoodStrategy): void {
    this.strategy = strategy;
  }

  public getStrategy(): INeighborhoodStrategy {
    return this.strategy;
  }

  /** @deprecated Use setStrategy() with a GreedyNeighborhood that has dependencyLookAhead set */
  public setDependencyLookAhead(i: IDependencyLookAhead | null): void {
    if (this.strategy instanceof GreedyNeighborhood) {
      (this.strategy as GreedyNeighborhood).dependencyLookAhead = i;
    }
  }

  public solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null = null
  ): List<CTPTask> {
    return this.strategy.solve(tasks, numToProcess, settings, landscape);
  }
}
