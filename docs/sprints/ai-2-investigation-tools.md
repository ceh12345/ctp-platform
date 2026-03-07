# AI Sprint 2: Investigation Tools

**What it does:** The AI assistant can actively investigate scheduling questions by calling existing API endpoints as tools. Instead of only reading static solve data, it can query WhereTo options, resource agendas, chain details, and impact analysis — then explain the results in plain language.

**Size:** ~2-3 hours CC work  
**Depends on:** AI Sprint 1 (Read-Only Chat), existing WhereTo/Agenda/Analytics endpoints  
**No new engine endpoints** — wraps existing APIs as AI tools

---

## Why

Phase 1 tells the planner WHAT happened. Phase 2 tells them WHAT TO DO ABOUT IT.

```
Phase 1: "CASE-004 is infeasible because the anesthesiologist is blocked."
Phase 2: "CASE-004 has 3 options. The best is OR-02 at 10:30 AM with AN-GARCIA. 
          Want me to show you what moves to make?"
```

The AI becomes a scheduling analyst — it investigates, cross-references, and recommends. The planner asks questions in natural language and gets actionable answers without clicking through tabs and panels.

---

## Part 1: Tool Definitions

The AI gets access to tools via the Anthropic API's tool-use feature. Each tool maps to an existing API endpoint or a data lookup from the solve response.

### 1a. Tool: where_can_task_go

Calls the WhereTo API for a specific task. Returns ranked options with resources, times, and scores.

```typescript
const whereToTool = {
  name: 'where_can_task_go',
  description: 'Find feasible scheduling options for a task. Returns ranked placement options with resources, start/end times, scores, and changeover details. Use when the planner asks where a task can be placed, what options exist, or how to resolve an infeasible task.',
  input_schema: {
    type: 'object',
    properties: {
      task_key: {
        type: 'string',
        description: 'The task key to evaluate (e.g., "C004-PROC")',
      },
    },
    required: ['task_key'],
  },
};
```

### 1b. Tool: get_resource_agenda

Returns a resource's full day schedule — assignments, available gaps, off-shift periods.

```typescript
const resourceAgendaTool = {
  name: 'get_resource_agenda',
  description: 'Get a resource\'s daily schedule showing all assignments, available gaps, and off-shift periods. Use when the planner asks about a specific resource\'s availability, what\'s booked on a resource, or when a resource is free.',
  input_schema: {
    type: 'object',
    properties: {
      resource_key: {
        type: 'string',
        description: 'The resource key (e.g., "OR-01", "AN-JONES", "DR-SMITH")',
      },
      date: {
        type: 'string',
        description: 'The date to show (ISO format, e.g., "2026-02-16"). Defaults to the first day of the horizon if not specified.',
      },
    },
    required: ['resource_key'],
  },
};
```

### 1c. Tool: get_chain_detail

Returns full chain information — all phases, their scheduled times, gaps, maxGap compliance, and resource assignments.

```typescript
const chainDetailTool = {
  name: 'get_chain_detail',
  description: 'Get detailed information about a chain (case/order) including all phases, scheduled times, gaps between phases, maxGap compliance, and resource assignments. Use when the planner asks about a specific case, order, or chain.',
  input_schema: {
    type: 'object',
    properties: {
      chain_key: {
        type: 'string',
        description: 'The chain/order key (e.g., "CASE-002", "WO-1004")',
      },
    },
    required: ['chain_key'],
  },
};
```

### 1d. Tool: analyze_impact

Analyzes what would happen if a task were unscheduled — which resources would be freed, which other tasks could benefit, and which chains would be affected.

```typescript
const analyzeImpactTool = {
  name: 'analyze_impact',
  description: 'Analyze the impact of unscheduling a task or chain. Shows which resources would be freed, how much capacity opens up, which infeasible tasks might benefit, and which chains would be disrupted. Use when the planner asks "what if I unschedule X" or "what happens if I remove X".',
  input_schema: {
    type: 'object',
    properties: {
      task_key: {
        type: 'string',
        description: 'The task key to analyze unscheduling. Can also be a chain key to analyze unscheduling the entire chain.',
      },
    },
    required: ['task_key'],
  },
};
```

### 1e. Tool: find_available_resources

Searches for resources with availability in a given time window. Useful for "which OR is free Monday afternoon?" type questions.

