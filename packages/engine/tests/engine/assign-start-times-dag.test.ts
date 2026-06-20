import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChainContextEngine,
  ChainContextCombo,
  ChainStartTime,
} from '../../Engines/chaincontextengine';
import { ScheduleContext } from '../../Models/Entities/schedulecontext';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPTask } from '../../Models/Entities/task';
import { CTPResource } from '../../Models/Entities/resource';
import { DateTime } from 'luxon';
import { makeChainTask, makeResource, makeAvailable, makeScheduleContext } from '../helpers/builders';

// ═══════════════════════════════════════════════════════════════
// Edge-list refactor Phase 2/3 — assignStartTimes on a branched (DAG) combo.
//
// These fixtures bypass the still-linear producer (which only emits a single
// linkId.prevLink per task) and set preds[]/succs[] directly, so the engine's
// redesigned topological backward+forward fill can be exercised in isolation.
// The whole point: a node with two predecessors must wait for BOTH branches,
// and a parallel sibling of the primary (neither ancestor nor descendant) must
// be placed at all — the legacy single-spine walk did neither.
// ═══════════════════════════════════════════════════════════════

const ONE_HOUR = 3600;

function makeLandscape(): SchedulingLandscape {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  const et = st.plus({ days: 7 });
  return new SchedulingLandscape(st, et);
}

