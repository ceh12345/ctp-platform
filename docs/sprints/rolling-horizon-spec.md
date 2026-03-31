# Spec: Rolling Horizon

**What it does:** Configurable solve horizon that controls what time range the solver considers. Supports rolling (NOW-based) and fixed start dates. Past due tasks get their windows auto-extended so the solver can place them. Tasks beyond the horizon are deferred.

**Size:** ~2 hours (horizon config + resolve logic + past due extension + UI)
**Depends on:** Existing horizon in landscape, tenant config

---

## Horizon Configuration

Add to the tenant's `appSettings.json` (or wherever horizon config lives):

```json
{
  "horizon": {
    "start": "NOW-2d",
    "maxDays": 16,
    "pastDueExtensionDays": 5
  }
}
```

### Three settings

| Setting | Type | Default | What it does |
|---------|------|---------|-------------|
| `start` | string | `"NOW"` | Where the horizon begins. `"NOW"`, `"NOW-2d"`, `"NOW+3d"`, or a fixed ISO date `"2026-03-01"` |
| `maxDays` | number | `14` | How far forward from start the solver looks. `horizonEnd = resolvedStart + maxDays` |
| `pastDueExtensionDays` | number | `5` | How many days from NOW to extend expired task windows. Tasks with `windowEnd < now` get `windowEnd = now + pastDueExtensionDays` |

### Start format

```
"NOW"           → today at start of day (tenant timezone)
"NOW-2d"        → 2 days before today (include recent past due in horizon)
"NOW+3d"        → 3 days from today (skip near-term locked/committed work)
"2026-03-01"    → fixed date (project scheduling, seasonal planning)
```

### Examples by tenant

```json
// Stafford (job shop) — rolling, 2-week look-ahead, include 2 days past due
{
  "horizon": { "start": "NOW-2d", "maxDays": 16, "pastDueExtensionDays": 5 }
}

// Summit (pharma) — rolling, 30-day look-ahead, generous past due buffer
{
  "horizon": { "start": "NOW", "maxDays": 30, "pastDueExtensionDays": 10 }
}

// Acme (healthcare) — rolling, weekly surgery schedule
{
  "horizon": { "start": "NOW", "maxDays": 7, "pastDueExtensionDays": 2 }
}

// HRMD (sports) — rolling, season look-ahead
{
  "horizon": { "start": "NOW", "maxDays": 60, "pastDueExtensionDays": 7 }
}

// Willoughby (demo) — fixed for demo consistency
{
  "horizon": { "start": "2026-02-10", "maxDays": 14, "pastDueExtensionDays": 5 }
}
```

---

## Part 1: Resolve Horizon at Solve Time

### Parser

```typescript
function resolveHorizonStart(value: string, timezone: string): DateTime {
  const now = DateTime.now().setZone(timezone).startOf('day');

  if (value === 'NOW') return now;

  // NOW±Nd offset
  const offsetMatch = value.match(/^NOW([+-])(\d+)d$/i);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '+' ? 1 : -1;
    const days = parseInt(offsetMatch[2]) * sign;
    return now.plus({ days });
  }

  // Fixed ISO date
  const parsed = DateTime.fromISO(value, { zone: timezone });
  if (parsed.isValid) return parsed.startOf('day');

  // Fallback
  return now;
}
```

### Apply in solve

```typescript
// In solve(), when building the landscape horizon:

const horizonConfig = this.configService.getHorizonConfig();
const timezone = this.configService.getLocale()?.timezone || 'UTC';

const horizonStart = resolveHorizonStart(
  horizonConfig?.start || 'NOW',
  timezone,
);
const maxDays = horizonConfig?.maxDays || 14;
const horizonEnd = horizonStart.plus({ days: maxDays });

// Set on the landscape
landscape.horizon.startW = CTPDateTime.fromDateTime(horizonStart.toISO()!);
landscape.horizon.endW = CTPDateTime.fromDateTime(horizonEnd.toISO()!);
```

---

## Part 2: Task Bucketing

After the horizon is resolved, every task falls into one of four buckets:

```typescript
function bucketTask(task: CTPTask, horizonStartW: number, horizonEndW: number, nowW: number, pastDueExtensionDays: number): 'past_due' | 'active' | 'near_horizon' | 'beyond' {
  const windowStartW = task.window?.startW ?? 0;
  const windowEndW = task.window?.endW ?? 0;

  // Past due: window end is before now
  if (windowEndW < nowW) return 'past_due';

  // Beyond horizon: window starts after horizon end
  if (windowStartW > horizonEndW) return 'beyond';

  // Near horizon: starts within horizon, ends past it
  if (windowStartW <= horizonEndW && windowEndW > horizonEndW) return 'near_horizon';

  // Active: window overlaps with horizon
  return 'active';
}
```

