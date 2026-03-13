# What-If Sprint 1: Stateless CTP Query + AI Tool + UI Panel

**What it does:** Adds a "Can I schedule this?" capability. The planner picks an existing chain as a template, the engine clones its structure, evaluates feasibility against the current schedule, and returns ranked placement options — without changing anything. Available via API endpoint, AI chat, and a UI panel.

**Size:** ~2-3 hours  
**Depends on:** Phase 3 Chain Context Engine (done), AI Sprint 2 (done)

---

## Part 1: Backend — Stateless CTP Query Endpoint

### 1a. Clone-from-chain logic

Given a source chain key, clone its task structure with new keys:

```typescript
private cloneChainFromExisting(
  sourceChainKey: string,
  newOrderName: string,
  landscape: SchedulingLandscape,
): { chain: CTPProcess; tasks: CTPTask[] } | null {
  const sourceChain = landscape.processes?.getEntity(sourceChainKey);
  if (!sourceChain?.tasks) return null;

  const newChainKey = `CTP-${Date.now()}`;
  const chain = new CTPProcess(newOrderName);
  chain.key = newChainKey;
  chain.category = sourceChain.category;
  chain.cadence = sourceChain.cadence;

  const tasks: CTPTask[] = [];
  const keyMap = new Map<string, string>();  // old key → new key

  sourceChain.tasks.forEach(sourceTask => {
    const newKey = `${newChainKey}-${sourceTask.type || sourceTask.key.split('-').pop()}`;
    keyMap.set(sourceTask.key, newKey);

    // Clone task with new key but same structure
    const task = new CTPTask();
    task.key = newKey;
    task.name = `${newOrderName} - ${sourceTask.name?.split(' - ').pop() || sourceTask.type}`;
    task.type = sourceTask.type;
    task.duration = sourceTask.duration;  // same duration
    task.priority = sourceTask.priority;
    task.process = sourceTask.process;
    task.cadence = sourceTask.cadence;

    // Clone resource requirements (same types and preferences)
    if (sourceTask.capacityResources) {
      sourceTask.capacityResources.forEach(tr => {
        const clonedTr = new CTPTaskResource(
          tr.resource, tr.isPrimary, tr.qty, tr.scheduledResource
        );
        // Copy preferences
        tr.getEffectivePreferences().forEach(pref => {
          clonedTr.addPreference(pref.resourceKey, pref.rank);
        });
        clonedTr.durationType = tr.durationType;
        task.capacityResources?.add(clonedTr);
      });
    }

    // Clone window from horizon (full planning window)
    if (landscape.horizon) {
      task.window = new CTPWindow(landscape.horizon.startW, landscape.horizon.endW);
    }

    tasks.push(task);
  });

  // Remap linkId references to new keys
  let i = 0;
  sourceChain.tasks.forEach(sourceTask => {
    const task = tasks[i];
    if (sourceTask.linkId) {
      task.linkId = {
        name: newChainKey,
        prevLink: sourceTask.linkId.prevLink
          ? keyMap.get(sourceTask.linkId.prevLink) || null
          : null,
        maxGap: sourceTask.linkId.maxGap,
      };
    }
    task.sequence = sourceTask.sequence;
    chain.tasks?.add(task);
    i++;
  });

  return { chain, tasks };
}
```

### 1b. CTP Query endpoint

Stateless — snapshot, inject, evaluate, restore. Schedule unchanged.

```typescript
@Post('ctp/query')
@ApiOperation({ summary: 'Stateless CTP query — when can this order be scheduled?' })
@ApiBody({ description: 'Source chain key + new order name' })
@ApiResponse({ status: 200, description: 'Feasible placement options' })
ctpQuery(@Body() body: CTPQueryDto) {
  return this.ctpService.ctpQuery(body);
}
```

### 1c. CTPQueryDto

```typescript
export class CTPQueryDto {
  sourceChainKey: string;     // existing chain to clone (e.g., "C001")
  orderName: string;          // "Johnson Knee Replacement"
  priority?: number;          // override priority (default: same as source)
  dueDate?: string;           // optional due date (ISO)
  preferredResources?: Record<string, string[]>;  // optional: { "Surgeon": ["DR-PATEL"] }
  maxOptions?: number;        // how many options to return (default: 3)
}
```

### 1d. CTP Query implementation