```typescript
const findAvailableResourcesTool = {
  name: 'find_available_resources',
  description: 'Find resources with availability in a given time window. Optionally filter by resource group/type. Use when the planner asks which resources are free, what\'s available at a certain time, or needs to find capacity.',
  input_schema: {
    type: 'object',
    properties: {
      start_time: {
        type: 'string',
        description: 'Start of the search window (ISO datetime or relative like "Monday 8am")',
      },
      end_time: {
        type: 'string',
        description: 'End of the search window (ISO datetime or relative like "Monday 12pm")',
      },
      resource_group: {
        type: 'string',
        description: 'Optional filter by resource group/work center (e.g., "Operating Room", "Anesthesiologist")',
      },
      min_duration_minutes: {
        type: 'number',
        description: 'Minimum contiguous availability needed in minutes. Defaults to 30.',
      },
    },
    required: ['start_time', 'end_time'],
  },
};
```

### 1f. Tool: compare_tasks

Compares two or more tasks side by side — resources, timing, priority, scores, conflicts.

```typescript
const compareTasksTool = {
  name: 'compare_tasks',
  description: 'Compare two or more tasks side by side showing their resources, timing, priority, scores, and conflicts. Use when the planner wants to understand differences between tasks or decide which to prioritize.',
  input_schema: {
    type: 'object',
    properties: {
      task_keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of task keys to compare (e.g., ["C004-PROC", "C008-PROC"])',
      },
    },
    required: ['task_keys'],
  },
};
```

---

## Part 2: Tool Implementations

Each tool reads from the solve response data already in the frontend, or calls an existing API endpoint. No new backend endpoints needed.

### 2a. where_can_task_go implementation

```typescript
async function executeWhereTo(taskKey: string): Promise<string> {
  try {
    const response = await fetch(`/api/v1/ctp/tasks/${encodeURIComponent(taskKey)}/where-to`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();

    if (!data.options || data.options.length === 0) {
      return `No feasible options found for ${taskKey}.${data.reason ? ` Reason: ${data.reason}` : ''} The task cannot be placed with current resource availability.`;
    }

    let result = `Found ${data.options.length} options for ${data.taskName} (${taskKey}):\n\n`;
    for (const opt of data.options) {
      const resources = opt.resources.map(r => r.resourceName || r.resourceKey).join(', ');
      result += `Option ${opt.rank}: ${resources}\n`;
      result += `  Time: ${opt.start} – ${opt.end}\n`;
      result += `  Score: ${opt.score.toFixed(2)}`;
      if (opt.isBestOnResource) result += ' ★ Best on this resource';
      result += '\n';
      if (opt.changeover) {
        result += `  Changeover: ${opt.changeover.fromProcess} → ${opt.changeover.toProcess} (${opt.changeover.durationSeconds}s)\n`;
      }
      result += '\n';
    }

    if (data.currentAssignment) {
      result += `Currently assigned: ${data.currentAssignment.resources.join(', ')} at ${data.currentAssignment.start}–${data.currentAssignment.end}\n`;
    }

    return result;
  } catch (err) {
    return `Error looking up options for ${taskKey}: ${err.message}`;
  }
}
```

### 2b. get_resource_agenda implementation

Built from the solve response resourceUtilization data — no API call needed:

```typescript
function executeResourceAgenda(
  resourceKey: string,
  date: string | undefined,
  solveResult: CTPSolveResult,
): string {
  const resource = solveResult.resourceUtilization.find(r => 
    r.resourceKey === resourceKey || 
    r.resourceName.toLowerCase().includes(resourceKey.toLowerCase())
  );

  if (!resource) {
    // Try fuzzy match
    const fuzzy = solveResult.resourceUtilization.find(r =>
      r.resourceKey.toLowerCase().includes(resourceKey.toLowerCase()) ||
      r.resourceName.toLowerCase().includes(resourceKey.toLowerCase())
    );
    if (!fuzzy) return `Resource "${resourceKey}" not found. Available resources: ${solveResult.resourceUtilization.map(r => r.resourceName).join(', ')}`;
    return executeResourceAgenda(fuzzy.resourceKey, date, solveResult);
  }

  // Filter to requested date (or first day with data)
  const targetDate = date ? new Date(date) : null;

  let result = `${resource.resourceName} (${resource.resourceKey})\n`;
  result += `Utilization: ${resource.utilization}%\n`;
  result += `Work Center: ${resource.workCenter || 'N/A'}\n\n`;

  // Build timeline from assignments and availability
  const assignments = resource.assignments || [];
  const availability = resource.availability || [];
  const netAvailable = resource.netAvailable || [];

  // Filter to date if specified
  const filterToDate = (items: any[], dateStr: string | null) => {
    if (!dateStr) return items;
    const d = new Date(dateStr);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    return items.filter(i => i.start < dayEnd && i.end > dayStart);
  };

  const dayAssignments = filterToDate(assignments, date || null);
  const dayAvailable = filterToDate(netAvailable, date || null);

  if (dayAssignments.length > 0) {
    result += 'Assignments:\n';
    for (const a of dayAssignments) {
      // Find which task this assignment belongs to
      const task = solveResult.tasks.find(t => 
        t.scheduledStart === a.start || 
        (t.assignedResources || []).some(r => r.resourceKey === resource.resourceKey)
      );
      const taskName = task ? `${task.name} (${task.key})` : 'Unknown';
      result += `  ${a.start} – ${a.end}: ${taskName}\n`;
    }
  }

  if (dayAvailable.length > 0) {
    result += '\nAvailable gaps:\n';
    for (const a of dayAvailable) {
      const durMin = Math.round(a.durationSec / 60);
      result += `  ${a.start} – ${a.end}: ${durMin} min free\n`;
    }
  }

  if (dayAssignments.length === 0 && dayAvailable.length === 0) {
    result += 'No assignments or availability data for this date.\n';
  }

  return result;
}
```

### 2c. get_chain_detail implementation

Built from solve response task data:

```typescript
function executeChainDetail(
  chainKey: string,
  solveResult: CTPSolveResult,
): string {
  const chainTasks = solveResult.tasks
    .filter(t => t.orderRef === chainKey)
    .sort((a, b) => (a.scheduledStart || '').localeCompare(b.scheduledStart || ''));

  if (chainTasks.length === 0) {
    return `Chain "${chainKey}" not found. Available chains: ${[...new Set(solveResult.tasks.map(t => t.orderRef).filter(Boolean))].join(', ')}`;
  }

  const order = solveResult.orders?.find(o => o.orderKey === chainKey);

  let result = `Chain: ${chainKey}`;
  if (order) result += ` — ${order.name} (Priority ${order.priority})`;
  result += `\nPhases: ${chainTasks.length}\n\n`;

  let prevEnd: string | null = null;
  for (const task of chainTasks) {
    const status = task.feasible ? '✓ Scheduled' : '✗ Infeasible';
    const resources = (task.assignedResources || [])
      .map(r => r.resourceName || r.resourceKey)
      .join(', ');

    result += `${task.type || 'PROCESS'}: ${task.name} (${task.key}) — ${status}\n`;

    if (task.feasible && task.scheduledStart) {
      result += `  Time: ${task.scheduledStart} – ${task.scheduledEnd}\n`;
      result += `  Resources: ${resources}\n`;

      // Gap from previous phase
      if (prevEnd) {
        const gapMs = new Date(task.scheduledStart).getTime() - new Date(prevEnd).getTime();
        const gapMin = Math.round(gapMs / 60000);
        result += `  Gap from previous: ${gapMin} min${gapMin === 0 ? ' (back-to-back ✓)' : ''}\n`;
      }
      prevEnd = task.scheduledEnd;
    } else {
      // Infeasible — show errors
      for (const err of (task.errors || [])) {
        result += `  Error: ${err.reason}\n`;
      }
      if (task.infeasibilityReport) {
        result += `  Conflict type: ${task.infeasibilityReport.conflictType}\n`;
        result += `  Bottleneck: ${task.infeasibilityReport.bottleneckSlot}\n`;
      }
      prevEnd = null;
    }
    result += '\n';
  }

  if (order) {
    result += `Order: ${order.demandQty} demanded, ${order.scheduledQty} scheduled (${(order.fillRate * 100).toFixed(0)}% fill)\n`;
    result += `Due: ${order.dueDate}\n`;
  }

  return result;
}
```

### 2d. analyze_impact implementation

Analyzes what unscheduling a task/chain would free up:

```typescript
function executeImpactAnalysis(
  taskKey: string,
  solveResult: CTPSolveResult,
): string {
  // Check if it's a chain key or task key
  const chainTasks = solveResult.tasks.filter(t => t.orderRef === taskKey);
  const isChain = chainTasks.length > 1;
  const targetTasks = isChain
    ? chainTasks.filter(t => t.feasible)
    : solveResult.tasks.filter(t => t.key === taskKey && t.feasible);

  if (targetTasks.length === 0) {
    return `${taskKey} is not currently scheduled — nothing to unschedule.`;
  }

  let result = isChain
    ? `Impact of unscheduling chain ${taskKey} (${targetTasks.length} tasks):\n\n`
    : `Impact of unscheduling ${targetTasks[0].name} (${taskKey}):\n\n`;

  // Resources freed
  const freedResources = new Map<string, { name: string; minutes: number }>();
  for (const task of targetTasks) {
    if (!task.scheduledStart || !task.scheduledEnd) continue;
    const durMin = Math.round((new Date(task.scheduledEnd).getTime() - new Date(task.scheduledStart).getTime()) / 60000);

    for (const res of (task.assignedResources || [])) {
      const key = res.resourceKey;
      const existing = freedResources.get(key);
      if (existing) {
        existing.minutes += durMin;
      } else {
        freedResources.set(key, { name: res.resourceName || key, minutes: durMin });
      }
    }
  }

  result += 'Resources freed:\n';
  for (const [key, info] of freedResources) {
    result += `  ${info.name}: ${info.minutes} min freed\n`;
  }

  // Which infeasible tasks might benefit?
  const infeasible = solveResult.tasks.filter(t => !t.feasible && t.infeasibilityReport);
  const wouldBenefit: string[] = [];

  for (const task of infeasible) {
    if (!task.infeasibilityReport?.slots) continue;
    const bottleneck = task.infeasibilityReport.slots.find(s => s.isBottleneck);
    if (!bottleneck) continue;

    // Check if any freed resource matches the bottleneck
    for (const res of bottleneck.resources) {
      if (freedResources.has(res.resourceKey)) {
        wouldBenefit.push(`${task.name} (${task.key}) — needs ${res.resourceName}`);
        break;
      }
    }
  }

  if (wouldBenefit.length > 0) {
    result += '\nInfeasible tasks that might benefit:\n';
    for (const b of wouldBenefit) {
      result += `  → ${b}\n`;
    }
  } else {
    result += '\nNo currently infeasible tasks would directly benefit from this capacity.\n';
  }

  // Chain impact
  if (!isChain) {
    const taskData = targetTasks[0];
    if (taskData.orderRef) {
      const chainPeers = solveResult.tasks.filter(t => t.orderRef === taskData.orderRef && t.key !== taskKey);
      if (chainPeers.length > 0) {
        result += `\n⚠ This task is part of chain ${taskData.orderRef}. Unscheduling it may break the chain sequence for:\n`;
        for (const peer of chainPeers) {
          result += `  ${peer.name} (${peer.key}) — ${peer.feasible ? 'scheduled' : 'infeasible'}\n`;
        }
      }
    }
  }

  return result;
}
```

### 2e. find_available_resources implementation