| Bucket | Solver behavior |
|--------|----------------|
| `past_due` | Window auto-extended, included in solve, flagged as late |
| `active` | Normal solve — window within horizon |
| `near_horizon` | Included — solver places within the overlap between window and horizon |
| `beyond` | Excluded from solve — deferred. Visible in UI as "beyond horizon" |

### Apply bucketing

```typescript
// In solve(), after horizon is set, before applyCommitmentStack:

const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
const pastDueExtensionDays = horizonConfig?.pastDueExtensionDays ?? 5;
const extensionEndW = nowW + (pastDueExtensionDays * 86400);

landscape.tasks.forEach(task => {
  // Skip committed tasks — they're already placed
  if (['running', 'on_hold', 'dispatched', 'pinned', 'completed'].includes(task.commitmentLevel)) return;

  const bucket = bucketTask(task, landscape.horizon.startW, landscape.horizon.endW, nowW, pastDueExtensionDays);

  switch (bucket) {
    case 'past_due': {
      // Preserve original window end for reporting
      if (!task.originalWindowEnd) {
        task.originalWindowEnd = task.window?.endW ?? 0;
      }
      // Extend window end so solver can place the task
      if (task.window) {
        task.window.endW = Math.max(task.window.endW, extensionEndW);
      }
      task.isPastDue = true;
      task.pastDueDays = Math.ceil((nowW - (task.originalWindowEnd || 0)) / 86400);
      break;
    }

    case 'active':
    case 'near_horizon':
      // Normal — included in solve
      task.isPastDue = false;
      task.pastDueDays = 0;
      break;

    case 'beyond':
      // Exclude from solve — deferred
      task.includeInSolve = false;
      task.commitmentLevel = 'unscheduled';
      task.isPastDue = false;
      task.pastDueDays = 0;
      break;
  }
});
```

---

## Part 3: New Fields on CTPTask

```typescript
// Add to CTPTask:
public originalWindowEnd: number = 0;    // preserved when window is auto-extended
public isPastDue: boolean = false;       // window end was before now
public pastDueDays: number = 0;          // how many days past the original window end
public horizonBucket: 'past_due' | 'active' | 'near_horizon' | 'beyond' | '' = '';
```

Initialize in constructor:

```typescript
this.originalWindowEnd = 0;
this.isPastDue = false;
this.pastDueDays = 0;
this.horizonBucket = '';
```

---

## Part 4: Solve Response

Include horizon info and per-task past due data in the solve response.

### Summary level

```json
{
  "summary": {
    "horizonStart": "2026-03-08T00:00:00Z",
    "horizonEnd": "2026-03-24T00:00:00Z",
    "horizonDays": 16,
    "horizonMode": "rolling",
    "pastDueTasks": 3,
    "deferredTasks": 8,
    "totalTasks": 70,
    "includedTasks": 62
  }
}
```

### Per task

```json
{
  "key": "T-1001-WELD",
  "isPastDue": true,
  "pastDueDays": 2,
  "originalWindowEnd": "2026-03-08T17:00:00Z",
  "effectiveWindowEnd": "2026-03-15T00:00:00Z",
  "horizonBucket": "past_due"
}
```

For deferred tasks:

```json
{
  "key": "T-2001-MACHINE",
  "horizonBucket": "beyond",
  "included": false,
  "feasible": false
}
```

---

## Part 5: UI — Horizon Display

### Gantt horizon markers

Show vertical lines on the Gantt marking the horizon boundaries:

```
│← horizon start          horizon end →│
│                                       │
│  [task bars in active range]          │  [dimmed: beyond horizon]
│                                       │
```

Tasks beyond the horizon are dimmed or hidden on the Gantt. A toggle: "Show deferred tasks" renders them faded.

### Task table — past due indicator

Past due tasks get a visual flag:

```typescript
// In task status badge or as a separate indicator:
{task.isPastDue && (
  <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 600, marginLeft: 4 }}>
    {task.pastDueDays}d late
  </span>
)}
```

### Task table — deferred indicator

Tasks beyond the horizon:

```typescript
{task.horizonBucket === 'beyond' && (
  <span style={{ color: C.textDim, fontSize: 10, fontStyle: 'italic' }}>
    Deferred
  </span>
)}
```

### Filter chips

Add to the Status filter row:

```
[All] [Running] [On Hold] [Dispatched] [Pinned] [Scheduled] [Infeasible] [Past Due] [Deferred]
```

`Past Due` shows tasks with `isPastDue: true`. `Deferred` shows tasks with `horizonBucket: 'beyond'`.

### Horizon settings in Settings panel

In the General section of the Settings panel:

```
── Horizon ─────────────────────────────
  Start:    [NOW-2d     ▾]    ← dropdown: NOW, NOW-1d, NOW-2d, NOW+1d, fixed date
  Duration: [16         ] days
  Past due extension: [5] days

  Current horizon: Mar 8 – Mar 24 (16 days)
  3 past due tasks (windows extended to Mar 15)
  8 tasks deferred (beyond horizon)
```

---

## Part 6: Orders and Past Due

When an order's due date is past, the order-level status should reflect it:

```typescript
function deriveOrderStatus(order: any): string {
  const now = Date.now();
  const due = new Date(order.dueDate).getTime();
  
  if (order.fillRate >= 0.99) return 'on-track';     // fully scheduled
  if (due < now) return 'past-due';                   // due date passed, not complete
  if (order.fillRate < 0.5 || due - now < 48 * 3600 * 1000) return 'at-risk';
  return 'on-track';
}
```

The Orders tab shows past due orders with a red indicator. The planner can see which orders are driving the past due tasks.

---

## Part 7: Interaction with Commitment Stack

The horizon bucketing runs AFTER `applyCommitmentStack` but only affects uncommitted tasks:

```
1. applyCommitmentStack()     → derive commitment levels
2. bucketByHorizon()          → bucket uncommitted tasks
3. unschedule planned tasks   → back to pool
4. Pass 1: anchor committed   → running/dispatched/pinned placed
5. Pass 2: solver fills rest  → active + past_due tasks scheduled
```

Committed tasks are NEVER deferred by the horizon. A running task that's technically "beyond horizon" is still running — the horizon doesn't change floor reality. Only uncommitted (planned/unscheduled) tasks are subject to horizon bucketing.

```typescript
// In bucketByHorizon:
landscape.tasks.forEach(task => {
  // Skip committed tasks entirely
  if (['running', 'on_hold', 'dispatched', 'pinned', 'completed'].includes(task.commitmentLevel)) {
    task.horizonBucket = 'active';  // always active
    return;
  }
  
  // Bucket uncommitted tasks
  task.horizonBucket = bucketTask(task, ...);
  // ... apply past due extension or defer
});
```

---

## Part 8: Migration — Existing Tenants

### Remove `CTPRollingHorizon`

The `CTPRollingHorizon` class in `horizon.ts` is unused legacy code. Remove it. The regular `CTPHorizon` with `set(start, end)` handles everything — the resolve logic computes start and end from the new config format and calls `landscape.setHorizon(resolvedStart, resolvedEnd)` just like today.

### Convert existing horizon configs

Each tenant currently has a fixed `horizonStart` and `horizonEnd` (either in `appSettings.json` or hardcoded in the hydrator). Convert to the new format. Calculate `maxDays` from the existing date range.

**Stafford Engineering:**
```json
{
  "horizon": {
    "start": "2026-03-17",
    "maxDays": 14,
    "pastDueExtensionDays": 5
  }
}
```
Job shop with 15 orders, tight due dates. 14-day window covers the active work. 5-day extension gives past due orders a work week to fit in.

**Willoughby Manufacturing (Demo):**
```json
{
  "horizon": {
    "start": "2026-02-10",
    "maxDays": 14,
    "pastDueExtensionDays": 5
  }
}
```
Demo dataset — fixed start for consistency. Same 14-day window. Switch to `"NOW"` when demoing rolling behavior.

**Acme Outpatient Healthcare:**
```json
{
  "horizon": {
    "start": "2026-03-17",
    "maxDays": 7,
    "pastDueExtensionDays": 2
  }
}
```
Weekly surgery schedule. 7-day horizon. 2-day extension — past due surgeries need to be rescheduled quickly.

**HRMD Sports:**
```json
{
  "horizon": {
    "start": "2026-03-17",
    "maxDays": 30,
    "pastDueExtensionDays": 7
  }
}
```
Season schedule with 77 games across 58 resources. 30-day window covers the active season block. 7-day extension for rainout rescheduling.

**Summit Pharma:**
```json
{
  "horizon": {
    "start": "2026-03-17",
    "maxDays": 21,
    "pastDueExtensionDays": 5
  }
}
```
Batch pharmaceutical manufacturing. 21-day window covers batch cycles. 5-day extension for delayed batches.

### Where the config lives

