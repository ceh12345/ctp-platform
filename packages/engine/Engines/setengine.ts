"strict";
import { CTPIntervalConstants } from "../Models/Core/constants";
import { CTPInterval } from "../Models/Core/window";
import { CTPIntervals } from "../Models/Intervals/intervals";
import { LinkedList, ListNode } from "../Models/Core/linklist";
import { CTPBaseEngine } from "./baseengine";

interface ISetEngine {
  execute(a?: CTPIntervals, b?: CTPIntervals): CTPIntervals | null;
  setLists(a: CTPIntervals, b: CTPIntervals): void;
}

export class CTPSetEngine extends CTPBaseEngine implements ISetEngine {
  protected readonly ADD_MODE = 1;
  protected readonly SUBTRACT_MODE = 2;
  protected readonly UNION_MODE = 3;
  protected readonly INTERSECT_MODE = 4;
  protected readonly COMPLIMENT_MODE = 5;

  protected mode: number = this.ADD_MODE;

  protected a: CTPIntervals | null;
  protected b: CTPIntervals | null;

  //protected aPtr: ListNode<CTPInterval> | null;
  //protected bPtr: ListNode<CTPInterval> | null;
  //protected cPtr: ListNode<CTPInterval> | null;

  protected current: CTPInterval;
  protected cumB: number = 0;

  protected intervalType: number = CTPIntervalConstants.REUSABLE;

  public results: CTPIntervals | null;

  public constructor(a?: CTPIntervals, b?: CTPIntervals) {
    super();
    this.a = null;
    this.b = null;

    this.current = new CTPInterval();
    this.results = null;

    if (a && b) this.setLists(a, b);
  }

  protected setCurrent(s: number, e: number, q: number): void {
    this.current.set(s, e, q);
  }

  protected savOrig(b: CTPIntervals | null): void {
    if (b) {
      // Save original data in B
      let bPtr = b.head;
      while (bPtr) {
        bPtr.data.set(bPtr.data.startW, bPtr.data.endW, bPtr.data.qty);
        bPtr = bPtr.next;
      }
    }
  }

  protected resetOrig(b: CTPIntervals | null): void {
    if (b) {
      // Save original data in B
      let bPtr = b.head;
      while (bPtr) {
        bPtr.data.set(
          bPtr.data.origStartW,
          bPtr.data.origEndW,
          bPtr.data.origQty,
        );
        bPtr = bPtr.next;
      }
    }
  }
  public setLists(a: CTPIntervals, b: CTPIntervals) {
    this.a = a;
    this.b = b;
    this.aPtr = null;
    this.bPtr = null;
    this.cPtr = null;

    this.savOrig(this.b);
    this.savOrig(this.a);

    if (a) this.aPtr = a.head;
    if (b) this.bPtr = b.head;
  }

  public assertQtyLists(): boolean {
    let rc = true;
    if (this.aPtr) rc = this.aPtr.data.hasQty();
    if (this.bPtr) rc = rc && this.bPtr.data.hasQty();
    return rc;
  }

  protected assertLists(): boolean {
    if (this.aPtr || this.bPtr) return true;
    return false;
  }

  public updateResults(node: CTPInterval, state: number = 1): boolean {
    // if state == -1 insert before
    // if state == 0 update tail
    // if start == 1 add to end

    if (!this.results) return false;

    let n = new CTPInterval(node.startW, node.endW);
    n.qty = node.qty;

    if (state == -1 && this.results.tail)
      this.results.insertBefore(n, this.results.tail);
    else if (state == 0 && this.results.tail) {
      this.results.tail.data.startW = node.startW;
      this.results.tail.data.endW = node.endW;

      if (this.mode == this.ADD_MODE || this.mode == this.SUBTRACT_MODE)
        if (node?.qty !== null && node?.qty !== undefined && this.results.tail.data?.qty !== null && this.results.tail.data?.qty !== undefined)
          this.results.tail.data.qty += node.qty;
    } else {
      if (this.results.tail) {
        if (this.mode == this.ADD_MODE || this.mode == this.SUBTRACT_MODE) {
          if (
            this.results.tail.data.endW == node.startW &&
            this.results.tail.data?.qty == node?.qty
          )
            this.results.tail.data.endW = node.endW;
          else this.results.insertAtEnd(n);
        } else {
          if (this.results.tail.data.endW == node.startW)
            this.results.tail.data.endW = node.endW;
          else this.results.insertAtEnd(n);
        }
      } else this.results.insertAtEnd(n);
    }

    return true;
  }

