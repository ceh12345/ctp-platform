# Engine Sprint: New Scoring Rules + Due Date Hydration

**Goal:** Add three new scoring rules (DueDateScoringRule, ResourceUtilizationScoringRule, ResourcePreferenceScoringRule) and implement due date hydration from orders onto tasks at solve time.

**Size:** ~2-3 hours CC work
**Depends on:** Existing ScoringFactory, ScoringEngine, ScheduleContext, CTPTask, CTPOrder, CTPResource
**Prerequisite completed:** Stafford Job Shop Rework (chainCompatible gate, Greedy bypass) — done 2026-03-14

---

## Background

The engine currently has 4 scoring rules registered in `ScoringFactory`:

1. `EarliestStartTimeScoringRule` — prefers earlier placement (MINIMIZE)
2. `LatestStartTimeScoringRule` — prefers later placement (MINIMIZE)
3. `WhiteSpaceScoringRule` — prefers slots with more flexibility (MAXIMIZE)
4. `ChangeoverScoringRule` — penalizes changeover/setup time (MINIMIZE)

These work well for flow-shop and healthcare tenants where tight coupling matters. But for **job shop** tenants (like Stafford Engineering), we need rules that care about due date adherence, resource balancing, and honoring operator/machine preferences.

The scoring engine (`ScoringEngine.computeScores()`) already handles normalization, blending, and objective direction generically. New rules just need:
- A class implementing `IScoringRule`
- A `compute(context: ScheduleContext): CTPScore` method
- Registration in `ScoringFactory`

The `ScoringEngine` normalizes all raw scores to 0-1 range using min-max across all contexts for that task, then applies the weight and objective direction. So each rule just returns a raw numeric score — the engine handles the rest.

---

## Part 1: Due Date Hydration (Option C — Solve-Time Transfer)

### Why

The due date lives on `CTPOrder` (the single source of truth). Tasks need the due date at scoring time so the `DueDateScoringRule` can compute how close a placement is to the deadline. Rather than duplicating the due date in the JSON data files or requiring the scoring rule to chase references through the landscape, we hydrate the due date onto each task once per solve, right after config sync and before the scheduling loop.

### 1a. Add fields to CTPTask

In `task.ts`, add to `CTPTask`:

```typescript
public dueDate: number = 0;        // epoch seconds, hydrated from order at solve time
public lateDueDate: number = 0;    // epoch seconds, hydrated from order at solve time
public orderPriority: number = 0;  // hydrated from order at solve time
```

Initialize all three to `0` in the constructor.

These are **not** persisted in the JSON data files. They are computed at solve time from the order.

### 1b. Add orders collection to SchedulingLandscape

In `landscape.ts`:

```typescript
import { CTPOrders } from "./order";
```

Add to `ILandscape` interface:

```typescript
orders: CTPOrders | null;
```

Add to `SchedulingLandscape` class:

```typescript
public orders: CTPOrders;
```

Initialize in constructor:

```typescript
this.orders = new CTPOrders();
```

### 1c. Add hydrateDueDates method to SchedulingLandscape

In `landscape.ts`, add this method to `SchedulingLandscape`:

```typescript
/**
 * Hydrate due dates from orders onto tasks.
 * Called once per solve after syncFromConfig() and before scheduling loop.
 *
 * IMPORTANT: The due date is an ORDER-level concept — the customer says
 * "ship by March 25th." Only the LAST task in each chain (the one with
 * no successor) gets the due date stamped. Intermediate tasks don't need
 * due date pressure — they're driven by constraint propagation which
 * tightens their windows based on successors. The DueDateScoringRule
 * returns a neutral score (0) for tasks with dueDate === 0, so
 * intermediate tasks are unaffected.
 *
 * Order priority is stamped on ALL tasks in the chain since it controls
 * solver processing order (higher priority orders get scheduled first).
 */
public hydrateDueDates(): void {
  if (!this.tasks || !this.orders) return;

  // Step 1: Find chain-terminal tasks (tasks that no other task references as prevLink).
  // A task is terminal if no other task in the landscape has it as a predecessor.
  const hasSuccessor = new Set<string>();
  this.tasks.forEach((task) => {
    if (task.linkId?.prevLink) {
      hasSuccessor.add(task.linkId.prevLink);
    }
  });

  // Step 2: Stamp due dates on terminal tasks only, priority on all.
  this.tasks.forEach((task) => {
    if (task.linkId?.name) {
      const order = this.orders.getEntity(task.linkId.name);
      if (order) {
        // Due date only on the last task in the chain (no successor)
        if (!hasSuccessor.has(task.key)) {
          task.dueDate = order.dueDate;
          task.lateDueDate = order.lateDueDate;
        }
        // Order priority on ALL tasks (controls solver processing order)
        if (task.rank === 0 && order.rank > 0) {
          task.orderPriority = order.rank;
        }
      }
    }
  });
}
```

