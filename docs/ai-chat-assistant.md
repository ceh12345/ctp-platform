# AI Scheduling Assistant — In-App Chat

An AI-powered chat assistant embedded in the scheduling application. The assistant understands the current schedule state, can answer natural language questions, investigate issues, and take scheduling actions with user confirmation.

This is a high-priority feature — implement as early as possible.

---

## Overview

The assistant sits in a side panel or floating chat within the app. It has access to the full schedule state through tool calls to existing API endpoints. It speaks the tenant's terminology. It can read, investigate, and act.

**Key differentiator:** Most scheduling tools show data. Ours explains it, answers questions about it, and helps you fix it — in plain language.

---

## Phase 1: Read-Only Q&A (1 week)

The assistant can answer questions about the current schedule by reading data through API endpoints. No mutations.

### 1.1 Chat UI Component

Collapsible side panel on the right side of the app (not a modal — the user should see both the schedule and the chat simultaneously).

- **Toggle button:** Floating button in bottom-right corner, or a tab/icon in the header bar
- **Panel width:** ~380px, collapsible
- **Message list:** Scrollable, user messages right-aligned, assistant messages left-aligned
- **Input:** Text input at bottom with send button, supports Enter to send
- **Session history:** Conversation persists within the browser session (not across page reloads for V1)
- **Typing indicator:** Streaming response with animated dots while the assistant is thinking
- **Markdown rendering:** Assistant responses can include simple markdown (bold, lists, code)
- **Dark theme:** Match the existing app theme

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallResult[];  // Phase 2+
  confirmation?: ConfirmationCard;  // Phase 3
}
```

### 1.2 Chat API Endpoint

```
POST /v1/chat/message
```

Request:
```json
{
  "message": "Why is the Davis case showing a gap?",
  "conversationHistory": [
    { "role": "user", "content": "Show me today's bottleneck" },
    { "role": "assistant", "content": "The bottleneck today is..." }
  ],
  "context": {
    "activeTab": "analytics",
    "selectedKpi": "chain-violations",
    "selectedCase": "CASE-004"
  }
}
```

Response (streamed):
```json
{
  "role": "assistant",
  "content": "The Davis Hernia Repair case has a 45-minute gap between...",
  "toolsUsed": ["get_chain_integrity"]
}
```

The `context` field tells the assistant what the user is currently looking at in the UI, so it can give contextually relevant answers without the user needing to explain.

### 1.3 System Prompt Builder

The system prompt is built dynamically from the current schedule state and tenant config. It's rebuilt on each message (or cached and refreshed after each solve).

```typescript
function buildSystemPrompt(
  tenant: TenantConfig,
  landscape: ILandscape,
  analytics: AnalyticsSummary,
  uiContext: UIContext
): string {
  return `
You are a scheduling assistant for ${tenant.name}.

## Your Role
You help planners understand their schedule, identify issues, and make better decisions. You speak in clear, concise language. You reference specific cases, resources, and times. When you don't know something, you say so and suggest what data to look at.

## Terminology
This tenant uses the following terms:
${Object.entries(tenant.terminology.mappings).map(([generic, custom]) => `- "${custom}" instead of "${generic}"`).join('\n')}

Always use the tenant's terminology in your responses.

## Current Schedule State
- Horizon: ${formatDate(landscape.horizon.startDate)} to ${formatDate(landscape.horizon.endDate)}
- Total ${tenant.term('task', true)}: ${analytics.totalTasks}
- Scheduled: ${analytics.scheduled}
- Unscheduled: ${analytics.unscheduled}
- Infeasible: ${analytics.infeasible}
- On-time rate: ${analytics.onTimeStarts.percentage}%

## Resource Summary
${analytics.utilization.groups.map(g => 
  `- ${g.hierarchy}: avg ${g.avgUtilization}% utilization (${g.resources.length} resources)`
).join('\n')}

## Bottleneck
${analytics.bottleneck.hierarchy} — ${analytics.bottleneck.resource} at ${analytics.bottleneck.utilization}% utilization

## Current Issues
${analytics.chainViolations.length} chain violations:
${analytics.chainViolations.map(v => 
  `- ${v.caseName}: ${Math.round(v.totalGap / 60)} min total gap`
).join('\n')}

## UI Context
The user is currently viewing: ${uiContext.activeTab}
${uiContext.selectedCase ? `Selected case: ${uiContext.selectedCase}` : ''}
${uiContext.selectedResource ? `Selected resource: ${uiContext.selectedResource}` : ''}
${uiContext.selectedKpi ? `Selected KPI: ${uiContext.selectedKpi}` : ''}

## Instructions
- Be concise. Planners are busy.
- Reference specific names, times, and resources — not vague generalities.
- If the user asks about something you need more data for, use the available tools.
- If the user asks you to make a change, explain what you would do and ask for confirmation.
- Don't make up data. If you don't have it, say so.
  `;
}
```

### 1.4 Read-Only Tools

These tools let the assistant query the current schedule state. They map directly to existing API endpoints.

```typescript
const readOnlyTools = [
  {
    name: "get_schedule_summary",
    description: "Get overall schedule summary — task counts, feasibility, on-time rate",
    endpoint: "GET /v1/analytics/summary",
    parameters: {}
  },
  {
    name: "get_utilization",
    description: "Get resource utilization by group (e.g., Operating Room, Surgeon). Can filter by hierarchy or specific resource.",
    endpoint: "GET /v1/analytics/utilization",
    parameters: {
      hierarchy: { type: "string", optional: true, description: "Filter by resource group" },
      resource: { type: "string", optional: true, description: "Filter by specific resource key" },
      date: { type: "string", optional: true, description: "Filter by specific date" }
    }
  },
  {
    name: "get_scheduling_metrics",
    description: "Get scheduling quality metrics — on-time starts, turnover times, infeasible tasks",
    endpoint: "GET /v1/analytics/scheduling",
    parameters: {}
  },
  {
    name: "get_chain_integrity",
    description: "Get case chain integrity — gaps between phases, violations, back-to-back rates. Use this when the user asks about gaps, violations, or case flow.",
    endpoint: "GET /v1/analytics/chains",
    parameters: {
      caseKey: { type: "string", optional: true, description: "Filter by specific case" }
    }
  },
  {
    name: "get_task_detail",
    description: "Get details for a specific task/phase — scheduled times, assigned resources, duration, status, errors",
    endpoint: "GET /v1/tasks/:taskKey",
    parameters: {
      taskKey: { type: "string", required: true }
    }
  },
  {
    name: "get_resource_schedule",
    description: "Get a resource's full schedule — all assigned tasks, availability windows, utilization",
    endpoint: "GET /v1/resources/:resourceKey/schedule",
    parameters: {
      resourceKey: { type: "string", required: true },
      date: { type: "string", optional: true }
    }
  },
  {
    name: "get_case_detail",
    description: "Get all phases for a specific case/order with their chain status",
    endpoint: "GET /v1/analytics/chains?caseKey=:caseKey",
    parameters: {
      caseKey: { type: "string", required: true }
    }
  },
  {
    name: "search_tasks",
    description: "Search tasks by name, resource, status, or date range",
    endpoint: "GET /v1/tasks/search",
    parameters: {
      query: { type: "string", optional: true },
      resource: { type: "string", optional: true },
      status: { type: "string", optional: true, enum: ["scheduled", "unscheduled", "infeasible"] },
      dateFrom: { type: "string", optional: true },
      dateTo: { type: "string", optional: true }
    }
  },
  {
    name: "get_conflicts",
    description: "Get current scheduling conflicts — capacity issues, changeover problems, resource contention",
    endpoint: "GET /v1/conflicts",
    parameters: {}
  }
];
```

### 1.5 Example Interactions (Phase 1)

**Understanding the schedule:**
```
User: "What's the bottleneck this week?"
AI: [calls get_utilization]
AI: "AN-JONES (Anesthesiologist) is your bottleneck at 91.3% utilization. 
     She's covering 6 of the 8 cases requiring anesthesia this week. 
     AN-GARCIA is only at 68% — consider shifting some cases to her."
