# Cost Scoring Model — Design Document

**Status:** Designed, build later
**What it does:** Adds five cost-based scoring rules to the blended PTR framework. Each rule computes a dollar-denominated cost for a candidate resource+time placement. Costs are normalized and blended alongside existing rules (DueDate, Utilization, Changeover, EarliestStart, WhiteSpace, ResourcePreference). The planner sees cost as a first-class dimension in the scoring breakdown — "this option costs $450, that option costs $180."

**Depends on:** Existing scoring framework (done), tenant scoring configs (done), Settings Panel scoring editor (done)

---

## Design Principle

Cost rules produce **dollar values**, not abstract scores. The ScoringEngine normalizes them to 0-1 range for blending (same as every other rule), but the raw score is preserved in the `IScore.cost` field — which already exists on the interface but isn't populated today. This means:

- The blended score works as before: normalized, weighted, multi-objective
- The solve response can report both the blended score AND the total dollar cost per task
- The Analytics tab can show total schedule cost, cost by resource, cost by order
- The AI can say "this option saves $270 vs. the alternative"

---

## Rule 1: ResourceCostScoringRule

### What it computes

The hourly operating cost of running this task on this resource for this duration.

```
rawCost = resource.hourlyRate × (task.duration / 3600)
```

### Config data

On each resource (in `resources.json`):

```json
{
  "key": "5AXIS-DMG",
  "name": "DMG Mori DMU 50 5-Axis Mill",
  "hourlyRate": 150.00,
  "currency": "NZD"
}

{
  "key": "MANUAL-MILL",
  "name": "Manual Mill (Bridgeport)",
  "hourlyRate": 40.00,
  "currency": "NZD"
}

{
  "key": "FAB-JACK",
  "name": "Jack P. (Senior Fabricator)",
  "hourlyRate": 85.00,
  "currency": "NZD"
}

{
  "key": "FAB-LUKE",
  "name": "Luke M. (Fabricator)",
  "hourlyRate": 55.00,
  "currency": "NZD"
}
```

### Hydration

During resource hydration, read `hourlyRate` from config onto the `CTPResource` object. Add the field:

```typescript
// On CTPResource:
public hourlyRate: number = 0;
public currency: string = 'USD';
```

### Scoring rule implementation

```typescript
class ResourceCostScoringRule implements IScoringRule {
  name = 'ResourceCostScoringRule';
  weight: number;
  objective = CTPScoreObjectiveConstants.MINIMIZE;
  penaltyFactor: number;

  compute(schedule: ScheduleContext): IScore {
    let totalCost = 0;
    
    // Sum hourly cost across all assigned resources
    schedule.slot.resources?.forEach(resSlot => {
      if (resSlot.resource) {
        const rate = resSlot.resource.hourlyRate ?? 0;
        const durationHrs = schedule.task.duration 
          ? schedule.task.duration.duration() / 3600 
          : 0;
        totalCost += rate * durationHrs;
      }
    });

    const score = new CTPScore(this.name);
    score.score = totalCost;   // raw dollar amount — normalized later by ScoringEngine
    score.cost = totalCost;    // preserve dollar value in the cost field
    return score;
  }
}
```

### What it enables

"Should this 2-hour milling job go on the 5-Axis ($300) or the Manual Mill ($80)?" The solver weighs the $220 saving against other objectives — if the 5-Axis delivers 2 days earlier and meets the due date while the Manual Mill would be late, the solver pays the premium. If both meet the due date, it picks the cheaper option.

### Cross-tenant examples

| Tenant | Expensive | Cheap | Decision |
|--------|-----------|-------|----------|
| Stafford | 5-Axis Mill $150/hr | Manual Mill $40/hr | Use Manual for simple parts, reserve 5-Axis for complex |
| Stafford | Jack P. $85/hr | Luke M. $55/hr | Route standard TIG to Luke, ASME stays on Jack |
| Healthcare | OR-01 (large) $500/hr | OR-02 (minor) $200/hr | Minor procedures use OR-02 |
| Pharma | ISO 5 Cleanroom $200/hr | ISO 7 Cleanroom $80/hr | Non-critical batches use ISO 7 |

