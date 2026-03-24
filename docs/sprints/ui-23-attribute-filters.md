# Spec: Task Page — Hierarchy Browser + Attribute Search Filter

**What it does:** Two complementary ways to filter the task table: (1) a multi-level hierarchy browser for drilling down by Work Center → Resource Type → Resource, and (2) an attribute search for finding tasks by resource capabilities (certifications, equipment, skill sets).

**Size:** ~2 hours (hierarchy tree + attribute search + task table integration)
**Depends on:** Existing task table filters (Sprint 3, Sprint 12), resource hierarchy data in solve response

---

## Part 1: Resource Hierarchy Browser

A collapsible tree in the filter area above the task table. The planner clicks to drill down and filter.

### Data structure

The hierarchy comes from existing resource data in the solve response:

```
Work Center (from resource.workCenter)
  └── Resource Type (from resource.type or resource.class)
       └── Resource (individual resource)
```

Example for Stafford:
```
Fabrication
  ├── Welder
  │    ├── FAB-JACK (Jack P.)        85%
  │    ├── FAB-LUKE (Luke M.)        26%
  │    └── FAB-AROHA (Aroha T.)      34%
  └── Press Brake
       └── PRESS-01                   45%

Machining
  ├── CNC
  │    ├── 5AXIS-DMG (DMG Mori)      92%
  │    ├── CNC-HAAS (Haas VF-2)     78%
  │    └── MANUAL-MILL (Bridgeport)  35%
  └── Saw
       └── SAW-01 (Behringer)        22%

Assembly
  ├── Assembly Bay
  │    ├── ASSY-01 (Large)           67%
  │    └── ASSY-02 (Medium)          54%
  └── Test
       └── HYDRO-01 (Hydrostatic)    15%
```

### UI rendering

A compact tree with expand/collapse, checkboxes at every level, and utilization indicators:

```
┌─ Filter by Resource ────────────────────────────────┐
│                                                      │
│  ▸ ☐ Fabrication (3 resources, avg 48%)             │
│  ▾ ☑ Machining (3 resources, avg 68%)               │
│     ☑ CNC                                            │
│       ☑ DMG Mori 5-Axis    ██████████░  92%         │
│       ☑ Haas VF-2          ████████░░░  78%         │
│       ☐ Manual Mill         ████░░░░░░░  35%         │
│     ☐ Saw                                            │
│  ▸ ☐ Assembly (3 resources, avg 45%)                │
│                                                      │
│  3 of 9 resources selected · 42 tasks shown          │
└──────────────────────────────────────────────────────┘
```

### Behavior

- **Click a checkbox** — select/deselect that node and all children
- **Click a work center** — selects all resource types and resources within it
- **Click a resource type** — selects all resources of that type
- **Click an individual resource** — selects just that resource
- **Partial selection** — if some children are selected, parent shows a dash (indeterminate)
- **Filter applied** — task table shows only tasks assigned to selected resources (scheduled tasks) or tasks whose preference list includes selected resources (unscheduled tasks)
- **Utilization bar** — small inline bar next to each resource showing current utilization from solve response
- **Count badge** — each node shows how many tasks match

### State

```typescript
const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
// Empty set = no filter (show all)
// Non-empty = filter to tasks involving these resources
```

### Filter logic

```typescript
function taskMatchesResourceFilter(task: any, selectedResources: Set<string>): boolean {
  if (selectedResources.size === 0) return true; // no filter

  // Scheduled task: check assigned resources
  if (task.feasible && task.assignedResources?.length) {
    return task.assignedResources.some((ar: any) => selectedResources.has(ar.resourceKey));
  }

  // Unscheduled task: check compatible/preference resources
  if (task.compatibleResources?.length) {
    return task.compatibleResources.some((cr: any) => selectedResources.has(cr.resourceKey));
  }

  return false;
}
```

---

## Part 2: Attribute Search Filter

A search input that filters tasks by resource attributes. The planner types "ASME" and sees all tasks that require or are assigned to resources with ASME-related attributes.

### UI rendering

A search box with autocomplete suggestions from known attribute values:

```
┌─ Search by Attribute ───────────────────────────────┐
│                                                      │
│  🔍 [ASME                              ] [×]        │
│                                                      │
│  Suggestions:                                        │
│    ASME-TIG (certification) — 2 resources            │
│    ASME-IX (certification) — 1 resource              │
│                                                      │
│  Matching: 4 tasks assigned to ASME-TIG resources    │
└──────────────────────────────────────────────────────┘
```

### Attribute index

Build an index of all attribute name-value pairs across resources at load time:

```typescript
interface AttributeIndex {
  // attribute name → { value → resource keys }
  [attributeName: string]: Map<string, string[]>;
}

// Example:
// certifications → { "ASME-TIG" → ["FAB-JACK"], "AWS-D1.1" → ["FAB-JACK", "FAB-LUKE", "FAB-AROHA"] }
// equipment → { "arthroscopy" → ["OR-01"], "fluoroscopy" → ["OR-01"], "general" → ["OR-01", "OR-02"] }
// specialty → { "orthopedics" → ["DR-SMITH", "DR-JONES"], "general" → ["DR-JONES", "DR-LEE"] }
```

### Search behavior

- **Typing** — autocomplete suggests matching attribute values (case-insensitive substring match)
- **Selecting a suggestion** — filters task table to tasks whose assigned/compatible resources have that attribute value
- **Multiple selections** — AND filter (task must match all selected attribute values)
- **Clear** — remove the attribute filter
- **Combining with hierarchy** — both filters apply simultaneously (AND). Planner can browse Machining resources AND search for "stainless" capability.

### Filter logic

