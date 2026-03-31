# Spec: Resource Downtime Management

**What it does:** Allow planners to mark resources as down (with optional expected up time), view active downtime segments, and bring resources back up. Uses the existing assignment model — a downtime is a `MAINTENANCE` assignment on the resource. The Gantt shows blocked regions.

**Size:** ~2 hours (backend endpoints + UI editor)
**Depends on:** Existing assignment model (`CTPAssignmentConstants.MAINTENANCE = 8`), resource agenda

---

## Implementation Notes (pre-build review)

1. **`MAINTENANCE` spelling** — The constant is `CTPAssignmentConstants.MAINTENANCE` (with an 'E'). Not `MAINTANCE`. Use this throughout.

2. **`resource.assignments` null-check + init** — `CTPResource.assignments` is typed `CTPAssignments | null`. Always null-check and init before use:
   ```typescript
   if (!resource.assignments) resource.assignments = new CTPAssignments();
   ```

3. **Linked-list walk pattern** — `CTPAssignments` extends `CTPIntervals` which extends `LinkedList`. There is no `.forEach()` on it. Use the same pattern as `landscape.ts` and `ctp.service.ts` everywhere in this spec:
   ```typescript
   let node = resource.assignments.head;
   while (node) {
     const assignment = node.data;
     // ... work with assignment ...
     node = node.next;
   }
   ```

4. **`resource.assignments.remove()` takes a `ListNode`, not the data item** — To delete a node during iteration, capture the node reference before advancing:
   ```typescript
   let node = resource.assignments.head;
   while (node) {
     const next = node.next;
     if (/* should delete */) resource.assignments.deleteNode(node);
     node = next;
   }
   ```

5. **Frontend gets downtime data from solve response, not engine objects** — The Gantt has no access to engine objects or `CTPAssignmentConstants`. Downtime data must be included in `extractResults` output. Add a `downtimes` array and `isCurrentlyDown` flag to each resource entry in `resourceUtilization`. See Part 2 for details.

6. **`freedHours` fix** — The original calculation `(horizon.endW - upTimeW) / 3600` is wrong (it measures time until horizon end, not time freed). Track the original `endW` before trimming and compute the delta:
   ```typescript
   const originalEndW = assignment.endW;
   assignment.endW = upTimeW;
   freedHours += Math.round((originalEndW - upTimeW) / 3600 * 10) / 10;
   ```

7. **Route ordering** — `GET /ctp/resources/downtimes` (literal) must be registered in the controller **before** `GET /ctp/resources/:resourceKey/downtimes` (parameterized). NestJS matches literal segments first only when declared first.

8. **Auto-hold uses `this.holdTask()`** — Don't mutate task fields directly in Part 4. Call `this.holdTask(at.taskKey, reason, estimatedResumeTime)` to keep commitment stack logic in one place (also sets `holdStart`).

9. **`diagnose.dto.ts` command type union** — Add `resource_downtime` and `resource_uptime` to `RecommendationCommand.type` and handle them in the command sequencer (`executeCommands` / `applyRecommendation`).

10. **`openDowntimeEditor` = `setDowntimeResource`** — Define a local helper in App so the Gantt click handler has a named function to call:
    ```typescript
    const openDowntimeEditor = useCallback((resourceKey: string) => {
      setDowntimeResource(resourceKey);
    }, []);
    ```

---

## Part 1: Backend Endpoints

### Controller ordering note

Register the all-resources route **before** the per-resource route so `GET /ctp/resources/downtimes` isn't captured as `:resourceKey = "downtimes"`:

```typescript
@Get('resources/downtimes')     // MUST come first
getAllDowntimes() { ... }

@Get('resources/:resourceKey/downtimes')
getDowntimes(@Param('resourceKey') resourceKey: string) { ... }
```

### Mark Resource Down

```
POST /ctp/resources/:resourceKey/downtime
{
  "startTime": "2026-02-11T13:00:00Z",  // or omit for "now"
  "endTime": "2026-02-11T17:00:00Z",    // or omit for "down indefinitely"
  "reason": "Spindle bearing replacement"
}
```

