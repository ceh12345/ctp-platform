import { SchedulingLandscape } from '@ctp/engine';
import { MappingError } from './mapping-error';

// SyncResult — structured envelope returned by /v1/state/sync (and related
// endpoints that rebuild the landscape). Additive: existing `status` and
// `summary` fields are unchanged; new fields are `mappingErrors` (populated
// by MappingEngine when a transform fails — Sprint 1b) and `validationSummary`
// (rollup over entity-level validation errors — Sprint 1b populates entity
// errors; aggregation logic here is final).

export interface ValidationSummary {
  recordsWithErrors: number;
  recordsWithWarnings: number;
  unschedulableTasks: number;
  byCode: Record<string, number>;
  byEntity: { tasks: number; orders: number; resources: number };
}

export interface SyncResultSummary {
  resources: number;
  tasks: number;
  horizon: { start: string | null; end: string | null };
  stateChanges: number;
  settings: { scheduleDirection: number };
}

export interface SyncResult {
  status: 'ok' | 'not_loaded';
  summary?: SyncResultSummary;
  mappingErrors: MappingError[];
  validationSummary: ValidationSummary;
}

export function emptyValidationSummary(): ValidationSummary {
  return {
    recordsWithErrors:   0,
    recordsWithWarnings: 0,
    unschedulableTasks:  0,
    byCode:              {},
    byEntity:            { tasks: 0, orders: 0, resources: 0 },
  };
}

export function summarizeValidation(landscape: SchedulingLandscape): ValidationSummary {
  const summary = emptyValidationSummary();

  const tally = (
    errs: { severity: string; type: string }[] | undefined,
    kind: 'tasks' | 'orders' | 'resources',
  ) => {
    if (!errs?.length) return;
    const hasError   = errs.some(e => e.severity === 'error');
    const hasWarning = !hasError && errs.some(e => e.severity === 'warning');
    if (hasError)        { summary.recordsWithErrors++;   summary.byEntity[kind]++; }
    else if (hasWarning) { summary.recordsWithWarnings++; summary.byEntity[kind]++; }
    for (const err of errs) {
      summary.byCode[err.type] = (summary.byCode[err.type] ?? 0) + 1;
    }
  };

  landscape.tasks.forEach(t     => tally(t.validationErrors, 'tasks'));
  landscape.orders.forEach(o    => tally(o.validationErrors, 'orders'));
  landscape.resources.forEach(r => tally(r.validationErrors, 'resources'));

  landscape.tasks.forEach(t => { if (!t.schedulable) summary.unschedulableTasks++; });

  return summary;
}
