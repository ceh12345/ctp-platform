# AI Sprint 1: Scheduling Assistant — Read-Only Q&A

**What it does:** An AI-powered chat panel embedded in the scheduling app. The assistant understands the current schedule state — tasks, resources, chains, conflicts, utilization — and answers planner questions in natural language. Read-only: it reads data but doesn't modify the schedule.

**Size:** ~2-3 hours CC work  
**Depends on:** Solve response data (already complete)  
**No new API endpoints** — the assistant reads from the solve response already in the frontend

---

## Why

Planners look at a schedule with 30+ tasks, 10+ resources, chains, conflicts, and utilization numbers. Finding answers means clicking through tabs, expanding panels, cross-referencing. The AI assistant lets them just ask:

```
"Why is CASE-004 infeasible?"
"What's blocking Monday morning?"
"Which OR has the most availability?"
"Show me all urgent cases and their status"
"Why did CASE-001 end up on Tuesday instead of Monday?"
```

The assistant knows everything the planner can see — because it has the same solve response data.

---

## Part 1: Chat Panel UI

### 1a. Panel layout

Collapsible side panel on the right side of the app. The planner sees both the schedule and the chat simultaneously.

```
┌─────────────────────────────────────┬──────────────────────────┐
│                                     │ 🤖 Scheduling Assistant   │
│         Schedule / Gantt            │                          │
│                                     │ ▸ Why is CASE-004        │
│                                     │   infeasible?            │
│                                     │                          │
│                                     │ CASE-004 can't schedule  │
│                                     │ because the anesthe-     │
│                                     │ siologist is the bottle- │
│                                     │ neck. AN-JONES is booked │
│                                     │ 7:00-10:30 by CASE-002   │
│                                     │ and CASE-001...          │
│                                     │                          │
│                                     │ ▸ Which OR has the most  │
│                                     │   free time?             │
│                                     │                          │
│                                     │ ┌──────────────────────┐ │
│                                     │ │ Ask about the        │ │
│                                     │ │ schedule...      ↵   │ │
│                                     │ └──────────────────────┘ │
└─────────────────────────────────────┴──────────────────────────┘
```

### 1b. Toggle button

Add a chat toggle button to the app header, next to the settings/experience level controls:

```typescript
<button onClick={() => setChatOpen(!chatOpen)} title="Scheduling Assistant">
  🤖
</button>
```

When open, the main content area shrinks to accommodate the chat panel (~320px width).

### 1c. Chat state

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  loading?: boolean;        // true while waiting for AI response
}

interface ChatState {
  open: boolean;
  messages: ChatMessage[];
  inputValue: string;
  loading: boolean;
}
```

### 1d. Message display

```typescript
function ChatPanel({ solveResult, open, onClose }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'I can help you understand the current schedule. Ask me about tasks, resources, conflicts, or utilization.',
      timestamp: Date.now(),
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ... rest of component
}
```

### 1e. Message bubbles

```typescript
function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '8px 12px',
        borderRadius: 12,
        fontSize: 12,
        lineHeight: 1.5,
        background: isUser ? '#2196f3' : C.bg2,
        color: isUser ? '#fff' : C.text,
        whiteSpace: 'pre-wrap',
      }}>
        {message.loading ? (
          <span style={{ opacity: 0.6 }}>Thinking...</span>
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}
```

### 1f. Input area

```typescript
<div style={{
  padding: 12, borderTop: `1px solid ${C.border}`,
  display: 'flex', gap: 8,
}}>
  <input
    value={input}
    onChange={e => setInput(e.target.value)}
    onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSend(); }}
    placeholder="Ask about the schedule..."
    disabled={loading}
    style={{
      flex: 1, padding: '8px 12px', borderRadius: 8,
      border: `1px solid ${C.border}`, fontSize: 12,
      background: C.bg, color: C.text,
    }}
  />
  <button
    onClick={handleSend}
    disabled={loading || !input.trim()}
    style={{
      padding: '8px 12px', borderRadius: 8, border: 'none',
      background: '#2196f3', color: '#fff', fontSize: 12,
      cursor: loading ? 'wait' : 'pointer',
      opacity: loading || !input.trim() ? 0.5 : 1,
    }}
  >
    Send
  </button>