```

**Investigating an issue:**
```
User: "Why does Davis have a gap?"
AI: [calls get_chain_integrity with caseKey=CASE-004]
AI: "The Davis Hernia Repair has a 45-minute gap between the Procedure 
     (ending at 11:30) and Recovery (starting at 12:15). Recovery Bay 1 
     is occupied by the Thompson case until 12:15. Recovery Bay 2 is 
     available at 11:30 — reassigning Recovery to REC-02 would eliminate 
     the gap."
```

**Resource inquiry:**
```
User: "Show me Dr. Smith's schedule for Tuesday"
AI: [calls get_resource_schedule with resourceKey=DR-SMITH, date=2026-02-17]
AI: "Dr. Smith on Tuesday:
     7:30-10:00 — Thompson Knee Replacement (OR-01)
     10:30-11:30 — Davis Hernia Repair (OR-01)
     13:00-14:30 — Kim Laparoscopic (OR-02)
     He has a 30-min gap between Thompson and Davis, and a 90-min gap 
     before Kim. That afternoon gap could fit a short procedure."
```

**Contextual awareness:**
```
User: [looking at Analytics → Chain Integrity page]
User: "What's the worst violation?"
AI: [knows user is on chain integrity page from uiContext]
AI: [calls get_chain_integrity]
AI: "Garcia Arthroscopy has the worst gap — 4 hours between Procedure 
     and Recovery. The procedure finishes at 9:00 but Recovery doesn't 
     start until 13:00. This looks like a recovery bay availability 
     issue in the morning block."
