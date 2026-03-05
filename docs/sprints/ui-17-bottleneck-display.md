# Sprint 17: Infeasible Task Bottleneck Display

**What it does:** When a task is infeasible, the task detail panel shows per-resource availability status and identifies the bottleneck — the scarcest resource that's blocking the task. The planner immediately sees "Anesthesiologist is the problem" instead of just "infeasible."

**Size:** ~30-45 min CC work  
**Depends on:** Existing task detail panel, solve response data  
**No new API endpoints** — computed from data already in the frontend

---

## The Problem

Current infeasible task detail shows:

```
C004-PROC                              [Infeasible ✗]
Knee Replacement — CASE-004

Errors:
• No feasible schedule
• Could Not Find Availability for Jones, CRNA
• Could Not Find Availability for Garcia, CRNA
```

The planner sees names but has to mentally piece together which resource TYPE is the bottleneck. With 4+ resources on a task (OR, surgeon, anesthesiologist, nurse), the error list doesn't tell you what to fix.

---

## The Fix

Show a resource availability breakdown grouped by resource requirement, with a bottleneck callout:

```
C004-PROC                              [Infeasible ✗]
Knee Replacement — CASE-004

Resource Availability:
┌────────────────────────────────────────────────────────┐
│  🟢 Operating Room                                     │
│     OR-01   Available 6:00-18:00          12h free     │
│     OR-02   Available 6:00-18:00          12h free     │
│                                                        │
│  🟢 Surgeon                                            │
│     Dr. Smith   Available 7:00-17:00      10h free     │
│                                                        │
│  🔴 Anesthesiologist                    ← BOTTLENECK   │
│     AN-JONES    Booked 7:00-10:30         3.5h left    │
│                 → CASE-002 (7:00-8:00)                 │
│                 → CASE-001 (8:00-10:30)                │
│     AN-GARCIA   Starts 10:00             outside gap   │
│                                                        │
│  🟢 Nurse                                              │
│     RN-01   Available 6:00-18:00          12h free     │
│     RN-02   Available 6:00-18:00          12h free     │
└────────────────────────────────────────────────────────┘

[🗺️ Where Can This Go?]
```

---

## Part 1: Compute Resource Availability Summary

Build this in the frontend from data already in the solve response. For each resource requirement on the infeasible task, check each preferred resource's availability within the task's window.

### 1a. Data sources (already in frontend)

- `task.capacityResources[]` — what the task needs (from solve response task detail)
- `task.capacityResources[].preferences[]` — which specific resources can fill each requirement
- `task.window` — the task's scheduling window (from solve response)
- `resourceUtilization[]` — each resource's assignments and availability (from solve response)
- `task.errors[]` — engine error messages (already displayed)

### 1b. Build the summary

```typescript
interface ResourceSlotSummary {
  slotIndex: number;              // index in capacityResources
  slotLabel: string;              // derived from resource group or type
  isPrimary: boolean;
  status: 'available' | 'partial' | 'blocked';
  availableMinutes: number;       // best availability across all preferences
  isBottleneck: boolean;
  preferences: PreferenceSummary[];
}

interface PreferenceSummary {
  resourceKey: string;
  resourceName: string;
  status: 'available' | 'partial' | 'blocked';
  availableMinutes: number;       // free time within task window
  blockingTasks: BlockingTask[];  // who's using this resource
  note?: string;                  // e.g. "Starts 10:00 — outside maxGap window"
}

interface BlockingTask {
  taskKey: string;
  taskName: string;
  start: string;                  // display time
  end: string;                    // display time
}
```

### 1c. Computation function

