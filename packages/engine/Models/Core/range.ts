"strict";
import { DateTime, Interval } from "luxon";
import { CTPDateTime } from "./date";
import { CTPDurationConstants } from "../Core/constants";
import { IInterval, CTPInterval, CTPDuration } from "../Core/window";
import { LinkedList, ListNode } from "../Core/linklist";
import { CTPAvailable } from "../Intervals/intervals";

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

  protected computeBoundedDuration(
    st: number,
    et: number,
    ptr: CTPInterval,
    useRunRate: boolean = false,
  ) {
    let d = 0;

    if (ptr) {
      d = ptr.duration();
      if (ptr.endW > this.endW) d -= ptr.endW - this.endW;
      if (ptr.startW < this.startW) d -= this.startW - ptr.startW;
    }

    if (useRunRate) {
      if (ptr.runRate === null) d = 0;
      else d = d * ptr.runRate;
    }
    return d;
  }

  public computeDurationForward(
    st: number,
    et: number,
    d: CTPDuration,
  ): boolean {
    // Set Earliest End Time
    this.values.eet = st + d.duration();
    this.values.est = st;

    // How muhc duration
    let consumed = d.duration();
    let byRunRate = false;

    if (
      d.durationType == CTPDurationConstants.FIXED_RUN_RATE ||
      d.durationType == CTPDurationConstants.FLOAT_RUN_RATE
    ) {
      if (d.runRate === null) return false;
      else consumed = d.runRate;
      byRunRate = true;
    }

    // amount of duration so far
    let more = 0;

    let ptr = this.estPtr;

    // Reset if fixed duration and range duration < fixed duration
    let reset = false;

    // If STATIC Duration and eetgreater than window end return false else return true
    if (d.durationType == CTPDurationConstants.STATIC) {
      if (this.values.eet > et) return false;
      return true;
    }

    // Reset eet and est to first ptr
    if (ptr) {
      this.values.eet = ptr.data.endW;
      this.values.est = ptr.data.startW;
    }

    while (ptr && ptr !== this.lstPtr?.next) {
      while (more < consumed && ptr && ptr != this.lstPtr?.next) {
        if (reset) {
          this.values.eet = ptr.data.endW;
          this.values.est = ptr.data.startW;
          more = 0;
        }
        reset = false;

        let dur = this.computeBoundedDuration(st, et, ptr.data, byRunRate);

        if (
          d.durationType === CTPDurationConstants.FIXED_DURATION ||
          d.durationType == CTPDurationConstants.FIXED_RUN_RATE
        ) {
          if (dur < consumed) reset = true;
        }
        if (!reset) {
          more += dur;
          this.values.eet = ptr.data.endW;
        }

        ptr = ptr?.next;
      }
      if (more >= consumed && this.values.eet) {
        if (more > consumed) this.values.eet -= more - consumed;
        break;
      }
    }
    return more >= consumed;
  }

  public computeDurationBackward(
    st: number,
    et: number,
    d: CTPDuration,
  ): boolean {
    // Set Earliest End Time
    this.values.lst = et - d.duration();
    this.values.lett = et;

    // How muhc duration
    let consumed = d.duration();
    let byRunRate = false;

    if (
      d.durationType == CTPDurationConstants.FIXED_RUN_RATE ||
      d.durationType == CTPDurationConstants.FLOAT_RUN_RATE
    ) {
      if (d.runRate === null) return false;
      else consumed = d.runRate;
      byRunRate = true;
    }

    // amount of duration so far
    let more = 0;

    let ptr = this.lstPtr;

    // Reset if fixed duration and range duration < fixed duration
    let reset = false;

    // If STATIC Duration and eetgreater than window end return false else return true
    if (d.durationType == CTPDurationConstants.STATIC) {
      if (this.values.lst < st) return false;
      return true;
    }

    // Reset lst and lett to first ptr
    if (ptr) {
      this.values.lett = ptr.data.endW;
      this.values.lst = ptr.data.startW;
    }

    while (ptr && ptr !== this.estPtr?.prev) {
      while (more < consumed && ptr && ptr != this.estPtr?.prev) {
        if (reset) {
          this.values.lst = ptr.data.startW;
          this.values.lett = ptr.data.endW;
          more = 0;
        }
        reset = false;
        let dur = this.computeBoundedDuration(st, et, ptr.data, byRunRate);

        if (
          d.durationType === CTPDurationConstants.FIXED_DURATION ||
          d.durationType == CTPDurationConstants.FIXED_RUN_RATE
        ) {
          if (dur < consumed) reset = true;
        }
        if (!reset) {
          more += dur;
          this.values.lst = ptr.data.startW;
        }

        ptr = ptr?.prev;
      }
      if (more >= consumed && this.values.lst) {
        if (more > consumed) this.values.lst += more - consumed;
        break;
      }
    }
    return more >= consumed;
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
    this.values.minAvail = Number.MAX_VALUE;
    this.values.maxAvail = 0;
    this.values.runRateQty = 0;
    this.values.duration = 0;

    let ePtr = this.estPtr;
    while (ePtr && ePtr !== this.lstPtr) {
      if (et < ePtr.data.startW) {
      } else if (st > ePtr.data.endW) {
      } else {
        if (ePtr.data.qty && ePtr.data.qty > this.values.maxAvail)
          this.values.maxAvail = ePtr.data.qty;
        if (ePtr.data.qty && ePtr.data.qty < this.values.minAvail)
          this.values.minAvail = ePtr.data.qty;
        if (st > ePtr.data.startW) {
          this.values.duration += ePtr.data.endW - st;
          if (ePtr.data.runRate)
            this.values.runRateQty += (ePtr.data.endW - st) * ePtr.data.runRate;
        } else if (et < ePtr.data.endW) {
          this.values.duration += et - ePtr.data.startW;
          if (ePtr.data.runRate)
            this.values.runRateQty +=
              (et - ePtr.data.startW) * ePtr.data.runRate;
        } else {
          this.values.duration += ePtr.data.duration();
          if (ePtr.data.runRate)
            this.values.runRateQty += ePtr.data.duration() * ePtr.data.runRate;
        }
      }
      ePtr = ePtr.next;
    }
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
