/**
 * ticket-01.ts — Benchmark for CODE-OPTIMIZATION-SPRINT Ticket 1
 *
 *   "REPLACE unionEngine.union IN feasibleStartTimes WITH APPEND-WITH-MERGE"
 *   FILE: starttimeengine.ts, acceptance: >= 5X on a task with 200+ segments
 *
 * WHY THE BENCHMARK TARGETS THE LOOP BODY, NOT feasibleStartTimes() ITSELF
 * ------------------------------------------------------------------------
 * feasibleStartTimes() is `protected`, reads instance state (this.availStartTimes,
 * this.aRangePtr, this.valid), and would require standing up an AvailableMatrix
 * + SchedulingLandscape just to exercise one inner loop. That makes it an
 * integration benchmark dominated by setup noise — the opposite of what we
 * want for proving an O(M^2)->O(M) change.
 *
 * The actual unit of change is the loop body in starttimeengine.ts:
 *
 *     if (st <= et)
 *       theEngines.unionEngine.union(results, new CTPInterval(st, et));
 *
 * The intervals arrive in start-time order (the walk is iPtr = iPtr.next over a
 * sorted list). union() nevertheless head-walks `results` every call, giving
 * O(M) per insert -> O(M^2) total. The Ticket 1 fix is an O(1) tail-merge.
 * So the honest, scaffolding-free benchmark is: "N start-ordered intervals,
 * accumulated both ways, identical output, compare time." That isolates
 * exactly the change.
 */
import { CTPIntervals } from "../Models/Intervals/intervals";
import { CTPInterval } from "../Models/Core/window";
import { theEngines } from "../Engines/engines";
import { runTicketBench } from "./bench-harness";

// ---------------------------------------------------------------------------
// FIXED FIXTURE — built once, identical for old and new.
// 260 start-ordered segments with deliberate adjacency/overlap so the merge
// branch (not just the append branch) is exercised. Mirrors the shape
// feasibleStartTimes produces: st/et already clamped, fed in ascending order.
// ---------------------------------------------------------------------------
const SEGMENT_COUNT = 260; // sprint says "200+"
const SEGMENTS: Array<[number, number]> = (() => {
  const segs: Array<[number, number]> = [];
  let t = 0;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    // (i % 4 === 0) cases overlap the previous segment -> forces a real merge,
    // not just an append. The rest are adjacent/disjoint -> forces append.
    const start = i % 4 === 0 && i > 0 ? t - 2 : t + (i % 3);
    const end = start + 5;
    segs.push([start, end]);
    t = end + 1;
  }
  return segs;
})();

// ---------------------------------------------------------------------------
// OLD: current behaviour — general union, head-walk per insert.
// Builds a fresh CTPIntervals each call (the impl mutates it), accumulates via
// theEngines.unionEngine.union exactly as feasibleStartTimes does today, then
// projects to a plain [start,end][] for the correctness gate.
// ---------------------------------------------------------------------------
function oldImpl(): Array<[number, number]> {
  const results = new CTPIntervals();
  for (const [st, et] of SEGMENTS) {
    if (st <= et) {
      theEngines.unionEngine.union(results, new CTPInterval(st, et));
    }
  }
  return toPairs(results);
}

// ---------------------------------------------------------------------------
// NEW: Ticket 1 fix — inline tail-merge. This is the EXACT snippet from the
// sprint ticket. When the ticket lands in starttimeengine.ts this block is
// deleted and replaced by a call to the real method; until then it lives here
// so old and new are measured in one process.
// ---------------------------------------------------------------------------
function newImpl(): Array<[number, number]> {
  const results = new CTPIntervals();
  for (const [st, et] of SEGMENTS) {
    if (st <= et) {
      const tail = results.tail;
      if (tail && tail.data.endW >= st) {
        if (et > tail.data.endW) tail.data.endW = et;
      } else {
        results.insertAtEnd(new CTPInterval(st, et));
      }
    }
  }
  return toPairs(results);
}

function toPairs(list: CTPIntervals): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let n = list.head;
  while (n) {
    out.push([n.data.startW, n.data.endW]);
    n = n.next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// IMPORTANT CORRECTNESS CAVEAT (read before trusting a green run):
// The general union() also merges a new interval that overlaps the *middle*
// of the list, and coalesces backward. The tail-merge only ever touches the
// tail. These are equivalent ONLY because feasibleStartTimes feeds intervals
// in non-decreasing start order. The fixture above preserves that invariant.
// If the correctness gate ever FAILS here, it means the input ordering
// assumption is violated somewhere upstream — that is a real finding about
// the fix's precondition, not a harness bug. Do not "fix" it by relaxing the
// gate; investigate whether feasibleStartTimes' input is truly sorted on all
// landscapes (the sprint's acceptance criterion 1 implicitly depends on this).
// ---------------------------------------------------------------------------

runTicketBench({
  ticketId: "ticket-01",
  description: "feasibleStartTimes append-with-merge (vs general union)",
  fixtureLabel: `${SEGMENT_COUNT} start-ordered segments, ~25% overlapping`,
  oldImpl,
  newImpl,
  minSpeedup: 5,
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