---

## Rule 2: ChangeoverCostScoringRule

### What it computes

The dollar cost of the changeover/setup required when switching from one product to another on a resource. This is separate from the existing `ChangeoverScoringRule` which only considers changeover *time*.

```
rawCost = changeover.cost   (from state change config)
```

If no changeover is needed (same product as previous task), cost is 0.

### Config data

Extend the state change configuration to include cost:

```json
{
  "type": "PROCESS CHANGE",
  "from": "STAINLESS",
  "to": "CARBON-STEEL",
  "duration": 2700,
  "cost": 300.00,
  "description": "Decontamination changeover"
}

{
  "type": "PROCESS CHANGE",
  "from": "PRODUCT-A",
  "to": "PRODUCT-B",
  "duration": 1800,
  "cost": 150.00
}

{
  "type": "PROCESS CHANGE",
  "from": "ANTIBIOTIC",
  "to": "NON-ANTIBIOTIC",
  "duration": 14400,
  "cost": 8000.00,
  "description": "Full cleanroom decontamination"
}
```

### Hydration

Add `cost: number` to the `CTPStateChange` entity. The hydrator reads it from config. Default 0 if not specified.

### Scoring rule implementation

```typescript
class ChangeoverCostScoringRule implements IScoringRule {
  name = 'ChangeoverCostScoringRule';
  weight: number;
  objective = CTPScoreObjectiveConstants.MINIMIZE;
  penaltyFactor: number;

  compute(schedule: ScheduleContext): IScore {
    let totalCost = 0;

    // Check each start time segment for changeover state
    if (schedule.slot.hasStartTimes()) {
      schedule.slot.startTimes?.toArray().forEach(st => {
        if (st.states) {
          for (const state of st.states) {
            totalCost += state.cost ?? 0;
          }
        }
      });
    }

    const score = new CTPScore(this.name);
    score.score = totalCost;
    score.cost = totalCost;
    return score;
  }
}
```

### What it enables

"Batching similar products reduces changeover costs." The solver groups stainless steel jobs together on the same resource to avoid $300 decontamination changeovers. In pharma, it avoids the $8,000 post-antibiotic clean by sequencing batches intelligently.

The existing `ChangeoverScoringRule` already minimizes changeover *time*. Adding `ChangeoverCostScoringRule` lets tenants weight time and cost independently — a pharma tenant might care more about the $8,000 cost than the 4-hour duration, while a job shop might care more about the time because their changeovers are cheap but slow.

---

## Rule 3: OvertimeCostScoringRule

### What it computes

The additional cost of scheduling work during premium-rate time windows (overtime, weekends, holidays).

```
rawCost = Σ (overlapHours × resource.hourlyRate × (premiumMultiplier - 1.0))
```

