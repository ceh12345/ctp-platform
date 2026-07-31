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

  // Initialize from first pointer, clipping to [rangeStart, rangeEnd] so the
  // walker's running position respects the scheduling window. Without the
  // clip, a calendar interval that extends past the task window produces a
  // `start` at the interval's calendar start (often before the window) and
  // an `end` at the calendar end (often past the deadline). Downstream
  // feasibleStartTimes then can't reconcile those positions with the task
  // window and rejects the placement.
  if (estPtr) {
    end = Math.min(estPtr.data.endW, rangeEnd);
    start = Math.max(estPtr.data.startW, rangeStart);
  }

  let ptr = estPtr;
  while (ptr && ptr !== lstPtr?.next) {
    while (more < consumed && ptr && ptr !== lstPtr?.next) {
      if (reset) {
        end = Math.min(ptr.data.endW, rangeEnd);
        start = Math.max(ptr.data.startW, rangeStart);
        more = 0;
      }
      reset = false;

      const dur = clipDuration(ptr.data, rangeStart, rangeEnd, useRunRate);

      if (fixedReset) {
        if (dur < consumed) reset = true;
      }
      if (!reset) {
        more += dur;
        end = Math.min(ptr.data.endW, rangeEnd);
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

  // Initialize from last pointer, clipping to [rangeStart, rangeEnd]
  // (mirror of walkForward — see that function's comment for why).
  if (lstPtr) {
    end = Math.min(lstPtr.data.endW, rangeEnd);
    start = Math.max(lstPtr.data.startW, rangeStart);
  }

  let ptr = lstPtr;
  while (ptr && ptr !== estPtr?.prev) {
    while (more < consumed && ptr && ptr !== estPtr?.prev) {
      if (reset) {
        start = Math.max(ptr.data.startW, rangeStart);
        end = Math.min(ptr.data.endW, rangeEnd);
        more = 0;
      }
      reset = false;

      const dur = clipDuration(ptr.data, rangeStart, rangeEnd, useRunRate);

      if (fixedReset) {
        if (dur < consumed) reset = true;
      }
      if (!reset) {
        more += dur;
        start = Math.max(ptr.data.startW, rangeStart);
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

// ── Calendar index (P3, solver-performance sprint) ──────────────────────────
//
// workingEndForwardW / workingStartBackwardW were the top self-time hotspot
// under preference-pool workloads: a linear pre-scan to the first interval
// past startW plus a linear accumulation walk, per call, against calendar
// lists of hundreds of intervals. This index snapshots a calendar list into
// sorted typed arrays with prefix sums so both functions become binary
// searches. Cached per list object in a WeakMap, invalidated by the list's
// structural modCount (see LinkedList.modCount — in-place mutation of node
// data is NOT tracked; calendar replacement creates a new list object, which
// invalidates via the WeakMap key).
//
// The fast paths reproduce walkForward/walkBackward semantics exactly for
// the workingEnd/workingStart call shape (fixedReset=false, one-sided range
// clip), including the legacy quirks: a zero/negative `required` returns the
// first covering interval's boundary (not the query point), and run-rate
// overshoot is subtracted from the wall-clock boundary in scaled units.

interface WalkerIndex {
  modCount: number;
  n: number;
  /** False when the list is not well-formed (see build check below) — the
   *  binary-search fast paths are invalid then and callers must take the
   *  legacy walk. Cached so the verdict costs one scan per list version. */
  valid: boolean;
  startW: Float64Array;
  endW: Float64Array;
  rr: Float64Array;      // runRate per interval; null runRate → 0
  cumDur: Float64Array;  // cumulative raw duration through interval i
  cumRR: Float64Array;   // cumulative runRate-weighted duration through i
}

const walkerIndexCache = new WeakMap<LinkedList<CTPInterval>, WalkerIndex>();
const EMPTY_F64 = new Float64Array(0);

function getWalkerIndex(list: LinkedList<CTPInterval>): WalkerIndex | null {
  const cached = walkerIndexCache.get(list);
  if (cached && cached.modCount === list.modCount) return cached.valid ? cached : null;

  let count = 0;
  for (let p = list.head; p; p = p.next) count++;
  if (count === 0) return null;

  const startW = new Float64Array(count);
  const endW = new Float64Array(count);
  const rr = new Float64Array(count);
  const cumDur = new Float64Array(count);
  const cumRR = new Float64Array(count);
  let i = 0;
  let sumDur = 0;
  let sumRR = 0;
  // Well-formedness: sorted by start, endW monotone, non-overlapping
  // (contiguous allowed). CTPIntervals.add() only sorts by START time, so
  // overlap/containment CAN occur (observed on mid-solve subtract-engine
  // output, slim-500 28641-OUT-3 divergence 2026-07-30) — and then endW is
  // not monotone and every binary search below is invalid. Such lists take
  // the legacy walk; the verdict is cached per (list, modCount).
  let wellFormed = true;
  for (let p = list.head; p; p = p.next, i++) {
    startW[i] = p.data.startW;
    endW[i] = p.data.endW;
    if (i > 0 && (startW[i] < startW[i - 1] || endW[i] < endW[i - 1] || startW[i] < endW[i - 1])) {
      wellFormed = false;
      break;
    }
    const rate = p.data.runRate ?? 0;
    rr[i] = rate;
    const d = p.data.duration();
    sumDur += d;
    sumRR += d * rate;
    cumDur[i] = sumDur;
    cumRR[i] = sumRR;
  }
  const idx: WalkerIndex = wellFormed
    ? { modCount: list.modCount, n: count, valid: true, startW, endW, rr, cumDur, cumRR }
    : { modCount: list.modCount, n: 0, valid: false, startW: EMPTY_F64, endW: EMPTY_F64, rr: EMPTY_F64, cumDur: EMPTY_F64, cumRR: EMPTY_F64 };
  walkerIndexCache.set(list, idx);
  return idx.valid ? idx : null;
}

/**
 * Given a resource calendar (linked list of CTPInterval) and a candidate
 * start time, return the wall-clock end after consuming `duration` of
 * working time. For FIXED durations this is `startW + duration` (no walk
 * needed); for FLOAT durations this consults the calendar index (binary
 * search over prefix sums; falls back to the linked-list walk when the
 * index is unavailable). Pure, no mutation.
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
  const useRunRate = dt === CTPDurationConstants.FLOAT_RUN_RATE;

  const idx = getWalkerIndex(list);
  if (idx) {
    // First interval with endW > startW (legacy pre-scan, as binary search).
    let lo = 0, hi = idx.n - 1, first = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (idx.endW[mid] > startW) { first = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    if (first < 0) return startW + required;
    // Legacy quirk: zero/negative required breaks immediately with `end`
    // initialized to the first interval's (unclipped-right) end.
    if (required <= 0) return idx.endW[first];

    const cum = useRunRate ? idx.cumRR : idx.cumDur;
    // Amount clipped off the first interval's left edge by rangeStart=startW.
    const clipLeft = Math.max(0, startW - idx.startW[first]) * (useRunRate ? idx.rr[first] : 1);
    const base = (first > 0 ? cum[first - 1] : 0) + clipLeft;
    const total = cum[idx.n - 1] - base;
    if (total < required) return startW + required; // infeasible → legacy fallback

    // Smallest j >= first with cum[j] - base >= required.
    const target = base + required;
    lo = first; hi = idx.n - 1;
    let j = idx.n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] >= target) { j = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    const more = cum[j] - base;
    return idx.endW[j] - (more - required);
  }

  let head: ListNode<CTPInterval> | null = list.head;
  while (head && head.data.endW <= startW) head = head.next;
  if (!head) return startW + required;
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
  const useRunRate = dt === CTPDurationConstants.FLOAT_RUN_RATE;

  const idx = getWalkerIndex(list);
  if (idx) {
    // Last interval with startW < endW (legacy tail pre-scan, as binary search).
    let lo = 0, hi = idx.n - 1, last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (idx.startW[mid] < endW) { last = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (last < 0) return endW - required;
    // Legacy quirk mirror: zero/negative required returns the last covering
    // interval's (rangeStart-clipped) start; rangeStart is 0 here.
    if (required <= 0) return Math.max(idx.startW[last], 0);

    const cum = useRunRate ? idx.cumRR : idx.cumDur;
    // Amount clipped off the last interval's right edge by rangeEnd=endW.
    const clipRight = Math.max(0, idx.endW[last] - endW) * (useRunRate ? idx.rr[last] : 1);
    const cumThroughLast = cum[last] - clipRight;
    const totalAt = (j: number): number => cumThroughLast - (j > 0 ? cum[j - 1] : 0);
    if (totalAt(0) < required) return endW - required; // infeasible → legacy fallback

    // Largest j <= last with totalAt(j) >= required (totalAt decreases in j).
    lo = 0; hi = last;
    let j = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (totalAt(mid) >= required) { j = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const more = totalAt(j);
    return Math.max(idx.startW[j], 0) + (more - required);
  }

  let tail: ListNode<CTPInterval> | null = list.tail;
  while (tail && tail.data.startW >= endW) tail = tail.prev;
  if (!tail) return endW - required;
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
