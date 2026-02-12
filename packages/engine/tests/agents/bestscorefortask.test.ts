import { describe, it, expect } from 'vitest';
import { BestScoreForTaskAgent } from '../../AI/Agents/bestscorefortask';
import { ScheduleContext, TaskScheduleContexts } from '../../Models/Entities/schedulecontext';
import { CTPTask } from '../../Models/Entities/task';
import { CTPScore } from '../../Models/Entities/score';
import { CTPResourceSlots } from '../../Models/Entities/slot';
import { CTPStartTime, CTPStartTimes } from '../../Models/Entities/starttime';
import { SchedulingLandscape } from '../../Models/Entities/landscape';

function makeContext(
  task: CTPTask,
  score: number,
  eStartW?: number,
  lStartW?: number,
): ScheduleContext {
  const landscape = new SchedulingLandscape();
  const slot = new CTPResourceSlots();

  if (eStartW !== undefined && lStartW !== undefined) {
    slot.startTimes = new CTPStartTimes();
    const st = new CTPStartTime(eStartW, eStartW + 100, lStartW, lStartW + 100, 100);
    slot.startTimes.insertAtEnd(st);
  }

  const ctx = new ScheduleContext(landscape, task, slot);
  ctx.blendedScore = new CTPScore('Blended', score);
  return ctx;
}

function makeTaskContexts(
  task: CTPTask,
  contexts: ScheduleContext[],
): TaskScheduleContexts {
  const tsc = new TaskScheduleContexts(task);
  for (const ctx of contexts) {
    tsc.contexts.add(ctx);
  }
  return tsc;
}

describe('BestScoreForTaskAgent', () => {
  it('picks lowest score across contexts', () => {
    const agent = new BestScoreForTaskAgent();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');

    const ctx1 = makeContext(task, 10, 0, 100);
    const ctx2 = makeContext(task, 5, 50, 150);
    const ctx3 = makeContext(task, 15, 200, 300);

    const tsc = makeTaskContexts(task, [ctx1, ctx2, ctx3]);
    agent.solve([tsc]);

    expect(task.score).toBe(5);
  });

  it('sets feasible interval from earliest/latest starts', () => {
    const agent = new BestScoreForTaskAgent();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');

    const ctx1 = makeContext(task, 10, 100, 500);
    const ctx2 = makeContext(task, 5, 50, 400);

    const tsc = makeTaskContexts(task, [ctx1, ctx2]);
    agent.solve([tsc]);

    expect(task.feasible).not.toBeNull();
    // First context sets st=100, et=500
    // Second context: eStartW=50 < st=100 → st becomes 50
    // Second context: lStartW=400 < et=500 → et becomes 400
    expect(task.feasible!.startW).toBe(50);
    expect(task.feasible!.endW).toBe(400);
  });

  it('handles null schedules without error', () => {
    const agent = new BestScoreForTaskAgent();
    expect(() => agent.solve(null as any)).not.toThrow();
  });

  it('handles contexts without start times', () => {
    const agent = new BestScoreForTaskAgent();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');

    // Context with no startTimes on slot
    const ctx = makeContext(task, 10);
    const tsc = makeTaskContexts(task, [ctx]);
    agent.solve([tsc]);

    // Score should still be set even without start times
    expect(task.score).toBe(10);
    // But feasible should remain null since no start times
    expect(task.feasible).toBeNull();
  });

  it('resets score before computing', () => {
    const agent = new BestScoreForTaskAgent();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');
    task.score = 3; // Pre-set score

    const ctx = makeContext(task, 10, 0, 100);
    const tsc = makeTaskContexts(task, [ctx]);
    agent.solve([tsc]);

    // resetScore() sets to MAX_VALUE, then solve sets to 10
    expect(task.score).toBe(10);
  });

  it('handles multiple tasks independently', () => {
    const agent = new BestScoreForTaskAgent();
    const task1 = new CTPTask('PROCESS', 'Task1', 'T1');
    const task2 = new CTPTask('PROCESS', 'Task2', 'T2');

    const ctx1 = makeContext(task1, 10, 0, 100);
    const ctx2 = makeContext(task2, 20, 50, 200);

    const tsc1 = makeTaskContexts(task1, [ctx1]);
    const tsc2 = makeTaskContexts(task2, [ctx2]);

    agent.solve([tsc1, tsc2]);

    expect(task1.score).toBe(10);
    expect(task2.score).toBe(20);
  });
});