Only the *premium* is counted — standard-rate hours contribute 0 to this rule (they're already counted by ResourceCostScoringRule).

### Config data

Extend resource calendar/shift definitions with rate multipliers:

```json
{
  "key": "5AXIS-DMG",
  "shifts": [
    { "name": "Standard", "start": "07:00", "end": "17:00", "days": ["Mon","Tue","Wed","Thu","Fri"], "rateMultiplier": 1.0 },
    { "name": "Overtime", "start": "17:00", "end": "22:00", "days": ["Mon","Tue","Wed","Thu","Fri"], "rateMultiplier": 1.5 },
    { "name": "Weekend", "start": "07:00", "end": "17:00", "days": ["Sat"], "rateMultiplier": 2.0 }
  ]
}
```

### Scoring rule implementation

```typescript
class OvertimeCostScoringRule implements IScoringRule {
  name = 'OvertimeCostScoringRule';
  weight: number;
  objective = CTPScoreObjectiveConstants.MINIMIZE;
  penaltyFactor: number;

  compute(schedule: ScheduleContext): IScore {
    let premiumCost = 0;

    schedule.slot.resources?.forEach(resSlot => {
      if (!resSlot.resource) return;
      const rate = resSlot.resource.hourlyRate ?? 0;

      // For each start time, compute overlap with premium windows
      schedule.slot.startTimes?.toArray().forEach(st => {
        const taskStart = st.eStartW;
        const taskEnd = taskStart + (schedule.task.duration?.duration() ?? 0);

        // Check resource's premium windows
        const premiumWindows = resSlot.resource.premiumWindows ?? [];
        for (const pw of premiumWindows) {
          const overlapStart = Math.max(taskStart, pw.startW);
          const overlapEnd = Math.min(taskEnd, pw.endW);
          if (overlapEnd > overlapStart) {
            const overlapHrs = (overlapEnd - overlapStart) / 3600;
            premiumCost += overlapHrs * rate * (pw.multiplier - 1.0);
          }
        }
      });
    });

    const score = new CTPScore(this.name);
    score.score = premiumCost;
    score.cost = premiumCost;
    return score;
  }
}
```

### What it enables

"Should we run this job during overtime to meet the due date?" The solver now has a dollar answer: "Overtime costs an extra $225. Missing the due date costs $5,000/day. Use overtime." Or conversely: "This low-priority job can wait until Monday — overtime would cost $180 for no delivery benefit."

### Implementation note

Premium windows need to be pre-computed during hydration and stored on the resource (similar to how availability intervals are built from shift definitions). The scoring rule just checks overlap — it doesn't parse shift definitions at solve time.

---

## Rule 4: LatenessCostScoringRule

### What it computes

The dollar penalty for delivering past the due date. Unlike the existing `DueDateScoringRule` which uses an abstract penalty factor, this rule produces actual contractual or estimated costs.

```
If task is chain-terminal AND scheduledEnd > order.dueDate:
  daysLate = ceil((scheduledEnd - order.dueDate) / 86400)
  rawCost = daysLate × order.latenessPenaltyPerDay
Else:
  rawCost = 0
```

### Config data

On orders (in `orders.json`):

```json
{
  "key": "PV-001",
  "name": "Fonterra 2000L Mix Tank",
  "dueDate": "2026-03-23T12:00:00Z",
  "latenessPenaltyPerDay": 5000.00,
  "currency": "NZD"
}

{
  "key": "MC-003",
  "name": "Local - Bearing Housings",
  "dueDate": "2026-03-28T12:00:00Z",
  "latenessPenaltyPerDay": 0,
  "note": "Internal job, no contractual penalty"
}
```

### Hydration

Add `latenessPenaltyPerDay: number` to the order config. The hydrator propagates this to chain-terminal tasks (same pattern as due date hydration).

### Scoring rule implementation

```typescript
class LatenessCostScoringRule implements IScoringRule {
  name = 'LatenessCostScoringRule';
  weight: number;
  objective = CTPScoreObjectiveConstants.MINIMIZE;
  penaltyFactor: number;

  compute(schedule: ScheduleContext): IScore {
    let lateCost = 0;

    // Only applies to chain-terminal tasks with a due date
    const task = schedule.task;
    if (task.dueDate && schedule.slot.hasStartTimes()) {
      const dueDateW = CTPDateTime.fromDateTime(task.dueDate);
      const penaltyPerDay = task.latenessPenaltyPerDay ?? 0;

      schedule.slot.startTimes?.toArray().forEach(st => {
        const taskEnd = st.eStartW + (task.duration?.duration() ?? 0);
        if (taskEnd > dueDateW && penaltyPerDay > 0) {
          const daysLate = Math.ceil((taskEnd - dueDateW) / 86400);
          lateCost = Math.max(lateCost, daysLate * penaltyPerDay);
        }
      });
    }

    const score = new CTPScore(this.name);
    score.score = lateCost;
    score.cost = lateCost;
    return score;
  }
}
```

### What it enables

"PV-001 is worth $5,000/day if late. MC-003 has no penalty. Use the 5-Axis for PV-001 even though it's more expensive per hour." The solver makes economically rational tradeoffs between resource cost and delivery penalties.

### Relationship to existing DueDateScoringRule

`DueDateScoringRule` uses an abstract penaltyFactor (e.g., 2.0 means lateness is penalized 3x more than earliness). `LatenessCostScoringRule` uses actual dollar amounts. They can coexist — DueDate handles the general "prefer on-time" behavior, while LatenessCost adds economic precision for orders with contractual penalties. Tenants with no penalty data can use DueDate alone; tenants with penalty data can add LatenessCost and reduce DueDate's weight.

---

## Rule 5: MaterialCostScoringRule

### What it computes

The cost of raw materials consumed by this task, including waste from scrap rates. Different resources may have different scrap rates — a newer machine may waste less material.

```
For each input material on the task:
  grossQty = requiredQty / (1 - effectiveScrapRate)
  materialCost = grossQty × material.unitCost

rawCost = Σ materialCost across all inputs
```

### Config data

On materials/products (in `products.json` or `materials.json`):

```json
{
  "key": "MAT-SS316",
  "name": "Stainless Steel 316L Sheet",
  "unitCost": 45.00,
  "unitOfMeasure": "kg",
  "currency": "NZD"
}

{
  "key": "MAT-WELD-ROD",
  "name": "ER316L TIG Welding Rod",
  "unitCost": 12.50,
  "unitOfMeasure": "kg",
  "currency": "NZD"
}
```

Scrap rates can vary by resource (a newer machine wastes less). This is already modeled on `CTPTaskMaterialInput.scrapRate`. A per-resource scrap rate override could be added:

```json
{
  "key": "5AXIS-DMG",
  "materialScrapRates": {
    "MAT-SS316": 0.03
  }
}

{
  "key": "MANUAL-MILL",
  "materialScrapRates": {
    "MAT-SS316": 0.08
  }
}
```

### Scoring rule implementation

```typescript
class MaterialCostScoringRule implements IScoringRule {
  name = 'MaterialCostScoringRule';
  weight: number;
  objective = CTPScoreObjectiveConstants.MINIMIZE;
  penaltyFactor: number;

  compute(schedule: ScheduleContext): IScore {
    let totalCost = 0;
    const task = schedule.task;

    if (task.inputMaterials) {
      task.inputMaterials.forEach(input => {
        const material = schedule.landscape.materials?.getEntity(input.productKey);
        if (!material) return;
        
        const unitCost = material.unitCost ?? 0;
        
        // Check for resource-specific scrap rate override
        let scrapRate = input.scrapRate;
        const primaryResource = schedule.slot.resources?.toArray().find(r => r.isPrimary);
        if (primaryResource?.resource?.materialScrapRates) {
          const override = primaryResource.resource.materialScrapRates[input.productKey];
          if (override !== undefined) scrapRate = override;
        }

        const grossQty = scrapRate < 1.0 
          ? input.requiredQty / (1.0 - scrapRate) 
          : input.requiredQty;
        totalCost += grossQty * unitCost;
      });
    }

    const score = new CTPScore(this.name);
    score.score = totalCost;
    score.cost = totalCost;
    return score;
  }
}
```

### What it enables

"The Manual Mill has an 8% scrap rate on stainless sheet vs. 3% on the 5-Axis. On a $2,000 material order, that's $100 of extra waste." The solver considers total cost (machine time + material waste) rather than just machine cost alone. The cheaper machine might waste enough material to make it more expensive overall.

---

## Scoring Configuration Examples

### Stafford Engineering (cost-aware)

```json
{
  "name": "Job Shop - Cost Optimized",
  "key": "stafford-cost",
  "rules": [
    { "ruleName": "DueDateScoringRule",          "weight": 0.25, "objective": 0, "includeInSolve": true, "penaltyFactor": 2.0, "group": "Schedule Quality" },
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0,  "group": "Schedule Quality" },
    { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.05, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" },
    { "ruleName": "ResourceUtilizationScoringRule","weight": 0.10, "objective": 1, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" },
    { "ruleName": "ChangeoverCostScoringRule",    "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0,  "group": "Resource Efficiency" },
    { "ruleName": "ResourceCostScoringRule",      "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0,  "group": "Cost" },
    { "ruleName": "LatenessCostScoringRule",      "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0,  "group": "Cost" }
  ]
}
```

**Settings Panel renders as:**
```
── Schedule Quality (40%) ─────────────────
  DueDate              25%   ■■■■■■■■■■░░░░  MINIMIZE  penalty 2.0
  EarliestStart        10%   ■■■■░░░░░░░░░░  MINIMIZE
  Preference            5%   ■■░░░░░░░░░░░░  MINIMIZE

── Resource Efficiency (25%) ──────────────
  Utilization          10%   ■■■■░░░░░░░░░░  MAXIMIZE
  Changeover Cost      15%   ■■■■■■░░░░░░░░  MINIMIZE

── Cost (35%) ─────────────────────────────
  Resource Cost        20%   ■■■■■■■■░░░░░░  MINIMIZE
  Lateness Penalty     15%   ■■■■■■░░░░░░░░  MINIMIZE
```

### Summit Pharma (changeover cost dominant)

```json
{
  "name": "Pharma - Minimize Changeover Cost",
  "key": "summit-cost",
  "rules": [
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.25, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Schedule Quality" },
    { "ruleName": "WhiteSpaceScoringRule",        "weight": 0.15, "objective": 1, "includeInSolve": true, "penaltyFactor": 0, "group": "Resource Efficiency" },
    { "ruleName": "ChangeoverCostScoringRule",    "weight": 0.30, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Cost" },
    { "ruleName": "ResourceCostScoringRule",      "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Cost" },
    { "ruleName": "MaterialCostScoringRule",      "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0, "group": "Cost" }
  ]
}
```

---

## UI: Grouped Scoring Editor

### Config change

Add `group` to `IScoringConfigurationDTO`:

```typescript
export interface IScoringConfigurationDTO {
  ruleName: string;
  weight: number;
  objective: number;
  includeInSolve: boolean;
  penaltyFactor: number;
  group?: string;   // NEW — "Schedule Quality", "Resource Efficiency", "Cost"
}
```

The engine ignores this field entirely — it's purely for the Settings Panel display.

### Frontend rendering

In the Settings Panel scoring editor, group rules by the `group` field and render section headers with a subtotal:

```typescript
// Group rules by group name, preserving order
const groups = new Map<string, IScoringConfigurationDTO[]>();
for (const rule of scoringConfig.rules) {
  const g = rule.group || 'Other';
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g)!.push(rule);
}

// Render
{[...groups.entries()].map(([groupName, rules]) => {
  const groupWeight = rules.reduce((s, r) => s + r.weight, 0);
  return (
    <div key={groupName}>
      <div style={{
        padding: '8px 0', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 0.8,
        color: C.textDim, borderBottom: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{groupName}</span>
        <span>{Math.round(groupWeight * 100)}%</span>
      </div>
      {rules.map(rule => (
        // existing rule row rendering — slider, objective toggle, etc.
      ))}
    </div>
  );
})}
```

### Group subtotal bar

Each group header shows the summed weight as a percentage. This gives the planner an at-a-glance budget view: "40% Schedule Quality, 25% Resource Efficiency, 35% Cost." The planner can adjust individual rule weights within a group and see the group total update in real time.

### Backward compatible

Rules without a `group` field render under "Other." Existing tenant configs work unchanged — the grouping is purely additive. Tenants that don't set groups see a flat list exactly as today.

---

## Solve Response: Cost Reporting

### Per-task cost

In the solve response, each scheduled task includes a cost breakdown:

```json
{
  "key": "PV-001-MILL",
  "blendedScore": 0.34,
  "cost": {
    "total": 525.00,
    "resource": 450.00,
    "changeover": 50.00,
    "overtime": 0,
    "lateness": 0,
    "material": 25.00,
    "currency": "NZD"
  }
}
```

### Schedule-level summary

```json
{
  "costSummary": {
    "totalScheduleCost": 24750.00,
    "resourceCost": 18200.00,
    "changeoverCost": 3100.00,
    "overtimeCost": 1450.00,
    "latenessCost": 0,
    "materialCost": 2000.00,
    "currency": "NZD",
    "costByResource": [
      { "resourceKey": "5AXIS-DMG", "cost": 8500.00 },
      { "resourceKey": "FAB-JACK", "cost": 3200.00 }
    ],
    "costByOrder": [
      { "orderKey": "PV-001", "cost": 6800.00 },
      { "orderKey": "EQ-003", "cost": 2100.00 }
    ]
  }
}
```

---

## Analytics KPIs

New "Cost" group in the Analytics catalog:

| KPI | Value | Source |
|-----|-------|--------|
| Total schedule cost | $24,750 | Sum of all task costs |
| Resource cost | $18,200 | ResourceCostScoringRule totals |
| Changeover cost | $3,100 | ChangeoverCostScoringRule totals |
| Overtime premium | $1,450 | OvertimeCostScoringRule totals |
| Lateness penalties | $0 | LatenessCostScoringRule totals |
| Material waste cost | $2,000 | MaterialCostScoringRule totals |
| Cost per order | drill-down | Break down by order |
| Most expensive resource | 5-Axis Mill ($8,500) | Highest cost resource |

---

## AI Integration

The AI can reference costs in its analysis:

- "Moving TASK-007 to the Manual Mill saves $220/task but adds 3 hours to the schedule"
- "The overtime premium for meeting PV-001's due date is $450. Missing the date costs $5,000/day. Use overtime."
- "Changeover costs account for 12% of the total schedule cost. Batching the stainless jobs together would save ~$900"
- "EQ-003 on Jack ($85/hr) vs. Luke ($55/hr) — redirecting saves $90 per weld task"

---

## What Changes vs. What Doesn't

### Changes
- 5 new scoring rules added to `ScoringFactory`
- `CTPResource` gets `hourlyRate`, `currency`, `premiumWindows`, `materialScrapRates` fields
- `CTPStateChange` gets `cost` field
- Order config gets `latenessPenaltyPerDay` field
- Product/material config gets `unitCost` field
- Hydrator reads new cost fields from config
- Solve response includes `cost` breakdown per task and schedule-level summary
- Settings Panel scoring editor shows cost rules (same UI — they're just new rules)

### Doesn't change
- ScoringEngine normalization logic (unchanged — cost rules normalize the same way)
- Blending (unchanged — cost rules are weighted the same as existing rules)
- Solver dispatch/placement logic (unchanged — it just sees better scores)
- Existing scoring rules (DueDate, Utilization, etc. — coexist with cost rules)
- Tenants without cost data (no cost rules configured → no cost scoring → same behavior as today)

---

## Build Order (when ready)

1. **ResourceCostScoringRule** — simplest, most visible impact. Add `hourlyRate` to resources, build the rule, prove on Stafford.
2. **ChangeoverCostScoringRule** — add `cost` to state changes, build rule, prove on Pharma.
3. **LatenessCostScoringRule** — add `latenessPenaltyPerDay` to orders, build rule, prove on Stafford.
4. **OvertimeCostScoringRule** — add `premiumWindows` to resources, build rule, prove on Stafford.
5. **MaterialCostScoringRule** — add `unitCost` to materials, build rule, prove on Pharma.
6. **Solve response cost reporting** — aggregate per-task and schedule-level costs.
7. **Analytics cost KPIs** — new group in the catalog.

Each rule is independent — you can ship any subset. Rule 1 alone is valuable.

---

*Estimated effort: ~2 hours per rule (scoring rule + hydration + config + test), ~2 hours for response reporting + analytics. Total ~12-14 hours if all five are built.*
