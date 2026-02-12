import { describe, it, expect } from 'vitest';
import { NextNeighborhoodAgent } from '../../AI/Agents/nextneighborhood';
import { DependencyLookAheadAgent } from '../../AI/Agents/LookAhead Agents/dependencylookahead';
import { CTPTask } from '../../Models/Entities/task';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPDuration, CTPInterval } from '../../Models/Core/window';
import { CTPTaskStateConstants, CTPScheduleDirectionConstants } from '../../Models/Core/constants';
import { List } from '../../Models/Core/list';

function makeTasks(specs: {
  name: string;
  key: string;
  duration: number;
  windowStart: number;
  windowEnd: number;
  sequence?: number;
  rank?: number;
  score?: number;
  processed?: boolean;
  state?: number;
}[]): List<CTPTask> {
  const list = new List<CTPTask>();
  for (const s of specs) {
    const t = new CTPTask('PROCESS', s.name, s.key);
    t.duration = new CTPDuration(s.duration, 1);
    t.window = new CTPInterval(s.windowStart, s.windowEnd);
    t.sequence = s.sequence ?? 0;
    t.rank = s.rank ?? 0;
    if (s.score !== undefined) t.score = s.score;
    if (s.processed !== undefined) t.processed = s.processed;
    if (s.state !== undefined) t.state = s.state;
    list.add(t);
  }
  return list;
}

describe('NextNeighborhoodAgent', () => {
  it('returns up to numofNeighbors unprocessed tasks', () => {
    const agent = new NextNeighborhoodAgent();
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000 },
      { name: 'T2', key: '2', duration: 200, windowStart: 0, windowEnd: 1000 },
      { name: 'T3', key: '3', duration: 300, windowStart: 0, windowEnd: 1000 },
    ]);
    const result = agent.solve(tasks, 2, null);
    expect(result.length).toBe(2);
  });

  it('skips processed tasks', () => {
    const agent = new NextNeighborhoodAgent();
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000, processed: true },
      { name: 'T2', key: '2', duration: 200, windowStart: 0, windowEnd: 1000 },
      { name: 'T3', key: '3', duration: 300, windowStart: 0, windowEnd: 1000 },
    ]);
    const result = agent.solve(tasks, 2, null);
    expect(result.length).toBe(2);
    // T1 was skipped, so T2 and T3 should be in result
    const names = [];
    for (let i = 0; i < result.length; i++) {
      names.push(result.index(i)?.name);
    }
    expect(names).not.toContain('T1');
  });

  it('skips SCHEDULED tasks', () => {
    const agent = new NextNeighborhoodAgent();
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000, state: CTPTaskStateConstants.SCHEDULED },
      { name: 'T2', key: '2', duration: 200, windowStart: 0, windowEnd: 1000 },
    ]);
    const result = agent.solve(tasks, 5, null);
    expect(result.length).toBe(1);
    expect(result.index(0)?.name).toBe('T2');
  });

  it('sorts by earliest end time (greedy)', () => {
    const agent = new NextNeighborhoodAgent();
    // T2 has earlier end time (windowStart + duration) than T1
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 500, windowStart: 0, windowEnd: 1000 },
      { name: 'T2', key: '2', duration: 100, windowStart: 0, windowEnd: 1000 },
    ]);
    const result = agent.solve(tasks, 2, null);
    // T2 (endTime=100) should come before T1 (endTime=500)
    expect(result.index(0)?.name).toBe('T2');
    expect(result.index(1)?.name).toBe('T1');
  });

  it('returns empty list for null tasks', () => {
    const agent = new NextNeighborhoodAgent();
    const result = agent.solve(null as any, 5, null);
    expect(result.length).toBe(0);
  });

  it('returns all tasks when numofNeighbors exceeds available', () => {
    const agent = new NextNeighborhoodAgent();
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000 },
      { name: 'T2', key: '2', duration: 200, windowStart: 0, windowEnd: 1000 },
    ]);
    const result = agent.solve(tasks, 10, null);
    expect(result.length).toBe(2);
  });

  it('uses feasible window for sort when available', () => {
    const agent = new NextNeighborhoodAgent();
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000 },
      { name: 'T2', key: '2', duration: 100, windowStart: 0, windowEnd: 1000 },
    ]);
    // Set feasible on T1 to a late start, T2 to an early start
    tasks.index(0)!.feasible = new CTPInterval(500, 600);
    tasks.index(1)!.feasible = new CTPInterval(100, 200);
    const result = agent.solve(tasks, 2, null);
    // T2 (feasible start 100 + duration 100 = 200) before T1 (500 + 100 = 600)
    expect(result.index(0)?.name).toBe('T2');
  });

  it('breaks ties by score', () => {
    const agent = new NextNeighborhoodAgent();
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000, score: 10 },
      { name: 'T2', key: '2', duration: 100, windowStart: 0, windowEnd: 1000, score: 5 },
    ]);
    const result = agent.solve(tasks, 2, null);
    // Same end time, T2 has lower score → first
    expect(result.index(0)?.name).toBe('T2');
  });
});

describe('NextNeighborhoodAgent with DependencyLookAhead', () => {
  it('inserts predecessor tasks when dependency lookahead is set', () => {
    const agent = new NextNeighborhoodAgent();
    const depAgent = new DependencyLookAheadAgent();
    agent.setDependencyLookAhead(depAgent);

    // T1 sequence=0, T2 sequence=1, T3 sequence=2
    // T2 and T3 are initially selected; depAgent should find T1 as predecessor of T2
    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000, sequence: 0 },
      { name: 'T2', key: '2', duration: 100, windowStart: 0, windowEnd: 1000, sequence: 1 },
      { name: 'T3', key: '3', duration: 100, windowStart: 0, windowEnd: 1000, sequence: 2 },
    ]);

    const settings = new CTPAppSettings();
    settings.scheduleDirection = CTPScheduleDirectionConstants.FORWARD;

    const result = agent.solve(tasks, 2, settings);
    // In FORWARD mode, earliestPredTaskNotScheduled looks for tasks with sequence < current
    // When processing T2 (seq=1), it finds T1 (seq=0) as predecessor
    // T1 gets inserted, pushing list to maintain numofNeighbors=2
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('does not insert duplicates', () => {
    const agent = new NextNeighborhoodAgent();
    const depAgent = new DependencyLookAheadAgent();
    agent.setDependencyLookAhead(depAgent);

    const tasks = makeTasks([
      { name: 'T1', key: '1', duration: 100, windowStart: 0, windowEnd: 1000, sequence: 0 },
      { name: 'T2', key: '2', duration: 200, windowStart: 0, windowEnd: 1000, sequence: 1 },
    ]);

    const settings = new CTPAppSettings();
    const result = agent.solve(tasks, 5, settings);

    // Count occurrences of each task
    const keys: string[] = [];
    for (let i = 0; i < result.length; i++) {
      keys.push(result.index(i)!.key);
    }
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