Add the `horizon` section to each tenant's `appSettings.json`. The hydrator reads it when building the landscape:

```typescript
// In the hydrator or config service:
const horizonConfig = appSettings.horizon || null;

// If no horizon config, fall back to existing fixed dates (backward compatible)
if (!horizonConfig) {
  // Use existing hardcoded horizonStart/horizonEnd
  landscape.setHorizon(existingStart, existingEnd);
} else {
  const timezone = locale?.timezone || 'UTC';
  const start = resolveHorizonStart(horizonConfig.start, timezone);
  const end = start.plus({ days: horizonConfig.maxDays });
  landscape.setHorizon(start, end);
}
```

### `pastDueExtensionDays` minimum

`pastDueExtensionDays` must be at least 1. If set to 0, past due tasks have zero feasible window and are always infeasible — defeating the purpose. The parser enforces the minimum:

```typescript
const pastDueExtensionDays = Math.max(1, horizonConfig.pastDueExtensionDays ?? 5);
```

### All tenants start with fixed dates

All five tenants start with fixed start dates (their current values). This preserves existing demo behavior — the schedule looks the same. When ready for rolling behavior, change `"start"` to `"NOW"` or `"NOW-2d"`. No other changes needed.

### Migration checklist

- [ ] Remove `CTPRollingHorizon` class from `horizon.ts`
- [ ] Add `horizon` section to Stafford `appSettings.json`
- [ ] Add `horizon` section to Willoughby `appSettings.json`
- [ ] Add `horizon` section to Acme `appSettings.json`
- [ ] Add `horizon` section to HRMD `appSettings.json`
- [ ] Add `horizon` section to Summit `appSettings.json`
- [ ] Hydrator reads `horizon` config and resolves start/end
- [ ] Fallback to existing fixed dates when no `horizon` config present
- [ ] Verify all 5 tenants solve correctly after migration
- [ ] `pastDueExtensionDays` enforced minimum of 1

---

## Verification

### Horizon resolution
- [ ] `"NOW"` resolves to start of today in tenant timezone
- [ ] `"NOW-2d"` resolves to 2 days ago
- [ ] `"NOW+3d"` resolves to 3 days from now
- [ ] Fixed ISO date resolves correctly
- [ ] Invalid format falls back to NOW
- [ ] `maxDays` correctly sets horizon end
- [ ] Horizon applied to landscape before solve

### Task bucketing
- [ ] Past due tasks: window end before now → `isPastDue: true`, window extended
- [ ] Active tasks: window overlaps horizon → normal solve
- [ ] Near horizon tasks: window starts in horizon, ends past it → included
- [ ] Beyond horizon tasks: window starts after horizon end → `includeInSolve: false`
- [ ] `pastDueDays` calculated correctly
- [ ] `originalWindowEnd` preserved (not overwritten on re-solve)

### Past due extension
- [ ] Past due task window extended to `now + pastDueExtensionDays`
- [ ] Extended tasks can be placed by solver
- [ ] Tasks past due beyond extension buffer → infeasible (no capacity in extended window)
- [ ] Solve response shows `isPastDue`, `pastDueDays`, `originalWindowEnd`, `effectiveWindowEnd`

### Commitment stack interaction
- [ ] Committed tasks never deferred by horizon
- [ ] Running task beyond horizon stays running (not deferred)
- [ ] Only planned/unscheduled tasks subject to bucketing

### Deferred tasks
- [ ] Beyond-horizon tasks visible in task table as "Deferred"
- [ ] Deferred tasks not included in solve (no feasibility calculation)
- [ ] Deferred tasks don't appear on Gantt (or dimmed if toggle on)
- [ ] Deferred count in solve summary

### UI
- [ ] Gantt shows horizon boundary markers
- [ ] Past due tasks show "Nd late" indicator
- [ ] Deferred tasks show "Deferred" label
- [ ] Filter chips include Past Due and Deferred
- [ ] Settings panel shows horizon config with live preview
- [ ] Orders tab shows past due status

### Backward compatibility
- [ ] Tenants without horizon config work exactly as before
- [ ] No horizon section → no bucketing, no past due extension, no deferred
- [ ] Adding horizon config to existing tenant doesn't break solve

---

*Build order: Part 1 horizon resolver (~20 min), Part 2 task bucketing + past due extension (~30 min), Part 3 task fields (~10 min), Part 4 solve response (~20 min), Part 5 UI indicators (~30 min), Part 6 order status (~10 min), Part 7 commitment interaction (~10 min), Part 8 backward compat (~10 min). Total: ~2.5 hours.*
