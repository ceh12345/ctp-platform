import { describe, it, expect } from 'vitest';
import { crossFilterByActiveJobs } from '../cross-filter';
import { IRawDataPayload } from '../adapter.interface';

function basePayload(overrides: Partial<IRawDataPayload> = {}): IRawDataPayload {
  return {
    resources: [],
    tasks: [],
    calendars: [],
    stateChanges: [],
    products: [],
    orders: [],
    jobs: [],
    materials: [],
    processes: [],
    cadences: [],
    uomConversions: null,
    ...overrides,
  };
}

describe('crossFilterByActiveJobs', () => {
  it('passes through unchanged when jobs array is empty', () => {
    const payload = basePayload({
      orders: [{ WoId: 1, Job: '100' }, { WoId: 2, Job: '200' }],
      tasks: [{ Id: 10, JobCode: '100' }],
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out).toBe(payload);  // identity — no copy when no work to do
  });

  it('keeps only orders whose Job is in the active set', () => {
    const payload = basePayload({
      jobs: [{ Job: '100' }, { Job: '200' }],
      orders: [
        { WoId: 1, Job: '100' },  // keep
        { WoId: 2, Job: '999' },  // drop
        { WoId: 3, Job: '200' },  // keep
      ],
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out.orders).toHaveLength(2);
    expect((out.orders as any[]).map(o => o.WoId)).toEqual([1, 3]);
  });

  it('keeps only tasks whose JobCode is in the active set', () => {
    const payload = basePayload({
      jobs: [{ Job: '100' }],
      tasks: [
        { Id: 10, JobCode: '100' },  // keep
        { Id: 11, JobCode: '999' },  // drop
        { Id: 12, JobCode: '100' },  // keep
      ],
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out.tasks).toHaveLength(2);
    expect((out.tasks as any[]).map(t => t.Id)).toEqual([10, 12]);
  });

  it('preserves records without a Job/JobCode field (lenient)', () => {
    const payload = basePayload({
      jobs: [{ Job: '100' }],
      orders: [
        { WoId: 1, Job: '100' },                    // keep — matches
        { WoId: 2 /* no Job */ },                   // keep — no FK to check
        { WoId: 3, Job: '' },                       // keep — empty FK treated as absent
        { WoId: 4, Job: null },                     // keep — null FK treated as absent
      ],
      tasks: [
        { Id: 10, JobCode: '100' },                 // keep
        { Id: 11 /* no JobCode */ },                // keep
      ],
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out.orders).toHaveLength(4);
    expect(out.tasks).toHaveLength(2);
  });

  it('uses string comparison when Job values are mixed numeric/string', () => {
    const payload = basePayload({
      jobs: [{ Job: 100 }, { Job: '200' }],
      orders: [
        { WoId: 1, Job: '100' },  // keep — numeric job 100 matches string '100'
        { WoId: 2, Job: 200 },    // keep — string job '200' matches numeric 200
      ],
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out.orders).toHaveLength(2);
  });

  it('returns same payload when jobs has entries but none with a usable Job key', () => {
    const payload = basePayload({
      jobs: [{ Job: '' }, { Job: null }, { /* no Job */ }],
      orders: [{ WoId: 1, Job: '999' }],  // would be dropped if filter ran
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out).toBe(payload);  // empty active set → pass-through
  });

  it('preserves all other payload fields', () => {
    const resources = [{ Id: 1 }];
    const calendars = [{ Id: 2 }];
    const payload = basePayload({
      jobs: [{ Job: '100' }],
      orders: [{ WoId: 1, Job: '999' }],   // will be dropped
      resources,
      calendars,
    });
    const out = crossFilterByActiveJobs(payload);
    expect(out.orders).toEqual([]);
    expect(out.resources).toBe(resources);
    expect(out.calendars).toBe(calendars);
  });
});
