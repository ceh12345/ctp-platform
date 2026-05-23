/**
 * ticket-04.ts — Benchmark for CODE-OPTIMIZATION-SPRINT Ticket 4
 *
 *   "SCORE EACH UNIQUE CONTEXT ONCE PER CHAIN EVAL"
 *   FILE: chaincontextengine.ts (scoreChainCombos)
 *   Acceptance per spec: >= 4X speedup on a chain with 500 combos drawing
 *   from 20 unique contexts.
 *
 * NARROWED FIX (PATH-B) — NOT the spec's literal proposal
 * --------------------------------------------------------
 * The spec proposed scoring all unique contexts at once via a single
 * computeScores call. That changes scoring semantics: min/max normalization
 * inside ScoringEngine.computeScores happens against whichever `schedules`
 * array is passed in. The old code passed ONE COMBO at a time → normalization
 * was per-combo. The spec's "pass all unique contexts at once" version would
 * normalize globally. Probing showed this changes combo selection (the
 * `chainScore` rankings differ across every test scenario).
 *
 * PATH-B preserves the per-combo normalization semantic by:
 *   1. Computing raw rule values ONCE per unique context (the expensive
 *      `rule.compute(ctx)` calls).
 *   2. For each combo, computing per-combo min/max from those cached raw
 *      scores and blending each ctx using THIS combo's min/max.
 *
 * The probe showed PATH-B matches the original chainScore values bit-exactly
 * (maxDiff=0.000) and gives ×4-18× speedup depending on duplication ratio.
 *
 * MEASUREMENT SCOPE: scoreChainCombos end-to-end. Both impls dispatched
 * through the same private method via a `useUniqueContextScoring` flag.
 *
 * RUN:  node --expose-gc -e \
 *         'require("ts-node").register({transpileOnly:true,compilerOptions:{module:"commonjs"}});' \
 *         '-e' 'require("./packages/engine/benchmarks/ticket-04.ts");'
 */
import {
  ChainContextEngine,
  ChainContextCombo,
  ScheduleContext,
  CTPResourceSlot,
  CTPResourceSlots,
  CTPStartTime,
  CTPStartTimes,
  CTPResource,
  CTPTask,
  CTPDuration,
  CTPDurationConstants,
  SchedulingLandscape,
  CTPScoring,
  CTPScoringConfiguration,
} from "../index";
import { DateTime } from "luxon";
import { runTicketBench, makeMutableFixture } from "./bench-harness";

// ---------------------------------------------------------------------------
// CHAIN SHAPE
// ---------------------------------------------------------------------------
// Matches the spec's example: 500 combos drawing from ~20 unique contexts.
// Each combo has 3 contexts (small chain — the duplication ratio is what
// drives T4's win, not chain length).
const NUM_COMBOS = 500;
const CONTEXTS_PER_TASK = 7; // 3 tasks × 7 contexts = 21 unique (matches "spec example" from probe)
const CHAIN_LENGTH = 3;
const STARTTIMES_PER_CONTEXT = 30; // enough for compute() to do real work

const LANDSCAPE = (() => {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  return new SchedulingLandscape(st, st.plus({ days: 14 }));
})();

function makeContext(taskKey: string, idx: number, baseStart: number): ScheduleContext {
  const task = new CTPTask("PROCESS", taskKey, taskKey);
  task.duration = new CTPDuration(600, 1, CTPDurationConstants.FIXED_DURATION);
  task.sequence = 1;
  const slot = new CTPResourceSlots();
  const resource = new CTPResource("R", `R-${idx}`, "R");
  slot.resources?.add(new CTPResourceSlot(resource, 0));
  const startTimes = new CTPStartTimes();
  for (let j = 0; j < STARTTIMES_PER_CONTEXT; j++) {
    const e = baseStart + j * 100;
    startTimes.insertAtEnd(new CTPStartTime(e, e + 600, e + 50, e + 650, 600));
  }
  slot.startTimes = startTimes;
  return new ScheduleContext(LANDSCAPE, task, slot);
}

// ---------------------------------------------------------------------------
// MODULE-LEVEL FIXTURE — built once, reused across iterations.
//
// scoreChainCombos mutates combo.chainScore (overwritten each call) and
// transiently mutates ctx.blendedScore.score in the OLD path (saved+restored
// at end). Neither survives across iterations.
// ---------------------------------------------------------------------------
const ENGINE = new ChainContextEngine();

