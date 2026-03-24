# Spec: Gantt Resource Row Filtering from WHERE Filter

**What it does:** When the planner selects resources in the WHERE filter (hierarchy browser or attribute search), the Gantt hides non-matching resource rows. Shows only the resources the planner is working on.

**Size:** ~30 min (state lifting + Gantt filtering)
**Depends on:** UI Sprint 23 (hierarchy browser + attribute search)

---

## Problem

The WHERE filter in the task table filters the task list but the Gantt still shows all resource rows. If the planner selects "Fabrication > Welder" to focus on welding work, the Gantt still shows 22 resource rows. The planner has to scroll past machining, assembly, and test resources to find the welders.

## Fix

Lift `hierarchyResources` and `attrFilters` state from TaskTable to ScheduleTab. Pass them down to both TaskTable and GanttChart. The Gantt filters its resource rows to match the WHERE selection.

## Implementation

### 1. Lift state to ScheduleTab

Move these from TaskTable to ScheduleTab:
```typescript
const [hierarchyResources, setHierarchyResources] = useState<Set<string>>(new Set());
const [attrFilters, setAttrFilters] = useState<{ name: string; value: string }[]>([]);
```

Pass them as props to TaskTable (which currently owns them) and to GanttChart.

### 2. Filter Gantt resource rows

In the GanttChart component, filter the resource list before rendering:
```typescript
const ganttResources = hierarchyResources.size > 0
  ? resources.filter(r => hierarchyResources.has(r.resourceKey))
  : resources;
```

### 3. Sync indicator

When the Gantt is filtered, show a subtle indicator:
```
Gantt: Showing 3 of 22 resources (Fabrication > Welder)  [Show all]
```

### Behavior

- Empty selection (no WHERE filter) → Gantt shows all resources (default)
- Resources selected → Gantt shows only matching rows
- Attribute filter selected → resolve attribute to resource keys, filter Gantt rows
- "Show all" button restores full Gantt (clears WHERE filter in both Gantt and task table)
- WHERE filter changes update both Gantt and task table simultaneously

## Verification

- [ ] Selecting resources in hierarchy browser filters Gantt rows
- [ ] Selecting an attribute filters Gantt to resources with that attribute
- [ ] Clearing WHERE filter restores all Gantt rows
- [ ] Task table and Gantt stay in sync
- [ ] Gantt shows "N of M resources" indicator when filtered
- [ ] "Show all" clears the filter
- [ ] Works with existing Gantt features (critical path toggle, WhereTo ghost bars, replay)
