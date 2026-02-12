"strict";
import { CTPIntervalConstants } from "../Models/Core/constants";
import { CTPInterval } from "../Models/Core/window";
import { CTPAppSettings, IAppSettings } from "../Models/Entities/appsettings";
import { CTPIntervals } from "../Models/Intervals/intervals";
import { CTPRange } from "../Models/Core/range";

import { LinkedList, ListNode } from "../Models/Core/linklist";
import { SchedulingLandscape } from "../Models/Entities/landscape";

export interface IBaseEngine {
  appSettings: IAppSettings | null;
  landscape: SchedulingLandscape | null;
  startW: number;
  endW: number;
  setHorizon(s: number, e: number): void;
  setSettings(a: IAppSettings): void;
  setLandscape(l: SchedulingLandscape): void;
  mergeIntervals(a: CTPIntervals, b: CTPIntervals): void;
  collapseIntervals(a: CTPIntervals): void;
}

export class CTPBaseEngine implements IBaseEngine {
  public startW: number = 0;
  public endW: number = 0;
  public appSettings: IAppSettings | null = null;
  public landscape: SchedulingLandscape | null = null;

  protected aPtr: ListNode<CTPInterval> | null = null;
  protected bPtr: ListNode<CTPInterval> | null = null;
  protected cPtr: ListNode<CTPInterval> | null = null;
  protected dPtr: ListNode<CTPInterval> | null = null;

  protected head: ListNode<CTPInterval> | null = null;
  protected tail: ListNode<CTPInterval> | null = null;

  protected aRangePtr: ListNode<CTPRange> | null = null;
  protected bRangePtr: ListNode<CTPRange> | null = null;
  protected cRangePtr: ListNode<CTPRange> | null = null;

  protected assertLists(): boolean {
    return false;
  }

  public setLandscape(l: SchedulingLandscape): void {
    this.landscape = l;
  }
  public setSettings(a: IAppSettings): void {
    this.appSettings = a;
  }

  public setHorizon(s: number, e: number) {
    this.startW = s;
    this.endW = e;
  }

  protected flowAround(): boolean {
    let flowAround = false;

    // Not doing flow around yet
    // uncomment this code to flow around negative qty
    //if ((this.appSettings) && (this.appSettings.flowAround)) flowAround = this.appSettings.flowAround;

    return flowAround;
  }

  protected moveAForward(): void {
    if (this.aPtr) this.aPtr = this.aPtr.next;
  }
  protected moveBForward(): void {
    if (this.bPtr) this.bPtr = this.bPtr.next;
  }
  protected moveCForward(): void {
    if (this.cPtr) this.cPtr = this.cPtr.next;
  }
  protected moveDForward(): void {
    if (this.dPtr) this.dPtr = this.dPtr.next;
  }

  protected moveABackward(): void {
    if (this.aPtr) this.aPtr = this.aPtr.prev;
  }
  protected moveBBackward(): void {
    if (this.bPtr) this.bPtr = this.bPtr.prev;
  }
  protected moveCBackward(): void {
    if (this.cPtr) this.cPtr = this.cPtr.prev;
  }
  protected moveDBackward(): void {
    if (this.dPtr) this.dPtr = this.dPtr.prev;
  }
  // A is a new Intervals, B has the old interval qtys
  // Move B qtys into A where B exists in A

  public mergeIntervals(a: CTPIntervals, b: CTPIntervals) {
    if (!a) return;
    if (!b) return;

    let aPtr = a.head;
    let bPtr = b.head;

    while (bPtr && aPtr) {
      //       |----|
      // |--|
      if (bPtr.data.endW < aPtr.data.startW) bPtr = bPtr.next;
      // |----|
      //         |--|
      else if (bPtr.data.startW > aPtr.data.endW) aPtr = aPtr.next;
      else if (aPtr && bPtr) {
        if (bPtr.data.qty !== null && bPtr.data.qty !== undefined) aPtr.data.qty = bPtr.data.qty;
        if (bPtr.data.runRate !== null && bPtr.data.runRate !== undefined) aPtr.data.runRate = bPtr.data.runRate;
        aPtr = aPtr.next;
      }
    }
  }

  public collapseIntervals(a: CTPIntervals): void {
    if (!a) return;

    let aPtr = a.head;
    let bPtr = null;
    if (a?.head?.next) bPtr = a.head.next;

    while (bPtr && aPtr) {
      aPtr.data.flowRight = true;
      aPtr.data.flowLeft = true;

      // remove reusable segments that have zero qty
      if (
        a.intervalType == CTPIntervalConstants.REUSABLE &&
        aPtr.data.qty !== undefined &&
        aPtr.data.qty === 0
      ) {
        const prevNode = aPtr;
        aPtr = aPtr.next;
        if (prevNode.prev) prevNode.prev.data.flowRight = false;
        if (prevNode.next) prevNode.next.data.flowLeft = false;

        a.deleteNode(prevNode);
        if (aPtr) bPtr = aPtr.next;

        continue;
      }

      if (a.intervalType == CTPIntervalConstants.CONSUMABLE) {
        if (aPtr.data.endW < bPtr.data.startW)
          aPtr.data.endW = bPtr.data.startW;
      }

      if (
        aPtr.data.endW == bPtr.data.startW &&
        (aPtr.data.qty === null || aPtr.data.qty === undefined || aPtr.data.qty == bPtr.data.qty)
      ) {
        aPtr.data.endW = bPtr.data.endW;
        const nextB: ListNode<CTPInterval> | null = bPtr.next;
        a.deleteNode(bPtr);
        bPtr = nextB;
      } else {
        aPtr = aPtr.next;
        bPtr = bPtr.next;
      }
    }
    if (a.tail && a.intervalType == CTPIntervalConstants.CONSUMABLE)
      a.tail.data.endW = a.endOfHorizon;

    a.resetMiddle();
  }

  public constructor() {
    this.aPtr = null;
    this.bPtr = null;
    this.cPtr = null;
    this.dPtr = null;
    this.head = null;
    this.tail = null;
  }
}
