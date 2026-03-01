import { describe, it, expect } from 'vitest';
import { ChainFeasibilitySet, ChainContextEntry } from '../../AI/Propagation/ChainFeasibilitySet';
import { ChainPropagationAgent, PropagationResult } from '../../AI/Propagation/ChainPropagationAgent';
import { CTPTask } from '../../Models/Entities/task';
import { CTPStartTime, CTPStartTimes } from '../../Models/Entities/starttime';
import { ScheduleContext } from '../../Models/Entities/schedulecontext';
import { CTPResourceSlots } from '../../Models/Entities/slot';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPDuration } from '../../Models/Core/window';

// ─── Helpers ──────────────────────────────────────────────────────────────

const landscape = new SchedulingLandscape();

function makeTask(key: string, name: string, seq: number, chainName: string, prevLink: string, maxGap?: number): CTPTask {
  const task = new CTPTask('PROCESS', name, key);
  task.sequence = seq;
  task.duration = new CTPDuration(3600, 1); // 1 hour default
  task.linkId = new CTPLinkId(chainName, 'game', prevLink, maxGap);
  return task;
}

/**
 * Create a ScheduleContext with specific start time ranges.
 * Each range is [eStart, lStart, duration].
 */
function makeContext(task: CTPTask, ranges: [number, number, number][]): ScheduleContext {
  const slot = new CTPResourceSlots();
  slot.startTimes = new CTPStartTimes();
  for (const [eStart, lStart, dur] of ranges) {
    slot.startTimes.insertAtEnd(new CTPStartTime(eStart, eStart + dur, lStart, lStart + dur, dur));
  }
  return new ScheduleContext(landscape, task, slot);
}

/**
 * Build a ChainFeasibilitySet from tasks + context arrays.
 */
function buildChain(
  chainName: string,
  phases: { task: CTPTask; contexts: ScheduleContext[] }[],
): ChainFeasibilitySet {
  const set = new ChainFeasibilitySet(chainName);
  set.build(
    phases.map(p => p.task),
    (task) => {
      const phase = phases.find(p => p.task.key === task.key);
      return phase ? phase.contexts : [];
    },
    (ctx) => ctx.slot.startTimes ? ctx.slot.startTimes.toArray() : [],
  );
  return set;
}

// Time constants (epoch seconds)
const H = 3600;       // 1 hour in seconds
const T0 = 100000;    // base time
const MON_8AM = T0;
const MON_4PM = T0 + 8 * H;
const TUE_8AM = T0 + 24 * H;
const TUE_4PM = T0 + 32 * H;
const WED_8AM = T0 + 48 * H;

// ─── ChainFeasibilitySet ─────────────────────────────────────────────────

describe('ChainFeasibilitySet', () => {
  it('builds phases ordered by task input order', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 3600);
    const ctx1 = makeContext(t1, [[MON_8AM, MON_4PM, H]]);
    const ctx2 = makeContext(t2, [[MON_8AM + H, MON_4PM + H, H]]);

    const chain = buildChain('C1', [
      { task: t1, contexts: [ctx1] },
      { task: t2, contexts: [ctx2] },
    ]);

    expect(chain.phases.length).toBe(2);
    expect(chain.phases[0].task.key).toBe('C1-PREP');
    expect(chain.phases[1].task.key).toBe('C1-PLAY');
    expect(chain.phases[0].entries.length).toBe(1);
    expect(chain.phases[1].entries.length).toBe(1);
  });

  it('isFeasible returns true when all phases have entries', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 3600);
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_4PM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[MON_8AM + H, MON_4PM + H, H]])] },
    ]);
    expect(chain.isFeasible()).toBe(true);
  });

  it('isFeasible returns false when a phase has no entries', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 3600);
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_4PM, H]])] },
      { task: t2, contexts: [] },
    ]);
    expect(chain.isFeasible()).toBe(false);
  });

  it('recomputeBounds reflects non-eliminated entries', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const ctx1 = makeContext(t1, [[MON_8AM, MON_8AM, H]]);
    const ctx2 = makeContext(t1, [[TUE_8AM, TUE_8AM, H]]);
    const chain = buildChain('C1', [{ task: t1, contexts: [ctx1, ctx2] }]);

    expect(chain.phases[0].chainEarliestStart).toBe(MON_8AM);
    expect(chain.phases[0].chainLatestEnd).toBe(TUE_8AM + H);

    // Eliminate first entry
    chain.phases[0].entries[0].eliminated = true;
    chain.recomputeBounds();
    expect(chain.phases[0].chainEarliestStart).toBe(TUE_8AM);
  });
});

// ─── ChainPropagationAgent ───────────────────────────────────────────────

