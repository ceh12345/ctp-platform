/**
 * ticket-06.ts — Benchmark for CODE-OPTIMIZATION-SPRINT Ticket 6
 *
 *   "REWRITE crossProductContexts WITH BASEX COUNTER"
 *   FILE: chaincontextengine.ts
 *   Acceptance per spec: >= 2X speedup on a 4-set cross-product of size 8
 *   each (4096 combos).
 *
 * STRUCTURE
 * ---------
 * Frozen-fixture pattern (like ticket-01) — crossProductContexts is a pure
 * function with no engine state. Both impls are inlined here:
 *   - `oldCrossProduct` is a frozen copy of the pre-T6 spread-based version
 *     (`newResult.push([...existing, ctx])`).
 *   - `newCrossProduct` mirrors the current production code: BaseX counter,
 *     pre-allocated output, write rows by index, no per-combo spread.
 *
 * Production already runs the new version after this ticket lands. The frozen
 * old impl in this file is for reproducibility — running the bench against
 * any future commit measures the same algorithmic delta. If the production
 * impl ever diverges from `newCrossProduct` here, update this file to match
 * (same expectation as ticket-01).
 *
 * RUN:  node --expose-gc -e \
 *         'require("ts-node").register({transpileOnly:true,compilerOptions:{module:"commonjs"}});' \
 *         '-e' 'require("./packages/engine/benchmarks/ticket-06.ts");'
 */
import { runTicketBench } from "./bench-harness";

// Synthetic context type. The production function is generic-ish over
// ScheduleContext[][], but the algorithm doesn't read any context fields —
// it just shuffles object references. Pure-object placeholders give us the
// same algorithmic shape without dragging in the engine.
type Ctx = { id: number };

// ---------------------------------------------------------------------------
// FIXED FIXTURE — 4 sets × 8 contexts each → 4096 combos. Matches the spec's
// acceptance example. Builds once at module load.
// ---------------------------------------------------------------------------
const NUM_SETS = 4;
const SIZE_PER_SET = 8;

const SETS: Ctx[][] = (() => {
  const sets: Ctx[][] = [];
  for (let i = 0; i < NUM_SETS; i++) {
    const set: Ctx[] = [];
    for (let j = 0; j < SIZE_PER_SET; j++) {
      set.push({ id: i * 1000 + j });
    }
    sets.push(set);
  }
  return sets;
})();

// ---------------------------------------------------------------------------
// OLD: pre-T6 iterative spread. Frozen here as the museum-piece baseline.
// Each level builds a fresh array per combo via `[...existing, ctx]`.
// ---------------------------------------------------------------------------
function oldCrossProduct(contextSets: Ctx[][]): Ctx[][] {
  if (contextSets.length === 0) return [];
  if (contextSets.length === 1) return contextSets[0].map((c) => [c]);
  let result: Ctx[][] = contextSets[0].map((c) => [c]);
  for (let i = 1; i < contextSets.length; i++) {
    const newResult: Ctx[][] = [];
    for (const existing of result) {
      for (const ctx of contextSets[i]) {
        newResult.push([...existing, ctx]);
      }
    }
    result = newResult;
  }
  return result;
}

// ---------------------------------------------------------------------------
// NEW: T6 fix — BaseX-style digit counter, pre-allocated output, row-by-index
// writes. Mirrors the current production crossProductContexts.
// ---------------------------------------------------------------------------
function newCrossProduct(contextSets: Ctx[][]): Ctx[][] {
  if (contextSets.length === 0) return [];
  let total = 1;
  for (const s of contextSets) {
    if (s.length === 0) return [];
    total *= s.length;
  }
  const out = new Array<Ctx[]>(total);
  const counters = new Array<number>(contextSets.length).fill(0);
  for (let n = 0; n < total; n++) {
    const row = new Array<Ctx>(contextSets.length);
    for (let i = 0; i < contextSets.length; i++) row[i] = contextSets[i][counters[i]];
    out[n] = row;
    for (let i = contextSets.length - 1; i >= 0; i--) {
      if (++counters[i] < contextSets[i].length) break;
      counters[i] = 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CORRECTNESS NOTE
// Both impls enumerate combos in the same order (rightmost-digit-fastest):
//   - Old: at level i, iterates `for existing of result; for ctx of sets[i]`
//     → the last-added set varies fastest, prior ones nest outside.
//   - New: BaseX counter increments rightmost digit first with carry → same
//     enumeration order.
// So projection is just an id-shape transform — no sort needed. The harness's
// deepEqual gate sees identical literal output if both impls are correct.
// ---------------------------------------------------------------------------
function project(rows: Ctx[][]): number[][] {
  return rows.map((r) => r.map((c) => c.id));
}

const oldImpl = () => project(oldCrossProduct(SETS));
const newImpl = () => project(newCrossProduct(SETS));

runTicketBench({
  ticketId: "ticket-06",
  description:
    "crossProductContexts: pre-T6 iterative spread (`newResult.push([...existing, ctx])` per combo, allocating a fresh array at every level) vs T6 BaseX counter (pre-allocated output array of exact total size, digit counter with carry, row writes by index). Both impls enumerate combos in the same right-most-digit-fastest order, so projected output is bit-identical — no sort needed in the projection.",
  fixtureLabel: `${NUM_SETS} sets × ${SIZE_PER_SET} contexts each = ${Math.pow(SIZE_PER_SET, NUM_SETS)} combos (matches spec acceptance example). Projection includes the id-mapping step so both impls pay the same projection cost.`,
  oldImpl,
  newImpl,
  minSpeedup: 2,
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