```typescript
function executeFindAvailableResources(
  startTime: string,
  endTime: string,
  resourceGroup: string | undefined,
  minDurationMinutes: number,
  solveResult: CTPSolveResult,
): string {
  const minDur = minDurationMinutes || 30;

  let resources = solveResult.resourceUtilization;

  // Filter by group if specified
  if (resourceGroup) {
    const groupLower = resourceGroup.toLowerCase();
    resources = resources.filter(r =>
      (r.workCenter || '').toLowerCase().includes(groupLower) ||
      (r.resourceName || '').toLowerCase().includes(groupLower) ||
      (r.resourceClass || '').toLowerCase().includes(groupLower)
    );
  }

  if (resources.length === 0) {
    return `No resources found matching "${resourceGroup}".`;
  }

  const results: { name: string; key: string; gaps: { start: string; end: string; durMin: number }[] }[] = [];

  for (const res of resources) {
    const gaps: { start: string; end: string; durMin: number }[] = [];

    for (const avail of (res.netAvailable || [])) {
      // Check overlap with search window
      const aStart = new Date(avail.start).getTime();
      const aEnd = new Date(avail.end).getTime();
      const wStart = new Date(startTime).getTime();
      const wEnd = new Date(endTime).getTime();

      const overlapStart = Math.max(aStart, wStart);
      const overlapEnd = Math.min(aEnd, wEnd);
      const overlapMin = (overlapEnd - overlapStart) / 60000;

      if (overlapMin >= minDur) {
        gaps.push({
          start: new Date(overlapStart).toISOString(),
          end: new Date(overlapEnd).toISOString(),
          durMin: Math.round(overlapMin),
        });
      }
    }

    if (gaps.length > 0) {
      results.push({ name: res.resourceName, key: res.resourceKey, gaps });
    }
  }

  if (results.length === 0) {
    return `No resources have ${minDur}+ minutes of availability between ${startTime} and ${endTime}.`;
  }

  // Sort by most availability
  results.sort((a, b) => {
    const aTotal = a.gaps.reduce((sum, g) => sum + g.durMin, 0);
    const bTotal = b.gaps.reduce((sum, g) => sum + g.durMin, 0);
    return bTotal - aTotal;
  });

  let result = `${results.length} resources with ${minDur}+ min availability:\n\n`;
  for (const r of results) {
    const totalMin = r.gaps.reduce((sum, g) => sum + g.durMin, 0);
    result += `${r.name} (${r.key}) — ${totalMin} min total:\n`;
    for (const gap of r.gaps) {
      result += `  ${gap.start} – ${gap.end} (${gap.durMin} min)\n`;
    }
    result += '\n';
  }

  return result;
}
```

### 2f. compare_tasks implementation

```typescript
function executeCompareTasks(
  taskKeys: string[],
  solveResult: CTPSolveResult,
): string {
  const tasks = taskKeys
    .map(key => solveResult.tasks.find(t => t.key === key))
    .filter(Boolean);

  if (tasks.length === 0) {
    return `No tasks found for keys: ${taskKeys.join(', ')}`;
  }

  let result = `Comparing ${tasks.length} tasks:\n\n`;

  for (const task of tasks) {
    result += `${task.key}: ${task.name}\n`;
    result += `  Status: ${task.feasible ? 'Scheduled' : 'Infeasible'}\n`;
    result += `  Priority: ${task.priority}\n`;
    result += `  Type: ${task.type || 'PROCESS'}\n`;
    result += `  Category: ${task.processCategory || 'N/A'}\n`;
    result += `  Chain: ${task.orderRef || 'standalone'}\n`;

    if (task.feasible) {
      result += `  Time: ${task.scheduledStart} – ${task.scheduledEnd}\n`;
      const resources = (task.assignedResources || [])
        .map(r => r.resourceName || r.resourceKey).join(', ');
      result += `  Resources: ${resources}\n`;
      result += `  Score: ${task.score?.toFixed(2) || 'N/A'}\n`;
    } else {
      if (task.infeasibilityReport) {
        result += `  Conflict: ${task.infeasibilityReport.conflictType}\n`;
        result += `  Bottleneck: ${task.infeasibilityReport.bottleneckSlot}\n`;
      }
      for (const err of (task.errors || [])) {
        result += `  Error: ${err.reason}\n`;
      }
    }
    result += '\n';
  }

  // Shared resources
  const allResources = new Map<string, string[]>();
  for (const task of tasks) {
    for (const res of (task.assignedResources || [])) {
      if (!allResources.has(res.resourceKey)) allResources.set(res.resourceKey, []);
      allResources.get(res.resourceKey)!.push(task.key);
    }
  }
  const shared = Array.from(allResources.entries()).filter(([, tasks]) => tasks.length > 1);
  if (shared.length > 0) {
    result += 'Shared resources:\n';
    for (const [resKey, taskKeys] of shared) {
      result += `  ${resKey}: used by ${taskKeys.join(', ')}\n`;
    }
  }

  return result;
}
```

---

## Part 3: API Integration with Tool Use

### 3a. Updated sendMessage with tools

