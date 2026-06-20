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
   * Build a combo from tasks in topological (index) order, with generous
   * propagated windows and a single wide start-time node per task. preds/succs
   * are set by the caller before this runs.
   */
  function buildCombo(tasks: CTPTask[], primaryIndex: number): ChainContextCombo {
    const windowEnd = baseStart + 24 * ONE_HOUR;
    const contexts: ScheduleContext[] = tasks.map((t) =>
      makeScheduleContext(landscape, t, res, [
        { eStartW: baseStart, lStartW: windowEnd, duration: t.duration!.duration() },
      ]),
    );
    const startTimes: ChainStartTime[] = tasks.map((t) => ({
      taskKey: t.key,
      eStartW: baseStart,
      lStartW: windowEnd,
      eEndW: baseStart + t.duration!.duration(),
      lEndW: windowEnd + t.duration!.duration(),
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
});
