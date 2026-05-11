import { ListNode, LinkedList } from './linklist';
import { CTPInterval, CTPDuration } from './window';
import { CTPDurationConstants } from './constants';

export interface WalkResult {
  start: number;
  end: number;
  feasible: boolean;
  accumulated: number;
}

/**
 * Clip an interval's duration against range boundaries.
 * This matches CTPRange.computeBoundedDuration which clips to
 * rangeStart/rangeEnd (NOT the st/et scheduling window).
 */
export function clipDuration(
  interval: CTPInterval,
  rangeStart: number,
  rangeEnd: number,
  useRunRate: boolean,
): number {
  let d = interval.duration();
  if (interval.endW > rangeEnd) d -= interval.endW - rangeEnd;
  if (interval.startW < rangeStart) d -= rangeStart - interval.startW;

  if (useRunRate) {
    if (interval.runRate === null) d = 0;
    else d = d * interval.runRate;
  }
  return d;
}

/**
 * Walk forward from estPtr to lstPtr, accumulating duration.
 * Handles the FIXED reset logic: when a single interval can't
 * hold the full consumed amount, restart from the next interval.
 */
export function walkForward(
  estPtr: ListNode<CTPInterval> | null,
  lstPtr: ListNode<CTPInterval> | null,
  consumed: number,
  rangeStart: number,
  rangeEnd: number,
  useRunRate: boolean,
  fixedReset: boolean,
): WalkResult {
  let start = 0;
  let end = 0;
  let more = 0;
  let reset = false;

  // Initialize from first pointer
  if (estPtr) {
    end = estPtr.data.endW;
    start = estPtr.data.startW;
  }

  let ptr = estPtr;
  while (ptr && ptr !== lstPtr?.next) {
    while (more < consumed && ptr && ptr !== lstPtr?.next) {
      if (reset) {
        end = ptr.data.endW;
        start = ptr.data.startW;
        more = 0;
      }
      reset = false;

      const dur = clipDuration(ptr.data, rangeStart, rangeEnd, useRunRate);

      if (fixedReset) {
        if (dur < consumed) reset = true;
      }
      if (!reset) {
        more += dur;
        end = ptr.data.endW;
      }

      ptr = ptr?.next;
    }
    if (more >= consumed && end) {
      if (more > consumed) end -= more - consumed;
      break;
    }
  }

  return { start, end, feasible: more >= consumed, accumulated: more };
}

/**
 * Walk backward from lstPtr to estPtr, accumulating duration.
 * Mirror of walkForward with reversed traversal.
 */
export function walkBackward(
  lstPtr: ListNode<CTPInterval> | null,
  estPtr: ListNode<CTPInterval> | null,
  consumed: number,
  rangeStart: number,
  rangeEnd: number,
  useRunRate: boolean,
  fixedReset: boolean,
): WalkResult {
  let start = 0; // lst
  let end = 0;   // lett
  let more = 0;
  let reset = false;

  // Initialize from last pointer
  if (lstPtr) {
    end = lstPtr.data.endW;
    start = lstPtr.data.startW;
  }

  let ptr = lstPtr;
  while (ptr && ptr !== estPtr?.prev) {
    while (more < consumed && ptr && ptr !== estPtr?.prev) {
      if (reset) {
        start = ptr.data.startW;
        end = ptr.data.endW;
        more = 0;
      }
      reset = false;

      const dur = clipDuration(ptr.data, rangeStart, rangeEnd, useRunRate);

      if (fixedReset) {
        if (dur < consumed) reset = true;
      }
      if (!reset) {
        more += dur;
        start = ptr.data.startW;
      }

      ptr = ptr?.prev;
    }
    if (more >= consumed && start) {
      if (more > consumed) start += more - consumed;
      break;
    }
  }

  return { start, end, feasible: more >= consumed, accumulated: more };
}

