# Batch 5 — WhereTo: Interactive Rescheduling

The killer feature. A planner asks "where can this task go?" and sees all feasible options as ghost bars on the Gantt. They pick one, the task moves there. No re-solve needed.

**Prerequisites:** Batches 1-3 complete. Solve endpoint, task actions (pin/exclude/unschedule), Gantt context menu all working.

Stop any running dev servers on ports 3000 and 3001 before starting. Restart both after all changes are complete.

---

## Part 1: ScheduleEvaluator — Extract Read-Only Logic

The existing solver builds contexts, scores them, and assigns. WhereTo needs steps 1-3 (build, score, return) without step 4 (assign). Extract the evaluation logic into a shared class that both the solver and WhereTo call.

### The evaluator:

```typescript
export interface WhereToOption {
  rank: number;
  resources: { resourceKey: string; resourceName: string; isPrimary: boolean }[];
  startTime: number;          // earliest start (absolute seconds from base)
  endTime: number;            // earliest end
  latestStart: number;        // latest start
  latestEnd: number;          // latest end
  duration: number;           // task duration in this context
  score: number;              // blended score
  scoreBreakdown: Record<string, number>;  // per-rule scores
  changeover: {
    from: string;
    to: string;
    duration: number;
    penalty: number;
  } | null;
  impact: {
    tightensWindow: string[];  // task keys whose windows get tighter
  };
  contextHash: string;        // unique identifier for this option (used by move-to)
}

export interface WhereToResult {
  taskKey: string;
  taskName: string;
  currentAssignment: {
    resources: string[];
    start: number;
    end: number;
  } | null;
  options: WhereToOption[];
  stats: {
    contextsEvaluated: number;
    feasibleCount: number;
    infeasibleCount: number;
    timeMs: number;
  };
}

export class ScheduleEvaluator {

  /**
   * Build all feasible resource combinations for a task.
   * Same logic the solver uses to generate ScheduleContexts.
   * Does NOT mutate the landscape.
   */
  public buildContexts(
    task: CTPTask,
    landscape: SchedulingLandscape
  ): ScheduleContext[] {
    // Use existing context building logic from the solver.
    // This generates all combinations of capacity resources
    // that match the task's resource requirements.
    //
    // Respects resource modes:
    //   ON (Required) → must be available or context fails
    //   TRACK (Monitored) → included, shortage is warning not blocker
    //   OFF (Ignored) → skip this resource
    //
    // Returns array of ScheduleContext, each with a resource slot set.
    // Implementation: extract/refactor from existing solver code.
    return [];
  }

  /**
   * Compute start times for a single context.
   * Calls computeDurationForward/Backward on the available ranges.
   * Does NOT mutate profiles or assign anything.
   */
  public computeStartTimes(
    context: ScheduleContext,
    landscape: SchedulingLandscape
  ): CTPStartTimes | null {
    // Use existing start time computation logic.
    // For each resource in the context:
    //   1. Get the available profile (from AvailableMatrix)
    //   2. Find ranges that fit the task window
    //   3. Compute earliest/latest start using CTPRange
    //
    // Returns CTPStartTimes (linked list of feasible start time windows)
    // or null if no feasible times exist.
    return null;
  }

  /**
   * Score a context using the scoring configuration.
   * Returns blended score and per-rule breakdown.
   * Does NOT mutate anything.
   */
  public scoreContext(
    context: ScheduleContext,
    startTimes: CTPStartTimes,
    landscape: SchedulingLandscape,
    scoring: CTPScoring
  ): { blendedScore: number; breakdown: Record<string, number> } {
    // Apply each scoring rule to the context.
    // Each rule computes a raw score, multiplied by its weight.
    // Sum all weighted scores for blended score.
    return { blendedScore: 0, breakdown: {} };
  }

  /**
   * Check for changeover requirements between the task's process
   * and whatever process last ran on the primary resource.
   * Returns changeover info or null.
   */
  public checkChangeover(
    task: CTPTask,
    context: ScheduleContext,
    landscape: SchedulingLandscape
  ): { from: string; to: string; duration: number; penalty: number } | null {
    // Look up state changes for the primary resource type.
    // Find the last process that ran on this resource before the start time.
    // Check if a changeover is needed (different process).
    // Return duration and penalty if so.
    return null;
  }

  /**
   * The main WhereTo method.
   * Builds all contexts, computes start times, scores, ranks.
   * Returns ranked feasible options. NO MUTATION.
   */
  public whereTo(
    task: CTPTask,
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
    constraints?: {
      onlyResources?: string[];
      startAfter?: number;
      startBefore?: number;
      maxResults?: number;
    }
  ): WhereToResult {
    const startMs = Date.now();

    const result: WhereToResult = {
      taskKey: task.key,
      taskName: task.name,
      currentAssignment: null,
      options: [],
      stats: { contextsEvaluated: 0, feasibleCount: 0, infeasibleCount: 0, timeMs: 0 },
    };

    // Capture current assignment if scheduled
    if (task.scheduled && task.capacityResources) {
      result.currentAssignment = {
        resources: task.capacityResources
          .filter(r => r.scheduledResource)
          .map(r => r.scheduledResource!),
        start: task.scheduled.startW,
        end: task.scheduled.endW,
      };
    }

    // 1. Build all contexts
    let contexts = this.buildContexts(task, landscape);
    result.stats.contextsEvaluated = contexts.length;

    // 2. Apply constraints filter
    if (constraints?.onlyResources) {
      contexts = contexts.filter(ctx => {
        const resourceKeys = this.getResourceKeys(ctx);
        return constraints.onlyResources!.some(r => resourceKeys.includes(r));
      });
    }

    // 3. For each context, compute start times and score
    const feasible: { context: ScheduleContext; startTimes: CTPStartTimes;
      score: number; breakdown: Record<string, number>;
      changeover: any }[] = [];

    for (const ctx of contexts) {
      const startTimes = this.computeStartTimes(ctx, landscape);

      if (!startTimes || !startTimes.atleastOne()) {
        result.stats.infeasibleCount++;
        continue;
      }

      // Apply time constraints
      if (constraints?.startAfter !== undefined) {
        const first = startTimes.head;
        if (first && first.data.eStartW < constraints.startAfter) {
          startTimes.truncate(constraints.startAfter, true);
        }
        if (!startTimes.atleastOne()) {
          result.stats.infeasibleCount++;
          continue;
        }
      }

      if (constraints?.startBefore !== undefined) {
        const last = startTimes.tail;
        if (last && last.data.lStartW > constraints.startBefore) {
          startTimes.truncate(constraints.startBefore, false);
        }
        if (!startTimes.atleastOne()) {
          result.stats.infeasibleCount++;
          continue;
        }
      }

      result.stats.feasibleCount++;

      const { blendedScore, breakdown } = this.scoreContext(ctx, startTimes, landscape, scoring);
      const changeover = this.checkChangeover(task, ctx, landscape);

      feasible.push({ context: ctx, startTimes, score: blendedScore, breakdown, changeover });
    }

    // 4. Sort by score (lower is better for minimize objectives)
    feasible.sort((a, b) => a.score - b.score);

    // 5. Limit results
    const maxResults = constraints?.maxResults || 10;
    const limited = feasible.slice(0, maxResults);

    // 6. Build options
    result.options = limited.map((f, i) => {
      const firstStart = f.startTimes.head!.data;
      const resourceKeys = this.getResourceKeys(f.context);

      return {
        rank: i + 1,
        resources: this.getResourceDetails(f.context),
        startTime: firstStart.eStartW,
        endTime: firstStart.eEndW,
        latestStart: firstStart.lStartW,
        latestEnd: firstStart.lEndW,
        duration: firstStart.duration,
        score: f.score,
        scoreBreakdown: f.breakdown,
        changeover: f.changeover,
        impact: { tightensWindow: [] },  // TODO: compute affected tasks
        contextHash: f.context.hashKey,
      };
    });

    result.stats.timeMs = Date.now() - startMs;
    return result;
  }

  private getResourceKeys(ctx: ScheduleContext): string[] {
    const keys: string[] = [];
    ctx.slot.resources?.forEach(r => {
      if (r.resource) keys.push(r.resource.key);
    });
    return keys;
  }

  private getResourceDetails(ctx: ScheduleContext): { resourceKey: string; resourceName: string; isPrimary: boolean }[] {
    const details: { resourceKey: string; resourceName: string; isPrimary: boolean }[] = [];
    ctx.slot.resources?.forEach((r, i) => {
      if (r.resource) {
        details.push({
          resourceKey: r.resource.key,
          resourceName: r.resource.name,
          isPrimary: i === 0,
        });
      }
    });
    return details;
  }
}
```

