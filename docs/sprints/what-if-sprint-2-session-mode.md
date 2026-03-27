# What-If Sprint 2: Session Mode with Selective Commit/Rollback

**What it does:** Wraps all planning actions in a transaction. The planner enters session mode, makes changes (rearrange tasks, add new orders via CTP query, unschedule, reprioritize), sees the cumulative impact, then selectively commits or rolls back individual changes.

**Why:** What-If Sprint 1 gave us stateless CTP queries — "can I fit this?" with an immediate answer. But real planning is iterative: "If I say yes to Johnson, can I still fit Rivera? What if I move C001 to make room?" Each query needs to see the effect of previous tentative decisions. Sessions make tentative changes accumulate.

**Size:** ~3-4 hours (engine + frontend)  
**Depends on:** What-If Sprint 1 (CTP query endpoint, clone-from-chain)

---

## Part 1: Engine — Session Management

### 1a. Session endpoints

```
POST /v1/ctp/session/begin      → Snapshot landscape, return sessionId
POST /v1/ctp/session/add-order  → CTP query within session (tentative, accumulates)
POST /v1/ctp/session/commit     → Commit selected items, discard others, end session
POST /v1/ctp/session/rollback   → Discard everything, restore snapshot, end session
GET  /v1/ctp/session/status     → Current session state (items, deltas)
DELETE /v1/ctp/session/item/:id → Discard one item, re-evaluate remaining
```

### 1b. Session state

```typescript
interface ScheduleSession {
  sessionId: string;
  snapshot: LandscapeSnapshot;
  createdAt: number;
  items: SessionItem[];
}

interface SessionItem {
  itemId: string;
  type: 'new-order' | 'move' | 'unschedule' | 'reschedule' | 'priority-change';
  description: string;
  status: 'tentative' | 'committed' | 'discarded';
  affectedTaskKeys: string[];
  ctpQueryResult?: CTPQueryOption;  // if type is new-order, the chosen option
  timestamp: number;
}
```

### 1c. BEGIN

```typescript
@Post('session/begin')
beginSession() {
  if (this.activeSession) {
    throw new HttpException('Session already active. Commit or rollback first.', HttpStatus.CONFLICT);
  }
  
  const snapshot = this.stateService.snapshotLandscape();
  const sessionId = `session-${Date.now()}`;
  
  this.activeSession = {
    sessionId,
    snapshot,
    createdAt: Date.now(),
    items: [],
  };
  
  return { sessionId, status: 'active' };
}
```

### 1d. ADD-ORDER within session

Unlike the stateless CTP query (Sprint 1), this one commits tentatively to the working landscape. Subsequent queries see the resources consumed.

```typescript
@Post('session/add-order')
addOrderToSession(@Body() body: CTPQueryDto & { selectedOption?: number }) {
  if (!this.activeSession) {
    throw new HttpException('No active session', HttpStatus.BAD_REQUEST);
  }
  
  // Run CTP query against CURRENT landscape (includes previous tentative changes)
  // Do NOT snapshot/restore — we want the changes to stick in the working copy
  const cloned = this.cloneChainFromExisting(body.sourceChainKey, body.orderName, landscape);
  
  // Inject tasks into landscape
  cloned.tasks.forEach(task => landscape.tasks.add(task));
  landscape.processes?.add(cloned.chain);
  
  // Evaluate
  const result = this.chainEngine.evaluateChain(cloned.chain, ...);
  
  if (result && body.selectedOption != null) {
    // Commit tentatively — resources now consumed in working landscape
    this.chainEngine.commitChain(result, scheduleEngine, landscape, direction);
  }
  
  const item: SessionItem = {
    itemId: `item-${Date.now()}`,
    type: 'new-order',
    description: `${body.orderName} — ${result ? 'feasible' : 'infeasible'}`,
    status: 'tentative',
    affectedTaskKeys: cloned.tasks.map(t => t.key),
    ctpQueryResult: result ? this.formatOption(result, cloned.tasks) : undefined,
    timestamp: Date.now(),
  };
  
  this.activeSession.items.push(item);
  
  return {
    itemId: item.itemId,
    feasible: !!result,
    options: result ? [this.formatOption(result, cloned.tasks)] : [],
    infeasibilityReport: result ? null : this.buildReport(cloned.chain, ...),
  };
}
```

### 1e. Track existing actions in session

Wrap existing operations (unschedule, move, pin, reprioritize) to track them as session items when a session is active:

```typescript
// In existing unscheduleTask, moveTo, pinTask, etc:
private trackInSession(type: SessionItem['type'], description: string, taskKeys: string[]) {
  if (!this.activeSession) return;
  
  this.activeSession.items.push({
    itemId: `item-${Date.now()}`,
    type,
    description,
    status: 'tentative',
    affectedTaskKeys: taskKeys,
    timestamp: Date.now(),
  });
}

// Example — in unscheduleTask:
public unscheduleTask(taskKey: string, resetScore: boolean = true) {
  // ... existing logic ...
  this.trackInSession('unschedule', `Unscheduled ${task.name}`, [taskKey]);
}
```

### 1f. COMMIT — Selective

```typescript
@Post('session/commit')
commitSession(@Body() body: { commitItemIds: string[] }) {
  if (!this.activeSession) {
    throw new HttpException('No active session', HttpStatus.BAD_REQUEST);
  }
  
  const session = this.activeSession;
  
  // Mark items
  for (const item of session.items) {
    item.status = body.commitItemIds.includes(item.itemId)
      ? 'committed' : 'discarded';
  }
  
  // Restore to clean snapshot
  this.stateService.restoreLandscape(session.snapshot);
  
  // Replay committed items in order
  const committed = session.items.filter(i => i.status === 'committed');
  for (const item of committed) {
    this.replaySessionItem(item);
  }
  
  // Re-solve for consistency
  const result = this.solve();
  
  // End session
  const summary = {
    committedItems: committed.length,
    discardedItems: session.items.length - committed.length,
    sessionDuration: Date.now() - session.createdAt,
  };
  
  this.activeSession = null;
  
  return { status: 'committed', ...summary, solveResult: result };
}
```

### 1g. Replay logic

```typescript
private replaySessionItem(item: SessionItem): void {
  switch (item.type) {
    case 'new-order':
      // Re-clone and inject the order, re-evaluate and commit
      // Use stored CTP result to guide placement
      break;
    case 'unschedule':
      item.affectedTaskKeys.forEach(key => this.landscape.unscheduleTask(key));
      break;
    case 'move':
      // Re-apply the move operation
      break;
    case 'priority-change':
      // Re-apply priority
      break;
  }
}
```

### 1h. ROLLBACK

```typescript
@Post('session/rollback')
rollbackSession() {
  if (!this.activeSession) {
    throw new HttpException('No active session', HttpStatus.BAD_REQUEST);
  }
  
  this.stateService.restoreLandscape(this.activeSession.snapshot);
  this.activeSession = null;
  
  return { status: 'rolled_back' };
}
```

### 1i. DELETE single item

Remove one tentative item and re-evaluate the rest:

```typescript
@Delete('session/item/:itemId')
discardSessionItem(@Param('itemId') itemId: string) {
  if (!this.activeSession) {
    throw new HttpException('No active session', HttpStatus.BAD_REQUEST);
  }
  
  const item = this.activeSession.items.find(i => i.itemId === itemId);
  if (!item) throw new HttpException('Item not found', HttpStatus.NOT_FOUND);
  
  item.status = 'discarded';
  
  // Restore snapshot and replay remaining tentative items
  this.stateService.restoreLandscape(this.activeSession.snapshot);
  const remaining = this.activeSession.items.filter(
    i => i.status === 'tentative'
  );
  for (const r of remaining) {
    this.replaySessionItem(r);
  }
  
  // Return updated state
  const result = this.ctpService.getState('novice');
  return { status: 'discarded', itemId, solveResult: result };
}
```

### 1j. STATUS

```typescript
@Get('session/status')
sessionStatus() {
  if (!this.activeSession) {
    return { active: false };
  }
  
  return {
    active: true,
    sessionId: this.activeSession.sessionId,
    startedAt: new Date(this.activeSession.createdAt).toISOString(),
    durationMinutes: Math.round((Date.now() - this.activeSession.createdAt) / 60000),
    items: this.activeSession.items.map(i => ({
      itemId: i.itemId,
      type: i.type,
      description: i.description,
      status: i.status,
      timestamp: new Date(i.timestamp).toISOString(),
    })),
    totalItems: this.activeSession.items.length,
    tentativeItems: this.activeSession.items.filter(i => i.status === 'tentative').length,
  };
}
```

---

## Part 2: Frontend — Session Mode UI

### 2a. State

```typescript
const [whatIfMode, setWhatIfMode] = useState(false);
const [sessionId, setSessionId] = useState<string | null>(null);
const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);
const [sessionSnapshot, setSessionSnapshot] = useState<any>(null);
const [selectedCommitItems, setSelectedCommitItems] = useState<Set<string>>(new Set());
```

### 2b. Begin session

```typescript
const handleBeginSession = async () => {
  const res = await api('/ctp/session/begin', { method: 'POST' });
  setWhatIfMode(true);
  setSessionId(res.sessionId);
  setSessionSnapshot(solveResult);
  setSessionItems([]);
  setSelectedCommitItems(new Set());
};
```

