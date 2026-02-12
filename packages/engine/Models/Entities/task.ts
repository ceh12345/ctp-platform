"strict";
import { CTPDuration, CTPInterval } from "../Core/window";
import { List } from "../Core/list";
import { IResourcePreference } from "../Entities/resource";
import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import {
  CTPStateChangeConstants,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  CTPWipStateConstants,
} from "../Core/constants";
import { EntityHashMap } from "../Core/hashmap";
import { CTPStateChange } from "./statechange";
import { CTPLinkId } from "../Core/linkid";
import { CTPError, IError } from "../Core/error";

export interface ITaskResource {
  // resoruce can be only the key value when reading from the flat files
  // Will need to build the resource from the resourcex hash
  resource: string | undefined;
  isPrimary: boolean;
  scheduledResource: string | undefined;
  preferences: Array<IResourcePreference>;
}
export class CTPTaskResource implements ITaskResource {
  public resource: string | undefined;
  public isPrimary: boolean = false;
  public scheduledResource: string | undefined;
  public preferences: Array<IResourcePreference>; // Array of Resource skys
  public index: number;
  public qty: number;

  constructor(r?: string, prim?: boolean, i?: number,schedResource?: string) {
    this.resource = r ?? undefined;
    this.scheduledResource =  schedResource ?? undefined
    this.preferences = [];
    this.index = i ?? 0;
    this.isPrimary = prim ?? false;
    this.qty = 1.0;
  }
}

export class CTPTaskResourceList extends List<CTPTaskResource> {
  public sortBySequence() {
    let i = 0;
    this.forEach((r: CTPTaskResource) => {
      r.index = i;
      i += 1;
    });
  }
  public primaryResourceIndex: number | undefined = -1;
}

export interface ITask extends IKeyEntity {
  processed: boolean;
  window: CTPInterval | null;
  state: number;
  wipstate: number;
  scheduled: CTPInterval | null;
  duration: CTPDuration | null;
  capacityResources: CTPTaskResourceList | null;
  materialsResources: CTPTaskResourceList | null;
  score: number;
  requiresSetup: boolean;
}

export class CTPTask extends CTPKeyEntity implements ITask {
  public window: CTPInterval | null;
  public state: number = 0;
  public wipstate: number = 0;
  public scheduled: CTPInterval | null;
  public duration: CTPDuration | null;
  public feasible: CTPInterval | null;

  public capacityResources: CTPTaskResourceList | null;
  public materialsResources: CTPTaskResourceList | null;

  public linkId: CTPLinkId | undefined;

  public score: number;

  public process: string | undefined;
  public requiresSetup: boolean;

  public subType: string | null;
  public processed: boolean;

  public errors : IError[] ;

  public resetScore() {
    this.score = Number.MAX_VALUE;
    this.feasible = null;
  }

  public canMove (): boolean {
    return this.wipstate == CTPWipStateConstants.NOT_STARTED;
  }
  
  public hasLinkId() {
    return this.linkId != undefined;
  }

  public hasScore() {
    return this.score != undefined && this.score != Number.MAX_VALUE;
  }

  public clearErrors()
  {
      this.errors = [];
  }

  public addError (a:string, r : string)
  {
      this.errors.push({agent:a,reason: r,type:''});
  }
  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
    this.window = new CTPInterval();
    this.scheduled = null;
    this.duration = null;
    this.capacityResources = null;
    this.materialsResources = null;
    this.state = CTPTaskStateConstants.NOT_SCHEDULED;
    this.wipstate = CTPWipStateConstants.NOT_STARTED;
    this.processed = false;
    this.score = Number.MAX_VALUE;
    this.cost = 0;
    this.type = this.type || CTPTaskTypeConstants.PROCESS;
    this.requiresSetup = true;
    this.subType = null;
    this.process = undefined;
    this.linkId = undefined;
    this.errors = [];
    this.feasible = null;
  }
}

export class CTPTaskList extends List<CTPTask> {
  public sortBySequence(): void {
    this.sort((n1, n2) => {
      if (n1.sequence > n2.sequence) return 1;
      if (n1.sequence < n2.sequence) return -1;
      return 0;
    });
  }
}

export class CTPTasks extends EntityHashMap<CTPTask> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }
  public override fromArray(arr: CTPTask[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }
}
