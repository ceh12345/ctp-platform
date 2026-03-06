import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChainContextEngine,
  findBlockers,
  getChainPriority,
  selectBumpCandidate,
  unscheduleChain,
  markChainInfeasible,
  BlockerInfo,
  BumpEvent,
} from '../../Engines/chaincontextengine';
import { ScheduleContext, ScheduleContexts, BestScheduleContext } from '../../Models/Entities/schedulecontext';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPProcess } from '../../Models/Entities/process';
import { CTPTask, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResource, CTPResourcePreference, CTPResources } from '../../Models/Entities/resource';
import { CTPResourceSlot, CTPResourceSlots } from '../../Models/Entities/slot';
import { CTPStartTime, CTPStartTimes } from '../../Models/Entities/starttime';
import { CTPLinkId } from '../../Models/Core/linkid';
import { CTPHorizon } from '../../Models/Entities/horizon';
import { CTPInterval, CTPDuration } from '../../Models/Core/window';
import { CTPAvailable } from '../../Models/Intervals/intervals';
import {
  CTPTaskStateConstants,
  CTPResourceConstants,
  CTPDurationConstants,
} from '../../Models/Core/constants';
import { DateTime } from 'luxon';
import {
  makeChainTask,
  makeChain,
  makeScheduleContext,
  makeMultiResourceContext,
  makeResource,
  makeScoring,
} from '../helpers/builders';

// ═══════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════

const ONE_HOUR = 3600;

function makeLandscape(): SchedulingLandscape {
  const st = DateTime.fromObject({ year: 2025, month: 5, day: 12 });
  const et = st.plus({ days: 7 });
  const landscape = new SchedulingLandscape(st, et);
  return landscape;
}

function makeAvailBlock(dayOffset: number, startHour: number, endHour: number, horizonStart: number): { s: number; e: number; q?: number }[] {
  return [{ s: horizonStart + dayOffset * 86400 + startHour * ONE_HOUR, e: horizonStart + dayOffset * 86400 + endHour * ONE_HOUR }];
}

function buildResource(name: string, key: string, landscape: SchedulingLandscape, dayAvails: { day: number; startH: number; endH: number }[]): CTPResource {
  const res = makeResource(name, key);
  const avail = new CTPAvailable();
  for (const da of dayAvails) {
    const s = landscape.horizon.startW + da.day * 86400 + da.startH * ONE_HOUR;
    const e = landscape.horizon.startW + da.day * 86400 + da.endH * ONE_HOUR;
    avail.add(new CTPInterval(s, e, 1));
  }
  res.original = avail;
  res.available.setOriginal(res.original);
  landscape.resources.addEntity(res);
  return res;
}