describe('ChainPropagationAgent', () => {
  const agent = new ChainPropagationAgent();

  it('no elimination when maxGap is MAX_VALUE (no constraint)', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP'); // no maxGap
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_4PM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[TUE_8AM, TUE_4PM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.eliminated).toBe(0);
  });

  it('forward elimination — successor unreachable within maxGap', () => {
    // PREP ends Mon, PLAY starts Tue — gap = 16 hours > maxGap of 1 hour
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', H); // maxGap = 1 hour

    // PREP: only Mon 8-9 AM (ends at MON_8AM + H)
    // PLAY: only Tue 8 AM start (starts at TUE_8AM, gap = 23 hours)
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_8AM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[TUE_8AM, TUE_8AM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(false);
    expect(result.infeasiblePhase).toBe('Play');
  });

  it('forward truncation — successor start times tightened to pred earliest end', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 10 * H); // generous maxGap

    // PREP: starts at MON_8AM, ends at MON_8AM + H (9 AM)
    // PLAY: eStart=MON_8AM (8 AM, before PREP ends), lStart=MON_4PM
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_8AM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[MON_8AM, MON_4PM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.truncated).toBeGreaterThan(0);

    // PLAY's eStartW should be tightened forward to at least PREP's earliest end
    const playEntry = chain.phases[1].entries[0];
    expect(playEntry.startTimes[0].eStartW).toBeGreaterThanOrEqual(MON_8AM + H);
  });

  it('backward elimination — predecessor cannot reach successor', () => {
    // PREP can only end Fri, PLAY can only start Mon — gap is negative (pred after succ)
    const FRI_8AM = T0 + 4 * 24 * H;
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', H);

    // PREP: only Fri context
    // PLAY: only Mon context (starts before PREP ends — impossible)
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[FRI_8AM, FRI_8AM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[MON_8AM, MON_8AM, H]])] },
    ]);

    const result = agent.propagate(chain);
    // Forward pass: PLAY's latestEnd (MON_8AM + H) < PREP's earliestEnd (FRI_8AM + H)
    // → PLAY eliminated → infeasible
    expect(result.feasible).toBe(false);
  });

  it('backward truncation — predecessor end tightened by successor start', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 10 * H);

    // PREP: wide range Mon 8 AM - Tue 4 PM
    // PLAY: narrow range Tue 8 AM - Tue 8 AM (only Tue 8 AM)
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, TUE_4PM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[TUE_8AM, TUE_8AM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);

    // PREP's lEndW should be tightened: pred can't end after succ's latest start
    const prepEntry = chain.phases[0].entries[0];
    expect(prepEntry.startTimes[0].lEndW).toBeLessThanOrEqual(TUE_8AM);
  });

  it('convergence in 1 pass for simple 2-phase chain', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 2 * H);

    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_4PM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[MON_8AM + 2 * H, MON_4PM + 2 * H, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.passes).toBe(1);
  });

  it('multi-pass convergence — cascading elimination', () => {
    // 3-phase chain: A → B → C, each with maxGap = 1 hour
    // A has two contexts: early (Mon 8AM) and late (Wed 8AM)
    // B has one context: Mon 10AM (within 1hr of A-early, but not A-late)
    // C has one context: Mon 12PM (within 1hr of B)
    // Forward pass 1: A-late context can't reach B (gap = 2 days > 1hr) → not eliminated directly
    //   but B's entry can't be reached from A-late → B tightened
    // Backward pass 1: A-late can't reach B → A-late eliminated
    const tA = makeTask('C1-A', 'A', 1, 'C1', '');
    const tB = makeTask('C1-B', 'B', 2, 'C1', 'C1-A', H);
    const tC = makeTask('C1-C', 'C', 3, 'C1', 'C1-B', H);

    const chain = buildChain('C1', [
      { task: tA, contexts: [
        makeContext(tA, [[MON_8AM, MON_8AM, H]]),     // ends Mon 9AM
        makeContext(tA, [[WED_8AM, WED_8AM, H]]),     // ends Wed 9AM
      ]},
      { task: tB, contexts: [makeContext(tB, [[MON_8AM + H, MON_8AM + 2 * H, H]])] }, // Mon 9-10 AM range
      { task: tC, contexts: [makeContext(tC, [[MON_8AM + 2 * H, MON_8AM + 3 * H, H]])] }, // Mon 10-11 AM range
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    // A's Wed context should be eliminated (can't reach B within maxGap)
    expect(result.eliminated).toBeGreaterThanOrEqual(1);
    const aEntries = chain.phases[0].entries.filter(e => !e.eliminated);
    expect(aEntries.length).toBe(1);
    expect(aEntries[0].earliestStart).toBe(MON_8AM);
  });

  it('infeasible chain — all entries eliminated', () => {
    // PREP only Mon, PLAY only Wed, maxGap = 1 hour — unreachable
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', H);

    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_8AM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[WED_8AM, WED_8AM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(false);
    expect(result.infeasiblePhase).toBeDefined();
    expect(result.infeasibleReason).toContain('eliminated');
  });

  it('two-task chain works correctly', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 2 * H);

    // PREP ends at MON_8AM + H. PLAY starts at MON_8AM + H (right after). Gap = 0 < 2hr.
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_8AM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[MON_8AM + H, MON_8AM + H, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.eliminated).toBe(0);
  });

  it('chain without maxGap — no eliminations', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP'); // no maxGap
    const t3 = makeTask('C1-RESET', 'Reset', 3, 'C1', 'C1-PLAY'); // no maxGap

    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_4PM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[TUE_8AM, TUE_4PM, H]])] },
      { task: t3, contexts: [makeContext(t3, [[WED_8AM, WED_8AM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.eliminated).toBe(0);
  });

  it('eliminated contexts have their startTimes cleared', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', H);

    // Two PLAY contexts: one reachable, one not
    const reachableCtx = makeContext(t2, [[MON_8AM + H, MON_8AM + H, H]]);   // right after PREP
    const unreachableCtx = makeContext(t2, [[WED_8AM, WED_8AM, H]]);           // 2 days later

    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_8AM, H]])] },
      { task: t2, contexts: [reachableCtx, unreachableCtx] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.eliminated).toBeGreaterThanOrEqual(1);

    // The unreachable context's linked list should have been cleared by removeCollapsedStartTimes
    // or marked as eliminated
    const eliminatedEntries = chain.phases[1].entries.filter(e => e.eliminated);
    expect(eliminatedEntries.length).toBe(1);
  });

  it('backward propagation raises predecessor eStartW via truncateEndTimesFloor (maxGap=0)', () => {
    // Setup: window 6:00-7:00, 15 min duration
    // Proc:  window 7:00-8:00, 30 min duration, maxGap=0
    // Backward: Proc can't start before 7:00 → Setup must end >= 7:00
    //   → Setup eStartW raised from 6:00 to 6:45 (7:00 - 15min)
    const SETUP_START = T0;            // 6:00
    const SETUP_END = T0 + H;         // 7:00
    const SETUP_DUR = 15 * 60;        // 15 min
    const PROC_START = T0 + H;        // 7:00
    const PROC_END = T0 + 2 * H;     // 8:00
    const PROC_DUR = 30 * 60;        // 30 min

    const tSetup = makeTask('C1-SETUP', 'Setup', 1, 'C1', '');
    tSetup.duration = new CTPDuration(SETUP_DUR, 1);

    const tProc = makeTask('C1-PROC', 'Proc', 2, 'C1', 'C1-SETUP', 0); // maxGap=0
    tProc.duration = new CTPDuration(PROC_DUR, 1);

    // Setup: eStart=6:00, lStart=7:00-15min=6:45, dur=15min
    // Proc:  eStart=7:00, lStart=8:00-30min=7:30, dur=30min
    const chain = buildChain('C1', [
      { task: tSetup, contexts: [makeContext(tSetup, [[SETUP_START, SETUP_END - SETUP_DUR, SETUP_DUR]])] },
      { task: tProc, contexts: [makeContext(tProc, [[PROC_START, PROC_END - PROC_DUR, PROC_DUR]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);
    expect(result.truncated).toBeGreaterThan(0);

    // Setup's eStartW should be raised to 6:45 (must end at 7:00 to meet Proc with maxGap=0)
    const setupEntry = chain.phases[0].entries[0];
    const expectedStart = PROC_START - SETUP_DUR; // 7:00 - 15min = 6:45
    expect(setupEntry.startTimes[0].eStartW).toBe(expectedStart);
    // Setup's eEndW should be 7:00
    expect(setupEntry.startTimes[0].eEndW).toBe(PROC_START);
  });

  it('preserves start times for feasible entries', () => {
    const t1 = makeTask('C1-PREP', 'Prep', 1, 'C1', '');
    const t2 = makeTask('C1-PLAY', 'Play', 2, 'C1', 'C1-PREP', 4 * H);

    // PREP: Mon 8-9AM. PLAY: Mon 9AM-4PM. Well within maxGap.
    const chain = buildChain('C1', [
      { task: t1, contexts: [makeContext(t1, [[MON_8AM, MON_8AM, H]])] },
      { task: t2, contexts: [makeContext(t2, [[MON_8AM + H, MON_4PM, H]])] },
    ]);

    const result = agent.propagate(chain);
    expect(result.feasible).toBe(true);

    // PLAY entry should still have start times
    const playEntry = chain.phases[1].entries[0];
    expect(playEntry.eliminated).toBe(false);
    expect(playEntry.startTimes.length).toBe(1);
  });
});