```typescript
async function sendMessage(
  userMessage: string,
  conversationHistory: ChatMessage[],
  solveResult: CTPSolveResult,
): Promise<string> {

  const systemPrompt = buildSystemPrompt(solveResult);

  const messages = conversationHistory
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userMessage });

  // Define tools
  const tools = [
    whereToTool,
    resourceAgendaTool,
    chainDetailTool,
    analyzeImpactTool,
    findAvailableResourcesTool,
    compareTasksTool,
  ];

  let response = await callAnthropicAPI(systemPrompt, messages, tools);

  // Handle tool use — the AI may call one or more tools
  let maxIterations = 5;  // prevent infinite tool loops
  while (response.stop_reason === 'tool_use' && maxIterations > 0) {
    maxIterations--;

    // Find tool use blocks in the response
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      const result = await executeTool(toolUse.name, toolUse.input, solveResult);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Add assistant response + tool results to messages, then call again
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await callAnthropicAPI(systemPrompt, messages, tools);
  }

  // Extract final text response
  const text = response.content
    ?.filter(item => item.type === 'text')
    ?.map(item => item.text)
    ?.join('\n') || 'I couldn\'t generate a response.';

  return text;
}
```

### 3b. Tool dispatcher

```typescript
async function executeTool(
  toolName: string,
  input: any,
  solveResult: CTPSolveResult,
): Promise<string> {
  switch (toolName) {
    case 'where_can_task_go':
      return await executeWhereTo(input.task_key);

    case 'get_resource_agenda':
      return executeResourceAgenda(input.resource_key, input.date, solveResult);

    case 'get_chain_detail':
      return executeChainDetail(input.chain_key, solveResult);

    case 'analyze_impact':
      return executeImpactAnalysis(input.task_key, solveResult);

    case 'find_available_resources':
      return executeFindAvailableResources(
        input.start_time, input.end_time,
        input.resource_group, input.min_duration_minutes,
        solveResult,
      );

    case 'compare_tasks':
      return executeCompareTasks(input.task_keys, solveResult);

    default:
      return `Unknown tool: ${toolName}`;
  }
}
```

### 3c. API call helper

```typescript
async function callAnthropicAPI(
  system: string,
  messages: any[],
  tools: any[],
): Promise<any> {
  const response = await fetch('/api/v1/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CTP_AI_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system,
      messages,
      tools,
    }),
  });
  return response.json();
}
```

---

## Part 4: Updated System Prompt

Add tool usage guidance to the system prompt:

```typescript
function buildSystemPrompt(solveResult: CTPSolveResult): string {
  let prompt = buildPhase1SystemPrompt(solveResult);

  prompt += `\n## Tools Available\n`;
  prompt += `You have tools to investigate the schedule further:\n`;
  prompt += `- where_can_task_go: Find placement options for a task (calls WhereTo)\n`;
  prompt += `- get_resource_agenda: See a resource's full day (assignments + gaps)\n`;
  prompt += `- get_chain_detail: See all phases of a case/order chain\n`;
  prompt += `- analyze_impact: See what happens if a task/chain is unscheduled\n`;
  prompt += `- find_available_resources: Search for free resources in a time window\n`;
  prompt += `- compare_tasks: Compare multiple tasks side by side\n`;
  prompt += `\nUse tools when the planner's question requires fresher or more detailed data than what's in the schedule summary above. For simple questions about the current state, answer from the summary directly without calling tools.\n`;
  prompt += `\nAlways explain tool results in plain language. Don't just dump raw data — interpret it, highlight the key finding, and suggest next steps when appropriate.\n`;

  return prompt;
}
```

---

## Part 5: Loading State for Tool Calls

Tool calls take longer than simple Q&A — show what's happening:

```typescript
// In the chat panel, when the AI is calling tools:
{message.loading && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <span style={{ opacity: 0.6, fontSize: 12 }}>
      {message.toolCallInProgress
        ? `🔍 Investigating: ${message.toolCallInProgress}...`
        : 'Thinking...'}
    </span>
  </div>
)}
```

Track which tool is being called:

```typescript
// When tool_use blocks are detected in the response:
setMessages(prev => prev.map(m =>
  m.id === loadingMsg.id
    ? { ...m, toolCallInProgress: toolUse.name.replace(/_/g, ' ') }
    : m
));
```

This shows:
```
🔍 Investigating: where can task go...
🔍 Investigating: get resource agenda...
```

---

## Part 6: Example Conversations

### Finding options for an infeasible task
```
Planner: "Where can CASE-004 go?"

