# Sprint 17: Infeasible Task Bottleneck Display with Rich Error Messages

**What it does:** Two layers working together:
1. **Engine:** When a task or chain is infeasible, report exactly WHY — which resource combinations were tried, which resources failed, who's blocking them, and what the scarcest resource is.
2. **Frontend:** Task detail panel shows per-resource availability breakdown with bottleneck identification, blocking task details, and auto-expanded scarcest resource.

**Size:** ~1.5-2 hours CC work  
**Depends on:** Phase 3 (chain context engine)  
**Triggers:** Healthcare CASE-004 infeasible — planner needs to see "anesthesiologist is the bottleneck, Jones booked by CASE-002 and CASE-001 until 10:30"

---

## Why

Current infeasible error messages:

```
PickBestScheduleAgent: No feasible schedule
Could Not Find Availability for Operating Room 1
Could Not Find Availability for Jones, CRNA
Could Not Find Availability for Garcia, CRNA
```

Problems:
- Reports per-resource independently — doesn't show which COMBINATION failed
- Doesn't distinguish "resource totally blocked" from "resource available but not at the right time"
- Doesn't name WHO is blocking the resource
- Doesn't identify which resource TYPE is the bottleneck
- Chain engine returns "No valid chain placement" without breakdown

What the planner needs:

```
Chain CASE-004 infeasible — anesthesiologist is the bottleneck

Resource Availability in Window [Mon 6:00 AM – Fri 6:00 PM]:
  🟢 Operating Room
     OR-01: 8.5h available (blocked 7:00-10:30 by CASE-002, CASE-001)
     OR-02: 12h available
  🟢 Surgeon
     Dr. Smith: 10h available
  🔴 Anesthesiologist                              ← BOTTLENECK
     AN-JONES: 3.5h available (blocked 7:00-10:30)
       → CASE-002 PROC (7:00-8:00)
       → CASE-001 PROC (8:00-10:30)
     AN-GARCIA: available from 10:00 only (outside maxGap window)
  🟢 Nurse
     RN-01: 12h available
     RN-02: 12h available

Combos tried: 8 | Survived propagation: 2 | Passed assignment: 0
```

---

## Part 1: Engine — Rich Infeasibility Reporting

### 1a. InfeasibilityReport interface

Create: `Models/Entities/infeasibilityreport.ts`

```typescript
export interface ResourceAvailabilityDetail {
  resourceKey: string;
  resourceName: string;
  availableMinutes: number;      // free time within task/chain window
  totalWindowMinutes: number;    // total window duration
  status: 'available' | 'partial' | 'blocked';
  blockingTasks: BlockingTaskDetail[];
  note: string | null;           // "available from 10:00 only", "off shift"
}

export interface BlockingTaskDetail {
  taskKey: string;
  taskName: string;
  chainKey: string | null;
  startW: number;
  endW: number;
}

export interface ResourceSlotReport {
  slotIndex: number;
  slotLabel: string;             // "Anesthesiologist", "Operating Room", "Nurse"
  isPrimary: boolean;
  status: 'available' | 'partial' | 'blocked';
  bestAvailableMinutes: number;  // best preference availability
  isBottleneck: boolean;
  resources: ResourceAvailabilityDetail[];
}

export interface InfeasibilityReport {
  taskKey: string;
  chainKey: string | null;
  reason: string;                // human-readable summary
  bottleneckSlot: string | null; // slot label of the scarcest resource
  slots: ResourceSlotReport[];
  combosGenerated: number;
  combosSurvivedPropagation: number;
  combosPassedAssignment: number;
}
```

### 1b. Build report in chain context engine

When `evaluateChain()` returns null, build the report before returning:

```typescript
// In ChainContextEngine.evaluateChain(), before returning null:

public evaluateChain(
  chain: CTPProcess,
  allContexts: ScheduleContexts,
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
  maxCombos?: number,
): ChainContextCombo | null {
  // ... existing logic ...
  
  const feasible = combos.filter(c => c.feasible);
  
  if (feasible.length === 0) {
    // Build infeasibility report for the chain
    const report = this.buildInfeasibilityReport(
      chain, taskArray, taskContextsMap, combos.length, 0, 0, landscape
    );
    chain.tasks?.forEach(task => {
      task.infeasibilityReport = report;
      task.addError('ChainContextEngine', report.reason);
    });
    return null;
  }
  
  // ... try assignStartTimes on feasible combos ...
  
  // If no combo passes assignment:
  const report = this.buildInfeasibilityReport(
    chain, taskArray, taskContextsMap, combos.length, feasible.length, 0, landscape
  );
  chain.tasks?.forEach(task => {
    task.infeasibilityReport = report;
    task.addError('ChainContextEngine', report.reason);
  });
  return null;
}
```

### 1c. Build the report

```typescript
private buildInfeasibilityReport(
  chain: CTPProcess,
  tasks: CTPTask[],
  taskContextsMap: Map<string, ScheduleContext[]>,
  combosGenerated: number,
  combosSurvivedPropagation: number,
  combosPassedAssignment: number,
  landscape: SchedulingLandscape,
): InfeasibilityReport {
  
  const slots: ResourceSlotReport[] = [];
  const chainKey = chain.key || tasks[0]?.linkId?.name || null;
  
  // For each task in the chain, analyze resource availability
  for (const task of tasks) {
    if (!task.capacityResources) continue;
    
    const windowStart = task.window?.startW ?? 0;
    const windowEnd = task.window?.endW ?? Number.MAX_VALUE;
    const windowMinutes = (windowEnd - windowStart) / 60;
    const taskDuration = task.duration?.duration() ?? 0;
    
    task.capacityResources.forEach((tr, idx) => {
      if (tr.isIgnored()) return;
      
      const prefs = tr.getEffectivePreferences();
      const resourceDetails: ResourceAvailabilityDetail[] = [];
      let bestAvailMinutes = 0;
      
      for (const pref of prefs) {
        const resource = landscape.resources?.getEntity(pref.resourceKey);
        if (!resource) continue;
        
        const analysis = this.analyzeResourceAvailability(
          resource, windowStart, windowEnd, taskDuration, landscape
        );
        
        if (analysis.availMinutes > bestAvailMinutes) bestAvailMinutes = analysis.availMinutes;
        
        const status = analysis.availMinutes >= (taskDuration / 60)
          ? 'available'
          : analysis.availMinutes > 0 ? 'partial' : 'blocked';
        
        resourceDetails.push({
          resourceKey: pref.resourceKey,
          resourceName: resource.name || pref.resourceKey,
          availableMinutes: Math.round(analysis.availMinutes),
          totalWindowMinutes: Math.round(windowMinutes),
          status,
          blockingTasks: analysis.blockingTasks,
          note: analysis.note,
        });
      }
      
      // Deduplicate: if this slot label already exists (same resource type
      // across multiple chain tasks), merge rather than add new slot
      const slotLabel = this.deriveSlotLabel(tr, resourceDetails);
      const existingSlot = slots.find(s => s.slotLabel === slotLabel);
      
      if (existingSlot) {
        // Merge: update availability if worse
        for (const rd of resourceDetails) {
          const existing = existingSlot.resources.find(r => r.resourceKey === rd.resourceKey);
          if (existing) {
            if (rd.availableMinutes < existing.availableMinutes) {
              existing.availableMinutes = rd.availableMinutes;
              existing.status = rd.status;
              existing.blockingTasks = rd.blockingTasks;
              existing.note = rd.note;
            }
          } else {
            existingSlot.resources.push(rd);
          }
        }
        if (bestAvailMinutes < existingSlot.bestAvailableMinutes) {
          existingSlot.bestAvailableMinutes = Math.round(bestAvailMinutes);
        }
      } else {
        const slotStatus = bestAvailMinutes >= (taskDuration / 60)
          ? 'available'
          : bestAvailMinutes > 0 ? 'partial' : 'blocked';
        
        slots.push({
          slotIndex: idx,
          slotLabel,
          isPrimary: tr.isPrimary,
          status: slotStatus,
          bestAvailableMinutes: Math.round(bestAvailMinutes),
          isBottleneck: false,
          resources: resourceDetails,
        });
      }
    });
  }
  
  // Identify bottleneck: slot with least availability relative to need
  if (slots.length > 0) {
    const sorted = [...slots].sort((a, b) => a.bestAvailableMinutes - b.bestAvailableMinutes);
    sorted[0].isBottleneck = true;
  }
  
  const bottleneckSlot = slots.find(s => s.isBottleneck);
  
  // Build human-readable reason
  let reason = `No valid placement for ${chainKey || tasks[0]?.key}`;
  if (bottleneckSlot) {
    reason += ` — ${bottleneckSlot.slotLabel} is the bottleneck`;
    const blockedRes = bottleneckSlot.resources.filter(r => r.status === 'blocked');
    if (blockedRes.length > 0) {
      const names = blockedRes.map(r => r.resourceName).join(', ');
      reason += ` (${names} fully blocked)`;
    }
  }
  
  return {
    taskKey: tasks[0]?.key || '',
    chainKey,
    reason,
    bottleneckSlot: bottleneckSlot?.slotLabel || null,
    slots,
    combosGenerated,
    combosSurvivedPropagation,
    combosPassedAssignment,
  };
}
```

