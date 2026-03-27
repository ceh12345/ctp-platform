# Spec: Scheduling Commitment Stack

**Problem:** WIP sync can generate infeasibility if running + dispatched + pinned tasks consume all capacity before the solver gets to plan the remaining work. The engine needs to layer constraints in priority order and show the planner where capacity runs out.

**Solution:** A six-layer commitment stack where each layer is more committed than the next. The solver only operates on layers 5 and 6. Layers 1-4 are fixed constraints. The solve response shows remaining capacity after each layer.

---

## The Stack

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: RUNNING                                         │
│ Actually in progress. Actual resource, actual start,     │
│ remaining duration. Cannot be moved by anyone.           │
│ Capacity: consumed from actualStart to completion.       │
├─────────────────────────────────────────────────────────┤
│ Layer 2: ON_HOLD                                         │
│ Was running or dispatched, now stopped. Machine broke,   │
│ quality hold, waiting for inspection. Materials already  │
│ consumed. Resource slot blocked but no output being      │
│ produced. This is dead capacity — needs urgent           │
│ resolution.                                              │
│ Capacity: blocked from actualStart until                 │
│ estimatedResumeTime (or indefinitely if unknown).        │
├─────────────────────────────────────────────────────────┤
│ Layer 3: DISPATCHED                                      │
│ Next up. Materials pulled, operator assigned, setup      │
│ started or about to start. Not physically running yet    │
│ but operationally committed. Moving this wastes          │
│ materials and disrupts the floor.                        │
│ Capacity: reserved from scheduled start to end.          │
├─────────────────────────────────────────────────────────┤
│ Layer 4: PINNED                                          │
│ Planner committed. Not started, materials not pulled,    │
│ but the planner says "this stays here." Could be moved   │
│ if the planner explicitly unpins, but solver won't       │
│ touch it.                                                │
│ Capacity: reserved from scheduled start to end.          │
├─────────────────────────────────────────────────────────┤
│ Layer 5: PLANNED                                         │
│ Solver placed these in a previous solve. Currently       │
│ scheduled but the solver can move them on re-solve.      │
│ This is the "soft" schedule — it's a plan, not a         │
│ commitment.                                              │
│ Capacity: allocated but flexible.                        │
├─────────────────────────────────────────────────────────┤
│ Layer 6: UNSCHEDULED                                     │
│ Not yet placed. The solver's job. May become infeasible  │
│ if layers 1-4 consume too much capacity.                 │
│ Capacity: needs to find a slot.                          │
└─────────────────────────────────────────────────────────┘
```

---

## How Each Layer Maps to Engine State

| Layer | WIP State | Pinned | includeInSolve | canSolve() | Capacity effect |
|-------|-----------|--------|----------------|------------|-----------------|
| 1. Running | IN_PROCESS | true (forced) | true | false | Consumes from actualStart, remaining duration only |
| 2. On Hold | ON_HOLD | true (forced) | true | false | Blocks from actualStart to estimatedResumeTime (or indefinitely). Dead capacity — resource occupied, no output. |
| 3. Dispatched | NOT_STARTED | true (forced) | true | false | Consumes full scheduled window |
| 4. Pinned | NOT_STARTED | true (planner set) | true | false | Consumes full scheduled window |
| 5. Planned | NOT_STARTED | false | true | true | Allocated but solver can move |
| 6. Unscheduled | NOT_STARTED | false | true | true | No capacity consumed yet |

### New field: `commitmentLevel`

Add to `CTPTask`:

```typescript
export type CommitmentLevel = 'running' | 'on_hold' | 'dispatched' | 'pinned' | 'planned' | 'unscheduled';