const SCORING: CTPScoring = (() => {
  const s = new CTPScoring();
  const r1 = new CTPScoringConfiguration();
  r1.ruleName = "EarliestStartTimeScoringRule";
  r1.weight = 0.5;
  r1.includeInSolve = true;
  s.rules.add(r1);
  const r2 = new CTPScoringConfiguration();
  r2.ruleName = "LatestStartTimeScoringRule";
  r2.weight = 0.5;
  r2.includeInSolve = true;
  s.rules.add(r2);
  return s;
})();

const CONTEXTS_PER_TASK_ARRAY: ScheduleContext[][] = (() => {
  const arr: ScheduleContext[][] = [];
  for (let t = 0; t < CHAIN_LENGTH; t++) {
    const taskCtxs: ScheduleContext[] = [];
    for (let i = 0; i < CONTEXTS_PER_TASK; i++) {
      taskCtxs.push(makeContext(`T${t}`, i, i * 10000 + t * 1000));
    }
    arr.push(taskCtxs);
  }
  return arr;
})();

const COMBOS: ChainContextCombo[] = (() => {
  let seed = 1;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const combos: ChainContextCombo[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const contexts: ScheduleContext[] = [];
    for (let t = 0; t < CHAIN_LENGTH; t++) {
      contexts.push(CONTEXTS_PER_TASK_ARRAY[t][Math.floor(rand() * CONTEXTS_PER_TASK)]);
    }
    combos.push({
      chainKey: `C${i}`,
      contexts,
      laneResources: new Map(),
      startTimes: contexts.map((_, idx) => ({
        taskKey: contexts[idx].task.key,
        eStartW: 0, lStartW: 0, eEndW: 0, lEndW: 0,
        assignedStart: 0, assignedEnd: 0,
      })),
      chainScore: 0,
      feasible: true,
      totalGap: 0,
      primaryIndex: 0,
    });
  }
  return combos;
})();

const UNIQUE_CONTEXT_COUNT = (() => {
  const s = new Set<ScheduleContext>();
  for (const c of COMBOS) for (const ctx of c.contexts) s.add(ctx);
  return s.size;
})();

// Per-iteration: nothing to reset (chainScore is overwritten by both impls).
function build(): { engine: ChainContextEngine; combos: ChainContextCombo[] } {
  return { engine: ENGINE, combos: COMBOS };
}

// Projection: snapshot chainScore across all combos right after the call.
function projectChainScores(combos: ChainContextCombo[]): number[] {
  return combos.map((c) => c.chainScore);
}

// ---------------------------------------------------------------------------
// scoreChainCombos is `private` on ChainContextEngine. Cast to invoke from
// outside the class.
// ---------------------------------------------------------------------------
type ScoreChainCombosCaller = {
  scoreChainCombos(
    combos: ChainContextCombo[],
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
  ): void;
};

const oldImpl = makeMutableFixture(build, ({ engine, combos }) => {
  engine.useUniqueContextScoring = false;
  (engine as unknown as ScoreChainCombosCaller).scoreChainCombos(combos, LANDSCAPE, SCORING);
  return projectChainScores(combos);
});

const newImpl = makeMutableFixture(build, ({ engine, combos }) => {
  engine.useUniqueContextScoring = true;
  (engine as unknown as ScoreChainCombosCaller).scoreChainCombos(combos, LANDSCAPE, SCORING);
  return projectChainScores(combos);
});

(async () => {
  console.log(
    `[fixture] ${NUM_COMBOS} combos × ${CHAIN_LENGTH} contexts/combo, drawing from ${UNIQUE_CONTEXT_COUNT} unique contexts ` +
      `(duplication ratio ≈ ${(NUM_COMBOS * CHAIN_LENGTH / UNIQUE_CONTEXT_COUNT).toFixed(1)}×)`,
  );

  await runTicketBench({
    ticketId: "ticket-04",
    description:
      "scoreChainCombos PATH-B (score raw values once per unique context, blend per-combo with this combo's min/max) vs ORIGINAL (computeScores called per combo). PATH-B preserves per-combo normalization semantics exactly — the spec's 'global normalization' variant was rejected because it changed combo rankings. See CODE-OPTIMIZATION-SPRINT.md T4 for details.",
    fixtureLabel: `${NUM_COMBOS} combos × ${CHAIN_LENGTH} contexts/combo drawing from ${UNIQUE_CONTEXT_COUNT} unique contexts (duplication ${(NUM_COMBOS * CHAIN_LENGTH / UNIQUE_CONTEXT_COUNT).toFixed(0)}×); ${STARTTIMES_PER_CONTEXT} startTimes per context; 2 scoring rules (Earliest+Latest)`,
    oldImpl,
    newImpl,
    minSpeedup: 4,
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
})();