</div>
```

---

## Part 2: System Prompt — Schedule Context

The AI needs to understand the current schedule. Build a system prompt from the solve response data.

### 2a. System prompt builder

```typescript
function buildSystemPrompt(solveResult: CTPSolveResult): string {
  const { summary, tasks, resourceUtilization, orders, terminology } = solveResult;

  // Use tenant terminology
  const t = (key: string, fallback: string) => terminology?.[key] || fallback;

  let prompt = `You are a scheduling assistant for a ${t('applicationName', 'scheduling')} application. 
You help planners understand the current schedule, investigate conflicts, and identify opportunities.

Answer concisely. Use specific task names, resource names, and times. 
Format times in the tenant's local timezone.
When citing data, reference the specific task or resource by name.
If you don't have enough information to answer, say so.

## Current Schedule Summary
- Total ${t('task', 'task')}s: ${summary.includedTasks}
- Scheduled: ${summary.scheduledTasks}
- Infeasible: ${summary.unscheduledTasks}
- Feasibility rate: ${summary.feasibilityRate}%
- Horizon: ${summary.horizonStart} to ${summary.horizonEnd}
`;

  // Add infeasible tasks with bottleneck details
  const infeasible = tasks.filter(t => !t.feasible && t.errors?.length > 0);
  if (infeasible.length > 0) {
    prompt += `\n## Infeasible ${t('task', 'Task')}s\n`;
    for (const task of infeasible) {
      prompt += `- ${task.key} (${task.name})`;
      if (task.infeasibilityReport) {
        prompt += ` — [${task.infeasibilityReport.conflictType}] ${task.infeasibilityReport.reason}`;
        const bottleneck = task.infeasibilityReport.slots?.find(s => s.isBottleneck);
        if (bottleneck) {
          prompt += `\n  Bottleneck: ${bottleneck.slotLabel}`;
          for (const res of bottleneck.resources) {
            prompt += `\n    ${res.resourceName}: ${res.status}`;
            if (res.availableMinutes !== undefined) prompt += ` (${(res.availableMinutes / 60).toFixed(1)}h free)`;
            if (res.note) prompt += ` — ${res.note}`;
            for (const bt of (res.blockingTasks || [])) {
              prompt += `\n      → blocked by ${bt.taskName}${bt.chainKey ? ` (${bt.chainKey})` : ''} ${bt.start}–${bt.end}`;
            }
          }
        }
      } else {
        for (const err of (task.errors || [])) {
          prompt += `\n  Error: ${err.reason}`;
        }
      }
      prompt += '\n';
    }
  }

  // Add scheduled tasks (summarized)
  const scheduled = tasks.filter(t => t.feasible);
  if (scheduled.length > 0) {
    prompt += `\n## Scheduled ${t('task', 'Task')}s\n`;
    for (const task of scheduled) {
      const resources = (task.assignedResources || [])
        .map(r => r.resourceName || r.resourceKey)
        .join(', ');
      prompt += `- ${task.key} (${task.name}): ${task.scheduledStart}–${task.scheduledEnd} on ${resources}`;
      if (task.orderRef) prompt += ` [${t('order', 'Order')}: ${task.orderRef}]`;
      if (task.processCategory) prompt += ` [${task.processCategory}]`;
      prompt += '\n';
    }
  }

  // Add resource utilization
  if (resourceUtilization?.length > 0) {
    prompt += `\n## Resource Utilization\n`;
    for (const res of resourceUtilization) {
      prompt += `- ${res.resourceName} (${res.resourceKey}): ${res.utilization}% utilized`;
      if (res.workCenter) prompt += ` [${res.workCenter}]`;
      const freeHours = ((res.totalAvailable - res.totalAssigned) / 3600).toFixed(1);
      prompt += ` — ${freeHours}h free`;
      prompt += '\n';
    }
  }

  // Add orders
  if (orders?.length > 0) {
    prompt += `\n## ${t('order', 'Order')}s\n`;
    for (const order of orders) {
      prompt += `- ${order.orderKey} (${order.name}): ${order.scheduledQty}/${order.demandQty} filled`;
      prompt += ` — ${(order.fillRate * 100).toFixed(0)}% fill rate`;
      if (order.dueDate) prompt += ` — due ${order.dueDate}`;
      prompt += ` — priority ${order.priority}`;
      prompt += '\n';
    }
  }

  // Add chain integrity (from analytics if available)
  const chains = tasks.filter(t => t.orderRef).reduce((acc, t) => {
    if (!acc.has(t.orderRef)) acc.set(t.orderRef, []);
    acc.get(t.orderRef).push(t);
    return acc;
  }, new Map());

  if (chains.size > 0) {
    prompt += `\n## Chain Integrity\n`;
    for (const [chainKey, chainTasks] of chains) {
      const sorted = chainTasks.sort((a, b) => 
        (a.scheduledStart || '').localeCompare(b.scheduledStart || '')
      );
      const allScheduled = sorted.every(t => t.feasible);
      prompt += `- ${chainKey}: ${sorted.length} phases, ${allScheduled ? 'all scheduled' : 'has infeasible phases'}\n`;
      
      // Check gaps
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].scheduledStart && sorted[i-1].scheduledEnd) {
          const gap = (new Date(sorted[i].scheduledStart).getTime() - new Date(sorted[i-1].scheduledEnd).getTime()) / 60000;
          if (gap > 0) {
            prompt += `  Gap: ${sorted[i-1].key} → ${sorted[i].key}: ${gap.toFixed(0)} min\n`;
          }
        }
      }
    }
  }

  // Solve stats
  if (solveResult.stats) {
    prompt += `\n## Solve Statistics\n`;
    prompt += `- Strategy: ${solveResult.stats.strategy}\n`;
    prompt += `- Solve time: ${solveResult.stats.totalTimeMs}ms\n`;
    if (solveResult.stats.contextsEvaluated) prompt += `- Contexts evaluated: ${solveResult.stats.contextsEvaluated}\n`;
  }

  return prompt;
}
```

### 2b. Token management

The system prompt could be large for big tenants. Manage it:

```typescript
function buildSystemPrompt(solveResult, maxTokens = 3000) {
  let prompt = buildFullPrompt(solveResult);
  
  // If too large, progressively trim
  const estimatedTokens = prompt.length / 4;  // rough estimate
  
  if (estimatedTokens > maxTokens) {
    // Priority: keep infeasible tasks + bottlenecks + utilization
    // Trim: scheduled task details (just count them)
    // Last resort: trim resource utilization to top/bottom 5
    prompt = buildTrimmedPrompt(solveResult, maxTokens);
  }
  
  return prompt;
}
```

---

## Part 3: Anthropic API Integration

### 3a. API call

The frontend calls the Anthropic API directly. The API key is handled by the existing proxy (no key in client code).

```typescript
async function sendMessage(
  userMessage: string,
  conversationHistory: ChatMessage[],
  solveResult: CTPSolveResult,
): Promise<string> {
  
  const systemPrompt = buildSystemPrompt(solveResult);
  
  // Build message history (keep last 20 messages)
  const messages = conversationHistory
    .slice(-20)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
  
  // Add new user message
  messages.push({ role: 'user', content: userMessage });
  
  const response = await fetch('/api/v1/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  
  const data = await response.json();
  
  // Extract text from response
  const text = data.content
    ?.filter(item => item.type === 'text')
    ?.map(item => item.text)
    ?.join('\n') || 'I couldn\'t generate a response.';
  
  return text;
}
```

### 3b. Backend proxy endpoint

Add a thin proxy endpoint that forwards to the Anthropic API. This avoids exposing the API key to the client:

```typescript
// In ctp_controller.ts or a new ai_controller.ts

@Post('ai/chat')
async chat(@Body() body: any) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: body.model || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1000,
      system: body.system,
      messages: body.messages,
    }),
  });
  
  return response.json();
}
```

**Alternatively:** If the frontend already has the Anthropic API artifact capability (from the Claude-in-Claude setup), you can skip the proxy and call the API directly from the React component. Check if this is available.

### 3c. Handle send in the chat panel

```typescript
const handleSend = useCallback(async () => {
  if (!input.trim() || loading) return;
  
  const userMsg: ChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: input.trim(),
    timestamp: Date.now(),
  };
  
  const loadingMsg: ChatMessage = {
    id: `loading-${Date.now()}`,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    loading: true,
  };
  
  setMessages(prev => [...prev, userMsg, loadingMsg]);
  setInput('');
  setLoading(true);
  
  try {
    const response = await sendMessage(input.trim(), messages, solveResult);
    
    setMessages(prev => prev.map(m => 
      m.id === loadingMsg.id
        ? { ...m, content: response, loading: false }
        : m
    ));
  } catch (err) {
    setMessages(prev => prev.map(m => 
      m.id === loadingMsg.id
        ? { ...m, content: 'Sorry, I encountered an error. Please try again.', loading: false }
        : m
    ));
  } finally {
    setLoading(false);
  }
}, [input, loading, messages, solveResult]);
```

---

## Part 4: Suggested Questions

Show starter questions when the chat is empty or after a solve, based on the current state:

### 4a. Generate suggestions from solve result

```typescript
function getSuggestedQuestions(solveResult: CTPSolveResult): string[] {
  const suggestions: string[] = [];
  const { summary, tasks } = solveResult;
  
  // Always show a general overview question
  suggestions.push('Give me a summary of the current schedule');
  
  // If there are infeasible tasks
  const infeasible = tasks.filter(t => !t.feasible && t.errors?.length > 0);
  if (infeasible.length > 0) {
    suggestions.push(`Why ${infeasible.length === 1 ? 'is' : 'are'} ${infeasible.length} task${infeasible.length > 1 ? 's' : ''} infeasible?`);
    
    // Specific infeasible task
    if (infeasible[0]?.infeasibilityReport?.bottleneckSlot) {
      suggestions.push(`Tell me about the ${infeasible[0].infeasibilityReport.bottleneckSlot} bottleneck`);
    }
  }
  
  // If feasibility is less than 100%
  if (summary.feasibilityRate < 100) {
    suggestions.push('What would it take to get to 100% feasibility?');
  }
  
  // Utilization questions
  suggestions.push('Which resource has the most availability?');
  
  // If there are chains
  const hasChains = tasks.some(t => t.orderRef);
  if (hasChains) {
    suggestions.push('Are there any chain gap violations?');
  }
  
  // Limit to 4 suggestions
  return suggestions.slice(0, 4);
}
```

### 4b. Display suggestions

```typescript
{messages.length <= 1 && (
  <div style={{ padding: '8px 12px' }}>
    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>
      Try asking:
    </div>
    {getSuggestedQuestions(solveResult).map((q, i) => (
      <button
        key={i}
        onClick={() => { setInput(q); }}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '6px 10px', marginBottom: 4, borderRadius: 8,
          border: `1px solid ${C.border}`, background: 'transparent',
          fontSize: 11, color: C.accent, cursor: 'pointer',
        }}
      >
        {q}
      </button>
    ))}
  </div>
)}
```

---

## Part 5: Context-Aware Refinements

### 5a. Refresh context after re-solve

When the planner solves again, the system prompt needs to update:

```typescript
// Watch for solve result changes
useEffect(() => {
  if (solveResult && messages.length > 1) {
    // Add a system message noting the schedule has changed
    setMessages(prev => [...prev, {
      id: `system-${Date.now()}`,
      role: 'assistant',
      content: '📋 The schedule has been updated. I now have the latest data.',
      timestamp: Date.now(),
    }]);
  }
}, [solveResult?.stats?.totalTimeMs]);  // trigger on new solve
```

### 5b. Clear chat

Add a "Clear chat" button in the panel header:

```typescript
<button onClick={() => setMessages([welcomeMessage])} title="Clear chat">
  🗑️