describe('assignStartTimes — branched (DAG) combos', () => {
  let engine: ChainContextEngine;
  let landscape: SchedulingLandscape;
  let res: CTPResource;
  let hStart: number;
  let baseStart: number;

  beforeEach(() => {
    engine = new ChainContextEngine();
    landscape = makeLandscape();
    hStart = landscape.horizon.startW;
    baseStart = hStart + 6 * ONE_HOUR;
    // One wide-open resource; FIXED durations mean the calendar is never walked,
    // so availability only needs to exist.
    res = makeResource('R', 'R', [{ s: hStart, e: hStart + 7 * 86400 }]);
    res.available.setOriginal(makeAvailable([{ s: hStart, e: hStart + 7 * 86400 }]));
    landscape.resources.addEntity(res);
  });

  /**
   * Build a combo from tasks in topological (index) order, with a single
   * start-time node per task. Windows default to generous [baseStart, +24h];
   * pass `pins` (keyed by task key) to pin a task's [eStartW, lStartW] — used to
   * force a deterministic placement for exact-window assertions. preds/succs are
   * set by the caller before this runs.
   */
  function buildCombo(
    tasks: CTPTask[],
    primaryIndex: number,
    pins: Record<string, { e: number; l: number }> = {},
  ): ChainContextCombo {
    const windowEnd = baseStart + 24 * ONE_HOUR;
    const win = (t: CTPTask) => pins[t.key] ?? { e: baseStart, l: windowEnd };
    const contexts: ScheduleContext[] = tasks.map((t) =>
      makeScheduleContext(landscape, t, res, [
        { eStartW: win(t).e, lStartW: win(t).l, duration: t.duration!.duration() },
      ]),
    );
    const startTimes: ChainStartTime[] = tasks.map((t) => ({
      taskKey: t.key,
      eStartW: win(t).e,
      lStartW: win(t).l,
      eEndW: win(t).e + t.duration!.duration(),
      lEndW: win(t).l + t.duration!.duration(),
      assignedStart: 0,
      assignedEnd: 0,
    }));
    return {
      chainKey: 'DAG-1',
      contexts,
      laneResources: new Map(),
      startTimes,
      chainScore: 0,
      feasible: true,
      totalGap: 0,
      primaryIndex,
    };
  }

  /** A→{B,C}→D, B = 1h, C = 2h (unequal branches), D joins both. */
  function diamond(): { A: CTPTask; B: CTPTask; C: CTPTask; D: CTPTask } {
    const mk = (key: string, dur: number, seq: number) =>
      makeChainTask({
        name: key, key, duration: dur, linkName: 'DAG-1', sequence: seq,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'R', isPrimary: true }],
      });
    const A = mk('A', ONE_HOUR, 1);
    const B = mk('B', ONE_HOUR, 2);
    const C = mk('C', 2 * ONE_HOUR, 2);
    const D = mk('D', ONE_HOUR, 3);
    // Branched edges set directly (the producer can't express two parents).
    A.preds = [];        A.succs = ['B', 'C'];
    B.preds = ['A'];     B.succs = ['D'];
    C.preds = ['A'];     C.succs = ['D'];
    D.preds = ['B', 'C']; D.succs = [];
    return { A, B, C, D };
  }

  it('join task waits for BOTH branches (longer branch governs)', () => {
    const { A, B, C, D } = diamond();
    // primary = B: this makes C a parallel sibling (neither ancestor nor
    // descendant of the primary) — the exact case the legacy walk never reached.
    const combo = buildCombo([A, B, C, D], /* primaryIndex (B) */ 1);

    engine.assignStartTimes(combo);

    const [a, b, c, d] = combo.startTimes;
    // Every node placed — including the sibling C.
    for (const st of combo.startTimes) {
      expect(st.assignedStart).toBeGreaterThan(0);
      expect(st.assignedEnd).toBeGreaterThan(st.assignedStart);
    }
    // Precedence holds along every edge, on both branches.
    expect(a.assignedEnd).toBeLessThanOrEqual(b.assignedStart); // A → B
    expect(a.assignedEnd).toBeLessThanOrEqual(c.assignedStart); // A → C
    expect(b.assignedEnd).toBeLessThanOrEqual(d.assignedStart); // B → D
    expect(c.assignedEnd).toBeLessThanOrEqual(d.assignedStart); // C → D
    // The join starts no earlier than the LATER branch end (here C, the 2h leg).
    expect(d.assignedStart).toBeGreaterThanOrEqual(c.assignedEnd);
    expect(c.assignedEnd).toBeGreaterThan(b.assignedEnd);
  });

  it('places correctly with the primary on the long branch', () => {
    const { A, B, C, D } = diamond();
    // primary = C (index 2): exercises a descendant join (D) fed by a sibling (B).
    const combo = buildCombo([A, B, C, D], 2);

    engine.assignStartTimes(combo);

    const [a, b, c, d] = combo.startTimes;
    for (const st of combo.startTimes) {
      expect(st.assignedStart).toBeGreaterThan(0);
    }
    expect(a.assignedEnd).toBeLessThanOrEqual(b.assignedStart);
    expect(a.assignedEnd).toBeLessThanOrEqual(c.assignedStart);
    expect(b.assignedEnd).toBeLessThanOrEqual(d.assignedStart);
    expect(c.assignedEnd).toBeLessThanOrEqual(d.assignedStart);
  });

  it('assigns exact windows when the join is the pinned primary', () => {
    // primary = D (the join) pinned to baseStart+4h → a single candidate, so the
    // backward fill is fully deterministic and we can assert exact times. With
    // the primary on the sink, ALL other nodes are ancestors → pure backward pass.
    const { A, B, C, D } = diamond();
    const combo = buildCombo([A, B, C, D], /* D */ 3, {
      D: { e: baseStart + 4 * ONE_HOUR, l: baseStart + 4 * ONE_HOUR },
    });

    engine.assignStartTimes(combo);

    const [a, b, c, d] = combo.startTimes;
    // D pinned; each predecessor packed as late as feasible against its successor.
    expect(d.assignedStart).toBe(baseStart + 4 * ONE_HOUR);
    expect(d.assignedEnd).toBe(baseStart + 5 * ONE_HOUR);
    expect(b.assignedStart).toBe(baseStart + 3 * ONE_HOUR); // 1h leg ends exactly at D
    expect(b.assignedEnd).toBe(baseStart + 4 * ONE_HOUR);
    expect(c.assignedStart).toBe(baseStart + 2 * ONE_HOUR); // 2h leg ends exactly at D
    expect(c.assignedEnd).toBe(baseStart + 4 * ONE_HOUR);
    // A bounded by the MIN over its two successors' starts (C at +2h is tighter).
    expect(a.assignedStart).toBe(baseStart + 1 * ONE_HOUR);
    expect(a.assignedEnd).toBe(baseStart + 2 * ONE_HOUR);
  });

  it('multi-sink fork: every sink is placed after the shared source', () => {
    // A → B, A → C, no join. Two terminals (sinks). primary = A → pure forward
    // pass placing both descendants.
    const mk = (key: string, dur: number, seq: number) =>
      makeChainTask({
        name: key, key, duration: dur, linkName: 'FORK-1', sequence: seq,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'R', isPrimary: true }],
      });
    const A = mk('A', ONE_HOUR, 1);
    const B = mk('B', ONE_HOUR, 2);
    const C = mk('C', 2 * ONE_HOUR, 2);
    A.preds = []; A.succs = ['B', 'C'];
    B.preds = ['A']; B.succs = [];
    C.preds = ['A']; C.succs = [];

    const combo = buildCombo([A, B, C], /* A */ 0);
    engine.assignStartTimes(combo);

    const [a, b, c] = combo.startTimes;
    for (const st of combo.startTimes) {
      expect(st.assignedStart).toBeGreaterThan(0);
      expect(st.assignedEnd).toBeGreaterThan(st.assignedStart);
    }
    expect(a.assignedEnd).toBeLessThanOrEqual(b.assignedStart);
    expect(a.assignedEnd).toBeLessThanOrEqual(c.assignedStart);
    // The two sinks are independent — neither constrains the other.
    expect(c.assignedEnd - c.assignedStart).toBe(2 * ONE_HOUR);
    expect(b.assignedEnd - b.assignedStart).toBe(ONE_HOUR);
  });

  it('deep unequal branches: the join waits for the multi-task long leg', () => {
    // A → B1 → B2 → E  (long leg: two 1h tasks)
    // A → C ────────→ E  (short leg: one 1h task)
    // E must start no earlier than B2's end, not just C's.
    const mk = (key: string, dur: number, seq: number) =>
      makeChainTask({
        name: key, key, duration: dur, linkName: 'DEEP-1', sequence: seq,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'R', isPrimary: true }],
      });
    const A = mk('A', ONE_HOUR, 1);
    const B1 = mk('B1', ONE_HOUR, 2);
    const B2 = mk('B2', ONE_HOUR, 3);
    const C = mk('C', ONE_HOUR, 2);
    const E = mk('E', ONE_HOUR, 4);
    A.preds = []; A.succs = ['B1', 'C'];
    B1.preds = ['A']; B1.succs = ['B2'];
    B2.preds = ['B1']; B2.succs = ['E'];
    C.preds = ['A']; C.succs = ['E'];
    E.preds = ['B2', 'C']; E.succs = [];

    // index order [A, B1, B2, C, E] is a valid topological order
    const combo = buildCombo([A, B1, B2, C, E], /* B2 */ 2);
    engine.assignStartTimes(combo);

    const [a, b1, b2, c, e] = combo.startTimes;
    for (const st of combo.startTimes) {
      expect(st.assignedStart).toBeGreaterThan(0);
      expect(st.assignedEnd).toBeGreaterThan(st.assignedStart);
    }
    // Precedence along every edge.
    expect(a.assignedEnd).toBeLessThanOrEqual(b1.assignedStart);
    expect(b1.assignedEnd).toBeLessThanOrEqual(b2.assignedStart);
    expect(b2.assignedEnd).toBeLessThanOrEqual(e.assignedStart);
    expect(a.assignedEnd).toBeLessThanOrEqual(c.assignedStart);
    expect(c.assignedEnd).toBeLessThanOrEqual(e.assignedStart);
    // The long leg (B1+B2) finishes after the short leg (C), so it governs E.
    expect(b2.assignedEnd).toBeGreaterThan(c.assignedEnd);
    expect(e.assignedStart).toBeGreaterThanOrEqual(b2.assignedEnd);
  });
});
