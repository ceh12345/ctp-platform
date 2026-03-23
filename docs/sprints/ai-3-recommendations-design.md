# AI Recommendation Engine — Taxonomy & Engine Prompt

## Part 1: Recommendation Action Taxonomy

Every recommendation the AI advisor can make maps to one or more **atomic commands** that the engine already supports. This taxonomy defines the action types, when each applies, and the tradeoff dimensions the AI should surface.

---

### Action Type 1: `move_resource` — Switch to an Alternative Resource

**When it applies:** Task is infeasible because its current/preferred resource has no capacity within the window, but an alternative compatible resource does.

**Engine primitives used:**
- `WhereTo` → identifies feasible resource+time combinations
- `MoveTo` → commits the chosen option

**Diagnosis trigger:** InfeasibilityReport shows bottleneck slot with `status: 'blocked'` or `'partial'` on preferred resources, but other preferences have `status: 'available'`.

**Tradeoff dimensions:**
- Score delta (blended score of new position vs. current or ideal)
- Utilization impact on source and target resource
- Changeover implications (same product? different product? cleaning time?)
- Resource preference violation (moving away from PREFERRED to AVAILABLE)
- Downstream chain impact (does this resource work for successor tasks?)

**Command template:**
```json
{
  "type": "move_to",
  "taskKey": "TASK-042",
  "contextHash": "abc123",
  "startTime": "2025-02-12T14:00:00"
}
```

---

### Action Type 2: `expand_window` — Widen the Time Window

**When it applies:** Task is infeasible within its current window, but capacity exists just outside the window boundary. Common when windows are tightened by constraint propagation.

**Engine primitives used:**
- `PATCH /ctp/tasks/:taskKey/window` — direct mutation on live landscape (new endpoint)
- `solve` with `preserveLandscape: true` + `taskKeys` to reschedule with the wider window
- (Alternative: `windowOverrides` on solve request for the reset+override path)

**Diagnosis trigger:** InfeasibilityReport shows all resources blocked within window, but resource `netAvailable` intervals exist shortly after `windowEnd` or before `windowStart`.

