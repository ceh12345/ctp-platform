"strict";
import { DateTime, Interval } from "luxon";
import { CTPDateTime } from "./date";
import { CTPDurationConstants } from "../Core/constants";
import { IInterval, CTPInterval, CTPDuration } from "../Core/window";
import { LinkedList, ListNode } from "../Core/linklist";
import { CTPAvailable } from "../Intervals/intervals";
import { DurationPolicy } from "./duration-policy";
import { clipDuration, walkForward, walkBackward, accumulateRangeValues } from "./interval-walker";

export interface IRangeValues {
  duration: number;
  minAvail: number;
  maxAvail: number;
  runRateQty: number;
  est: number;
  eet: number;
  lst: number;
  lett: number;
}

export class CTPRangeValues {
  public duration: number = 0;
  public minAvail: number = 0;
  public maxAvail: number = 0;
  public runRateQty: number = 0;
  public est: number = 0;
  public eet: number = 0;
  public lst: number = 0;
  public lett: number = 0;

  constructor(
    est: number = 0,
    eet: number = 0,
    lst: number = 0,
    lett: number = 0,
  ) {
    this.est = est;
    this.eet = eet;
    this.lst = lst;
    this.lett = lett;
  }
}
export interface IRangeTime extends IInterval {
  estPtr: ListNode<CTPInterval> | null;
  lstPtr: ListNode<CTPInterval> | null;
  computeRangeValues(st: number, et: number, values: IRangeValues): void;
  computeDurationBackward(
    st: number,
    et: number,
    d: CTPDuration,
    t: number,
  ): boolean;
  computeDurationForward(
    st: number,
    et: number,
    d: CTPDuration,
    t: number,
  ): boolean;
  get rangeValues(): CTPRangeValues;
}

export class CTPRange extends CTPInterval implements IRangeTime {
  estPtr: ListNode<CTPInterval> | null = null;
  lstPtr: ListNode<CTPInterval> | null = null;
  overallDuration: number = 0;
  overallRunQty: number = 0;
  minDuration: number = -1;
  minRunRate: number = -1;
  public values: CTPRangeValues;

  processed: boolean = false;
  public valid: boolean = false;

  constructor(
    eptr: ListNode<CTPInterval> | null,
    lptr: ListNode<CTPInterval> | null,
    qty: number | null,
    duration: number | null,
    runRate?: number | null,
  ) {
    super();
    this.estPtr = null;
    this.lstPtr = null;
    this.overallRunQty = 0;
    if (eptr && lptr && qty !== null && duration !== null)
      this.setRange(eptr, lptr, qty, duration, runRate);
    else if (eptr && lptr && qty !== null)
      this.setRange(eptr, lptr, qty, 0, runRate);
    this.processed = false;
    this.values = new CTPRangeValues();
  }

  public setRange(
    eptr: ListNode<CTPInterval>,
    lptr: ListNode<CTPInterval>,
    qty: number,
    duration: number,
    runRate?: number | null,
  ): void {
    this.estPtr = eptr;
    this.lstPtr = lptr;
    this.qty = qty;
    if (eptr) this.startW = eptr.data.startW;
    if (lptr) this.endW = lptr.data.endW;
    this.overallDuration = duration;
    this.overallRunQty = 0;
    if (runRate) this.overallRunQty = runRate;
    if (duration < this.minDuration || this.minDuration === -1)
      this.minDuration = duration;
    if ((runRate && runRate < this.minRunRate) || this.minRunRate === -1)
      this.minRunRate = runRate || 0;
  }

