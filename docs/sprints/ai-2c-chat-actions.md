# AI Sprint 2C: Chat Action Buttons

**What it does:** AI responses can include clickable action buttons that drive the main UI. When the AI says "CASE-004 has 3 options" it can surface a **[Show options on Gantt]** button. When it identifies a resource bottleneck it can surface **[Open AN-JONES detail]**. The planner clicks — the UI responds. Chat becomes a command interface, not just a text window.

**Size:** ~75 min CC work  
**Depends on:** AI Sprint 1 (chat panel), AI Sprint 2 (investigation tools)  
**No new backend endpoints** — wires AI output to UI state that already exists

---

## Why

Right now the AI explains things in text. The planner reads the answer then has to manually navigate to the relevant part of the UI — click the right tab, find the task, trigger WhereTo. Option B closes that gap: the AI surfaces the navigation as a button, one click away.

```
Before (Sprint 2):
  AI: "CASE-004 has 3 placement options. Best is OR-02 at 10:30 with AN-GARCIA."
  Planner: [manually right-clicks CASE-004 on Gantt → Where Can This Go?]

After (Sprint 2C):
  AI: "CASE-004 has 3 placement options. Best is OR-02 at 10:30 with AN-GARCIA."
       [📍 Show options on Gantt]  [📋 Open CASE-004]
  Planner: [clicks button → WhereTo ghost bars appear instantly]
```

---

## Part 1: Action Protocol

### 1a. Action types

Six action types covering the main UI navigation targets:

```typescript
type ChatActionType =
  | 'whereTo'        // trigger WhereTo ghost bars on Gantt for a task
  | 'openTask'       // open task detail panel
  | 'openResource'   // open resource detail panel
  | 'filterChain'    // filter Schedule tab to a specific chain/order
  | 'openTab'        // switch to a named tab
  | 'navigateOrder'; // go to Orders tab filtered to an order
```

### 1b. Action shape

```typescript
interface ChatAction {
  type: ChatActionType;
  label: string;          // button label shown to planner
  taskKey?: string;
  resourceKey?: string;
  chainKey?: string;
  orderKey?: string;
  tab?: string;
}
```

### 1c. How actions are returned from the backend

The `/api/v1/ai/chat` endpoint currently returns the raw Claude API response. Update it to parse out action tags from the text and return them as a separate array:

```typescript
// Backend: after Claude responds, parse action tags from text
function parseActionsFromText(text: string): { cleanText: string; actions: ChatAction[] } {
  const actions: ChatAction[] = [];
  const actionRegex = /<action\s+([^/]+)\/>/g;
  let match;

  while ((match = actionRegex.exec(text)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs.type) actions.push(attrs as ChatAction);
  }

  const cleanText = text.replace(actionRegex, '').trim();
  return { cleanText, actions };
}

// Return shape from /api/v1/ai/chat:
return {
  text: cleanText,       // message text with action tags stripped
  actions,               // array of ChatAction objects
};
```

### 1d. System prompt — action tag instructions

Add to the system prompt after the tools section:

```
## UI Actions

After your response text, you may emit action tags to surface relevant UI navigation 
as clickable buttons for the planner. Use them when your answer references something 
specific the planner would benefit from seeing or acting on immediately.

Available actions:

  <action type="whereTo" taskKey="C004-PROC" label="Show options on Gantt" />
  — Triggers WhereTo ghost bars for the task. Use after answering "where can X go?"

  <action type="openTask" taskKey="C004-PROC" label="Open CASE-004 detail" />
  — Opens the task detail panel. Use when discussing a specific task's details.

  <action type="openResource" resourceKey="AN-JONES" label="View AN-JONES schedule" />
  — Opens the resource detail panel. Use when discussing a specific resource.

  <action type="filterChain" chainKey="CASE-004" label="Show CASE-004 on Schedule" />
  — Filters the Schedule tab to show only this chain. Use for chain-level questions.

  <action type="openTab" tab="Analytics" label="Go to Analytics" />
  — Switches to a tab. Valid tabs: Overview, Schedule, Orders, Conflicts, Materials, Analytics

  <action type="navigateOrder" orderKey="WO-1004" label="View WO-1004 in Orders" />
  — Goes to the Orders tab filtered to this order.

Rules:
- Emit at most 2-3 actions per response — don't overwhelm with buttons
- Only emit actions directly relevant to what you just explained
- Always include a clear, short label (max 5 words)
- Never emit actions for hypothetical or speculative scenarios
- Place action tags at the very end of your response text
```