```

---

## Phase 2: Investigation & What-If (adds ~1 week)

The assistant can run deeper analysis — slot finding, impact analysis, and what-if scenarios. Still read-only (no mutations).

### 2.1 Investigation Tools

```typescript
const investigationTools = [
  {
    name: "where_to",
    description: "Find feasible scheduling options for a task. Returns ranked alternatives with resources and times. Use this when the user asks 'where can I fit...', 'when is the next opening...', or 'can I schedule...'",
    endpoint: "POST /v1/slots/find",
    parameters: {
      taskKey: { type: "string", required: true },
      maxOptions: { type: "number", optional: true, default: 3 }
    }
  },
  {
    name: "impact_analysis",
    description: "What happens if a resource goes down or a task is delayed? Returns affected cases and recovery options.",
    endpoint: "POST /v1/ctp/what-if",
    parameters: {
      scenario: {
        type: "object",
        properties: {
          resourceDown: { type: "string", description: "Resource key to remove" },
          fromTime: { type: "string" },
          toTime: { type: "string" }
        }
      }
    }
  },
  {
    name: "compare_options",
    description: "Compare two or more scheduling options side by side — scores, resource usage, impact on other cases",
    endpoint: "POST /v1/ctp/compare",
    parameters: {
      options: { type: "array", items: { type: "object" } }
    }
  }
];
```

### 2.2 Example Interactions (Phase 2)

**Slot finding:**
```
User: "Can I fit another knee replacement on Thursday?"
AI: [calls where_to with a new knee replacement task template]
AI: "I found 2 options for Thursday:
     
     Option 1 ⭐ — OR-01, 14:00-16:30
       Dr. Patel, AN-Garcia, RN-02, Fluoroscopy
       Score: 14.2 (good — low utilization impact)
     
     Option 2 — OR-02, 8:00-10:30
       Dr. Smith, AN-Jones, RN-01, Fluoroscopy  
       Score: 22.8 (worse — AN-Jones already at 91%)
     
     Option 1 is better — it uses the underutilized afternoon block 
     and doesn't add to the anesthesia bottleneck. Want me to schedule it?"