/**
 * Given a resource calendar (linked list of CTPInterval) and a candidate
 * start time, return the wall-clock end after consuming `duration` of
 * working time. For FIXED durations this is `startW + duration` (no walk
 * needed); for FLOAT durations this walks the calendar starting at the
 * first interval whose end is past `startW`. Pure, no mutation.
 *
 * Caller passes the task's CTPDuration so the helper can short-circuit
 * for FIXED. Used by ChainContextEngine, CommonStartTimesAgent, and
 * ScheduleEngine wherever they currently do `endW = startW + duration`
 * arithmetic — for FLOAT tasks that arithmetic is wrong because shift
 * gaps don't count as working time.
 */
export function workingEndForwardW(
  list: LinkedList<CTPInterval> | null | undefined,
  startW: number,
  duration: CTPDuration,
): number {
  const required = duration.duration();
  const dt = duration.durationType;
  // FIXED / FIXED_RUN_RATE / STATIC / UNTRACKED: wall-clock end == working end
  if (dt !== CTPDurationConstants.FLOAT_DURATION && dt !== CTPDurationConstants.FLOAT_RUN_RATE) {
    return startW + required;
  }
  if (!list || !list.head || !list.tail) return startW + required;
  let head: ListNode<CTPInterval> | null = list.head;
  while (head && head.data.endW <= startW) head = head.next;
  if (!head) return startW + required;
  const useRunRate = dt === CTPDurationConstants.FLOAT_RUN_RATE;
  const r = walkForward(head, list.tail, required, startW, Number.MAX_SAFE_INTEGER, useRunRate, false);
  return r.feasible ? r.end : startW + required;
}

/**
 * Mirror of workingEndForwardW for backward direction: given an end time,
 * return the wall-clock start after walking back `duration` of working time.
 */
export function workingStartBackwardW(
  list: LinkedList<CTPInterval> | null | undefined,
  endW: number,
  duration: CTPDuration,
): number {
  const required = duration.duration();
  const dt = duration.durationType;
  if (dt !== CTPDurationConstants.FLOAT_DURATION && dt !== CTPDurationConstants.FLOAT_RUN_RATE) {
    return endW - required;
  }
  if (!list || !list.head || !list.tail) return endW - required;
  let tail: ListNode<CTPInterval> | null = list.tail;
  while (tail && tail.data.startW >= endW) tail = tail.prev;
  if (!tail) return endW - required;
  const useRunRate = dt === CTPDurationConstants.FLOAT_RUN_RATE;
  const r = walkBackward(tail, list.head, required, 0, endW, useRunRate, false);
  return r.feasible ? r.start : endW - required;
}

/**
 * Accumulate duration/runRate/minAvail/maxAvail across intervals.
 * Iterates from estPtr to lstPtr (exclusive of lstPtr).
 */
export function accumulateRangeValues(
  estPtr: ListNode<CTPInterval> | null,
  lstPtr: ListNode<CTPInterval> | null,
  st: number,
  et: number,
): { duration: number; runRateQty: number; minAvail: number; maxAvail: number } {
  let duration = 0;
  let runRateQty = 0;
  let minAvail = Number.MAX_VALUE;
  let maxAvail = 0;

  let ePtr = estPtr;
  while (ePtr && ePtr !== lstPtr) {
    if (et < ePtr.data.startW) {
      // interval starts after our range — skip
    } else if (st > ePtr.data.endW) {
      // interval ends before our range — skip
    } else {
      if (ePtr.data.qty && ePtr.data.qty > maxAvail) maxAvail = ePtr.data.qty;
      if (ePtr.data.qty && ePtr.data.qty < minAvail) minAvail = ePtr.data.qty;

      if (st > ePtr.data.startW) {
        duration += ePtr.data.endW - st;
        if (ePtr.data.runRate) runRateQty += (ePtr.data.endW - st) * ePtr.data.runRate;
      } else if (et < ePtr.data.endW) {
        duration += et - ePtr.data.startW;
        if (ePtr.data.runRate) runRateQty += (et - ePtr.data.startW) * ePtr.data.runRate;
      } else {
        duration += ePtr.data.duration();
        if (ePtr.data.runRate) runRateQty += ePtr.data.duration() * ePtr.data.runRate;
      }
    }
    ePtr = ePtr.next;
  }

  return { duration, runRateQty, minAvail, maxAvail };
}