### Refactor the solver to use the evaluator:

The existing solver should call `evaluator.buildContexts()` and `evaluator.computeStartTimes()` instead of duplicating that logic. The solver adds the assignment step on top:

```typescript
// In solver (simplified):
const evaluator = new ScheduleEvaluator();

for (const task of sortedTasks) {
  if (!task.canSolve()) continue;

  // Steps 1-3: same as WhereTo
  const contexts = evaluator.buildContexts(task, landscape);
  const feasible = [];

  for (const ctx of contexts) {
    const startTimes = evaluator.computeStartTimes(ctx, landscape);
    if (startTimes?.atleastOne()) {
      const { blendedScore } = evaluator.scoreContext(ctx, startTimes, landscape, scoring);
      feasible.push({ context: ctx, startTimes, score: blendedScore });
    }
  }

  feasible.sort((a, b) => a.score - b.score);

  // Step 4: ONLY the solver does this — WhereTo never reaches here
  if (feasible.length > 0) {
    this.assignTask(task, feasible[0], landscape);
  }
}
```

---

## Part 2: Backend API Endpoints

### POST /v1/ctp/tasks/:taskKey/where-to

Find all feasible options for a task. Read-only — does not change anything.

```typescript
// Request:
{
  "detailLevel": "intermediate",    // optional, controls response detail
  "constraints": {                   // optional, all fields optional
    "onlyResources": ["CNC-01", "CNC-02"],
    "startAfter": "2025-02-17T08:00:00",
    "startBefore": "2025-02-21T17:00:00",
    "maxResults": 10
  }
}

// Response:
{
  "taskKey": "OP-007",
  "taskName": "Machine Housing - Op 30",
  "currentAssignment": {
    "resources": ["CNC-01"],
    "start": "2025-02-18T08:00:00",
    "end": "2025-02-18T12:30:00"
  },
  "options": [
    {
      "rank": 1,
      "resources": [
        { "resourceKey": "CNC-02", "resourceName": "CNC Mill 02", "isPrimary": true }
      ],
      "start": "2025-02-17T13:00:00",
      "end": "2025-02-17T17:30:00",
      "latestStart": "2025-02-18T08:00:00",
      "latestEnd": "2025-02-18T12:30:00",
      "duration": 16200,
      "score": 12.4,
      "scoreBreakdown": {
        "EarliestStartTime": 5.2,
        "ResourceUtilization": 4.1,
        "Flexibility": 3.1
      },
      "changeover": {
        "from": "Product-A",
        "to": "Product-B",
        "duration": 1800,
        "penalty": 0.5
      },
      "impact": {
        "tightensWindow": ["OP-008"]
      },
      "contextHash": "OP-007:CNC-02"
    },
    {
      "rank": 2,
      "resources": [
        { "resourceKey": "CNC-01", "resourceName": "CNC Mill 01", "isPrimary": true }
      ],
      "start": "2025-02-18T14:00:00",
      "end": "2025-02-18T18:30:00",
      "latestStart": "2025-02-19T08:00:00",
      "latestEnd": "2025-02-19T12:30:00",
      "duration": 16200,
      "score": 18.7,
      "scoreBreakdown": {
        "EarliestStartTime": 8.5,
        "ResourceUtilization": 6.1,
        "Flexibility": 4.1
      },
      "changeover": null,
      "impact": {
        "tightensWindow": []
      },
      "contextHash": "OP-007:CNC-01"
    }
  ],
  "stats": {
    "contextsEvaluated": 8,
    "feasibleCount": 5,
    "infeasibleCount": 3,
    "timeMs": 45
  }
}
```