// On CTPTask:
public commitmentLevel: CommitmentLevel = 'unscheduled';
```

This is derived from the WIP state and planner actions:

```typescript
function deriveCommitmentLevel(task: CTPTask): CommitmentLevel {
  if (task.wipstate === CTPWipStateConstants.IN_PROCESS) return 'running';
  if (task.wipstate === CTPWipStateConstants.ON_HOLD) return 'on_hold';
  if (task.dispatched) return 'dispatched';  // new flag — see below
  if (task.pinned) return 'pinned';
  if (task.state === CTPTaskStateConstants.SCHEDULED) return 'planned';
  return 'unscheduled';
}
```

### New field: `dispatched`

Add to `CTPTask`:

```typescript
public dispatched: boolean = false;
public dispatchedAt: string | null = null;  // ISO timestamp
public materialsPulled: boolean = false;
```

Set via WIP sync or UI action. Dispatching a task auto-pins it (the solver can't move dispatched work) but it's a stronger commitment than pinning — it signals that physical actions have been taken on the floor.

### New field: `percentComplete`

Add to `CTPTask`:

```typescript
// Progress tracking — client-reported via WIP sync, display only
public percentComplete: number = 0;           // 0-100, reported by client
public remainingDuration: number | null = null; // seconds — client override, more accurate than calculated
public actualStart: string | null = null;      // ISO timestamp — when the task actually started
public actualEnd: string | null = null;        // ISO timestamp — when the task actually finished
public actualResource: string | null = null;   // which resource the task is actually running on
public holdReason: string | null = null;       // why the task is on hold
public estimatedResumeTime: string | null = null; // when the hold is expected to lift
```

**How remaining duration is computed:**

```typescript
public effectiveRemainingDuration(): number {
  // 1. Client-provided remaining duration wins (most accurate)
  if (this.remainingDuration != null) return this.remainingDuration;

  // 2. Calculate from percentComplete
  const totalDuration = this.duration?.duration() ?? 0;
  if (this.percentComplete > 0) {
    return Math.max(0, totalDuration * (1 - this.percentComplete / 100));
  }

  // 3. Fall back to full duration
  return totalDuration;
}
```

**Rules:**
- `percentComplete` is never computed by the engine — always client-reported
- If the client doesn't send it, it stays 0 (not null — 0 means "no progress reported")
- The engine uses it only as a fallback for remaining duration calculation
- The UI displays it as a progress bar on Running tasks (Gantt bar fill, task detail)
- Completed tasks have `percentComplete: 100` and `actualEnd` set

**UI display:**

Gantt bar for a running task shows progress fill:
```
├████████████░░░░░░░░┤  60% — 2.5h remaining
```

Task detail shows:
```
── Progress ──────────────────────
  ████████████░░░░░░░░  60%
  Started: Mar 18 08:15
  Remaining: 2h 30m (client reported)
  On resource: CNC-01
```

**In the solve response** (per task, when available):

```json
{
  "key": "WO-1001-MILL",
  "percentComplete": 60,
  "remainingDuration": 5400,
  "actualStart": "2026-03-18T08:15:00Z",
  "actualEnd": null,
  "actualResource": "CNC-01",
  "commitmentLevel": "running"
}
```

---

## WIP Sync: Dispatched State

Extend the WIP sync task update to support dispatch:

```json
{
  "key": "WO-1001-MILL",
  "wipState": "NOT_STARTED",
  "dispatched": true,
  "materialsPulled": true,
  "actualResource": "CNC-01",
  "notes": "Materials staged at machine, operator briefed"
}
```

### Dispatch via UI

A "Dispatch" button in the task detail panel or selection toolbar:

```
[📌 Pin]  [🚀 Dispatch]  [▶ Start]  [✓ Complete]
```

The progression: Planned → Pinned → Dispatched → Running → Complete

Each step increases the commitment level. The planner can always step backward (un-dispatch, unpin) but the UI warns if materials have been pulled.

---

## Capacity Waterfall

Show the planner how capacity is consumed layer by layer on each resource. This answers "how much room is left for the solver?"

### Response format

Add to solve response and analytics:

```json
{
  "capacityWaterfall": [
    {
      "resourceKey": "CNC-01",
      "resourceName": "DMG Mori 5-Axis Mill",
      "totalAvailableHours": 40.0,
      "layers": [
        { "level": "running", "tasks": 1, "hours": 2.5, "cumulative": 2.5 },
        { "level": "on_hold", "tasks": 1, "hours": 3.0, "cumulative": 5.5 },
        { "level": "dispatched", "tasks": 2, "hours": 5.0, "cumulative": 10.5 },
        { "level": "pinned", "tasks": 1, "hours": 3.0, "cumulative": 13.5 },
        { "level": "planned", "tasks": 4, "hours": 15.0, "cumulative": 28.5 },
        { "level": "unscheduled", "tasks": 2, "hours": 6.0, "cumulative": 34.5 }
      ],
      "remainingCapacity": 5.5,
      "utilizationPercent": 86.3,
      "deadCapacityHours": 3.0
    }
  ]
}
```

### Visualization

A stacked bar per resource showing how capacity fills up:

```
CNC-01 (DMG Mori 5-Axis)                                    40h total
├████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░┤
 Run  ⚠HOLD  Dispatched  Pinned  ████ Planned ████  Unsched  │ Free
 2.5h  3.0h    5.0h       3.0h      15.0h       6.0h         │ 5.5h

