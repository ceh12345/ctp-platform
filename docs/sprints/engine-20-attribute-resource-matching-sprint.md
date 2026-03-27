# Engine Sprint: Attribute-Based Resource Matching

**What it does:** Hard-filter resource preferences by attribute requirements before the combination engine runs. A task slot declares "I need a resource with ASME-TIG certification and tonnage >= 200" — any preference that doesn't match is pruned from the candidate list with a logged rejection reason. Requirements can originate from the task slot, process step, product, or tenant defaults, merged via AND (OR infrastructure built but not exercised).

**Size:** ~3-4 hours CC work
**Depends on:** Nothing (engine-only, no UI changes required)
**Unlocks:** Correct resource assignment for Stafford (ASME certs), Healthcare (specialties), Pharma (cleanroom ratings); feeds into bottleneck display and AI explanation

---

## Why

Today, "which resources can do this task" is determined entirely by explicit enumeration in the preference list. The preference mode system (REQUIRED/PREFERRED/AVAILABLE/EXCLUDED) controls solver priority among known candidates — not eligibility.

Real-world problem: the AI suggested moving ASME welds to non-ASME welders because the ASME certification was modeled as a preference (soft), not a requirement (hard). The workaround — manually listing only certified welders — is brittle when resources change and doesn't let the engine explain why a resource was excluded.

Every tenant has this need:

| Tenant | Attribute Need | Example |
|--------|---------------|---------|
| Stafford | Welder certification | `certifications contains "ASME-TIG"` |
| Stafford | Machine tonnage | `tonnage gte 200` |
| Healthcare | Surgeon specialty | `specialty contains "orthopedics"` |
| Pharma | Cleanroom rating | `cleanroomClass lte 5` |
| Sports | Field size | `fieldSize equals "full"` |
| Manufacturing | Material capability | `materials contains "stainless"` |

---

## Part 1: AttributeRequirement Interface

Create: `Models/Core/attributerequirement.ts`

```typescript
/**
 * A single attribute requirement — a condition that a resource must satisfy.
 * Multiple requirements are combined via logical operators (AND by default).
 */
export interface IAttributeRequirement {
  /** The attribute name to check on the resource (e.g., "certifications", "tonnage") */
  attribute: string;

  /** Comparison operator */
  operator: 'equals' | 'contains' | 'gte' | 'lte' | 'in' | 'not_equals';

  /** The value to compare against. Type depends on operator:
   *  - equals/not_equals: string or number
   *  - contains: string (checked against comma-separated list or substring)
   *  - gte/lte: number
   *  - in: string[] (resource value must be one of these)
   */
  value: string | number | string[];

  /** Logical connector to the NEXT requirement in the list.
   *  'AND' = both this and next must pass (default).
   *  'OR' = this or next must pass.
   *  Last requirement in the list ignores this field.
   */
  logical?: 'AND' | 'OR';
}

export class AttributeRequirement implements IAttributeRequirement {
  public attribute: string;
  public operator: 'equals' | 'contains' | 'gte' | 'lte' | 'in' | 'not_equals';
  public value: string | number | string[];
  public logical: 'AND' | 'OR';

  constructor(
    attribute: string,
    operator: IAttributeRequirement['operator'],
    value: string | number | string[],
    logical?: 'AND' | 'OR',
  ) {
    this.attribute = attribute;
    this.operator = operator;
    this.value = value;
    this.logical = logical ?? 'AND';
  }
}
```

---

## Part 2: AttributeRejection Interface

Records why a specific resource was rejected for a specific task slot.

