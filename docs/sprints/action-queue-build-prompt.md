# UI Action Queue — CC Build Prompt

**What you're building:** A staging area where the planner builds a sequence of scheduling actions, reviews them, and executes them as a single atomic operation. Shift+click queues instead of executing. A collapsible panel shows the queued steps. "Execute All" sends the batch to `POST /ctp/execute` which reuses the existing command sequencer from AI Sprint 3. Rollback on failure, ripple report on success.

**Estimated time:** ~3 hours across 5 parts
**Depends on:** `POST /ctp/apply-recommendation` (AI Sprint 3, done), existing toolbar actions (unschedule, pin, priority, redirect, solve)

**Key context:**
- The command sequencer already exists in `ctp_service.ts` — `applyRecommendation()` accepts an array of `RecommendationCommand` objects, executes them in order, rolls back on failure, and returns ripple effects
- The `RecommendationCommand` type supports: `move_to`, `set_window`, `unschedule`, `solve`, `set_priority`, `set_resource_preference`, `set_order_mode`, `pin`
- The UI already has toolbar action handlers: `handleApiUnschedule`, `handleApiPin`, `handleApplyPreferences`, `handleSolveConfirm`, etc.
- App.tsx is a single-file React app (~7500 lines) with all components inline

---

## Part 1: Backend — `POST /ctp/execute`

A thin wrapper around the existing command sequencer. No staleness check, no recommendation ID required.

### DTO

Add to `src/ctp/dto/diagnose.dto.ts` (where RecommendationCommand already lives):

```typescript
export class ExecuteCommandsRequestDto {
  /** Ordered list of commands to execute */
  commands: RecommendationCommand[];

  /** Optional name for logging/audit */
  name?: string;

  /** Detail level for the returned state */
  detailLevel?: 'novice' | 'intermediate' | 'expert';
}
```

### Controller

Add to `ctp_controller.ts`:

```typescript
@Post('execute')
@ApiOperation({
  summary: 'Execute a command sequence against the live landscape',
  description: 'Runs an ordered list of commands atomically. Rolls back on failure. Returns updated state and ripple effects. Same sequencer as apply-recommendation but without staleness check.',
})
@ApiBody({ type: ExecuteCommandsRequestDto })
@ApiResponse({ status: 200, description: 'Commands executed' })
execute(@Body() body: ExecuteCommandsRequestDto) {
  return this.ctpService.executeCommands(body);
}
```

### Service

Add to `ctp_service.ts`:

```typescript
executeCommands(request: ExecuteCommandsRequestDto): ApplyRecommendationResponseDto {
  const landscape = this.ensureLandscape();

  // Reuse the apply sequencer — auto-populate landscapeHash to skip staleness check
  return this.applyRecommendation({
    recommendationId: request.name || 'manual',
    commands: request.commands,
    landscapeHash: this.computeLandscapeHash(landscape),
    detailLevel: request.detailLevel,
  });
}
```

That's it for the backend — ~15 minutes.

---

## Part 2: Queue State and Panel Component

### State — add to App.tsx top-level state

```typescript
// ─── Action Queue State ───
const [actionQueue, setActionQueue] = useState<QueuedAction[]>([]);
const [queueMode, setQueueMode] = useState(false);  // toggle for sustained queuing
const [queueExecuting, setQueueExecuting] = useState(false);
const [queueResult, setQueueResult] = useState<any>(null);  // last execution result

interface QueuedAction {
  id: string;
  label: string;
  command: RecommendationCommand;
}
```

Helper to add an action to the queue:

```typescript
const addToQueue = useCallback((label: string, command: RecommendationCommand) => {
  setActionQueue(prev => [
    ...prev,
    { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label, command },
  ]);
}, []);

const removeFromQueue = useCallback((id: string) => {
  setActionQueue(prev => prev.filter(a => a.id !== id));
}, []);

const clearQueue = useCallback(() => {
  setActionQueue([]);
  setQueueResult(null);
}, []);

const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
  setActionQueue(prev => {
    const updated = [...prev];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    return updated;
  });
}, []);
```

### Execute handler

```typescript
const executeQueue = useCallback(async () => {
  if (actionQueue.length === 0) return;
  setQueueExecuting(true);
  setQueueResult(null);

  try {
    const commands = actionQueue.map(a => a.command);
    const result = await api('/ctp/execute', {
      method: 'POST',
      body: JSON.stringify({
        commands,
        name: `queue-${actionQueue.length}-actions`,
        detailLevel: experienceLevel,
      }),
    });

    setQueueResult(result);

    if (result.success) {
      // Refresh schedule state
      const updated = await api('/ctp/state?detailLevel=' + experienceLevel);
      setSolveResult(updated);
      // Clear queue on success
      setTimeout(() => {
        setActionQueue([]);
        setQueueResult(null);
      }, 3000);
    }
  } catch (err: any) {
    setQueueResult({ success: false, reason: err.message });
  } finally {
    setQueueExecuting(false);
  }
}, [actionQueue, experienceLevel]);
```