</button>
```

### 5c. Selected task context

If the planner has a task selected (clicked in the table or Gantt), mention it in the system prompt as "currently selected" so the AI can reference it:

```typescript
if (selectedTask) {
  systemPrompt += `\n## Currently Selected Task\n`;
  systemPrompt += `The planner is currently looking at: ${selectedTask.name} (${selectedTask.key})\n`;
  // Add full detail for this task
}
```

This enables questions like "What's blocking this?" without specifying which task.

---

## Part 6: Verification

- [ ] Chat panel opens/closes with toggle button
- [ ] Welcome message shown on first open
- [ ] User can type and send messages
- [ ] AI responds with schedule-aware answers
- [ ] "Why is CASE-004 infeasible?" → mentions anesthesiologist bottleneck with specific blockers
- [ ] "What's the utilization on OR-01?" → returns correct percentage and free hours
- [ ] "Which cases are urgent?" → lists urgent cases with status
- [ ] "Give me a summary" → overall schedule health
- [ ] Suggested questions appear when chat is empty
- [ ] Suggested questions are relevant to current state (infeasible tasks → asks about them)
- [ ] Clicking a suggestion populates the input
- [ ] Conversation history maintained across messages (multi-turn)
- [ ] Loading state shows "Thinking..." while waiting
- [ ] Error handling if API fails
- [ ] Context refreshes after re-solve
- [ ] Selected task context included in prompt
- [ ] Chat panel doesn't block the main schedule view
- [ ] Works for all three tenants (terminology adapts)
- [ ] Message history limited to 20 messages

---

## Size Estimate

- Chat panel UI component (~30 min)
- System prompt builder (~30 min)
- API proxy endpoint (~15 min)
- Send/receive message handling (~20 min)
- Suggested questions (~15 min)
- Context refresh + selected task (~15 min)
- Testing across tenants (~15 min)
- Total: ~2-2.5 hours CC work

---

## Future Phases (not this sprint)

| Phase | What | Depends On |
|-------|------|------------|
| AI-2 | Investigation tools — WhereTo through chat, impact analysis | WhereTo API |
| AI-3 | Actions with confirmation — schedule/unschedule through chat | Action APIs |
| AI-4 | Proactive insights — post-solve summary, anomaly alerts | This sprint |
| AI-5 | Multi-turn workflows — guided conflict resolution | AI-2 + AI-3 |