```typescript
/**
 * A record of why a resource was rejected by attribute matching.
 * Stored on the task for bottleneck display and AI explanation.
 */
export interface IAttributeRejection {
  resourceKey: string;
  resourceName: string;
  /** The requirement that failed */
  requirement: IAttributeRequirement;
  /** What the resource actually has (null if attribute not found) */
  actualValue: string | number | null;
  /** Human-readable explanation */
  reason: string;
}

export class AttributeRejection implements IAttributeRejection {
  public resourceKey: string;
  public resourceName: string;
  public requirement: IAttributeRequirement;
  public actualValue: string | number | null;
  public reason: string;

  constructor(
    resourceKey: string,
    resourceName: string,
    requirement: IAttributeRequirement,
    actualValue: string | number | null,
  ) {
    this.resourceKey = resourceKey;
    this.resourceName = resourceName;
    this.requirement = requirement;
    this.actualValue = actualValue;
    this.reason = AttributeRejection.buildReason(resourceName, requirement, actualValue);
  }

  static buildReason(
    resourceName: string,
    req: IAttributeRequirement,
    actual: string | number | null,
  ): string {
    if (actual === null || actual === undefined) {
      return `${resourceName} has no "${req.attribute}" attribute (required: ${req.operator} ${JSON.stringify(req.value)})`;
    }
    return `${resourceName}: ${req.attribute} is "${actual}" (required: ${req.operator} ${JSON.stringify(req.value)})`;
  }
}
```

---

## Part 3: Attribute Matcher — The Evaluation Engine

Create: `Engines/attributematcher.ts`

This is a pure function — no dependencies on landscape or task state. Takes a list of requirements and a resource's attributes, returns pass/fail with rejection details.

```typescript
import { CTPAttributes } from '../Lists/lists';
import { IAttributeRequirement, IAttributeRejection, AttributeRejection } from '../Models/Core/attributerequirement';

export class AttributeMatcher {

  /**
   * Evaluate a single requirement against a resource's attributes.
   * Returns null if the requirement passes, or an IAttributeRejection if it fails.
   */
  static evaluateOne(
    req: IAttributeRequirement,
    resourceKey: string,
    resourceName: string,
    attributes: CTPAttributes,
  ): IAttributeRejection | null {
    // Find the attribute on the resource
    let attrValue: string | number | null = null;
    attributes.forEach(attr => {
      if (attr.name === req.attribute) {
        attrValue = attr.value;
      }
    });

    // Also check typedAttributes if available (newer path)
    // The resource may store attributes in the typedAttributes map
    // Fall through to raw attributes above if not found

    // Attribute not found on resource → fails (unless operator is not_equals)
    if (attrValue === null || attrValue === undefined) {
      if (req.operator === 'not_equals') return null; // not having it satisfies "not equals X"
      return new AttributeRejection(resourceKey, resourceName, req, null);
    }

    // Coerce for numeric comparisons
    const numericActual = typeof attrValue === 'number' ? attrValue : parseFloat(attrValue as string);

    let passes = false;

    switch (req.operator) {
      case 'equals':
        passes = String(attrValue).toLowerCase() === String(req.value).toLowerCase();
        break;

      case 'not_equals':
        passes = String(attrValue).toLowerCase() !== String(req.value).toLowerCase();
        break;

      case 'contains': {
        // Check if the attribute value contains the required string.
        // Supports comma-separated lists: "ASME-TIG,AWS-D1.1" contains "ASME-TIG"
        const actualStr = String(attrValue).toLowerCase();
        const reqStr = String(req.value).toLowerCase();
        // Try comma-separated list first
        const parts = actualStr.split(',').map(s => s.trim());
        passes = parts.includes(reqStr) || actualStr.includes(reqStr);
        break;
      }

      case 'gte':
        passes = !isNaN(numericActual) && numericActual >= Number(req.value);
        break;

      case 'lte':
        passes = !isNaN(numericActual) && numericActual <= Number(req.value);
        break;

      case 'in': {
        // Resource value must be one of the provided options
        const options = Array.isArray(req.value) ? req.value : [String(req.value)];
        passes = options.some(opt => String(opt).toLowerCase() === String(attrValue).toLowerCase());
        break;
      }
    }

    return passes ? null : new AttributeRejection(resourceKey, resourceName, req, attrValue);
  }

  /**
   * Evaluate all requirements against a resource using AND/OR logic.
   *
   * AND/OR sequencing works as a stack:
   *   [A AND B AND C] → all must pass
   *   [A OR B AND C]  → (A OR B) AND C
   *   [A AND B OR C]  → (A AND B) OR C
   *
   * Requirements are evaluated left-to-right. OR creates groups;
   * if any group passes, the resource qualifies.
   *
   * For v1, all requirements use AND (the default). The OR infrastructure
   * is built and tested but not exercised by any tenant config yet.
   */
  static evaluate(
    requirements: IAttributeRequirement[],
    resourceKey: string,
    resourceName: string,
    attributes: CTPAttributes,
  ): { passes: boolean; rejections: IAttributeRejection[] } {
    if (!requirements || requirements.length === 0) {
      return { passes: true, rejections: [] };
    }

    const allRejections: IAttributeRejection[] = [];

    // Build OR-groups: split requirements by OR connectors
    // Each group is a set of AND-connected requirements
    const groups: IAttributeRequirement[][] = [];
    let currentGroup: IAttributeRequirement[] = [];

    for (let i = 0; i < requirements.length; i++) {
      currentGroup.push(requirements[i]);
      // If this requirement's logical is OR, close this group and start a new one
      // (The last requirement's logical is ignored — it's the end of the chain)
      if (i < requirements.length - 1 && requirements[i].logical === 'OR') {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }
    groups.push(currentGroup); // push the last group

    // Evaluate each group. If ANY group passes entirely (all ANDs within it), resource qualifies.
    for (const group of groups) {
      let groupPasses = true;
      const groupRejections: IAttributeRejection[] = [];

      for (const req of group) {
        const rejection = AttributeMatcher.evaluateOne(req, resourceKey, resourceName, attributes);
        if (rejection) {
          groupPasses = false;
          groupRejections.push(rejection);
        }
      }

      if (groupPasses) {
        // At least one OR-group passed → resource qualifies
        return { passes: true, rejections: [] };
      }

      allRejections.push(...groupRejections);
    }

    // No group passed → resource rejected
    return { passes: false, rejections: allRejections };
  }
}
```

