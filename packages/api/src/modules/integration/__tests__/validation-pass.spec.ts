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