### 1d. Wire into solve flow

In `ctp.service.ts`, in the `solve()` method, add the hydration call **after** `syncFromConfig()` loads orders into the landscape and **before** constraint propagation and the scheduling loop:

```typescript
// After syncFromConfig
this.stateService.syncFromConfig();
const landscape = this.stateService.getLandscape();

// --- ADD THIS: Hydrate due dates from orders onto tasks ---
landscape.hydrateDueDates();

// Then continue with existing override application...
if (request?.taskUnschedules) { ... }
```

### 1e. Ensure orders are loaded into landscape

The `StateService.syncFromConfig()` (or wherever the landscape is populated from config) must load orders from `configService.getOrders()` into `landscape.orders`. If this isn't happening already, add:

```typescript
const orderData = this.configService.getOrders();
for (const order of orderData) {
  landscape.orders.addEntity(order);
}
```

This should happen alongside the existing loading of tasks, resources, and state changes.

---

## Part 2: DueDateScoringRule

### File: `AI/Scoring/duedatescoringrule.ts`

```typescript
import { IScoringRule } from "./scoringrule";
import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore } from "../../Models/Entities/score";

/**
 * DueDateScoringRule — MINIMIZE
 *
 * Measures how close a task's completion time is to (or past) its due date.
 * Lower scores = better (finishes well before due date).
 * Higher scores = worse (finishes near or after due date).
 *
 * IMPORTANT: Due dates are only hydrated onto the LAST task in each chain
 * (the chain-terminal task with no successor). Intermediate tasks have
 * dueDate === 0 and receive a neutral score, meaning this rule has no
 * effect on their placement. Intermediate tasks are driven by
 * EarliestStartTimeScoringRule and constraint propagation instead.
 *
 * Score computation:
 *   completionTime = earliestStartTime + duration
 *   slack = dueDate - completionTime
 *
 *   If slack >= 0 (on time):  score = -slack  (more negative = more buffer = better)
 *   If slack < 0 (late):      score = |slack| * (1 + penaltyFactor)
 *
 * The penaltyFactor amplifies lateness. With penaltyFactor = 2.0, being 1 hour
 * late scores 3x worse than being 1 hour early scores good. This creates a
 * strong asymmetric preference: the solver will sacrifice "extra early" buffer
 * to avoid any lateness.
 *
 * If the task has no due date (dueDate === 0), score = 0 (neutral).
 * This covers both intermediate chain tasks and standalone tasks without orders.
 *
 * Objective: MINIMIZE (the ScoringEngine normalizes to 0-1, so the most
 * negative raw score maps to 0.0 = best, most positive maps to 1.0 = worst).
 */
export class DueDateScoringRule implements IScoringRule {
  public weight: number;
  public objective: number;  // 0 = MINIMIZE
  public penaltyFactor: number;

  constructor(weight: number, objective: number, penaltyFactor: number) {
    this.weight = weight;
    this.objective = objective;
    this.penaltyFactor = penaltyFactor;
  }

  public compute(context: ScheduleContext): CTPScore {
    const score = new CTPScore("DueDateScoringRule");
    const task = context.task;

    // No due date — neutral score
    if (!task.dueDate || task.dueDate === 0) {
      score.score = 0;
      return score;
    }

    // Get the earliest feasible start time from the slot's start times
    const startTimes = context.slot.startTimes;
    if (!startTimes || !startTimes.atleastOne()) {
      score.score = 0;
      return score;
    }

    // Use the earliest start time (head of the linked list)
    const earliestStart = startTimes.head!.data.eStartW;
    const duration = task.duration?.duration() ?? 0;
    const completionTime = earliestStart + duration;

    // Slack = due date - completion time
    // Positive slack = early (good), negative = late (bad)
    const slack = task.dueDate - completionTime;

    if (slack >= 0) {
      // On time: score is negative slack (more buffer = more negative = better when minimizing)
      score.score = -slack;
    } else {
      // Late: amplify the penalty
      score.score = Math.abs(slack) * (1 + this.penaltyFactor);
    }

    return score;
  }
}
```