### 2c. Amber border + banner

Same as Sprint 6 design — amber border around workspace, persistent banner:

```
⚠ SESSION MODE — 3 tentative changes. 
  [Add Order]  [Commit Selected (2)]  [Discard All]
```

### 2d. Session items panel

Collapsible panel at bottom of screen:

```
Session Items (3)                                        [▾]
──────────────────────────────────────────────────────────────
☑ NEW   Johnson Knee Replacement — Mon 10:30, OR-02  [✕]
☑ NEW   Rivera Hip Replacement — Fri 7:00, OR-01     [✕]
☐ MOVE  C001 moved to OR-03 — Mon 8:00               [✕]
──────────────────────────────────────────────────────────────
         [Commit Selected (2)]  [Discard All]
```

- Checkboxes select items for commit
- ✕ button discards individual items (calls DELETE endpoint, re-evaluates)
- Type badges: NEW, MOVE, UNSCHED, PRIORITY
- Feasibility indicator per item

### 2e. Tentative task rendering on Gantt

Tasks from session items render with dashed borders and a tentative badge:

```tsx
const isSessionTask = sessionItems.some(
  item => item.affectedTaskKeys.includes(task.key) && item.status === 'tentative'
);

// Style: dashed border, lighter opacity, yellow accent
{isSessionTask && (
  <span style={{ fontSize: 9, color: C.yellow, marginLeft: 4 }}>⚠</span>
)}
```

### 2f. Comparison deltas in banner

Show running comparison against snapshot:

```typescript
const deltas = useMemo(() => {
  if (!sessionSnapshot || !solveResult) return null;
  const before = sessionSnapshot.summary;
  const after = solveResult.summary;
  return {
    scheduled: after.scheduledTasks - before.scheduledTasks,
    feasibility: ((after.feasibilityRate - before.feasibilityRate) * 100).toFixed(1),
    newOrders: sessionItems.filter(i => i.type === 'new-order' && i.status === 'tentative').length,
  };
}, [sessionSnapshot, solveResult, sessionItems]);
```

Display:

```
⚠ SESSION: +2 new orders, +5 tasks scheduled, feasibility 92% → 96% (+4%)
```

### 2g. End session flow

"Commit Selected" → confirmation dialog listing what's being kept and what's discarded → calls `POST /session/commit` → session ends, amber border removed, schedule reflects committed items only.

"Discard All" → confirmation → calls `POST /session/rollback` → schedule reverts to pre-session state.

### 2h. Add Order within session

The "Add Order" button in session mode opens the same CTP Query dialog from Sprint 1, but the result is added to the session items panel instead of showing a standalone Book button. The tentative placement appears on the Gantt immediately.

Multiple "Add Order" calls accumulate — the second order evaluates against the landscape including the first order's tentative placement.

---

## Part 3: Verification

### Session Lifecycle

- [ ] "What-If" button → session begins, amber border appears
- [ ] All existing actions work in session (unschedule, pin, move, solve)
- [ ] Each action tracked in session items panel
- [ ] "Discard All" → schedule reverts to pre-session state
- [ ] Session status endpoint returns correct item count and status
- [ ] Only one session at a time — second BEGIN returns error

### Accumulating CTP Queries

- [ ] Add Order 1 (Johnson) → placed Monday, resources consumed tentatively
- [ ] Add Order 2 (Rivera) → evaluates with Johnson's resources already taken
- [ ] Discard Johnson → Rivera re-evaluated with freed resources, may find better slot
- [ ] Add 3 orders → all visible in session panel and Gantt

### Selective Commit

- [ ] Check 2 of 3 items → "Commit Selected (2)" active
- [ ] Commit → server restores snapshot, replays only 2 items, re-solves
- [ ] Discarded item's tasks gone from schedule
- [ ] Committed items' tasks are permanent
- [ ] Session ends, amber border removed

### Selective Discard

- [ ] Click ✕ on one item → item removed, remaining re-evaluated
- [ ] Resources freed by discarded item available for remaining items
- [ ] Gantt updates to reflect removal

### Comparison

- [ ] Banner shows deltas: +N orders, scheduled count change, feasibility change
- [ ] Tentative tasks visually distinct on Gantt (dashed, badge)
- [ ] Task table shows tentative status for session items

### Edge Cases

- [ ] Session with no changes → Commit does nothing, session ends cleanly
- [ ] All items discarded one by one → same as rollback
- [ ] Browser refresh in session → warn before closing
- [ ] Infeasible order in session → shows in items panel as ❌, no Gantt placement
- [ ] Session timeout? (optional — auto-rollback after 30 min inactivity)

Commit: "feat(what-if-2): session mode with selective commit/rollback, accumulating CTP queries"
