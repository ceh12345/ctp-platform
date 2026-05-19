import { describe, it, expect } from 'vitest';
// Import via the package index so the engine bootstrap order resolves
// correctly. availableengine.ts <-> engines.ts is a circular pair, and
// importing CTPAvailableEngine directly hits a partial-binding ReferenceError
// in engines.ts:26's static `new CTPAvailableEngine()`. The index forces the
// AI/Schedulers path to load first, which is the order production uses.
import {
  CTPAvailableEngine,
  AvailableMatrix,
  CTPAvailable,
  CTPInterval,
} from '../../index';

// CODE-OPTIMIZATION-SPRINT Ticket 11 — `addRunRates` HEAD-ONLY GATE
//
// Bug (availableengine.ts:437): the outer guard
//
//     if (i && i.data.runRate !== null) { while (i && j) { ... } }
//
// gates the entire merge on the *first* staticOriginal node's runRate. If that
// node has runRate == null, the loop never executes — so later staticOriginal
// nodes with non-null runRates are silently dropped on the floor and their
// matching staticAvailable nodes never receive a runRate.
//
// These tests are expected to FAIL against current code and PASS after the
// ticket's fix lands (gate moves inside the loop, per-node).
function makeInterval(s: number, e: number, runRate: number | null): CTPInterval {
  const iv = new CTPInterval(s, e);
  iv.runRate = runRate;
  return iv;
}

function buildMatrix(
  original: Array<{ s: number; e: number; rr: number | null }>,
  available: Array<{ s: number; e: number; rr: number | null }>,
): AvailableMatrix {
  const matrix = new AvailableMatrix();
  const so = new CTPAvailable();
  for (const n of original) so.insertAtEnd(makeInterval(n.s, n.e, n.rr));
  matrix.staticOriginal = so;

  const sa = new CTPAvailable();
  for (const n of available) sa.insertAtEnd(makeInterval(n.s, n.e, n.rr));
  matrix.staticAvailable = sa;

  return matrix;
}

function availableRunRates(matrix: AvailableMatrix): Array<number | null> {
  const out: Array<number | null> = [];
  let n = matrix.staticAvailable?.head ?? null;
  while (n) {
    out.push(n.data.runRate);
    n = n.next;
  }
  return out;
}

describe('CTPAvailableEngine.addRunRates — Ticket 11 head-only-gate bug', () => {
  it('propagates runRate from later staticOriginal nodes even when the first has null runRate', () => {
    // FIXTURE shape required for the bug to manifest:
    //   first staticOriginal node: runRate = null      -> trips the outer gate
    //   later staticOriginal nodes: runRate = 2, 3     -> bug = these are LOST
    const matrix = buildMatrix(
      [
        { s: 0, e: 10, rr: null },
        { s: 10, e: 20, rr: 2 },
        { s: 20, e: 30, rr: 3 },
      ],
      [
        { s: 0, e: 10, rr: null },
        { s: 10, e: 20, rr: null },
        { s: 20, e: 30, rr: null },
      ],
    );

    const engine = new CTPAvailableEngine();
    engine.setLists(matrix);
    engine.addRunRates();

    // The aligned-on-startW staticAvailable nodes should pick up their
    // matching staticOriginal runRates.
    //   available[0] aligns with original[0] (null) -> stays null
    //   available[1] aligns with original[1] (2)    -> should be 2
    //   available[2] aligns with original[2] (3)    -> should be 3
    expect(availableRunRates(matrix)).toEqual([null, 2, 3]);
  });

  it('still works correctly when the first staticOriginal node already has a runRate (no regression)', () => {
    // Sanity: when the gate would pass anyway, behaviour must not change.
    const matrix = buildMatrix(
      [
        { s: 0, e: 10, rr: 1 },
        { s: 10, e: 20, rr: 2 },
      ],
      [
        { s: 0, e: 10, rr: null },
        { s: 10, e: 20, rr: null },
      ],
    );

    const engine = new CTPAvailableEngine();
    engine.setLists(matrix);
    engine.addRunRates();

    expect(availableRunRates(matrix)).toEqual([1, 2]);
  });
});
