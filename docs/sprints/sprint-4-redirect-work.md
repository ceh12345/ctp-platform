# UI Sprint 4: Redirect Work (Resource Preference Override)

## Status: WAITING (blocked by Sprint 1, Sprint 2)

## What the Planner Gets

When unscheduling tasks from one resource, they can specify "prefer Machine B" or "exclude Machine A" for the re-solve. The solver respects these preferences instead of picking freely.

## Why This Matters

Today: unschedule tasks from Machine A → re-solve → solver might put them right back on Machine A. The planner has no way to say "NOT Machine A" or "try Machine B first." This is the #1 frustration in the machine-breakdown scenario.

## User Flow — Machine Breakdown

1. CNC-01 breaks down. Planner filters to CNC-01 (Sprint 3)
2. Selects 4 tasks → Unschedule 4 (Sprint 1)
3. Selection toolbar shows: "Set Resource Preference"
4. Dialog:
   ```
   For 4 selected tasks:
   CNC-01: [EXCLUDED ▾]    ← don't put them back here
   CNC-02: [PREFERRED ▾]   ← try here first
   ```
5. Clicks Apply → preferences queued
6. Solve Selected (Sprint 2) or full Solve
7. Tasks land on CNC-02 (or next best if CNC-02 is full)

## Resource Modes

Four modes for task-resource relationships:

| Mode | Meaning |
|------|---------|
| `REQUIRED` | Must use this resource. Fail if unavailable. |
| `PREFERRED` | Try this resource first. Fall back to others. |
| `AVAILABLE` | Can use if needed. Default. |
| `EXCLUDED` | Do not use this resource for this task. |

## UI Changes

### Resource Preference Dialog

Triggered from selection toolbar when tasks are selected:

```
┌────────────────────────────────────────┐
│ Resource Preferences for 4 tasks       │
│                                        │
│ Set how the solver should assign       │
│ resources for these tasks:             │
│                                        │
│ CNC-01   [ EXCLUDED  ▾ ]              │
│ CNC-02   [ PREFERRED ▾ ]              │
│ CNC-03   [ AVAILABLE ▾ ]  (default)   │
│ CNC-04   [ AVAILABLE ▾ ]  (default)   │
│                                        │
│ Only showing compatible resources.     │
│                                        │
│              [Cancel]  [Apply]         │
└────────────────────────────────────────┘
```

The resource list shows only resources that are compatible with the selected tasks (resources in the tasks' resource preferences list).

### Override State

```tsx
// In App state
const [resourceModeOverrides, setResourceModeOverrides] = useState<
  Record<string, Record<string, string>>  // taskKey → resourceKey → mode
>({});
```

### Visual Indicator

Tasks with resource preference overrides show a badge in the task table:

```tsx
{hasResourceOverride(tk.key) && (
  <span style={{
    fontSize: 10, color: C.accent, fontWeight: 600, marginLeft: 4,
  }}>
    → REDIRECT
  </span>
)}
```

### Pass to Solve

Resource mode overrides are included in the solve request body:

```tsx
// In handleSolveConfirm or handleSolveSelected
const request = {
  ...existingOverrides,
  resourceModes: resourceModeOverrides,
};
```

### Task Detail Panel

In the task detail panel, show resource preferences with editable dropdowns:

```
Resources:
  CNC-01  PRIMARY  [EXCLUDED  ▾]  (was: AVAILABLE)
  CNC-02           [PREFERRED ▾]  (was: AVAILABLE)
```

Changes here update `resourceModeOverrides` and mark stale.

## API Requirements

The `resourceModes` field already exists in `SolveRequestDto`. Verify the engine respects per-task resource mode overrides during solving. If the engine currently only supports global resource modes (resource X is EXCLUDED for all tasks), this sprint may need engine work to support per-task overrides.

## Edge Cases

- **Selected tasks have different compatible resources:** Show union of all compatible resources. Modes apply only where relevant.
- **REQUIRED + EXCLUDED conflict on same resource:** Warn the planner.
- **All resources EXCLUDED:** Warn "No resources available — task will be infeasible."
- **Override cleared after solve:** Yes, like all other overrides.

## Test Plan

1. Select tasks → "Set Resource Preference" appears in toolbar
2. Dialog shows compatible resources with dropdown
3. Set CNC-01 to EXCLUDED → override stored
4. Visual badge appears on task rows
5. Solve → solver avoids CNC-01 for those tasks
6. Overrides clear after solve
7. Task detail panel shows editable resource modes
8. Incompatible resources not shown in dialog

## Depends On

- Sprint 1: Select & Act (selection mechanism)
- Sprint 2: Solve Selected (targeted re-solve)
- API: Per-task resource mode overrides in solve request (may need engine work)