```typescript
public ctpQuery(request: CTPQueryDto): CTPQueryResponse {
  const landscape = this.stateService.getLandscape();
  if (!landscape) throw new HttpException('State not loaded.', HttpStatus.BAD_REQUEST);

  // 1. Snapshot current landscape
  const snapshot = this.stateService.snapshotLandscape();

  try {
    // 2. Clone the source chain
    const cloned = this.cloneChainFromExisting(
      request.sourceChainKey, request.orderName, landscape
    );
    if (!cloned) {
      throw new HttpException(
        `Chain ${request.sourceChainKey} not found`, HttpStatus.NOT_FOUND
      );
    }

    // 3. Apply resource preference overrides if provided
    if (request.preferredResources) {
      this.applyPreferredResources(cloned.tasks, request.preferredResources, landscape);
    }

    // 4. Apply priority override
    if (request.priority != null) {
      cloned.tasks.forEach(t => { t.priority = request.priority!; });
    }

    // 5. Inject into landscape temporarily
    cloned.tasks.forEach(task => landscape.tasks.add(task));
    landscape.processes?.add(cloned.chain);

    // 6. Build scoring
    const scoring = this.buildScoring();

    // 7. Explode contexts for the new chain's tasks
    const allContexts = this.explodeContextsForChain(cloned.chain, landscape, scoring);

    // 8. Evaluate — get ALL valid combos, not just the best
    const chainEngine = new ChainContextEngine();
    const combos = chainEngine.evaluateChainAll(
      cloned.chain, allContexts, landscape, scoring,
      request.maxOptions ?? 3
    );

    // 9. Build response
    const options: CTPQueryOption[] = combos.map((combo, rank) => ({
      rank: rank + 1,
      feasible: true,
      chainScore: combo.chainScore,
      tasks: combo.startTimes.map((st, i) => ({
        taskKey: st.taskKey,
        taskName: cloned.tasks[i].name,
        taskType: cloned.tasks[i].type,
        start: toISO(st.assignedStart),
        end: toISO(st.assignedEnd),
        resources: combo.contexts[i].slot.resources?.map(r => ({
          resourceKey: r.resource?.key,
          resourceName: r.resource?.name,
          resourceType: r.resource?.type,
        })) || [],
      })),
    }));

    return {
      orderName: request.orderName,
      sourceChainKey: request.sourceChainKey,
      feasible: options.length > 0,
      options,
      infeasibilityReport: options.length === 0
        ? chainEngine.buildInfeasibilityReport(cloned.chain, cloned.tasks, 0, 0, 0, landscape)
        : null,
    };
  } finally {
    // 10. ALWAYS restore — this was read-only
    this.stateService.restoreLandscape(snapshot);
  }
}
```

### 1e. Response shape

```typescript
export interface CTPQueryResponse {
  orderName: string;
  sourceChainKey: string;
  feasible: boolean;
  options: CTPQueryOption[];
  infeasibilityReport: InfeasibilityReport | null;
}

export interface CTPQueryOption {
  rank: number;
  feasible: boolean;
  chainScore: number;
  tasks: CTPQueryTaskPlacement[];
}

export interface CTPQueryTaskPlacement {
  taskKey: string;
  taskName: string;
  taskType: string;
  start: string;      // ISO datetime
  end: string;        // ISO datetime
  resources: {
    resourceKey: string;
    resourceName: string;
    resourceType: string;
  }[];
}
```

### 1f. evaluateChainAll — return multiple combos

Add a new method to `ChainContextEngine` that returns the top-K valid combos instead of just the winner:

```typescript
public evaluateChainAll(
  chain: CTPProcess,
  allContexts: ScheduleContexts,
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
  maxResults: number = 3,
): ChainContextCombo[] {
  // Same as evaluateChain() through Step 7
  // But instead of returning validCombos[0], return validCombos.slice(0, maxResults)
  // Sorted by: earliest chain start, then lowest score
}
```

### 1g. Snapshot/Restore on StateService

If snapshot/restore doesn't exist yet, add a simple deep-copy implementation:

```typescript
public snapshotLandscape(): any {
  // Deep copy the landscape state
  // This needs to capture: tasks (with scheduled state, window, errors),
  // resource assignments, process state
  return JSON.parse(JSON.stringify(this.landscape));
}

public restoreLandscape(snapshot: any): void {
  // Restore from deep copy
  // This is a simple but expensive approach — good enough for V1
  // V2 could use a more efficient diff-based restore
  this.landscape = this.hydrateLandscapeFromSnapshot(snapshot);
}
```

Note: `JSON.parse(JSON.stringify())` loses class methods. The restore needs to rehydrate into proper class instances. If the landscape has a serialization/deserialization path already, use that. Otherwise, the simplest V1 is to reload from config and replay the committed assignments.

**Alternative V1 snapshot:** Since the landscape is loaded from config files, the cheapest snapshot is just reloading from config (`syncFromConfig()`). The "restore" is a full reload. This works if the config files haven't changed during the session.

---

## Part 2: AI Tool — evaluate_new_order

### 2a. Tool definition

Add to the AI tool definitions alongside the existing 7 tools:

```typescript
{
  name: "evaluate_new_order",
  description: "Evaluate when a new order can be scheduled by cloning an existing chain's structure. Returns ranked placement options without changing the current schedule. Use when the user asks 'when can I schedule...', 'can I fit...', 'where can I add...'",
  parameters: {
    type: "object",
    properties: {
      sourceChainKey: {
        type: "string",
        description: "Key of an existing chain to use as template (e.g., 'C001'). If the user says 'knee replacement', find a chain of that type."
      },
      orderName: {
        type: "string",
        description: "Name for the new order (e.g., 'Johnson Knee Replacement')"
      },
      preferredDay: {
        type: "string",
        description: "Optional: preferred day (e.g., 'Monday', '2026-03-16')"
      },
      preferredSurgeon: {
        type: "string",
        description: "Optional: preferred surgeon resource key"
      }
    },
    required: ["sourceChainKey", "orderName"]
  }
}
```

### 2b. Tool implementation

```typescript
async function handleEvaluateNewOrder(params: any): Promise<string> {
  // Build preferred resources from optional params
  const preferredResources: Record<string, string[]> = {};
  if (params.preferredSurgeon) {
    preferredResources['Surgeon'] = [params.preferredSurgeon];
  }

  const response = await api('/ctp/query', {
    method: 'POST',
    body: JSON.stringify({
      sourceChainKey: params.sourceChainKey,
      orderName: params.orderName,
      preferredResources: Object.keys(preferredResources).length > 0
        ? preferredResources : undefined,
      maxOptions: 3,
    }),
  });

  if (!response.feasible) {
    return `No feasible placement found for "${params.orderName}" using ${params.sourceChainKey} structure.\n\n` +
      `Reason: ${response.infeasibilityReport?.reason || 'Unknown'}`;
  }

  let result = `Found ${response.options.length} option(s) for "${params.orderName}":\n\n`;
  for (const option of response.options) {
    result += `**Option ${option.rank}** (score: ${option.chainScore.toFixed(2)}):\n`;
    for (const task of option.tasks) {
      const resources = task.resources.map(r => r.resourceName).join(', ');
      result += `  ${task.taskName}: ${task.start} — ${task.end} [${resources}]\n`;
    }
    result += '\n';
  }

  return result;
}
```

### 2c. AI action buttons on response

When the AI presents CTP options, include action buttons to book them:

```
[action:ctpBook:{"sourceChainKey":"C001","orderName":"Johnson Knee Replacement","optionIndex":0}]Book Option 1[/action]
[action:ctpBook:{"sourceChainKey":"C001","orderName":"Johnson Knee Replacement","optionIndex":1}]Book Option 2[/action]
```

The `ctpBook` action type is new — it calls the session add-order endpoint (What-If Sprint 2) or, if no session is active, directly schedules the order with a confirmation dialog.

For V1 (before sessions exist), the Book button shows a confirmation:

```
"Book Johnson Knee Replacement — Monday 10:30 AM, OR-02, Dr. Patel?
 This will permanently add the order to the schedule.
 [Confirm] [Cancel]"
```

### 2d. System prompt update

Add to the AI system prompt:

```
When the user asks about scheduling a new order, case, or work order:
1. Identify which existing chain to use as a template. Match by procedure type, 
   category, or ask the user. Use get_chain_detail to inspect chain structures
   if needed.
2. Call evaluate_new_order with the source chain key and order name.
3. Present the ranked options with dates, times, and resources.
4. Include Book action buttons for each option.

If the user says "knee replacement" or "hip replacement", search existing chains 
for one with a matching name or category to use as the template.

If the user specifies preferences ("with Dr. Patel" or "on Monday"), pass them 
as preferredSurgeon or preferredDay.
```

### 2e. Chain lookup helper

The AI may need to find a source chain by description rather than key. Add a helper tool or guidance:

```
To find a source chain when the user says "knee replacement":
1. Call query_resources or get_chain_detail to list existing chains
2. Match on chain name or category (e.g., "Orthopedic")
3. Use the matched chain's key as sourceChainKey
```

Or add a simple chain-list endpoint:

```typescript
@Get('ctp/chain-templates')
@ApiOperation({ summary: 'List existing chains available as CTP templates' })
getChainTemplates() {
  const landscape = this.stateService.getLandscape();
  const templates: any[] = [];

  landscape.processes?.forEach(process => {
    if (!process.tasks || process.tasks.length === 0) return;

    const tasks: any[] = [];
    let totalDuration = 0;
    process.tasks.forEach(task => {
      totalDuration += task.duration?.duration() ?? 0;
      tasks.push({
        type: task.type,
        name: task.name,
        durationMinutes: Math.round((task.duration?.duration() ?? 0) / 60),
        resourceCount: task.capacityResources?.length ?? 0,
      });
    });

    templates.push({
      chainKey: process.key,
      name: process.name || process.key,
      category: process.category,
      taskCount: tasks.length,
      totalDurationMinutes: Math.round(totalDuration / 60),
      tasks,
    });
  });

  return { templates };
}
```

