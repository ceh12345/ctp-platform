import { CTPEntityHashed, IEntity } from "../Core/entity";
import { CTPInterval, CTPDuration } from "../Core/window";
import { CTPIntervals, CTPRangeWindows } from "../Intervals/intervals";
import { AvailableMatrix } from "../Intervals/availablematrix";
import { CTPResource } from "./resource";
import { List } from "../Core/list";
import { CTPStartTimes } from "./starttime";

export interface IResourceSlot {
  resource: CTPResource | null;
  windows: CTPRangeWindows | null;
  startTimes: CTPIntervals | null;
}

export class CTPResourceSlot implements IResourceSlot {
  public resource: CTPResource | null;

  public windows: CTPRangeWindows | null;
  public startTimes: CTPIntervals | null;
  public index: number;

  constructor(r: CTPResource, index: number) {
    this.resource = r;
    this.index = index;

    this.windows = null;
    this.startTimes = null;
  }
}
export class CTPResourceSlotList extends List<CTPResourceSlot> {
  public hashKey: string = "";

  public createhash(): string {
    let key = "";
    this.forEach((s) => {
      key += s.resource?.key + ",";
    });
    return key;
  }

  public sortBySequence() {
    /*
    this.map?.sort((n1, n2) => {
      if (n1.id > n2.id) {
        return 1;
      }

      if (n1.id < n2.id) {
        return -1;
      }

      return 0;
      
    });
    */
  }
}

export interface IResourceSlots {
  resources: CTPResourceSlotList | null;
  startTimes: CTPStartTimes | null;
  recompute: boolean;
  createHash(): string;
  hasStartTimes(): boolean;
}

export class CTPResourceSlots implements IResourceSlots {
  public resources: CTPResourceSlotList | null;
  public startTimes: CTPStartTimes | null;
  public errors: List<string> | null;
  public recompute: boolean;
  public hasInfeasibleDueToChangeOver: boolean = false;

  constructor() {
    this.resources = new CTPResourceSlotList();
    this.startTimes = null;
    this.recompute = true;
    this.hasInfeasibleDueToChangeOver = false;
    this.errors = new List<string>();
  }

  public addToErrors(s: string) {
    if (!this.errors) this.errors = new List<string>();
    this.errors?.add(s);
  }
  public clearErrors(): void {
    this.errors?.clear();
  }

  public createHash(): string {
    let key = "";
    if (this.resources) key = this.resources.createhash();
    return key;
  }

  public hasStartTimes(): boolean {
    if (this.errors && this.errors.length > 0) return false;
    return this.startTimes !== null && this.startTimes.atleastOne();
  }

}
