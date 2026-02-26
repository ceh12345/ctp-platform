import { RankedScheduleContexts } from './RankedScheduleContexts';
import { HashMap } from '../Models/Core/hashmap';

export class SolverState {
  private rankedByTask: HashMap<string, RankedScheduleContexts>;

  constructor() {
    this.rankedByTask = new HashMap<string, RankedScheduleContexts>();
  }

  public getRanked(taskKey: string): RankedScheduleContexts {
    let ranked = this.rankedByTask.get(taskKey);
    if (!ranked) {
      ranked = new RankedScheduleContexts(taskKey);
      this.rankedByTask.set(taskKey, ranked);
    }
    return ranked;
  }

  public clear(): void {
    this.rankedByTask.clear();
  }

  public allTaskKeys(): string[] {
    const keys: string[] = [];
    for (const k of this.rankedByTask.keys()) keys.push(k);
    return keys;
  }
}