```

**Impact analysis:**
```
User: "What if OR-02 is down tomorrow?"
AI: [calls impact_analysis with resourceDown=OR-02]
AI: "3 cases would be affected:
     - Kim Laparoscopic (13:00) — can move to OR-01 at 14:30, 90 min delay
     - Brown Hernia Repair (8:00) — can move to OR-03, same time, no delay
     - Garcia Arthroscopy (10:00) — no alternatives, OR-01 and OR-03 full. 
       This case would need to be rescheduled to Wednesday.
     
     Want me to show the recovery options in detail?"
```

---

## Phase 3: Actions with Confirmation (~1 additional week)

The assistant can make scheduling changes — but always with explicit user confirmation. Never auto-execute.

### 3.1 Action Tools

```typescript
const actionTools = [
  {
    name: "schedule_task",
    description: "Schedule a task to a specific slot. ALWAYS require user confirmation before executing.",
    endpoint: "POST /v1/schedule/task",
    parameters: {
      taskKey: { type: "string", required: true },
      option: { type: "number", description: "Which option from where_to results (1-indexed)" }
    },
    requiresConfirmation: true
  },
  {
    name: "unschedule_task",
    description: "Remove a task from the schedule. ALWAYS require user confirmation.",
    endpoint: "POST /v1/schedule/unschedule",
    parameters: {
      taskKey: { type: "string", required: true },
      cascade: { type: "boolean", default: true, description: "Also unschedule downstream tasks in chain" }
    },
    requiresConfirmation: true
  },
  {
    name: "reschedule_task",
    description: "Move a task to a different slot. Unschedules then reschedules. ALWAYS require user confirmation.",
    endpoint: "POST /v1/schedule/reschedule",
    parameters: {
      taskKey: { type: "string", required: true },
      option: { type: "number" }
    },
    requiresConfirmation: true
  },
  {
    name: "solve_all",
    description: "Run the full solver on all unscheduled tasks. ALWAYS require user confirmation.",
    endpoint: "POST /v1/solve",
    parameters: {
      strategy: { type: "string", enum: ["quick", "balanced", "thorough", "best"], default: "balanced" }
    },
    requiresConfirmation: true
  }
];
```

### 3.2 Confirmation Card UI

When the assistant wants to take an action, it returns a confirmation card rendered as a special message type:

```typescript
interface ConfirmationCard {
  action: string;
  description: string;
  details: {
    taskName: string;
    resource: string;
    timeRange: string;
    impact?: string;
  };
  confirmLabel: string;   // "Schedule" / "Unschedule" / "Reschedule"
  cancelLabel: string;    // "Cancel"
  actionPayload: any;     // The actual API call to make on confirm
}
```

Rendered as:

```
┌──────────────────────────────────────────────┐
│ 📋 Schedule Davis Hernia Repair - Recovery   │
│                                              │
│ Resource:  Recovery Bay 2 (REC-02)           │
│ Time:      11:30 — 12:30                     │
│ Impact:    Eliminates 45-min gap in chain    │
│                                              │
│         [ Cancel ]    [ ✓ Schedule ]         │
└──────────────────────────────────────────────┘
```

User clicks "Schedule" → the frontend calls the action endpoint → the assistant confirms success and the UI refreshes.

### 3.3 Example Interactions (Phase 3)

**Fix a violation:**
```
User: "Fix the Davis gap"
AI: [calls get_chain_integrity for CASE-004]
AI: [calls where_to for C004-REC]
AI: "I can move Davis Recovery to Recovery Bay 2 starting at 11:30 — 
     right after the procedure ends. This eliminates the 45-minute gap."
AI: [shows confirmation card]
User: [clicks ✓ Schedule]
AI: "Done. Davis Hernia Repair is now back-to-back. Chain integrity updated."
```

**Bulk action:**
```
User: "Unschedule all of Dr. Smith's cases on Friday"
AI: [calls get_resource_schedule for DR-SMITH on Friday]
AI: "Dr. Smith has 3 cases on Friday:
     - Martinez Knee Replacement (7:30-10:00)
     - Brown Hernia Repair (10:30-11:30)  
     - Lee Pain Injection (13:00-13:30)
     
     Unscheduling will cascade to downstream phases (recovery). 
     7 tasks total will be unscheduled."
