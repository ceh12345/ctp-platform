"strict";
import { DateTime, Duration, Interval } from "luxon";
import { CTPDateTime } from "./date";
import {
  CTPAssignmentConstants,
  CTPDurationConstants,
} from "../Core/constants";

export interface IIntervalDTO {
  startW: number;
  endW: number;
  qty: number | null;
  runRate: number | null;
  flowLeft: boolean;
  flowRight: boolean;

  name: string | null;
  type: number;
}
export interface IInterval extends IIntervalDTO {
  duration(): number;
  runRateQty(): number;
  reset(): void;

  get AbsoluteStartTime(): DateTime;
  get AbsoluteEndTime(): DateTime;
}
// Capable To Promise Interval
// Start , End and Qty

export class CTPInterval implements IInterval {
  public startW: number = 0;
  public endW: number = 0;
  public origStartW: number = 0;
  public origEndW: number = 0;
  public origQty: number | null;
  public qty: number | null;
  public runRate: number | null;
  public flowLeft: boolean = true;
  public flowRight: boolean = true;

  public name: string | null;
  public type: number;
  public subType: number | null;

  public constructor(s?: number, e?: number, q?: number) {
    this.flowLeft = true;
    this.flowRight = true;
    this.qty = 1.0;
    this.origQty = null;
    this.runRate = null;

    if (s !== undefined) this.startW = s;
    if (e !== undefined) this.endW = e;
    if (q !== undefined) this.qty = q;

    this.name = null;
    this.subType = null;
    this.type = 0;
    this.setOrig();
  }

  protected setOrig() {
    this.origEndW = this.endW;
    this.origStartW = this.startW;
    this.origQty = this.qty;
  }

  public set(s: number, e: number, q: number | null) {
    this.origEndW = e;
    this.origStartW = s;
    this.origQty = q;

    this.reset();
  }

  public fromDates(s: DateTime, e: DateTime, q: number | null) {
    this.origEndW = CTPDateTime.fromDateTime(e);
    this.origStartW = CTPDateTime.fromDateTime(s);
    this.origQty = q;

    this.reset();
  }

  public copy(node: CTPInterval): void {
    this.set(node.startW, node.endW, node.qty);
    this.runRate = node.runRate;
    this.flowLeft = node.flowLeft;
    this.flowRight = node.flowRight;
  }

  public duration() {
    return this.endW - this.startW;
  }

  public runRateQty() {
    if (this.runRate) return this.duration() * this.runRate;
    return 0;
  }
  public reset() {
    this.startW = this.origStartW;
    this.endW = this.origEndW;
    this.qty = this.origQty;
    this.flowLeft = true;
    this.flowRight = true;
  }

  public hasQty(): boolean {
    return this.qty != null;
  }

  public get AbsoluteStartTime(): DateTime {
    return CTPDateTime.toDateTime(this.startW);
  }

  public get AbsoluteEndTime(): DateTime {
    return CTPDateTime.toDateTime(this.endW);
  }

  public debug(showdates: boolean = true) {
    if (showdates) {
      const duration1 = Duration.fromObject({ second: this.duration() });
      console.log(
        this.AbsoluteStartTime.toFormat("ccc LLL dd yyyy HH:mm:ss ") +
          " - " +
          this.AbsoluteEndTime.toFormat("ccc LLL dd yyyy HH:mm:ss ") +
          " - " +
          this.qty +
          " - " +
          duration1.toFormat("T hh:mm:ss"),
      );
    } else
      console.log(
        this.startW +
          " - " +
          this.endW +
          " - " +
          this.qty +
          " - " +
          this.duration(),
      );
  }
}

export class CTPRunRate extends CTPInterval {
  public constructor(s?: number, e?: number, q?: number, r?: number) {
    super(s, e, q);
    if (r !== undefined) this.runRate = r;
  }
}

export class CTPAssignment extends CTPInterval {
  public constructor(s?: number, e?: number, q?: number) {
    super(s, e, q);
    this.name = "";
    this.type = CTPAssignmentConstants.PROCESS;
  }

  public override fromDates(s: DateTime, e: DateTime, q: number | null) {
    this.name = "";
    this.type = CTPAssignmentConstants.PROCESS;
    super.fromDates(s, e, q);
  }
}

export class CTPSetup extends CTPAssignment {
  public constructor(s?: number, e?: number, q?: number) {
    super(s, e, q);
    this.type = CTPAssignmentConstants.SETUP;
  }
}

export class CTPCalendar extends CTPAssignment {
  public constructor(s?: number, e?: number, q?: number) {
    super(s, e, q);
    this.type = CTPAssignmentConstants.CALENDAR;
  }
}

export class CTPTransportOffset extends CTPAssignment {
  public constructor(s?: number, e?: number, q?: number) {
    super(s, e, q);
    this.type = CTPAssignmentConstants.TRANSPORT;
  }
}

export interface IDuration extends IInterval {
  durationType: number;
}
export class CTPDuration extends CTPAssignment implements IDuration {
  public durationType: number;

  public constructor(e?: number, q?: number, t?: number) {
    super(0, e, q);
    this.name = "";
    this.type = CTPAssignmentConstants.DURATION;
    this.durationType = CTPDurationConstants.FIXED_DURATION;
    if (t !== undefined) {
      this.durationType = t;
      if (t === CTPDurationConstants.FIXED_RUN_RATE && q !== undefined)
        this.runRate = q;
      if (t === CTPDurationConstants.FLOAT_RUN_RATE && q !== undefined)
        this.runRate = q;
    }
  }
}