---

## Part 4: Add `requiredAttributes` to CTPTaskResource

In `task.ts`, add the requirement list to each resource slot:

```typescript
import { IAttributeRequirement, IAttributeRejection } from '../Core/attributerequirement';

export class CTPTaskResource implements ITaskResource {
  // ... existing fields ...

  /** Attribute requirements this resource must satisfy. Merged from task, process, product, tenant. */
  public requiredAttributes: IAttributeRequirement[];

  /** Rejection log — populated by filterPreferencesByAttributes(). */
  public attributeRejections: IAttributeRejection[];

  constructor(r?: string, prim?: boolean, i?: number, schedResource?: string, mode?: string) {
    // ... existing constructor ...
    this.requiredAttributes = [];
    this.attributeRejections = [];
  }
}
```

---

## Part 5: The Filter Method on CTPTaskResource

This is the core integration point — called before `getEffectivePreferences()`:

```typescript
import { AttributeMatcher } from '../../Engines/attributematcher';
import { SchedulingLandscape } from '../Entities/landscape';

// Add to CTPTaskResource class:

/**
 * Filter the preference list by attribute requirements.
 * Removes preferences whose resources don't satisfy all requiredAttributes.
 * Populates attributeRejections with details for each rejected resource.
 *
 * Call this BEFORE getEffectivePreferences().
 * Mutates this.preferences in place (removes failing entries).
 * Mutates this.attributeRejections (replaces with fresh results).
 *
 * @param landscape - needed to look up actual resource objects and their attributes
 */
public filterPreferencesByAttributes(landscape: SchedulingLandscape): void {
  // Clear previous rejections
  this.attributeRejections = [];

  // No requirements → nothing to filter
  if (!this.requiredAttributes || this.requiredAttributes.length === 0) return;

  const qualified: IResourcePreference[] = [];

  for (const pref of this.preferences) {
    const resource = landscape.resources?.getEntity(pref.resourceKey);
    if (!resource) {
      // Resource not found in landscape — reject with explanation
      this.attributeRejections.push({
        resourceKey: pref.resourceKey,
        resourceName: pref.resourceKey,
        requirement: this.requiredAttributes[0],
        actualValue: null,
        reason: `${pref.resourceKey} not found in landscape`,
      });
      continue;
    }

    const result = AttributeMatcher.evaluate(
      this.requiredAttributes,
      resource.key,
      resource.name || resource.key,
      resource.attributes,
    );

    if (result.passes) {
      qualified.push(pref);
    } else {
      this.attributeRejections.push(...result.rejections);
    }
  }

  this.preferences = qualified;
}
```

---