### ActionQueuePanel component

A collapsible panel docked at the bottom of the Schedule tab area. Hidden when queue is empty.

```typescript
function ActionQueuePanel({
  queue,
  executing,
  result,
  onRemove,
  onReorder,
  onClear,
  onExecute,
}: {
  queue: QueuedAction[];
  executing: boolean;
  result: any;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onClear: () => void;
  onExecute: () => void;
}) {
  if (queue.length === 0 && !result) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 28,  // above footer
      left: 0,
      right: 0,
      background: C.surface,
      borderTop: `2px solid ${C.accent}`,
      padding: '8px 16px',
      zIndex: 100,
      boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
          ACTION QUEUE ({queue.length} step{queue.length !== 1 ? 's' : ''})
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClear}
            disabled={executing}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 6,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.textMuted, cursor: 'pointer',
            }}
          >
            Clear All
          </button>
          <button
            onClick={onExecute}
            disabled={executing || queue.length === 0}
            style={{
              fontSize: 11, padding: '3px 14px', borderRadius: 6, fontWeight: 700,
              background: executing ? C.surface2 : C.accent,
              border: 'none',
              color: executing ? C.textMuted : '#fff',
              cursor: executing ? 'default' : 'pointer',
            }}
          >
            {executing ? '⏳ Executing...' : `▶ Execute All (${queue.length})`}
          </button>
        </div>
      </div>

      {/* Queue items */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {queue.map((action, index) => (
          <div
            key={action.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 8px', borderRadius: 6,
              background: C.surface2, border: `1px solid ${C.border}`,
              fontSize: 11, color: C.text,
            }}
          >
            <span style={{ color: C.textDim, fontWeight: 600 }}>{index + 1}.</span>
            <span>{action.label}</span>
            <button
              onClick={() => onRemove(action.id)}
              disabled={executing}
              style={{
                background: 'none', border: 'none', color: C.textDim,
                cursor: 'pointer', padding: '0 2px', fontSize: 11,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Result banner */}
      {result && (
        <div style={{
          marginTop: 6, padding: '4px 8px', borderRadius: 6, fontSize: 11,
          background: result.success ? C.greenDim : C.redDim,
          color: result.success ? C.green : C.red,
        }}>
          {result.success
            ? `✓ ${result.actionsApplied?.length || 0} actions applied. ${result.rippleEffects?.length || 0} tasks affected.`
            : `✕ ${result.rolledBack ? 'Rolled back: ' : ''}${result.reason || 'Execution failed'}`
          }
        </div>
      )}
    </div>
  );
}
```

Render it in the App component, at the bottom of the schedule area:

```typescript
{/* Action Queue Panel — above footer */}
<ActionQueuePanel
  queue={actionQueue}
  executing={queueExecuting}
  result={queueResult}
  onRemove={removeFromQueue}
  onReorder={reorderQueue}
  onClear={clearQueue}
  onExecute={executeQueue}
/>
```

---

## Part 3: Shift+Click Queue Interception

The key behavior: when the planner holds Shift (or has Queue Mode toggled on) and clicks a toolbar action, it queues instead of executing.

### Queue Mode toggle in toolbar

Add a toggle next to the existing toolbar buttons:

```typescript
{/* Queue Mode Toggle — in the selection toolbar area */}
<button
  onClick={() => setQueueMode(m => !m)}
  style={{
    fontSize: 11, padding: '3px 10px', borderRadius: 6,
    background: queueMode ? C.accent + '20' : 'transparent',
    border: `1px solid ${queueMode ? C.accent : C.border}`,
    color: queueMode ? C.accent : C.textMuted,
    cursor: 'pointer', fontWeight: queueMode ? 700 : 400,
  }}
  title="Toggle queue mode — actions are staged instead of executed immediately"
>
  {queueMode ? '📋 Queuing' : '▶ Immediate'}
</button>
```

### Intercept existing action handlers

The pattern: check if Shift is held or queue mode is on. If so, build a command and add to queue instead of calling the API.

Wrap each handler. For example, the unschedule handler:

```typescript
// Current pattern (somewhere in App.tsx):
// handleApiUnschedule(taskKeys) → calls API → refreshes state

// New pattern:
const handleApiUnschedule = useCallback(async (taskKeys: string[], event?: React.MouseEvent) => {
  const shouldQueue = queueMode || event?.shiftKey;

  if (shouldQueue) {
    for (const key of taskKeys) {
      addToQueue(
        `Unschedule ${tasks.find(t => t.key === key)?.name || key}`,
        { type: 'unschedule', taskKey: key },
      );
    }
    return;
  }

  // Original immediate execution logic...
  // (existing code unchanged)
}, [queueMode, addToQueue, tasks, /* existing deps */]);
```

Apply the same pattern to each toolbar action:

#### Pin

```typescript
const handleApiPin = useCallback(async (taskKeys: string[], pinned: boolean, event?: React.MouseEvent) => {
  const shouldQueue = queueMode || event?.shiftKey;

  if (shouldQueue) {
    for (const key of taskKeys) {
      addToQueue(
        `${pinned ? 'Pin' : 'Unpin'} ${tasks.find(t => t.key === key)?.name || key}`,
        { type: 'pin', taskKey: key, pinned },
      );
    }
    return;
  }

  // Original logic...
}, [queueMode, addToQueue, tasks]);
```

#### Set Priority

```typescript
const handleSetPriority = useCallback(async (taskKeys: string[], priority: number, event?: React.MouseEvent) => {
  const shouldQueue = queueMode || event?.shiftKey;

  if (shouldQueue) {
    for (const key of taskKeys) {
      addToQueue(
        `Set priority ${priority} on ${tasks.find(t => t.key === key)?.name || key}`,
        { type: 'set_priority', taskKey: key, priority },
      );
    }
    return;
  }

  // Original logic...
}, [queueMode, addToQueue, tasks]);
```

#### Resource Preference

```typescript
// In the ResourcePreferenceDialog's apply handler:
const handleApplyPreferences = useCallback(async (overrides: Record<string, Record<string, string>>, event?: React.MouseEvent) => {
  const shouldQueue = queueMode || event?.shiftKey;

  if (shouldQueue) {
    // Convert preference overrides to commands
    for (const [taskKey, resources] of Object.entries(overrides)) {
      for (const [resourceKey, mode] of Object.entries(resources)) {
        if (mode !== 'AVAILABLE') {  // only queue non-default modes
          addToQueue(
            `Set ${resourceKey} → ${mode} on ${tasks.find(t => t.key === taskKey)?.name || taskKey}`,
            { type: 'set_resource_preference', taskKey, resourceKey, mode },
          );
        }
      }
    }
    return;
  }

  // Original logic...
}, [queueMode, addToQueue, tasks]);
```

#### Solve

```typescript
const handleSolveConfirm = useCallback(async (event?: React.MouseEvent) => {
  const shouldQueue = queueMode || event?.shiftKey;

  if (shouldQueue) {
    // Check if specific tasks are selected
    const selectedKeys = Array.from(selectedTasks);
    if (selectedKeys.length > 0) {
      addToQueue(
        `Solve targeted (${selectedKeys.length} tasks)`,
        { type: 'solve', taskKeys: selectedKeys, scope: 'targeted', expandChains: true },
      );
    } else {
      addToQueue(
        'Solve all',
        { type: 'solve', scope: 'full' },
      );
    }
    return;
  }

  // Original logic...
}, [queueMode, addToQueue, selectedTasks]);
```

### Pass event to toolbar button clicks

The toolbar buttons need to pass the MouseEvent so we can check `event.shiftKey`:

```typescript
// In the toolbar rendering:
<button onClick={(e) => handleApiUnschedule(selectedTaskKeys, e)}>
  Unschedule
</button>

<button onClick={(e) => handleApiPin(selectedTaskKeys, true, e)}>
  📌 Pin
</button>

// etc.
```

---

## Part 4: Confirmation Dialog Before Execute

Before executing, show a summary of what will happen:

```typescript
function ExecuteConfirmDialog({
  queue,
  onConfirm,
  onCancel,
}: {
  queue: QueuedAction[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Group commands by type for summary
  const summary: Record<string, number> = {};
  queue.forEach(a => {
    const type = a.command.type;
    summary[type] = (summary[type] || 0) + 1;
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 20, maxWidth: 420, width: '90%',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
          Execute {queue.length} Action{queue.length !== 1 ? 's' : ''}?
        </div>

        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
          This will execute all queued actions atomically. If any action fails, all changes will be rolled back.
        </div>

        {/* Step list */}
        <div style={{ marginBottom: 16 }}>
          {queue.map((action, i) => (
            <div key={action.id} style={{
              fontSize: 11, color: C.text, padding: '3px 0',
              borderBottom: i < queue.length - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ color: C.textDim, marginRight: 6 }}>{i + 1}.</span>
              {action.label}
            </div>
          ))}
        </div>

        {/* Summary */}
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 16 }}>
          Summary: {Object.entries(summary).map(([type, count]) =>
            `${count} ${type}${count > 1 ? 's' : ''}`
          ).join(', ')}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              fontSize: 12, padding: '6px 16px', borderRadius: 8,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.textMuted, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              fontSize: 12, padding: '6px 16px', borderRadius: 8, fontWeight: 700,
              background: C.accent, border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            ▶ Execute {queue.length} Action{queue.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Wire the confirm dialog into the execute flow:

```typescript
const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);

// Execute All button opens the dialog:
// onExecute={() => setShowExecuteConfirm(true)}

// Dialog confirms → calls executeQueue()
{showExecuteConfirm && (
  <ExecuteConfirmDialog
    queue={actionQueue}
    onConfirm={() => { setShowExecuteConfirm(false); executeQueue(); }}
    onCancel={() => setShowExecuteConfirm(false)}
  />
)}
```

---

## Part 5: Keyboard Shortcut and Visual Feedback

### Shift key indicator

Show a subtle indicator when Shift is held (so the planner knows actions will queue):

```typescript
const [shiftHeld, setShiftHeld] = useState(false);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
  const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
}, []);
```

When Shift is held or queue mode is on, toolbar buttons get a visual indicator:

```typescript
const isQueuing = queueMode || shiftHeld;

// On toolbar buttons, add a queuing indicator:
style={{
  // existing styles...
  outline: isQueuing ? `2px dashed ${C.accent}` : 'none',
}}
// And append to button label:
{isQueuing && <span style={{ fontSize: 9, marginLeft: 4, color: C.accent }}>+Q</span>}
```

### Toast on queue add

When an action is queued, show a brief toast:

```typescript
// After addToQueue():
showToast(`Queued: ${label}`, 'info', 1500);  // brief 1.5s toast
```

---

## Verification

### Endpoint
- [ ] `POST /ctp/execute` accepts command array
- [ ] Returns same format as apply-recommendation (actionsApplied, rippleEffects, newState)
- [ ] Rollback works on partial failure
- [ ] No staleness check — always executes against current state

### Queue panel
- [ ] Hidden when queue is empty
- [ ] Appears when first action is queued
- [ ] Shows numbered steps with human-readable labels
- [ ] Steps can be removed individually (✕ button)
- [ ] "Clear All" empties the queue
- [ ] "Execute All" opens confirmation dialog
- [ ] Confirmation dialog shows step list and summary
- [ ] Queue clears on successful execution (after 3s delay)
- [ ] Failed execution shows error/rollback banner

### Queuing mode
- [ ] Shift+click on Unschedule queues instead of executing
- [ ] Shift+click on Pin queues instead of executing
- [ ] Shift+click on Set Priority queues instead of executing
- [ ] Shift+click on resource preference changes queues
- [ ] Shift+click on Solve queues instead of executing
- [ ] Queue Mode toggle works for sustained queuing without holding Shift
- [ ] Normal click still fires immediately when not in queue mode and Shift not held
- [ ] Visual indicator (dashed outline + "+Q") shows on toolbar buttons when queuing
- [ ] Toast confirms each queued action

### Execute flow
- [ ] Confirmation dialog shows before execution
- [ ] Commands sent in queue order (order is load-bearing)
- [ ] Success: schedule refreshes, queue clears, result banner shows
- [ ] Failure: rollback banner shows which step failed
- [ ] Gantt and task table refresh after successful execution

### End-to-end scenarios
- [ ] Queue 3 unschedules + 1 solve → execute → tasks rescheduled atomically
- [ ] Queue priority change + solve → execute → rush order gets priority
- [ ] Queue resource exclude + resource prefer + solve → execute → machine breakdown handled
- [ ] Queue 1 action, remove it → queue empty, panel hidden
- [ ] Queue 5 actions, clear all → queue empty, panel hidden
- [ ] Mixed immediate + queue: normal click fires, then Shift+click queues next action

---

*Build order: Part 1 endpoint (~15 min) → Part 2 queue state + panel (~1 hour) → Part 3 Shift+click interception (~45 min) → Part 4 confirmation dialog (~30 min) → Part 5 keyboard + visual feedback (~15 min). Total: ~2.5 hours. Presets are optional polish for a follow-up — the queue works without them.*