function buildBasicScoring(): CTPScoring {
  return makeScoring([{ name: 'StartTimeScore', weight: 1.0 }]);
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('ChainContextEngine', () => {
  let engine: ChainContextEngine;
  let landscape: SchedulingLandscape;
  let scoring: CTPScoring;

  beforeEach(() => {
    engine = new ChainContextEngine();
    landscape = makeLandscape();
    scoring = buildBasicScoring();
  });

  // ── Lane Detection ──────────────────────────────────────────

  describe('Lane Detection', () => {
    it('should detect healthcare OR lane (shared primary resource)', () => {
      const setup = makeChainTask({
        name: 'Setup', key: 'SETUP', duration: 1800,
        linkName: 'CASE-1', sequence: 1,
        resources: [{ key: 'OR-01', isPrimary: true }, { key: 'RN-01', isPrimary: false }],
      });
      const proc = makeChainTask({
        name: 'Procedure', key: 'PROC', duration: 7200,
        linkName: 'CASE-1', prevLink: 'SETUP', maxGap: 0, sequence: 2,
        resources: [{ key: 'OR-01', isPrimary: true }, { key: 'DR-01', isPrimary: false }],
      });
      const chain = makeChain('CASE-1', [setup, proc]);

      const lanes = engine.detectLanes(chain.tasks!);

      expect(lanes.length).toBeGreaterThanOrEqual(1);
      expect(lanes[0].resourceKeys).toContain('OR-01');
      expect(lanes[0].taskKeys).toContain('SETUP');
      expect(lanes[0].taskKeys).toContain('PROC');
    });

    it('should detect manufacturing machine lane', () => {
      const op1 = makeChainTask({
        name: 'Op1', key: 'OP1', duration: 3600,
        linkName: 'JOB-1', sequence: 1,
        resources: [{ key: 'MACHINE-A', isPrimary: true }],
      });
      const op2 = makeChainTask({
        name: 'Op2', key: 'OP2', duration: 3600,
        linkName: 'JOB-1', prevLink: 'OP1', sequence: 2,
        resources: [{ key: 'MACHINE-A', isPrimary: true }],
      });
      const chain = makeChain('JOB-1', [op1, op2]);

      const lanes = engine.detectLanes(chain.tasks!);

      expect(lanes.length).toBeGreaterThanOrEqual(1);
      expect(lanes[0].resourceKeys).toContain('MACHINE-A');
    });

    it('should return no lanes when no primary resources overlap', () => {
      const task1 = makeChainTask({
        name: 'Task1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'Task2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        resources: [{ key: 'RES-B', isPrimary: true }],
      });
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const lanes = engine.detectLanes(chain.tasks!);

      expect(lanes.length).toBe(0);
    });

    it('should bypass lane detection for single-task chains', () => {
      const task = makeChainTask({
        name: 'Solo', key: 'SOLO', duration: 3600,
        linkName: 'CHAIN-1', sequence: 1,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const chain = makeChain('CHAIN-1', [task]);

      const lanes = engine.detectLanes(chain.tasks!);

      // With only one task, no pair exists so no lanes
      expect(lanes.length).toBe(0);
    });
  });

  // ── Propagation ─────────────────────────────────────────────

  describe('Timing Propagation', () => {
    it('should propagate forward floor — successor can\'t start before predecessor ends', () => {
      const or01 = buildResource('OR-01', 'OR-01', landscape, [{ day: 0, startH: 6, endH: 18 }]);

      const hStart = landscape.horizon.startW;
      const setup = makeChainTask({
        name: 'Setup', key: 'SETUP', duration: 1800,
        linkName: 'CASE-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      const proc = makeChainTask({
        name: 'Proc', key: 'PROC', duration: 7200,
        linkName: 'CASE-1', prevLink: 'SETUP', maxGap: null, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });

      landscape.tasks.addEntity(setup);
      landscape.tasks.addEntity(proc);
      const chain = makeChain('CASE-1', [setup, proc]);

      const allContexts = new ScheduleContexts();
      const setupStart = hStart + 6 * ONE_HOUR;
      const ctx1 = makeScheduleContext(landscape, setup, or01, [
        { eStartW: setupStart, lStartW: setupStart + ONE_HOUR, duration: 1800 },
      ]);
      const ctx2 = makeScheduleContext(landscape, proc, or01, [
        { eStartW: setupStart, lStartW: setupStart + 8 * ONE_HOUR, duration: 7200 },
      ]);
      allContexts.addEntity(ctx1);
      allContexts.addEntity(ctx2);

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.feasible).toBe(true);
      // Proc's earliest start should be >= Setup's earliest end
      expect(combo!.startTimes[1].eStartW).toBeGreaterThanOrEqual(
        combo!.startTimes[0].eStartW + 1800
      );
    });

    it('should enforce maxGap=0 (back-to-back)', () => {
      const or01 = buildResource('OR-01', 'OR-01', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const setup = makeChainTask({
        name: 'Setup', key: 'SETUP', duration: 1800,
        linkName: 'CASE-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      const proc = makeChainTask({
        name: 'Proc', key: 'PROC', duration: 3600,
        linkName: 'CASE-1', prevLink: 'SETUP', maxGap: 0, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });

      landscape.tasks.addEntity(setup);
      landscape.tasks.addEntity(proc);
      const chain = makeChain('CASE-1', [setup, proc]);

      const allContexts = new ScheduleContexts();
      const setupStart = hStart + 6 * ONE_HOUR;
      allContexts.addEntity(makeScheduleContext(landscape, setup, or01, [
        { eStartW: setupStart, lStartW: setupStart + 2 * ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, proc, or01, [
        { eStartW: setupStart, lStartW: setupStart + 8 * ONE_HOUR, duration: 3600 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.feasible).toBe(true);

      // With maxGap=0, proc's latest start is constrained to pred's latest end
      const predLatestEnd = combo!.startTimes[0].lEndW;
      expect(combo!.startTimes[1].lStartW).toBeLessThanOrEqual(predLatestEnd);
    });

    it('should enforce maxGap=900 (15 min transfer window)', () => {
      const or01 = buildResource('OR-01', 'OR-01', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const rec01 = buildResource('REC-01', 'REC-01', landscape, [{ day: 0, startH: 6, endH: 22 }]);
      const hStart = landscape.horizon.startW;

      const proc = makeChainTask({
        name: 'Proc', key: 'PROC', duration: 7200,
        linkName: 'CASE-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      const rec = makeChainTask({
        name: 'Recovery', key: 'REC', duration: 3600,
        linkName: 'CASE-1', prevLink: 'PROC', maxGap: 900, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'REC-01', isPrimary: true }],
      });

      landscape.tasks.addEntity(proc);
      landscape.tasks.addEntity(rec);
      const chain = makeChain('CASE-1', [proc, rec]);

      const allContexts = new ScheduleContexts();
      const procStart = hStart + 6 * ONE_HOUR;
      allContexts.addEntity(makeScheduleContext(landscape, proc, or01, [
        { eStartW: procStart, lStartW: procStart + 2 * ONE_HOUR, duration: 7200 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, rec, rec01, [
        { eStartW: procStart, lStartW: procStart + 10 * ONE_HOUR, duration: 3600 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.feasible).toBe(true);

      // With maxGap=900, rec's latest start is pred's latest end + 900
      const predLatestEnd = combo!.startTimes[0].lEndW;
      expect(combo!.startTimes[1].lStartW).toBeLessThanOrEqual(predLatestEnd + 900);
    });

    it('should mark infeasible when propagation causes window collapse', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      // Setup has a very late window, but proc has maxGap=0 and a very early window
      const setup = makeChainTask({
        name: 'Setup', key: 'SETUP', duration: 3600,
        linkName: 'CASE-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const proc = makeChainTask({
        name: 'Proc', key: 'PROC', duration: 3600,
        linkName: 'CASE-1', prevLink: 'SETUP', maxGap: 0, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(setup);
      landscape.tasks.addEntity(proc);
      const chain = makeChain('CASE-1', [setup, proc]);

      const allContexts = new ScheduleContexts();
      // Setup starts late, proc only available early — should collapse with maxGap=0
      const lateStart = hStart + 14 * ONE_HOUR;
      const earlyEnd = hStart + 8 * ONE_HOUR;
      allContexts.addEntity(makeScheduleContext(landscape, setup, res, [
        { eStartW: lateStart, lStartW: lateStart, duration: 3600 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, proc, res, [
        { eStartW: hStart + 6 * ONE_HOUR, lStartW: earlyEnd, duration: 3600 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      // Should be null because no feasible combo exists
      expect(combo).toBeNull();
    });

    it('should propagate bidirectionally (forward + backward)', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', maxGap: 0, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task3 = makeChainTask({
        name: 'T3', key: 'T3', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T2', maxGap: 0, sequence: 3,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);
      landscape.tasks.addEntity(task3);
      const chain = makeChain('CHAIN-1', [task1, task2, task3]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;
      allContexts.addEntity(makeScheduleContext(landscape, task1, res, [
        { eStartW: baseStart, lStartW: baseStart + 4 * ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, task2, res, [
        { eStartW: baseStart, lStartW: baseStart + 6 * ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, task3, res, [
        { eStartW: baseStart, lStartW: baseStart + 3 * ONE_HOUR, duration: 1800 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.feasible).toBe(true);

      // Backward pass should tighten T1 and T2's latest based on T3
      const t3LatestStart = combo!.startTimes[2].lStartW;
      expect(combo!.startTimes[1].lStartW).toBeLessThanOrEqual(t3LatestStart - 1800);
      expect(combo!.startTimes[0].lStartW).toBeLessThanOrEqual(combo!.startTimes[1].lStartW - 1800);
    });
  });

  // ── Cross-Product ───────────────────────────────────────────

  describe('Cross-Product', () => {
    it('should filter combos by lane resource', () => {
      const or01 = buildResource('OR-01', 'OR-01', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const or02 = buildResource('OR-02', 'OR-02', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      // Both tasks have OR-01 and OR-02 as primary options
      const setup = makeChainTask({
        name: 'Setup', key: 'SETUP', duration: 1800,
        linkName: 'CASE-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      // Add OR-02 preference
      setup.capacityResources?.at(0)?.preferences.push(new CTPResourcePreference('OR-02', 2));

      const proc = makeChainTask({
        name: 'Proc', key: 'PROC', duration: 3600,
        linkName: 'CASE-1', prevLink: 'SETUP', maxGap: 0, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      proc.capacityResources?.at(0)?.preferences.push(new CTPResourcePreference('OR-02', 2));

      landscape.tasks.addEntity(setup);
      landscape.tasks.addEntity(proc);
      const chain = makeChain('CASE-1', [setup, proc]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;

      // Create contexts for each resource combination
      allContexts.addEntity(makeScheduleContext(landscape, setup, or01, [
        { eStartW: baseStart, lStartW: baseStart + 4 * ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, setup, or02, [
        { eStartW: baseStart, lStartW: baseStart + 4 * ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, proc, or01, [
        { eStartW: baseStart, lStartW: baseStart + 8 * ONE_HOUR, duration: 3600 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, proc, or02, [
        { eStartW: baseStart, lStartW: baseStart + 8 * ONE_HOUR, duration: 3600 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      // Both tasks in the winning combo should use the same OR
      const setupRes = combo!.contexts[0].slot.resources?.at(0)?.resource?.key;
      const procRes = combo!.contexts[1].slot.resources?.at(0)?.resource?.key;
      expect(setupRes).toBe(procRes);
    });

    it('should cap combos when total exceeds maxChainCombos', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;

      // Create many contexts for task1 to trigger capping
      for (let i = 0; i < 10; i++) {
        allContexts.addEntity(makeScheduleContext(landscape, task1, res, [
          { eStartW: baseStart + i * 600, lStartW: baseStart + i * 600 + ONE_HOUR, duration: 1800 },
        ]));
      }
      for (let i = 0; i < 10; i++) {
        allContexts.addEntity(makeScheduleContext(landscape, task2, res, [
          { eStartW: baseStart + i * 600, lStartW: baseStart + i * 600 + ONE_HOUR, duration: 1800 },
        ]));
      }

      // With maxCombos=5, should cap and still produce a result
      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring, 5);

      expect(combo).not.toBeNull();
      expect(combo!.feasible).toBe(true);
    });
  });

  // ── Scoring ─────────────────────────────────────────────────

  describe('Chain Scoring', () => {
    it('should prefer zero-gap chains', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;

      // Context with tight window (small gap)
      allContexts.addEntity(makeScheduleContext(landscape, task1, res, [
        { eStartW: baseStart, lStartW: baseStart, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, task2, res, [
        { eStartW: baseStart + 1800, lStartW: baseStart + 1800, duration: 1800 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.totalGap).toBe(0);
    });

    it('should include gap penalty in chain score', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;

      // Context with 1-hour gap between tasks
      allContexts.addEntity(makeScheduleContext(landscape, task1, res, [
        { eStartW: baseStart, lStartW: baseStart, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, task2, res, [
        { eStartW: baseStart + 1800 + ONE_HOUR, lStartW: baseStart + 1800 + ONE_HOUR, duration: 1800 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.totalGap).toBe(ONE_HOUR);
      // Gap penalty should be (3600/60) * 0.1 = 6.0 added to chain score
      expect(combo!.chainScore).toBeGreaterThan(0);
    });
  });

  // ── Assign & Commit ─────────────────────────────────────────

  describe('Assign Start Times', () => {
    it('should assign first task to earliest start and chain subsequent tasks', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 3600,
        linkName: 'CHAIN-1', prevLink: 'T1', maxGap: 0, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;
      allContexts.addEntity(makeScheduleContext(landscape, task1, res, [
        { eStartW: baseStart, lStartW: baseStart + ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, task2, res, [
        { eStartW: baseStart, lStartW: baseStart + 4 * ONE_HOUR, duration: 3600 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);
      expect(combo).not.toBeNull();

      engine.assignStartTimes(combo!);

      // First task assigned at its earliest start
      expect(combo!.startTimes[0].assignedStart).toBe(baseStart);
      // Second task must start at pred end (maxGap=0)
      expect(combo!.startTimes[1].assignedStart).toBe(baseStart + 1800);
      expect(combo!.startTimes[1].assignedEnd).toBe(baseStart + 1800 + 3600);
    });
  });

  // ── Bump Decisions ──────────────────────────────────────────

  describe('Bump Decisions', () => {
    it('should select lower-priority blocker for bumping', () => {
      const blockers: BlockerInfo[] = [
        {
          blockedChainKey: 'HIGH', blockedChainPriority: 1,
          resourceKey: 'OR-01', blockerTaskKey: 'LOW-PROC',
          blockerChainKey: 'LOW', blockerChainPriority: 5,
          blockWindow: { start: 100, end: 200 },
        },
      ];

      const candidate = selectBumpCandidate(blockers, new Set());
      expect(candidate).not.toBeNull();
      expect(candidate!.blockerChainKey).toBe('LOW');
    });

    it('should not bump higher-priority chains', () => {
      const blockers: BlockerInfo[] = [
        {
          blockedChainKey: 'LOW', blockedChainPriority: 5,
          resourceKey: 'OR-01', blockerTaskKey: 'HIGH-PROC',
          blockerChainKey: 'HIGH', blockerChainPriority: 1,
          blockWindow: { start: 100, end: 200 },
        },
      ];

      const candidate = selectBumpCandidate(blockers, new Set());
      expect(candidate).toBeNull();
    });

    it('should not bump equal-priority chains', () => {
      const blockers: BlockerInfo[] = [
        {
          blockedChainKey: 'A', blockedChainPriority: 3,
          resourceKey: 'OR-01', blockerTaskKey: 'B-PROC',
          blockerChainKey: 'B', blockerChainPriority: 3,
          blockWindow: { start: 100, end: 200 },
        },
      ];

      const candidate = selectBumpCandidate(blockers, new Set());
      expect(candidate).toBeNull();
    });

    it('should skip already-bumped chains', () => {
      const blockers: BlockerInfo[] = [
        {
          blockedChainKey: 'HIGH', blockedChainPriority: 1,
          resourceKey: 'OR-01', blockerTaskKey: 'LOW-PROC',
          blockerChainKey: 'LOW', blockerChainPriority: 5,
          blockWindow: { start: 100, end: 200 },
        },
      ];

      const bumpedChains = new Set(['LOW']);
      const candidate = selectBumpCandidate(blockers, bumpedChains);
      expect(candidate).toBeNull();
    });

    it('should pick the most expendable (lowest priority) blocker from multiple', () => {
      const blockers: BlockerInfo[] = [
        {
          blockedChainKey: 'HIGH', blockedChainPriority: 1,
          resourceKey: 'OR-01', blockerTaskKey: 'MED-PROC',
          blockerChainKey: 'MED', blockerChainPriority: 3,
          blockWindow: { start: 100, end: 200 },
        },
        {
          blockedChainKey: 'HIGH', blockedChainPriority: 1,
          resourceKey: 'OR-01', blockerTaskKey: 'LOW-PROC',
          blockerChainKey: 'LOW', blockerChainPriority: 8,
          blockWindow: { start: 100, end: 200 },
        },
      ];

      const candidate = selectBumpCandidate(blockers, new Set());
      expect(candidate).not.toBeNull();
      expect(candidate!.blockerChainKey).toBe('LOW'); // 8 is most expendable
    });
  });

  // ── Chain Priority ──────────────────────────────────────────

  describe('Chain Priority', () => {
    it('should return min priority across chain tasks', () => {
      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1, priority: 3,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2, priority: 1,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const priority = getChainPriority(chain, landscape);
      expect(priority).toBe(1);
    });

    it('should return MAX_VALUE for undefined chain', () => {
      const priority = getChainPriority(undefined, landscape);
      expect(priority).toBe(Number.MAX_VALUE);
    });
  });

  // ── Unschedule Chain ────────────────────────────────────────

  describe('Unschedule Chain', () => {
    it('should unschedule all scheduled tasks in a chain', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);

      // Mark as scheduled
      task1.state = CTPTaskStateConstants.SCHEDULED;
      task1.scheduled = new CTPInterval(hStart + 6 * ONE_HOUR, hStart + 6 * ONE_HOUR + 1800);
      task2.state = CTPTaskStateConstants.SCHEDULED;
      task2.scheduled = new CTPInterval(hStart + 6 * ONE_HOUR + 1800, hStart + 6 * ONE_HOUR + 3600);

      const chain = makeChain('CHAIN-1', [task1, task2]);
      const allContexts = new ScheduleContexts();

      unscheduleChain(chain, landscape, allContexts);

      expect(task1.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
      expect(task2.state).toBe(CTPTaskStateConstants.NOT_SCHEDULED);
    });
  });

  // ── Mark Infeasible ─────────────────────────────────────────

  describe('Mark Infeasible', () => {
    it('should add errors to unscheduled tasks only', () => {
      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      // T1 is scheduled, T2 is not
      task1.state = CTPTaskStateConstants.SCHEDULED;
      task2.state = CTPTaskStateConstants.NOT_SCHEDULED;

      const chain = makeChain('CHAIN-1', [task1, task2]);
      markChainInfeasible(chain, 'Test reason');

      // T1 (scheduled) should not get error
      expect(task1.errors?.length ?? 0).toBe(0);
      // T2 (unscheduled) should get error
      expect(task2.errors?.length).toBeGreaterThan(0);
    });
  });

  // ── Full Evaluation ─────────────────────────────────────────

  describe('Full Chain Evaluation', () => {
    it('should evaluate a 3-task chain (SETUP→PROC→REC)', () => {
      const or01 = buildResource('OR-01', 'OR-01', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const rec01 = buildResource('REC-01', 'REC-01', landscape, [{ day: 0, startH: 6, endH: 22 }]);
      const hStart = landscape.horizon.startW;

      const setup = makeChainTask({
        name: 'Setup', key: 'SETUP', duration: 1800,
        linkName: 'CASE-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      const proc = makeChainTask({
        name: 'Proc', key: 'PROC', duration: 7200,
        linkName: 'CASE-1', prevLink: 'SETUP', maxGap: 0, sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'OR-01', isPrimary: true }],
      });
      const rec = makeChainTask({
        name: 'Recovery', key: 'REC', duration: 3600,
        linkName: 'CASE-1', prevLink: 'PROC', maxGap: 900, sequence: 3,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'REC-01', isPrimary: true }],
      });

      landscape.tasks.addEntity(setup);
      landscape.tasks.addEntity(proc);
      landscape.tasks.addEntity(rec);
      const chain = makeChain('CASE-1', [setup, proc, rec]);

      const allContexts = new ScheduleContexts();
      const baseStart = hStart + 6 * ONE_HOUR;
      allContexts.addEntity(makeScheduleContext(landscape, setup, or01, [
        { eStartW: baseStart, lStartW: baseStart + 4 * ONE_HOUR, duration: 1800 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, proc, or01, [
        { eStartW: baseStart, lStartW: baseStart + 8 * ONE_HOUR, duration: 7200 },
      ]));
      allContexts.addEntity(makeScheduleContext(landscape, rec, rec01, [
        { eStartW: baseStart, lStartW: baseStart + 12 * ONE_HOUR, duration: 3600 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);

      expect(combo).not.toBeNull();
      expect(combo!.feasible).toBe(true);
      expect(combo!.contexts.length).toBe(3);
      expect(combo!.startTimes.length).toBe(3);

      // Verify chain order
      engine.assignStartTimes(combo!);
      expect(combo!.startTimes[0].assignedStart).toBeLessThan(combo!.startTimes[1].assignedStart);
      expect(combo!.startTimes[1].assignedEnd).toBeLessThanOrEqual(
        combo!.startTimes[2].assignedStart + 900
      );
    });

    it('should return null when a task has no feasible contexts', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      const task1 = makeChainTask({
        name: 'T1', key: 'T1', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      const task2 = makeChainTask({
        name: 'T2', key: 'T2', duration: 1800,
        linkName: 'CHAIN-1', prevLink: 'T1', sequence: 2,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });

      landscape.tasks.addEntity(task1);
      landscape.tasks.addEntity(task2);
      const chain = makeChain('CHAIN-1', [task1, task2]);

      const allContexts = new ScheduleContexts();
      // Only add context for task1, not task2
      allContexts.addEntity(makeScheduleContext(landscape, task1, res, [
        { eStartW: hStart + 6 * ONE_HOUR, lStartW: hStart + 10 * ONE_HOUR, duration: 1800 },
      ]));

      const combo = engine.evaluateChain(chain, allContexts, landscape, scoring);
      expect(combo).toBeNull();
    });

    it('should handle pinned tasks (already scheduled)', () => {
      const res = buildResource('RES-A', 'RES-A', landscape, [{ day: 0, startH: 6, endH: 18 }]);
      const hStart = landscape.horizon.startW;

      // Single task that's already pinned
      const task = makeChainTask({
        name: 'Pinned', key: 'PINNED', duration: 1800,
        linkName: 'CHAIN-1', sequence: 1,
        windowStart: hStart, windowEnd: hStart + 86400,
        resources: [{ key: 'RES-A', isPrimary: true }],
      });
      task.pinned = true;
      task.state = CTPTaskStateConstants.SCHEDULED;

      landscape.tasks.addEntity(task);
      const chain = makeChain('CHAIN-1', [task]);

      // Pinned tasks shouldn't be re-evaluated via canSolve()
      expect(task.canSolve()).toBe(false);
    });
  });
});
