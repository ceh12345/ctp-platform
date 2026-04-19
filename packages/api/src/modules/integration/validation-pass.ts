import { SchedulingLandscape } from '@ctp/engine';

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

  const orderKeys = new Set<string>();
  landscape.orders.forEach(o => orderKeys.add(o.key));

  landscape.tasks.forEach(task => {
    // Checks are registered here by the bug-fix sprint and beyond:
    //   - ORPHAN_RESOURCE  (Bug D, Sprint 1b)
    //   - ORPHAN_ORDER     (placeholder; register if needed)
    //   - Chain integrity  (Sprint 2+)
    void task;
    void resourceKeys;
    void orderKeys;
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
