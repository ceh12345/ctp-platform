import { describe, it, expect } from 'vitest';
import { RankedScheduleContexts } from '../../Solvers/RankedScheduleContexts';
import { SolverState } from '../../Solvers/SolverState';
import { BestScheduleContext, ScheduleContext } from '../../Models/Entities/schedulecontext';
import { CTPTask } from '../../Models/Entities/task';
import { CTPScore } from '../../Models/Entities/score';
import { CTPResourceSlots, CTPResourceSlot } from '../../Models/Entities/slot';
import { CTPStartTime } from '../../Models/Entities/starttime';
import { CTPResource } from '../../Models/Entities/resource';
import { SchedulingLandscape } from '../../Models/Entities/landscape';

function makeBestContext(
  taskKey: string,
  resourceKeys: string[],
  score: number,
  startTime: number = 0,
): BestScheduleContext {
  const task = new CTPTask('PROCESS', taskKey, taskKey);
  const landscape = new SchedulingLandscape();
  const slot = new CTPResourceSlots();

  resourceKeys.forEach((rk, i) => {
    const resource = new CTPResource('MACHINE', 'Resource', rk, rk);
    const rs = new CTPResourceSlot(resource, i);
    slot.resources!.add(rs);
  });

  const ctx = new ScheduleContext(landscape, task, slot);
  ctx.blendedScore = new CTPScore('Blended', score);

  const st = new CTPStartTime(startTime, startTime + 100, startTime, startTime + 100, 100);
  return new BestScheduleContext(ctx, st, startTime);
}