### POST /v1/ctp/tasks/:taskKey/move-to

Commit a WhereTo selection. This DOES mutate — it assigns the task to the chosen option.

```typescript
// Request:
{
  "contextHash": "OP-007:CNC-02",
  "startTime": "2025-02-17T13:00:00"
}

// Response:
{
  "taskKey": "OP-007",
  "success": true,
  "assignment": {
    "resources": ["CNC-02"],
    "start": "2025-02-17T13:00:00",
    "end": "2025-02-17T17:30:00"
  },
  "changeover": {
    "from": "Product-A",
    "to": "Product-B",
    "duration": 1800
  },
  "affectedTasks": ["OP-008"],
  "requiresResolve": true
}
```

**Move-to execution order:**
1. Validate the contextHash and startTime are still feasible (availability may have changed)
2. If task is currently scheduled, unschedule it (free the old capacity)
3. Assign to the new position (consume capacity on the new resource)
4. Update changeover state on the resource
5. Mark affected tasks for recompute
6. Return the result with `requiresResolve: true` if other tasks are impacted

If the position is no longer feasible (someone else took it between where-to and move-to):
```typescript
// Response:
{
  "taskKey": "OP-007",
  "success": false,
  "reason": "Position no longer available — CNC-02 has been assigned to OP-015 since your query",
  "suggestRefresh": true
}
```

