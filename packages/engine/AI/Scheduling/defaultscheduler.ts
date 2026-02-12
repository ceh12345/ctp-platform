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
    });

    // Add in the preds for each task
    if (this.settings?.requiresPreds){
      const agent = this.getDependentLookaheadAgent();
      agent.preschedule(this.landscape,tasks,this.settings);
    }
    this.explodeScheduleContexts(tasks);
  }

  protected initUnScheduling(tasks: List<CTPTask>) {
    this.init = true;
  }
}
