"strict";
import { LinkedList, ListNode } from "../Core/linklist";
import { CTPInterval } from "../Core/window";
import { CTPRange, CTPRangeValues } from "../Core/range";
import { CTPIntervalConstants } from "../Core/constants";

export class CTPIntervals extends LinkedList<CTPInterval> {
  public intervalType: number = CTPIntervalConstants.REUSABLE;

  public endOfHorizon: number = 0;
  public startOfHorizon: number = 0;

  public name: string;

  public constructor(it: number = CTPIntervalConstants.REUSABLE) {
    super();
    this.intervalType = it;
    this.name = "";
  }

  // Find Node where startime < node
  public atOrAfterStartTime(
    startW: number,
    endW: number,
  ): ListNode<CTPInterval> | null {
    if (this.tail && startW > this.tail.data.endW) return null;

    let i = this.head;
    if (i) while (i && i.data.startW < startW) i = i.next;
    if (i && startW == i.data.startW) {
      while (i && startW == i.data.startW && endW > i.data.endW) {
        i = i.next;
      }
    }
    return i;
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
      if (ptr.endW > et) d -= ptr.endW - et;
      if (ptr.startW < st) d -= st - ptr.startW;
    }
    if (useRunRate) {
      if (ptr.runRate === null) d = 0;
      else d = d * ptr.runRate;
    }
    return d;
  }

  public findEndTime(
    startW: number,
    duration: number,
    node: ListNode<CTPInterval>,
    t: number,
  ): number {
    let et = startW;

    var b: ListNode<CTPInterval> | null = node;

    let consumed = 0;
    if (node) {
      b = node;
      while (b && consumed < duration) {
        if (b.data.duration() + consumed < duration) {
          et = b.data.endW;
          consumed += b.data.duration();
        } else {
          et = b.data.startW + (duration - consumed);
          consumed = duration;
        }
        b = b.next;
      }
    }

    return et;
  }

  public findStartTime(
    startW: number,
    duration: number,
    node: ListNode<CTPInterval>,
    t: number,
  ): number {
    let et = startW;

    var b: ListNode<CTPInterval> | null = node;

    let consumed = 0;
    if (node) {
      b = node;
      while (b && consumed < duration) {
        if (b.data.duration() + consumed < duration) {
          et = b.data.startW;
          consumed += b.data.duration();
        } else {
          et = b.data.endW - (duration - consumed);
          consumed = duration;
        }
        b = b.prev;
      }
    }

    return et;
  }

  public closestToEndTime(
    startW: number,
    endW: number,
  ): ListNode<CTPInterval> | null {
    if (this.tail && endW >= this.tail.data.endW) return this.tail;

    let i = this.tail;
    if (i) while (i && endW < i.data.startW) i = i.prev;

    return i;
  }

  public atStartTime(startW: number): ListNode<CTPInterval> | null {
    if (this.head && startW < this.head.data.startW) return this.head;

    let i = this.head;
    if (i) while (i && startW < i.data.startW) i = i.next;

    return i;
  }

  public remove(node: ListNode<CTPInterval> | null): void {
    this.deleteNode(node);
    this.resetMiddle();
  }

  // Insert in start time order
  public add(node: CTPInterval): void {
    let i = this.atOrAfterStartTime(node.startW, node.endW);

    if (i) this.insertBefore(node, i);
    else this.insertAtEnd(node);
    this.resetMiddle();
  }

  public debug(showdates: boolean = true) {
    let i = this.head;

    console.log(" Start Feasible Intervals ");
    while (i) {
      i.data.debug(showdates);
      i = i.next;
    }
    console.log(" End Feasible Intervals ");
    console.log(" ");
  }

  public debugBackward(showdates: boolean = true) {
    let i = this.tail;

    console.log(" Start Feasible Intervals ");
    while (i) {
      i.data.debug(showdates);
      i = i.prev;
    }
    console.log(" End Feasible Intervals ");
    console.log(" ");
  }

  public findDurationFromEnd(
    startHorizon: number,
    endHorizon: number,
    duration: number,
    qty: number,
  ): ListNode<CTPInterval> | null {
    let ptr = this.closestToEndTime(startHorizon, endHorizon);
    let consumed = 0;
    while (ptr && consumed < duration) {
      if (ptr.data.duration() + consumed < duration) {
        consumed += ptr.data.duration();
      } else {
        consumed = duration;
      }
      if (consumed < duration) ptr = ptr.prev;
    }

    return ptr;
  }

  public copy(from: CTPIntervals) {
    this.clear();
    let i = from.head;

    while (i) {
      const newNode = new CTPInterval();
      newNode.copy(i.data);
      this.insertAtEnd(newNode);
      i = i.next;
    }
  }

  public sort() {

    let arr = this.toArray();
    this.clear();
    arr.sort((a :CTPInterval, b :CTPInterval) => a.startW - b.startW);

    for (let i = 0; i < arr.length; i++) {
      this.insertAtEnd(arr[i]);
    }
   
    this.resetMiddle();
  }

  public whiteSpace(startW?: number): number {
    let ws = 0;
    let i = this.head;
    if (startW) i = this.atStartTime(startW);

    while (i) {
      ws += i.data.duration();
      i = i.next;
    }
    return ws;
  }
}

