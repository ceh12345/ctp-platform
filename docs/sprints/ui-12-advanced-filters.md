# Sprint 12: Advanced Filters (Typed Attribute Filtering)

**What it does:** An advanced filter popup that dynamically builds filter controls from the tenant's typed attribute schemas. Users can filter tasks and resources by any typed attribute — sport, division, park, surface, lighting, certification, etc. — using appropriate UI controls per data type. Works across all tenants without custom code.

**Prompt files:** `ui-12.1-advanced-filters.md` (this file — frontend-only, no engine changes needed)

**Scenarios:** All — especially useful for multi-sport (HRMD), multi-specialty (Healthcare), and large manufacturing schedules  
**Depends on:** Sprint 3 (Filter infrastructure), Sprint 11 (Process Category)

---

## Why

Sprint 3 added column-level filters for Resource, Order, Product, Priority, and Status. Sprint 11 added a Category column filter. But typed attributes are tenant-specific and much richer — HRMD has sport, division, park, surface, lighting. Healthcare would have surgeon, procedure type, equipment. Manufacturing has material grade, tooling, tolerance.

Today these attributes are returned in the solve response as `typedAttributes` arrays on every task and resource, but there's no UI to filter by them. The schemas defining these attributes are already loaded per tenant.

An advanced filter popup reads the schemas, builds appropriate filter controls per data type, and applies client-side filtering to the task table and optionally the Gantt.

---

## Design

### Trigger

Add an **"Advanced Filters"** button (funnel icon with a + badge) next to the existing filter bar. When clicked, opens a slide-out panel or modal dialog.

If any advanced filters are active, the button shows a badge count (e.g. "Advanced Filters (2)") and the active filters appear as chips in the existing filter bar alongside the Sprint 3 column filters.

### Panel Layout

```
┌─────────────────────────────────────────────┐
│  Advanced Filters                     [X]   │
│─────────────────────────────────────────────│
│                                             │
│  ── Task Attributes ──────────────────────  │
│                                             │
│  Sport         [Baseball ▼] [Flag F. ▼]    │
│                ☑ Baseball                   │
│                ☑ Flag Football              │
│                ☐ Pickleball                 │
│                                             │
│  Division      [All ▼]                      │
│                ☐ T-Ball    ☐ Coach Pitch    │
│                ☑ Minors    ☑ Majors         │
│                ☐ K-2       ☐ 3-5    ☐ 6-8  │
│                ☐ Open      ☐ Drop-In        │
│                                             │
│  Home Team     [Search... ▼]                │
│                                             │
│  Phase         ☐ prep  ☑ play  ☐ reset     │
│                                             │
│  Game Week     [= 1    ▼]                   │
│                                             │
│  ── Resource Attributes ────────────────── │
│                                             │
│  Park          [All ▼]                      │
│                ☑ Redstone Park              │
│                ☐ Falcon Park                │
│                ☐ Northridge Park            │
│                ...                          │
│                                             │
│  Surface       ☐ dirt  ☑ grass  ☐ turf     │
│                                             │
│  Lighting      ◉ Any  ○ Yes  ○ No          │
│                                             │
│  Certification [All ▼]                      │
│                                             │
│─────────────────────────────────────────────│
│  [Clear All]              [Apply Filters]   │
└─────────────────────────────────────────────┘
```

### Control Type by Data Type

The schemas define each attribute's `dataType`. Use this to pick the right UI control:

| dataType | UI Control | Example |
|----------|-----------|---------|
| `enum` | Multi-select checkbox list | Sport: ☑ Baseball ☑ Flag Football ☐ Pickleball |
| `string` | Searchable multi-select dropdown (auto-complete from distinct values in solve response) | Home Team: [Search...] |
| `integer` | Number input with operator dropdown (=, >, <, range) | Game Week: [= 1] |
| `boolean` | Three-state toggle: Any / Yes / No | Lighting: ◉ Any ○ Yes ○ No |
| `float` | Number input with operator dropdown | (not used in current tenants) |