AI: [shows confirmation card with full list]
User: [clicks ✓ Unschedule All]
AI: "Done. 7 phases unscheduled. Dr. Smith's Friday is now clear. 
     Run Build Schedule to re-optimize these cases."
```

---

## Phase 4: Proactive Insights (adds ~1 week)

The assistant doesn't just respond — it proactively surfaces issues.

### 4.1 Post-Solve Summary

After every solve, the assistant automatically posts a summary:

```
AI: "Schedule built — 28 of 30 phases placed.

     ✓ 8 cases fully scheduled, back-to-back
     ⚠ 1 case with gap: Davis Hernia (45 min gap before Recovery)
     ✕ 1 case partially infeasible: Garcia Recovery — no bay available
     
     Bottleneck: AN-JONES at 91% — consider shifting cases to AN-GARCIA.
     
     Want me to investigate the Davis gap or find options for Garcia?"
```

### 4.2 Disruption Alerts

When WIP state changes come in (machine down, delay reported), the assistant alerts:

```
AI: "⚠ OR-02 reported unavailable 10:00-14:00 tomorrow.
     
     3 cases affected:
     - Kim Laparoscopic (13:00) — HIGH RISK, no alternative found yet
     - Brown Hernia (8:00) — can move to OR-03, minimal impact
     - Garcia Arthroscopy (10:00) — needs full reschedule
     
     Want me to find recovery options?"
```

### 4.3 Trend Observations

Over time, the assistant notices patterns:

```
AI: "I've noticed AN-JONES has been above 85% utilization 4 of the last 
     5 schedule runs. If this continues, you may want to consider adding 
     another anesthesiologist to the rotation, or shifting 1-2 cases per 
     week to days when AN-GARCIA has capacity."
```

---

## Phase 5: Multi-Turn Workflows (adds ~3 days)

Complex scheduling decisions as guided conversations.

### 5.1 Guided Case Scheduling

```
User: "I need to schedule a new knee replacement for Mrs. Chen"
AI: "Let me find options. A few questions:
     - Priority: Urgent or Elective?
     - Preferred surgeon?
     - Any date constraints?"
User: "Elective, Dr. Patel, next week if possible"
AI: [calls where_to with constraints]
AI: "3 options next week:
     
     1. Monday 8:00 — OR-02, Dr. Patel, AN-Garcia, RN-01 ⭐
        Clean start to the week, all resources fresh
     
     2. Wednesday 14:00 — OR-01, Dr. Patel, AN-Jones, RN-02
        Afternoon slot, but adds to AN-Jones load
     
     3. Thursday 8:00 — OR-02, Dr. Patel, AN-Garcia, RN-03
        Good option but Thursday is already heavy
     
     I'd recommend Option 1 — it balances the week and avoids 
     the anesthesia bottleneck. Want to schedule it?"
```

### 5.2 Conflict Resolution Workflow

```
User: "Help me fix all the chain violations"
AI: [calls get_chain_integrity]
AI: "2 violations to fix:
     
     1. Davis Hernia — 45 min gap (Recovery bay conflict)
     2. Garcia Arthroscopy — 4 hour gap (Recovery bay + nurse conflict)
     
     Let's start with Davis since it's simpler. I can move Recovery 
     to REC-02 at 11:30. That fixes it immediately."
AI: [shows confirmation card]
User: [confirms]
AI: "Davis fixed. Now Garcia — this one's trickier. The 4-hour gap is 
     because all recovery bays are full until 13:00. Options:
     
     1. Move Garcia Procedure earlier (7:00) so Recovery starts at 8:00
        when REC-03 is free
     2. Delay Garcia to afternoon — Procedure at 13:00, Recovery at 14:00
     
     Option 1 keeps the case in the morning. Option 2 is cleaner but 
     pushes the case later. Which do you prefer?"