### Recommended config for job shop tenants:

```json
{
  "ruleName": "DueDateScoringRule",
  "weight": 0.35,
  "objective": 0,
  "includeInSolve": true,
  "penaltyFactor": 2.0
}
```

The `penaltyFactor: 2.0` means lateness is penalized 3x more heavily than early buffer is rewarded. Adjust per tenant — a shop with strict contractual penalties might use 5.0+, a shop with flexible customers might use 1.0.

---

## Part 3: ResourceUtilizationScoringRule

### File: `AI/Scoring/resourceutilizationscoringrule.ts`

```typescript
import { IScoringRule } from "./scoringrule";
import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore } from "../../Models/Entities/score";

/**
 * ResourceUtilizationScoringRule — MAXIMIZE
 *
 * Encourages balanced loading across resources by preferring assignments
 * to LESS-utilized resources. This prevents piling all work onto one
 * machine while others sit idle.
 *
 * Score computation:
 *   For each resource in the proposed slot combination:
 *     - Compute current utilization = totalAssigned / totalAvailable
 *     - The resource's "headroom" = 1.0 - utilization (how much capacity remains)
 *   
 *   Score = minimum headroom across all resources in the combination
 *
 * Why minimum headroom (not average)?
 *   A combo with one resource at 95% and one at 10% is worse than
 *   two resources both at 50%. The bottleneck resource determines feasibility,
 *   so we score by the tightest resource. This pushes work away from
 *   near-capacity resources.
 *
 * Objective: MAXIMIZE (prefer combos with more headroom = less loaded resources).
 *
 * If resource availability data is missing, returns neutral score 0.5.
 */
export class ResourceUtilizationScoringRule implements IScoringRule {
  public weight: number;
  public objective: number;  // 1 = MAXIMIZE
  public penaltyFactor: number;

  constructor(weight: number, objective: number, penaltyFactor: number) {
    this.weight = weight;
    this.objective = objective;
    this.penaltyFactor = penaltyFactor;
  }

  public compute(context: ScheduleContext): CTPScore {
    const score = new CTPScore("ResourceUtilizationScoringRule");
    const resources = context.slot.resources;

    if (!resources || resources.length === 0) {
      score.score = 0.5;
      return score;
    }

    let minHeadroom = 1.0;

    resources.forEach((resSlot) => {
      const resource = resSlot.resource;
      if (!resource) return;

      // Compute utilization from the resource's availability matrix
      // staticOriginal = total calendar availability
      // staticAssignments = currently assigned work
      const original = resource.available?.staticOriginal;
      const assignments = resource.available?.staticAssignments;

      if (original && original.atleastOne()) {
        let totalAvailable = 0;
        let totalAssigned = 0;

        // Sum total available capacity across all intervals
        let ptr = original.head;
        while (ptr) {
          totalAvailable += (ptr.data.endW - ptr.data.startW) * ptr.data.qty;
          ptr = ptr.next;
        }

        // Sum total assigned capacity
        if (assignments && assignments.atleastOne()) {
          let aPtr = assignments.head;
          while (aPtr) {
            totalAssigned += (aPtr.data.endW - aPtr.data.startW) * aPtr.data.qty;
            aPtr = aPtr.next;
          }
        }

        if (totalAvailable > 0) {
          const utilization = totalAssigned / totalAvailable;
          const headroom = 1.0 - Math.min(utilization, 1.0);
          if (headroom < minHeadroom) {
            minHeadroom = headroom;
          }
        }
      }
    });

    score.score = minHeadroom;
    return score;
  }
}
```

### Recommended config for job shop tenants:

```json
{
  "ruleName": "ResourceUtilizationScoringRule",
  "weight": 0.20,
  "objective": 1,
  "includeInSolve": true,
  "penaltyFactor": 0
}
```

Objective `1` = MAXIMIZE. The ScoringEngine already handles this — it multiplies by -1 so higher headroom produces a lower (better) blended score.

---

## Part 4: ResourcePreferenceScoringRule

### File: `AI/Scoring/resourcepreferencescoringrule.ts`

