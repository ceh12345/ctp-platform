# Engine: Resource Preference Overrides (Sprint 4 Backend)

Add per-task resource preference override support to the scheduling engine. When a planner says "exclude CNC-01" or "prefer CNC-02" for specific tasks, the engine must modify those tasks' resource preference lists before building schedule contexts.

**This is engine-only work. No UI changes.**

---

## Part 1: Constants

Add a new constants class in `constants.ts`:

```typescript
export class CTPResourcePreferenceModeConstants {
  public static REQUIRED = "REQUIRED";     // Must use this resource. Fail if unavailable.
  public static PREFERRED = "PREFERRED";   // Try first. Fall back to others if full.
  public static AVAILABLE = "AVAILABLE";   // Default. Solver picks freely.
  public static EXCLUDED = "EXCLUDED";     // Do not use for this task.
}
```

---

## Part 2: Add `mode` to CTPResourcePreference

In `resource.ts`, add a `mode` field to `CTPResourcePreference`:

```typescript
export class CTPResourcePreference extends CTPPreference implements IResourcePreference {
  public resourceKey: string;
  public speedFactor: number;
  public mode: string;  // ← NEW: REQUIRED | PREFERRED | AVAILABLE | EXCLUDED

  constructor(k?: string, r?: number, m?: string) {
    super();
    this.resourceKey = k ? k : "";
    this.speedFactor = 1.0;
    this.rank = r ? r : 0;
    this.mode = m ?? CTPResourcePreferenceModeConstants.AVAILABLE;
  }
}
```

Also add `mode` to `IResourcePreference`:

```typescript
export interface IResourcePreference extends IPreference {
  resourceKey: string;
  speedFactor: number;
  mode: string;
}
```

---

## Part 3: Add `mode` to CTPTaskResource

In `task.ts`, add a `mode` field to `CTPTaskResource`:

```typescript
export class CTPTaskResource implements ITaskResource {
  public resource: string | undefined;
  public isPrimary: boolean = false;
  public scheduledResource: string | undefined;
  public preferences: Array<IResourcePreference>;
  public index: number;
  public qty: number;
  public mode: string;  // ← NEW: default mode for the resource requirement itself

  constructor(r?: string, prim?: boolean, i?: number, schedResource?: string) {
    this.resource = r ?? undefined;
    this.scheduledResource = schedResource ?? undefined;
    this.preferences = [];
    this.index = i ?? 0;
    this.isPrimary = prim ?? false;
    this.qty = 1.0;
    this.mode = CTPResourcePreferenceModeConstants.AVAILABLE;
  }
}
```

Also update `ITaskResource`:

```typescript
export interface ITaskResource {
  resource: string | undefined;
  isPrimary: boolean;
  scheduledResource: string | undefined;
  preferences: Array<IResourcePreference>;
  mode: string;
}
```

---

## Part 4: `applyResourcePreferenceOverrides()` on Landscape

Add a new method to `SchedulingLandscape` in `landscape.ts`. This is the core logic. It receives per-task overrides from the solve request and modifies each task's preference list accordingly.

The input shape is:

```typescript
// taskKey → resourceKey → mode
type ResourcePreferenceOverrides = Record<string, Record<string, string>>;
```

The method:

```typescript
public applyResourcePreferenceOverrides(
  overrides: Record<string, Record<string, string>>
): void {
  for (const [taskKey, resourceModes] of Object.entries(overrides)) {
    const task = this.tasks?.getEntity(taskKey);
    if (!task || !task.capacityResources) continue;

    task.capacityResources.forEach((taskResource) => {
      // Apply mode to the task resource itself if it matches
      const directMode = resourceModes[taskResource.resource ?? ''];
      if (directMode) {
        taskResource.mode = directMode;
      }

      // Apply modes to individual preferences within this task resource
      taskResource.preferences.forEach((pref) => {
        const prefMode = resourceModes[pref.resourceKey];
        if (prefMode) {
          pref.mode = prefMode;
        }
      });
    });
  }
}
```

---

## Part 5: Filter Preferences Before Context Building

This is where the overrides actually take effect. Before the solver explodes task-resource combinations into schedule contexts, it needs to filter and rerank preferences based on modes.

Add a method to `CTPTaskResource` or to a utility:

```typescript
// On CTPTaskResource or as a standalone utility
public getEffectivePreferences(): IResourcePreference[] {
  // Start with all preferences
  let prefs = [...this.preferences];

  // Remove EXCLUDED preferences
  prefs = prefs.filter(p => p.mode !== CTPResourcePreferenceModeConstants.EXCLUDED);

  // If any preference is REQUIRED, keep ONLY required ones
  const required = prefs.filter(p => p.mode === CTPResourcePreferenceModeConstants.REQUIRED);
  if (required.length > 0) {
    prefs = required;
  }

  // Sort: REQUIRED first (rank 0), then PREFERRED (boost rank), then AVAILABLE (original rank)
  prefs.sort((a, b) => {
    const modeOrder = (m: string): number => {
      if (m === CTPResourcePreferenceModeConstants.REQUIRED) return 0;
      if (m === CTPResourcePreferenceModeConstants.PREFERRED) return 1;
      return 2; // AVAILABLE
    };
    const orderDiff = modeOrder(a.mode) - modeOrder(b.mode);
    if (orderDiff !== 0) return orderDiff;
    return a.rank - b.rank;  // Within same mode, preserve original rank
  });

  // Reassign sequential ranks
  prefs.forEach((p, i) => p.rank = i + 1);

  return prefs;
}
```

**Where this is called:** In the solver's context explosion step — wherever the engine iterates over `task.capacityResources[i].preferences` to build `ScheduleContext` objects. Replace direct access to `.preferences` with `.getEffectivePreferences()`. This ensures:

- EXCLUDED resources never generate a ScheduleContext
- REQUIRED resources are the only ones that generate contexts (if any are REQUIRED)
- PREFERRED resources generate contexts first, scored better due to lower rank

---

## Part 6: Also Handle `mode` on CTPTaskResource Itself

If `taskResource.mode` is set to EXCLUDED, skip the entire resource requirement line — don't even look at preferences. This handles the case where the planner excludes the resource requirement itself (e.g., "don't consider any machine for this slot"):

```typescript
// In context explosion loop
task.capacityResources.forEach((taskResource) => {
  // Skip entirely if the resource requirement is excluded
  if (taskResource.mode === CTPResourcePreferenceModeConstants.EXCLUDED) return;

  const effectivePrefs = taskResource.getEffectivePreferences();

  if (effectivePrefs.length === 0) {
    // All preferences excluded — task is infeasible for this resource slot
    task.addError('ResourcePreference', 
      `No available resources for requirement ${taskResource.resource} — all excluded`);
    return;
  }

  // Build contexts using effectivePrefs instead of taskResource.preferences
  for (const pref of effectivePrefs) {
    // ... existing context building logic using pref.resourceKey
  }
});
```

---

## Part 7: Wire Into Solve Flow

In `ctp.service.ts`, add the new override step in the solve method. Insert it after the existing resource mode step (1e):

```typescript
// ─── 1. Apply overrides in order ───

// ... existing 1a through 1e ...

// 1e. Resource mode overrides (existing — global resource ON/OFF/TRACK)
if (request?.resourceModes) {
  landscape.applyResourceModes(request.resourceModes);
}

// 1g. Per-task resource preference overrides (NEW)
if (request?.resourcePreferenceOverrides) {
  landscape.applyResourcePreferenceOverrides(request.resourcePreferenceOverrides);
}

// 1f. Material mode overrides
if (request?.materialModes) {
  this.applyMaterialModes(landscape, request.materialModes);
}
```

---

## Part 8: Update Solve Request DTO

Add the new field to `SolveRequestDto`:

```typescript
export class SolveRequestDto {
  // ... existing fields ...

  @ApiProperty({
    description: 'Per-task resource preference overrides. Keys are task keys, values are resource key → mode mappings.',
    required: false,
    example: {
      'OP-001': { 'CNC-01': 'EXCLUDED', 'CNC-02': 'PREFERRED' },
      'OP-002': { 'CNC-01': 'EXCLUDED', 'CNC-02': 'PREFERRED' },
    },
  })
  resourcePreferenceOverrides?: Record<string, Record<string, string>>;
}
```

---

## Part 9: Include Full Preference List in Solve Response

The frontend needs to know each task's full set of compatible resources (not just the assigned one) to build the preference dialog. Update the task result in `extractResults()`:

In the task result object, add a `compatibleResources` field:

```typescript
const compatibleResources: any[] = [];
task.capacityResources?.forEach((entry) => {
  // Include the direct resource
  if (entry.resource) {
    const resEntity = landscape.resources.getEntity(entry.resource);
    compatibleResources.push({
      resourceKey: entry.resource,
      resourceName: resEntity?.name ?? null,
      isPrimary: entry.isPrimary,
      mode: entry.mode,
      index: entry.index,
    });
  }
  // Include all preference resources
  entry.preferences.forEach((pref) => {
    // Avoid duplicates
    if (!compatibleResources.find(c => c.resourceKey === pref.resourceKey)) {
      const resEntity = landscape.resources.getEntity(pref.resourceKey);
      compatibleResources.push({
        resourceKey: pref.resourceKey,
        resourceName: resEntity?.name ?? null,
        isPrimary: false,
        mode: pref.mode,
        rank: pref.rank,
      });
    }
  });
});

// Add to task result
const taskResult: any = {
  // ... existing fields ...
  compatibleResources,  // ← NEW
};
```

---

## Part 10: Validation

Add validation in the service before applying overrides:

```typescript
private validateResourcePreferenceOverrides(
  landscape: SchedulingLandscape,
  overrides: Record<string, Record<string, string>>,
): string[] {
  const warnings: string[] = [];
  const validModes = ['REQUIRED', 'PREFERRED', 'AVAILABLE', 'EXCLUDED'];

  for (const [taskKey, resourceModes] of Object.entries(overrides)) {
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) {
      warnings.push(`Task ${taskKey} not found — skipping overrides`);
      continue;
    }

    // Check for invalid modes
    for (const [resourceKey, mode] of Object.entries(resourceModes)) {
      if (!validModes.includes(mode)) {
        warnings.push(`Invalid mode '${mode}' for ${taskKey}/${resourceKey}`);
      }
    }

    // Check for all-excluded (task will be infeasible)
    const allExcluded = task.capacityResources?.every((tr) => {
      const allPrefsExcluded = tr.preferences.every(
        (p) => resourceModes[p.resourceKey] === 'EXCLUDED'
      );
      const directExcluded = resourceModes[tr.resource ?? ''] === 'EXCLUDED';
      return directExcluded && allPrefsExcluded;
    });
    if (allExcluded) {
      warnings.push(`All resources excluded for task ${taskKey} — task will be infeasible`);
    }

    // Check for REQUIRED + EXCLUDED conflict on same resource
    for (const [resourceKey, mode] of Object.entries(resourceModes)) {
      if (mode === 'REQUIRED') {
        // Check if same resource is excluded elsewhere for same task
        // (shouldn't happen in a single override map, but guard anyway)
      }
    }
  }

  return warnings;
}
```

Include warnings in the solve response if any exist.

---

## Test Plan

### Unit Tests (Engine)

1. **EXCLUDED removes resource from effective preferences**
   - Task has prefs [CNC-01, CNC-02, CNC-03]
   - Set CNC-01 to EXCLUDED
   - `getEffectivePreferences()` returns [CNC-02, CNC-03]

2. **REQUIRED filters to only required resources**
   - Task has prefs [CNC-01, CNC-02, CNC-03]
   - Set CNC-02 to REQUIRED
   - `getEffectivePreferences()` returns [CNC-02] only

3. **PREFERRED reranks to top**
   - Task has prefs [CNC-01 (rank 1), CNC-02 (rank 2), CNC-03 (rank 3)]
   - Set CNC-03 to PREFERRED
   - `getEffectivePreferences()` returns [CNC-03 (rank 1), CNC-01 (rank 2), CNC-02 (rank 3)]

4. **All excluded → empty list, error added to task**

5. **EXCLUDED + PREFERRED combo**
   - CNC-01 EXCLUDED, CNC-02 PREFERRED, CNC-03 AVAILABLE
   - Returns [CNC-02, CNC-03] with CNC-02 ranked first

6. **Multiple REQUIRED → only required ones kept**

7. **No overrides → original preferences unchanged**

8. **applyResourcePreferenceOverrides sets modes correctly on task resources**

### Integration Tests (API)

9. **Solve with EXCLUDED override → task avoids excluded resource**
   - OP-001 normally goes to CNC-01
   - Solve with `{ "OP-001": { "CNC-01": "EXCLUDED" } }`
   - OP-001 scheduled on CNC-02 or CNC-03

10. **Solve with REQUIRED override → task uses only required resource**
    - Solve with `{ "OP-001": { "CNC-02": "REQUIRED" } }`
    - OP-001 scheduled on CNC-02 (or infeasible if CNC-02 full)

11. **Solve with PREFERRED override → preferred resource used when available**
    - Solve with `{ "OP-001": { "CNC-02": "PREFERRED" } }`
    - OP-001 scheduled on CNC-02 (unless CNC-02 is full, then fallback)

12. **Solve response includes `compatibleResources` for each task**

13. **Invalid task key in overrides → warning in response, not error**

14. **All-excluded warning in response**

---

## Summary

| Change | File | Type |
|--------|------|------|
| `CTPResourcePreferenceModeConstants` | constants.ts | New class |
| `mode` field on `CTPResourcePreference` | resource.ts | Add field |
| `mode` field on `CTPTaskResource` | task.ts | Add field |
| `mode` field on `IResourcePreference` | resource.ts | Add to interface |
| `mode` field on `ITaskResource` | task.ts | Add to interface |
| `getEffectivePreferences()` | task.ts | New method |
| `applyResourcePreferenceOverrides()` | landscape.ts | New method |
| `validateResourcePreferenceOverrides()` | ctp.service.ts | New method |
| `resourcePreferenceOverrides` on DTO | solve-request.dto.ts | Add field |
| `compatibleResources` in response | ctp.service.ts | Add to extractResults |
| Wire into solve flow step 1g | ctp.service.ts | Insert call |
| Context explosion uses `getEffectivePreferences()` | solver (wherever contexts are built) | Modify existing |
