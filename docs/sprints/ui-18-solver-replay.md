# UI Sprint 18: Solver Replay Animator

**What it does:** After a solve run with replay recording enabled, the user can replay
the solver's decisions on the Gantt one event at a time — watching tasks appear,
disappear (bumps), and reappear in the exact order the solver worked through them.
Pinned tasks are pre-rendered at frame 0. Debugger-style breakpoints pause replay
on any task name or chain/order ref.

**Size:** ~3 hours CC work  
**Depends on:** Engine instrumentation (see prerequisite below) + API serialization change  
**Scenarios:** End-of-Day What-If (8), any post-solve diagnostic

---

## Why

A single `solverSequence` number only shows where a task ended up — it loses the
backtracking story. When a task is placed, bumped, and re-placed on a different
resource, that's the most important thing to see. The full `solverHistory` array
makes every decision visible: placements, bumps, retries, and chain outcomes.

Replay recording is opt-in (a checkbox in the Solve Preview dialog) because the
history array can grow large on complex solves with heavy backtracking.

---

## Prerequisite: Engine Instrumentation

The base scheduler already maintains a `solverSequence` counter (reset to 0 each
solve, incremented at every placement). This needs to be extended to record a history
entry on the task at every schedule and unschedule event — but **only when
`includeReplay` is true** in the solve request.

### New type — add to `entity.ts` or a new `solver-history.ts`:

```typescript
export type SolverAction =
  | 'placed'              // task successfully scheduled
  | 'unplaced'            // voluntarily unscheduled (e.g. solve-selected reset)
  | 'bumped'              // displaced by a higher-priority task
  | 'retry'               // re-attempting after a bump cleared capacity
  | 'deferred'            // skipped this pass, score too low — will retry
  | 'chain_start'         // solver began working this chain
  | 'chain_committed'     // all tasks in chain placed successfully
  | 'chain_failed'        // entire chain attempt abandoned, will retry
  | 'pinned_skip'         // encountered but skipped — task is pinned
  | 'excluded_skip'       // encountered but skipped — task is excluded
  | 'infeasible_declared'; // gave up after max attempts

export interface SolverHistoryEntry {
  solverSequence: number;   // global counter tick at moment of action
  action: SolverAction;
  score: number | null;     // task score at moment of action (null for chain/skip events)
  resourceKeys?: string[];  // resources assigned (placed/retry only)
  chainKey?: string;        // orderRef / linkId.name (chain events)
}
```

Add `solverHistory: SolverHistoryEntry[]` to `CTPTask`, initialized to `[]` in
the constructor.

### Gating — only record when requested:

The scheduler receives `includeReplay: boolean` from the solve request. When false
(default), history is never populated — zero overhead on normal solves.

```typescript
// In base scheduler, define cap:
const MAX_REPLAY_EVENTS = 2000; // total entries across all tasks
private replayEventCount = 0;

// Helper — call instead of pushing directly:
private recordHistory(task: CTPTask, entry: SolverHistoryEntry): void {
  if (!this.includeReplay) return;
  if (this.replayEventCount >= MAX_REPLAY_EVENTS) return;  // cap hit — stop silently
  task.solverHistory.push(entry);
  this.replayEventCount += 1;
}
```

Reset `replayEventCount = 0` at the top of each solve run.

### Where to call `recordHistory` in the base scheduler:

```typescript
// On placement (lines 332, 857-858, 1035-1036):
this.solverSequence += 1;
task.solverSequence = this.solverSequence;
this.recordHistory(task, {
  solverSequence: this.solverSequence,
  action: 'placed',
  score: task.score === Number.MAX_VALUE ? null : task.score,
  resourceKeys: task.capacityResources
    ?.toArray().map(r => r.scheduledResource).filter(Boolean) ?? [],
});

// On unschedule — distinguish bump vs voluntary:
this.solverSequence += 1;
this.recordHistory(task, {
  solverSequence: this.solverSequence,
  action: isBump ? 'bumped' : 'unplaced',
  score: task.score === Number.MAX_VALUE ? null : task.score,
});

// On chain_start / chain_committed / chain_failed:
this.solverSequence += 1;
this.recordHistory(task, {
  solverSequence: this.solverSequence,
  action: 'chain_start', // or 'chain_committed' / 'chain_failed'
  score: null,
  chainKey: task.linkId?.name ?? task.orderRef,
});
```

---

## Prerequisite: API Changes

### Solve request DTO — add flag:

```typescript
interface SolveRequestDto {
  // ... existing fields ...
  includeReplay?: boolean;  // default false — opt in to solverHistory recording
}
```

### Task serialization — add history and truncation flag:

In `ctp_service.ts`, pass `includeReplay` down to the scheduler, then in the
`taskResult` object (around line 818):

```typescript
const taskResult: any = {
  key: task.key,
  name: task.name,
  // ... existing fields ...
  solverSequence: task.solverSequence ?? 0,   // final resting sequence (keep for compat)
  solverHistory: request?.includeReplay ? (task.solverHistory ?? []) : undefined,
};
```

Add a top-level flag on the solve response so the frontend knows if the cap was hit:

```typescript
// In the solve response summary:
replayTruncated: includeReplay && (totalReplayEvents >= MAX_REPLAY_EVENTS),
replayEventCount: includeReplay ? totalReplayEvents : 0,
```

---

## Prerequisite: Solve Preview UI — Record Replay Checkbox

In `SolvePreview` (`App.tsx` around line 1353), add `includeReplay` and
`onIncludeReplayChange` to props, and render a checkbox in the footer between
the solver depth row and the Cancel/Solve Now buttons (around line 1781, just
above the `height: 8` spacer):

```typescript
// New props:
includeReplay: boolean;
onIncludeReplayChange: (v: boolean) => void;

// Render — same compact row style as the Dispatch row:
<div style={{
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
  padding: '8px 12px', background: C.bg, borderRadius: 8,
  border: `1px solid ${C.border}`,
}}>
  <input
    id="replay-toggle"
    type="checkbox"
    checked={includeReplay}
    onChange={e => onIncludeReplayChange(e.target.checked)}
    style={{ accentColor: C.accent, width: 14, height: 14, cursor: 'pointer' }}
  />
  <label htmlFor="replay-toggle" style={{
    fontSize: 12, color: includeReplay ? C.text : C.textMuted,
    cursor: 'pointer', userSelect: 'none', flex: 1,
  }}>
    ▶ Record solver replay
  </label>
  <span style={{ fontSize: 11, color: C.textDim }}>
    (captures placement history — may slow large solves)
  </span>
</div>
```

Add state in the App component:

```typescript
const [includeReplay, setIncludeReplay] = useState(false);
```

Pass `includeReplay` into the solve request body:

```typescript
body: JSON.stringify({
  // ... existing solve body fields ...
  includeReplay,
})
```

The ▶ Replay Gantt toolbar button is only shown after a solve where
`includeReplay` was true AND the response contains at least one task with
`solverHistory.length > 0`.

If `replayTruncated: true` comes back in the response, show a small warning
banner in the replay control bar:

```
⚠ Replay truncated at 2000 events — early solve history only
```

---

## Feature Spec

### Entry Point

A **▶ Replay** button appears in the Gantt toolbar after a qualifying solve.
Clicking it enters **Replay Mode**.

---

### Building the Global Event Timeline

On entering Replay Mode, flatten all task histories into a single sorted timeline:

```typescript
interface ReplayEvent {
  solverSequence: number;
  action: SolverAction;
  taskKey: string;
  taskName: string;
  orderRef: string | null;
  score: number | null;
  resourceKeys?: string[];
  chainKey?: string;
}

const replayTimeline = useMemo(() => {
  if (!replayMode) return [];
  const events: ReplayEvent[] = [];
  tasks.forEach(t => {
    (t.solverHistory ?? []).forEach(entry => {
      events.push({
        solverSequence: entry.solverSequence,
        action: entry.action,
        taskKey: t.key,
        taskName: t.name,
        orderRef: t.orderRef ?? null,
        score: entry.score,
        resourceKeys: entry.resourceKeys,
        chainKey: entry.chainKey,
      });
    });
  });
  return events.sort((a, b) => a.solverSequence - b.solverSequence);
}, [replayMode, tasks]);
```

Derive the **visible key set** by replaying all events up to the current step:

```typescript
const replayVisibleKeys = useMemo(() => {
  const visible = new Set<string>();
  // Pinned tasks always visible from frame 0
  tasks.forEach(t => { if (t.pinned || taskPins[t.key]) visible.add(t.key); });
  // Apply events up to current step
  replayTimeline.slice(0, replayStep + 1).forEach(ev => {
    if (ev.action === 'placed' || ev.action === 'retry') visible.add(ev.taskKey);
    if (ev.action === 'bumped' || ev.action === 'unplaced') visible.delete(ev.taskKey);
    // chain/skip/deferred events don't change bar visibility
  });
  return visible;
}, [replayStep, replayTimeline, tasks, taskPins]);
```