```typescript
function taskMatchesAttributeFilter(
  task: any,
  selectedAttributes: { name: string; value: string }[],
  resourceAttributes: Map<string, any[]>,  // resourceKey → attributes array
): boolean {
  if (selectedAttributes.length === 0) return true;

  // Get all resources associated with this task
  const taskResources: string[] = [];
  if (task.assignedResources?.length) {
    taskResources.push(...task.assignedResources.map((ar: any) => ar.resourceKey));
  }
  if (task.compatibleResources?.length) {
    taskResources.push(...task.compatibleResources.map((cr: any) => cr.resourceKey));
  }

  // Check if any task resource has ALL the selected attributes
  return taskResources.some(rk => {
    const attrs = resourceAttributes.get(rk) || [];
    return selectedAttributes.every(sel =>
      attrs.some((a: any) =>
        a.name === sel.name &&
        String(a.value).toLowerCase().includes(sel.value.toLowerCase())
      )
    );
  });
}
```

---

## Part 3: Combined Filter Bar

Both filters live in the filter area above the task table, alongside the existing filters (status, order, resource name search):

```
┌─────────────────────────────────────────────────────────────────────┐
│ Status: [All] [Scheduled] [Infeasible] [Excluded]                   │
│ Order:  [All orders          ▾]                                      │
│ Resource: [▾ Hierarchy browser]    Attribute: [🔍 Search...]        │
│                                                                      │
│ Active filters: Machining > CNC (3 resources) · ASME-TIG      [×]  │
│ 12 of 70 tasks shown                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Active filter chips

When filters are applied, show them as dismissible chips:

```typescript
// Hierarchy selections
{selectedResources.size > 0 && (
  <FilterChip
    label={`${selectedWorkCenters.join(', ')} (${selectedResources.size} resources)`}
    onClear={() => setSelectedResources(new Set())}
  />
)}

// Attribute selections
{selectedAttributes.map(attr => (
  <FilterChip
    key={`${attr.name}:${attr.value}`}
    label={`${attr.value} (${attr.name})`}
    onClear={() => removeAttributeFilter(attr)}
  />
))}
```

### Filter count

Show "N of M tasks shown" whenever any filter is active, so the planner knows they're looking at a subset.

---

## Part 4: Hierarchy Data Source

The hierarchy tree needs Work Center and Type groupings. These already exist in the solve response's `resourceUtilization` array:

```json
{
  "resourceKey": "FAB-JACK",
  "resourceName": "Jack P. (Senior Fabricator)",
  "workCenter": "Fabrication",
  "resourceType": "Welder",
  "utilization": 85.2
}
```

If `workCenter` or `resourceType` aren't populated for a tenant, fall back to a flat list (no hierarchy, just resource names). The tree degrades gracefully.

For attributes, the resource data needs to include them in the solve response. Add to `extractResults()`:

```typescript
// In resourceUtilization mapping:
resourceUtilization.push({
  // ... existing fields ...
  attributes: resource.attributes?.toArray().map(a => ({
    name: a.name,
    value: a.value,
  })) || [],
});
```

This is a small backend change — just include the existing attributes in the response.

---

## Part 5: Task Detail Panel — Attribute Rejections

When the engine attribute matching sprint is built, the task detail panel shows rejections in the bottleneck section:

```
── Resource Qualification ──────────────────────
  ✓ FAB-JACK: ASME-TIG certified
  ✓ FAB-LUKE: AWS-D1.1 certified
  ✕ FAB-AROHA: lacks ASME-TIG (has: AWS-D1.1, MIG)
  
  2 of 3 welders qualified for this task
```

This uses the `attributeRejections` array from the engine sprint. The UI just renders it — the engine does the filtering.

For now (before the engine sprint), this section is hidden. It appears automatically when `attributeRejections` data is present in the solve response.

---

## Verification

### Hierarchy browser
- [ ] Tree renders with Work Center → Type → Resource levels
- [ ] Expand/collapse works on each level
- [ ] Checkbox selection propagates to children
- [ ] Indeterminate state on partial selection
- [ ] Utilization bars show correct percentages
- [ ] Task count badges accurate at each level
- [ ] Task table filters to selected resources
- [ ] Empty selection shows all tasks (no filter)
- [ ] Works when workCenter/resourceType not populated (flat list fallback)

### Attribute search
- [ ] Autocomplete suggestions appear on typing
- [ ] Suggestions show attribute name, value, and resource count
- [ ] Selecting a suggestion filters the task table
- [ ] Multiple attribute selections combine with AND
- [ ] Clear removes the filter
- [ ] Case-insensitive matching

### Combined filtering
- [ ] Hierarchy + attribute filters combine with AND
- [ ] Hierarchy + attribute + status/order filters all combine
- [ ] Active filter chips show all applied filters
- [ ] Dismissing a chip removes that filter
- [ ] "N of M tasks shown" count is accurate
- [ ] Clearing all filters restores full task list

### Backend
- [ ] Resource attributes included in solve response `resourceUtilization`
- [ ] Attribute index builds correctly from resource data

### Cross-tenant
- [ ] Stafford: Fabrication > Welder > FAB-JACK; search "ASME" finds ASME tasks
- [ ] Acme: OR > Operating Room > OR-01; search "arthroscopy" finds OR-01 tasks
- [ ] HRMD: Fields > Full-size > FIELD-01; search by field attributes
- [ ] Tenant without workCenter grouping: flat resource list, no hierarchy

---

*Build order: Backend attribute data in solve response (~15 min), hierarchy tree component (~1 hour), attribute search with autocomplete (~45 min), combined filter bar integration (~15 min). The task detail rejection display comes free when the engine sprint ships.*