**Tradeoff dimensions:**
- Days of slip (how far past the original window?)
- Order due date impact (is the order still on time? late? how late?)
- Chain integrity (does widening this task's window cascade to successors via linkId?)
- Priority context (is this a rush order where slip is unacceptable?)
- Original window origin (was it customer-specified or system-calculated?)

**Command template:**
```json
[
  { "type": "set_window", "taskKey": "TASK-042", "windowStart": null, "windowEnd": "2025-02-13T17:00:00" },
  { "type": "solve_selected", "taskKeys": ["TASK-042"], "scope": "targeted" }
]
```

---

### Action Type 3: `bump_lower_priority` — Unschedule a Blocker

**When it applies:** A higher-priority task can't schedule because a lower-priority task occupies the needed capacity. The lower-priority task has enough slack or flexibility to reschedule elsewhere.

**Engine primitives used:**
- `unschedule` → removes the blocker
- `solve_selected` → re-solves both the target and the bumped task

**Diagnosis trigger:** InfeasibilityReport `blockingTasks` array contains tasks whose priority is numerically higher (lower importance) than the requesting task. The blocking task's order has remaining slack (due date minus earliest possible completion).

**Tradeoff dimensions:**
- Priority differential (how much more important is the target vs. the blocker?)
- Blocker's slack (days of buffer before its order is late)
- Blocker's alternative options (can it reschedule elsewhere? WhereTo on the blocker)
- Ripple risk (does bumping the blocker cascade to other tasks in its chain?)
- Number of tasks affected (bumping 1 task vs. 3 chained tasks)

**Command template:**
```json
[
  { "type": "unschedule", "taskKey": "TASK-018" },
  { "type": "solve", "taskKeys": ["TASK-042", "TASK-018"], "scope": "targeted", "expandChains": true }
]
```

---

### Action Type 4: `reprioritize` — Change Task/Order Priority

**When it applies:** The planner's intent is to make a task more (or less) important, affecting solve order and potentially scoring. Not about fixing a specific infeasibility — about changing the strategic weight.

**Engine primitives used:**
- `priorityOverrides` on solve request
- `solve` to re-sequence with new priorities

**Diagnosis trigger:** User explicitly asks to rush an order, or the system detects that a high-value order has tasks scheduled late while low-value work got prime slots.

**Tradeoff dimensions:**
- Which tasks get displaced by the priority change
- Order value / customer importance
- How many other tasks are affected
- Current schedule disruption (how much of the floor plan changes?)

**Command template:**
```json
[
  { "type": "set_priority", "taskKey": "TASK-042", "priority": 1 },
  { "type": "solve", "strategy": "Chain" }
]
```

---

### Action Type 5: `redirect_work` — Change Resource Preferences

**When it applies:** A resource is down, overloaded, or the planner wants to steer work to a specific machine/person. Broader than `move_resource` — applies to multiple tasks at once and changes the solver's preference landscape.

**Engine primitives used:**
- `resourcePreferenceOverrides` on solve request (REQUIRED / PREFERRED / AVAILABLE / EXCLUDED per task-resource pair)
- `solve` or `solve_selected`

**Diagnosis trigger:** Resource utilization imbalance (one resource >90%, alternative <50%), resource breakdown, or planner preference.

**Tradeoff dimensions:**
- Number of tasks affected
- Utilization rebalancing (before/after)
- Changeover implications on the target resource
- Capability match (can the alternative resource actually do this work?)
- Setup time differences between resources

**Command template:**
```json
[
  { "type": "set_resource_preference", "taskKeys": ["TASK-042", "TASK-043", "TASK-044"], "resourceKey": "CNC-01", "mode": "EXCLUDED" },
  { "type": "set_resource_preference", "taskKeys": ["TASK-042", "TASK-043", "TASK-044"], "resourceKey": "CNC-02", "mode": "PREFERRED" },
  { "type": "solve", "taskKeys": ["TASK-042", "TASK-043", "TASK-044"], "scope": "targeted" }
]
```

---

### Action Type 6: `exclude_order` — Defer Low-Priority Work

**When it applies:** Capacity is globally tight. The best way to make room for important work is to remove less important work entirely from the schedule.

**Engine primitives used:**
- `orderModes` on solve request (set order to EXCLUDE)
- `solve`

**Diagnosis trigger:** Multiple tasks infeasible, all on the same bottleneck resource. Lower-priority orders exist with flexible due dates.

**Tradeoff dimensions:**
- Which order(s) to defer and their customer impact
- Capacity freed (how many machine-hours recovered?)
- Number of tasks unscheduled
- How long the deferral lasts (next week? next month?)

**Command template:**
```json
[
  { "type": "set_order_mode", "orderKey": "WO-1006", "mode": "EXCLUDE" },
  { "type": "solve", "scope": "full" }
]
```

---

### Action Type 7: `pin_and_protect` — Lock Critical Work

**When it applies:** After resolving a conflict, the planner wants to ensure the solution sticks. Prevents future solves from moving these tasks.

**Engine primitives used:**
- `pinTask` endpoint

**Diagnosis trigger:** Not triggered by infeasibility — triggered after a successful resolution, or when the planner explicitly wants floor stability.

**Tradeoff dimensions:**
- Solver flexibility reduction (pinned tasks can't be optimized)
- Risk if conditions change (pinned task on a resource that later breaks down)

**Command template:**
```json
{ "type": "pin", "taskKey": "TASK-042", "pinned": true }
```

---

### Action Type 8: `change_strategy` — Use a Different Solver Strategy

**When it applies:** The current strategy can't find a feasible solution, but a more thorough strategy (Balanced, Thorough) might find one through backtracking or neighborhood search.

**Engine primitives used:**
- `strategy` parameter on solve request

**Diagnosis trigger:** Quick strategy produced infeasible tasks; the engine's bump/backtrack stats suggest alternatives exist but weren't explored.

**Tradeoff dimensions:**
- Solve time increase (Quick <1s → Balanced 2-5s → Thorough 10-30s)
- Solution quality improvement (more feasible tasks, better scores)
- Disruption (Thorough may rearrange more of the schedule)

**Command template:**
```json
{ "type": "solve", "strategy": "Balanced" }
```

---

### Compound Recommendations

Many real scenarios require combining actions. The AI should present these as a single recommendation with ordered steps:

| Scenario | Actions Combined |
|----------|-----------------|
| Rush order arrival | `reprioritize` + `solve` (maybe `bump_lower_priority`) |
| Machine breakdown | `redirect_work` (EXCLUDE broken) + `solve_selected` |
| Capacity crunch | `exclude_order` + `reprioritize` remaining + `solve` |
| Conflict resolution | `bump_lower_priority` + `move_resource` + `pin_and_protect` |
| Window miss | `expand_window` + `solve_selected`, or `bump_lower_priority` |

---

## Part 2: Diagnose Endpoint — Engine Prompt

### Endpoint: `POST /ctp/diagnose`

### Purpose

Given one or more tasks (typically infeasible or suboptimal), analyze the root cause and return ranked actionable recommendations that the planner (or an AI agent) can review and apply.

### Request DTO

```typescript
export class DiagnoseRequestDto {
  /** Task keys to diagnose. If empty, diagnose all infeasible tasks. */
  taskKeys?: string[];

  /** Include analysis of what would happen if each recommendation were applied */
  includeRippleAnalysis?: boolean;

  /** Max recommendations per task */
  maxRecommendations?: number;  // default: 5

  /** Filter to specific action types */
  actionTypes?: string[];  // e.g. ['move_resource', 'expand_window']

  /** Detail level controls verbosity */
  detailLevel?: 'novice' | 'intermediate' | 'expert' | 'diagnostic';
}
```

### Response DTO

```typescript
export class DiagnoseResponseDto {
  /** One entry per diagnosed task */
  diagnoses: TaskDiagnosis[];

  /** Global recommendations (e.g. strategy change, order deferral) */
  globalRecommendations?: Recommendation[];

  /** Timestamp for staleness detection */
  timestamp: string;

  /** Landscape hash — if this changes, recommendations are stale */
  landscapeHash: string;
}

export interface TaskDiagnosis {
  taskKey: string;
  taskName: string;
  orderKey: string | null;
  chainKey: string | null;
  status: 'infeasible' | 'suboptimal' | 'scheduled';

  /** Root cause classification */
  rootCause: RootCause;

  /** The infeasibility report (from Sprint 17) if available */
  infeasibilityReport?: InfeasibilityReport;

  /** Ranked recommendations, best first */
  recommendations: Recommendation[];
}

export interface RootCause {
  type:
    | 'no_capacity'            // resource fully booked in window
    | 'window_too_tight'       // window exists but too narrow after propagation
    | 'resource_excluded'      // all compatible resources excluded/down
    | 'material_shortage'      // input material insufficient
    | 'chain_conflict'         // predecessor/successor timing clash
    | 'priority_displaced'     // lower priority, bumped by higher-priority work
    | 'multi_resource_clash'   // all needed resources never align simultaneously
    | 'unknown';

  /** Human-readable summary */
  summary: string;

  /** The bottleneck resource slot (from infeasibility report) */
  bottleneckSlot?: string;

  /** Tasks blocking this one */
  blockingTasks?: BlockingTaskSummary[];
}

export interface BlockingTaskSummary {
  taskKey: string;
  taskName: string;
  orderKey: string | null;
  priority: number;
  resourceKey: string;
  start: string;
  end: string;
}

export interface Recommendation {
  /** Unique ID for this recommendation (used by apply endpoint) */
  id: string;

  /** Action taxonomy type */
  action: 'move_resource' | 'expand_window' | 'bump_lower_priority'
        | 'reprioritize' | 'redirect_work' | 'exclude_order'
        | 'pin_and_protect' | 'change_strategy';

  /** Human-readable description for the planner */
  description: string;

  /** Blended score of the resulting position (lower = better) */
  score: number;

  /** Rank within this task's recommendations (1 = best) */
  rank: number;

  /** What this recommendation prioritizes and what it trades off */
  tradeoffs: TradeoffSummary;

  /** The atomic commands to execute this recommendation */
  commands: RecommendationCommand[];

  /** Ripple analysis (if requested) */
  ripple?: RippleAnalysis;
}

export interface TradeoffSummary {
  /** What improves */
  gains: string[];
  /** What gets worse or is at risk */
  costs: string[];
  /** Numeric impact estimates */
  metrics?: {
    dueDateImpactDays?: number;       // positive = late, negative = early
    utilizationDelta?: number;         // percentage point change
    tasksDisplaced?: number;
    changeoversAdded?: number;
    feasibilityRateChange?: number;    // percentage point change
  };
}

export interface RecommendationCommand {
  type: 'move_to' | 'set_window' | 'unschedule' | 'solve'
      | 'set_priority' | 'set_resource_preference'
      | 'set_order_mode' | 'pin';

  /** Solve scope: 'targeted' = only taskKeys with protectOthers; 'full' = everything */
  scope?: 'targeted' | 'full';

  /** Auto-include chain siblings in solve (default true) */
  expandChains?: boolean;

  /** Params vary by type */
  taskKey?: string;
  taskKeys?: string[];
  contextHash?: string;
  startTime?: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  priority?: number;
  resourceKey?: string;
  mode?: string;
  orderKey?: string;
  strategy?: string;
  pinned?: boolean;
}

export interface RippleAnalysis {
  /** Tasks that would be affected */
  affectedTasks: {
    taskKey: string;
    taskName: string;
    impact: 'rescheduled' | 'displaced' | 'unscheduled' | 'window_changed';
    detail: string;
  }[];
  /** Net change to global metrics */
  netFeasibilityChange: number;
  netUtilizationChange: number;
}
```

### Service Implementation — `diagnose()`

The diagnose method orchestrates existing engine calls without mutating the landscape.

```typescript
// Pseudocode — CTPService.diagnose()

diagnose(request: DiagnoseRequestDto): DiagnoseResponseDto {
  const landscape = this.ensureLandscape();
  const scoring = this.buildScoring();
  const timestamp = DateTime.now().toISO();
  const landscapeHash = this.computeLandscapeHash(landscape);

  // 1. Identify target tasks
  let targetTasks: CTPTask[];
  if (request.taskKeys?.length) {
    targetTasks = request.taskKeys
      .map(k => landscape.tasks.getEntity(k))
      .filter(Boolean);
  } else {
    // Default: all infeasible tasks
    targetTasks = [];
    landscape.tasks.forEach(t => {
      if (t.state !== CTPTaskStateConstants.SCHEDULED && t.includeInSolve && !t.pinned) {
        targetTasks.push(t);
      }
    });
  }

  const diagnoses: TaskDiagnosis[] = [];

  for (const task of targetTasks) {
    // 2. Classify root cause
    const rootCause = this.classifyRootCause(task, landscape);

    // 3. Generate recommendations based on root cause
    const recommendations: Recommendation[] = [];
    const maxRecs = request.maxRecommendations ?? 5;
    const allowedActions = request.actionTypes ?? null;

    // 3a. Try move_resource (via WhereTo)
    if (!allowedActions || allowedActions.includes('move_resource')) {
      const whereToRecs = this.generateMoveResourceRecs(task, landscape, scoring);
      recommendations.push(...whereToRecs);
    }

    // 3b. Try expand_window
    if (!allowedActions || allowedActions.includes('expand_window')) {
      const windowRecs = this.generateExpandWindowRecs(task, landscape);
      recommendations.push(...windowRecs);
    }

    // 3c. Try bump_lower_priority
    if (!allowedActions || allowedActions.includes('bump_lower_priority')) {
      const bumpRecs = this.generateBumpRecs(task, landscape, scoring);
      recommendations.push(...bumpRecs);
    }

    // 3d. Try redirect_work (for overloaded-resource scenarios)
    if (!allowedActions || allowedActions.includes('redirect_work')) {
      const redirectRecs = this.generateRedirectRecs(task, landscape);
      recommendations.push(...redirectRecs);
    }

    // 4. Sort by score and rank
    recommendations.sort((a, b) => a.score - b.score);
    recommendations.forEach((r, i) => r.rank = i + 1);

    // 5. Optional ripple analysis
    if (request.includeRippleAnalysis) {
      for (const rec of recommendations.slice(0, maxRecs)) {
        rec.ripple = this.simulateRipple(rec, landscape, scoring);
      }
    }

    diagnoses.push({
      taskKey: task.key,
      taskName: task.name,
      orderKey: task.linkId?.name ?? null,
      chainKey: task.linkId?.name ?? null,
      status: task.state === CTPTaskStateConstants.SCHEDULED ? 'scheduled' : 'infeasible',
      rootCause,
      infeasibilityReport: task.infeasibilityReport ?? undefined,
      recommendations: recommendations.slice(0, maxRecs),
    });
  }

  // 6. Global recommendations (strategy change, order deferral)
  const globalRecs = this.generateGlobalRecs(targetTasks, landscape, scoring);

  return { diagnoses, globalRecommendations: globalRecs, timestamp, landscapeHash };
}
```

### Key Helper Methods

#### `classifyRootCause()`

```typescript
private classifyRootCause(task: CTPTask, landscape: SchedulingLandscape): RootCause {
  const report = task.infeasibilityReport;

  // Check errors for clues
  const errorReasons = task.errors.map(e => e.reason.toLowerCase());

  // Material shortage?
  if (errorReasons.some(r => r.includes('material') || r.includes('shortage'))) {
    return {
      type: 'material_shortage',
      summary: `Material shortage prevents scheduling`,
    };
  }

  // All resources excluded?
  if (report?.slots.every(s => s.resources.every(r => r.status === 'blocked'))) {
    // Check if blocked because excluded vs. genuinely full
    const hasExcluded = task.capacityResources?.some(tr => tr.mode === 'EXCLUDED');
    if (hasExcluded) {
      return {
        type: 'resource_excluded',
        summary: `All compatible resources are excluded or offline`,
        bottleneckSlot: report.bottleneckSlot ?? undefined,
      };
    }
  }

  // Use infeasibility report bottleneck
  if (report) {
    const bottleneck = report.slots.find(s => s.isBottleneck);
    const blockingTasks = bottleneck?.resources
      .flatMap(r => r.blockingTasks)
      .map(bt => ({
        taskKey: bt.taskKey,
        taskName: bt.taskName,
        orderKey: null as string | null,  // look up from landscape
        priority: landscape.tasks.getEntity(bt.taskKey)?.priority ?? 100,
        resourceKey: bottleneck!.resources[0]?.resourceKey ?? '',
        start: CTPDateTime.toDateTime(bt.startW).toISO()!,
        end: CTPDateTime.toDateTime(bt.endW).toISO()!,
      })) ?? [];

    // Check if window is the issue
    const windowDurationSec = task.window ? task.window.duration() : 0;
    const taskDurationSec = task.duration?.duration() ?? 0;
    if (windowDurationSec > 0 && windowDurationSec < taskDurationSec * 1.5) {
      return {
        type: 'window_too_tight',
        summary: `Window is ${Math.round(windowDurationSec / 3600)}h but task needs ${Math.round(taskDurationSec / 3600)}h — too tight after constraint propagation`,
        bottleneckSlot: report.bottleneckSlot ?? undefined,
        blockingTasks,
      };
    }

    return {
      type: 'no_capacity',
      summary: report.reason || `No capacity on ${report.bottleneckSlot} within window`,
      bottleneckSlot: report.bottleneckSlot ?? undefined,
      blockingTasks,
    };
  }

  return { type: 'unknown', summary: 'Unable to determine root cause' };
}
```

#### `generateMoveResourceRecs()`

Wraps the existing WhereTo engine call:

```typescript
private generateMoveResourceRecs(
  task: CTPTask,
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
): Recommendation[] {
  const evaluator = new ScheduleEvaluator();
  const result = evaluator.whereTo(task, landscape, scoring, { maxResults: 5 });

  return result.options.map((opt, i) => ({
    id: `move-${task.key}-${opt.contextHash}`,
    action: 'move_resource' as const,
    description: `Move to ${opt.resources.map(r => r.resourceName || r.resourceKey).join(' + ')} at ${DateTime.fromISO(opt.start).toFormat('LLL dd HH:mm')}`,
    score: opt.blendedScore,
    rank: i + 1,
    tradeoffs: {
      gains: [`Task becomes feasible on ${opt.resources[0]?.resourceName}`],
      costs: opt.changeover
        ? [`${opt.changeover.durationMinutes}min changeover required`]
        : [],
      metrics: {
        changeoversAdded: opt.changeover ? 1 : 0,
      },
    },
    commands: [{
      type: 'move_to' as const,
      taskKey: task.key,
      contextHash: opt.contextHash,
      startTime: opt.start,
    }],
  }));
}
```

#### `generateExpandWindowRecs()`

Scans resource availability just outside the current window:

```typescript
private generateExpandWindowRecs(
  task: CTPTask,
  landscape: SchedulingLandscape,
): Recommendation[] {
  if (!task.window) return [];

  const recs: Recommendation[] = [];
  const taskDuration = task.duration?.duration() ?? 0;

  // Look for capacity in expanding time bands: +1 day, +2 days, +1 week
  const expansions = [
    { days: 1, label: '1 day' },
    { days: 2, label: '2 days' },
    { days: 5, label: '1 week' },
  ];

  for (const exp of expansions) {
    const newEndW = task.window.endW + (exp.days * 86400);
    // Check if any compatible resource has availability in the expanded range
    const hasCapacity = this.checkCapacityInRange(
      task, landscape, task.window.endW, newEndW, taskDuration
    );

    if (hasCapacity) {
      // Check order due date impact
      const orderDueDate = this.getOrderDueDate(task, landscape);
      const newEndDate = CTPDateTime.toDateTime(newEndW);
      const slipDays = orderDueDate
        ? newEndDate.diff(DateTime.fromISO(orderDueDate), 'days').days
        : 0;

      recs.push({
        id: `window-${task.key}-${exp.days}d`,
        action: 'expand_window',
        description: `Extend window by ${exp.label} — capacity available on ${hasCapacity.resourceName}`,
        score: 50 + (exp.days * 10),  // penalize larger expansions
        rank: 0,  // will be re-ranked globally
        tradeoffs: {
          gains: ['Task becomes schedulable'],
          costs: slipDays > 0
            ? [`Order delivery slips ${Math.ceil(slipDays)} day(s)`]
            : ['No due date impact'],
          metrics: { dueDateImpactDays: Math.max(0, Math.ceil(slipDays)) },
        },
        commands: [
          { type: 'set_window', taskKey: task.key, windowEnd: newEndDate.toISO() },
          { type: 'solve_selected', taskKeys: [task.key] },
        ],
      });
      break;  // only suggest the smallest sufficient expansion
    }
  }

  return recs;
}
```

#### `generateBumpRecs()`

Identifies lower-priority blockers:

```typescript
private generateBumpRecs(
  task: CTPTask,
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
): Recommendation[] {
  const report = task.infeasibilityReport;
  if (!report) return [];

  const taskPriority = task.priority ?? 100;
  const recs: Recommendation[] = [];

  // Collect all blocking tasks from the infeasibility report
  const blockers = report.slots
    .flatMap(s => s.resources)
    .flatMap(r => r.blockingTasks)
    .filter((bt, i, arr) => arr.findIndex(x => x.taskKey === bt.taskKey) === i);  // dedupe

  for (const blocker of blockers) {
    const blockerTask = landscape.tasks.getEntity(blocker.taskKey);
    if (!blockerTask) continue;
    if (blockerTask.pinned) continue;  // can't bump pinned tasks

    const blockerPriority = blockerTask.priority ?? 100;
    if (blockerPriority <= taskPriority) continue;  // only bump lower-priority (higher number)

    // Check blocker's slack
    const blockerSlack = this.computeSlack(blockerTask, landscape);

    recs.push({
      id: `bump-${task.key}-${blocker.taskKey}`,
      action: 'bump_lower_priority',
      description: `Unschedule ${blocker.taskName} (priority ${blockerPriority}) to free capacity — ${blockerSlack.days}d slack remaining`,
      score: 30 + (blockerPriority - taskPriority),  // prefer big priority gaps
      rank: 0,
      tradeoffs: {
        gains: [`Frees capacity on ${report.bottleneckSlot}`],
        costs: [
          `${blocker.taskName} must reschedule`,
          blockerSlack.days <= 0 ? '⚠️ Blocker has no slack — may become late' : `Blocker has ${blockerSlack.days}d slack`,
        ],
        metrics: {
          tasksDisplaced: 1,
          dueDateImpactDays: blockerSlack.days <= 0 ? 1 : 0,
        },
      },
      commands: [
        { type: 'unschedule', taskKey: blocker.taskKey },
        { type: 'solve', taskKeys: [task.key, blocker.taskKey], scope: 'targeted', expandChains: true },
      ],
    });
  }

  return recs;
}
```

#### `generateGlobalRecs()`

Looks at the big picture across all infeasible tasks:

```typescript
private generateGlobalRecs(
  infeasibleTasks: CTPTask[],
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // If many infeasible tasks share the same bottleneck, suggest order deferral
  if (infeasibleTasks.length >= 3) {
    const bottleneckCounts = new Map<string, number>();
    infeasibleTasks.forEach(t => {
      const bn = t.infeasibilityReport?.bottleneckSlot;
      if (bn) bottleneckCounts.set(bn, (bottleneckCounts.get(bn) ?? 0) + 1);
    });

    const topBottleneck = [...bottleneckCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topBottleneck && topBottleneck[1] >= 3) {
      // Find lowest-priority order on this bottleneck
      const deferCandidate = this.findDeferCandidate(topBottleneck[0], landscape);
      if (deferCandidate) {
        recs.push({
          id: `global-defer-${deferCandidate.orderKey}`,
          action: 'exclude_order',
          description: `Defer order ${deferCandidate.orderName} (${deferCandidate.taskCount} tasks, priority ${deferCandidate.priority}) to free ${topBottleneck[0]} capacity`,
          score: 60,
          rank: 0,
          tradeoffs: {
            gains: [`Frees ~${deferCandidate.capacityHours}h on ${topBottleneck[0]}`],
            costs: [`Order ${deferCandidate.orderName} deferred entirely`],
            metrics: { tasksDisplaced: deferCandidate.taskCount },
          },
          commands: [
            { type: 'set_order_mode', orderKey: deferCandidate.orderKey, mode: 'EXCLUDE' },
            { type: 'solve', scope: 'full' },
          ],
        });
      }
    }
  }

  // If Quick strategy was used and there are infeasible tasks, suggest Balanced
  // (check current strategy from appSettings)
  if (infeasibleTasks.length > 0) {
    const currentStrategy = landscape.appSettings?.solverStrategy ?? 'Chain';
    if (currentStrategy === 'Chain' || currentStrategy === 'Quick') {
      recs.push({
        id: 'global-strategy-balanced',
        action: 'change_strategy',
        description: 'Re-solve with Balanced strategy — may find solutions through backtracking',
        score: 70,
        rank: 0,
        tradeoffs: {
          gains: ['May resolve infeasible tasks through backtracking'],
          costs: ['Solve time increases from <1s to 2-5s', 'Some scheduled tasks may move'],
        },
        commands: [{ type: 'solve', strategy: 'Balanced', scope: 'full' }],
      });
    }
  }

  return recs;
}
```

### Apply Endpoint: `POST /ctp/apply-recommendation`

```typescript
// Request
export class ApplyRecommendationRequestDto {
  /** The recommendation ID from diagnose response */
  recommendationId: string;

  /** The commands to execute (copied from recommendation, or modified by planner) */
  commands: RecommendationCommand[];

  /** Landscape hash — must match to prevent stale applies */
  landscapeHash: string;

  /** Detail level for the returned state */
  detailLevel?: 'novice' | 'intermediate' | 'expert' | 'diagnostic';
}

// Response
export class ApplyRecommendationResponseDto {
  success: boolean;

  /** If false due to staleness, this is true */
  stale?: boolean;

  /** If rolled back after partial failure */
  rolledBack?: boolean;

  actionsApplied: {
    type: string;
    taskKey?: string;
    result: 'ok' | 'failed' | 'skipped';
    detail?: string;
  }[];

  /** Refreshed state after all actions */
  newState?: CTPSolveResult;

  /** Tasks that moved or were affected */
  rippleEffects?: {
    taskKey: string;
    taskName: string;
    impact: 'rescheduled' | 'displaced' | 'unscheduled' | 'window_changed';
    detail: string;
    withinWindow: boolean;
  }[];

  /** Human-readable reason on failure */
  reason?: string;
}
```

The implementation is a command sequencer with rollback and state protection:

```typescript
applyRecommendation(request: ApplyRecommendationRequestDto): ApplyRecommendationResponseDto {
  const landscape = this.ensureLandscape();

  // ─── 1. Staleness check ───
  const currentHash = this.computeLandscapeHash(landscape);
  if (currentHash !== request.landscapeHash) {
    return {
      success: false,
      stale: true,
      actionsApplied: [],
      reason: 'Landscape has changed since diagnosis. Please re-diagnose.',
    };
  }

  // ─── 2. Snapshot for rollback ───
  const snapshots = this.snapshotAffectedTasks(request.commands, landscape);
  const beforeState = this.snapshotAllTaskStates(landscape);

  const actionsApplied: any[] = [];

  // ─── 3. Execute commands in order ───
  try {
    for (const cmd of request.commands) {
      switch (cmd.type) {
        case 'move_to':
          this.moveTo(cmd.taskKey!, { contextHash: cmd.contextHash!, startTime: cmd.startTime! });
          actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
          break;

        case 'unschedule': {
          const task = landscape.tasks.getEntity(cmd.taskKey!);
          // Skip setup/teardown — engine manages these automatically
          if (task?.type === CTPTaskTypeConstants.SET_UP || task?.type === CTPTaskTypeConstants.TEAR_DOWN) {
            actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'skipped',
                                  detail: 'Setup/teardown managed automatically' });
            break;
          }
          this.unscheduleTask(cmd.taskKey!, true);
          actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
          break;
        }

        case 'set_window':
          this.setTaskWindow(cmd.taskKey!, cmd.windowStart ?? undefined, cmd.windowEnd ?? undefined);
          actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
          break;

        case 'set_priority': {
          const task = landscape.tasks.getEntity(cmd.taskKey!);
          if (task) task.priority = cmd.priority!;
          actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
          break;
        }

        case 'set_resource_preference':
          for (const tk of (cmd.taskKeys || [cmd.taskKey!])) {
            this.updateResourceMode(tk, cmd.resourceKey!, cmd.mode!, 'capacity');
          }
          actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
          break;

        case 'set_order_mode':
          landscape.applyOrderModes({ [cmd.orderKey!]: cmd.mode! });
          actionsApplied.push({ type: cmd.type, taskKey: cmd.orderKey, result: 'ok' });
          break;

        case 'pin':
          this.pinTask(cmd.taskKey!, cmd.pinned ?? true);
          actionsApplied.push({ type: cmd.type, taskKey: cmd.taskKey, result: 'ok' });
          break;

        case 'solve': {
          // Expand chains if requested (default true)
          let taskKeys = cmd.taskKeys;
          if (taskKeys && (cmd.expandChains !== false)) {
            taskKeys = this.expandToChains(taskKeys, landscape);
          }

          const solveRequest: SolveRequestDto = {
            preserveLandscape: true,   // NEVER reload config during a recommendation
            strategy: cmd.strategy,
            taskKeys,
          };

          // For targeted scope, protect non-target tasks from being rearranged
          if (cmd.scope === 'targeted') {
            solveRequest.protectOthers = true;
          }

          this.solve(solveRequest);
          actionsApplied.push({ type: cmd.type, result: 'ok',
                                detail: `scope=${cmd.scope || 'full'}, tasks=${taskKeys?.length || 'all'}` });
          break;
        }
      }
    }
  } catch (err: any) {
    // ─── 4. Rollback on failure ───
    this.restoreSnapshots(snapshots, landscape);
    return {
      success: false,
      rolledBack: true,
      actionsApplied,
      reason: err.message,
    };
  }

  // ─── 5. Compute ripple effects ───
  const afterState = this.snapshotAllTaskStates(landscape);
  const rippleEffects = this.computeRipple(beforeState, afterState);

  // ─── 6. Return refreshed state ───
  const newState = this.getState(request.detailLevel ?? 'novice');

  return { success: true, actionsApplied, newState, rippleEffects };
}

// ─── Helper: expand task keys to include chain siblings ───

private expandToChains(taskKeys: string[], landscape: SchedulingLandscape): string[] {
  const expanded = new Set(taskKeys);
  for (const key of taskKeys) {
    const task = landscape.tasks.getEntity(key);
    if (!task?.linkId?.name) continue;
    const chain = landscape.processes.getEntity(task.linkId.name);
    if (chain?.tasks) {
      chain.tasks.forEach(t => expanded.add(t.key));
    }
  }
  return [...expanded];
}

// ─── Helper: snapshot affected tasks for rollback ───

private snapshotAffectedTasks(
  commands: RecommendationCommand[],
  landscape: SchedulingLandscape
): Map<string, TaskSnapshot> {
  const snapshots = new Map<string, TaskSnapshot>();
  for (const cmd of commands) {
    const keys = [cmd.taskKey, ...(cmd.taskKeys || [])].filter(Boolean) as string[];
    for (const key of keys) {
      if (snapshots.has(key)) continue;
      const task = landscape.tasks.getEntity(key);
      if (task) snapshots.set(key, this.captureTaskSnapshot(task, landscape));
    }
    // Also snapshot chain siblings
    for (const key of keys) {
      const task = landscape.tasks.getEntity(key);
      if (task?.linkId?.name) {
        const chain = landscape.processes.getEntity(task.linkId.name);
        chain?.tasks?.forEach(t => {
          if (!snapshots.has(t.key)) snapshots.set(t.key, this.captureTaskSnapshot(t, landscape));
        });
      }
    }
  }
  return snapshots;
}
```

---

## Part 3: Controller Registration

```typescript
// Add to CTPController

@Post('diagnose')
@ApiOperation({ summary: 'Diagnose infeasible/suboptimal tasks and recommend resolutions' })
@ApiBody({ type: DiagnoseRequestDto })
@ApiResponse({ status: 200, description: 'Diagnoses with ranked recommendations', type: DiagnoseResponseDto })
diagnose(@Body() body: DiagnoseRequestDto) {
  return this.ctpService.diagnose(body);
}

@Post('apply-recommendation')
@ApiOperation({ summary: 'Apply a recommendation from diagnose results' })
@ApiBody({ type: ApplyRecommendationRequestDto })
@ApiResponse({ status: 200, description: 'Recommendation applied', type: ApplyRecommendationResponseDto })
@ApiResponse({ status: 409, description: 'Landscape changed — re-diagnose required' })
applyRecommendation(@Body() body: ApplyRecommendationRequestDto) {
  return this.ctpService.applyRecommendation(body);
}
```

---

## Part 4: AI Chat Agent Integration (Sprint 9 Preview)

With `diagnose` and `apply-recommendation` as tool calls, the Sprint 9 chat agent gets these capabilities:

### Tool Definitions for the Agent

```typescript
const tools = [
  {
    name: 'diagnose_tasks',
    description: 'Analyze why tasks are infeasible and get ranked fix recommendations',
    parameters: {
      taskKeys: { type: 'array', items: { type: 'string' }, description: 'Task keys to diagnose, or empty for all infeasible' },
      includeRippleAnalysis: { type: 'boolean', default: true },
    },
  },
  {
    name: 'apply_fix',
    description: 'Apply a recommended fix. Always confirm with the planner first.',
    parameters: {
      recommendationId: { type: 'string' },
      commands: { type: 'array', description: 'The command sequence from the recommendation' },
      landscapeHash: { type: 'string' },
    },
  },
  // ... existing tools: get_state, solve, where_to, analytics ...
];
```

### Example Conversation Flow

```
Planner: "TASK-042 won't schedule, what's going on?"

Agent: [calls diagnose_tasks({ taskKeys: ['TASK-042'] })]

Agent: "TASK-042 is infeasible because CNC-01 is fully booked in its
        window (Feb 12 08:00–17:00). TASK-018 and TASK-023 are blocking
        the slot. I see three options:

        1. **Move to CNC-02** at Feb 12 14:00 (score 12.4)
           → CNC-02 goes from 68% → 81% utilization

        2. **Extend window 1 day** to Feb 13 — fits on CNC-01 at 08:00
           → Order delivery stays on time (2 days slack)

        3. **Bump TASK-018** (priority 80, WO-1006) to free the slot
           → WO-1006 has 2 days slack, should reschedule fine

        Which approach do you prefer?"

Planner: "Go with option 1, move it to CNC-02"

Agent: [calls apply_fix({ recommendationId: 'move-TASK-042-abc123', ... })]

Agent: "Done — TASK-042 is now on CNC-02 starting Feb 12 at 2:00 PM.
        No other tasks were displaced. CNC-02 utilization is now 81%."
```

---

## Part 5: Compound Recommendation Generator

### Problem

Individual generators produce single-action recommendations independently. When no single action works — `move_resource` fails because the window is too tight, `expand_window` fails because the only capacity is on a non-preferred resource — the planner gets no useful recommendation even though combining two actions would solve the problem.

### When Compounds Are Needed

| Single A fails | Single B fails | Compound works |
|---|---|---|
| Move resource: no capacity in window | Expand window: capacity on a different resource | Extend window + redirect to alternative |
| Bump blocker: blocker is high priority | Expand window: capacity just outside window | Extend window + solve (no bump needed) |
| Move resource: only option is bottleneck | Redirect work: other tasks can move off | Redirect others off bottleneck + solve target |
| Expand window: due date prevents expansion | Bump blocker: frees slot inside current window | Bump + move to freed slot (no window change) |

### Implementation

Three compound generators called after individual generators in `diagnose()`:

**Compound 1: Extend Window + Redirect Resource** — Task's window too tight for current resource. Expanding window only helps if solver also considers alternatives. Commands: `set_window` + `set_resource_preference` (exclude bottleneck) + `set_resource_preference` (prefer alternative) + `solve`.

**Compound 2: Bump Blocker + Move to Freed Slot** — Window expansion would miss due date, but bumping a lower-priority blocker frees the exact slot needed. Commands: `unschedule` blocker + `solve` both target and blocker.

**Compound 3: Redirect Others Off Bottleneck** — Target has NO alternative resources (e.g., ASME weld → only Jack), but other lower-priority tasks on the same bottleneck DO have alternatives. Redirect those to free capacity. Commands: `set_resource_preference` (exclude bottleneck for movable tasks) + `solve` all affected.

### Presentation

Compounds present identically to single recommendations — one button, one click, multiple commands in sequence. The planner doesn't need to know the difference.

### Verification

- [ ] Compound 1 generated when move_resource has no options AND window expansion helps on alternative
- [ ] Compound 2 generated when window expansion misses due date AND lower-priority blocker exists
- [ ] Compound 3 generated when target has no alternatives AND other tasks on bottleneck do
- [ ] Compounds scored alongside singles (may rank higher or lower)
- [ ] Compound action button executes full command sequence atomically
- [ ] Rollback covers all commands in compound sequence
- [ ] Not generated when a single action already works (no redundancy)

---

## Part 6: Verification Checklist

### State Management (prerequisite — see `preserve-landscape-engine-prompt.md`)
- [ ] `preserveLandscape: true` skips `syncFromConfig()` — mutations survive through solve
- [ ] `protectOthers: true` temp-pins non-target scheduled tasks during solve, cleans up after
- [ ] `expandChains: true` auto-includes chain siblings in taskKeys
- [ ] `PATCH /ctp/tasks/:taskKey/window` mutates live landscape, updates origStartW/origEndW
- [ ] `PATCH /ctp/tasks/:taskKey/priority` mutates live landscape
- [ ] TaskSnapshot capture/restore works for rollback
- [ ] Constraint propagation still runs on full landscape even with targeted solve
- [ ] Resource availability profiles reflect unschedule mutations when preserveLandscape is true
- [ ] Setup/teardown tasks are auto-managed — command sequencer skips them

### Diagnose Engine
- [ ] `diagnose()` returns correct root cause for each infeasibility type
- [ ] `move_resource` recommendations match WhereTo results
- [ ] `expand_window` finds the minimum sufficient expansion
- [ ] `expand_window` extends all chain siblings' windows (not just target)
- [ ] `bump_lower_priority` only suggests bumping lower-priority tasks
- [ ] `bump_lower_priority` skips pinned tasks
- [ ] Compound recs generated when single actions are insufficient
- [ ] Compound recs NOT generated when a single action already works
- [ ] Score ordering matches expected rank (best option = rank 1)
- [ ] `landscapeHash` staleness detection works

### Apply Endpoint
- [ ] Commands execute in specified order (order is load-bearing)
- [ ] `solve` commands use `preserveLandscape: true` — NEVER reloads config
- [ ] Targeted scope uses `protectOthers` — non-target tasks don't move
- [ ] Full scope allows solver to rearrange broadly
- [ ] Chain expansion includes all siblings when target is a chain member
- [ ] Rollback restores task state + resource assignments on mid-sequence failure
- [ ] Stale landscape returns `{ success: false, stale: true }` — no mutations applied
- [ ] Ripple effects accurately report what changed vs. before state

### UI Parity (anything AI can do, UI provides)
- [ ] "Extend Window" button in task detail → `PATCH /tasks/:key/window`
- [ ] "Solve Selected" prompts to include chain siblings when chain tasks selected
- [ ] Stale banner works with live mutation path (not just override accumulation)
- [ ] Undo/rollback available after live mutation actions

### Cross-Tenant
- [ ] Manufacturing: CNC capacity conflicts → move_resource + bump recs
- [ ] Healthcare: multi-resource clash → move_resource across OR/surgeon/anesthesiologist
- [ ] Sports: field conflicts → expand_window or redirect_work
- [ ] Pharma: changeover-heavy → recommendations account for cleaning time

### AI Agent
- [ ] Agent can call diagnose and present results conversationally
- [ ] Agent waits for planner confirmation before applying
- [ ] Agent handles stale landscape (re-diagnose prompt)
- [ ] Agent handles rollback (explains what happened, offers to re-diagnose)
- [ ] Agent explains tradeoffs in domain-appropriate language

---

## Part 6: State Management Reference

This feature depends on engine changes that enable multi-step operations against the live landscape. Full specification: `preserve-landscape-engine-prompt.md`.

### Summary of Required Engine Changes

| Change | Purpose | Used By |
|--------|---------|---------|
| `preserveLandscape` flag on `SolveRequestDto` | Skip `syncFromConfig()` — solve against live mutations | Apply endpoint, UI live-mutation path |
| `protectOthers` flag on `SolveRequestDto` | Temp-pin non-target tasks during targeted solve | Apply endpoint (targeted scope), UI Solve Selected |
| `expandChains` flag on `SolveRequestDto` | Auto-include chain siblings in taskKeys | Apply endpoint (default true), UI Solve Selected |
| `PATCH /ctp/tasks/:taskKey/window` | Direct window mutation on live landscape | Apply endpoint, UI task detail panel |
| `PATCH /ctp/tasks/:taskKey/priority` | Direct priority mutation on live landscape | Apply endpoint, UI inline priority edit |
| `TaskSnapshot` + rollback utilities | Capture/restore task+resource state for rollback | Apply endpoint, future UI undo |

### Implementation Order

1. `preserveLandscape` + `protectOthers` on solve — unlocks everything else
2. `PATCH /tasks/:key/window` endpoint — needed by both UI and AI
3. Chain expansion in solve — `expandChains` flag
4. `TaskSnapshot` + rollback — safety net for compound operations
5. `POST /ctp/diagnose` — the intelligence layer (done)
6. `POST /ctp/apply-recommendation` — the command sequencer (done)
7. Compound recommendation generator — combinable pairs (next)
8. AI chat `diagnose_tasks` tool + action buttons (done)
9. Token optimization — UI executes, AI only diagnoses (done)
10. UI recommendation panel — display and apply (future sprint)

Steps 1-4 benefit the UI immediately. A planner can use live mutations + solve selected today.

---

*Depends on: Sprint 17 (Bottleneck Display), Batch 5 (WhereTo/MoveTo), Sprint 4 (Resource Preferences), Sprint 5 (Reprioritize), **preserve-landscape engine changes***
*Estimated effort: ~2-3 hours state management, ~4-6 hours diagnose engine, ~2 hours apply+controller, ~2 hours AI agent wiring*