**Controller:**

```typescript
@Post('resources/:resourceKey/downtime')
@ApiOperation({ summary: 'Mark a resource as down for a time period' })
@ApiParam({ name: 'resourceKey', description: 'Resource to mark down' })
addDowntime(
  @Param('resourceKey') resourceKey: string,
  @Body() body: { startTime?: string; endTime?: string; reason?: string },
) {
  return this.ctpService.addResourceDowntime(resourceKey, body);
}
```

**Service:**

```typescript
addResourceDowntime(resourceKey: string, body: { startTime?: string; endTime?: string; reason?: string }): any {
  const landscape = this.ensureLandscape();
  const resource = landscape.resources?.getEntity(resourceKey);
  if (!resource) throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);

  const startW = body.startTime
    ? CTPDateTime.fromDateTime(body.startTime)
    : CTPDateTime.fromDateTime(DateTime.now().toISO()!);
  const endW = body.endTime
    ? CTPDateTime.fromDateTime(body.endTime)
    : landscape.horizon.endW;  // down indefinitely

  // Create the maintenance assignment (note: MAINTENANCE, not MAINTANCE)
  const assignment = new CTPInterval();
  assignment.startW = startW;
  assignment.endW = endW;
  assignment.name = body.reason || 'Downtime';
  assignment.type = CTPAssignmentConstants.MAINTENANCE;

  // Null-check and init assignments linked list
  if (!resource.assignments) resource.assignments = new CTPAssignments();
  resource.assignments.add(assignment);
  resource.recompute = true;

  // Find tasks affected by this downtime
  const affectedTasks: any[] = [];
  landscape.tasks.forEach(task => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED) return;
    if (task.type === CTPTaskTypeConstants.SET_UP || task.type === CTPTaskTypeConstants.TEAR_DOWN) return;

    task.capacityResources?.forEach(tr => {
      if (tr.scheduledResource === resourceKey && task.scheduled) {
        const taskStart = task.scheduled.startW;
        const taskEnd = task.scheduled.endW;
        if (taskStart < endW && taskEnd > startW) {
          affectedTasks.push({
            taskKey: task.key,
            taskName: task.name,
            orderKey: task.linkId?.name ?? null,
            commitmentLevel: task.commitmentLevel,
            scheduledStart: CTPDateTime.toDateTime(taskStart).toISO(),
            scheduledEnd: CTPDateTime.toDateTime(taskEnd).toISO(),
          });
        }
      }
    });
  });

  // Auto-hold running tasks (see Part 4) — use holdTask() to keep commitment stack consistent
  affectedTasks.forEach(at => {
    if (at.commitmentLevel === 'running') {
      this.holdTask(at.taskKey, `Resource down: ${body.reason || 'Downtime'}`, body.endTime || undefined);
    }
  });

  return {
    status: 'ok',
    resourceKey,
    downtime: {
      startTime: CTPDateTime.toDateTime(startW).toISO(),
      endTime: body.endTime ? CTPDateTime.toDateTime(endW).toISO() : null,
      indefinite: !body.endTime,
      reason: body.reason || 'Downtime',
    },
    affectedTasks,
    affectedCount: affectedTasks.length,
  };
}
```

### Bring Resource Back Up

```
POST /ctp/resources/:resourceKey/uptime
{
  "actualUpTime": "2026-02-11T16:45:00Z"  // or omit for "now"
}
```

**Controller:**

```typescript
@Post('resources/:resourceKey/uptime')
@ApiOperation({ summary: 'Bring a resource back up — trim or remove the active downtime' })
@ApiParam({ name: 'resourceKey', description: 'Resource to bring back up' })
endDowntime(
  @Param('resourceKey') resourceKey: string,
  @Body() body: { actualUpTime?: string },
) {
  return this.ctpService.endResourceDowntime(resourceKey, body);
}
```

**Service:**

