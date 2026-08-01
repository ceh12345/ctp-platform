import {
  SchedulingLandscape,
  makeValidationError,
  CTPResourcePreferenceModeConstants,
} from '@ctp/engine';

// Cross-entity validation pass. Runs after entities have been hydrated into
// instances but before the new landscape replaces the current one.
//
// Sprint 1a: framework only. Sprint 1b populates the first check
// (`ORPHAN_RESOURCE` — Bug D). Sprint 2+ adds chain integrity and other
// cross-entity checks.
//
// Validation errors are attached to the entity that detected the problem
// (the task, not the missing resource — the resource is fine; the reference
// is wrong). Use `task.addValidationError(makeValidationError({...}))`.
export function validateReferences(landscape: SchedulingLandscape): void {
  // Prebuilt lookup sets — the framework provides these so individual checks
  // can be O(1) per record instead of O(n) scans.
  const resourceKeys = new Set<string>();
  landscape.resources.forEach(r => resourceKeys.add(r.key));

  // Calendar coverage (found via slim-500, 2026-07-30: curated calendars.json
  // predated newly added Genius resources, and its fixed end date fell short
  // of a data-driven horizon — both surfaced only as late solver
  // infeasibilities). Both checks are severity:"warning": they annotate for
  // early visibility without changing solve behavior — the solver still
  // produces its precise per-task infeasibility report.
  //
  // Gated on the tenant supplying calendar data at all: these checks target
  // PARTIAL coverage gaps (some resources covered, some not). A tenant with
  // no calendars anywhere (synthetic fixtures, minimal test payloads) is a
  // different setup, not a data gap — flagging every resource there is noise.
  const horizonEnd = landscape.horizon?.endW;
  const emptyCalendarResources = new Set<string>();
  let anyCalendar = false;
  landscape.resources.forEach(r => {
    if (r.available?.staticAvailable?.head) anyCalendar = true;
  });
  if (anyCalendar) landscape.resources.forEach(r => {
    const sa = r.available?.staticAvailable;
    if (!sa?.head) {
      emptyCalendarResources.add(r.key);
      r.addValidationError(makeValidationError({
        agent:    'CrossEntityValidation',
        type:     'NO_CALENDAR',
        reason:   `Resource '${r.key}' (${r.name ?? ''}) has no availability calendar — any task bound to it cannot schedule`,
        severity: 'warning',
        source:   'validation',
        policy:   'annotate',
        field:    'available.staticAvailable',
      }));
      return;
    }
    if (typeof horizonEnd === 'number' && horizonEnd > 0 && sa.tail
        && sa.tail.data.endW < horizonEnd) {
      r.addValidationError(makeValidationError({
        agent:    'CrossEntityValidation',
        type:     'CALENDAR_SHORTER_THAN_HORIZON',
        reason:   `Resource '${r.key}' (${r.name ?? ''}) calendar ends before the horizon end — late-chain tasks can run out of availability`,
        severity: 'warning',
        source:   'validation',
        policy:   'annotate',
        field:    'available.staticAvailable',
        rawValue: sa.tail.data.endW,
      }));
    }
  });

  const orderKeys = new Set<string>();
  landscape.orders.forEach(o => orderKeys.add(o.key));

  landscape.tasks.forEach(task => {
    // ORPHAN_RESOURCE (Bug D, Sprint 1b): flag any capacity-resource slot
    // whose `resource` key isn't in the landscape's resource master. Skips
    // null/empty (null MachineCode is Bug B, Sprint 2's warning layer).
    task.capacityResources?.forEach((cr, idx) => {
      if (!cr.resource) return;
      if (!resourceKeys.has(cr.resource)) {
        task.addValidationError(makeValidationError({
          agent:    'CrossEntityValidation',
          type:     'ORPHAN_RESOURCE',
          reason:   `Task '${task.key}' references resource '${cr.resource}' which does not exist in the landscape`,
          severity: 'error',
          source:   'validation',
          policy:   'annotate',
          field:    `capacityResources[${idx}].resource`,
          rawValue: cr.resource,
        }));
      }
    });

    // NO_CALENDAR_COVERAGE: every effective capacity candidate of a slot
    // points at a resource with no availability calendar — the task can never
    // place regardless of the schedule around it. Mirrors the engine's
    // effective-preference semantics (EXCLUDED dropped; any REQUIRED masks
    // the rest); a flat slot's single `resource` is its own candidate set.
    task.capacityResources?.forEach((cr, idx) => {
      let candidates: string[];
      if (cr.preferences && cr.preferences.length > 0) {
        const active = cr.preferences.filter(
          p => p.mode !== CTPResourcePreferenceModeConstants.EXCLUDED);
        const required = active.filter(
          p => p.mode === CTPResourcePreferenceModeConstants.REQUIRED);
        candidates = (required.length > 0 ? required : active)
          .map(p => p.resourceKey)
          .filter((k): k is string => !!k);
      } else {
        candidates = cr.resource ? [cr.resource] : [];
      }
      if (candidates.length === 0) return;
      if (candidates.every(k => emptyCalendarResources.has(k))) {
        task.addValidationError(makeValidationError({
          agent:    'CrossEntityValidation',
          type:     'NO_CALENDAR_COVERAGE',
          reason:   `Task '${task.key}' capacity slot ${idx}: every effective candidate (${candidates.join(', ')}) has no availability calendar`,
          severity: 'warning',
          source:   'validation',
          policy:   'annotate',
          field:    `capacityResources[${idx}]`,
          rawValue: candidates.join(','),
        }));
      }
    });

    // ORPHAN_ORDER placeholder (register when needed — no known bug today).
    void orderKeys;

    // Chain integrity — Sprint 2+ (chain-cycle warnings).
  });

  // Piggyback on the existing includeInSolve skip path. Any task whose
  // validationErrors include a severity:"error" entry has schedulable:false;
  // flipping includeInSolve to false lets the solver's existing user-excluded
  // branch skip it cleanly (no new solver conditionals).
  //
  // Safe to run unconditionally: false-to-false is a no-op, and every sync
  // rebuilds the landscape with includeInSolve=true defaults, so there's no
  // cross-sync stomping of user/config exclusions to worry about.
  landscape.tasks.forEach(task => {
    if (!task.schedulable) task.includeInSolve = false;
  });
}