```

---

## Technical Architecture

### API Integration

The chat endpoint calls the Claude API with:
1. System prompt (built dynamically from schedule state)
2. Tool definitions (read-only in Phase 1, expanding through phases)
3. Conversation history
4. UI context (what tab/view the user is on)

```typescript
// In the Fastify API
fastify.post('/v1/chat/message', async (request, reply) => {
  const { message, conversationHistory, context } = request.body;
  
  const systemPrompt = buildSystemPrompt(
    tenant, landscape, analyticsCache, context
  );
  
  const tools = getToolsForPhase(currentPhase);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    tools: tools,
    messages: [
      ...conversationHistory,
      { role: 'user', content: message }
    ],
    stream: true
  });
  
  // Stream response back to frontend
  // Handle tool calls by routing to internal API endpoints
  // Return final response with any tool results
});
```

### Tool Execution

When Claude makes a tool call, the chat endpoint executes it internally (not through HTTP — direct function call to the service layer):

```typescript
async function executeToolCall(toolName: string, params: any, landscape: ILandscape) {
  switch (toolName) {
    case 'get_utilization':
      return analyticsService.getUtilization(landscape, params);
    case 'get_chain_integrity':
      return analyticsService.getChainIntegrity(landscape, params);
    case 'get_task_detail':
      return taskService.getTask(landscape, params.taskKey);
    case 'where_to':
      return slotFinder.findSlots(landscape, params.taskKey, params.maxOptions);
    // ... etc
  }
}
```

### Cost Management

Claude API calls cost money. Manage this:
- Cache the analytics summary and refresh after each solve (don't recompute per message)
- Keep conversation history trimmed (last 20 messages max)
- Use Sonnet for most interactions (fast, cheap), escalate to Opus for complex analysis
- Rate limit: max N messages per minute per tenant
- Token budget per tenant per month (tied to pricing tier)

### Security

- The assistant can only access the current tenant's data
- Action tools (Phase 3) require explicit user confirmation — never auto-execute
- Audit log: every action taken through chat is logged with the user, timestamp, and what changed
- The assistant cannot access other tenants, system config, or infrastructure

---

## Implementation Sequence

| Phase | What | Effort | Depends On |
|-------|------|--------|------------|
| **Phase 1** | Read-only Q&A — chat UI, system prompt, read-only tools | ~1 week | Analytics endpoints (done) |
| **Phase 2** | Investigation — where_to, impact analysis, what-if | ~1 week | Slot finder, CTP query endpoints |
| **Phase 3** | Actions — schedule/unschedule/reschedule with confirmation | ~1 week | Interactive scheduling (debug page) |
| **Phase 4** | Proactive — post-solve summaries, disruption alerts, trends | ~1 week | Phase 1 + webhook/event system |
| **Phase 5** | Multi-turn workflows — guided scheduling, conflict resolution | ~3 days | Phases 2 + 3 |

**Phase 1 can start now** — all the analytics endpoints it needs already exist.

---

## Pricing Implications

The AI assistant is a premium feature. Pricing model options:

- **Included in Pro tier** — limited messages per month (e.g., 500)
- **Add-on** — unlimited AI assistant for $X/month
- **Per-message** — charge per AI interaction (metered)
- **Tiered by capability** — Phase 1 (Q&A) in Standard, Phase 3 (Actions) in Pro

The assistant creates stickiness — once planners are used to asking "why is this case delayed?" in natural language, they won't go back to clicking through dashboards.

---

## Success Metrics

- **Adoption:** % of scheduling sessions where chat is used
- **Resolution rate:** % of chat sessions that result in a scheduling action
- **Time to answer:** How fast can a planner get an answer vs. clicking through the UI
- **Deflection:** Questions answered by AI that would have been support tickets
