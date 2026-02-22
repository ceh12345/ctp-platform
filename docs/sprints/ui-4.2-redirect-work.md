# UI: Resource Preference Override Dialog (Sprint 4 Frontend)

Add a Resource Preference dialog that lets planners control which resources the solver should use when rescheduling selected tasks. This is the "Redirect Work" feature — the key workflow for machine breakdowns.

**Prerequisites:** Sprint 1 (Select & Act) and Sprint 2 (Solve Selected) must be complete. The engine must support `resourcePreferenceOverrides` in the solve request (see Sprint 4 Engine prompt).

Stop any running dev servers on ports 3000 and 3001 before starting. Restart both after all changes are complete.

Kill any existing node processes before starting:
```bash
killall node 2>/dev/null || true
```

---

## Part 1: State

Add to App state:

```tsx
// taskKey → resourceKey → mode
const [resourcePreferenceOverrides, setResourcePreferenceOverrides] = useState<
  Record<string, Record<string, string>>
>({});

// Dialog open state
const [showResourcePrefDialog, setShowResourcePrefDialog] = useState(false);
```

---

## Part 2: Selection Toolbar Button

When tasks are selected (Sprint 1's selection toolbar), add a "Set Resource Preference" button. It should appear alongside the existing "Unschedule Selected" and "Solve Selected" buttons.

```tsx
<button onClick={() => setShowResourcePrefDialog(true)}>
  🔀 Set Resource Preference
</button>
```

This button is always visible when tasks are selected — works for both scheduled and unscheduled tasks.

---

## Part 3: Resource Preference Dialog

A modal dialog. When opened, it:

1. Reads the selected tasks from state
2. Collects compatible resources from each task's `compatibleResources` field in the solve response (or falls back to `assignedResources` + `requestedResource` if `compatibleResources` isn't available yet)
3. Shows the **union** of all compatible resources across selected tasks
4. For each resource, shows:
   - Resource name
   - How many of the selected tasks are currently assigned here
   - How many of the selected tasks are compatible with this resource
   - A dropdown: REQUIRED / PREFERRED / AVAILABLE / EXCLUDED (default: AVAILABLE)

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  🔀 Resource Preferences                          [✕]  │
│                                                         │
│  Redirect 4 selected tasks to different resources.      │
│  The solver will respect these preferences on the       │
│  next solve.                                            │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Resource      Now  Compatible  Preference       │    │
│  │─────────────────────────────────────────────────│    │
│  │ CNC-01        4/4    4/4      [ EXCLUDED  ▾ ]  │    │
│  │ CNC-02        0/4    4/4      [ PREFERRED ▾ ]  │    │
│  │ CNC-03        0/4    3/4      [ AVAILABLE ▾ ]  │    │
│  │ CNC-04        0/4    1/4      [ AVAILABLE ▾ ]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  "Now" = tasks currently assigned to this resource      │
│  "Compatible" = tasks that can run on this resource     │
│                                                         │
│  ⚠ CNC-04 is compatible with only 1 of 4 tasks.       │
│    Preference will only apply where compatible.         │
│                                                         │
│               [Cancel]  [Apply]  [Apply & Solve]        │
└─────────────────────────────────────────────────────────┘
```

### Dropdown Options

Each dropdown shows the four modes with short descriptions:

```
┌──────────────────────────────────┐
│  REQUIRED   — must use           │
│  PREFERRED  — try first          │
│  AVAILABLE  — can use (default)  │
│  EXCLUDED   — do not use         │
└──────────────────────────────────┘
```

### Inline Validation

Show warnings inline at the bottom of the dialog:

- If ALL resources are set to EXCLUDED: red warning — "No resources available. Tasks will be infeasible."
- If a resource is both REQUIRED and EXCLUDED (shouldn't happen in same dialog, but guard): red warning
- If only partial compatibility: yellow info note (shown in example above)

Disable the Apply/Apply & Solve buttons if there's a red warning.

### Computing Compatible Resources

```tsx
function getCompatibleResources(selectedTaskKeys: string[], tasks: any[]): CompatibleResource[] {
  const resourceMap = new Map<string, {
    resourceKey: string;
    resourceName: string;
    currentCount: number;    // how many selected tasks are assigned here now
    compatibleCount: number; // how many selected tasks list this as compatible
  }>();

  for (const taskKey of selectedTaskKeys) {
    const task = tasks.find(t => t.key === taskKey);
    if (!task) continue;

    // Use compatibleResources from API response (Sprint 4 Engine adds this)
    const compatResources = task.compatibleResources ?? [];

    for (const cr of compatResources) {
      if (!resourceMap.has(cr.resourceKey)) {
        resourceMap.set(cr.resourceKey, {
          resourceKey: cr.resourceKey,
          resourceName: cr.resourceName ?? cr.resourceKey,
          currentCount: 0,
          compatibleCount: 0,
        });
      }
      const entry = resourceMap.get(cr.resourceKey)!;
      entry.compatibleCount++;
    }

    // Count current assignments
    const assignedResources = task.assignedResources ?? [];
    for (const ar of assignedResources) {
      const entry = resourceMap.get(ar.resourceKey);
      if (entry) entry.currentCount++;
    }
  }

  return Array.from(resourceMap.values())
    .sort((a, b) => b.currentCount - a.currentCount || b.compatibleCount - a.compatibleCount);
}
```

---

## Part 4: Apply Logic

### "Apply" Button

Stores overrides in state. Does NOT solve.

```tsx
function handleApplyPreferences(
  selectedTaskKeys: string[],
  resourceModes: Record<string, string>,  // resourceKey → mode
) {
  const newOverrides = { ...resourcePreferenceOverrides };

  for (const taskKey of selectedTaskKeys) {
    // Only apply non-AVAILABLE modes (AVAILABLE is default, no need to store)
    const taskOverrides: Record<string, string> = {};
    for (const [resourceKey, mode] of Object.entries(resourceModes)) {
      if (mode !== 'AVAILABLE') {
        taskOverrides[resourceKey] = mode;
      }
    }
    if (Object.keys(taskOverrides).length > 0) {
      newOverrides[taskKey] = taskOverrides;
    } else {
      delete newOverrides[taskKey];
    }
  }

  setResourcePreferenceOverrides(newOverrides);
  setShowResourcePrefDialog(false);
  // Mark stale if you have a stale indicator
}
```

### "Apply & Solve" Button

Stores overrides, then immediately triggers solve for the selected tasks (Sprint 2's Solve Selected).

```tsx
function handleApplyAndSolve(
  selectedTaskKeys: string[],
  resourceModes: Record<string, string>,
) {
  handleApplyPreferences(selectedTaskKeys, resourceModes);
  // Trigger Solve Selected with the overrides included
  handleSolveSelected(selectedTaskKeys);
}
```

### Pass Overrides in Solve Request

When building the solve request body (in both Solve All and Solve Selected), include:

```tsx
const solveRequest = {
  ...existingRequestFields,
  resourcePreferenceOverrides: resourcePreferenceOverrides,
};
```

### Clear After Solve

After a successful solve response, clear the overrides:

```tsx
// In the solve response handler
setResourcePreferenceOverrides({});
```

---

## Part 5: Visual Indicators

### Task Table Badge

Tasks with active resource preference overrides show a badge:

```tsx
{hasResourceOverride(task.key) && (
  <span style={{
    fontSize: 10,
    color: colors.accent,  // use your theme accent color
    fontWeight: 600,
    marginLeft: 4,
    padding: '1px 5px',
    borderRadius: 3,
    border: `1px solid ${colors.accent}`,
  }}>
    🔀 REDIRECT
  </span>
)}
```

Helper:

```tsx
function hasResourceOverride(taskKey: string): boolean {
  return resourcePreferenceOverrides[taskKey] !== undefined 
    && Object.keys(resourcePreferenceOverrides[taskKey]).length > 0;
}
```

### Task Detail Panel

When viewing a single task's detail panel, show its resource preferences with editable dropdowns:

```
Resources
  CNC-01  PRIMARY  [ EXCLUDED  ▾ ]  ← override active
  CNC-02           [ PREFERRED ▾ ]  ← override active  
  CNC-03           [ AVAILABLE ▾ ]  (default)