  ///
  /// Summary:
  //
  protected updateResult(
    s: number,
    e: number,
    aQty: number | null,
    bQty: number | null,
  ): void {
    // set q to zero
    let q = 0;
    let aq = 0;
    if (aQty !== null && aQty !== undefined) aq = aQty;

    // set bQty. May be negated later if in subtract mode
    let bq = 0;
    if (bQty !== null && bQty !== undefined) bq = bQty;

    // add in aQty and or bQty
    q = aq;

    // negate b if in subtract mode
    if (this.mode == this.SUBTRACT_MODE && bq > 0) bq = bq * -1;
    // add in b qty
    q = q + bq;

    // if Consumable need to add in cumulative B qty
    if (this.intervalType === CTPIntervalConstants.CONSUMABLE) {
      q = q + this.cumB;
      this.cumB = this.cumB + bq;
    }

    // Finally update the result array
    this.current.set(s, e, q);
    this.updateResults(this.current);
  }

  ///
  /// Summary:
  //
  protected setOperation(): boolean {
    if (!this.aPtr) return false;
    if (!this.bPtr) return false;

    // | --|
    //       | ----|
    if (this.aPtr.data.endW < this.bPtr.data.startW) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.updateResult(
          this.aPtr.data.startW,
          this.aPtr.data.endW,
          this.aPtr.data.qty,
          0,
        );
        //this.updateResults(this.current);
        this.moveA();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        this.moveA();
        return true;
      }

      this.updateResult(
        this.aPtr.data.startW,
        this.aPtr.data.endW,
        this.aPtr.data.qty,
        0,
      );
      //this.updateResults(this.aPtr.data);