```typescript
import { IScoringRule } from "./scoringrule";
import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore } from "../../Models/Entities/score";

/**
 * ResourcePreferenceScoringRule — MINIMIZE
 *
 * Rewards assigning tasks to preferred resources and penalizes
 * non-preferred assignments. Preferences are defined on each
 * task's capacityResources entries as an array of IResourcePreference
 * objects with { resourceKey, rank } where rank 1 = most preferred.
 *
 * Score computation:
 *   For each capacity resource requirement on the task:
 *     - Find which resource in the proposed slot fills this requirement
 *     - Look up that resource's rank in the preference list
 *     - If found: add (rank - 1) to score   (rank 1 = 0 penalty, rank 2 = 1, etc.)
 *     - If not in preferences but preferences exist: add maxRank + 1
 *     - If no preferences defined for this requirement: add 0 (neutral)
 *     - If preference has include=false (excluded): add maxRank * 2 (heavy penalty)
 *
 *   Final score = sum across all resource requirements
 *
 * Objective: MINIMIZE (0 = all first-choice resources, higher = less preferred).
 *
 * Use cases:
 *   - Operator preferences: "Sam is best on CNC-01, Ryan is backup"
 *   - Machine affinity: "This part fits best on the 5-axis, but the 3-axis can do it"
 *   - Department routing: "Prefer Jack's weld bay for stainless work"
 */
export class ResourcePreferenceScoringRule implements IScoringRule {
  public weight: number;
  public objective: number;  // 0 = MINIMIZE
  public penaltyFactor: number;

  constructor(weight: number, objective: number, penaltyFactor: number) {
    this.weight = weight;
    this.objective = objective;
    this.penaltyFactor = penaltyFactor;
  }

  public compute(context: ScheduleContext): CTPScore {
    const score = new CTPScore("ResourcePreferenceScoringRule");
    const task = context.task;
    const slotResources = context.slot.resources;

    if (!task.capacityResources || !slotResources || slotResources.length === 0) {
      score.score = 0;
      return score;
    }

    let totalPenalty = 0;

    // Walk each capacity resource requirement on the task
    task.capacityResources.forEach((taskRes, index) => {
      // Skip if no preferences defined for this requirement
      if (!taskRes.preferences || taskRes.preferences.length === 0) return;

      // Find the corresponding resource in the proposed slot by index
      const slotRes = slotResources.at(index);
      if (!slotRes || !slotRes.resource) return;

      const assignedKey = slotRes.resource.key;

      // Find max rank for scaling the "not in list" penalty
      let maxRank = 1;
      taskRes.preferences.forEach((pref) => {
        if (pref.rank > maxRank) maxRank = pref.rank;
      });

      // Look up the assigned resource in the preference list
      let found = false;
      taskRes.preferences.forEach((pref) => {
        if (pref.resourceKey === assignedKey) {
          found = true;
          if (!pref.include) {
            // Excluded resource — heavy penalty
            totalPenalty += maxRank * 2;
          } else {
            // Preferred resource — penalty = rank - 1 (rank 1 = 0 penalty)
            totalPenalty += (pref.rank - 1);
          }
        }
      });

      if (!found) {
        // Not in preference list at all — penalty above max rank
        totalPenalty += maxRank + 1;
      }
    });

    score.score = totalPenalty;
    return score;
  }
}
```

### Recommended config for job shop tenants:

```json
{
  "ruleName": "ResourcePreferenceScoringRule",
  "weight": 0.10,
  "objective": 0,
  "includeInSolve": true,
  "penaltyFactor": 0
}
```

Low weight — it's a tiebreaker, not a primary driver. "All else being equal, put Sam on CNC-01."

---

## Part 5: Register in ScoringFactory

In `Factories/scorefactory.ts`, add imports and cases for all three new rules:

```typescript
import { DueDateScoringRule } from "../AI/Scoring/duedatescoringrule";
import { ResourceUtilizationScoringRule } from "../AI/Scoring/resourceutilizationscoringrule";
import { ResourcePreferenceScoringRule } from "../AI/Scoring/resourcepreferencescoringrule";

// Inside the createScoringRule method, add cases:
case "DueDateScoringRule":
  return new DueDateScoringRule(weight, objective, penaltyFactor);

case "ResourceUtilizationScoringRule":
  return new ResourceUtilizationScoringRule(weight, objective, penaltyFactor);

case "ResourcePreferenceScoringRule":
  return new ResourcePreferenceScoringRule(weight, objective, penaltyFactor);
```

---

## Part 6: Updated Tenant Scoring Configs

### Job Shop (Stafford Engineering):