### 1d. Analyze resource availability

```typescript
private analyzeResourceAvailability(
  resource: CTPResource,
  windowStart: number,
  windowEnd: number,
  taskDuration: number,
  landscape: SchedulingLandscape,
): {
  availMinutes: number;
  blockingTasks: BlockingTaskDetail[];
  note: string | null;
} {
  let availMinutes = 0;
  const blockingTasks: BlockingTaskDetail[] = [];
  let note: string | null = null;
  
  // Check resource availability in window
  if (resource.original) {
    let node = resource.original.head;
    let hasAnyAvailability = false;
    let earliestAvailStart = Number.MAX_VALUE;
    
    while (node) {
      const overlapStart = Math.max(node.data.startW, windowStart);
      const overlapEnd = Math.min(node.data.endW, windowEnd);
      if (overlapEnd > overlapStart) {
        hasAnyAvailability = true;
        availMinutes += (overlapEnd - overlapStart) / 60;
        if (node.data.startW < earliestAvailStart) {
          earliestAvailStart = node.data.startW;
        }
      }
      node = node.next;
    }
    
    if (!hasAnyAvailability) {
      return { availMinutes: 0, blockingTasks, note: 'Off shift during entire window' };
    }
    
    if (earliestAvailStart > windowStart) {
      note = `Available from ${earliestAvailStart} only`;
    }
  }
  
  // Subtract assignments and record blockers
  if (resource.assignments) {
    let assNode = resource.assignments.head;
    while (assNode) {
      const a = assNode.data;
      const overlapStart = Math.max(a.startW, windowStart);
      const overlapEnd = Math.min(a.endW, windowEnd);
      
      if (overlapEnd > overlapStart) {
        availMinutes -= (overlapEnd - overlapStart) / 60;
        
        if (a.name && !blockingTasks.find(bt => bt.taskKey === a.name)) {
          const blockerTask = landscape.tasks?.getEntity(a.name);
          blockingTasks.push({
            taskKey: a.name,
            taskName: blockerTask?.name || a.name,
            chainKey: blockerTask?.linkId?.name || null,
            startW: a.startW,
            endW: a.endW,
          });
        }
      }
      assNode = assNode.next;
    }
  }
  
  if (availMinutes < 0) availMinutes = 0;
  return { availMinutes, blockingTasks, note };
}
```

