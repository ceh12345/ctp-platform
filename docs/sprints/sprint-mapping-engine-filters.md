# Sprint — Mapping Engine Filter Support

Add tenant-specific record filtering to the mapping engine. Records matching exclusion criteria get dropped before mapping runs, so admin/overhead/non-production records never become CTP entities.

This is engine work, not just config work — the mapping engine needs to learn how to filter. Once added, individual tenants (starting with Stafford) can declare filter rules in their mapping config without further engine changes.

**Scope:** engine capability + Stafford filter rules + cascade handling. Probably 4-8 hours of work depending on engine structure.

**Status:** Build AFTER the Stafford meeting. The meeting will surface which filters matter; this sprint then implements them. Drafted now to capture the design while it's fresh.

## Why this exists

Stafford's WORK7 contains records that aren't real production work — admin overhead, breaktime tracking, system-internal jobs. These records appear alongside real work orders in the API responses, and currently flow through to CTP as if they were schedulable work.

Examples found in the slim test:
- WO 20540 — "BREAKTIMES", customer is Stafford itself, ItemFamily=NA
- WO 99500 — "VERIFIED BREAKTIMES APPLIED TO TIME", admin overhead
- Several work orders with `Job` values starting with "SYST" — system overhead

These pollute the schedule, confuse the demo, and produce edge cases that aren't worth handling (zero-duration tasks, sentinel dates, missing customers).

The right answer is to exclude them before they reach the engine. The cleanest place to do that is in the mapping layer, expressed as tenant-specific config.

## Architecture decision: where filtering lives

This sprint puts filtering in the **mapping engine**, not in the adapter or in the API call. Reasons documented in detail:

**Filtering is tenant-specific business logic.** "Exclude jobs starting with SYST" is a Stafford convention. Other tenants will have different conventions. Tenant config is the right home for tenant rules.

**Mapping config is already where tenant-specific transformation lives.** Adding filtering keeps related concerns together. A reader can see "for this tenant, here's what we exclude and how we transform what's left" in one file.

**Source-system independent.** Adapter filtering would couple to specific API capabilities. Mapping filtering works the same regardless of upstream source.

**Visibility and debuggability.** Single layer to check when records are missing. "Was it filtered out?" has one place to look.

**Genius API filter syntax is limited.** API-level filtering would require Genius to support `LIKE`/`startsWith` operations, which we haven't confirmed. Mapping-level filtering doesn't depend on source capabilities.

### What we are NOT doing

