// MappingError — structured record of a data-quality issue detected during
// MappingEngine.transform(). Emitted into an errors accumulator threaded
// through the transform; surfaced to the sync result so operators can see
// exactly which source field failed to map.
//
// Sprint 1a: type defined + accumulator threaded; transforms are unchanged
// and never push. Sprint 1b (bug-fix) has `toUTC` push UNPARSEABLE_DATE
// when `DateTime.fromISO(...).isValid === false`.

export type MappingErrorSeverity = 'error' | 'warning';

export interface MappingError {
  code: string;                            // e.g. 'UNPARSEABLE_DATE'
  entity: 'orders' | 'resources' | 'tasks' | 'workOrderGroups';
  targetField: string;                     // e.g. 'windowStart'
  sourceField?: string;                    // e.g. 'TaskStartDate'
  rawValue?: unknown;
  message: string;
  recordIndex?: number;                    // 0-based index into the source array
  severity: MappingErrorSeverity;
}