```typescript
function computeBottleneckSummary(
  task: TaskResult,
  allResources: ResourceUtilization[],
  allTasks: TaskResult[],
): ResourceSlotSummary[] {
  const summaries: ResourceSlotSummary[] = [];

  if (!task.capacityResources || !task.windowStart || !task.windowEnd) return summaries;

  const windowStart = new Date(task.windowStart).getTime() / 1000;
  const windowEnd = new Date(task.windowEnd).getTime() / 1000;
  const windowMinutes = (windowEnd - windowStart) / 60;
  const taskDuration = task.durationMinutes || 0;

  task.capacityResources.forEach((slot, idx) => {
    const prefSummaries: PreferenceSummary[] = [];
    let bestAvailMinutes = 0;

    const prefs = slot.preferences || [];
    // If slot has a direct resource (no preferences), treat it as a single preference
    const effectivePrefs = prefs.length > 0 ? prefs : (slot.resource ? [{ resourceKey: slot.resource }] : []);

    for (const pref of effectivePrefs) {
      const resUtil = allResources.find(r => r.resourceKey === pref.resourceKey);
      if (!resUtil) continue;

      // Calculate available minutes within task window
      let availMinutes = 0;
      const blocking: BlockingTask[] = [];

      if (resUtil.assignments) {
        // Find assignments that overlap with task window
        for (const assign of resUtil.assignments) {
          const aStart = new Date(assign.start).getTime() / 1000;
          const aEnd = new Date(assign.end).getTime() / 1000;

          if (aEnd > windowStart && aStart < windowEnd) {
            const blockTask = allTasks.find(t => t.taskKey === assign.taskKey);
            blocking.push({
              taskKey: assign.taskKey,
              taskName: blockTask?.name || assign.taskKey,
              start: fmtTime(assign.start),
              end: fmtTime(assign.end),
            });
          }
        }
      }

      // Compute free time: window duration minus overlapping assignment duration
      if (resUtil.netAvailable) {
        for (const avail of resUtil.netAvailable) {
          const aStart = Math.max(new Date(avail.start).getTime() / 1000, windowStart);
          const aEnd = Math.min(new Date(avail.end).getTime() / 1000, windowEnd);
          if (aEnd > aStart) {
            availMinutes += (aEnd - aStart) / 60;
          }
        }
      }

      // Check if resource's working hours even cover the task window
      let note: string | undefined;
      if (resUtil.availability && resUtil.availability.length > 0) {
        const firstAvail = new Date(resUtil.availability[0].start).getTime() / 1000;
        if (firstAvail > windowStart) {
          const startTime = fmtTime(resUtil.availability[0].start);
          note = `Starts ${startTime}`;
        }
      }

      const status = availMinutes >= taskDuration ? 'available'
                   : availMinutes > 0 ? 'partial'
                   : 'blocked';

      if (availMinutes > bestAvailMinutes) bestAvailMinutes = availMinutes;

      prefSummaries.push({
        resourceKey: pref.resourceKey,
        resourceName: resUtil.resourceName || pref.resourceKey,
        status,
        availableMinutes: Math.round(availMinutes),
        blockingTasks: blocking,
        note,
      });
    }

    // Slot status: best preference determines slot status
    const slotStatus = bestAvailMinutes >= taskDuration ? 'available'
                     : bestAvailMinutes > 0 ? 'partial'
                     : 'blocked';

    summaries.push({
      slotIndex: idx,
      slotLabel: deriveSlotLabel(slot, prefSummaries),
      isPrimary: slot.isPrimary || false,
      status: slotStatus,
      availableMinutes: Math.round(bestAvailMinutes),
      isBottleneck: false,  // set below
      preferences: prefSummaries,
    });
  });

  // Identify bottleneck: the resource slot with least availability
  if (summaries.length > 0) {
    const sorted = [...summaries].sort((a, b) => a.availableMinutes - b.availableMinutes);
    sorted[0].isBottleneck = true;
  }

  return summaries;
}
```

### 1d. Derive slot label

Group label comes from the resource type or common prefix. Simple heuristic:

```typescript
function deriveSlotLabel(slot: any, prefs: PreferenceSummary[]): string {
  // If slot has a label/type from the solve response, use it
  if (slot.label) return slot.label;

  // Try common prefix of resource names
  if (prefs.length === 0) return 'Resource';
  if (prefs.length === 1) return prefs[0].resourceName;

  // Find common prefix
  const names = prefs.map(p => p.resourceName);
  let prefix = names[0];
  for (let i = 1; i < names.length; i++) {
    while (!names[i].startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
  }
  prefix = prefix.replace(/[\s\-_]+$/, ''); // trim trailing separators
  return prefix || 'Resource Group';
}
```

---

## Part 2: UI Component

### 2a. Show ONLY for infeasible tasks

The bottleneck breakdown only appears when the task is infeasible (state = NOT_SCHEDULED and has errors). For scheduled tasks, show the existing assignment info instead.

### 2b. Layout

Inside the task detail slide-over, after the status badge area and before the existing error list:

```typescript
{task.state === 'NOT_SCHEDULED' && task.errors?.length > 0 && (
  <ResourceBottleneckPanel
    task={task}
    resources={resourceUtilization}
    allTasks={tasks}
  />
)}
```