---

### Replay Mode — Gantt Behaviour

On entering Replay Mode:

1. Gantt switches to read-only — context menus and click-to-detail disabled.
2. **Pinned tasks** render immediately at full opacity.
3. All other scheduled tasks start hidden. They animate in/out as events play.
4. Unscheduled/infeasible tasks (empty `solverHistory`) are never shown.

**Action → visual mapping:**

| Action | Visual |
|--------|--------|
| `placed` | Bar fades in (~300ms) on its assigned resource row |
| `retry` | Bar fades in with a pulsed green ring for 500ms |
| `bumped` | Bar flashes red (~200ms) then fades out |
| `unplaced` | Bar fades out quietly |
| `chain_start` | Subtle left-edge highlight on all tasks sharing `chainKey` for 400ms |
| `chain_committed` | Brief green glow across all chain bars |
| `chain_failed` | Brief red glow across all chain bars, then all fade out |
| `deferred` | No Gantt change — status line only |
| `pinned_skip` / `excluded_skip` | No Gantt change — status line only |
| `infeasible_declared` | Bar flashes red at window start position, then disappears |

A small **sequence badge** on each visible bar shows its final `solverSequence`: `#3`.
For tasks that were bumped and retried, the badge reflects their last placed sequence.

---

### Replay Controls

A compact control bar appears **below the Gantt** while Replay Mode is active:

```
[◀◀ Reset]  [◀ Back]  [▶ Play / ⏸ Pause]  [▶ Next]  [✕ Exit Replay]
Speed: [0.5×] [1×] [2×] [5×]
Step N of M  |  placed  |  Task: CNC-OP-003  |  Order: WO-1004  |  Score: 142
⏸ Break on: [________________________________]
⚠ Replay truncated at 2000 events — early solve history only    ← only if replayTruncated
```

- **Reset** — jump to step 0 (pinned tasks only)
- **Back** — step one event backward
- **Play / Pause** — auto-advance at selected speed
- **Next** — step one event forward
- **Exit** — leave Replay Mode, restore normal Gantt

Speed → interval between steps:
- 0.5× → 600ms / 1× → 300ms / 2× → 150ms / 5× → 60ms

**Status line** shows: step index, action name (color-coded), task name, orderRef,
and score at that moment. Action label colors: `C.green` for placed/retry/chain_committed,
`C.red` for bumped/chain_failed/infeasible_declared, `C.yellow` for chain_start,
`C.textMuted` for skip/deferred.

---

### Breakpoints

Plain text, case-insensitive substring, comma-separated. Matched against `taskName`
and `orderRef` on each event before it plays.

Optional action prefix:
- `"WO-1004"` — pause on any event for that order
- `"bumped:CNC-OP"` — pause only on bump events for tasks matching `CNC-OP`
- `"chain_failed:WO-1004"` — pause when that specific chain fails

On hit: auto-play pauses, control bar border flashes `C.accent` for 400ms.

---

### State

```typescript
const [replayMode, setReplayMode] = useState(false);
const [replayStep, setReplayStep] = useState(0);
const [replayPlaying, setReplayPlaying] = useState(false);
const [replaySpeed, setReplaySpeed] = useState(1);
const [replayBreakpoint, setReplayBreakpoint] = useState('');
const [replayBreakpointHit, setReplayBreakpointHit] = useState(false);
const [replayTruncated, setReplayTruncated] = useState(false);
const [includeReplay, setIncludeReplay] = useState(false);
```

Reset `replayMode`, `replayStep`, `replayTruncated` whenever a new solve runs.
Set `replayTruncated` from `result.replayTruncated` after each solve.

---

### Integration with GanttChart

Pass to `GanttChart` and `CaseGanttChart`:

```typescript
replayVisibleKeys?: Set<string>;
replayBadgeMap?: Map<string, number>;  // key → final solverSequence
replayFlashKey?: string;
replayFlashAction?: SolverAction;
```

Inside the task bar render loop (around line 3148):

```typescript
if (replayVisibleKeys && !replayVisibleKeys.has(t.key)) return null;

const isFlashing = replayFlashKey === t.key;
const flashColor = replayFlashAction === 'bumped' ? C.red
  : replayFlashAction === 'retry' ? C.green : 'transparent';
// Apply as boxShadow when isFlashing: `0 0 0 2px ${flashColor}`
```

Badge inside bar:

```typescript
{replayBadgeMap?.has(t.key) && (
  <span style={{
    fontSize: 9, background: 'rgba(0,0,0,0.45)', color: '#fff',
    borderRadius: 3, padding: '0 3px', marginRight: 3, flexShrink: 0,
  }}>
    #{replayBadgeMap.get(t.key)}
  </span>
)}
```

---

### Auto-play Loop

```typescript
useEffect(() => {
  if (!replayPlaying) return;
  if (replayStep >= replayTimeline.length) { setReplayPlaying(false); return; }

  const ev = replayTimeline[replayStep];
  const bps = replayBreakpoint.split(',').map(b => b.trim().toLowerCase()).filter(Boolean);
  const hits = bps.some(bp => {
    const [actionFilter, nameFilter] = bp.includes(':') ? bp.split(':') : [null, bp];
    const nameMatch =
      ev.taskName?.toLowerCase().includes(nameFilter ?? bp) ||
      ev.orderRef?.toLowerCase().includes(nameFilter ?? bp);
    const actionMatch = !actionFilter || ev.action === actionFilter;
    return nameMatch && actionMatch;
  });
  if (hits) {
    setReplayPlaying(false);
    setReplayBreakpointHit(true);
    setTimeout(() => setReplayBreakpointHit(false), 400);
    return;
  }

  const delay = 300 / replaySpeed;
  const timer = setTimeout(() => setReplayStep(s => s + 1), delay);
  return () => clearTimeout(timer);
}, [replayPlaying, replayStep, replayTimeline, replaySpeed, replayBreakpoint]);
```

---

## Verification Checklist

- [ ] `includeReplay: false` (default) — `solverHistory` absent from response, zero engine overhead
- [ ] `includeReplay: true` — `solverHistory` populated on scheduled tasks
- [ ] `replayTruncated: true` returned when 2000-event cap is hit
- [ ] Truncation warning banner shown in control bar when `replayTruncated`
- [ ] SolvePreview checkbox present, unchecked by default
- [ ] Checkbox state passed through to solve request body
- [ ] ▶ Replay button only shown when replay was requested and history is present
- [ ] Pinned tasks visible from frame 0, not animated
- [ ] Global timeline sorted correctly across all tasks
- [ ] `placed` → bar fades in on correct resource row
- [ ] `bumped` → bar flashes red then disappears
- [ ] `retry` → bar fades in with green pulse ring
- [ ] `chain_failed` → all chain bars glow red then fade out
- [ ] `chain_committed` → all chain bars glow green briefly
- [ ] Task bumped and re-placed shows correct final sequence badge
- [ ] Back/Next navigate event by event
- [ ] Breakpoint on task name substring pauses correctly
- [ ] Breakpoint on orderRef substring pauses correctly
- [ ] Action-prefixed breakpoint `"bumped:WO-1004"` filters correctly
- [ ] Breakpoint flash fires on hit
- [ ] Status line shows action (color-coded), task name, orderRef, score
- [ ] Exit Replay restores normal Gantt fully
- [ ] New solve resets all replay state
- [ ] CaseGanttChart supports replay equally

---

## Size Estimate

- Engine: `SolverHistoryEntry` type + `solverHistory` on `CTPTask`: ~15 min
- Engine: `recordHistory` helper + cap logic: ~15 min
- Engine: instrument placed/bumped/unplaced: ~25 min
- Engine: instrument chain_start/committed/failed: ~15 min
- API: `includeReplay` flag + serialize history + truncation fields: ~10 min
- SolvePreview: checkbox + prop wiring: ~15 min
- Frontend: replay state + flatten timeline + visible key derivation: ~20 min
- GanttChart: visibility + flash + badge props: ~20 min
- Control bar UI + truncation warning: ~30 min
- Auto-play loop + breakpoint logic: ~20 min
- Action → visual mapping: ~15 min
- Exit/reset/cleanup: ~10 min
- CaseGanttChart parity: ~10 min
- **Total: ~3.5 hours**

---

## Future Actions (Not in This Sprint)

Defined now, wired in when solver strategies mature:

| Action | Trigger |
|--------|---------|
| `deferred` | Task skipped this pass — score too low, will retry later |
| `pinned_skip` | Solver encountered pinned task, passed over it |
| `excluded_skip` | Solver encountered excluded task, passed over it |
| `infeasible_declared` | Max retry attempts exhausted |
| `window_tightened` | Propagation narrowed this task's window |
| `context_exhausted` | All resource combinations tried, none feasible |