- DO NOT put filter logic in adapter code (tenant logic doesn't belong in shared infrastructure)
- DO NOT push filters to the Genius API call (limited syntax, brittle to upstream changes)
- DO NOT mix filter rules with mapping rules in the same entry (different concerns)
- DO NOT filter inconsistently across entities — if a work order is filtered, its tasks must also be filtered (cascade rules below)

## What to build

Three pieces in the engine:

### 1. Filter rule schema in mapping config

Add a `filters` section to each entity in the mapping config. Initial schema:

```json
"orders": {
  "filters": {
    "exclude": [
      { "field": "Job",        "startsWith": "SYST" },
      { "field": "ItemFamily", "equals":     "NA"   },
      { "field": "ItemCode",   "startsWith": "Z-"   }
    ]
  },
  "mappings": {
    "key": { "from": "WorkOrder" },
    // ... existing mappings unchanged
  }
}
```

Rules within a single `exclude` array combine with OR semantics: if any rule matches, the record is excluded. (You can express AND by adding a single composite rule with multiple conditions, but most filtering needs are simple OR-of-exclusions.)

### 2. Filter predicate operators

Support these predicates initially. Add more as concrete needs arise.

- `equals` — exact match
- `notEquals` — exact non-match
- `startsWith` — string prefix match
- `endsWith` — string suffix match
- `contains` — substring match
- `in` — value in a list (`"in": ["A", "B", "C"]`)
- `notIn` — value not in a list
- `isNull` — field is null or missing
- `isNotNull` — field is present and not null

Each predicate operates on a single field. The schema is `{ "field": "<name>", "<predicate>": "<value>" }`.

Don't implement: complex AND/OR combinators, regex (use sparingly if needed later), nested field paths beyond top-level. Keep it simple. Add complexity when concrete needs arise.

### 3. Cascade rules between entities

When a parent entity is filtered, child entities referencing it must also be filtered. Otherwise tasks become orphaned (referencing work orders that no longer exist in the landscape).

Two ways to handle this:

**Option A (preferred): explicit cascade declaration**

In the entity that depends on another, declare the parent reference:

```json
"tasks": {
  "filters": {
    "cascadeFrom": "orders",
    "cascadeOn": { "field": "WorkOrderCode", "matchesParentField": "key" }
  },
  "mappings": { ... }
}
```

This says "when an order is filtered, tasks where `WorkOrderCode` matches the filtered order's `key` field are also filtered."

The mapping engine processes orders first, builds a set of accepted order keys, then filters tasks against that set in addition to any task-specific filter rules.

**Option B (simpler but more verbose): parallel filter rules**

Each entity declares its own filters explicitly. To filter SYST work orders AND their tasks, you'd write the SYST filter on both:

```json
"orders": {
  "filters": {
    "exclude": [{ "field": "Job", "startsWith": "SYST" }]
  }
},
"tasks": {
  "filters": {
    "exclude": [{ "field": "JobCode", "startsWith": "SYST" }]
  }
}
```

This works but requires the rule to be duplicated and kept in sync.

**Recommendation:** Implement Option A. It's marginally more engine work but produces simpler tenant config and prevents the silent-orphan failure mode. If you start with Option B for time reasons, document the cascade requirement clearly so it gets caught in review.

## Stafford-specific filter rules to add

Add these to `config/tenants/stafford-engineering-test/integration/mapping.json` once the engine supports filters. **Do not add them before the meeting** — wait for Kaleb to confirm which filters are appropriate. The list below is the proposed set based on data analysis; the meeting will confirm or refine.

### Orders (work orders)

```json
"orders": {
  "filters": {
    "exclude": [
      { "field": "Job",        "startsWith": "SYST" },
      { "field": "ItemFamily", "equals":     "NA"   },
      { "field": "ItemCode",   "startsWith": "Z-"   },
      { "field": "JobType",    "equals":     "U"    }
    ]
  },
  "mappings": { ... }
}
```

Each of these rules has been observed to identify admin/overhead records in the slim data. The combination should exclude breaktime tracking, system overhead, and untyped work while preserving real production work orders.

### Tasks (cascade from orders + own filters)

```json
"tasks": {
  "filters": {
    "cascadeFrom": "orders",
    "cascadeOn":   { "field": "WorkOrderCode", "matchesParentField": "key" },
    "exclude": [
      // Any task-specific rules can go here.
      // Empty for now — orders cascade should handle most cases.
    ]
  },
  "mappings": { ... }
}
```

Tasks belonging to filtered work orders are automatically excluded. No additional task-level filters needed initially.

### Resources (no filters likely)

Resources probably don't need filtering. The 77 resources in slim are all real (machines, operators, subcontract). Worth confirming with Kaleb but no obvious admin/overhead resources to exclude.

## Engine implementation guidance

Concrete implementation suggestions. Adapt to your engine's actual structure.

### Where to add filter logic

Probably in the same module that orchestrates mapping — wherever rules iterate over source records and produce output entities. Add a pre-mapping filter pass:

```typescript
function processEntity(
  records: SourceRecord[],
  config: EntityMappingConfig,
  parentFilter?: Set<string>
): MappedEntity[] {
  // 1. Apply filter rules
  const filtered = records.filter(record => {
    // Cascade filter: skip if parent was filtered
    if (parentFilter && config.filters?.cascadeOn) {
      const parentRef = record[config.filters.cascadeOn.field];
      if (!parentFilter.has(parentRef)) return false;
    }

    // Exclusion filter: skip if any exclude rule matches
    if (config.filters?.exclude) {
      for (const rule of config.filters.exclude) {
        if (matchesRule(record, rule)) return false;
      }
    }

    return true;
  });

  // 2. Apply mapping rules to remaining records
  return filtered.map(record => applyMapping(record, config.mappings));
}
```

### Predicate evaluation

A simple dispatch on the predicate type:

```typescript
function matchesRule(record: any, rule: FilterRule): boolean {
  const value = record[rule.field];

  if ('equals' in rule)      return value === rule.equals;
  if ('notEquals' in rule)   return value !== rule.notEquals;
  if ('startsWith' in rule)  return typeof value === 'string' && value.startsWith(rule.startsWith);
  if ('endsWith' in rule)    return typeof value === 'string' && value.endsWith(rule.endsWith);
  if ('contains' in rule)    return typeof value === 'string' && value.includes(rule.contains);
  if ('in' in rule)          return rule.in.includes(value);
  if ('notIn' in rule)       return !rule.notIn.includes(value);
  if ('isNull' in rule)      return value === null || value === undefined;
  if ('isNotNull' in rule)   return value !== null && value !== undefined;

  throw new Error(`Unknown filter predicate in rule: ${JSON.stringify(rule)}`);
}
```

### Cascade execution order

Process entities in dependency order: orders before tasks. Build a set of accepted order keys; pass that set as `parentFilter` when processing tasks.

```typescript
const acceptedOrders = processEntity(rawOrders, mappingConfig.orders);
const acceptedOrderKeys = new Set(acceptedOrders.map(o => o.key));

const acceptedTasks = processEntity(rawTasks, mappingConfig.tasks, acceptedOrderKeys);
```

If your mapping engine processes entities independently today, this introduces a dependency. Worth being deliberate about ordering.

### Logging

Add filter-result logging at info level:

```
[mapping] orders: 956 source records → 932 accepted, 24 filtered
  - 18 matched: Job startsWith 'SYST'
  - 4 matched: ItemFamily equals 'NA'
  - 2 matched: ItemCode startsWith 'Z-'

[mapping] tasks: 3118 source records → 2987 accepted (cascade from orders), 131 filtered
  - 131 cascade-filtered (parent orders excluded)
```

Visibility into what got filtered is essential for debugging "where did record X go?" questions later.

## Testing requirements

### Unit tests for predicates

Each predicate operator gets tested with positive and negative cases:
- `equals` matches when value equals, fails otherwise
- `startsWith` matches when prefix matches, fails on no-match, fails on non-string value
- `in` matches when value is in list, fails when not, handles empty list
- `isNull` matches null and undefined, fails on actual values including empty string and 0
- etc.

### Integration tests with cascade

A canned test case:
- Orders: 5 records, 2 match exclusion (Job startsWith SYST)
- Tasks: 20 records, 10 belong to the 2 excluded orders
- After processing: 3 orders accepted, 10 tasks accepted (cascade dropped the 10)

### Edge cases

- Empty filter rules section: behaves as no-filter
- Records with null/missing fields referenced by filters: predicates handle gracefully
- Filter rule referencing field that doesn't exist on records: clear error message, not silent pass-through

### Regression tests against slim data

Apply the proposed Stafford filter rules to the slim-100 dataset. Expected outcomes:
- Both admin work orders (20540, 99500) excluded
- Tasks belonging to those work orders excluded via cascade
- Real production work orders (27187, 27164, etc.) still included
- Slim test still produces 101 unique tasks for the production WOs (plus any drops from cascade)

Document the expected before/after numbers in the change log.

## Acceptance criteria

### Engine changes

- [ ] Mapping engine supports `filters` block per entity in mapping config
- [ ] All eight initial predicates implemented and tested
- [ ] Cascade filtering works (Option A preferred): when parent is filtered, children using `cascadeOn` are also filtered
- [ ] Filter results logged at info level with per-rule breakdown
- [ ] Unknown predicate produces clear error, not silent pass-through

### Stafford-specific config (only after meeting)

- [ ] Stafford mapping config has filters for orders (Job startsWith SYST, ItemFamily NA, ItemCode Z-, JobType U)
- [ ] Tasks have cascade configured to drop based on parent order filtering
- [ ] Slim test reflects expected reduction in records

### Documentation

- [ ] Mapping config schema updated to include filters
- [ ] Comment in code explains why filtering lives in mapping engine, not adapter or API
- [ ] Change log entry documenting the new capability

### What CC should NOT do

- Don't add filter rules to Stafford's config before the meeting (the proposed rules are speculative; meeting will confirm)
- Don't skip the cascade work — orphaned children are a real bug
- Don't add API-level filtering (different layer, different concerns)
- Don't try to handle complex boolean combinators (AND/OR/NOT) — keep predicate set simple

## Change log entry to append

```markdown
## Mapping Engine — Filter Support (date)

### What changed

Mapping engine now supports per-entity `filters` blocks in tenant mapping config. Records matching exclusion rules are dropped before mapping runs, so they never become CTP entities.

### Why

Tenant-specific business rules for excluding admin/overhead records were previously not expressible. Stafford specifically has SYST-prefix system jobs, NA item families, and Z-prefix internal items that shouldn't appear in production scheduling. Filtering at the mapping layer is tenant-config-driven, source-system independent, and centrally debuggable.

### How to use

Add to entity config in mapping.json:

\`\`\`json
"orders": {
  "filters": {
    "exclude": [
      { "field": "Job", "startsWith": "SYST" }
    ]
  },
  "mappings": { ... }
}
\`\`\`

For child entities, declare cascade:

\`\`\`json
"tasks": {
  "filters": {
    "cascadeFrom": "orders",
    "cascadeOn":   { "field": "WorkOrderCode", "matchesParentField": "key" }
  }
}
\`\`\`

### Predicates supported

equals, notEquals, startsWith, endsWith, contains, in, notIn, isNull, isNotNull

### Migration

No required changes for tenants that don't use filters — feature is opt-in. Stafford's specific filter rules added in a coordinated update once Kaleb confirms which exclusions are appropriate.

### Outstanding questions

- Should resources have filter capability? Probably yes for completeness, but no obvious filter rules for Stafford resources.
- Should filters log filtered records to a separate audit file for compliance? Defer until concrete need.
- Should cascade be optional ("filter children automatically") or always-required when declared? Currently always-required if `cascadeFrom` is set.
```

## What I'll do with the output

1. Review the engine implementation against acceptance criteria
2. Run the test suite, confirm new tests pass and no regressions
3. Manually test with the slim-100 scenario before adding Stafford-specific filter rules
4. After the Stafford meeting, add the confirmed filter rules to Stafford's mapping config
5. Re-run slim test, document the before/after counts
6. Update the mapping doc to reflect filtering as a capability

This sprint adds a focused new capability to the engine. The capability is generic; the rules are tenant-specific. Build the capability now (whenever you're ready, after the meeting), apply the rules incrementally as Kaleb confirms them.

## Sequencing note

This sprint should land **after** the Stafford meeting, not before. Reasons:

- Filter rules are speculative until Kaleb confirms which records to exclude
- Some "obvious" filter candidates might turn out to be records Stafford does want scheduled (e.g., maybe they DO want breaktime tracking visible)
- Engine work is faster to do once with confirmed requirements than iteratively
- Meeting is the natural source of "here are the filter rules we need" input

In the meantime, the unfiltered slim data is fine for the demo. The admin records (20540, 99500) become talking points: "should these be in the schedule? what filters would you want?"

That conversation drives this sprint's specific rules.
