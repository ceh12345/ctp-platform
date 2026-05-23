/**
 * ticket-03.ts — Benchmark for CODE-OPTIMIZATION-SPRINT Ticket 3
 *
 *   "STARTTIMES NODE CACHE WITH BINARY SEARCH"
 *   FILE: chaincontextengine.ts + schedulecontext.ts
 *   Acceptance per spec: assignStartTimes >= 3X speedup on a 5-task chain
 *   with 50+ startTimes per context.
 *
 * MEASUREMENT SCOPE
 * -----------------
 * Each iteration constructs a fresh ChainContextCombo (5 tasks × 1 context
 * each × 50 startTimes nodes per context) and invokes
 * engine.assignStartTimes(combo) — the public hot-path that drives all 6
 * helper methods T3 optimizes. The combo is rebuilt per iteration because
 * assignStartTimes mutates combo.startTimes[i].assignedStart/End.
 *
 * Old impl: useStartTimesCache=false → head-walk linked-list paths in all
 * 6 helpers.
 *
 * New impl: useStartTimesCache=true → typed-array cache + binary search
 * (find pattern) or contiguous walk (iterate-all pattern). The cache is
 * lazily built on first access via getStCache and invalidated at the one
 * in-cycle mutation site (truncateContextStartTimes); see chaincontextengine
 * for full invalidation analysis.
 *
 * Correctness gate: compares assignedStart/assignedEnd across all 5 tasks
 * between old and new impls. Both paths must produce identical placements.
 *
 * RUN:  node --expose-gc -e \
 *         'require("ts-node").register({transpileOnly:true,compilerOptions:{module:"commonjs"}});' \
 *         '-e' 'require("./packages/engine/benchmarks/ticket-03.ts");'
 */
import {
  ChainContextEngine,
  ChainContextCombo,
  ScheduleContext,
  ScheduleContexts,
  CTPResourceSlot,
  CTPResourceSlots,
  CTPStartTime,
  CTPStartTimes,
  CTPResource,
  CTPTask,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPResourcePreference,
  CTPLinkId,
  CTPDuration,
  CTPDurationConstants,
  SchedulingLandscape,
} from "../index";
import { DateTime } from "luxon";
import { runTicketBench, makeMutableFixture } from "./bench-harness";

// ---------------------------------------------------------------------------
// CHAIN/CONTEXT SHAPE
// ---------------------------------------------------------------------------
// 5 tasks in a chain, primaryIndex=2 (middle) so assignStartTimes walks both
// backward (predecessors) and forward (successors). Each task has 1 context
// with 50 startTimes nodes spanning a wide window so candidates remain
// feasible after propagation clamping.
const CHAIN_LENGTH = 11;
const PRIMARY_INDEX = 5;
const STARTTIMES_PER_CONTEXT = 500;
const TASK_DURATION_SEC = 600; // 10-min FIXED tasks (calendar-independent)
const NODE_SPACING_SEC = 1800; // 30-min spacing between nodes
const NODE_WINDOW_SEC = 600;   // each node's eStart→lStart window

// ---------------------------------------------------------------------------
// One-shot landscape — reused across iterations (immutable from the bench's
// POV; assignStartTimes does not mutate it).
// ---------------------------------------------------------------------------
const LANDSCAPE: SchedulingLandscape = (() => {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  const et = st.plus({ days: 14 });
  return new SchedulingLandscape(st, et);
})();

// ---------------------------------------------------------------------------
// MODULE-LEVEL FIXTURE — built once, reused across iterations.
//
// assignStartTimes only mutates combo.startTimes[i].assignedStart/End (line
// 1081-1082 in chaincontextengine.ts). It does NOT mutate ctx.slot.startTimes
// or the contexts themselves, so the same engine + contexts + combo can be
// reused — we only need to reset the two assigned fields per iteration.
//
// This removes ~0.11ms of CTPInterval/CTPStartTime construction cost from
// every iteration, exposing the helper-method delta cleanly. The cache on
// each ScheduleContext stays warm across iterations (no truncate calls).
// ---------------------------------------------------------------------------
const ENGINE = new ChainContextEngine();

