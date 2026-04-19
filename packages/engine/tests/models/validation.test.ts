import { describe, it, expect } from 'vitest';
import { CTPTask } from '../../Models/Entities/task';
import { CTPOrder } from '../../Models/Entities/order';
import { CTPResource } from '../../Models/Entities/resource';
import { makeValidationError } from '../../Models/Core/error';

describe('Sprint 1a — entity validation scaffolding', () => {
  describe('CTPTask', () => {
    it('initializes with both arrays empty', () => {
      const task = new CTPTask();
      expect(task.errors).toEqual([]);
      expect(task.validationErrors).toEqual([]);
    });

    it('is schedulable by default', () => {
      const task = new CTPTask();
      expect(task.schedulable).toBe(true);
      expect(task.hasErrors()).toBe(false);
      expect(task.hasWarnings()).toBe(false);
    });

    it('legacy addError populates per-solve errors array (NOT validationErrors)', () => {
      const task = new CTPTask();
      task.addError('TestAgent', 'no feasible schedule');
      expect(task.errors).toHaveLength(1);
      expect(task.errors[0]).toEqual({ agent: 'TestAgent', reason: 'no feasible schedule', type: '' });
      expect(task.validationErrors).toEqual([]);
    });

    it('legacy addError does NOT flip schedulable (per-solve errors stay transient)', () => {
      const task = new CTPTask();
      task.addError('SchedulerEngine', 'no feasible slot');
      expect(task.schedulable).toBe(true);          // still schedulable — per-solve fail doesn't persist
      expect(task.hasErrors()).toBe(false);
    });

    it('clearErrors wipes only per-solve errors, not validationErrors', () => {
      const task = new CTPTask();
      task.addError('X', 'y');
      task.addValidationError(makeValidationError({
        agent: 'Hydrator', type: 'UNPARSEABLE_DATE', reason: 'bad', severity: 'error', source: 'validation',
      }));
      task.clearErrors();
      expect(task.errors).toEqual([]);
      expect(task.validationErrors).toHaveLength(1);   // survives
      expect(task.schedulable).toBe(false);            // still unschedulable
    });

    it('addValidationError with severity:error flips schedulable to false', () => {
      const task = new CTPTask();
      task.addValidationError(makeValidationError({
        agent: 'Hydrator', type: 'UNPARSEABLE_DATE', reason: 'bad', severity: 'error', source: 'validation',
      }));
      expect(task.schedulable).toBe(false);
      expect(task.hasErrors()).toBe(true);
    });

    it('addValidationError with severity:warning does NOT affect schedulable', () => {
      const task = new CTPTask();
      task.addValidationError(makeValidationError({
        agent: 'MappingEngine', type: 'NULL_MACHINE', reason: 'defaulted to dwell',
        severity: 'warning', source: 'mapping',
      }));
      expect(task.schedulable).toBe(true);
      expect(task.hasWarnings()).toBe(true);
      expect(task.hasErrors()).toBe(false);
    });

    it('clearValidationErrors empties only validationErrors', () => {
      const task = new CTPTask();
      task.addValidationError(makeValidationError({
        agent: 'H', type: 'X', reason: 'r', severity: 'error', source: 'validation',
      }));
      task.addError('S', 'per-solve');
      task.clearValidationErrors();
      expect(task.validationErrors).toEqual([]);
      expect(task.errors).toHaveLength(1);            // per-solve errors untouched
      expect(task.schedulable).toBe(true);
    });

    it('addValidationError dedupes on agent+reason+field', () => {
      const task = new CTPTask();
      const err = makeValidationError({
        agent: 'Hydrator', type: 'UNPARSEABLE_DATE', reason: 'not ISO',
        severity: 'error', source: 'validation', field: 'windowStart',
      });
      task.addValidationError(err);
      task.addValidationError(err);
      expect(task.validationErrors).toHaveLength(1);
    });
  });

  describe('CTPOrder', () => {
    it('initializes with empty validationErrors', () => {
      const order = new CTPOrder();
      expect(order.validationErrors).toEqual([]);
      expect(order.hasErrors()).toBe(false);
    });

    it('addValidationError + clearValidationErrors roundtrip', () => {
      const order = new CTPOrder();
      order.addValidationError(makeValidationError({
        agent:    'Hydrator',
        type:     'UNPARSEABLE_DATE',
        reason:   'bad dueDate',
        severity: 'error',
        source:   'validation',
      }));
      expect(order.validationErrors).toHaveLength(1);
      expect(order.hasErrors()).toBe(true);
      order.clearValidationErrors();
      expect(order.validationErrors).toEqual([]);
    });
  });

  describe('CTPResource', () => {
    it('initializes with empty validationErrors', () => {
      const resource = new CTPResource();
      expect(resource.validationErrors).toEqual([]);
      expect(resource.hasErrors()).toBe(false);
    });

    it('addValidationError + clearValidationErrors roundtrip', () => {
      const resource = new CTPResource();
      resource.addValidationError(makeValidationError({
        agent:    'Hydrator',
        type:     'MISSING_CALENDAR',
        reason:   'calendar not resolvable',
        severity: 'warning',
        source:   'validation',
      }));
      expect(resource.hasWarnings()).toBe(true);
      resource.clearValidationErrors();
      expect(resource.validationErrors).toEqual([]);
    });
  });

  describe('makeValidationError factory', () => {
    it('populates detectedAt with ISO 8601 timestamp', () => {
      const err = makeValidationError({
        agent: 'X', type: 'Y', reason: 'z', severity: 'error', source: 'engine',
      });
      expect(err.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('preserves all fields from params', () => {
      const err = makeValidationError({
        agent:    'MappingEngine',
        type:     'UNPARSEABLE_DATE',
        reason:   'luxon rejected value',
        severity: 'error',
        source:   'mapping',
        field:    'windowStart',
        policy:   'annotate',
        rawValue: 'not-a-date',
      });
      expect(err).toMatchObject({
        agent:    'MappingEngine',
        type:     'UNPARSEABLE_DATE',
        reason:   'luxon rejected value',
        severity: 'error',
        source:   'mapping',
        field:    'windowStart',
        policy:   'annotate',
        rawValue: 'not-a-date',
      });
    });
  });
});