---

## Part 3: Frontend — CTP Query Panel

### 3a. "CTP Query" button in toolbar

Add next to the Solve button:

```tsx
<button onClick={() => setShowCTPDialog(true)} style={toolbarBtnStyle}>
  🔍 CTP Query
</button>
```

### 3b. CTP Query dialog

```
┌─────────────────────────────────────────────────────┐
│  CTP Query — When Can I Schedule This?              │
│                                                     │
│  Based on:  [C001 - Hip Replacement ▾]              │
│  Name:      [Johnson Knee Replacement          ]    │
│  Priority:  [Normal ▾]   (optional)                 │
│                                                     │
│             [Cancel]  [Evaluate]                     │
└─────────────────────────────────────────────────────┘
```

The "Based on" dropdown lists existing chains from `GET /ctp/chain-templates`. Shows chain name, task count, and total duration.

### 3c. Results panel

After clicking Evaluate, show results inline or as a slide-over:

```
┌─────────────────────────────────────────────────────────────┐
│  Johnson Knee Replacement — 3 options found                 │
│                                                             │
│  Option 1 ⭐                                   [Book This]  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Pre-Op    Mon Mar 16 10:00-10:30  OR-02, Nurse Alpha  │ │
│  │ Procedure Mon Mar 16 10:30-12:30  OR-02, Dr. Patel,   │ │
│  │                                   AN-Garcia           │ │
│  │ Recovery  Mon Mar 16 12:30-3:30   REC-01              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Option 2                                      [Book This]  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Pre-Op    Wed Mar 18 6:30-7:00    OR-01, Nurse Bravo  │ │
│  │ Procedure Wed Mar 18 7:00-9:00    OR-01, Dr. Patel,   │ │
│  │                                   AN-Jones            │ │
│  │ Recovery  Wed Mar 18 9:00-12:00   REC-02              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Option 3                                      [Book This]  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ...                                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Schedule is unchanged. Click "Book" to add to schedule.    │
└─────────────────────────────────────────────────────────────┘
```

### 3d. Ghost bars for CTP options

When the results panel is open, show the top option as ghost bars on the Gantt — same pattern as WhereTo. Dashed borders, lighter color, labeled "CTP: Johnson".

Clicking a different option switches the ghost bars.

### 3e. Book action

"Book This" opens a confirmation dialog:

```
Add "Johnson Knee Replacement" to the schedule?

  Option 1: Monday 10:30 AM
  Pre-Op → Procedure → Recovery on OR-02

  This will permanently add 3 tasks to the schedule.

  [Cancel]  [Add & Solve]
```

"Add & Solve" injects the cloned tasks into the landscape and runs a solve. The new order appears in the task table and Gantt as real scheduled tasks.

---

## Part 4: Verification

### Backend

- [ ] `POST /v1/ctp/query` with valid sourceChainKey returns ranked options
- [ ] Schedule unchanged after query (verify with `GET /ctp/state`)
- [ ] Multiple queries in a row — each sees the same landscape (no leakage)
- [ ] Invalid sourceChainKey → 404 with clear message
- [ ] Source chain with 3 tasks → cloned chain has 3 tasks with new keys
- [ ] linkId/prevLink remapped to new task keys
- [ ] Resource preferences copied correctly
- [ ] Priority override applied when provided
- [ ] `GET /ctp/chain-templates` returns list of existing chains with metadata

### AI

- [ ] "Where can I schedule a new knee replacement?" → AI calls evaluate_new_order
- [ ] AI finds source chain by matching name/category
- [ ] AI presents ranked options with dates, times, resources
- [ ] Action buttons [Book Option 1] appear in response
- [ ] "Schedule Johnson like C001 with Dr. Patel" → passes preferredSurgeon
- [ ] Infeasible order → AI explains why using the infeasibility report

### Frontend

- [ ] CTP Query button in toolbar opens dialog
- [ ] "Based on" dropdown lists existing chains
- [ ] Evaluate returns results in panel
- [ ] Ghost bars appear on Gantt for selected option
- [ ] Switching options switches ghost bars
- [ ] "Book This" → confirmation → tasks added to schedule
- [ ] Works across all three tenants

### Edge Cases

- [ ] CTP query for an order that can't fit anywhere → infeasibility report returned
- [ ] Source chain has cadence → cloned chain respects cadence
- [ ] Source chain has maxGap=0 → cloned chain enforces back-to-back
- [ ] Book an option, then run another CTP query → second query sees the newly booked order's resources consumed
- [ ] Concurrent CTP queries (if applicable) → each gets a clean snapshot

Commit: "feat(what-if-1): stateless CTP query with clone-from-chain, AI tool, UI panel"