const CONTEXTS: ScheduleContext[] = (() => {
  const resource = new CTPResource("Bench", "BENCH-R", "Bench");
  const contexts: ScheduleContext[] = [];
  for (let i = 0; i < CHAIN_LENGTH; i++) {
    const task = new CTPTask("PROCESS", `T${i}`, `T${i}`);
    task.duration = new CTPDuration(TASK_DURATION_SEC, 1, CTPDurationConstants.FIXED_DURATION);
    task.linkId = new CTPLinkId("CHAIN-1", "ES", i > 0 ? `T${i - 1}` : "", null);
    task.sequence = i;
    task.capacityResources = new CTPTaskResourceList();
    const tr = new CTPTaskResource("Resource", true);
    tr.preferences.push(new CTPResourcePreference("BENCH-R", 1));
    task.capacityResources.add(tr);

    const slot = new CTPResourceSlots();
    slot.resources?.add(new CTPResourceSlot(resource, 0));
    const startTimes = new CTPStartTimes();
    for (let j = 0; j < STARTTIMES_PER_CONTEXT; j++) {
      const eStart = j * NODE_SPACING_SEC;
      const lStart = eStart + NODE_WINDOW_SEC;
      startTimes.insertAtEnd(new CTPStartTime(
        eStart,
        eStart + TASK_DURATION_SEC,
        lStart,
        lStart + TASK_DURATION_SEC,
        TASK_DURATION_SEC,
      ));
    }
    slot.startTimes = startTimes;
    contexts.push(new ScheduleContext(LANDSCAPE, task, slot));
  }
  return contexts;
})();

const COMBO: ChainContextCombo = {
  chainKey: "CHAIN-1",
  contexts: CONTEXTS,
  laneResources: new Map(),
  startTimes: CONTEXTS.map((_, i) => ({
    taskKey: `T${i}`,
    eStartW: 0,
    lStartW: (STARTTIMES_PER_CONTEXT - 1) * NODE_SPACING_SEC + NODE_WINDOW_SEC,
    eEndW: TASK_DURATION_SEC,
    lEndW: (STARTTIMES_PER_CONTEXT - 1) * NODE_SPACING_SEC + NODE_WINDOW_SEC + TASK_DURATION_SEC,
    assignedStart: 0,
    assignedEnd: 0,
  })),
  chainScore: 0,
  feasible: true,
  totalGap: 0,
  primaryIndex: PRIMARY_INDEX,
};

// Per-iteration: reset only the two mutated fields. Cheap.
function build(): { engine: ChainContextEngine; combo: ChainContextCombo } {
  for (let i = 0; i < COMBO.startTimes.length; i++) {
    COMBO.startTimes[i].assignedStart = 0;
    COMBO.startTimes[i].assignedEnd = 0;
  }
  return { engine: ENGINE, combo: COMBO };
}

// Projection: read back the assignedStart/assignedEnd values across all
// tasks. Identical values → both impls produced the same placement.
interface Projected {
  taskKey: string;
  assignedStart: number;
  assignedEnd: number;
}
function project(combo: ChainContextCombo): Projected[] {
  return combo.startTimes.map((st) => ({
    taskKey: st.taskKey,
    assignedStart: st.assignedStart,
    assignedEnd: st.assignedEnd,
  }));
}

// ---------------------------------------------------------------------------
// Old / new impls — flag toggles dispatch in 6 helpers.
// assignStartTimes is public so no cast required.
// ---------------------------------------------------------------------------
const oldImpl = makeMutableFixture(build, ({ engine, combo }) => {
  engine.useStartTimesCache = false;
  engine.assignStartTimes(combo);
  return project(combo);
});

const newImpl = makeMutableFixture(build, ({ engine, combo }) => {
  engine.useStartTimesCache = true;
  engine.assignStartTimes(combo);
  return project(combo);
});

(async () => {
  // Sanity: build() cost vs method cost. With 5 contexts × 50 startTimes each
  // = 250 CTPStartTime constructions per build, plus 5 ScheduleContexts and
  // 5 CTPTasks. Not free — operator should eyeball this ratio.
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) build();
  const buildMs = (performance.now() - t0) / 200;
  console.log(
    `[sanity] build() median ≈ ${buildMs.toFixed(5)}ms — ` +
      `must be << old median below, else fixture cost pollutes the number`,
  );

  await runTicketBench({
    ticketId: "ticket-03",
    description:
      "assignStartTimes find-pattern helpers (isWithinStartTimeNode, getAssignedProcessChangeDuration, findStartTimeNode): linked-list head-walk vs typed-array cache + binary search, measured end-to-end. Iterate-all helpers (computeContextFeasibleDuration, findEarliestFeasibleStart, findLatestFeasibleStartForPred) stay on linked-list walks — see ticket-03 in CODE-OPTIMIZATION-SPRINT.md for the narrowing rationale.",
    fixtureLabel: `${CHAIN_LENGTH}-task chain × ${STARTTIMES_PER_CONTEXT} startTimes per context (primaryIndex=${PRIMARY_INDEX}, FIXED duration so workingEndForwardW is calendar-independent). Upper end of realistic per-context N — see scaling table in the spec.`,
    oldImpl,
    newImpl,
    minSpeedup: 1.5,
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
})();