---

## Part 2: Frontend — Action Button Renderer

### 2a. ChatMessage type update

The existing `ChatMessage` type gains an `actions` field:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
  toolCallInProgress?: string;
  actions?: ChatAction[];   // ← new
}
```

### 2b. Action button component

Add inside the chat panel component:

```typescript
function ChatActionButtons({
  actions,
  onAction,
}: {
  actions: ChatAction[];
  onAction: (action: ChatAction) => void;
}) {
  if (!actions || actions.length === 0) return null;

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      marginTop: 8, paddingTop: 8,
      borderTop: `1px solid ${C.border}`,
    }}>
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => onAction(action)}
          style={{
            padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${C.accent}44`,
            background: `${C.accent}12`,
            color: C.accent, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', gap: 4,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = `${C.accent}22`)}
          onMouseLeave={e => (e.currentTarget.style.background = `${C.accent}12`)}
        >
          {actionIcon(action.type)} {action.label}
        </button>
      ))}
    </div>
  );
}

function actionIcon(type: ChatActionType): string {
  switch (type) {
    case 'whereTo':        return '📍';
    case 'openTask':       return '📋';
    case 'openResource':   return '👤';
    case 'filterChain':    return '🔗';
    case 'openTab':        return '→';
    case 'navigateOrder':  return '📦';
    default:               return '→';
  }
}
```

### 2c. Wire into chat message render

In the assistant message render block, add the action buttons below the message text:

```typescript
{message.role === 'assistant' && !message.loading && (
  <>
    <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text }}>
      {renderMarkdown(message.content)}
    </div>
    {message.actions && message.actions.length > 0 && (
      <ChatActionButtons
        actions={message.actions}
        onAction={onChatAction}
      />
    )}
  </>
)}
```

### 2d. Receive actions from API response

When the AI responds, store actions on the message:

```typescript
// In sendMessage, after getting the response:
const { text, actions } = await callAnthropicAPI(systemPrompt, messages, tools);

setMessages(prev => prev.map(m =>
  m.id === loadingMsg.id
    ? { ...m, content: text, loading: false, actions: actions || [] }
    : m
));
```

---

## Part 3: Action Dispatcher in App

### 3a. handleChatAction callback

Add to `App.tsx` alongside the other handlers (after `handleMoveTo`):

```typescript
const handleChatAction = useCallback((action: ChatAction) => {
  switch (action.type) {

    case 'whereTo':
      // Switch to Schedule tab and trigger WhereTo ghost bars
      setActiveTab('Schedule');
      if (action.taskKey) handleWhereTo(action.taskKey, 'table');
      break;

    case 'openTask':
      // Open task detail panel
      if (action.taskKey) {
        const task = tasks.find((t: any) => t.key === action.taskKey);
        if (task) {
          setSelectedResource(null);
          setSelectedTask(task);
        }
      }
      break;

    case 'openResource':
      // Open resource detail panel
      if (action.resourceKey) {
        const resource = resources.find((r: any) => r.resourceKey === action.resourceKey);
        if (resource) {
          setSelectedTask(null);
          setSelectedResource(resource);
        }
      }
      break;

    case 'filterChain':
      // Filter Schedule tab to this chain
      if (action.chainKey) {
        setScheduleCaseFilter(action.chainKey);
        setActiveTab('Schedule');
      }
      break;

    case 'openTab':
      // Switch to a named tab
      if (action.tab) {
        setActiveTab(action.tab);
        // Clean up state when leaving Schedule
        if (action.tab !== 'Schedule') {
          setWhereToTaskKey(null);
          setWhereToOptions([]);
          setWhereToCurrentAssignment(null);
          setScheduleCaseFilter(null);
        }
        if (action.tab !== 'Orders') {
          setOrdersCaseFilter(null);
        }
      }
      break;

    case 'navigateOrder':
      // Go to Orders tab filtered to this order
      if (action.orderKey) {
        setOrdersCaseFilter(action.orderKey);
        setActiveTab('Orders');
      }
      break;
  }
}, [tasks, resources, handleWhereTo,
    setActiveTab, setSelectedTask, setSelectedResource,
    setScheduleCaseFilter, setOrdersCaseFilter,
    setWhereToTaskKey, setWhereToOptions, setWhereToCurrentAssignment]);
```

### 3b. Pass handler down to chat panel

In the App render, pass `handleChatAction` to the chat panel component:

```typescript
<AIChatPanel
  solveResult={solveResult}
  onChatAction={handleChatAction}   // ← new prop
  // ... existing props
/>
```

And in the chat panel props type:

```typescript
interface AIChatPanelProps {
  solveResult: any;
  onChatAction: (action: ChatAction) => void;   // ← new
  // ... existing props
}
```

---

## Part 4: Example Interactions

### WhereTo triggered from chat
```
Planner: "Where can CASE-004 go?"

AI: [calls where_can_task_go]

    CASE-004 has 3 options. Best is OR-02 at 10:30 AM with Dr. Smith 
    and AN-GARCIA — earliest slot, score 2.3.

    [📍 Show options on Gantt]  [📋 Open CASE-004 detail]

→ Planner clicks "Show options on Gantt"
→ App switches to Schedule tab, WhereTo ghost bars appear on Gantt
```

### Resource bottleneck investigation
```
Planner: "Why is Monday morning tight?"

AI: [calls get_resource_agenda for AN-JONES, AN-GARCIA]

    Anesthesiologist coverage is the bottleneck. AN-JONES is fully 
    booked 7–10:30 AM. AN-GARCIA doesn't start until 10 AM.

    [👤 View AN-JONES schedule]  [👤 View AN-GARCIA schedule]

→ Planner clicks "View AN-JONES schedule"
→ ResourceDetailPanel slides open showing AN-JONES's day
```

### Chain navigation
```
Planner: "Show me CASE-001 on the schedule"

AI: CASE-001 (Hip Replacement) is scheduled Mon 8:00–10:30 AM 
    in OR-01 with Dr. Smith and AN-JONES.

    [🔗 Show CASE-001 on Schedule]

→ Planner clicks button
→ Schedule tab activates, filtered to CASE-001 chain
```

### Order navigation
```
Planner: "How is WO-1004 doing?"

AI: [answers from context]

    WO-1004 is 100% filled — all 4 tasks scheduled by Wednesday. 
    Due date met with 1 day to spare.

    [📦 View WO-1004 in Orders]

→ Planner clicks button
→ Orders tab opens filtered to WO-1004
```

---

## Part 5: Verification

**Action protocol:**
- [ ] Backend parses `<action ... />` tags from Claude response text
- [ ] Action tags stripped from displayed text (not shown to user)
- [ ] Actions returned as separate array in API response
- [ ] Invalid/malformed action tags ignored gracefully

**Action buttons UI:**
- [ ] Buttons appear below AI message text, separated by a subtle divider
- [ ] Correct icon per action type
- [ ] Hover state on buttons
- [ ] Max 3 buttons renders cleanly
- [ ] No buttons shown when `actions` array is empty

**Action dispatch — each type:**
- [ ] `whereTo` → switches to Schedule tab + triggers WhereTo ghost bars
- [ ] `openTask` → opens TaskDetailPanel for the task
- [ ] `openResource` → opens ResourceDetailPanel for the resource
- [ ] `filterChain` → switches to Schedule tab + applies chain filter
- [ ] `openTab` → switches to correct tab + cleans up stale state
- [ ] `navigateOrder` → switches to Orders tab + applies order filter

**AI behavior:**
- [ ] AI emits `whereTo` action after answering "where can X go?"
- [ ] AI emits `openResource` after bottleneck analysis naming a specific resource
- [ ] AI emits at most 2-3 actions per response
- [ ] AI does NOT emit actions for hypothetical scenarios
- [ ] Existing Sprint 2 tool behavior unaffected

**Cross-tenant:**
- [ ] Works for HRMD (fields, games, chains)
- [ ] Works for Healthcare (ORs, cases, chains)
- [ ] Works for Manufacturing (machines, work orders)

---

## Size Estimate

- Action protocol + backend parsing: ~15 min
- System prompt additions: ~10 min
- `ChatActionButtons` component: ~15 min
- Wire actions into message state: ~10 min
- `handleChatAction` dispatcher in App: ~15 min
- Pass prop + connect to chat panel: ~5 min
- Testing: ~5 min
- **Total: ~75 min**
