"strict";
import { CTPDuration, IDuration } from "../Core/window";
import { List } from "../Core/list";
import { CTPResource } from "../Entities/resource";
import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { CTPTaskList } from "../Entities/task";
import { EntityHashMap } from "../Core/hashmap";

export interface IProcess extends IKeyEntity {
  tasks: CTPTaskList | undefined;
}


export class CTPProcess extends CTPKeyEntity implements IProcess {
  tasks: CTPTaskList | undefined;

  constructor(n:string)
  {
    super('',n,n);
    this.tasks = new CTPTaskList();
  }

  
}

export class CTPProcessList extends List<CTPProcess> {
  public sortBySequence(): void {
    this.sort((n1, n2) => {
      if (n1.sequence > n2.sequence) return 1;
      if (n1.sequence < n2.sequence) return -1;
      return 0;
    });
  }
}

export class CTPProcesses extends EntityHashMap<CTPProcess> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }
}