---

## Part 3: Backend Controller and Service

```typescript
// In the CTP controller:

@Post('tasks/:taskKey/where-to')
async whereTo(
  @Param('taskKey') taskKey: string,
  @Body() request: WhereToRequest,
  @Req() req: Request,
): Promise<WhereToResult> {
  const tenantId = req['tenantId'];
  return this.ctpService.whereTo(tenantId, taskKey, request);
}

@Post('tasks/:taskKey/move-to')
async moveTo(
  @Param('taskKey') taskKey: string,
  @Body() request: MoveToRequest,
  @Req() req: Request,
): Promise<MoveToResult> {
  const tenantId = req['tenantId'];
  return this.ctpService.moveTo(tenantId, taskKey, request);
}
```

```typescript
// In the CTP service:

export class CtpService {
  private evaluator = new ScheduleEvaluator();

  async whereTo(tenantId: string, taskKey: string, request: WhereToRequest): Promise<WhereToResult> {
    const landscape = await this.getLandscape(tenantId);
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) throw new NotFoundException(`Task ${taskKey} not found`);

    const scoring = this.getScoringConfig(landscape);

    // Convert date constraints to seconds
    const constraints = request.constraints ? {
      onlyResources: request.constraints.onlyResources,
      startAfter: request.constraints.startAfter
        ? CTPDateTime.fromDateTime(CTPDateTime.fromString(request.constraints.startAfter))
        : undefined,
      startBefore: request.constraints.startBefore
        ? CTPDateTime.fromDateTime(CTPDateTime.fromString(request.constraints.startBefore))
        : undefined,
      maxResults: request.constraints.maxResults,
    } : undefined;

    // Call evaluator — read-only, no mutation
    const result = this.evaluator.whereTo(task, landscape, scoring, constraints);

    // Convert times to ISO strings for the response
    return this.formatWhereToResponse(result);
  }

  async moveTo(tenantId: string, taskKey: string, request: MoveToRequest): Promise<MoveToResult> {
    const landscape = await this.getLandscape(tenantId);
    const task = landscape.tasks?.getEntity(taskKey);
    if (!task) throw new NotFoundException(`Task ${taskKey} not found`);

    // Validate the chosen option is still feasible
    const scoring = this.getScoringConfig(landscape);
    const freshResult = this.evaluator.whereTo(task, landscape, scoring);
    const chosenOption = freshResult.options.find(o => o.contextHash === request.contextHash);

    if (!chosenOption) {
      return {
        taskKey,
        success: false,
        reason: 'Position no longer available — resource state has changed since your query',
        suggestRefresh: true,
      };
    }

    // Unschedule from current position if scheduled
    if (task.scheduled) {
      landscape.unscheduleTask(task);
    }

    // Assign to chosen position
    // This mutates the landscape: consumes availability, updates assignments
    const startW = CTPDateTime.fromDateTime(CTPDateTime.fromString(request.startTime));
    this.assignTaskToOption(task, chosenOption, startW, landscape);

    // Find affected tasks
    const affected = this.findAffectedTasks(task, landscape);

    return {
      taskKey,
      success: true,
      assignment: {
        resources: chosenOption.resources.map(r => r.resourceKey),
        start: request.startTime,
        end: CTPDateTime.toDateTime(chosenOption.endTime).toISO(),
      },
      changeover: chosenOption.changeover,
      affectedTasks: affected.map(t => t.key),
      requiresResolve: affected.length > 0,
    };
  }
}
```

