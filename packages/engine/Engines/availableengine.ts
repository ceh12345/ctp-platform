"strict";
import {
  CTPAssignmentConstants,
  CTPDurationConstants,
  CTPTaskTypeConstants,
} from "../Models/Core/constants";
import { CTPInterval } from "../Models/Core/window";
import {
  CTPAssignments,
  CTPAvailable,
  CTPIntervals,
  CTPAvailableTimes,
} from "../Models/Intervals/intervals";
import { CTPRange } from "../Models/Core/range";
import { AvailableMatrix } from "../Models/Intervals/availablematrix";
import { LinkedList, ListNode } from "../Models/Core/linklist";
import { CTPBaseEngine, IBaseEngine } from "./baseengine";
import { CTPAppSettings, IAppSettings } from "../Models/Entities/appsettings";
import { theSetEngines } from "./engines";
import { List } from "../Models/Core/list";
import { CTPTasks } from "../Models/Entities/task";
import { CTPStateChangeInterval } from "../Models/Entities/statechange";
import { SchedulingLandscape } from "../Models/Entities/landscape";

interface IAvailableEngine extends IBaseEngine {
  recalculate(
    a?: AvailableMatrix,
    landscape?: SchedulingLandscape,
    ap?: IAppSettings,
  ): boolean;
  recomputeAvailable(a: CTPAvailable, b: CTPAssignments): CTPIntervals | null;

  // Given A and B. Interset A with B. Maintian A.qty value
  mergeAvailable(a: CTPAvailable, b: CTPAvailable): CTPAvailable | null;
  mergeAvailables(list: List<CTPAvailable>): CTPAvailable | null;
}

