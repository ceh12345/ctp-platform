import { describe, it, expect } from 'vitest';
import { DependencyLookAheadAgent } from '../../AI/Agents/LookAhead Agents/dependencylookahead';
import { CTPTask } from '../../Models/Entities/task';
import { CTPScheduleDirectionConstants, CTPTaskStateConstants } from '../../Models/Core/constants';
import { List } from '../../Models/Core/list';
import { CTPLinkId } from '../../Models/Core/linkid';

function makeTaskList(specs: {
  name: string;
  key: string;
  sequence: number;
  state?: number;
  processed?: boolean;
  linkName?: string;
}[]): List<CTPTask> {
  const list = new List<CTPTask>();
  for (const s of specs) {
    const t = new CTPTask('PROCESS', s.name, s.key);
    t.sequence = s.sequence;
    if (s.state !== undefined) t.state = s.state;
    if (s.processed !== undefined) t.processed = s.processed;
    if (s.linkName !== undefined) {
      t.linkId = new CTPLinkId();
      t.linkId.name = s.linkName;
    }
    list.add(t);
  }
  return list;
}

describe('DependencyLookAheadAgent.earliestPredTaskNotScheduled', () => {
  it('FORWARD: finds earliest unscheduled task with lower sequence', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0 },
      { name: 'T2', key: '2', sequence: 1 },
      { name: 'T3', key: '3', sequence: 2 },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 2, CTPScheduleDirectionConstants.FORWARD,
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('T1'); // First unscheduled with seq < 2
  });

  it('FORWARD: skips scheduled tasks', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0, state: CTPTaskStateConstants.SCHEDULED },
      { name: 'T2', key: '2', sequence: 1 },
      { name: 'T3', key: '3', sequence: 2 },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 2, CTPScheduleDirectionConstants.FORWARD,
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('T2'); // T1 is scheduled, T2 is first unscheduled with seq < 2
  });

  it('FORWARD: skips processed tasks', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0, processed: true },
      { name: 'T2', key: '2', sequence: 1 },
      { name: 'T3', key: '3', sequence: 2 },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 2, CTPScheduleDirectionConstants.FORWARD,
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('T2');
  });

  it('FORWARD: returns null when no predecessor exists', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 5 },
      { name: 'T2', key: '2', sequence: 6 },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 0, CTPScheduleDirectionConstants.FORWARD,
    );
    expect(result).toBeNull(); // No task with sequence < 0
  });

  it('BACKWARD: finds latest unscheduled task with higher sequence', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0 },
      { name: 'T2', key: '2', sequence: 1 },
      { name: 'T3', key: '3', sequence: 2 },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 0, CTPScheduleDirectionConstants.BACKWARD,
    );
    expect(result).not.toBeNull();
    // BACKWARD iterates from end, finds first with seq > 0
    expect(result!.name).toBe('T3');
  });

  it('BACKWARD: skips scheduled tasks', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0 },
      { name: 'T2', key: '2', sequence: 1 },
      { name: 'T3', key: '3', sequence: 2, state: CTPTaskStateConstants.SCHEDULED },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 0, CTPScheduleDirectionConstants.BACKWARD,
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe('T2'); // T3 is scheduled, T2 is last unscheduled with seq > 0
  });

  it('BACKWARD: returns null when no successor exists', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0 },
      { name: 'T2', key: '2', sequence: 1 },
    ]);

    const result = agent.earliestPredTaskNotScheduled(
      tasks, 5, CTPScheduleDirectionConstants.BACKWARD,
    );
    expect(result).toBeNull(); // No task with sequence > 5
  });
});

describe('DependencyLookAheadAgent.postschedule', () => {
  it('marks linked unscheduled tasks as processed when predecessor fails', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0, linkName: 'ProcessA', processed: true },
      { name: 'T2', key: '2', sequence: 1, linkName: 'ProcessA' },
      { name: 'T3', key: '3', sequence: 2, linkName: 'ProcessA' },
    ]);

    const task1 = tasks.index(0)!;
    // T1 is processed and NOT_SCHEDULED (failed)
    const landscape = {} as any;
    const settings = {} as any;

    agent.postschedule(landscape, tasks, task1, settings);

    // T2 and T3 should be marked as processed with errors
    const t2 = tasks.index(1)!;
    const t3 = tasks.index(2)!;
    expect(t2.processed).toBe(true);
    expect(t2.errors.length).toBeGreaterThan(0);
    expect(t3.processed).toBe(true);
    expect(t3.errors.length).toBeGreaterThan(0);
  });

  it('does not affect tasks in different link groups', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0, linkName: 'ProcessA', processed: true },
      { name: 'T2', key: '2', sequence: 1, linkName: 'ProcessB' },
    ]);

    const task1 = tasks.index(0)!;
    const landscape = {} as any;
    const settings = {} as any;

    agent.postschedule(landscape, tasks, task1, settings);

    const t2 = tasks.index(1)!;
    expect(t2.processed).toBe(false); // Different link group
  });

  it('does not re-process already processed tasks', () => {
    const agent = new DependencyLookAheadAgent();
    const tasks = makeTaskList([
      { name: 'T1', key: '1', sequence: 0, linkName: 'ProcessA', processed: true },
      { name: 'T2', key: '2', sequence: 1, linkName: 'ProcessA', processed: true },
    ]);

    const task1 = tasks.index(0)!;
    const t2 = tasks.index(1)!;
    const errorsBefore = t2.errors.length;

    const landscape = {} as any;
    const settings = {} as any;

    agent.postschedule(landscape, tasks, task1, settings);

    // T2 already processed, should not get additional errors
    expect(t2.errors.length).toBe(errorsBefore);
  });
});