```typescript
endResourceDowntime(resourceKey: string, body: { actualUpTime?: string }): any {
  const landscape = this.ensureLandscape();
  const resource = landscape.resources?.getEntity(resourceKey);
  if (!resource) throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);

  const upTimeW = body.actualUpTime
    ? CTPDateTime.fromDateTime(body.actualUpTime)
    : CTPDateTime.fromDateTime(DateTime.now().toISO()!);

  let trimmed = false;
  let removed = false;
  let freedHours = 0;

  // Walk linked list — capture node.next before any deletion
  if (resource.assignments) {
    let node = resource.assignments.head;
    while (node) {
      const next = node.next;
      const assignment = node.data;

      if (assignment.type === CTPAssignmentConstants.MAINTENANCE && assignment.endW > upTimeW) {
        if (assignment.startW >= upTimeW) {
          // Downtime hasn't started yet — remove entirely
          freedHours += Math.round((assignment.endW - assignment.startW) / 3600 * 10) / 10;
          resource.assignments.deleteNode(node);
          removed = true;
        } else {
          // Downtime is active — trim to end at up time
          const originalEndW = assignment.endW;
          assignment.endW = upTimeW;
          freedHours += Math.round((originalEndW - upTimeW) / 3600 * 10) / 10;
          trimmed = true;
        }
      }

      node = next;
    }
  }

  resource.recompute = true;

  return {
    status: 'ok',
    resourceKey,
    upTime: CTPDateTime.toDateTime(upTimeW).toISO(),
    trimmed,
    removed,
    freedCapacityHours: Math.round(freedHours * 10) / 10,
  };
}
```

### Get Active Downtimes (per resource)

```
GET /ctp/resources/:resourceKey/downtimes
```

**Controller:** (register after `GET resources/downtimes`)

```typescript
@Get('resources/:resourceKey/downtimes')
@ApiOperation({ summary: 'Get active and upcoming downtimes for a resource' })
@ApiParam({ name: 'resourceKey' })
getDowntimes(@Param('resourceKey') resourceKey: string) {
  return this.ctpService.getResourceDowntimes(resourceKey);
}
```

**Service:**

```typescript
getResourceDowntimes(resourceKey: string): any {
  const landscape = this.ensureLandscape();
  const resource = landscape.resources?.getEntity(resourceKey);
  if (!resource) throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);

  const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
  const downtimes: any[] = [];

  if (resource.assignments) {
    let node = resource.assignments.head;
    while (node) {
      const assignment = node.data;
      if (assignment.type === CTPAssignmentConstants.MAINTENANCE) {
        const isPast = assignment.endW <= nowW;
        if (!isPast) {
          const isActive = assignment.startW <= nowW && assignment.endW > nowW;
          downtimes.push({
            startTime: CTPDateTime.toDateTime(assignment.startW).toISO(),
            endTime: assignment.endW >= landscape.horizon.endW
              ? null  // indefinite
              : CTPDateTime.toDateTime(assignment.endW).toISO(),
            indefinite: assignment.endW >= landscape.horizon.endW,
            reason: assignment.name || 'Downtime',
            status: isActive ? 'active' : 'upcoming',
            durationHours: Math.round((assignment.endW - assignment.startW) / 3600 * 10) / 10,
          });
        }
      }
      node = node.next;
    }
  }

  downtimes.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  return {
    resourceKey,
    resourceName: resource.name || resourceKey,
    downtimes,
    isCurrentlyDown: downtimes.some(d => d.status === 'active'),
  };
}
```

### Get All Downtimes Across Resources

```
GET /ctp/resources/downtimes
```

**Controller:** (register FIRST — before `GET resources/:resourceKey/downtimes`)

```typescript
@Get('resources/downtimes')
@ApiOperation({ summary: 'Get all active and upcoming downtimes across all resources' })
getAllDowntimes() {
  return this.ctpService.getAllResourceDowntimes();
}
```

**Service:**