```json
{
  "name": "Job Shop - On Time Delivery",
  "key": "stafford-jobshop",
  "rules": [
    { "ruleName": "DueDateScoringRule", "weight": 0.35, "objective": 0, "includeInSolve": true, "penaltyFactor": 2.0 },
    { "ruleName": "ResourceUtilizationScoringRule", "weight": 0.20, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.15, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

**Weights sum to 1.00** ✓

**Rationale for job shop:**
- DueDate at 0.35 — heaviest weight because the #1 job shop question is "will we ship on time?"
- ResourceUtilization at 0.20 — spread work across machines, avoid overloading bottlenecks
- Changeover at 0.20 — batch similar materials (critical for Stafford's stainless contamination changeovers)
- EarliestStart at 0.15 — mild preference for starting sooner to build buffer
- ResourcePreference at 0.10 — tiebreaker for operator/machine affinity

### Healthcare (Acme Outpatient) — unchanged:

```json
{
  "name": "Surgery Scheduling",
  "key": "surgery-default",
  "rules": [
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.50, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "WhiteSpaceScoringRule", "weight": 0.30, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

### Demo Manufacturing (existing) — add DueDate:

```json
{
  "name": "Manufacturing Demo",
  "key": "demo-mfg",
  "rules": [
    { "ruleName": "DueDateScoringRule", "weight": 0.30, "objective": 0, "includeInSolve": true, "penaltyFactor": 1.5 },
    { "ruleName": "EarliestStartTimeScoringRule", "weight": 0.25, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ChangeoverScoringRule", "weight": 0.20, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "WhiteSpaceScoringRule", "weight": 0.15, "objective": 1, "includeInSolve": true, "penaltyFactor": 0 },
    { "ruleName": "ResourcePreferenceScoringRule", "weight": 0.10, "objective": 0, "includeInSolve": true, "penaltyFactor": 0 }
  ]
}
```

---

## Part 7: Expose Scoring Breakdown in Solve Response

Currently `ctp.service.ts` returns `task.score` (the final blended score). For the Analytics tab and for debugging, also return the per-rule breakdown.

In the solve response for each task, add:

```typescript
scoreBreakdown: task.state === CTPTaskStateConstants.SCHEDULED
  ? {
      rules: context.scores.toArray().map((s) => ({
        ruleName: s.name,
        rawScore: Math.round(s.score * 1000) / 1000,
      })),
      blendedScore: Math.round(context.blendedScore.score * 1000) / 1000,
    }
  : null,
```

This requires keeping a reference to the winning `ScheduleContext` for each scheduled task. If that's not currently accessible after scheduling, add a `winningContext: ScheduleContext | null` field to `CTPTask` that gets set when the task is scheduled.

If wiring the winning context is too invasive for now, skip this part and add it as a follow-up. The three scoring rules and due date hydration are the priority.

---

## Part 8: Scoring Overrides via Solve Request

### Why

The scoring config currently loads from `scoring.json` in the tenant's config folder. But the UI needs to let planners adjust scoring weights at runtime (in the Settings modal) without persisting changes to disk. This follows the same pattern as `orderModes`, `taskPins`, and `resourcePreferenceOverrides` — overrides ride along in the solve request body, and reset on page reload.

### 8a. Add scoringOverrides to SolveRequestDto

In the solve request DTO, add an optional `scoringOverrides` field:

```typescript
@ApiPropertyOptional({
  description: 'Override scoring rules for this solve. If present, replaces tenant scoring.json entirely. Weights must sum to 1.0.',
  type: [Object],
})
scoringOverrides?: {
  ruleName: string;
  weight: number;
  objective: number;
  includeInSolve: boolean;
  penaltyFactor: number;
}[];
```

### 8b. Use overrides in solve flow

In `ctp.service.ts`, where the scoring config is built (the `buildScoring()` method or the inline block in `solve()`), check for overrides first:

```typescript
// ─── 3. Build scoring ───
let scoringRules;

if (request?.scoringOverrides && request.scoringOverrides.length > 0) {
  // Use overrides from the solve request (UI-driven, not persisted)
  scoringRules = request.scoringOverrides;
} else {
  // Fall back to tenant config file
  const scoringConfig = this.configService.getScoring();
  if (!scoringConfig) {
    throw new HttpException('Scoring configuration not found.', HttpStatus.BAD_REQUEST);
  }
  scoringRules = scoringConfig.rules;
}

const scoring = new CTPScoring(
  request?.scoringOverrides ? 'Runtime Override' : scoringConfig.name,
  request?.scoringOverrides ? 'runtime' : scoringConfig.key,
);
for (const rule of scoringRules) {
  const config = new CTPScoringConfiguration(rule.ruleName, rule.weight, rule.objective);
  config.includeInSolve = rule.includeInSolve;
  config.penaltyFactor = rule.penaltyFactor;
  scoring.addConfig(config);
}
```

### 8c. Return active scoring config in solve response

Include the scoring config that was actually used in the solve response so the UI can display it:

```typescript
// In the solve response object:
scoring: {
  source: request?.scoringOverrides ? 'override' : 'config',
  rules: scoringRules.map(r => ({
    ruleName: r.ruleName,
    weight: r.weight,
    objective: r.objective,
    includeInSolve: r.includeInSolve,
    penaltyFactor: r.penaltyFactor,
  })),
}
```

This lets the UI pre-populate the scoring editor with the current active config on page load (from the last solve response) and show whether the config came from the tenant file or a runtime override.

### 8d. UI integration (future sprint — not in this engine sprint)

The Settings modal will have a Scoring Rules section (gated to Analyst/Engineer experience levels) with weight sliders, rule toggles, and add/remove. On Solve, the frontend includes `scoringOverrides` in the request body if the planner has made changes. The solve response's `scoring.rules` array initializes the editor on next load.

This is a UI sprint that depends on this engine work being done first. For now, just wire the API — the frontend integration comes later.

---

## Part 9: Testing Checklist

After implementation, verify:

1. **Weight validation** — Solve with the Stafford config (5 rules summing to 1.0) succeeds without "Scoring Rules must sum to 100%" error
2. **Due date hydration — terminal tasks only** — After solve, only the LAST task in each chain (no successor) should have `dueDate > 0`. Intermediate tasks should have `dueDate === 0`.
3. **Due date hydration — standalone tasks** — Tasks without a `linkId` should have `dueDate === 0` (neutral)
4. **DueDateScoringRule on terminal task** — The last task in a chain placed well before its due date should score better (lower blended) than one placed near/after the due date
5. **DueDateScoringRule on intermediate task** — Intermediate tasks (dueDate === 0) should get neutral score (0), not penalized or rewarded
6. **ResourceUtilizationScoringRule** — Given two identical time slots on different resources, the less-utilized resource should win
7. **ResourcePreferenceScoringRule** — A task with preferences should land on the rank-1 resource when it's available
8. **Backward compatibility** — Healthcare tenant (no DueDateScoringRule in config) still solves correctly
9. **No due date** — Tasks without an order reference (linkId.name empty) get neutral DueDate score (0), don't break
10. **No preferences** — Tasks without resource preferences get neutral ResourcePreference score (0), don't break
11. **penaltyFactor on DueDate** — Late terminal tasks should score significantly worse than early terminal tasks with penaltyFactor > 0
12. **Order priority on all tasks** — All tasks in a chain should have `orderPriority` set from the order, not just terminal tasks
13. **Scoring overrides** — Solve with `scoringOverrides` in request body uses the overrides instead of `scoring.json`. Response shows `scoring.source: 'override'`.
14. **Scoring fallback** — Solve without `scoringOverrides` falls back to tenant `scoring.json`. Response shows `scoring.source: 'config'`.

---

## Data Model Summary

### Fields added to CTPTask:
- `dueDate: number` (epoch seconds, hydrated at solve time from order — terminal tasks only)
- `lateDueDate: number` (epoch seconds, hydrated at solve time from order — terminal tasks only)
- `orderPriority: number` (hydrated at solve time from order — all tasks in chain)

### Fields added to SchedulingLandscape:
- `orders: CTPOrders` (populated during syncFromConfig)

### New method on SchedulingLandscape:
- `hydrateDueDates(): void` (called once per solve before scheduling loop)

### New files:
- `AI/Scoring/duedatescoringrule.ts`
- `AI/Scoring/resourceutilizationscoringrule.ts`
- `AI/Scoring/resourcepreferencescoringrule.ts`

### Modified files:
- `Models/Entities/task.ts` — 3 new fields
- `Models/Entities/landscape.ts` — orders collection + hydrateDueDates method
- `Factories/scorefactory.ts` — 3 new case statements
- `ctp.service.ts` — hydrateDueDates() call in solve flow + scoringOverrides conditional
- `dto/solve-request.dto.ts` — scoringOverrides optional field
- Tenant scoring config JSON files

### No changes to:
- `ScoringEngine` — fully generic, handles new rules automatically
- `CTPScore` — unchanged
- `CTPScoringConfiguration` — unchanged
- `ScheduleContext` — unchanged
- Task JSON data files — due date stays on orders only