---

## Part 4: Frontend State

```typescript
// WhereTo state:
const [whereToTaskKey, setWhereToTaskKey] = useState<string | null>(null);
const [whereToOptions, setWhereToOptions] = useState<WhereToOption[]>([]);
const [whereToLoading, setWhereToLoading] = useState(false);
const [whereToCurrentAssignment, setWhereToCurrentAssignment] = useState<any>(null);

// WhereTo handler — called from Gantt context menu or task detail panel:
const handleWhereTo = useCallback(async (taskKey: string) => {
  setWhereToTaskKey(taskKey);
  setWhereToLoading(true);
  setWhereToOptions([]);

  try {
    const result = await api(`/ctp/tasks/${taskKey}/where-to`, {
      method: 'POST',
      body: JSON.stringify({
        detailLevel: experienceLevel,
        constraints: { maxResults: 10 },
      }),
    });

    setWhereToOptions(result.options || []);
    setWhereToCurrentAssignment(result.currentAssignment);
  } catch (err) {
    console.error('WhereTo failed:', err);
    setWhereToOptions([]);
  } finally {
    setWhereToLoading(false);
  }
}, [experienceLevel]);

// Move-to handler — called when user clicks a ghost bar:
const handleMoveTo = useCallback(async (taskKey: string, option: WhereToOption) => {
  try {
    const result = await api(`/ctp/tasks/${taskKey}/move-to`, {
      method: 'POST',
      body: JSON.stringify({
        contextHash: option.contextHash,
        startTime: option.start,  // ISO string
      }),
    });

    if (result.success) {
      // Clear WhereTo mode
      setWhereToTaskKey(null);
      setWhereToOptions([]);
      setWhereToCurrentAssignment(null);

      // Mark stale — affected tasks may need re-solve
      if (result.requiresResolve) {
        setSolveStale(true);
      }

      // Refresh task data (or optimistically update the moved task)
      // Option A: re-fetch state
      // Option B: update the task in solveResult locally
    } else {
      // Position no longer available
      alert(result.reason || 'Position no longer available. Refreshing options...');
      // Re-query WhereTo to get fresh options
      handleWhereTo(taskKey);
    }
  } catch (err) {
    console.error('MoveTo failed:', err);
  }
}, []);

// Cancel WhereTo:
const cancelWhereTo = useCallback(() => {
  setWhereToTaskKey(null);
  setWhereToOptions([]);
  setWhereToCurrentAssignment(null);
}, []);

// Escape key to cancel:
useEffect(() => {
  if (!whereToTaskKey) return;
  const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelWhereTo(); };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [whereToTaskKey]);
```

---

## Part 5: Gantt Context Menu — Add "Where Can This Go?"

Add the WhereTo option to the existing Gantt context menu:

```typescript
// In the context menu items array, add after "View Details":
{ icon: '🔍', label: 'View Details', onClick: onViewDetails },
{ icon: '🗺️', label: 'Where Can This Go?', onClick: () => onWhereTo(task.key),
  disabled: isLocked || isExcluded },
null, // separator
{ icon: '✕', label: 'Unschedule', onClick: onUnschedule, disabled: isPinned || isLocked },
// ... rest of existing items
```

Pass `onWhereTo={handleWhereTo}` to the GanttContextMenu component.

Also add "Where Can This Go?" button to the task detail panel actions section:

```typescript
// In TaskActions (task detail panel):
<IconBtn icon="🗺️" label="Where Can This Go?" onClick={() => handleWhereTo(task.key)}
  disabled={isLocked || isExcluded} />
```

---

## Part 6: Gantt Ghost Bars — WhereTo Overlay

When WhereTo is active, render semi-transparent "ghost" bars on the Gantt showing each option.

