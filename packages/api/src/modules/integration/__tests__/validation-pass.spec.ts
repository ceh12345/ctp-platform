import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  SchedulingLandscape,
  CTPTask,
  CTPTasks,
  CTPOrder,
  CTPOrders,
  CTPResource,
  CTPResources,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPResourcePreference,
  CTPAvailable,
  CTPInterval,
  makeValidationError,
} from '@ctp/engine';
import { validateReferences } from '../validation-pass';

function buildMinimalLandscape(): SchedulingLandscape {
  const ls = new SchedulingLandscape(
    DateTime.utc(2026, 1, 1),
    DateTime.utc(2026, 1, 8),
    null as any,
  );
  ls.tasks     = new CTPTasks();
  ls.orders    = new CTPOrders();
  ls.resources = new CTPResources();
  return ls;
}

describe('validation-pass — Sprint 1a framework + Phase 5 piggyback', () => {
  it('empty landscape: no errors, no exceptions', () => {
    const ls = buildMinimalLandscape();
    expect(() => validateReferences(ls)).not.toThrow();
  });

  it('clean landscape: tasks keep includeInSolve = true', () => {
    const ls = buildMinimalLandscape();
    const task = new CTPTask('t', 't', 'T-1');
    ls.tasks.addEntity(task);

    validateReferences(ls);

    expect(task.schedulable).toBe(true);
    expect(task.includeInSolve).toBe(true);
  });

  it('piggyback: task with severity:error validationError → includeInSolve flips to false', () => {
    const ls = buildMinimalLandscape();
    const task = new CTPTask('t', 't', 'T-1');
    task.addValidationError(makeValidationError({
      agent:    'Hydrator',
      type:     'UNPARSEABLE_DATE',
      reason:   'windowStart is not ISO',
      severity: 'error',
      source:   'validation',
      field:    'windowStart',
    }));
    ls.tasks.addEntity(task);

    expect(task.schedulable).toBe(false);
    expect(task.includeInSolve).toBe(true);   // not flipped yet

    validateReferences(ls);

    expect(task.schedulable).toBe(false);
    expect(task.includeInSolve).toBe(false);  // ← piggyback fired
  });

  it('piggyback: task with severity:warning stays schedulable + included', () => {
    const ls = buildMinimalLandscape();
    const task = new CTPTask('t', 't', 'T-1');
    task.addValidationError(makeValidationError({
      agent:    'MappingEngine',
      type:     'NULL_MACHINE',
      reason:   'defaulted to dwell',
      severity: 'warning',
      source:   'mapping',
    }));
    ls.tasks.addEntity(task);

    validateReferences(ls);

    expect(task.schedulable).toBe(true);
    expect(task.includeInSolve).toBe(true);
    expect(task.hasWarnings()).toBe(true);
  });

  it('piggyback does NOT stomp pre-existing includeInSolve:false (user/config exclusion)', () => {
    const ls = buildMinimalLandscape();
    const task = new CTPTask('t', 't', 'T-1');
    task.includeInSolve = false;   // simulating a prior user/config exclusion
    ls.tasks.addEntity(task);

    validateReferences(ls);

    // Still false — idempotent, didn't matter that validation also wanted false
    expect(task.includeInSolve).toBe(false);
    expect(task.schedulable).toBe(true); // no validation errors attached
  });

  it('per-solve errors (task.errors) do NOT affect schedulable or includeInSolve', () => {
    const ls = buildMinimalLandscape();
    const task = new CTPTask('t', 't', 'T-1');
    task.addError('SchedulerEngine', 'no feasible slot in this run');
    ls.tasks.addEntity(task);

    validateReferences(ls);

    expect(task.schedulable).toBe(true);       // per-solve errors are transient
    expect(task.includeInSolve).toBe(true);
  });
});