### 2c. Component structure

```typescript
function ResourceBottleneckPanel({ task, resources, allTasks }) {
  const summaries = useMemo(
    () => computeBottleneckSummary(task, resources, allTasks),
    [task, resources, allTasks]
  );

  if (summaries.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
        Resource Availability
      </div>

      {summaries.map(slot => (
        <ResourceSlotRow key={slot.slotIndex} slot={slot} />
      ))}
    </div>
  );
}
```

### 2d. Resource slot row

Each resource requirement gets a row with status icon, label, and expandable preferences:

```typescript
function ResourceSlotRow({ slot }) {
  const [expanded, setExpanded] = useState(slot.isBottleneck); // auto-expand bottleneck

  const icon = slot.status === 'available' ? '🟢'
             : slot.status === 'partial' ? '🟡'
             : '🔴';

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Slot header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <span>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>
          {slot.slotLabel}
        </span>
        {slot.isBottleneck && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
            background: '#f4433620', color: '#f44336',
          }}>
            BOTTLENECK
          </span>
        )}
        <span style={{ fontSize: 10, color: C.textDim }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Expanded: show each preference resource */}
      {expanded && (
        <div style={{ paddingLeft: 24, marginTop: 4 }}>
          {slot.preferences.map(pref => (
            <PreferenceRow key={pref.resourceKey} pref={pref} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 2e. Preference row (individual resource)

```typescript
function PreferenceRow({ pref }) {
  const icon = pref.status === 'available' ? '🟢'
             : pref.status === 'partial' ? '🟡'
             : '🔴';

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10 }}>{icon}</span>
        <span style={{ fontSize: 11, flex: 1 }}>{pref.resourceName}</span>
        <span style={{ fontSize: 10, color: C.textDim }}>
          {pref.availableMinutes > 0
            ? `${Math.round(pref.availableMinutes / 60 * 10) / 10}h free`
            : 'No availability'}
        </span>
      </div>

      {/* Note (e.g. "Starts 10:00") */}
      {pref.note && (
        <div style={{ fontSize: 10, color: C.textDim, paddingLeft: 18 }}>
          {pref.note}
        </div>
      )}

      {/* Blocking tasks */}
      {pref.blockingTasks.length > 0 && (
        <div style={{ paddingLeft: 18 }}>
          {pref.blockingTasks.map(bt => (
            <div key={bt.taskKey} style={{ fontSize: 10, color: C.textDim }}>
              → {bt.taskName} ({bt.start}–{bt.end})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Part 3: Bottleneck Auto-Expand

The bottleneck resource slot auto-expands so the planner immediately sees the blocking details. Other slots start collapsed. Clicking any slot header toggles expand/collapse.

```
🟢 Operating Room                          ▸   (collapsed — not the problem)
🟢 Surgeon                                 ▸   (collapsed)
🔴 Anesthesiologist              BOTTLENECK ▾   (auto-expanded)
   🔴 AN-JONES                     3.5h left
      → CASE-002 Knee Replacement (7:00-8:00)
      → CASE-001 Hip Replacement (8:00-10:30)
   🟡 AN-GARCIA                    Starts 10:00
🟢 Nurse                                   ▸   (collapsed)
```

---

## Part 4: Verification

After implementing:

- [ ] Infeasible task shows Resource Availability section
- [ ] Each resource requirement has a status icon (🟢/🟡/🔴)
- [ ] Bottleneck is identified (least available resource slot)
- [ ] Bottleneck shows red BOTTLENECK badge
- [ ] Bottleneck slot auto-expands
- [ ] Expanded slot shows individual resources with availability
- [ ] Blocking tasks listed with names and times
- [ ] Notes shown for resources with late start times
- [ ] Click slot header to expand/collapse
- [ ] Scheduled tasks do NOT show bottleneck panel
- [ ] Works for healthcare (multi-resource: OR, surgeon, anesthesiologist, nurse)
- [ ] Works for manufacturing (single primary + materials)
- [ ] Works for HRMD sports (court + equipment)
- [ ] Available minutes calculation is correct within task window
- [ ] "Where Can This Go?" button appears below the bottleneck panel

---

## Size Estimate

- Compute function: 15 min
- UI components: 15 min (reuse existing panel patterns)
- Auto-expand bottleneck + expand/collapse: 5 min
- Testing: 5 min
- Total: ~30-45 min