FAB-JACK (Jack P.)                                           40h total
├█████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░┤
 Running  Disp   Pinned  ███████ Planned ████████████████████ │ Free
  3.0h    2.0h    4.0h      12.0h                              │ 19.0h
```

Color coding:
- Running: solid red (committed, in progress)
- On Hold: pulsing amber/red stripe (dead capacity — needs attention)
- Dispatched: solid orange (committed, materials pulled)
- Pinned: solid blue (committed by planner)
- Planned: lighter blue (solver placed, movable)
- Unscheduled: dashed outline (needs a slot)
- Free: empty (available capacity)

`deadCapacityHours` is the sum of ON_HOLD time — resource is blocked but producing nothing. This is the most urgent metric on the waterfall. If dead capacity is high, the planner's first action should be resolving the holds.

When Running + Dispatched + Pinned exceeds available capacity, the resource shows a red overflow indicator — the solver has no room.

---

## Solve Behavior with the Stack

### Before solving

The engine processes layers 1-3 as fixed constraints:

```typescript
function applyCommitmentStack(landscape: SchedulingLandscape): void {
  landscape.tasks.forEach(task => {
    task.commitmentLevel = deriveCommitmentLevel(task);

    switch (task.commitmentLevel) {
      case 'running':
        // Lock: actual resource, remaining duration, actual start
        // Already handled by WIP sync
        task.pinned = true;
        break;

      case 'dispatched':
        // Lock: scheduled resource, scheduled times
        // Materials consumed, operator assigned
        task.pinned = true;
        break;

      case 'pinned':
        // Lock: scheduled resource, scheduled times
        // Planner committed
        // Already pinned
        break;

      case 'planned':
        // Solver CAN move these
        task.pinned = false;
        break;

      case 'unscheduled':
        // Solver needs to place these
        task.pinned = false;
        break;
    }
  });
}
```

### Infeasibility from the stack

When layers 1-4 consume all capacity, the infeasibility report should say WHY clearly:

```
Task EQ-003-WELD is infeasible:

Bottleneck: FAB-JACK
  Committed capacity (cannot move):
    🔴 Running: PV-001-WELD (60% complete, 2.5h remaining)
    ⚠️ On Hold: PV-003-NOZZLE (quality hold, 3h blocked, no resume estimate)
    🟠 Dispatched: PV-002-WELD (materials pulled, starts 1pm)
    🔵 Pinned: RP-001-WELD (planner locked for Wednesday)

  Total committed: 15.5h of 16h available this week
  Dead capacity (on hold): 3.0h ← resolve this first
  Remaining for solver: 0.5h
  EQ-003-WELD needs: 4.0h

  → Not enough free capacity after committed work
  → Recommendation: resolve PV-003-NOZZLE hold to recover 3h, then extend window or redirect to Luke M.
```

This is significantly more useful than "No capacity on FAB-JACK within window" because it shows the planner exactly what's consuming the capacity and which layer it's in. Running can't move. On Hold is dead capacity that should be resolved first. Dispatched could theoretically move but wastes materials. Pinned can be unpinned. The planner makes an informed decision.

### The diagnose engine references the stack

When generating recommendations, the diagnose engine checks which blocking tasks are in which layer:

- Blocker is RUNNING → can't bump, don't suggest it
- Blocker is ON_HOLD → suggest resolving the hold first (highest priority recommendation — recovering dead capacity is the best ROI)
- Blocker is DISPATCHED → warn about material waste if bumped
- Blocker is PINNED → suggest unpinning as an option
- Blocker is PLANNED → suggest bumping (normal recommendation)

On Hold blockers get a special recommendation type:

```json
{
  "action": "resolve_hold",
  "description": "Resolve hold on PV-003-NOZZLE to recover 3h on FAB-JACK",
  "tradeoffs": {
    "gains": ["Recovers 3h of dead capacity on FAB-JACK"],
    "costs": ["Requires resolving the quality issue or reassigning to another resource"]
  }
}
```

---

## UI: Commitment Level Indicators

### Task table

Add a "Status" column that shows the commitment level with icons:

| Icon | Level | Color |
|------|-------|-------|
| 🔴 | Running | Red |
| ⚠️ | On Hold | Pulsing amber/red |
| 🟠 | Dispatched | Orange |
| 📌 | Pinned | Blue |
| ✓ | Planned (scheduled) | Green |
| ○ | Unscheduled | Gray |
| ✕ | Infeasible | Red outline |

### Gantt bars

Bar styling reflects commitment level:

| Level | Bar style |
|-------|-----------|
| Running | Solid fill, red left border, progress indicator |
| On Hold | Striped fill (amber/red diagonal stripes), pulsing border, hold reason tooltip |
| Dispatched | Solid fill, orange left border, "D" badge |
| Pinned | Solid fill, blue left border, 📌 badge |
| Planned | Normal fill |
| Unscheduled | Not on Gantt (or shown in unscheduled panel) |

### Task detail panel

Show the commitment level prominently:

```
── Commitment ──────────────────────
  ⚠️ ON HOLD
  Hold reason: Quality issue — weld inspection failed
  On hold since: Mar 18 09:45
  Estimated resume: Unknown
  Materials consumed: ✓ (cannot recover)
  Dead capacity: 3.0h blocked on FAB-JACK

  [▶ Resume]  [↩ Reassign Resource]  [✕ Cancel Task]