### Data Sources

**Schema definitions** — read from the tenant's schema files (already loaded by ConfigService):
- `schemas/task.schema.json` → task attribute definitions
- `schemas/resource.schema.json` → resource attribute definitions

These provide: attribute name, dataType, enumValues (for enums), category, sequence.

**Distinct values** — for `string` type attributes, scan the solve response to build the list of distinct values:

```typescript
// Build distinct values for string attributes from solve response
const distinctValues = new Map<string, Set<string>>();
tasks.forEach(task => {
  task.typedAttributes?.forEach(attr => {
    if (attr.dataType === 'string' && attr.value?.value) {
      if (!distinctValues.has(attr.name)) distinctValues.set(attr.name, new Set());
      distinctValues.get(attr.name)!.add(attr.value.value);
    }
  });
});
```

**Enum values** — read directly from the schema's `enumValues` array. Don't scan solve response for these — the schema is authoritative.

### Sections

Group attributes by their source:

1. **Task Attributes** — from `task.schema.json`. Filters the task table rows.
2. **Resource Attributes** — from `resource.schema.json`. Filters by "tasks assigned to resources matching these attributes."

Resource attribute filtering is slightly more complex: if user selects "Park = Redstone Park", filter to tasks where any `assignedResource` has that park attribute. This requires cross-referencing the resource utilization data.

### Attribute Display Names

Use the attribute `name` as the label, formatted with title case: `homeTeam` → "Home Team", `lightingAvailable` → "Lighting Available", `certificationLevel` → "Certification Level".

If terminology mappings include attribute names (e.g. `"homeTeam": "Home Team"`), use those. Otherwise auto-format from camelCase.

### Attribute Ordering

Use the `sequence` field from the schema to order attributes within each section. Lower sequence = higher in the panel.

---

## Filtering Logic

### Task Attribute Filters

For each active task attribute filter, check the task's `typedAttributes` array:

```typescript
function matchesAdvancedFilters(task: TaskResult, filters: AdvancedFilter[]): boolean {
  return filters.every(filter => {
    if (filter.section === 'task') {
      const attr = task.typedAttributes?.find(a => a.name === filter.attribute);
      if (!attr) return false;
      return matchesFilter(attr, filter);
    }
    if (filter.section === 'resource') {
      // Task matches if ANY assigned resource matches
      return task.assignedResources?.some(res => {
        const resUtil = resourceUtilization.find(r => r.resourceKey === res.resourceKey);
        // Need resource typed attributes — see "Resource Attributes in Response" below
        const resAttr = resUtil?.typedAttributes?.find(a => a.name === filter.attribute);
        if (!resAttr) return false;
        return matchesFilter(resAttr, filter);
      });
    }
    return true;
  });
}

function matchesFilter(attr: TypedAttribute, filter: AdvancedFilter): boolean {
  const val = attr.value?.value;
  switch (filter.operator) {
    case 'in': return filter.values.includes(val);           // enum, string multi-select
    case 'equals': return val === filter.value;              // integer, string single
    case 'greaterThan': return val > filter.value;           // integer
    case 'lessThan': return val < filter.value;              // integer
    case 'isTrue': return val === true;                      // boolean
    case 'isFalse': return val === false;                    // boolean
    default: return true;
  }
}
```

### Resource Attributes in Response

Currently, `resourceUtilization` in the solve response does NOT include typed attributes. To support resource attribute filtering, either:

**Option A (preferred — small engine change):** Add `typedAttributes` to the `resourceUtilization` entries in `extractResults()`. The data is already in the config:

```typescript
// In extractResults, when building resourceUtilization:
const resConfig = resourceConfigMap.get(resource.key);
resourceUtilization.push({
  resourceKey: resource.key,
  resourceName: resource.name,
  // ... existing fields ...
  typedAttributes: resConfig?.typedAttributes ?? [],  // NEW
});
```