describe('RankedScheduleContexts', () => {
  // Test 1: Insertion maintains rank order
  it('maintains rank order by ascending score', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    [3.0, 1.0, 2.0, 1.5, 4.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.count()).toBe(5);
    expect(ranked.ranked[0].score).toBe(1.0);
    expect(ranked.ranked[1].score).toBe(1.5);
    expect(ranked.ranked[2].score).toBe(2.0);
    expect(ranked.ranked[3].score).toBe(3.0);
    expect(ranked.ranked[4].score).toBe(4.0);
  });

  // Test 2: maxN enforced — worst entry dropped
  it('enforces maxN by dropping worst entries', () => {
    const ranked = new RankedScheduleContexts('TASK-A', 3);
    [5.0, 1.0, 3.0, 2.0, 4.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.count()).toBe(3);
    expect(ranked.ranked[0].score).toBe(1.0);
    expect(ranked.ranked[1].score).toBe(2.0);
    expect(ranked.ranked[2].score).toBe(3.0);
  });

  // Test 3: best() returns rank 0
  it('best() returns the lowest-score context', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    [3.0, 1.0, 2.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.best()!.best.blendedScore.score).toBe(1.0);
  });

  // Test 4: best() returns null when empty
  it('best() returns null when empty', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    expect(ranked.best()).toBeNull();
  });

  // Test 5: alternative(rank) returns correct entry
  it('alternative(rank) returns the correct entry', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    [1.0, 2.0, 3.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.alternative(0)!.best.blendedScore.score).toBe(1.0);
    expect(ranked.alternative(1)!.best.blendedScore.score).toBe(2.0);
    expect(ranked.alternative(2)!.best.blendedScore.score).toBe(3.0);
    expect(ranked.alternative(3)).toBeNull();
    expect(ranked.alternative(-1)).toBeNull();
  });

  // Test 6: hasAlternatives
  it('hasAlternatives reflects entry count', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    expect(ranked.hasAlternatives()).toBe(false);

    ranked.addCandidate(makeBestContext('TASK-A', ['R1'], 1.0));
    expect(ranked.hasAlternatives()).toBe(false);

    ranked.addCandidate(makeBestContext('TASK-A', ['R2'], 2.0));
    expect(ranked.hasAlternatives()).toBe(true);

    ranked.addCandidate(makeBestContext('TASK-A', ['R3'], 3.0));
    ranked.addCandidate(makeBestContext('TASK-A', ['R4'], 4.0));
    ranked.addCandidate(makeBestContext('TASK-A', ['R5'], 5.0));
    expect(ranked.hasAlternatives()).toBe(true);
  });

  // Test 7: Neighborhood boundary — clear gap
  it('detects neighborhood boundary at score gap', () => {
    const ranked = new RankedScheduleContexts('TASK-A', 5, 0.15);
    [1.0, 1.05, 1.10, 2.5, 3.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.neighborhoodBoundary()).toBe(3);
    expect(ranked.withinNeighborhood().map((e) => e.score)).toEqual([1.0, 1.05, 1.10]);
    expect(ranked.outsideNeighborhood().map((e) => e.score)).toEqual([2.5, 3.0]);
  });

  // Test 8: Neighborhood boundary — no gap
  it('returns length when no gap exceeds threshold', () => {
    const ranked = new RankedScheduleContexts('TASK-A', 5, 0.15);
    [1.0, 1.05, 1.08, 1.12, 1.14].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.neighborhoodBoundary()).toBe(5);
    expect(ranked.withinNeighborhood().length).toBe(5);
    expect(ranked.outsideNeighborhood().length).toBe(0);
  });

  // Test 9: Neighborhood boundary — immediate gap
  it('detects immediate gap at rank 1', () => {
    const ranked = new RankedScheduleContexts('TASK-A', 5, 0.15);
    [1.0, 5.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.neighborhoodBoundary()).toBe(1);
    expect(ranked.withinNeighborhood().map((e) => e.score)).toEqual([1.0]);
    expect(ranked.outsideNeighborhood().map((e) => e.score)).toEqual([5.0]);
  });

  // Test 10: Neighborhood boundary — all identical scores
  it('no boundary when all scores are identical', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    [2.0, 2.0, 2.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.neighborhoodBoundary()).toBe(3);
  });

  // Test 11: Neighborhood boundary — best score is 0
  it('handles zero best score with absolute gap fallback', () => {
    const ranked = new RankedScheduleContexts('TASK-A', 5, 0.15);
    [0.0, 0.3, 0.4, 2.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    // With absolute fallback of 0.5, gap from 0.4 to 2.0 (1.6) exceeds 0.5
    expect(ranked.neighborhoodBoundary()).toBe(3);
  });

  // Test 12: removeByResourceKey
  it('removes entries matching a resource key and re-ranks', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    ranked.addCandidate(makeBestContext('TASK-A', ['CNC-01'], 1.0));
    ranked.addCandidate(makeBestContext('TASK-A', ['CNC-02'], 2.0));
    ranked.addCandidate(makeBestContext('TASK-A', ['CNC-01', 'ASSY-01'], 3.0));

    ranked.removeByResourceKey('CNC-01');

    expect(ranked.count()).toBe(1);
    expect(ranked.ranked[0].score).toBe(2.0);
    expect(ranked.ranked[0].rank).toBe(0);
  });

  // Test 13: clear()
  it('clear() empties the ranked list', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    ranked.addCandidate(makeBestContext('TASK-A', ['R1'], 1.0));
    ranked.addCandidate(makeBestContext('TASK-A', ['R2'], 2.0));
    ranked.addCandidate(makeBestContext('TASK-A', ['R3'], 3.0));

    ranked.clear();

    expect(ranked.count()).toBe(0);
    expect(ranked.best()).toBeNull();
  });

  // Test 16: Duplicate score handling
  it('keeps duplicate scores as separate entries', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    [1.0, 1.0, 2.0].forEach((s) =>
      ranked.addCandidate(makeBestContext('TASK-A', ['R1'], s)),
    );

    expect(ranked.count()).toBe(3);
    expect(ranked.ranked[0].score).toBe(1.0);
    expect(ranked.ranked[1].score).toBe(1.0);
    expect(ranked.alternative(0)!.best.blendedScore.score).toBe(1.0);
    expect(ranked.alternative(1)!.best.blendedScore.score).toBe(1.0);
  });

  // Test 17: Resource keys extracted correctly
  it('extracts resource keys from slot', () => {
    const ranked = new RankedScheduleContexts('TASK-A');
    ranked.addCandidate(makeBestContext('TASK-A', ['CNC-01', 'OPER-A'], 1.0));

    expect(ranked.ranked[0].resourceKeys).toEqual(['CNC-01', 'OPER-A']);
  });
});

describe('SolverState', () => {
  // Test 14: getRanked creates on demand
  it('getRanked creates on demand and returns same instance', () => {
    const state = new SolverState();
    const ranked = state.getRanked('TASK-A');

    expect(ranked).not.toBeNull();
    expect(ranked.taskKey).toBe('TASK-A');
    expect(state.getRanked('TASK-A')).toBe(ranked);
  });

  // Test 15: Independent per task
  it('maintains independent ranked lists per task', () => {
    const state = new SolverState();
    state.getRanked('TASK-A').addCandidate(makeBestContext('TASK-A', ['R1'], 1.0));
    state.getRanked('TASK-B').addCandidate(makeBestContext('TASK-B', ['R2'], 5.0));

    expect(state.getRanked('TASK-A').best()!.best.blendedScore.score).toBe(1.0);
    expect(state.getRanked('TASK-B').best()!.best.blendedScore.score).toBe(5.0);
  });
});