### 1e. Derive slot label

```typescript
private deriveSlotLabel(
  tr: CTPTaskResource,
  resources: ResourceAvailabilityDetail[]
): string {
  if (resources.length === 0) return 'Resource';
  if (resources.length === 1) return resources[0].resourceName;
  
  const names = resources.map(r => r.resourceName);
  let prefix = names[0];
  for (let i = 1; i < names.length; i++) {
    while (!names[i].startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
  }
  prefix = prefix.replace(/[\s\-_,]+$/, '').trim();
  return prefix || 'Resource Group';
}
```

### 1f. Add infeasibilityReport to CTPTask

In `task.ts`:

```typescript
import { InfeasibilityReport } from './infeasibilityreport';

export class CTPTask extends CTPKeyEntity implements ITask {
  // ... existing fields ...
  public infeasibilityReport: InfeasibilityReport | null = null;
  
  // In constructor:
  this.infeasibilityReport = null;
  
  // Update clearErrors:
  public clearErrors() {
    this.errors = [];
    this.infeasibilityReport = null;
  }
}
```

### 1g. Per-task infeasibility (non-chain tasks)

For standalone tasks that fail in the greedy path, build a simpler report using the same `analyzeResourceAvailability` method. Add to `basescheduler.ts` where tasks are marked infeasible:

```typescript
// In scheduleTasks or selectBestScheduleForTask when best is null:
if (!best) {
  task.infeasibilityReport = this.buildStandaloneInfeasibilityReport(task);
}

private buildStandaloneInfeasibilityReport(task: CTPTask): InfeasibilityReport {
  // Same logic as chaincontextengine.buildInfeasibilityReport
  // but for a single task, no chain stats
  const slots: ResourceSlotReport[] = [];
  // ... analyze each resource requirement ...
  // ... identify bottleneck ...
  return { taskKey: task.key, chainKey: null, reason, bottleneckSlot, slots,
           combosGenerated: 0, combosSurvivedPropagation: 0, combosPassedAssignment: 0 };
}
```

### 1h. Include in solve response

In `ctp_service.ts extractResults()`, serialize the report:

```typescript
const taskResult: any = {
  // ... existing fields ...
  infeasibilityReport: task.infeasibilityReport ? {
    reason: task.infeasibilityReport.reason,
    bottleneckSlot: task.infeasibilityReport.bottleneckSlot,
    slots: task.infeasibilityReport.slots.map(slot => ({
      slotLabel: slot.slotLabel,
      isPrimary: slot.isPrimary,
      status: slot.status,
      bestAvailableMinutes: slot.bestAvailableMinutes,
      isBottleneck: slot.isBottleneck,
      resources: slot.resources.map(r => ({
        resourceKey: r.resourceKey,
        resourceName: r.resourceName,
        availableMinutes: r.availableMinutes,
        status: r.status,
        blockingTasks: r.blockingTasks.map(bt => ({
          taskKey: bt.taskKey,
          taskName: bt.taskName,
          chainKey: bt.chainKey,
          start: CTPDateTime.toDateTime(bt.startW).toISO(),
          end: CTPDateTime.toDateTime(bt.endW).toISO(),
        })),
        note: r.note,
      })),
    })),
    combosGenerated: task.infeasibilityReport.combosGenerated,
    combosSurvivedPropagation: task.infeasibilityReport.combosSurvivedPropagation,
    combosPassedAssignment: task.infeasibilityReport.combosPassedAssignment,
  } : null,
};
```

---

## Part 2: Frontend — Bottleneck Display

### 2a. Show ONLY for infeasible tasks

In the task detail slide-over, after the status badge area:

```typescript
{!task.feasible && task.infeasibilityReport && (
  <ResourceBottleneckPanel report={task.infeasibilityReport} />
)}
```

