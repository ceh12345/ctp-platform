"strict";

import { CTPAvailable, CTPAssignments } from "../Intervals/intervals";
import { CTPAvailableTimes } from "../Intervals/intervals";
import { List } from "../Core/list";
import { CTPStateChangeInterval } from "../Entities/statechange";

export class AvailableMatrix {
  public name: string = "";
  public staticOriginal: CTPAvailable | null = null;
  public staticAssignments: CTPAssignments | null = null;
  public staticAvailable: CTPAvailable | null = null;
  public staticAvailableCopy: CTPAssignments | null = null;
  public availableTimes: CTPAvailableTimes[] = [];
  public stateChanges: List<CTPStateChangeInterval> | null = null;

  public recalc: boolean = false;
  public recompute: boolean = false;

  constructor(name: string = "") {
    this.name = name;
    this.availableTimes.push(new CTPAvailableTimes()); // FIXED
    this.availableTimes.push(new CTPAvailableTimes()); // FLOAT
    this.availableTimes.push(new CTPAvailableTimes()); // UNTRACKED
    this.stateChanges = new List<CTPStateChangeInterval>();

    this.recalc = true;
  }

  public findRunRate(startW: number): number | null {
    let rr = null;
    if (this.staticOriginal) {
      let i = this.staticOriginal.atStartTime(startW);
      if (i) rr = i.data.runRate;
    }
    return rr;
  }
  public setLists(
    o: CTPAvailable | null,
    as: CTPAssignments | null,
    a: CTPAvailable | null = null,
  ) {
    this.setOriginal(o);
    this.setAssignments(as);
    this.setAvailable(a);
  }

  public setOriginal(o: CTPAvailable | null) {
    this.staticOriginal = o;
  }

  public setAssignments(as: CTPAvailable | null) {
    this.staticAssignments = as;
  }

  public setAvailable(as: CTPAvailable | null) {
    this.staticAvailable = as;
    this.staticAvailableCopy = as;
  }

  public revertAvailable() {
    this.staticAvailable = this.staticAvailableCopy;
  }

  public clear(i: number = -99): void {
    if (i >= 0 && i < this.availableTimes.length) this.availableTimes[i].clear();
    else {
      for (let i = 0; i < this.availableTimes.length; i++)
        this.availableTimes[i].clear();
    }
    this.stateChanges?.clear();
  }
  public index(i: number): CTPAvailableTimes | null {
    if (i >= 0 && i < this.availableTimes.length) {
      this.availableTimes[i].type = i;
      return this.availableTimes[i];
    }
    return null;
  }

  public debugList(i: number, showdates: boolean) {
    let l = this.index(i);
    if (l) l.debug(showdates);
  }
}