```

Or for dispatched:

```
── Commitment ──────────────────────
  🟠 DISPATCHED
  Materials pulled: ✓ (Mar 18 09:30)
  Operator: Jack P. (confirmed)
  Actual resource: Weld Bay 1

  [⬇ Revert to Pinned]  [▶ Mark Running]
```

### Progression buttons

The selection toolbar offers commitment level transitions:

```
Selected: 3 tasks
[📌 Pin]  [🚀 Dispatch]  [▶ Start]  [⏸ Hold]  [✓ Complete]
```

Each button moves the selected tasks to the next commitment level. "Dispatch" warns if the task isn't scheduled. "Start" asks for actual start time. "Hold" asks for a hold reason and optional estimated resume time. "Complete" asks for actual end time.

The hold button is available on Running and Dispatched tasks. Resume is available on On Hold tasks.

```
Progression:  Planned → Pinned → Dispatched → Running → Complete
                                      ↓           ↓
                                   On Hold ← ← On Hold
                                      ↓
                                   Resume → Running → Complete
```

---

## Verification

### Commitment levels
- [ ] `commitmentLevel` derived correctly from wipState + dispatched + pinned
- [ ] Running tasks consume remaining duration only (not original)
- [ ] On Hold tasks block capacity from actualStart to estimatedResumeTime (or indefinitely)
- [ ] On Hold tasks have `deadCapacityHours` calculated correctly
- [ ] Dispatched tasks consume full scheduled window
- [ ] Pinned tasks consume full scheduled window
- [ ] Planned tasks are movable by solver
- [ ] Unscheduled tasks have no capacity consumption

### Solve behavior
- [ ] Solver skips Running/On Hold/Dispatched/Pinned tasks (canSolve = false)
- [ ] Solver only rearranges Planned and Unscheduled tasks
- [ ] Capacity from layers 1-4 is correctly subtracted before solving
- [ ] Infeasibility report shows committed capacity breakdown by layer
- [ ] Dead capacity (On Hold) highlighted separately in infeasibility report

### Capacity waterfall
- [ ] Waterfall shows correct hours per layer per resource, including on_hold
- [ ] Cumulative capacity sums correctly
- [ ] Remaining capacity = total - cumulative
- [ ] Overflow indicator when committed > available
- [ ] `deadCapacityHours` reported per resource

### Diagnose integration
- [ ] Running blockers: no bump suggestion
- [ ] On Hold blockers: suggest resolving the hold first (highest priority)
- [ ] On Hold blockers: `resolve_hold` recommendation type generated
- [ ] Dispatched blockers: bump suggestion with material waste warning
- [ ] Pinned blockers: unpin suggestion offered
- [ ] Planned blockers: normal bump suggestion

### UI
- [ ] All 6 commitment level icons in task table (including ⚠️ On Hold)
- [ ] Gantt bar styling reflects level (On Hold gets striped amber/red)
- [ ] On Hold tasks show hold reason, duration blocked, dead capacity in detail panel
- [ ] Task detail shows commitment info + progression buttons
- [ ] Hold button available on Running and Dispatched tasks
- [ ] Hold action asks for reason and optional resume estimate
- [ ] Resume button available on On Hold tasks
- [ ] Dispatch action warns if task not scheduled
- [ ] Start action prompts for actual start time
- [ ] Complete action prompts for actual end time

---

*Build order: `commitmentLevel` field + derivation (~30 min), solve behavior with stack (~1 hour), capacity waterfall computation + response format (~1 hour), infeasibility report enrichment (~30 min), UI indicators (~1 hour), progression buttons (~1 hour). Total: ~5 hours. Depends on Phase 2 WIP Sync for the Running/ON_HOLD states.*