### 2b. ResourceBottleneckPanel

```typescript
function ResourceBottleneckPanel({ report }) {
  return (
    <div style={{ marginTop: 12 }}>
      {/* Reason summary */}
      <div style={{
        padding: '8px 12px', borderRadius: 8, marginBottom: 12,
        background: '#f4433610', border: '1px solid #f4433630',
        fontSize: 12, color: '#f44336',
      }}>
        {report.reason}
      </div>

      {/* Combo stats */}
      {report.combosGenerated > 0 && (
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 8 }}>
          Combos: {report.combosGenerated} tried
          → {report.combosSurvivedPropagation} survived propagation
          → {report.combosPassedAssignment} valid
        </div>
      )}

      {/* Resource Availability header */}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
        Resource Availability
      </div>

      {report.slots.map(slot => (
        <ResourceSlotRow key={`${slot.slotLabel}-${slot.slotIndex}`} slot={slot} />
      ))}
    </div>
  );
}
```

### 2c. ResourceSlotRow with expand/collapse

```typescript
function ResourceSlotRow({ slot }) {
  const [expanded, setExpanded] = useState(slot.isBottleneck);

  const icon = slot.status === 'available' ? '🟢'
             : slot.status === 'partial' ? '🟡'
             : '🔴';

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <span>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{slot.slotLabel}</span>
        {slot.isBottleneck && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
            background: '#f4433620', color: '#f44336',
          }}>
            BOTTLENECK
          </span>
        )}
        <span style={{ fontSize: 10, color: C.textDim }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 24, marginTop: 4 }}>
          {slot.resources.map(res => (
            <ResourceDetailRow key={res.resourceKey} resource={res} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 2d. ResourceDetailRow with blocking tasks

```typescript
function ResourceDetailRow({ resource }) {
  const icon = resource.status === 'available' ? '🟢'
             : resource.status === 'partial' ? '🟡'
             : '🔴';

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10 }}>{icon}</span>
        <span style={{ fontSize: 11, flex: 1 }}>{resource.resourceName}</span>
        <span style={{ fontSize: 10, color: C.textDim }}>
          {resource.availableMinutes > 0
            ? `${(resource.availableMinutes / 60).toFixed(1)}h free`
            : 'No availability'}
        </span>
      </div>

      {resource.note && (
        <div style={{ fontSize: 10, color: C.textDim, paddingLeft: 18 }}>
          {resource.note}
        </div>
      )}

      {resource.blockingTasks.map(bt => (
        <div key={bt.taskKey} style={{ fontSize: 10, color: C.textDim, paddingLeft: 18 }}>
          → {bt.taskName}{bt.chainKey ? ` (${bt.chainKey})` : ''} {fmtTime(bt.start)}–{fmtTime(bt.end)}
        </div>
      ))}
    </div>
  );
}
```

---

## Part 3: Conflicts Page Integration

The existing Conflicts page shows infeasible tasks. Enhance it with the bottleneck data.

### 3a. Bottleneck summary per infeasible task

Each infeasible task row on the Conflicts page should show a one-line bottleneck summary instead of just "infeasible":

**Current:**
```
C004-PROC    Knee Replacement    ❌ Infeasible
C008-PROC    Shoulder Repair     ❌ Infeasible
```

**Enhanced:**
```
C004-PROC    Knee Replacement    ❌ Bottleneck: Anesthesiologist — AN-JONES blocked by CASE-002, CASE-001
C008-PROC    Shoulder Repair     ❌ Bottleneck: Operating Room — all ORs booked Mon 6AM–2PM
```

### 3b. Implementation

In the Conflicts page task rows, read `task.infeasibilityReport`:

```typescript
{task.infeasibilityReport ? (
  <span style={{ fontSize: 11, color: '#f44336' }}>
    Bottleneck: {task.infeasibilityReport.bottleneckSlot}
    {task.infeasibilityReport.slots
      .filter(s => s.isBottleneck)
      .flatMap(s => s.resources.filter(r => r.status === 'blocked'))
      .map(r => ` — ${r.resourceName} blocked by ${r.blockingTasks.map(bt => bt.chainKey || bt.taskName).join(', ')}`)
      .join('')
    }
  </span>
) : (
  <span style={{ fontSize: 11, color: '#f44336' }}>
    {task.errors?.[0]?.reason || 'Infeasible'}
  </span>
)}
```

### 3c. Click row → task detail with full breakdown

Clicking an infeasible task on the Conflicts page opens the task detail panel (existing behavior), which now shows the full ResourceBottleneckPanel from Part 2.

### 3d. Group by bottleneck type

Add a grouping option to the Conflicts page — group infeasible tasks by their bottleneck slot:

```
Anesthesiologist (2 tasks)
├── C004-PROC  Knee Replacement — AN-JONES blocked by CASE-002, CASE-001
└── C008-PROC  Shoulder Repair — AN-JONES blocked by CASE-003