describe('validation-pass — calendar coverage checks (slim-500 findings, 2026-07-30)', () => {
  function makeResource(key: string, name: string, intervals: { s: number; e: number }[] | null): CTPResource {
    // ctor is (class, type, name, key)
    const r = new CTPResource('REUSABLE', 'MACHINE', name, key);
    if (intervals) {
      const avail = new CTPAvailable();
      for (const iv of intervals) avail.add(new CTPInterval(iv.s, iv.e, 1));
      r.available.staticAvailable = avail;
    }
    return r;
  }

  function taskWithPrefs(key: string, prefs: { resource: string; mode: string }[]): CTPTask {
    const task = new CTPTask('PROCESS', key, key);
    task.capacityResources = new CTPTaskResourceList();
    const tr = new CTPTaskResource(prefs[0]?.resource, true, 0);
    for (let i = 0; i < prefs.length; i++) {
      tr.preferences.push(new CTPResourcePreference(prefs[i].resource, i + 1, prefs[i].mode));
    }
    task.capacityResources.add(tr);
    return task;
  }

  it('NO_CALENDAR: resource without availability gets a warning; covered resource does not', () => {
    const ls = buildMinimalLandscape();
    const bare = makeResource('78', 'MIKE', null);
    const covered = makeResource('36', 'DES-1', [{ s: 1000, e: 2000 }]);
    ls.resources.addEntity(bare);
    ls.resources.addEntity(covered);

    validateReferences(ls);

    expect(bare.validationErrors.some(e => e.type === 'NO_CALENDAR')).toBe(true);
    expect(covered.validationErrors.some(e => e.type === 'NO_CALENDAR')).toBe(false);
  });

  it('NO_CALENDAR_COVERAGE: REQUIRED pin to a calendar-less resource flags the task even with covered alternates (REQUIRED masks)', () => {
    const ls = buildMinimalLandscape();
    ls.resources.addEntity(makeResource('78', 'MIKE', null));
    ls.resources.addEntity(makeResource('36', 'DES-1', [{ s: 1000, e: 2000 }]));
    const task = taskWithPrefs('T-1', [
      { resource: '78', mode: 'REQUIRED' },
      { resource: '36', mode: 'AVAILABLE' },
    ]);
    ls.tasks.addEntity(task);

    validateReferences(ls);

    expect(task.validationErrors.some(e => e.type === 'NO_CALENDAR_COVERAGE')).toBe(true);
    // warning, not error — solve behavior unchanged
    expect(task.schedulable).toBe(true);
    expect(task.includeInSolve).toBe(true);
  });

  it('NO_CALENDAR_COVERAGE: distributed task with at least one covered candidate is NOT flagged', () => {
    const ls = buildMinimalLandscape();
    ls.resources.addEntity(makeResource('78', 'MIKE', null));
    ls.resources.addEntity(makeResource('36', 'DES-1', [{ s: 1000, e: 2000 }]));
    const task = taskWithPrefs('T-2', [
      { resource: '78', mode: 'PREFERRED' },
      { resource: '36', mode: 'PREFERRED' },
    ]);
    ls.tasks.addEntity(task);

    validateReferences(ls);

    expect(task.validationErrors.some(e => e.type === 'NO_CALENDAR_COVERAGE')).toBe(false);
  });

  it('NO_CALENDAR_COVERAGE: flat slot (no preferences) pointing at a calendar-less resource is flagged', () => {
    const ls = buildMinimalLandscape();
    ls.resources.addEntity(makeResource('79', 'COOPER', null));
    ls.resources.addEntity(makeResource('36', 'DES-1', [{ s: 1000, e: 2000 }])); // opens the any-calendar gate
    const task = new CTPTask('PROCESS', 'T-3', 'T-3');
    task.capacityResources = new CTPTaskResourceList();
    task.capacityResources.add(new CTPTaskResource('79', true, 0));
    ls.tasks.addEntity(task);

    validateReferences(ls);

    expect(task.validationErrors.some(e => e.type === 'NO_CALENDAR_COVERAGE')).toBe(true);
  });

  it('gate: tenant with NO calendars anywhere → no calendar warnings (synthetic/minimal setups)', () => {
    const ls = buildMinimalLandscape();
    ls.resources.addEntity(makeResource('78', 'MIKE', null));
    ls.resources.addEntity(makeResource('79', 'COOPER', null));
    const task = taskWithPrefs('T-4', [{ resource: '78', mode: 'REQUIRED' }]);
    ls.tasks.addEntity(task);

    validateReferences(ls);

    ls.resources.forEach(r => expect(r.validationErrors).toHaveLength(0));
    expect(task.validationErrors.some(e => e.type === 'NO_CALENDAR_COVERAGE')).toBe(false);
  });

  it('CALENDAR_SHORTER_THAN_HORIZON: calendar ending before horizon end warns; covering calendar does not', () => {
    const ls = buildMinimalLandscape();
    ls.horizon.endW = 10_000;
    const short = makeResource('70', 'GRAEME', [{ s: 1000, e: 5000 }]);
    const full  = makeResource('36', 'DES-1',  [{ s: 1000, e: 12_000 }]);
    ls.resources.addEntity(short);
    ls.resources.addEntity(full);

    validateReferences(ls);

    expect(short.validationErrors.some(e => e.type === 'CALENDAR_SHORTER_THAN_HORIZON')).toBe(true);
    expect(full.validationErrors.some(e => e.type === 'CALENDAR_SHORTER_THAN_HORIZON')).toBe(false);
  });
});