```

Changes here update `resourcePreferenceOverrides` for that single task. Show "(override)" or highlight changed rows.

If the task has an active override, show a "Clear Overrides" link that resets to all AVAILABLE.

---

## Part 6: Gantt Context Menu

Add "🔀 Set Resource Preference" to the right-click context menu on Gantt bars (after "Where Can This Go?" from Sprint 5/Batch 5):

```tsx
{ label: '🔀 Set Resource Preference', onClick: () => {
  setSelectedTasks([task.key]);  // select just this task
  setShowResourcePrefDialog(true);
}}
```

---

## Part 7: Post-Solve Summary

After a solve completes where `resourcePreferenceOverrides` were applied, show a brief summary. This can be a toast notification or a section in the solve preview panel:

```
Redirect applied for 4 tasks:
  3 tasks → CNC-02
  1 task → CNC-03 (CNC-02 not compatible)
  CNC-01: excluded ✓
```

Build this by comparing the task assignments before and after solve for the tasks that had overrides.

---

## Edge Cases

1. **Selected tasks have no common resources:** Dialog shows union. Resources compatible with only 1 task show "1/4" in Compatible column.

2. **Task has no `compatibleResources` in API response:** Fall back to `assignedResources` entries. Show a note: "Full compatibility data not available."

3. **Overrides persist across tab switches:** Yes — `resourcePreferenceOverrides` state persists until solve or manual clear.

4. **Planner opens dialog, changes nothing, clicks Apply:** No overrides stored (all AVAILABLE = no override).

5. **Planner applies overrides to 4 tasks, then selects 2 more and opens dialog again:** New dialog shows fresh state for the newly selected tasks. Previous overrides on the first 4 are preserved.

6. **Solve fails or is cancelled:** Overrides are NOT cleared. Planner can retry.

---

## Test Plan

1. Select 3 tasks → "Set Resource Preference" button appears in toolbar
2. Click → dialog opens showing compatible resources with counts
3. Set CNC-01 to EXCLUDED → dropdown updates
4. Set CNC-02 to PREFERRED → dropdown updates
5. "Apply" → dialog closes, badges appear on 3 task rows
6. Task detail panel shows overrides with dropdowns
7. Change override in task detail → state updates
8. "Clear Overrides" in task detail → badges removed
9. Solve Selected → overrides included in request body
10. After solve → overrides cleared, badges gone
11. Post-solve summary shows where tasks landed
12. All-excluded warning prevents Apply
13. Partial compatibility note shows correctly
14. Right-click Gantt bar → "Set Resource Preference" opens dialog for single task
15. Dialog shows "Now" column correctly (tasks currently on each resource)