## Part 6: Integration into the Solve Pipeline

The filter must run after the landscape is loaded and overrides are applied, but before the solver builds contexts.

### 6a. Add a landscape-level method for convenience

In `landscape.ts`:

```typescript
/**
 * Run attribute-based resource filtering on all tasks.
 * Call after applying overrides, before running the solver.
 * Returns the total number of preferences rejected.
 */
public filterResourcesByAttributes(): number {
  let totalRejected = 0;
  this.tasks?.forEach(task => {
    if (!task.includeInSolve || task.pinned) return;
    task.capacityResources?.forEach(tr => {
      if (tr.isIgnored()) return;
      const beforeCount = tr.preferences.length;
      tr.filterPreferencesByAttributes(this);
      totalRejected += (beforeCount - tr.preferences.length);
    });
  });
  return totalRejected;
}
```

### 6b. Call in CTPService.solve()

In `ctp_service.ts`, add after override application and before constraint propagation:

```typescript
// ─── 1. Apply overrides in order ───
// ... existing override application (1a through 1f) ...

// ─── 1g. Attribute-based resource filtering ───
const attrRejected = landscape.filterResourcesByAttributes();
if (attrRejected > 0) {
  stats.attributeRejectionsTotal = attrRejected;
}

// ─── 2. Constraint propagation ───
// ... unchanged ...
```

**Why after overrides:** A planner might use resource preference overrides to EXCLUDE a broken machine. That EXCLUDED mode should be applied first (via `getEffectivePreferences`). But wait — the attribute filter runs on `this.preferences` (the raw list), and `getEffectivePreferences()` runs later on whatever's left. So the order is:

1. Overrides applied (modes set on preferences)
2. Attribute filter prunes preferences that fail requirements
3. `getEffectivePreferences()` applies mode logic (EXCLUDED/REQUIRED) on the remaining qualified preferences
4. Combination engine generates combos from the qualified+filtered list

This is correct — attribute rejection and mode exclusion are independent filters that both reduce the candidate set.

---

## Part 7: Merge Requirements from Multiple Sources

The hydrator is responsible for merging requirements from task, process, product, and tenant levels onto each `CTPTaskResource`.

### 7a. Requirement sources in config

**Task-level** (in tasks.json):
```json
{
  "key": "WELD-001",
  "capacityResources": [{
    "resource": "WELDER_SLOT",
    "isPrimary": true,
    "preferences": ["WLD-01", "WLD-02", "WLD-03"],
    "requiredAttributes": [
      { "attribute": "certifications", "operator": "contains", "value": "ASME-TIG" }
    ]
  }]
}
```

**Process-level** (in processes.json or routings.json):
```json
{
  "key": "WELD_STEP",
  "requiredAttributes": [
    { "attribute": "certifications", "operator": "contains", "value": "ASME-TIG" }
  ]
}
```

**Product-level** (in products.json):
```json
{
  "key": "P-7075-FRAME",
  "requiredAttributes": [
    { "attribute": "materials", "operator": "contains", "value": "aluminum" },
    { "attribute": "tonnage", "operator": "gte", "value": 200 }
  ]
}
```

**Tenant-level** (in appSettings.json or a new `attribute-requirements.json`):
```json
{
  "defaultRequirements": {
    "Surgeon": [
      { "attribute": "boardCertified", "operator": "equals", "value": "true" }
    ]
  }
}
```

### 7b. Merge logic in the hydrator

During task hydration, after building the preference list for each `CTPTaskResource`:

```typescript
// Pseudocode for hydrator merge — adapt to your hydrator's structure

function mergeRequirements(
  taskResource: CTPTaskResource,
  taskConfig: any,           // the task's config entry
  processConfig: any | null, // the process step config (if task is part of a process)
  productConfig: any | null, // the product config (if task has outputProductKey)
  tenantDefaults: any,       // tenant-level defaults by resource type
): void {
  const merged: IAttributeRequirement[] = [];

  // 1. Task-level requirements (highest specificity)
  if (taskConfig.requiredAttributes) {
    merged.push(...taskConfig.requiredAttributes);
  }

  // 2. Process-level requirements
  if (processConfig?.requiredAttributes) {
    for (const req of processConfig.requiredAttributes) {
      // Only add if not already covered by a task-level requirement on the same attribute
      if (!merged.some(m => m.attribute === req.attribute)) {
        merged.push(req);
      }
    }
  }

  // 3. Product-level requirements
  if (productConfig?.requiredAttributes) {
    for (const req of productConfig.requiredAttributes) {
      if (!merged.some(m => m.attribute === req.attribute)) {
        merged.push(req);
      }
    }
  }

  // 4. Tenant defaults (by resource type or slot label)
  const slotType = taskResource.resource; // e.g., "Surgeon", "CNC"
  const defaults = tenantDefaults?.[slotType];
  if (defaults) {
    for (const req of defaults) {
      if (!merged.some(m => m.attribute === req.attribute)) {
        merged.push(req);
      }
    }
  }

  taskResource.requiredAttributes = merged;
}
```

**Merge rule:** Higher-specificity sources (task > process > product > tenant) take precedence. If the same attribute appears at multiple levels, the most specific one wins. All unique attributes are AND-merged. This is a simple, predictable rule that can be explained to users: "Your task requires ASME-TIG (from the welding step definition) AND tonnage >= 200 (from the product spec)."

---

## Part 8: Include in Solve Response

### 8a. Add rejections to task response

In `ctp_service.ts extractResults()`, include attribute rejections:

```typescript
const taskResult: any = {
  // ... existing fields ...

  // Attribute rejections (per resource slot)
  attributeRejections: task.capacityResources?.flatMap(tr =>
    tr.attributeRejections.map(rej => ({
      slotIndex: tr.index,
      resourceKey: rej.resourceKey,
      resourceName: rej.resourceName,
      attribute: rej.requirement.attribute,
      operator: rej.requirement.operator,
      requiredValue: rej.requirement.value,
      actualValue: rej.actualValue,
      reason: rej.reason,
    }))
  ).filter(r => r) || [],
};
```

### 8b. Feed into InfeasibilityReport

When a task is infeasible and has attribute rejections, the bottleneck display should show them. In the `buildInfeasibilityReport` method (from Sprint 17), check for attribute rejections:

```typescript
// In ResourceAvailabilityDetail, add:
export interface ResourceAvailabilityDetail {
  // ... existing fields ...
  
  /** If this resource was rejected by attribute matching (not by availability) */
  attributeRejected?: boolean;
  attributeRejectionReason?: string;
}

// When building the report, if a resource was attribute-rejected,
// it won't appear in the preference list at all. To show it in the report,
// reconstruct from the rejection log:

for (const rejection of taskResource.attributeRejections) {
  resourceDetails.push({
    resourceKey: rejection.resourceKey,
    resourceName: rejection.resourceName,
    availableMinutes: 0,
    totalWindowMinutes: 0,
    status: 'blocked',
    blockingTasks: [],
    note: null,
    attributeRejected: true,
    attributeRejectionReason: rejection.reason,
  });
}
```

This means the bottleneck panel will show:
```
🔴 Surgeon
   Dr. Smith: 4h available                            ← qualified, checked availability
   Dr. Jones: blocked 07:00-12:00 by CASE-002         ← qualified, checked availability
   Dr. Lee: not board-certified for orthopedics        ← attribute-rejected, never checked availability
```

---

## Part 9: Resource Attributes in Config

### 9a. Resource config format

Resources carry attributes in their config. The hydrator already reads some custom fields — extend to a standard `attributes` array:

```json
// Surgeons
{
  "key": "DR-SMITH",
  "name": "Dr. Smith",
  "type": "SURGEON",
  "class": "REUSABLE",
  "attributes": [
    { "name": "specialty", "value": "orthopedics,sports-medicine" },
    { "name": "boardCertified", "value": "true" }
  ]
}
{
  "key": "DR-JONES",
  "name": "Dr. Jones",
  "type": "SURGEON",
  "class": "REUSABLE",
  "attributes": [
    { "name": "specialty", "value": "orthopedics,general" },
    { "name": "boardCertified", "value": "true" }
  ]
}
{
  "key": "DR-LEE",
  "name": "Dr. Lee",
  "type": "SURGEON",
  "class": "REUSABLE",
  "attributes": [
    { "name": "specialty", "value": "general,podiatry" },
    { "name": "boardCertified", "value": "true" }
  ]
}

// Anesthesiologists
{
  "key": "AN-JONES",
  "name": "Jones, CRNA",
  "type": "ANESTHESIOLOGIST",
  "class": "REUSABLE",
  "attributes": [
    { "name": "certifications", "value": "CRNA,pediatric-anesthesia" },
    { "name": "level", "value": "senior" }
  ]
}
{
  "key": "AN-GARCIA",
  "name": "Garcia, CRNA",
  "type": "ANESTHESIOLOGIST",
  "class": "REUSABLE",
  "attributes": [
    { "name": "certifications", "value": "CRNA" },
    { "name": "level", "value": "junior" }
  ]
}

// Operating Rooms
{
  "key": "OR-01",
  "name": "Operating Room 1",
  "type": "OR",
  "class": "REUSABLE",
  "attributes": [
    { "name": "roomClass", "value": "major" },
    { "name": "equipment", "value": "arthroscopy,fluoroscopy,general" }
  ]
}
{
  "key": "OR-02",
  "name": "Operating Room 2",
  "type": "OR",
  "class": "REUSABLE",
  "attributes": [
    { "name": "roomClass", "value": "minor" },
    { "name": "equipment", "value": "general" }
  ]
}
```

### 9b. Hydrator reads attributes onto CTPResource

During resource hydration:

```typescript
if (resourceConfig.attributes) {
  for (const attr of resourceConfig.attributes) {
    resource.attributes.add(new CTPAttribute(attr.name, String(attr.value)));
  }
}
```

`CTPResource` already inherits `attributes: CTPAttributes` from `CTPKeyEntity`. The infrastructure is there — just needs the hydrator to populate it from config.

---

## Part 10: Prove on Acme Outpatient Healthcare

Healthcare is the ideal proof case — multi-resource chains (surgeon + anesthesiologist + OR + nurse + recovery bay) with natural attribute requirements (specialties, certifications, equipment).

### 10a. Add attributes to Acme resources

See Part 9a above — add `attributes` arrays to all surgeon, anesthesiologist, and OR resources.

### 10b. Add requirements to Acme cases

**Orthopedic cases** (e.g., CASE-001 Knee Replacement) — surgeon slot requires orthopedics specialty, OR slot requires arthroscopy equipment:

```json
// On the Surgeon resource slot for orthopedic PROC tasks:
"requiredAttributes": [
  { "attribute": "specialty", "operator": "contains", "value": "orthopedics" }
]

// On the OR resource slot for arthroscopic procedures:
"requiredAttributes": [
  { "attribute": "equipment", "operator": "contains", "value": "arthroscopy" }
]
```

**Pediatric cases** — anesthesiologist slot requires pediatric-anesthesia certification:

```json
// On the Anesthesiologist resource slot for pediatric PROC tasks:
"requiredAttributes": [
  { "attribute": "certifications", "operator": "contains", "value": "pediatric-anesthesia" }
]
```

**General/minor cases** — no attribute requirements (all resources qualify, as today).

### 10c. Expected results

After attribute filtering:

| Case | Surgeon slot | Before filter | After filter | Rejected |
|------|-------------|---------------|--------------|----------|
| CASE-001 (Knee, ortho) | Surgeon | Dr. Smith, Dr. Jones, Dr. Lee | Dr. Smith, Dr. Jones | Dr. Lee: specialty is "general,podiatry" (required: contains "orthopedics") |
| CASE-001 (Knee, ortho) | OR | OR-01, OR-02 | OR-01 | OR-02: equipment is "general" (required: contains "arthroscopy") |
| CASE-007 (Pediatric) | Anesthesiologist | AN-JONES, AN-GARCIA | AN-JONES | AN-GARCIA: certifications is "CRNA" (required: contains "pediatric-anesthesia") |
| CASE-010 (General) | Surgeon | Dr. Smith, Dr. Jones, Dr. Lee | Dr. Smith, Dr. Jones, Dr. Lee | (none) |

### 10d. Verify