export class CPTStartTimes extends CTPIntervals {
  public constructor() {
    super();
    this.name = "STARTTIMES";
  }
}

export class CPTDurations extends CTPIntervals {
  public constructor() {
    super();
    this.name = "DURATIONS";
  }
}

export class CTPAssignments extends CTPIntervals {
  public constructor() {
    super();
    this.name = "ASSINGMENTS";
  }
}

export class CTPAvailable extends CTPIntervals {
  public constructor() {
    super();
    this.name = "AVAILABLE";
  }
}

export class CPTInitial extends CTPIntervals {
  public constructor() {
    super();
    this.name = "INITIAL";
  }
}

export class CPTSetups extends CTPIntervals {
  public constructor() {
    super();
    this.name = "SETUPS";
  }
}
export class CTPRangeWindows extends LinkedList<CTPRangeValues> {
  public debug(showdates: boolean = true) {
    let i = this.head;

    let w = new CTPInterval();

    console.log(" Start Range Windows ");
    while (i) {
      w.startW = i.data.est;
      w.endW = i.data.eet;
      w.debug(showdates);
      w.startW = i.data.lst;
      w.endW = i.data.lett;
      w.debug(showdates);
      i = i.next;
    }
    console.log(" End Range Windows ");
    console.log(" ");
  }
}
export class CTPAvailableTimes extends LinkedList<CTPRange> {
  public type: number = 0;

  public atOrAfterStartTime(
    startW: number,
    endW: number,
  ): ListNode<CTPRange> | null {
    if (this.tail && startW > this.tail.data.endW) return null;

    let i = this.head;
    if (i) while (i && i.data.startW < startW) i = i.next;

    // Sort by start and end largest duration first
    if (i && startW == i.data.startW) {
      while (
        i &&
        startW == i.data.startW &&
        endW - startW < i.data.duration()
      ) {
        i = i.next;
      }
    }
    return i;
  }

  public atOrAfterQty(qty: number | null): ListNode<CTPRange> | null {
    if (qty === null) return null;

    if (this.tail && this.tail.data.qty !== null && qty > this.tail.data.qty)
      return null;

    let i = this.head;
    if (i) while (i && i.data.qty !== null && i.data.qty < qty) i = i.next;

    return i;
  }

  public add(node: CTPRange, byStartTime: boolean = true): void {
    var i: ListNode<CTPRange> | null;

    if (byStartTime) i = this.atOrAfterStartTime(node.startW, node.endW);
    else i = this.atOrAfterQty(node.qty);

    if (i) this.insertBefore(node, i);
    else this.insertAtEnd(node);
    this.resetMiddle();
  }

  public debug(showdates: boolean = true) {
    let i = this.head;

    while (i) {
      i.data.debug(showdates);

      i = i.next;
    }
    console.log(" ");
  }

  constructor(t: number = 0) {
    super();
    this.type = t;
  }
}