AI: [calls where_can_task_go with task_key="C004-PROC"]

    CASE-004 (Knee Replacement) has 3 placement options:

    1. OR-02 with Dr. Smith + AN-GARCIA at 10:30 AM ★
       Score: 2.3 — earliest option, best overall
    
    2. OR-01 with Dr. Smith + AN-GARCIA at 2:00 PM
       Score: 3.1 — afternoon slot after CASE-001 clears
    
    3. OR-02 with Dr. Smith + AN-JONES at 3:30 PM
       Score: 3.8 — Jones frees up in the afternoon

    Option 1 gets Carter into surgery earliest. Want me to 
    check if moving to 10:30 affects any other cases?
```

### Investigating a resource bottleneck
```
Planner: "Why is Monday morning so tight?"

AI: [calls get_resource_agenda for AN-JONES]
    [calls get_resource_agenda for AN-GARCIA]

    Monday morning is tight because of anesthesiologist coverage:

    AN-JONES is fully booked 7:00-10:30 AM:
      7:00-8:00   CASE-002 Knee Replacement
      8:00-10:30  CASE-001 Hip Replacement
    
    AN-GARCIA doesn't start until 10:00 AM, leaving a 
    3-hour window (7:00-10:00) with only one anesthesiologist.

    The ORs and surgeons have morning availability — the 
    anesthesiologist is the sole bottleneck. Options:
    1. Shift AN-GARCIA's start to 7:00 AM
    2. Move CASE-004/011 to afternoon slots
    3. Add a third anesthesiologist for morning coverage
```

### What-if analysis
```
Planner: "What if I unschedule CASE-001?"

AI: [calls analyze_impact with task_key="CASE-001"]

    Unscheduling CASE-001 (Hip Replacement) would free:
      OR-01: 150 min (8:00-10:30 AM)
      DR-SMITH: 150 min
      AN-JONES: 150 min
      RN-01: 150 min

    Infeasible tasks that would benefit:
      → CASE-011 (Rotator Cuff) — needs anesthesiologist
      → CASE-004 (Knee Replacement) — needs anesthesiologist

    ⚠ CASE-001 is priority 3 (elective). Unscheduling it would 
    drop the order fill rate for CASE-001 to 0%.

    Two infeasible cases could potentially schedule if Jones 
    is freed. Want me to check specific options?
```

---

## Part 7: Verification

- [ ] Tool definitions registered in API call
- [ ] where_can_task_go: calls WhereTo API, returns ranked options
- [ ] get_resource_agenda: returns assignments + gaps for a resource/day
- [ ] get_chain_detail: returns all phases with timing and gaps
- [ ] analyze_impact: shows freed resources and benefiting tasks
- [ ] find_available_resources: finds resources with availability in a window
- [ ] compare_tasks: side-by-side comparison of multiple tasks
- [ ] AI decides when to use tools vs answer from context
- [ ] Multi-tool calls work (AI calls 2+ tools in one response)
- [ ] Tool call loading state shows which tool is running
- [ ] "Where can CASE-004 go?" triggers where_can_task_go tool
- [ ] "Show me AN-JONES's day" triggers get_resource_agenda tool
- [ ] "What happens if I unschedule CASE-001?" triggers analyze_impact
- [ ] "Which OR is free Monday afternoon?" triggers find_available_resources
- [ ] Tool results explained in plain language, not raw data
- [ ] Max 5 tool iterations prevents infinite loops
- [ ] Works across all three tenants
- [ ] Phase 1 Q&A still works (simple questions answered without tools)

---

## Size Estimate

- Tool definitions (6 tools): ~15 min
- Tool implementations: ~45 min
- API integration with tool-use loop: ~30 min
- System prompt update: ~10 min
- Loading state for tool calls: ~10 min
- Testing: ~20 min
- Total: ~2-2.5 hours

---

## Future: AI Sprint 3 (Actions)

Phase 2 investigates. Phase 3 acts:

```
Planner: "Move CASE-004 to OR-02 at 10:30"
AI:      "I'll move CASE-004 to OR-02 at 10:30 AM with Dr. Smith 
          and AN-GARCIA. This will use Option 1 from the earlier 
          search. Confirm?"
         [Confirm] [Cancel]
```

Tools for Phase 3: `schedule_task`, `unschedule_task`, `move_task`, `change_priority`. All require user confirmation before executing.
