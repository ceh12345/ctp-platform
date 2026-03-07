# Sprint 20: Conflict Categorization

**What it does:** Classifies infeasible tasks into the correct conflict type based on the root cause from the infeasibility report. The Conflicts page groups by conflict type instead of lumping everything as "dependency conflict."

**Size:** ~45 min CC work  
**Depends on:** Sprint 17 (Bottleneck Display with InfeasibilityReport)

---

## Why

Currently all infeasible chains show as "dependency conflict" because the chain engine reports "resource contention violates maxGap constraints." But DR-CHEN being off shift Monday isn't a dependency conflict — it's an availability conflict. The planner sees the wrong category and draws the wrong conclusion.

Three conflict types exist:

| Type | Root Cause | Example | Action |
|------|-----------|---------|--------|
| **Availability** | Resource has no capacity in the window (off shift, doesn't exist, excluded) | DR-CHEN off shift Monday | Change the window, add coverage, or assign different surgeon |
| **Capacity** | Resource exists and has hours, but other tasks are using it | AN-JONES booked 7:00-10:30 by CASE-002/001 | Bump lower-priority work, add resources, shift timing |
| **Dependency** | Chain timing violation — maxGap can't be satisfied even though resources exist | Setup at 6:00, Proc can't start until 8:00, maxGap=0 violated | Relax maxGap or restructure the chain |

---

## Part 1: Classify Conflict Type

### 1a. Add conflictType to InfeasibilityReport

```typescript
export type ConflictType = 'availability' | 'capacity' | 'dependency';

export interface InfeasibilityReport {
  // ... existing fields ...
  conflictType: ConflictType;       // NEW — primary classification
  conflictTypeReason: string;       // NEW — why this classification
}
```

### 1b. Classification logic

After building the infeasibility report (in `buildInfeasibilityReport`), classify based on the bottleneck slot's resource details:

```typescript
private classifyConflict(report: InfeasibilityReport): { type: ConflictType; reason: string } {
  const bottleneck = report.slots.find(s => s.isBottleneck);
  if (!bottleneck) return { type: 'dependency', reason: 'No bottleneck identified' };

  // Check each resource in the bottleneck slot
  const allBlocked = bottleneck.resources.every(r => r.status === 'blocked');
  const anyOffShift = bottleneck.resources.some(r => 
    r.note?.toLowerCase().includes('off shift') || 
    r.note?.toLowerCase().includes('no availability') ||
    r.availableMinutes === 0 && r.blockingTasks.length === 0
  );
  const anyBlockedByOthers = bottleneck.resources.some(r => r.blockingTasks.length > 0);

  // AVAILABILITY: all preferences for this slot are off shift or have zero base capacity
  // Key signal: blocked with NO blocking tasks (nothing is using it — it simply doesn't exist in the window)
  if (anyOffShift && !anyBlockedByOthers) {
    const offShiftNames = bottleneck.resources
      .filter(r => r.availableMinutes === 0 && r.blockingTasks.length === 0)
      .map(r => r.resourceName)
      .join(', ');
    return {
      type: 'availability',
      reason: `${bottleneck.slotLabel} has no availability in the window (${offShiftNames} off shift)`,
    };
  }

  // AVAILABILITY: all resources have zero availability but some are off shift and some are blocked
  // If EVERY resource is either off-shift or has late start that doesn't cover the need
  const allUnavailable = bottleneck.resources.every(r => r.status === 'blocked');
  const anyHasOnlyNote = bottleneck.resources.some(r => 
    r.status === 'blocked' && r.blockingTasks.length === 0 && r.note
  );
  if (allUnavailable && anyHasOnlyNote) {
    return {
      type: 'availability',
      reason: `${bottleneck.slotLabel} — insufficient availability in the window`,
    };
  }

  // CAPACITY: resources have base availability but are consumed by other tasks
  // Key signal: blocked WITH blocking tasks
  if (anyBlockedByOthers) {
    const blockerChains = new Set<string>();
    bottleneck.resources.forEach(r => {
      r.blockingTasks.forEach(bt => {
        blockerChains.add(bt.chainKey || bt.taskName);
      });
    });
    return {
      type: 'capacity',
      reason: `${bottleneck.slotLabel} capacity consumed by ${Array.from(blockerChains).join(', ')}`,
    };
  }

  // DEPENDENCY: propagation eliminated all combos on timing alone
  // Key signal: resources are available, but no combo satisfies maxGap constraints
  // This happens when combosGenerated > 0 but combosSurvivedPropagation === 0
  if (report.combosGenerated > 0 && report.combosSurvivedPropagation === 0) {
    return {
      type: 'dependency',
      reason: 'All resource combinations eliminated by timing constraints (maxGap)',
    };
  }

  // DEPENDENCY: combos survived propagation but none passed assignment
  // Resources exist, timing works in theory, but the actual resource-aware forward
  // simulation couldn't place the chain
  if (report.combosSurvivedPropagation > 0 && report.combosPassedAssignment === 0) {
    return {
      type: 'capacity',
      reason: `${bottleneck.slotLabel} — timing feasible but resource capacity insufficient at required times`,
    };
  }

  // Default
  return { type: 'dependency', reason: 'Chain timing constraints could not be satisfied' };
}
```

### 1c. Apply classification in buildInfeasibilityReport

At the end of `buildInfeasibilityReport`, before returning:

```typescript
  // ... existing report building ...

  const classification = this.classifyConflict(report);
  report.conflictType = classification.type;
  report.conflictTypeReason = classification.reason;

  // Update the human-readable reason to include the type
  report.reason = `[${classification.type.toUpperCase()}] ${report.reason}`;

  return report;
```

---

## Part 2: Serialize in Solve Response

In `ctp_service.ts extractResults()`, add to the infeasibilityReport serialization:

```typescript
infeasibilityReport: task.infeasibilityReport ? {
  // ... existing fields ...
  conflictType: task.infeasibilityReport.conflictType,
  conflictTypeReason: task.infeasibilityReport.conflictTypeReason,
} : null,
```

---

## Part 3: Conflicts Page — Group by Conflict Type

### 3a. Top-level grouping

The Conflicts page should group infeasible tasks by conflict type first, then by bottleneck within each type:

```
⚫ Availability Conflicts (1)
   └── Surgeon
       └── CASE-013 Meniscus Repair — DR-CHEN off shift Monday

🔴 Capacity Conflicts (2)
   ├── Anesthesiologist
   │   └── CASE-011 Rotator Cuff — AN-JONES booked by CASE-002, CASE-001
   └── Operating Room
       └── CASE-012 ACL Reconstruction — both ORs booked Mon morning

🔗 Dependency Conflicts (0)
   └── (none)
```

### 3b. Conflict type icons and colors

| Type | Icon | Color | Meaning |
|------|------|-------|---------|
| Availability | ⚫ | Gray | Resource doesn't exist in the window — structural issue |
| Capacity | 🔴 | Red | Resource exists but consumed — scheduling contention |
| Dependency | 🔗 | Orange | Chain timing can't be satisfied — constraint issue |

### 3c. Implementation

```typescript
function ConflictsPage({ tasks }) {
  const infeasible = tasks.filter(t => !t.feasible && t.infeasibilityReport);

  // Group by conflict type
  const byType = new Map<string, any[]>();
  byType.set('availability', []);
  byType.set('capacity', []);
  byType.set('dependency', []);

  infeasible.forEach(task => {
    const type = task.infeasibilityReport?.conflictType || 'dependency';
    byType.get(type)?.push(task);
  });

  // Also include infeasible tasks WITHOUT reports (legacy errors)
  const noReport = tasks.filter(t => !t.feasible && !t.infeasibilityReport);
  if (noReport.length > 0) {
    byType.set('unknown', noReport);
  }

  const typeConfig = {
    availability: { icon: '⚫', color: '#9e9e9e', label: 'Availability Conflicts' },
    capacity:     { icon: '🔴', color: '#f44336', label: 'Capacity Conflicts' },
    dependency:   { icon: '🔗', color: '#ff9800', label: 'Dependency Conflicts' },
    unknown:      { icon: '❓', color: '#9e9e9e', label: 'Other Conflicts' },
  };

  return (
    <div>
      {['availability', 'capacity', 'dependency', 'unknown'].map(type => {
        const items = byType.get(type) || [];
        if (items.length === 0) return null;
        const config = typeConfig[type];

        return (
          <div key={type} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span>{config.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: config.color }}>
                {config.label} ({items.length})
              </span>
            </div>

            {/* Sub-group by bottleneck */}
            <ConflictsByBottleneck tasks={items} />
          </div>
        );
      })}
    </div>
  );
}
```

### 3d. Sub-group by bottleneck within each conflict type

```typescript
function ConflictsByBottleneck({ tasks }) {
  const byBottleneck = new Map<string, any[]>();
  tasks.forEach(task => {
    const slot = task.infeasibilityReport?.bottleneckSlot || 'Unknown';
    if (!byBottleneck.has(slot)) byBottleneck.set(slot, []);
    byBottleneck.get(slot)!.push(task);
  });

  return (
    <div style={{ paddingLeft: 24 }}>
      {Array.from(byBottleneck.entries()).map(([slot, tasks]) => (
        <div key={slot} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>
            {slot} ({tasks.length})
          </div>
          {tasks.map(task => (
            <ConflictTaskRow key={task.key} task={task} />
          ))}
        </div>
      ))}
    </div>
  );
}
```

---

## Part 4: Analytics KPI Update

Update the Infeasibility Analysis KPI detail view to show conflict type breakdown:

```
Infeasibility Analysis — 3 tasks infeasible

By Conflict Type:
┌─────────────────┬───────┐
│ Type             │ Count │
├─────────────────┼───────┤
│ ⚫ Availability  │ 1     │
│ 🔴 Capacity      │ 2     │
│ 🔗 Dependency    │ 0     │
└─────────────────┴───────┘

Bottleneck Summary:
┌──────────────────┬───────┬──────────┬──────────────────────────┐
│ Resource Type     │ Count │ Type     │ Blocked By               │
├──────────────────┼───────┼──────────┼──────────────────────────┤
│ Surgeon           │ 1     │ Avail.   │ DR-CHEN off shift        │
│ Anesthesiologist  │ 1     │ Capacity │ CASE-002, CASE-001       │
│ Operating Room    │ 1     │ Capacity │ Morning slots full       │
└──────────────────┴───────┴──────────┴──────────────────────────┘
```

---

## Part 5: Verification

- [ ] CASE-013 (DR-CHEN off shift) classified as **availability** conflict
- [ ] CASE-011 (anesthesiologist booked) classified as **capacity** conflict
- [ ] CASE-012 (OR morning full) classified as **capacity** conflict
- [ ] Conflicts page groups by type: availability → capacity → dependency
- [ ] Within each type, sub-grouped by bottleneck resource
- [ ] Conflict type icons and colors correct
- [ ] Analytics KPI shows conflict type breakdown
- [ ] Tasks with no infeasibility report fall into "Other" category
- [ ] Existing 10 cases still schedule correctly
- [ ] Manufacturing/HRMD tenants: any infeasible tasks categorized correctly
- [ ] conflictType and conflictTypeReason in solve response

---

## Size Estimate

- Engine: classifyConflict logic (~20 min)
- Engine: integrate into buildInfeasibilityReport + response serialization (~10 min)
- Frontend: Conflicts page type grouping + sub-grouping (~15 min)
- Frontend: Analytics KPI conflict type breakdown (~10 min)
- Testing (~10 min)
- Total: ~45 min - 1 hour