### Ghost bar rendering:

```typescript
// Inside the Gantt component, after rendering real task bars:
{whereToTaskKey && whereToOptions.length > 0 && (
  <>
    {/* Dim the rest of the Gantt slightly */}
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.3)',
      pointerEvents: 'none', zIndex: 5,
    }} />

    {/* Render ghost bars for each option */}
    {whereToOptions.map((option, i) => {
      // For each resource in the option, render a ghost bar on that resource's row
      const primaryResource = option.resources.find(r => r.isPrimary) || option.resources[0];
      const resourceRowY = getResourceRowY(primaryResource.resourceKey); // your existing row position function
      if (resourceRowY === null) return null;

      const startX = timeToX(option.startTime);   // your existing time-to-pixel function
      const endX = timeToX(option.endTime);
      const width = endX - startX;
      const latestStartX = timeToX(option.latestStart);

      // Color by rank: #1 green, #2-3 blue, rest grey
      const ghostColor = option.rank === 1 ? C.green
        : option.rank <= 3 ? C.accent
        : C.textDim;

      return (
        <div key={option.contextHash} style={{ position: 'absolute', zIndex: 10 }}>
          {/* The ghost bar — clickable */}
          <div
            onClick={() => handleMoveTo(whereToTaskKey, option)}
            style={{
              position: 'absolute',
              left: startX,
              top: resourceRowY + 2,
              width: Math.max(width, 20),
              height: ROW_HEIGHT - 4,
              background: `${ghostColor}30`,
              border: `2px dashed ${ghostColor}`,
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.15s',
              zIndex: 10,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = `${ghostColor}50`;
              (e.currentTarget as HTMLElement).style.borderStyle = 'solid';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = `${ghostColor}30`;
              (e.currentTarget as HTMLElement).style.borderStyle = 'dashed';
            }}
          >
            {/* Rank badge */}
            <span style={{
              display: 'inline-flex', width: 20, height: 20, borderRadius: 10,
              alignItems: 'center', justifyContent: 'center',
              background: ghostColor, color: '#fff',
              fontSize: 10, fontWeight: 800,
            }}>
              {option.rank}
            </span>

            {/* Score */}
            <span style={{ fontSize: 10, fontWeight: 700, color: ghostColor }}>
              {option.score.toFixed(1)}
            </span>

            {/* Changeover indicator */}
            {option.changeover && (
              <span style={{ fontSize: 9, color: C.yellow }} title={
                `Changeover: ${option.changeover.from} → ${option.changeover.to} (${Math.round(option.changeover.duration / 60)}min)`
              }>⚙</span>
            )}
          </div>

          {/* Flexibility range — lighter bar from earliest to latest start */}
          {latestStartX > startX + width && (
            <div style={{
              position: 'absolute',
              left: startX + width,
              top: resourceRowY + ROW_HEIGHT / 2 - 1,
              width: latestStartX - (startX + width),
              height: 2,
              background: `${ghostColor}40`,
              borderRadius: 1,
              pointerEvents: 'none',
            }} />
          )}
        </div>
      );
    })}

    {/* Highlight current assignment if exists */}
    {whereToCurrentAssignment && (
      <div style={{
        position: 'absolute',
        left: timeToX(whereToCurrentAssignment.start),
        top: getResourceRowY(whereToCurrentAssignment.resources[0]) + 1,
        width: timeToX(whereToCurrentAssignment.end) - timeToX(whereToCurrentAssignment.start),
        height: ROW_HEIGHT - 2,
        border: `2px solid ${C.yellow}`,
        borderRadius: 6,
        pointerEvents: 'none',
        zIndex: 9,
      }}>
        <span style={{
          position: 'absolute', top: -10, right: 2,
          fontSize: 9, color: C.yellow, fontWeight: 700,
        }}>current</span>
      </div>
    )}
  </>
)}
```

### Loading state:

While the WhereTo API is loading, show a small indicator on the Gantt:

```typescript
{whereToTaskKey && whereToLoading && (
  <div style={{
    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
    zIndex: 20, padding: '6px 16px', borderRadius: 8,
    background: C.surface, border: `1px solid ${C.accent}`,
    fontSize: 12, fontWeight: 600, color: C.accent,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  }}>
    🗺️ Finding options...
  </div>
)}
```