      this.moveA();
    }
    // | --- |
    //        | ----|
    else if (this.aPtr.data.endW == this.bPtr.data.startW) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.updateResult(
          this.aPtr.data.startW,
          this.aPtr.data.endW,
          0,
          this.bPtr.data.qty,
        );
        //this.updateResults(this.current);
        this.moveA();
        return true;
      }
      if (this.mode == this.UNION_MODE) {
        this.aPtr.data.endW = this.bPtr.data.endW;
        this.moveB();
        return true;
      }

      if (this.mode == this.INTERSECT_MODE) {
        this.moveA();
        return true;
      }

      if (
        this.aPtr.data.qty == this.bPtr.data.qty &&
        (this.mode == this.ADD_MODE || this.mode == this.SUBTRACT_MODE)
      ) {
        this.aPtr.data.endW = this.bPtr.data.endW;
        this.moveB();
      } else {
        if (this.mode == this.ADD_MODE || this.mode == this.SUBTRACT_MODE)
          this.updateResult(
            this.aPtr.data.startW,
            this.aPtr.data.endW,
            this.aPtr.data.qty,
            0,
          );
        this.moveA();
      }
      return true;
    }
    //          | --- |
    // | ----|
    else if (this.aPtr.data.startW > this.bPtr.data.endW) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.moveB();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        this.moveB();
        return true;
      }

      this.updateResult(
        this.bPtr.data.startW,
        this.bPtr.data.endW,
        0,
        this.bPtr.data.qty,
      );
      //this.updateResults(this.bPtr.data);
      this.moveB();
    }
    //      | --- |
    // | ----|
    else if (this.aPtr.data.startW === this.bPtr.data.endW) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.moveB();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        this.moveB();
        return true;
      }
      if (this.mode == this.UNION_MODE) {
        this.aPtr.data.startW = this.bPtr.data.startW;
        this.moveB();
        return true;
      }

      if (
        this.aPtr.data.qty == this.bPtr.data.qty &&
        this.mode == this.ADD_MODE
      ) {
        this.aPtr.data.startW = this.bPtr.data.startW;
        this.moveB();
      } else {
        this.updateResult(
          this.bPtr.data.startW,
          this.bPtr.data.endW,
          0,
          this.bPtr.data.qty,
        );
        //this.updateResults(this.bPtr.data);

        this.moveB();
      }
    }

    // | ------- |
    //   | ----|
    else if (
      this.aPtr.data.startW <= this.bPtr.data.startW &&
      this.aPtr.data.endW >= this.bPtr.data.endW
    ) {
      if (this.mode == this.COMPLIMENT_MODE) {
        if (this.aPtr.data.startW !== this.bPtr.data.startW)
          this.updateResult(
            this.aPtr.data.startW,
            this.bPtr.data.startW,
            0,
            this.bPtr.data.qty,
          );
        this.aPtr.data.startW = this.bPtr.data.endW;
        this.moveB();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        //this.updateResults(this.bPtr.data);
        this.updateResult(
          this.bPtr.data.startW,
          this.bPtr.data.endW,
          this.aPtr.data.qty,
          0,
        );
        this.moveB();
        return true;
      }
      if (this.mode == this.UNION_MODE) {
        this.moveB();
        return true;
      }

      if (this.aPtr.data.startW < this.bPtr.data.startW) {
        this.updateResult(
          this.aPtr.data.startW,
          this.bPtr.data.startW,
          this.aPtr.data.qty,
          0,
        );
        //this.updateResults(this.current);
      }

      let q = 0;

      /* if (this.aPtr.data.qty && this.bPtr.data.qty) {
        if (this.mode == this.ADD_MODE)
          q = this.aPtr.data.qty + this.bPtr.data.qty;
        else q = this.aPtr.data.qty - this.bPtr.data.qty;
      } */

      this.updateResult(
        this.bPtr.data.startW,
        this.bPtr.data.endW,
        this.aPtr.data.qty,
        this.bPtr.data.qty,
      );
      //this.updateResults(this.current);

      this.aPtr.data.startW = this.bPtr.data.endW;
      this.moveB();
    }

    //     | --- |
    //  | -----------|
    else if (
      this.bPtr.data.startW <= this.aPtr.data.startW &&
      this.bPtr.data.endW >= this.aPtr.data.endW
    ) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.moveA();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        this.updateResult(
          this.aPtr.data.startW,
          this.aPtr.data.endW,
          this.aPtr.data.qty,
          0,
        );
        //this.updateResults(this.aPtr.data);
        this.moveA();
        return true;
      }
      if (this.mode == this.UNION_MODE) {
        this.aPtr.data.startW = this.bPtr.data.startW;
        this.aPtr.data.endW = this.bPtr.data.endW;
        this.moveB();
        return true;
      }
      if (this.bPtr.data.startW < this.aPtr.data.startW) {
        this.updateResult(
          this.bPtr.data.startW,
          this.aPtr.data.startW,
          0,
          this.bPtr.data.qty,
        );
        /*
        if (this.mode == this.SUBTRACT_MODE && this.bPtr.data.qty)
          this.current.set(
            this.bPtr.data.startW,
            this.aPtr.data.startW,
            this.bPtr.data.qty * -1,
          );
        else
          this.current.set(
            this.bPtr.data.startW,
            this.aPtr.data.startW,
            this.bPtr.data.qty,
          );
        this.updateResults(this.current);
        */
      }

      this.updateResult(
        this.aPtr.data.startW,
        this.aPtr.data.endW,
        this.aPtr.data.qty,
        this.bPtr.data.qty,
      );

      // let q = 0;
      // if (this.aPtr.data.qty && this.bPtr.data.qty) {
      //   if (this.mode == this.ADD_MODE)
      //     q = this.aPtr.data.qty + this.bPtr.data.qty;
      //   else q = this.aPtr.data.qty - this.bPtr.data.qty;
      // }

      //this.current.set(this.aPtr.data.startW, this.aPtr.data.endW, q);
      //this.updateResults(this.current);

      this.bPtr.data.startW = this.aPtr.data.endW;

      this.moveA();
    }

    //      | ---- |
    // | ----|
    else if (
      this.bPtr.data.startW <= this.aPtr.data.startW &&
      this.bPtr.data.endW <= this.aPtr.data.endW
    ) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.moveB();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        this.updateResult(
          this.aPtr.data.startW,
          this.bPtr.data.endW,
          this.aPtr.data.qty,
          0,
        );
        //this.updateResults(this.current);
        this.moveB();
        return true;
      }
      if (this.mode == this.UNION_MODE) {
        this.aPtr.data.startW = this.bPtr.data.startW;
        this.moveB();

        return true;
      }

      this.updateResult(
        this.bPtr.data.startW,
        this.aPtr.data.startW,
        0,
        this.bPtr.data.qty,
      );

      this.updateResult(
        this.aPtr.data.startW,
        this.bPtr.data.endW,
        this.aPtr.data.qty,
        this.bPtr.data.qty,
      );

      // let q = 0;
      // if (this.aPtr.data.qty && this.bPtr.data.qty) {
      //   if (this.mode == this.ADD_MODE)
      //     q = this.aPtr.data.qty + this.bPtr.data.qty;
      //   else q = this.aPtr.data.qty - this.bPtr.data.qty;
      // }
      // this.current.set(this.aPtr.data.startW, this.bPtr.data.endW, q);
      // this.updateResults(this.current);

      this.aPtr.data.startW = this.bPtr.data.endW;
      this.moveB();
    }

    //  | ---- |
    //     | ----|
    else if (
      this.bPtr.data.endW >= this.aPtr.data.endW &&
      this.bPtr.data.startW >= this.aPtr.data.startW
    ) {
      if (this.mode == this.COMPLIMENT_MODE) {
        this.updateResult(
          this.aPtr.data.startW,
          this.bPtr.data.startW,
          this.aPtr.data.qty,
          0,
        );

        this.bPtr.data.startW = this.aPtr.data.endW;
        this.moveA();
        return true;
      }
      if (this.mode == this.INTERSECT_MODE) {
        this.updateResult(
          this.bPtr.data.startW,
          this.aPtr.data.endW,
          this.aPtr.data.qty,
          0,
        );

        this.moveA();
        return true;
      }
      if (this.mode == this.UNION_MODE) {
        this.aPtr.data.endW = this.bPtr.data.endW;
        this.moveB();

        return true;
      }

      this.updateResult(
        this.aPtr.data.startW,
        this.bPtr.data.endW,
        this.aPtr.data.qty,
        0,
      );
      //this.updateResults(this.current);

      // let q = 0;
      // if (this.aPtr.data.qty && this.bPtr.data.qty) {
      //   if (this.mode == this.ADD_MODE)
      //     q = this.aPtr.data.qty + this.bPtr.data.qty;
      //   else q = this.aPtr.data.qty - this.bPtr.data.qty;
      // }
      // this.current.set(this.bPtr.data.startW, this.aPtr.data.endW, q);
      // this.updateResults(this.current);

      this.updateResult(
        this.bPtr.data.startW,
        this.aPtr.data.endW,
        this.aPtr.data.qty,
        this.bPtr.data.qty,
      );

      this.bPtr.data.startW = this.aPtr.data.endW;
      this.moveA();
    }

    return true;
  }

  protected moveA(): boolean {
    if (!this.aPtr) return false;
    this.aPtr = this.aPtr.next;
    return true;
  }

  protected moveB(): boolean {
    if (!this.bPtr) return false;
    this.bPtr = this.bPtr.next;
    return true;
  }

  protected completeA(): boolean {
    while (this.aPtr) {
      if (this.mode != this.INTERSECT_MODE) {
        this.updateResult(
          this.aPtr.data.startW,
          this.aPtr.data.endW,
          this.aPtr.data.qty,
          0,
        );
      }
      this.aPtr = this.aPtr.next;
    }
    return true;
  }

  protected completeB(): boolean {
    let aQty = 0;

    if (
      this.intervalType == CTPIntervalConstants.CONSUMABLE &&
      this.a &&
      this.a.tail
    )
      if (this.a.tail.data.qty) aQty = this.a.tail.data.qty;

    while (this.bPtr) {
      if (
        this.mode == this.UNION_MODE ||
        this.mode == this.ADD_MODE ||
        this.mode == this.SUBTRACT_MODE
      ) {
        this.updateResult(
          this.bPtr.data.startW,
          this.bPtr.data.endW,
          aQty,
          this.bPtr.data.qty,
        );
      }
      this.bPtr = this.bPtr.next;
    }

    return true;
  }
  protected completeResults(): boolean {
    //collapseSet(this.results);
    return true;
  }

  protected init(): boolean {
    if (!this.assertLists()) return false;
    if (!this.a) return false;

    this.cumB = 0;
    this.intervalType = CTPIntervalConstants.REUSABLE;
    if (this.a) this.intervalType = this.a.intervalType;
    else if (this.b) this.intervalType = this.b.intervalType;
    this.results = new CTPIntervals();

    this.results.intervalType = this.a.intervalType;
    this.results.endOfHorizon = this.a.endOfHorizon;
    return true;
  }

  protected cleanupLists(): void {
    this.resetOrig(this.b);
    this.resetOrig(this.a);
  }
  protected cleanup(): boolean {
    this.completeA();
    this.completeB();
    this.completeResults();
    this.cleanupLists();
    return true;
  }

  protected process(): boolean {
    let rc = true;
    while (this.aPtr && this.bPtr) {
      this.setOperation();
    }
    return rc;
  }

  public execute(a?: CTPIntervals, b?: CTPIntervals): CTPIntervals | null {
    if (a && b) this.setLists(a, b);
    let rc = this.init();
    if (rc) {
      rc = this.process();
      this.cleanup();
    }
    return this.results;
  }
}
export class CTPAddSetEngine extends CTPSetEngine {
  public constructor(a?: CTPIntervals, b?: CTPIntervals) {
    super(a, b);
    this.mode = this.ADD_MODE;
  }