**Option B (frontend-only):** Load the resource schema + resource config separately via an API call or from the state summary endpoint, and cross-reference client-side.

Option A is cleaner — one extra line in extractResults.

### Multiple Filters = AND Logic

If user selects Sport = Baseball AND Division = Majors, both must match. If user selects Sport = [Baseball, Flag Football] (multi-select within one attribute), it's OR within that attribute (matches either).

So: AND across attributes, OR within a multi-select attribute.

---

## Filter State Management

```typescript
interface AdvancedFilter {
  section: 'task' | 'resource';
  attribute: string;                    // e.g. "sport", "park", "lightingAvailable"
  dataType: 'enum' | 'string' | 'integer' | 'boolean' | 'float';
  operator: 'in' | 'equals' | 'greaterThan' | 'lessThan' | 'isTrue' | 'isFalse' | 'any';
  values?: any[];                       // for multi-select (enum, string)
  value?: any;                          // for single value (integer, boolean)
  label: string;                        // display name for filter chip
}

// State
const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([]);
```

### Filter Chips in Existing Bar

Active advanced filters appear as chips alongside Sprint 3 column filter chips:

```
[Status: Scheduled ×] [Sport: Baseball ×] [Park: Redstone Park ×] [Lighting: Yes ×]  [Clear All]
```

Clicking × on a chip removes that specific advanced filter. "Clear All" clears everything (Sprint 3 + advanced).

### Persistence

Advanced filter state lives in React state only — resets on page reload. No localStorage needed (not supported in artifacts environment).

---

## Cross-Tenant Examples

### HRMD Sports — "Show me Saturday baseball at Redstone"

Task filters:
- Sport = Baseball
- Phase = play (hide prep/reset clutter)

Resource filters:
- Park = Redstone Park

Result: Only baseball PLAY tasks assigned to Redstone Park fields.

### Healthcare — "Show me orthopedic cases in OR-1 and OR-2"

Task filters:
- Category = Orthopedic (from Sprint 11)

Resource filters:
- (filter by specific OR room resource — already available via Sprint 3 Resource column filter)

### Manufacturing — "Show me machining tasks on lighted equipment"

Task filters:
- Category = Machining (from Sprint 11)

Resource filters:
- Lighting = Yes

---

## Verification

After implementing:

- [ ] Advanced Filters button appears next to existing filter bar
- [ ] Panel dynamically builds controls from tenant schema files
- [ ] Enum attributes show multi-select checkbox lists with correct values
- [ ] String attributes show searchable dropdown with distinct values from solve response
- [ ] Integer attributes show number input with operator dropdown
- [ ] Boolean attributes show three-state toggle (Any/Yes/No)
- [ ] Attributes are ordered by `sequence` field from schema
- [ ] Filtering applies correctly — AND across attributes, OR within multi-select
- [ ] Active filter count shown on button badge
- [ ] Active filters appear as removable chips in filter bar
- [ ] "Clear All" clears both Sprint 3 column filters and advanced filters
- [ ] Works correctly with HRMD Sports tenant (sport, division, park, lighting)
- [ ] Works correctly with Manufacturing tenant (if typed attributes exist)
- [ ] Works correctly with Healthcare tenant (if typed attributes exist)
- [ ] Graceful behavior when tenant has no typed attribute schemas (panel shows "No advanced filters available")
- [ ] Resource attribute filtering works (tasks filtered by assigned resource attributes)
- [ ] Column header terminology respected in filter labels

---

## Size Estimate

- Engine: ~5 lines (add typedAttributes to resourceUtilization response — Option A)
- Frontend: New AdvancedFilterPanel component (~300-400 lines), filter state management, chip integration
- Total: ~2-3 hours CC work

---

## Dependencies

- **Sprint 3** — existing filter bar and chip infrastructure
- **Sprint 11** — process category column (provides the high-level "Sport"/"Specialty" grouping that most users will use first, before drilling into typed attributes)
- **Tenant schemas** — must exist for the panel to render (HRMD prompt already defines these)
