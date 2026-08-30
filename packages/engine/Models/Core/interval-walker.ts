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
  // qty <= 0 means the interval carries no capacity. The subtract engine
  // represents a fully-consumed shift as qty=0 rather than removing the
  // interval, and the walk was counting its span as free time. Partial fix for
  // off-calendar placement — see SPRINT-subtract-engine-phantom-availability.md;
  // the dominant case is an assignment emitted at qty=1 outside any shift,
  // which this cannot catch.
  if ((interval.qty ?? 1) <= 0) return 0;
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
  /** Well-formed = start-sorted, endW monotone, non-overlapping (contiguous
   *  allowed). Enables the O(log n) prefix-sum tier. CTPIntervals.add()
   *  only sorts by START time, so mid-solve subtract-engine output can
   *  overlap (observed: slim-500 28641-OUT-3 divergence 2026-07-30) — those
   *  lists use the array-walk tier instead, which replicates the legacy
   *  accumulation node-by-node (bit-identical, including the negative
   *  contribution of contained intervals) but finds the start node by
   *  binary search over prefixMaxEnd and iterates typed arrays instead of
   *  chasing list pointers. */
  wellFormed: boolean;
  startW: Float64Array;
  endW: Float64Array;
  rr: Float64Array;           // runRate per interval; null runRate → 0
  qty: Float64Array;          // capacity per interval; <= 0 means NO availability
  rrNull: Uint8Array;         // 1 when runRate was null (legacy: d = 0, not d*0 — same value, kept for clarity)
  cumDur: Float64Array;       // cumulative raw duration through interval i (wellFormed tier only)
  cumRR: Float64Array;        // cumulative runRate-weighted duration through i (wellFormed tier only)
  /** prefixMaxEnd[i] = max(endW[0..i]) — monotone by construction for ANY
   *  list shape, so "first node in LIST ORDER with endW > q" (the legacy
   *  forward pre-scan) is always binary-searchable. */
  prefixMaxEnd: Float64Array;
}

const walkerIndexCache = new WeakMap<LinkedList<CTPInterval>, WalkerIndex>();
const invalidCache = new WeakMap<LinkedList<CTPInterval>, { modCount: number }>();

function getWalkerIndex(list: LinkedList<CTPInterval>): WalkerIndex | null {
  const cached = walkerIndexCache.get(list);
  if (cached && cached.modCount === list.modCount) return cached;
  const inv = invalidCache.get(list);
  if (inv && inv.modCount === list.modCount) return null;

  let count = 0;
  for (let p = list.head; p; p = p.next) count++;
  if (count === 0) return null;

  const startW = new Float64Array(count);
  const endW = new Float64Array(count);
  const rr = new Float64Array(count);
  const qty = new Float64Array(count);
  const rrNull = new Uint8Array(count);
  const cumDur = new Float64Array(count);
  const cumRR = new Float64Array(count);
  const prefixMaxEnd = new Float64Array(count);
  let i = 0;
  let sumDur = 0;
  let sumRR = 0;
  let wellFormed = true;
  let startSorted = true;
  let maxEnd = -Infinity;
  for (let p = list.head; p; p = p.next, i++) {
    startW[i] = p.data.startW;
    endW[i] = p.data.endW;
    if (i > 0) {
      if (startW[i] < startW[i - 1]) startSorted = false;
      if (endW[i] < endW[i - 1] || startW[i] < endW[i - 1]) wellFormed = false;
    }
    if (endW[i] > maxEnd) maxEnd = endW[i];
    prefixMaxEnd[i] = maxEnd;
    const rate = p.data.runRate ?? 0;
    rr[i] = rate;
    rrNull[i] = p.data.runRate === null ? 1 : 0;
    // An interval with qty <= 0 is not available time. Excluded from the
    // cumulative sums so the binary search over cumDur/cumRR cannot "find"
    // capacity in a consumed shift.
    const q = p.data.qty ?? 1;
    qty[i] = q;
    const d = q > 0 ? p.data.duration() : 0;
    sumDur += d;
    sumRR += d * rate;
    cumDur[i] = sumDur;
    cumRR[i] = sumRR;
  }
  // The backward pre-scan binary-searches startW directly, so a list that is
  // not even start-sorted (never produced by CTPIntervals.add, defensive
  // only) gets no index at all — pure legacy walks.
  if (!startSorted) {
    invalidCache.set(list, { modCount: list.modCount });
    return null;
  }
  const idx: WalkerIndex = {
    modCount: list.modCount, n: count,
    wellFormed: wellFormed,
    startW, endW, rr, qty, rrNull, cumDur, cumRR, prefixMaxEnd,
  };
  walkerIndexCache.set(list, idx);
  return idx;
}

