import { describe, it, expect } from 'vitest';
import { PickBestScheduleAgent } from '../../AI/Agents/pickbestschedule';
import { ScheduleContext, TaskScheduleContexts } from '../../Models/Entities/schedulecontext';
import { CTPTask } from '../../Models/Entities/task';
import { CTPScore, CTPScoring, CTPScoringConfiguration } from '../../Models/Entities/score';
import { CTPResourceSlots } from '../../Models/Entities/slot';
import { CTPStartTime, CTPStartTimes } from '../../Models/Entities/starttime';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPScheduleDirectionConstants } from '../../Models/Core/constants';

function makeContextWithStartTimes(
  landscape: SchedulingLandscape,
  task: CTPTask,
  score: number,
  eStartW: number,
  lStartW: number,
): ScheduleContext {
  const slot = new CTPResourceSlots();
  slot.startTimes = new CTPStartTimes();
  const st = new CTPStartTime(eStartW, eStartW + 100, lStartW, lStartW + 100, 100);
  slot.startTimes.insertAtEnd(st);

  const ctx = new ScheduleContext(landscape, task, slot);
  ctx.blendedScore = new CTPScore('Blended', score);
  return ctx;
}

describe('PickBestScheduleAgent', () => {
  it('selects context matching best task score', () => {
    const agent = new PickBestScheduleAgent();
    const landscape = new SchedulingLandscape();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');
    task.score = 5; // Best score set by BestScoreForTaskAgent

    const ctx1 = makeContextWithStartTimes(landscape, task, 10, 0, 100);
    const ctx2 = makeContextWithStartTimes(landscape, task, 5, 50, 150);

    const tsc = new TaskScheduleContexts(task);
    tsc.contexts.add(ctx1);
    tsc.contexts.add(ctx2);

    const scoring = new CTPScoring('Test', 'test');
    scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
    const settings = new CTPAppSettings();

    const best = agent.solve(landscape, task, tsc, scoring, settings);
    expect(best).not.toBeNull();
    // Should pick ctx2 which has score=5 matching task.score=5
    expect(best!.best).toBe(ctx2);
  });

  it('picks earliest start in FORWARD mode', () => {
    const agent = new PickBestScheduleAgent();
    const landscape = new SchedulingLandscape();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');
    task.score = 5;

    const ctx = makeContextWithStartTimes(landscape, task, 5, 100, 500);

    const tsc = new TaskScheduleContexts(task);
    tsc.contexts.add(ctx);

    const scoring = new CTPScoring('Test', 'test');
    scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
    const settings = new CTPAppSettings();
    settings.scheduleDirection = CTPScheduleDirectionConstants.FORWARD;

    const best = agent.solve(landscape, task, tsc, scoring, settings);
    expect(best).not.toBeNull();
    // FORWARD uses head of startTimes, scheduleEarliest=true → eStartW
    expect(best!.startTime).toBe(100);
  });

  it('picks latest start in BACKWARD mode', () => {
    const agent = new PickBestScheduleAgent();
    const landscape = new SchedulingLandscape();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');
    task.score = 5;

    // Add two start time nodes
    const slot = new CTPResourceSlots();
    slot.startTimes = new CTPStartTimes();
    const st1 = new CTPStartTime(100, 200, 500, 600, 100);
    const st2 = new CTPStartTime(300, 400, 700, 800, 100);
    slot.startTimes.insertAtEnd(st1);
    slot.startTimes.insertAtEnd(st2);

    const ctx = new ScheduleContext(landscape, task, slot);
    ctx.blendedScore = new CTPScore('Blended', 5);

    const tsc = new TaskScheduleContexts(task);
    tsc.contexts.add(ctx);

    const scoring = new CTPScoring('Test', 'test');
    scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));
    const settings = new CTPAppSettings();
    settings.scheduleDirection = CTPScheduleDirectionConstants.BACKWARD;

    const best = agent.solve(landscape, task, tsc, scoring, settings);
    expect(best).not.toBeNull();
    // BACKWARD uses tail of startTimes (st2), scheduleEarliest → eStartW
    expect(best!.startTime).toBe(300);
  });

  it('adds error when no feasible schedules', () => {
    const agent = new PickBestScheduleAgent();
    const landscape = new SchedulingLandscape();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');

    const best = agent.solve(landscape, task, null, null, null);
    expect(best).toBeNull();
    expect(task.errors.length).toBeGreaterThan(0);
    expect(task.errors[0].reason).toContain('feasible');
  });

  it('adds error when no context matches best score', () => {
    const agent = new PickBestScheduleAgent();
    const landscape = new SchedulingLandscape();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');
    task.score = 5;

    // Context has score=10, doesn't match task.score=5
    const ctx = makeContextWithStartTimes(landscape, task, 10, 0, 100);
    const tsc = new TaskScheduleContexts(task);
    tsc.contexts.add(ctx);

    const scoring = new CTPScoring('Test', 'test');
    scoring.addConfig(new CTPScoringConfiguration('EarliestStartTimeScoringRule', 1.0));

    const best = agent.solve(landscape, task, tsc, scoring, null);
    expect(best).toBeNull();
    expect(task.errors.length).toBeGreaterThan(0);
  });

  it('uses lStartW when scheduleEarliest is false', () => {
    const agent = new PickBestScheduleAgent();
    const landscape = new SchedulingLandscape();
    const task = new CTPTask('PROCESS', 'Task1', 'T1');
    task.score = 5;

    const ctx = makeContextWithStartTimes(landscape, task, 5, 100, 500);

    const tsc = new TaskScheduleContexts(task);
    tsc.contexts.add(ctx);

    // LatestStartTimeScoringRule with weight > 0 makes scheduleEarliest() return false
    const scoring = new CTPScoring('Test', 'test');
    scoring.addConfig(new CTPScoringConfiguration('LatestStartTimeScoringRule', 1.0));
    const settings = new CTPAppSettings();
    settings.scheduleDirection = CTPScheduleDirectionConstants.FORWARD;

    const best = agent.solve(landscape, task, tsc, scoring, settings);
    expect(best).not.toBeNull();
    // scheduleEarliest=false → uses lStartW
    expect(best!.startTime).toBe(500);
  });
});
