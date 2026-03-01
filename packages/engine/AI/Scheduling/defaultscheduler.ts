import { List } from "../../Models/Core/list";
import { CTPTask } from "../../Models/Entities/task";
import { CTPBaseScheduler } from "./basescheduler";

export class CTPScheduler extends CTPBaseScheduler {

  protected initScheduling(tasks: List<CTPTask>) {
    this.init = true;
    this.scheduleContexts.clear();
    tasks.forEach((t) => {
      t.score = Number.MAX_VALUE;
      t.errors = [];
      t.window?.reset(); // Restore original windows for re-solves
    });

    // Preschedule predecessors for chain-aware strategies
    if (this.isChainAware) {
      const agent = this.getDependentLookaheadAgent();
      agent.preschedule(this.landscape,tasks,this.settings!);
    }

    // Explode contexts for all tasks upfront (chain propagation needs them)
    this.explodeScheduleContexts(tasks);
  }

  protected initUnScheduling(tasks: List<CTPTask>) {
    this.init = true;
  }
}
