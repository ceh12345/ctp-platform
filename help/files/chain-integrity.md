# Chain Integrity

Chain integrity tells you whether the phases of your cases are flowing back-to-back as they should.

## What is a chain?

A chain is a sequence of linked tasks that must happen in order. For example:

- **Healthcare:** Pre-Op Setup → Procedure → Recovery
- **Manufacturing:** Machine A → Machine B → Quality Check → Packing
- **Field Service:** Travel → Job → Inspection

Each phase depends on the previous one completing before it can start. The ideal is zero gap between phases — when one ends, the next begins immediately.

## What is a chain violation?

A chain violation occurs when there's a gap between consecutive phases. The previous phase has finished but the next phase doesn't start right away.

**Example:**
```
Pre-Op Setup    07:00 — 07:30
                              ← 45 min gap (violation)
Procedure       08:15 — 11:15
Recovery        11:15 — 14:15  ← back-to-back (good)
```

The 45-minute gap between Setup and Procedure means the OR and patient are ready but the surgeon or anesthesiologist isn't available yet.

## Why gaps matter

| Situation | Impact |
|-----------|--------|
| Patient prepped, waiting for surgeon | Wasted OR time, patient anxiety, schedule cascading delay |
| Parts machined, waiting for next operation | WIP sitting on floor, blocking other jobs |
| Technician arrived, waiting for equipment | Billable time wasted, customer frustrated |

Gaps represent wasted capacity and poor customer experience.

## Reading the chain integrity view

**Left panel KPIs:**
- **Avg Gap** — Average gap duration across all cases. Lower is better.
- **Max Gap** — The worst single gap. Tells you how bad the worst case is.
- **Back-to-Back Rate** — Percentage of phase transitions with zero gap. Higher is better.
- **Chain Violations** — Count of cases with any gap above threshold.

**Right panel detail:**

Each case is shown as a card with:
- **Case name and status badge** — ✓ Back-to-back (green) or ⚠ gap duration (red)
- **Mini Gantt** — Visual timeline of phases with gaps shown as red dashed regions
- **Phase list** — Each phase with type, name, scheduled time, and assigned resources
- **Gap indicators** — Between each pair of phases, showing ✓ 0 gap or ⚠ X min gap

**Sorting:** Sort by worst gap to find the biggest problems first.

**Filtering:** Show only violations to hide clean chains and focus on issues.

## Common causes of gaps

**Resource contention** — The next phase needs a resource that's busy with another case. The most common cause. Check utilization for that resource group.

**Calendar mismatch** — The next phase needs a resource whose shift hasn't started yet, or who's on a break/lunch.

**Recovery bay availability** — In healthcare, all recovery bays may be occupied. In manufacturing, the downstream machine is full.

**Predecessor timing** — The predecessor was scheduled at a time that doesn't align well with the successor's resource availability.

## Fixing violations

1. **Identify the bottleneck resource** — Which resource is causing the gap? Check what it's doing during the gap time.
2. **Look for alternatives** — Can the next phase use a different resource? (Different recovery bay, different machine)
3. **Shift the predecessor** — Can the first phase start earlier or later so the chain flows better?
4. **Add capacity** — If a resource type is consistently causing gaps, consider adding more of that resource.

Click the case name in the chain integrity view to navigate to the Task List filtered for that case, where you can see full details and take action.