```typescript
getAllResourceDowntimes(): any {
  const landscape = this.ensureLandscape();
  const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
  const results: any[] = [];

  landscape.resources?.forEach(resource => {
    if (!resource.assignments) return;
    let node = resource.assignments.head;
    while (node) {
      const assignment = node.data;
      if (assignment.type === CTPAssignmentConstants.MAINTENANCE && assignment.endW > nowW) {
        const isActive = assignment.startW <= nowW && assignment.endW > nowW;
        results.push({
          resourceKey: resource.key,
          resourceName: resource.name || resource.key,
          startTime: CTPDateTime.toDateTime(assignment.startW).toISO(),
          endTime: assignment.endW >= landscape.horizon.endW
            ? null
            : CTPDateTime.toDateTime(assignment.endW).toISO(),
          indefinite: assignment.endW >= landscape.horizon.endW,
          reason: assignment.name || 'Downtime',
          status: isActive ? 'active' : 'upcoming',
        });
      }
      node = node.next;
    }
  });

  results.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  return { downtimes: results, activeCount: results.filter(d => d.status === 'active').length };
}
```

### Expose downtimes in `extractResults`

The frontend Gantt reads from the solve response `resourceUtilization` array. Add downtime data there so the Gantt can render blocked regions without an extra API call:

```typescript
// In extractResults(), inside the landscape.resources.forEach() loop,
// add to the resourceUtilization entry:

const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);
const resourceDowntimes: any[] = [];
if (resource.assignments) {
  let node = resource.assignments.head;
  while (node) {
    const a = node.data;
    if (a.type === CTPAssignmentConstants.MAINTENANCE && a.endW > nowW) {
      resourceDowntimes.push({
        startTime: CTPDateTime.toDateTime(a.startW).toISO(),
        endTime: a.endW >= landscape.horizon.endW ? null : CTPDateTime.toDateTime(a.endW).toISO(),
        indefinite: a.endW >= landscape.horizon.endW,
        reason: a.name || 'Downtime',
        status: (a.startW <= nowW && a.endW > nowW) ? 'active' : 'upcoming',
      });
    }
    node = node.next;
  }
}

resourceUtilization.push({
  resourceKey: resource.key,
  // ... existing fields ...
  downtimes: resourceDowntimes,
  isCurrentlyDown: resourceDowntimes.some(d => d.status === 'active'),
});
```

---

## Part 2: Gantt — Downtime Visualization

Downtime data comes from `solveResult.resourceUtilization` — the Gantt already has access to this. No engine objects or constants needed on the frontend.

```typescript
// In the Gantt resource row renderer, after rendering task bars:
// resourceUtil = the entry from solveResult.resourceUtilization for this resource
const downtimes = resourceUtil?.downtimes || [];

{downtimes.map((dt: any, i: number) => {
  const left = timeToPixel(new Date(dt.startTime).getTime() / 1000);
  const rightEdge = dt.endTime ? timeToPixel(new Date(dt.endTime).getTime() / 1000) : ganttWidth;
  const width = rightEdge - left;

  return (
    <div
      key={`dt-${i}`}
      style={{
        position: 'absolute',
        left, width,
        top: 0, bottom: 0,
        background: `repeating-linear-gradient(
          45deg, transparent, transparent 4px,
          rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.15) 8px
        )`,
        borderLeft: '2px solid #ef4444',
        borderRight: dt.indefinite ? 'none' : '2px solid #ef4444',
        cursor: 'pointer',
        zIndex: 1,
        pointerEvents: 'all',
      }}
      title={`⚠ ${dt.reason} — ${dt.indefinite ? 'down indefinitely' : fmtDate(dt.startTime) + ' → ' + fmtDate(dt.endTime)}`}
      onClick={() => openDowntimeEditor(resource.resourceKey)}
    />
  );
})}
```

Note: `left` and `width` use the same `timeToPixel` helper already used for task bars, converting ISO strings → epoch seconds → pixels.

If the downtime is indefinite, the right border is omitted and the stripes extend to the horizon.

### Resource row indicator