  public setLRange(
    eptr: ListNode<CTPInterval>,
    duration: number,
    runRate?: number | null,
  ): void {
    this.lstPtr = eptr;
    if (eptr) this.endW = this.lstPtr.data.endW;
    this.overallDuration += duration;
    if (runRate) this.overallRunQty += runRate;
    if (duration < this.minDuration || this.minDuration === -1)
      this.minDuration = duration;
    if ((runRate && runRate < this.minRunRate) || this.minRunRate === -1)
      this.minRunRate = runRate || 0;
  }
  public minimumRunRate(): number {
    return this.minRunRate;
  }
  public minimumDuration(): number {
    return this.minDuration;
  }
  public override duration(): number {
    return this.overallDuration;
  }

  public override runRateQty(): number {
    return this.overallRunQty;
  }
  public get rangeValues(): CTPRangeValues {
    return this.values;
  }

  private static _policy = new DurationPolicy();

  protected computeBoundedDuration(
    st: number,
    et: number,
    ptr: CTPInterval,
    useRunRate: boolean = false,
  ) {
    return clipDuration(ptr, this.startW, this.endW, useRunRate);
  }

  public computeDurationForward(
    st: number,
    et: number,
    d: CTPDuration,
  ): boolean {
    const policy = CTPRange._policy;

    // Set initial values (always, even before early returns)
    this.values.eet = st + d.duration();
    this.values.est = st;

    // RunRate required but missing → infeasible
    if (policy.isMissingRunRate(d)) return false;

    // STATIC: no interval walking, just boundary check
    if (policy.isStatic(d)) {
      if (this.values.eet > et) return false;
      return true;
    }

    // Delegate to IntervalWalker
    const result = walkForward(
      this.estPtr,
      this.lstPtr,
      policy.consumed(d),
      this.startW,
      this.endW,
      policy.byRunRate(d),
      policy.isFixed(d),
    );
    this.values.est = result.start;
    this.values.eet = result.end;
    return result.feasible;
  }

  public computeDurationBackward(
    st: number,
    et: number,
    d: CTPDuration,
  ): boolean {
    const policy = CTPRange._policy;

    // Set initial values (always, even before early returns)
    this.values.lst = et - d.duration();
    this.values.lett = et;

    // RunRate required but missing → infeasible
    if (policy.isMissingRunRate(d)) return false;

    // STATIC: no interval walking, just boundary check
    if (policy.isStatic(d)) {
      if (this.values.lst < st) return false;
      return true;
    }

    // Delegate to IntervalWalker
    const result = walkBackward(
      this.lstPtr,
      this.estPtr,
      policy.consumed(d),
      this.startW,
      this.endW,
      policy.byRunRate(d),
      policy.isFixed(d),
    );
    this.values.lst = result.start;
    this.values.lett = result.end;
    return result.feasible;
  }

  public computeEarliestLatestStartTimes(
    st: number,
    et: number,
    d: number,
    t: number,
  ): CTPRangeValues {
    return this.rangeValues;
  }

  public computeRangeValues(st: number, et: number): CTPRangeValues {
    const acc = accumulateRangeValues(this.estPtr, this.lstPtr, st, et);
    this.values.duration = acc.duration;
    this.values.runRateQty = acc.runRateQty;
    this.values.minAvail = acc.minAvail;
    this.values.maxAvail = acc.maxAvail;
    return this.rangeValues;
  }

  public override debug(showdates: boolean = true) {
    let str = "";

    if (this.estPtr && this.lstPtr) {
      if (showdates)
        str =
          this.estPtr.data.AbsoluteStartTime.toFormat(
            "ccc LLL dd yyyy HH:mm:ss ",
          ) +
          " - " +
          this.lstPtr.data.AbsoluteEndTime.toFormat(
            "ccc LLL dd yyyy HH:mm:ss ",
          ) +
          " - " +
          this.qty +
          " " +
          this.overallDuration / CTPDateTime.ONE_HOUR;
      else
        str =
          this.estPtr.data.startW +
          " - " +
          this.lstPtr.data.endW +
          " - " +
          this.qty +
          " " +
          this.overallDuration / CTPDateTime.ONE_HOUR;
      console.log(str);
    } else console.log(" NULL DATES ");
  }
}