Operating Room (1 task)
└── C010-PROC  Cataract Surgery — all ORs booked Mon PM
```

This tells the planner "the anesthesiologist is the systemic bottleneck, not individual task issues."

```typescript
const byBottleneck = new Map<string, any[]>();
infeasibleTasks.forEach(task => {
  const slot = task.infeasibilityReport?.bottleneckSlot || 'Unknown';
  if (!byBottleneck.has(slot)) byBottleneck.set(slot, []);
  byBottleneck.get(slot)!.push(task);
});
```

---

## Part 4: Infeasibility KPI in Analytics

### 4a. New KPI card

Add an "Infeasibility Analysis" KPI to the Analytics tab:

```typescript
{
  key: 'infeasibility',
  group: 'Scheduling',
  label: 'Infeasibility Analysis',
  value: infeasibleCount,
  unit: 'tasks',
  status: infeasibleCount === 0 ? 'good' : 'warning',
  icon: '⚠️',
}
```

### 4b. Detail view when selected

When the planner clicks the Infeasibility KPI, show a detail panel:

```
┌──────────────────────────────────────────────────────────┐
│ Infeasibility Analysis — 3 tasks infeasible              │
│                                                          │
│ Bottleneck Summary                                       │
│ ┌──────────────────┬───────┬──────────────────────────┐  │
│ │ Resource Type     │ Count │ Blocked By               │  │
│ ├──────────────────┼───────┼──────────────────────────┤  │
│ │ Anesthesiologist  │ 2     │ CASE-002, CASE-001       │  │
│ │ Operating Room    │ 1     │ All ORs booked Mon PM    │  │
│ └──────────────────┴───────┴──────────────────────────┘  │
│                                                          │
│ Affected Chains                                          │
│ ┌──────────┬──────────────────────┬────────────────────┐ │
│ │ Chain     │ Task                 │ Bottleneck         │ │
│ ├──────────┼──────────────────────┼────────────────────┤ │
│ │ CASE-004 │ Knee Replacement     │ Anesthesiologist   │ │
│ │ CASE-008 │ Shoulder Repair      │ Anesthesiologist   │ │
│ │ CASE-010 │ Cataract Surgery     │ Operating Room     │ │
│ └──────────┴──────────────────────┴────────────────────┘ │
│                                                          │
│ Recommendations                                          │
│ • Anesthesiologist is a systemic bottleneck (2 tasks).   │
│   Consider adding coverage before 10:00 AM.              │
│ • Operating Room blocked by CASE-002, CASE-001.          │
│   Consider deferring or rescheduling those chains.        │
│                                                          │
│ [View in Conflicts →]                                    │
└──────────────────────────────────────────────────────────┘
```

### 4c. Bottleneck summary table

Built from solve response — aggregate infeasibility reports by bottleneck slot:

```typescript
function buildBottleneckSummary(tasks: any[]): BottleneckSummary[] {
  const infeasible = tasks.filter(t => !t.feasible && t.infeasibilityReport);
  const bySlot = new Map<string, { count: number; blockers: Set<string>; tasks: any[] }>();

  for (const task of infeasible) {
    const slot = task.infeasibilityReport.bottleneckSlot || 'Unknown';
    if (!bySlot.has(slot)) bySlot.set(slot, { count: 0, blockers: new Set(), tasks: [] });
    const entry = bySlot.get(slot)!;
    entry.count++;
    entry.tasks.push(task);

    const bottleneckSlotData = task.infeasibilityReport.slots.find(s => s.isBottleneck);
    if (bottleneckSlotData) {
      for (const res of bottleneckSlotData.resources) {
        for (const bt of res.blockingTasks) {
          entry.blockers.add(bt.chainKey || bt.taskName);
        }
      }
    }
  }

  return Array.from(bySlot.entries()).map(([slot, data]) => ({
    resourceType: slot,
    count: data.count,
    blockedBy: Array.from(data.blockers).join(', '),
    tasks: data.tasks,
  }));
}
```

### 4d. Recommendations (simple heuristics)

```typescript
function generateRecommendations(summary: BottleneckSummary[]): string[] {
  const recs: string[] = [];
  for (const item of summary) {
    if (item.count >= 2) {
      recs.push(`${item.resourceType} is a systemic bottleneck — ${item.count} tasks affected. Consider adding capacity.`);
    }
    if (item.blockedBy) {
      recs.push(`${item.resourceType} blocked by ${item.blockedBy}. Consider deferring or rescheduling those chains.`);
    }
  }
  if (summary.length === 0) {
    recs.push('No infeasible tasks — all tasks placed successfully.');
  }
  return recs;
}
```

### 4e. "View in Conflicts" link

Navigates to the Conflicts page pre-filtered to infeasible tasks.

### 4f. No new API endpoint needed

All data comes from the solve response `infeasibilityReport` on each task. Frontend-only aggregation.

---

## Part 5: Verification

**Engine:**
- [ ] Chain infeasible → infeasibilityReport on all chain tasks with correct bottleneck
- [ ] Blocking tasks named with chain references and times
- [ ] Combo stats (generated / survived / passed) populated
- [ ] Notes for resources with late starts or off-shift
- [ ] Standalone infeasible tasks also get reports
- [ ] Report serialized correctly in solve response

**Task Detail Panel:**
- [ ] Infeasible task shows ResourceBottleneckPanel
- [ ] Bottleneck slot has red badge, auto-expanded
- [ ] Other slots collapsed, click to expand
- [ ] Blocking task times in tenant timezone
- [ ] Scheduled tasks do NOT show panel

**Conflicts Page:**
- [ ] Infeasible tasks show one-line bottleneck summary
- [ ] Group-by-bottleneck option shows systemic patterns
- [ ] Click row → task detail with full breakdown

**Analytics KPI:**
- [ ] Infeasibility Analysis KPI card shows count
- [ ] Detail view shows bottleneck summary table
- [ ] Affected chains listed with bottleneck type
- [ ] Recommendations generated from bottleneck data
- [ ] "View in Conflicts" link navigates correctly

**Cross-tenant:**
- [ ] Healthcare CASE-004: anesthesiologist bottleneck, Jones blocked by CASE-002/001
- [ ] Manufacturing: machine bottleneck
- [ ] HRMD: field/equipment bottleneck
- [ ] No regression

---

## Size Estimate

- Engine: interfaces + buildReport + analyzeAvailability + integration (~45 min)
- Engine: response serialization (~10 min)
- Frontend: task detail bottleneck panel (~20 min)
- Frontend: Conflicts page enhancement (~20 min)
- Frontend: Analytics KPI + detail view (~20 min)
- Testing (~15 min)
- Total: ~2-2.5 hours