```typescript
// Next to the resource name in the Gantt left column:
// resourceUtil.isCurrentlyDown comes from the solve response
{resourceUtil?.isCurrentlyDown && (
  <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 4 }} title="Resource is down">⚠</span>
)}
```

### `openDowntimeEditor` helper in App

```typescript
const openDowntimeEditor = useCallback((resourceKey: string) => {
  setDowntimeResource(resourceKey);
}, []);
```

Pass it down through `ScheduleTab` → `GanttChart` as a prop.

---

## Part 3: Downtime Editor Panel

A panel (slide-over or dialog) accessible from:
- Right-click resource on Gantt → "Manage Downtime"
- Click on a downtime region in the Gantt
- Resource context menu → "Manage Downtime"

### Layout

```
┌─ Downtime: CNC-01 (DMG Mori 5-Axis) ────────────────────────┐
│                                                                │
│  ── Active Downtimes ──────────────────────────────────────── │
│                                                                │
│  ⚠ Spindle bearing replacement                                │
│    Down since: Feb 11 13:00                                    │
│    Expected up: Feb 11 17:00 (4h)                             │
│    3 tasks affected                                            │
│    [▶ Bring Up Now]  [▶ Bring Up At...]                       │
│                                                                │
│  ── Schedule Downtime ─────────────────────────────────────── │
│                                                                │
│  Reason:  [                               ]                    │
│  From:    [2026-02-12 07:00  ] or [Now]                       │
│  Until:   [2026-02-12 12:00  ] or [Indefinite]                │
│                                                                │
│  ⚠ 2 tasks scheduled during this window                       │
│     T-1004-H-MACHINE (3.3h)                                   │
│     T-FLEX-MACHINE (3.0h)                                      │
│                                                                │
│                            [Cancel]  [⚠ Mark Down]            │
└────────────────────────────────────────────────────────────────┘
```

### Key interactions

**"Bring Up Now"** — calls `POST /ctp/resources/:key/uptime` with no body (uses current time). On success, call `refreshState()` to reload the solve response. Toast: "CNC-01 is back online."

**"Bring Up At..."** — reveals a `datetime-local` input (reuse `toLocalDatetimeInput` helper from the Hold dialog). Calls `POST /ctp/resources/:key/uptime` with `actualUpTime`. For after-the-fact recording.

**"Mark Down"** — calls `POST /ctp/resources/:key/downtime`. The response includes `affectedTasks` — show these in the panel before the user has to confirm. If any affected task has `commitmentLevel === 'running'`, display the warning: "⚠ Running task will be put on hold automatically."

**Affected tasks preview** — shown live from the `POST /downtime` response `affectedTasks` field. No separate preview endpoint needed — the endpoint itself returns what was affected.

### State in App

```typescript
const [downtimeResource, setDowntimeResource] = useState<string | null>(null);
const [downtimeData, setDowntimeData] = useState<any>(null);

// Load downtimes when panel opens
useEffect(() => {
  if (!downtimeResource) { setDowntimeData(null); return; }
  api(`/ctp/resources/${downtimeResource}/downtimes`).then(setDowntimeData);
}, [downtimeResource]);
```

---

## Part 4: Downtime + Commitment Stack Interaction

When a resource goes down and has tasks on it, the commitment stack determines what happens:

| Task commitment level | What happens on resource down |
|---|---|
| Running | Auto-hold: task goes ON_HOLD with reason "Resource down: [reason]" |
| Dispatched | Stays dispatched but flagged as blocked. Planner decides: revert + redirect, or wait |
| Pinned | Becomes infeasible on next solve (pinned to a resource that's unavailable) |
| Planned | Solver redirects on re-solve (if alternatives exist) |

### Auto-hold running tasks

Already included in the `addResourceDowntime` service method above — uses `this.holdTask()` to keep the commitment stack transition in one place. `holdTask` sets `holdStart`, `holdReason`, `estimatedResumeTime`, `wipstate`, and `commitmentLevel`.

---

## Part 5: Queue Integration

Downtime actions work through the Action Queue:

```typescript
// Shift+click "Mark Down" queues the command:
addToQueue(
  `⚠ ${resourceName} down: ${reason}`,
  { type: 'resource_downtime', resourceKey, startTime, endTime, reason }
);

// Shift+click "Bring Up Now" queues:
addToQueue(
  `▶ ${resourceName} back up`,
  { type: 'resource_uptime', resourceKey }
);
```

### Add to `diagnose.dto.ts` `RecommendationCommand.type` union:

```typescript
type: 'move_to' | 'set_window' | 'unschedule' | 'solve'
    | 'set_priority' | 'set_resource_preference'
    | 'set_order_mode' | 'pin'
    | 'dispatch' | 'start' | 'hold' | 'resume' | 'complete' | 'revert_dispatch'
    | 'resource_downtime' | 'resource_uptime';
```

Also add `resourceKey` to `RecommendationCommand` if not already present (it's already there).

### Add to command sequencer in `applyRecommendation`:

```typescript
case 'resource_downtime':
  this.addResourceDowntime(cmd.resourceKey!, {
    startTime: cmd.startTime,
    endTime: cmd.windowEnd ?? undefined,
    reason: cmd.strategy,  // reuse strategy field for reason string
  });
  actionsApplied.push({ type: cmd.type, result: 'ok' });
  break;

case 'resource_uptime':
  this.endResourceDowntime(cmd.resourceKey!, {});
  actionsApplied.push({ type: cmd.type, result: 'ok' });
  break;
```

### Machine breakdown macro example:

```
1. resource_downtime: CNC-01 down
2. set_resource_preference: exclude CNC-01 on affected tasks
3. set_resource_preference: prefer CNC-02 on affected tasks
4. solve: targeted
```

One click, atomic execution, full machine breakdown protocol.

---

## Part 6: Resource Agenda — Downtime Display

The resource agenda panel shows assignments by day. Downtime assignments appear alongside task assignments, styled differently. A multi-day downtime appears on each day it spans, clipped to the day boundaries.

### Include downtimes in the agenda response

The agenda endpoint (or the data the agenda panel reads) already shows task assignments per day. Add maintenance assignments to the same list:

```typescript
// In the agenda builder (wherever daily assignments are assembled):
// After adding task assignments, add downtime assignments

let node = resource.assignments?.head;
while (node) {
  const assignment = node.data;
  if (assignment.type === CTPAssignmentConstants.MAINTENANCE) {
    // Clip to this day's boundaries
    const clippedStart = Math.max(assignment.startW, dayStartW);
    const clippedEnd = Math.min(assignment.endW, dayEndW);

    if (clippedStart < clippedEnd) {
      agendaItems.push({
        type: 'downtime',
        startTime: CTPDateTime.toDateTime(clippedStart).toISO(),
        endTime: assignment.endW >= landscape.horizon.endW
          ? null  // indefinite — show no end time
          : CTPDateTime.toDateTime(clippedEnd).toISO(),
        durationSeconds: clippedEnd - clippedStart,
        reason: assignment.name || 'Downtime',
        indefinite: assignment.endW >= landscape.horizon.endW,
        spansMultipleDays: (assignment.endW - assignment.startW) > 86400,
        isFullDay: clippedStart <= dayStartW && clippedEnd >= dayEndW,
      });
    }
  }
  node = node.next;
}
```

### Agenda rendering

Downtime entries render with red/amber styling, distinct from task assignments:

```
── Monday Feb 11 ──────────────────────────
  07:00 - 11:00  ✓ T-1001-H-MACHINE (completed)
  11:00 - 13:00  ● T-1001-H-DEBURR (running 40%)
  13:00 - 17:00  ⚠ DOWN: Spindle bearing replacement

── Tuesday Feb 12 ─────────────────────────
  07:00 - 17:00  ⚠ DOWN: Spindle bearing replacement (all day)

── Wednesday Feb 13 ────────────────────────
  07:00 - 17:00  ⚠ DOWN: Spindle bearing replacement
  17:00 →        Available
```

```typescript
// In the agenda item renderer:
if (item.type === 'downtime') {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 8px', borderRadius: 6,
      background: 'rgba(239,68,68,0.1)',
      borderLeft: '3px solid #ef4444',
      fontSize: 11, color: '#ef4444',
    }}>
      <span style={{ fontWeight: 600 }}>⚠ DOWN</span>
      <span style={{ color: C.text }}>{item.reason}</span>
      <span style={{ marginLeft: 'auto', color: C.textDim }}>
        {item.isFullDay
          ? '(all day)'
          : item.indefinite
            ? `${fmtTime(item.startTime)} → indefinite`
            : `${fmtTime(item.startTime)} – ${fmtTime(item.endTime)}`
        }
      </span>
    </div>
  );
}
```

Clicking a downtime entry in the agenda opens the downtime editor panel for that resource.

---

## Part 7: Data Model — Downtimes Are Assignments, Not Stored Separately

Downtimes are derived from MAINTENANCE assignments on the resource — there is no separate downtime table, JSON file, or data store.

### Single source of truth

```
Planner marks down → creates MAINTENANCE assignment on resource.assignments
Solve response     → scans resource.assignments for MAINTENANCE, outputs downtimes[]
Agenda panel       → reads downtimes from solve response
Gantt              → reads downtimes from solve response
Bring up           → trims/removes the MAINTENANCE assignment
```

The assignment IS the downtime. No duplication.

### Persistence caveat

Downtimes live in the in-memory landscape. They survive across solves (via `preserveLandscape`) but NOT across:
- Server restarts
- Config reloads (`preserveLandscape: false`)
- Tenant switches

This is correct for now. When Data Integration Phase 2 is built, downtime events would be persisted in the database and re-applied on sync. For the current architecture, in-memory is the right place.

### Solve response inclusion

In `extractResults()`, when building `resourceUtilization`, derive downtimes from the resource's assignments:

```typescript
// Inside the resource utilization loop:
const downtimes: any[] = [];
const nowW = CTPDateTime.fromDateTime(DateTime.now().toISO()!);

if (resource.assignments) {
  let node = resource.assignments.head;
  while (node) {
    const a = node.data;
    if (a.type === CTPAssignmentConstants.MAINTENANCE) {
      const isIndefinite = a.endW >= landscape.horizon.endW;
      downtimes.push({
        startTime: CTPDateTime.toDateTime(a.startW).toISO(),
        endTime: isIndefinite ? null : CTPDateTime.toDateTime(a.endW).toISO(),
        indefinite: isIndefinite,
        reason: a.name || 'Downtime',
        durationHours: Math.round((a.endW - a.startW) / 3600 * 10) / 10,
      });
    }
    node = node.next;
  }
}

const isCurrentlyDown = downtimes.some(d => {
  const startW = CTPDateTime.fromDateTime(d.startTime);
  const endW = d.endTime ? CTPDateTime.fromDateTime(d.endTime) : landscape.horizon.endW;
  return startW <= nowW && endW > nowW;
});

// Add to the resource entry:
resourceUtilization.push({
  // ... existing fields ...
  downtimes,
  isCurrentlyDown,
});
```

---

## Part 8: Tasks Stay Until Next Solve

Marking a resource down does NOT auto-unschedule or auto-move any tasks. Tasks remain at their scheduled positions. The Gantt shows tasks sitting inside the downtime region — this is the visual conflict the planner needs to see and resolve.

On the next solve:
- **Planned tasks** on the downed resource get redirected to alternatives (if available) or become infeasible
- **Pinned tasks** on the downed resource become infeasible (pinned to unavailable capacity)
- **Dispatched tasks** on the downed resource stay in place but are flagged as conflicting
- **Running tasks** were already auto-held in Part 4

The planner sees the conflict and decides when to act:
- Re-solve immediately to redirect planned work
- Manually redirect dispatched/pinned tasks using existing tools (revert, unpin, redirect)
- Wait for the resource to come back up and re-solve then

No cascading side effects from marking a resource down. Just the fact (downtime created) and the visibility (tasks overlapping it).

---

## Verification

### Backend
- [ ] `POST /resources/:key/downtime` creates MAINTENANCE assignment (correct spelling)
- [ ] Without endTime, downtime extends to horizon end (indefinite)
- [ ] Response includes affected task count and details
- [ ] Running tasks auto-held via `holdTask()` when resource goes down
- [ ] `POST /resources/:key/uptime` trims active downtime to actual up time
- [ ] Without actualUpTime, uses current time
- [ ] Future downtime (not yet started) removed entirely by uptime call
- [ ] `freedCapacityHours` = time trimmed from downtime, not time to horizon end
- [ ] `GET /resources/:key/downtimes` returns active and upcoming (past skipped)
- [ ] `GET /resources/downtimes` returns all across all resources
- [ ] `GET /resources/downtimes` route registered before `GET /resources/:key/downtimes`
- [ ] `extractResults` includes `downtimes` array and `isCurrentlyDown` on each resource
- [ ] Downtimes derived from MAINTENANCE assignments — no separate storage

### Gantt visualization
- [ ] Downtime shows as striped red region on resource row
- [ ] Indefinite downtime extends to horizon (no right border)
- [ ] Clicking downtime region opens the editor (`openDowntimeEditor` → `setDowntimeResource`)
- [ ] Resource label shows ⚠ when `isCurrentlyDown` is true
- [ ] Downtime region renders behind task bars (z-index=1, task bars higher)
- [ ] Tasks scheduled during downtime still visible (not auto-removed)

### Resource agenda
- [ ] Downtime entries appear alongside task assignments in daily view
- [ ] Multi-day downtime appears on each day, clipped to day boundaries
- [ ] Full-day downtime shows "(all day)"
- [ ] Indefinite downtime shows "→ indefinite"
- [ ] Downtime entries styled with red/amber (distinct from task entries)
- [ ] Clicking a downtime entry opens the downtime editor

### Downtime editor
- [ ] Panel opens from right-click resource context menu
- [ ] Shows active downtimes with bring-up actions
- [ ] "Bring Up Now" calls uptime with no body, refreshes state
- [ ] "Bring Up At..." reveals datetime-local input, calls uptime with `actualUpTime`
- [ ] "Mark Down" shows `affectedTasks` from response
- [ ] Running task warning shown when `commitmentLevel === 'running'` in affected tasks
- [ ] Affected task count accurate

### Tasks stay until solve
- [ ] Marking resource down does NOT unschedule any tasks
- [ ] Tasks remain visible on Gantt inside the downtime region
- [ ] On re-solve: planned tasks redirect or become infeasible
- [ ] On re-solve: pinned tasks on downed resource become infeasible
- [ ] Dispatched tasks stay but are flagged as conflicting

### Commitment interaction
- [ ] Running task on downed resource → auto ON_HOLD via `holdTask()`
- [ ] Hold reason set to "Resource down: [reason]"
- [ ] `holdStart` stamped by `holdTask()`

### Queue integration
- [ ] `resource_downtime` and `resource_uptime` in `RecommendationCommand.type` union
- [ ] Both handled in command sequencer
- [ ] Machine breakdown macro: downtime + exclude + prefer + solve as atomic batch

### Persistence
- [ ] Downtimes survive across solves with `preserveLandscape: true`
- [ ] Downtimes cleared on config reload (`preserveLandscape: false`)
- [ ] No separate downtime storage — derived from assignments only

---

*Build order: Part 1 backend endpoints (~30 min), Part 2 Gantt visualization (~25 min), Part 3 downtime editor panel (~35 min), Part 4 commitment interaction (~10 min, already in Part 1), Part 5 queue integration (~20 min), Part 6 agenda display (~20 min), Part 7 solve response inclusion (~15 min), Part 8 is behavioral — no code, just verification. Total: ~2.5 hours.*