### No options found:

```typescript
{whereToTaskKey && !whereToLoading && whereToOptions.length === 0 && (
  <div style={{
    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
    zIndex: 20, padding: '8px 20px', borderRadius: 8,
    background: C.surface, border: `1px solid ${C.red}`,
    fontSize: 12, fontWeight: 600, color: C.red,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  }}>
    No feasible options found
    <button onClick={cancelWhereTo} style={{
      marginLeft: 12, padding: '2px 8px', borderRadius: 4,
      border: `1px solid ${C.border}`, background: 'transparent',
      color: C.textMuted, fontSize: 11, cursor: 'pointer',
    }}>Dismiss</button>
  </div>
)}
```

---

## Part 7: WhereTo Info Panel

When WhereTo is active, show a floating info panel on the Gantt with option details and a legend:

```typescript
{whereToTaskKey && whereToOptions.length > 0 && !whereToLoading && (
  <div style={{
    position: 'absolute', top: 8, right: 8, zIndex: 20,
    width: 280, maxHeight: 400, overflow: 'auto',
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: 14,
  }}>
    {/* Header */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🗺️ Where To?</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          {whereToOptions.length} options found · Click a ghost to move
        </div>
      </div>
      <button onClick={cancelWhereTo} style={{
        background: 'none', border: 'none', color: C.textMuted, fontSize: 16,
        cursor: 'pointer', padding: 4,
      }}>✕</button>
    </div>

    {/* Options list */}
    {whereToOptions.map(option => (
      <div key={option.contextHash}
        onClick={() => handleMoveTo(whereToTaskKey, option)}
        style={{
          padding: '8px 10px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
          border: `1px solid ${option.rank === 1 ? C.green : C.border}`,
          background: option.rank === 1 ? `${C.green}10` : 'transparent',
          transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = `${C.accent}15`; }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = option.rank === 1 ? `${C.green}10` : 'transparent';
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', width: 18, height: 18, borderRadius: 9,
              alignItems: 'center', justifyContent: 'center',
              background: option.rank === 1 ? C.green : option.rank <= 3 ? C.accent : C.textDim,
              color: '#fff', fontSize: 9, fontWeight: 800,
            }}>{option.rank}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
              {option.resources.map(r => r.resourceName).join(' + ')}
            </span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: option.rank === 1 ? C.green : C.textMuted }}>
            {option.score.toFixed(1)}
          </span>
        </div>

        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
          {fmtDate(option.startTime)} → {fmtDate(option.endTime)}
        </div>

        {option.changeover && (
          <div style={{ fontSize: 10, color: C.yellow, marginTop: 2 }}>
            ⚙ Changeover: {option.changeover.from} → {option.changeover.to}
            ({Math.round(option.changeover.duration / 60)}min)
          </div>
        )}

        {option.impact.tightensWindow.length > 0 && (
          <div style={{ fontSize: 10, color: C.orange, marginTop: 2 }}>
            ⚠ Affects: {option.impact.tightensWindow.join(', ')}
          </div>
        )}
      </div>
    ))}

    {/* Footer hint */}
    <div style={{ fontSize: 10, color: C.textDim, marginTop: 8, textAlign: 'center' }}>
      Press Escape to cancel
    </div>
  </div>
)}
```

---

## Part 8: Task Detail Panel — WhereTo Results

When WhereTo is active and the task detail panel is open for the same task, show the options there too:

```typescript
{whereToTaskKey === selectedTask?.key && whereToOptions.length > 0 && (
  <>
    <SectionLabel label="Available Positions" />
    <div style={{ marginBottom: 12 }}>
      {whereToOptions.slice(0, 5).map(option => (
        <div key={option.contextHash}
          onClick={() => handleMoveTo(whereToTaskKey, option)}
          style={{
            padding: '8px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
            border: `1px solid ${option.rank === 1 ? C.green : C.border}`,
            background: option.rank === 1 ? `${C.green}10` : 'transparent',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
              #{option.rank} {option.resources.map(r => r.resourceName).join(' + ')}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>
              {option.score.toFixed(1)}
            </span>
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
            {fmtDate(option.startTime)} → {fmtDate(option.endTime)}
          </div>
        </div>
      ))}
    </div>
  </>
)}
```