export class CTPAvailableEngine
  extends CTPBaseEngine
  implements IAvailableEngine
{
  public matrix: AvailableMatrix | null = null;

  protected init(): boolean {
    if (!this.matrix || !this.landscape) return false;
    this.matrix.clear();

    return true;
  }

  // Loop across assignments and add change over intervals prev.end - current.start
  protected addToStateChange(): void {
    this.matrix?.stateChanges?.clear();
    if (!this.matrix?.staticAssignments) return;
    if (!this.landscape) return;

    let aPtr = this.matrix?.staticAssignments.head;
    let lastProcessPtr = null;
    // Keep taks of usage and usage duration for scoring later
    let usage = 0;
    let taskDuration = 0;
    let coUsage = 0;
    let duration = 0;
    let prevProcess = "";
    let currProcess = "";

    while (aPtr) {
      if (aPtr.data && aPtr.data.type == CTPAssignmentConstants.PROCESS) {
        usage += 1;
        taskDuration += aPtr.data.duration();
      } else if (
        aPtr.data &&
        aPtr.data.subType == CTPAssignmentConstants.CHANGE_OVER
      ) {
        coUsage += 1;
        if (this.appSettings && this.appSettings.resetUageAfterProcessChange) {
          usage = 0;
          taskDuration = 0;
        }
      }
      else if (
        aPtr.data &&
        aPtr.data.type == CTPAssignmentConstants.UNAVAILABLE 
        && aPtr.data.subType == CTPAssignmentConstants.OVER_USAGE
      ) 
      {
        usage = 0;
        taskDuration = 0;
      }

      if (
        aPtr &&
        lastProcessPtr &&
        aPtr.data.startW > lastProcessPtr.data.endW &&
        aPtr.data.name &&
        lastProcessPtr.data.name &&
        lastProcessPtr.data.type == CTPAssignmentConstants.PROCESS
      ) {
        const task = this.landscape.tasks.getEntity(aPtr.data.name);
        const prevTask = this.landscape.tasks.getEntity(
          lastProcessPtr.data.name,
        );
        if (task) {
          prevProcess = (prevTask && prevTask.process) ? prevTask.process : "";      
          currProcess = (task && task.process) ? task.process : "";

          const co = new CTPStateChangeInterval(
            lastProcessPtr.data.endW,
            aPtr.data.startW,
            prevProcess,
            currProcess,
          );
          co.runtimeCounter = taskDuration;
          co.taskCounter = usage;
          co.stateChangeCounter = coUsage;
          this.matrix.stateChanges?.add(co);
        }
      }

      // End of assignment. Add one final change over from last assingment to end of horizon
      if (aPtr && aPtr.next === null) {
        if (
          lastProcessPtr &&
          lastProcessPtr.data.name &&
          lastProcessPtr.data.endW < this.landscape.horizon.endW
        ) {
          const task = this.landscape.tasks.getEntity(lastProcessPtr.data.name);
          if (task && task.type == CTPTaskTypeConstants.PROCESS) {
            prevProcess = (task && task.process) ? task.process : "";
            currProcess = "";
            const co = new CTPStateChangeInterval(
              lastProcessPtr.data.endW,
              this.landscape.horizon.endW,
              prevProcess,
              currProcess,
            );
            co.runtimeCounter = taskDuration;
            co.taskCounter = usage;
            co.stateChangeCounter = coUsage;
            this.matrix.stateChanges?.add(co);
          }
        }
      }

      if (aPtr.data && aPtr.data.type == CTPAssignmentConstants.PROCESS)
        lastProcessPtr = aPtr;
      aPtr = aPtr.next;
    }
  }
  protected addToFixed(): void {
    if (!this.aPtr || !this.matrix) return;

    if (this.aPtr.data.qty && this.aPtr.data.qty > 0) {
      // add aPtr to fixed , runrate,
      let list = this.matrix.index(CTPDurationConstants.FIXED_DURATION);
      let rr = 0;
      if (this.aPtr?.data?.runRate) {
        rr = this.aPtr.data.duration() * this.aPtr.data.runRate;
      }

      list?.add(
        new CTPRange(
          this.aPtr,
          this.aPtr,
          this.aPtr?.data?.qty,
          this.aPtr?.data?.duration(),
          rr,
        ),
      );
    }
  }
  protected addToFloat(): void {
    if (!this.aPtr || !this.bPtr || !this.matrix) return;
    let list = this.matrix.index(CTPDurationConstants.FLOAT_DURATION);
    if (!list) return;

    var ranges: CTPRange[] = [];

    let r = null;

    this.cPtr = this.aPtr;
    let newRange = false;
    let firstTime = true;

    let flowAround = this.flowAround();

    let found = false;
    while (this.cPtr && this.cPtr != this.bPtr.next) {
      found = false;
      firstTime = true;

      if (this.cPtr.data.qty != null && this.cPtr.data.qty > 0) {
        // Find Qty Ranges where current segment qty >= range qty
        for (let a of ranges) {
          if (a.qty == this.cPtr.data.qty) {
            found = true;
            break;
          }
        }

        // If not Found
        if (!found) {
          r = new CTPRange(this.cPtr, this.cPtr, this.cPtr.data.qty, 0, 0);
          //console.debug('Processing new Qty ' + this.cPtr.data.qty);
          ranges.push(r);
        }
        if (r && !r.processed) {
          let qty = this.cPtr.data.qty;

          this.dPtr = this.aPtr;
          // During loop of A to B
          // may require a new range to be added
          // when a qty is less than range qty

          newRange = false;
          while (
            this.dPtr &&
            this.dPtr.data.qty !== null &&
            this.dPtr != this.bPtr.next &&
            r
          ) {
            if (r.qty !== null && this.dPtr.data.qty >= r.qty) {
              // FLow Around here. A flow around means only one range per qty
              if (newRange) {
                r = new CTPRange(
                  this.dPtr,
                  this.dPtr,
                  r.qty,
                  this.dPtr.data.duration(),
                  this.dPtr.data.runRate
                    ? this.dPtr.data.runRate * this.dPtr.data.duration()
                    : 0,
                );
                r.processed = true;
                ranges.push(r);
                //console.debug('New Range ');
              }
              if (r.qty !== null) qty = r.qty;

              //if (firstTime) console.debug('New Range First Time');
              if (firstTime)
                r.setRange(
                  this.dPtr,
                  this.dPtr,
                  qty,
                  this.dPtr.data.duration(),
                  this.dPtr.data.runRate
                    ? this.dPtr.data.runRate * this.dPtr.data.duration()
                    : 0,
                );
              else
                r.setLRange(
                  this.dPtr,
                  this.dPtr.data.duration(),
                  this.dPtr.data.runRate
                    ? this.dPtr.data.runRate * this.dPtr.data.duration()
                    : 0,
                );

              r.processed = true;
              newRange = false;
              firstTime = false;

              //this.dPtr.data.debug(true);
            } else {
              // New Range to start because a qty from A to B is less than current qty
              // If flowaround only one range per Qty
              newRange = r.processed && !flowAround;
            }
            this.dPtr = this.dPtr.next;
          }
          r.processed = true;
        }
      }

      this.cPtr = this.cPtr.next;
    }

    //console.log("Add to FLoat");
    ranges.forEach(function (n) {
      list?.add(n);
      //n.debug();
    });
  }
  protected addToFloat1(): void {
    if (!this.aPtr || !this.bPtr || !this.matrix) return;

    let q = 0;
    let rr = 0;
    let cumD = 0;
    let minQty = 0;

    // Set C to B which is at or behind A
    this.cPtr = this.bPtr;

    if (this.cPtr && this.cPtr.data.qty) minQty = this.cPtr.data.qty;
    // while C has not reached A yet
    while (this.cPtr && this.cPtr != this.aPtr) {
      // This is where you would add in flowaround
      // if prev qty <> current qty write out float from c to b
      cumD = cumD + this.cPtr.data.duration();
      if (
        this.cPtr.prev &&
        this.cPtr.prev.data.qty !== null &&
        this.cPtr.data.qty !== null &&
        this.cPtr.prev.data.qty != this.cPtr.data.qty
      ) {
        let list = this.matrix.index(CTPDurationConstants.FLOAT_DURATION);
        list?.add(new CTPRange(this.cPtr, this.bPtr, this.bPtr.data.qty, cumD));
        cumD = 0;
        // move C only if prev qty <= current C
        if (
          this.cPtr.data.qty !== null &&
          this.cPtr.prev.data.qty > 0 &&
          this.cPtr.prev.data.qty <= minQty // this.cPtr.data.qty
        ) {
          this.moveCBackward();
        } else {
          this.moveCBackward();
          this.bPtr = this.cPtr;
          minQty = 0;
          if (this.cPtr && this.cPtr.data.qty) minQty = this.cPtr.data.qty;
        }
      } else {
        this.moveCBackward();
        if (this.cPtr && this.cPtr.data.qty !== null && this.cPtr.data.qty <= 0) {
          this.bPtr = this.cPtr;
          minQty = 0;
        }
      }
    }

    if (this.cPtr) {
      // Match aPtr
      cumD += this.cPtr.data.duration();
      let list = this.matrix.index(CTPDurationConstants.FLOAT_DURATION);
      list?.add(new CTPRange(this.cPtr, this.bPtr, this.bPtr.data.qty, cumD));
    }

    cumD = 0;
    this.cPtr = this.bPtr;
    while (this.bPtr && this.cPtr && this.cPtr != this.aPtr) {
      cumD = cumD + this.cPtr.data.duration();
      if (
        this.cPtr.prev &&
        this.cPtr.prev.data.runRate &&
        this.cPtr.prev.data.runRate != this.cPtr.data.runRate
      ) {
        if (
          this.cPtr.data.runRate !== null &&
          this.cPtr.prev.data.runRate <= this.cPtr.data.runRate
        )
          this.moveCBackward();
        else {
          this.moveCBackward();
          this.bPtr = this.cPtr;
        }
      } else {
        this.moveCBackward();
      }
    }
  }

  protected addToUntracked(): void {
    if (!this.aPtr || !this.matrix) return;
    // add aPtr to untracked
    let list = this.matrix.index(CTPDurationConstants.UNTRACKED);
    list?.add(
      new CTPRange(
        this.aPtr,
        this.aPtr,
        this.aPtr?.data?.qty,
        this.aPtr?.data?.duration(),
        999999999,
      ),
    );
  }

  // if (flowaround and Aptr.prev npve A to A prev)
  // else add Range A to B. Move A. Set B to A

  protected processPtrs(): void {
    if (!this.aPtr) return;

    if (this.aPtr && this.aPtr.data.qty !== null) {
      this.addToFixed();
      this.addToUntracked();
    }

    let flowAround = this.flowAround();

    // Here is where you can do flow acround
    if (
      this.aPtr.prev &&
      this.aPtr &&
      this.aPtr.data.qty !== null &&
      (this.aPtr.data.qty > 0 || flowAround) // FLow Around here ignore qty.
    )
      this.moveABackward();
    else {
      this.addToFloat();
      this.moveABackward();
      this.bPtr = this.aPtr;
    }
  }
  // set Aptr to tail. set BPtr to Aptr;
  protected initPtrs() {
    this.aPtr = null;
    this.bPtr = null;
    if (this.matrix?.staticAvailable) {
      this.aPtr = this.matrix?.staticAvailable.tail;
      this.bPtr = this.aPtr;
      this.cPtr = this.bPtr;
      this.head = this.matrix?.staticAvailable.head;
    }
  }
  protected calculate(): boolean {
    this.initPtrs();
    while (this.aPtr) this.processPtrs();
    if (this.matrix) this.matrix.recalc = false;
    return true;
  }

  public setLists(a: AvailableMatrix) {
    this.matrix = a;
  }

  // Add RunRates if exist in original
  addRunRates(): void {
    if (this.matrix?.staticOriginal && this.matrix.staticAvailable) {
      let i = this.matrix?.staticOriginal.head;
      let j = this.matrix.staticAvailable.head;

      if (i && i.data.runRate !== null) {
        while (i && j) {
          while (i && i.data.startW < j.data.startW) i = i?.next;
          if (i && i.data.startW <= j.data.endW) j.data.runRate = i.data.runRate;
          j = j.next;
        }
      }
    }
  }

  protected addFlowAround(a: CTPAvailable | null, b: CTPAssignments): void {
    if (a && b) {
    }
  }

  // Recompute Available from Origianal
  protected computeAvailable(): boolean {
    if (this.matrix && this.matrix.staticOriginal) {
      if (this.matrix.staticAvailable) this.matrix.staticAvailable.clear();

      if (this.matrix.staticAssignments)
        this.matrix.staticAvailable = theSetEngines.subtractEngine.execute(
          this.matrix.staticOriginal,
          this.matrix.staticAssignments,
        );
      else {
        this.matrix.staticAvailable = new CTPIntervals();
        this.matrix.staticAvailable.copy(this.matrix.staticOriginal);
      }
      this.matrix.recompute = false;

      this.addRunRates();
    }
    return true;
  }

  public recalculate(
    a?: AvailableMatrix,
    l?: SchedulingLandscape,
    ap?: IAppSettings,
  ): boolean {
    if (a) this.setLists(a);
    if (ap) this.setSettings(ap);
    if (l) this.setLandscape(l);
    let rc = this.init();
    if (rc) {
      this.computeAvailable();
      this.calculate();
      this.addToStateChange();
    }
    return true;
  }

  public recomputeAvailable(
    a: CTPAvailable,
    b: CTPAssignments,
  ): CTPIntervals | null {
    var results: CTPAvailable | null = null;

    if (a && b) {
      results = theSetEngines.subtractEngine.execute(a, b);
    }

    return results;
  }

  // Given A and B. Interset A and B. Maintian A.qty value
  public mergeAvailable(a: CTPAvailable, b: CTPAvailable): CTPAvailable | null {
    var results: CTPAvailable | null = null;

    if (a && b) results = theSetEngines.intersectEngine.execute(a, b);

    return results;
  }

  public mergeAvailables(list: List<CTPAvailable>): CTPAvailable | null {
    var results: CTPAvailable | null = null;
    var intermediateResult: CTPAvailable | null | undefined = null;

    let c = 0;

    // must have atleast 2 to merge

    if (!list) return results;

    list.forEach(function (avail) {
      // First list set intermediate else intersect
      if (c == 0 && list.index(0) !== undefined)
        intermediateResult = list.index(0);
      else if (intermediateResult && intermediateResult.size() >= 1) {
        results = theSetEngines.intersectEngine.execute(
          list.index(c),
          intermediateResult,
        );
        intermediateResult = results;
      }
      c = c + 1;
    });

    return results;
  }

  constructor() {
    super();
    this.matrix = null;
  }
}
