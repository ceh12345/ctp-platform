"strict";
import { CTPDurationConstants } from "../Models/Core/constants";
import { CTPInterval, CTPDuration } from "../Models/Core/window";
import {
  CTPAssignments,
  CTPAvailable,
  CTPIntervals,
  CTPAvailableTimes,
  CPTStartTimes,
  CTPRangeWindows,
} from "../Models/Intervals/intervals";
import { CTPRange, CTPRangeValues } from "../Models/Core/range";
import { AvailableMatrix } from "../Models/Intervals/availablematrix";
import { LinkedList, ListNode } from "../Models/Core/linklist";
import { List } from "../Models/Core/list";
import { CTPBaseEngine, IBaseEngine } from "./baseengine";
import { CTPAppSettings, IAppSettings } from "../Models/Entities/appsettings";
import { theEngines } from "./engines";

import { CTPTasks } from "../Models/Entities/task";
import { SchedulingLandscape } from "../Models/Entities/landscape";

interface IStartTimeEngine extends IBaseEngine {
  setLists(
    s: number,
    e: number,
    d: CTPInterval,
    a: AvailableMatrix,
    l: SchedulingLandscape,
  ): void;
  computeStartTimes(
    s?: number,
    e?: number,
    d?: CTPDuration,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPIntervals | null;

  computeFeasibleWindows(
    s?: number,
    e?: number,
    d?: CTPDuration,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPRangeWindows | null;
}
export class CTPStartTimeEngine
  extends CTPBaseEngine
  implements IStartTimeEngine
{
  public matrix: AvailableMatrix | null = null;
  public duration: CTPDuration | null = null;

  protected availStartTimes: CTPAvailableTimes | null = null;

  // all valid
  protected valid: boolean = false;

  protected debug: CTPInterval = new CTPInterval();

  protected assertLists(): boolean {
    if (!this.matrix) return false;
    if (!this.duration) return false;
    if (this.endW - this.startW <= 0) return false;

    return true;
  }

  public setLists(
    s: number,
    e: number,
    d: CTPDuration,
    a: AvailableMatrix,
    l: SchedulingLandscape,
  ): void {
    this.duration = d;
    this.matrix = a;
    this.setHorizon(s, e);
    this.landscape = l;
  }

  protected init(): boolean {
    if (this.matrix && this.landscape && this.matrix.recalc) {
      let a = this.appSettings || undefined;
      theEngines.availableEngine.recalculate(this.matrix, this.landscape);
    }

    return true;
  }

  protected feasibleStartTimes(): CTPIntervals {
    let st = 0;
    let et = 0;

    var results = new CTPIntervals();
    if (this.valid && this.availStartTimes) {
      this.aRangePtr = this.availStartTimes.head;
      while (this.aRangePtr) {
        if (this.aRangePtr.data.valid && this.aRangePtr.data.rangeValues) {
          let iPtr = this.aRangePtr.data.estPtr;
          let ranges = this.aRangePtr.data.rangeValues;

          while (iPtr && iPtr != this.aRangePtr.data.lstPtr?.next) {
            st = iPtr.data.startW;
            et = iPtr.data.endW;

            //console.log("Range to Add");
            //this.aRangePtr.data.debug();

            if (st <= ranges.lst) {
              if (st < ranges.est) st = ranges.est;
              if (et > this.endW) et = this.endW;
              if (et > ranges.lst) et = ranges.lst;

              theEngines.unionEngine.union(results, new CTPInterval(st, et));
            }
            iPtr = iPtr.next;
          }
        }
        this.aRangePtr = this.aRangePtr.next;
      }
    }
    return results;
  }

  protected feasibleWindows(): CTPRangeWindows {
    var results = new CTPRangeWindows();
    if (this.valid && this.availStartTimes) {
      this.aRangePtr = this.availStartTimes.head;
      while (this.aRangePtr) {
        if (this.aRangePtr.data.valid && this.aRangePtr.data.rangeValues) {
          let iPtr = this.aRangePtr.data.estPtr;
          let ranges = this.aRangePtr.data.rangeValues;
          results.insertAtEnd(
            new CTPRangeValues(ranges.est, ranges.eet, ranges.lst, ranges.lett),
          );
        }
        this.aRangePtr = this.aRangePtr.next;
      }
    }
    return results;
  }

  protected computeEarliestStartLatestEndTime(list: CTPAvailableTimes): void {
    if (this.availStartTimes && list && this.duration) {
      this.aRangePtr = this.availStartTimes.head;
      let rc = true;
      let firsttime = true;
      this.valid = false;
      while (this.aRangePtr) {
        //console.log("TRYING RANGE");
        //this.aRangePtr.data.debug();
        this.aRangePtr.data.valid = false;
        rc = this.aRangePtr.data.computeDurationForward(
          this.startW,
          this.endW,
          this.duration,
        );
        if (rc)
          rc = this.aRangePtr.data.computeDurationBackward(
            this.startW,
            this.endW,
            this.duration,
          );
        if (rc) {
          let rangeValues = this.aRangePtr.data.rangeValues;
          this.aRangePtr.data.valid = true;
          this.valid = true;
          if (rangeValues) {
            this.debug.startW = rangeValues.est;
            this.debug.endW = rangeValues.lst;
            firsttime = false;
          }
        }
        this.aRangePtr = this.aRangePtr.next;
      }
    }
  }

  protected findAllTimes(list: CTPAvailableTimes) {
    this.aRangePtr = list.head;

    this.availStartTimes = new CTPAvailableTimes();
    this.bRangePtr = this.aRangePtr;

    let qty = 0;
    if (this.duration?.qty) qty = this.duration.qty;
    let rr = 0;
    if (this.duration?.runRate) rr = this.duration.runRate;

    while (this.bRangePtr) {
      let rangeDur = this.bRangePtr.data.duration();
      // Use mimimum DUration of Range for a FIXED
      if (list.type == CTPDurationConstants.FIXED_DURATION)
        rangeDur = this.bRangePtr.data.minimumDuration();

      // Filtethis.bRangePtr.data.r out ranges outside the horizon
      if (
        (this.bRangePtr.data && this.bRangePtr.data.endW < this.startW) ||
        (this.bRangePtr.data && this.bRangePtr.data.startW > this.endW)
      ) {
        // nop op
      } else if (
        this.bRangePtr.data.qty &&
        this.duration?.qty &&
        this.bRangePtr.data.qty >= qty &&
        rangeDur >= this.duration.duration() &&
        this.bRangePtr.data.runRateQty() >= rr
      ) {
        this.availStartTimes.insertAtEnd(this.bRangePtr.data);
      }

      this.bRangePtr = this.bRangePtr.next;
    }
  }

  protected findStartTimes(): boolean {
    if (!this.duration) return false;

    let list = null;

    if (
      this.duration.durationType === CTPDurationConstants.FIXED_DURATION ||
      this.duration.durationType === CTPDurationConstants.FIXED_RUN_RATE
    )
      list = this.matrix?.index(CTPDurationConstants.FIXED_DURATION);
    else if (this.duration.durationType === CTPDurationConstants.UNTRACKED)
      list = this.matrix?.index(CTPDurationConstants.UNTRACKED);
    else if (this.duration.durationType === CTPDurationConstants.STATIC)
      list = this.matrix?.index(CTPDurationConstants.UNTRACKED);
    else list = this.matrix?.index(CTPDurationConstants.FLOAT_DURATION);

    if (!list) return false;
    //console.log("AVAIALBLE: " + this.duration.durationType);
    //list.debug();

    this.findAllTimes(list);
    this.computeEarliestStartLatestEndTime(list);

    return true;
  }

  public computeStartTimes(
    s?: number,
    e?: number,
    d?: CTPDuration,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPIntervals | null {
    if (s !== undefined && e !== undefined && a && d && l) this.setLists(s, e, d, a, l);

    let rc = this.assertLists();
    var startTimes: CTPIntervals | null = null;
    if (rc) {
      this.init();
      if (this.findStartTimes()) startTimes = this.feasibleStartTimes();
    }

    return startTimes;
  }

  public computeFeasibleWindows(
    s?: number,
    e?: number,
    d?: CTPDuration,
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
  ): CTPRangeWindows | null {
    if (s !== undefined && e !== undefined && a && d && l) this.setLists(s, e, d, a, l);

    let rc = this.assertLists();
    var startTimes: CTPRangeWindows | null = null;
    if (rc) {
      this.init();
      if (this.findStartTimes()) startTimes = this.feasibleWindows();
    }

    return startTimes;
  }
}