---

## Part 9: Unscheduled Tasks — WhereTo from Task Table

For unscheduled tasks (no Gantt bar to right-click), trigger WhereTo from the task table:

```typescript
// In TaskRowActions, add WhereTo button for unscheduled tasks:
const isUnscheduled = !task.feasible && !task.scheduledStart;

{isUnscheduled && (
  <IconBtn
    icon="🗺️"
    title="Find available positions"
    onClick={() => onWhereTo(task.key)}
  />
)}

// Also show for scheduled tasks (move to a better position):
{isScheduled && (
  <IconBtn
    icon="🗺️"
    title="Where can this go?"
    onClick={() => onWhereTo(task.key)}
  />
)}
```

When triggered from the task table, the Gantt should auto-scroll to show the ghost bars. If the Schedule tab isn't active, switch to it:

```typescript
const handleWhereTo = useCallback(async (taskKey: string) => {
  // Switch to Schedule tab to show the Gantt
  setActiveTab('schedule');

  // ... existing WhereTo logic ...
}, []);
```

---

## Testing

**API — where-to:**
1. POST /ctp/tasks/OP-007/where-to → returns options array with ranked feasible positions
2. Each option has: rank, resources, start/end times, score, scoreBreakdown, changeover, contextHash
3. Options are sorted by score (best first)
4. Stats show contextsEvaluated, feasibleCount, infeasibleCount, timeMs
5. currentAssignment shows the task's current position (if scheduled)
6. With constraints.onlyResources → only those resources in results
7. With constraints.startAfter/startBefore → only options in that window
8. For an infeasible task → returns empty options array
9. Multiple calls for same task → same results (read-only, no mutation)

**API — move-to:**
10. POST /ctp/tasks/OP-007/move-to with valid contextHash → success, task moves
11. Task's old capacity is freed, new capacity consumed
12. affectedTasks lists tasks whose windows are tightened
13. requiresResolve is true when affected tasks exist
14. With invalid/stale contextHash → success: false, reason explains why, suggestRefresh: true

**Gantt context menu:**
15. Right-click task → menu includes "🗺️ Where Can This Go?"
16. Click it → loading indicator "Finding options..."
17. Ghost bars appear on feasible resource rows
18. WhereTo disabled for locked/excluded tasks

**Ghost bars on Gantt:**
19. Ghost bars are dashed-border, semi-transparent
20. #1 option is green, #2-3 are blue/accent, rest are grey
21. Each ghost shows rank number and score
22. Hover on ghost → border becomes solid, background brightens
23. Current assignment highlighted with yellow border and "current" label
24. Flexibility range shown as thin line from earliest end to latest start
25. Changeover indicator (⚙) shown on ghosts that need changeover

**Clicking a ghost:**
26. Click ghost #1 → calls move-to API → task moves to new position
27. Ghost bars disappear, WhereTo mode ends
28. Stale indicator appears (affected tasks need re-solve)
29. If move fails (stale) → error message → WhereTo refreshes with new options

**Info panel:**
30. Floating panel in top-right shows all options in a list
31. Click an option in the panel → same as clicking the ghost bar
32. Panel shows changeover info and affected tasks per option
33. Close button and Escape both cancel WhereTo

**Task detail panel:**
34. If task detail open for the WhereTo task → "Available Positions" section shows top 5 options
35. Click an option → moves the task

**Task table integration:**
36. Unscheduled tasks show 🗺️ button in Actions column
37. Scheduled tasks also show 🗺️ button (find better position)
38. Clicking 🗺️ from task table → switches to Schedule tab → shows ghosts on Gantt
39. WhereTo loading state shows on Gantt even when triggered from task table

**Cancel:**
40. Press Escape → ghosts disappear, info panel closes, no API call
41. Click outside ghost bars → ghosts disappear (optional, Escape is primary)
42. Navigate to different tab → WhereTo mode cancelled

Commit: "feat: WhereTo interactive rescheduling — evaluator, where-to/move-to API, Gantt ghost overlay with info panel"