- [ ] Orthopedic cases only consider surgeons with orthopedics specialty
- [ ] Dr. Lee is pruned from ortho cases with clear rejection reason
- [ ] OR-02 is pruned from arthroscopic cases with clear rejection reason
- [ ] Pediatric cases only consider AN-JONES for anesthesiologist
- [ ] AN-GARCIA is pruned from pediatric cases with clear rejection reason
- [ ] General cases are unaffected — all resources remain as candidates
- [ ] Solve response includes rejections per task in `attributeRejections`
- [ ] If CASE-001 is infeasible, bottleneck report shows:
  ```
  🟡 Surgeon
     Dr. Smith: 4h available
     Dr. Jones: blocked 07:00-12:00 by CASE-002
     Dr. Lee: not qualified — specialty is "general,podiatry" (required: contains "orthopedics")
  🔴 Operating Room
     OR-01: blocked 07:00-10:30 by CASE-002, CASE-003
     OR-02: not qualified — equipment is "general" (required: contains "arthroscopy")
  ```
- [ ] AI chat can explain: "OR-02 was excluded because it doesn't have arthroscopy equipment. Only OR-01 is qualified, and it's blocked until 10:30."
- [ ] Combo count is reduced (fewer resources per slot → fewer cross-product combos → faster solve)

---

## Part 11: Verification Checklist

### Attribute Matcher
- [ ] `equals` — case-insensitive string match
- [ ] `not_equals` — case-insensitive string non-match
- [ ] `contains` — checks comma-separated list AND substring
- [ ] `gte` — numeric greater-than-or-equal
- [ ] `lte` — numeric less-than-or-equal
- [ ] `in` — resource value is one of the provided options
- [ ] Missing attribute on resource → rejection (except `not_equals` which passes)
- [ ] Non-numeric value with `gte`/`lte` → rejection (NaN check)
- [ ] Empty requirements list → all preferences pass through

### AND/OR Logic
- [ ] All AND requirements → all must pass for resource to qualify
- [ ] Mixed AND/OR → OR creates groups, any group passing qualifies the resource
- [ ] Single requirement → treated as one AND group
- [ ] v1 configs all use AND (OR infrastructure tested but not configured)

### Pipeline Integration
- [ ] Attribute filter runs after overrides, before constraint propagation
- [ ] Filter runs on every solve (preferences reset from config each time)
- [ ] Filter skips pinned tasks and excluded tasks
- [ ] Filter skips IGNORED resource slots
- [ ] Rejections stored on `CTPTaskResource.attributeRejections`
- [ ] Rejections included in solve response per task
- [ ] Stats track total rejections (`stats.attributeRejectionsTotal`)

### Merge Logic
- [ ] Task-level requirements take precedence over process/product/tenant
- [ ] Same attribute at multiple levels → most specific wins
- [ ] Different attributes across levels → all merged (AND)
- [ ] No requirements at any level → no filtering

### Bottleneck Display Integration
- [ ] Attribute-rejected resources appear in InfeasibilityReport with `attributeRejected: true`
- [ ] Rejection reason shown in bottleneck panel
- [ ] Attribute-rejected resources are distinguishable from availability-blocked resources

### Acme Healthcare Proof
- [ ] Orthopedic cases only consider surgeons with orthopedics specialty
- [ ] Dr. Lee rejected from ortho cases with correct reason
- [ ] OR-02 rejected from arthroscopic cases with correct reason
- [ ] Pediatric cases only consider AN-JONES for anesthesiologist
- [ ] General cases unaffected — all resources remain
- [ ] Bottleneck report shows attribute-rejected resources alongside availability-blocked
- [ ] AI can explain rejection reasons
- [ ] Combo count reduced → solve same speed or faster

### No Regression
- [ ] All existing tenants solve identically (no requirements configured = no filtering)
- [ ] Preference modes (EXCLUDED/REQUIRED) still work correctly after attribute filtering
- [ ] Combination engine receives smaller input → solve should be same speed or faster
- [ ] WhereTo results respect attribute requirements (rejected resources don't appear as options)

---

*Build order: Parts 1-3 (interfaces + matcher), Part 5 (filter method), Part 6 (pipeline integration), Part 9 (config format + hydration), Part 10 (Acme Healthcare proof), Part 4+7 (merge from multiple sources — can be simplified for v1 to task-level only), Part 8 (bottleneck integration). Test at each step.*