/** First index in list order with endW > q (the legacy forward pre-scan),
 *  valid for any list shape via the monotone prefixMaxEnd. -1 if none. */
function firstIndexEndAfter(idx: WalkerIndex, q: number): number {
  let lo = 0, hi = idx.n - 1, first = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.prefixMaxEnd[mid] > q) { first = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return first;
}

/** Largest index with startW < q (the legacy backward pre-scan; startW is
 *  sorted — guaranteed by getWalkerIndex). -1 if none. */
function lastIndexStartBefore(idx: WalkerIndex, q: number): number {
  let lo = 0, hi = idx.n - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.startW[mid] < q) { last = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return last;
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
    const first = firstIndexEndAfter(idx, startW);
    if (first < 0) return startW + required;
    // Legacy quirk: zero/negative required breaks immediately with `end`
    // initialized to the first interval's (unclipped-right) end.
    if (required <= 0) return idx.endW[first];

    if (idx.wellFormed) {
      const cum = useRunRate ? idx.cumRR : idx.cumDur;
      // Amount clipped off the first interval's left edge by rangeStart=startW.
      const clipLeft = Math.max(0, startW - idx.startW[first]) * (useRunRate ? idx.rr[first] : 1);
      const base = (first > 0 ? cum[first - 1] : 0) + clipLeft;
      const total = cum[idx.n - 1] - base;
      if (total < required) return startW + required; // infeasible → legacy fallback

      // Smallest j >= first with cum[j] - base >= required.
      const target = base + required;
      let lo = first, hi = idx.n - 1, j = idx.n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] >= target) { j = mid; hi = mid - 1; }
        else lo = mid + 1;
      }
      const more = cum[j] - base;
      return idx.endW[j] - (more - required);
    }

    // Overlap tier: replicate the legacy accumulation node-by-node over the
    // typed arrays (same operations in the same order — bit-identical,
    // including negative contributions from contained intervals), with the
    // O(n) pre-scan already replaced by the prefixMaxEnd binary search.
    let more = 0;
    let end = idx.endW[first];
    for (let k = first; k < idx.n; k++) {
      let d = idx.qty[k] > 0 ? idx.endW[k] - idx.startW[k] : 0;
      if (d > 0 && idx.startW[k] < startW) d -= startW - idx.startW[k];
      if (useRunRate) d = idx.rrNull[k] === 1 ? 0 : d * idx.rr[k];
      more += d;
      end = idx.endW[k];
      if (more >= required) break;
    }
    if (more >= required && end) {
      if (more > required) end -= more - required;
      return end;
    }
    return startW + required;
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
    const last = lastIndexStartBefore(idx, endW);
    if (last < 0) return endW - required;
    // Legacy quirk mirror: zero/negative required returns the last covering
    // interval's (rangeStart-clipped) start; rangeStart is 0 here.
    if (required <= 0) return Math.max(idx.startW[last], 0);

    if (idx.wellFormed) {
      const cum = useRunRate ? idx.cumRR : idx.cumDur;
      // Amount clipped off the last interval's right edge by rangeEnd=endW.
      const clipRight = Math.max(0, idx.endW[last] - endW) * (useRunRate ? idx.rr[last] : 1);
      const cumThroughLast = cum[last] - clipRight;
      const totalAt = (j: number): number => cumThroughLast - (j > 0 ? cum[j - 1] : 0);
      if (totalAt(0) < required) return endW - required; // infeasible → legacy fallback

      // Largest j <= last with totalAt(j) >= required (totalAt decreases in j).
      let lo = 0, hi = last, j = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (totalAt(mid) >= required) { j = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      const more = totalAt(j);
      return Math.max(idx.startW[j], 0) + (more - required);
    }

    // Overlap tier: node-by-node legacy replica over typed arrays (mirror of
    // the forward tier; rangeStart=0, rangeEnd=endW).
    let more = 0;
    let start = Math.max(idx.startW[last], 0);
    for (let k = last; k >= 0; k--) {
      let d = idx.endW[k] - idx.startW[k];
      if (idx.endW[k] > endW) d -= idx.endW[k] - endW;
      if (idx.startW[k] < 0) d -= 0 - idx.startW[k];
      if (useRunRate) d = idx.rrNull[k] === 1 ? 0 : d * idx.rr[k];
      more += d;
      start = Math.max(idx.startW[k], 0);
      if (more >= required) break;
    }
    if (more >= required && start) {
      if (more > required) start += more - required;
      return start;
    }
    return endW - required;
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