  protected assertLists(): boolean {
    let rc = super.assertLists();
    if (rc) rc = super.assertQtyLists();
    return rc;
  }
}

export class CTPSubtractSetEngine extends CTPAddSetEngine {
  public constructor(a?: CTPIntervals, b?: CTPIntervals) {
    super(a, b);
    this.mode = this.SUBTRACT_MODE;
  }
}

interface IUnionEngine {
  union(a: CTPIntervals, b: CTPInterval): void;
}
export class CTPUnionSetEngine extends CTPAddSetEngine implements IUnionEngine {
  public constructor(a?: CTPIntervals, b?: CTPIntervals) {
    super(a, b);
    this.mode = this.UNION_MODE;
  }
  protected assertLists(): boolean {
    let rc = super.assertLists();

    return rc;
  }
  public union(a: CTPIntervals, b: CTPInterval): void {
    if (a && b) {
      let startW = b.startW;
      let endW = b.endW;
      this.aPtr = a.head;

      if (!this.aPtr) {
        a.insertAtEnd(b);
        return;
      }

      while (this.aPtr) {
        //       |----|
        // |--|
        if (endW < this.aPtr.data.startW) {
          a.insertBefore(b, this.aPtr);
          this.aPtr = null;
        }
        // |----|       |----|
        //        |--|
        else if (
          startW > this.aPtr.data.endW &&
          this.aPtr.next &&
          b.endW < this.aPtr.next.data.startW
        ) {
          a.insertBefore(b, this.aPtr.next);
          this.aPtr = null;
        }
        // |----|
        //        |--|
        else if (b.startW > this.aPtr.data.endW && !this.aPtr.next) {
          a.insertAtEnd(b);
          this.aPtr = null;
        }
        //   |----|
        // |---------|
        else if (
          startW < this.aPtr.data.startW &&
          endW >= this.aPtr.data.endW
        ) {
          this.aPtr.data.startW = startW;
          startW = this.aPtr.data.endW;
          this.aPtr = this.aPtr.next;
        }
        //     |---------|
        //  |-----|
        else if (startW < this.aPtr.data.startW && endW < this.aPtr.data.endW) {
          this.aPtr.data.startW = startW;

          this.aPtr = null;
        }
        // |---------|
        //   |----------|
        else if (
          startW > this.aPtr.data.startW &&
          startW < this.aPtr.data.endW
        ) {
          startW = this.aPtr.data.endW;
          this.aPtr = this.aPtr.next;
        }
        // |---------|
        //   |-----|
        else if (startW > this.aPtr.data.startW && endW < this.aPtr.data.endW) {
          this.aPtr = null;
        }
        // |---------|
        // |---------|
        else if (
          startW === this.aPtr.data.startW &&
          endW === this.aPtr.data.endW
        ) {
          this.aPtr = null;
        } else {
          this.aPtr = this.aPtr.next;
        }
      }
    }
  }
}

export class CTPIntersectSetEngine extends CTPUnionSetEngine {
  public constructor(a?: CTPIntervals, b?: CTPIntervals) {
    super(a, b);
    this.mode = this.INTERSECT_MODE;
  }
}
export class CTPComplimentSetEngine extends CTPUnionSetEngine {
  public constructor(a?: CTPIntervals, b?: CTPIntervals) {
    super(a, b);
    this.mode = this.COMPLIMENT_MODE;
  }
}
