import {
  CTPStateChangeConstants,
  CTPDurationConstants,
  CTPTaskTypeConstants,
} from "../Core/constants";
import { CTPKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";
import { CTPResource } from "./resource";
import { CTPTask, ITask } from "./task";

export interface IStateChangeLimit {
  limit: number;
}
export interface IStateChange {
  taskCounter: number;
  runtimeCounter: number;
  fromState: string;
  toState: string;
}



export function getHashKey(
  fromState: string,
  toState: string,
  ty: string,
  resType: string,
): string {
  return resType + "-" + ty + "-" + fromState + "-" + toState;
}

export class CTPStateChangeResource {
  public fromState: string;
  public toState: string;
  public resource: CTPResource;
  public limit: number;
  public type: string;
  public duration: number

 constructor(res: CTPResource, ty: string, f: string, t: string,d: number) {    
    this.type = ty;
    this.resource = res;
    this.fromState = f;
    this.toState = t;
    this.duration = d;
    this.limit =0;
  }
  public getName() : string{
    return  this.fromState + "->" + this.toState ;
  }
}


export class CTPStateChange extends CTPKeyEntity implements IStateChange {
  public fromState: string;
  public toState: string;
  public taskCounter: number;
  public runtimeCounter: number;
  public stateChangeCounter: number;
  public duration: number;
  public resourceType: string;
  public penalty: number;

  constructor(res: string, ty?: string, f?: string, t?: string) {
    super();
    this.resourceType = res;
    this.fromState = f && f != "" ? f : CTPStateChangeConstants.DEFAULT_PROCESS;
    this.toState = t && t != "" ? t : CTPStateChangeConstants.DEFAULT_PROCESS;
    this.taskCounter = 0;
    this.runtimeCounter = 0;
    this.stateChangeCounter = 0;
    this.duration = 0;
    this.type = ty && ty != "" ? ty : CTPStateChangeConstants.PROCESS_CHANGE;
    this.hashKey = this.createhash();
    this.penalty = 0;
  }

  createhash(): string {
    if (this.fromState && this.toState && this.type)
      this.key = getHashKey(
        this.fromState,
        this.toState,
        this.type,
        this.resourceType,
      );
    return this.key;
  }
}

export class CTPStateChangeInterval extends CTPStateChange {
  public st: number;
  public et: number;

  constructor(s?: number, e?: number, f?: string, t?: string) {
    super("", "", f, t);
    this.st = s ?? 0;
    this.et = e ?? 0;
  }
}

export class CTPStateChanges extends EntityHashMap<CTPStateChange> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }
  public override fromArray(arr: CTPStateChange[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }

  public hasStateChangeForType(ty: string): boolean {
    let found = false;
    for (let sc of this.values()) {
      if (sc.resourceType === ty) {
        found = true;
        break;
      }
    }
    return found;
  }

  public stateChangesForType(ty: string): CTPStateChange[] {
    let arr: CTPStateChange[] = [];
    for (let sc of this.values()) {
      if (sc.resourceType === ty) {
        arr.push(sc);
      }
    }
    return arr;
  }

  // CHeck from , to then from defulat, to default and default default
  public getOrDefaultProcessChange(
    resType: string,
    fromChange: string,
    toChange: string,
  ): CTPStateChange | undefined {
    let typ = CTPStateChangeConstants.PROCESS_CHANGE;
    let key = getHashKey(fromChange, toChange, typ, resType);
    let result = this.getEntity(key);
    if (result) return result;
    if (fromChange)
      key = getHashKey(
        fromChange,
        CTPStateChangeConstants.DEFAULT_PROCESS,
        typ,
        resType,
      );
    result = this.getEntity(key);
    if (result) return result;
    if (toChange)
      key = getHashKey(
        CTPStateChangeConstants.DEFAULT_PROCESS,
        toChange,
        typ,
        resType,
      );
    result = this.getEntity(key);
    if (result) return result;
    key = getHashKey(
      CTPStateChangeConstants.DEFAULT_PROCESS,
      CTPStateChangeConstants.DEFAULT_PROCESS,
      typ,
      resType,
    );
    result = this.getEntity(key);
    if (result) return result;
    return undefined;
  }
}
