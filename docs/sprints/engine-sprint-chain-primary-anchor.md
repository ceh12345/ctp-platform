# Engine Sprint: Primary-Task-Driven Chain Placement

**What it does:** Restructures how the chain context engine evaluates combos. Instead of anchoring on the first task (SETUP) and propagating forward, the engine identifies the **most constrained task** in each combo, anchors on it, and propagates outward — backward to predecessors, forward to successors. Secondary tasks derive their feasible windows from the primary task's placement.

**Why:** Today, SETUP grabs the earliest slot (e.g., 6:30 AM), locks PROC to 7:00 AM via maxGap=0, and eliminates anesthesiologists whose shift starts later. The solver lands on Wednesday when Monday is feasible — if the chain had anchored on PROC (the task with OR + surgeon + anesthesiologist constraints), it would have found a 10:30 AM Monday combo with the rank-2 anesthesiologist and propagated backward to place SETUP at 10:00 AM.

**Size:** ~3-4 hours  
**Depends on:** Phase 3 Chain Context Engine (done)  
**Risk:** Performance — computing feasible windows per combo instead of reusing pre-computed bounds. Mitigated by existing `preCapContextSets` and `capCombos` strategies.

---

## The Problem — Concrete Example

**C003 chain:** SETUP (30 min) → PROC (90 min) → RECOVERY (60 min), maxGap=0 between SETUP and PROC.

**PROC resources:** OR-01/02/03 + DR-PATEL + AN-JONES (rank 1, shift 6:00-18:00) or AN-GARCIA (rank 2, shift 10:00-18:00)

**Monday landscape:**
- OR-02 busy until 10:30 (C001), then free
- AN-JONES booked solid 7:00-12:45
- AN-GARCIA available from 10:00

**Today's engine flow:**
1. SETUP gets earliest slot: OR-01 at 6:30 AM
2. maxGap=0 → PROC must start at 7:00 AM
3. AN-GARCIA not on shift until 10:00 → Garcia combos eliminated
4. AN-JONES booked at 7:00 → Jones combos eliminated for Monday
5. Solver finds Wednesday as first feasible day

**Correct flow (this sprint):**
1. PROC is the most constrained task (3 resource types, anesthesiologist shift constraint)
2. Combo D (OR-02 + PATEL + GARCIA): PROC feasible window starts at 10:30 Monday
3. Propagate backward: SETUP must end by 10:30 → SETUP at 10:00-10:30 → nurse available? Yes
4. Propagate forward: RECOVERY after 12:00 → bay available? Yes
5. **Chain scheduled Monday 10:00 AM** — two days earlier

---

## Design

### Step 0: Compute per-combo range windows (replaces cached bounds)

After the cross-product produces fully-determined combos (Step 3 in current code), compute fresh range windows for each task in each combo using `computeFeasibleWindows()`.

Today, `getContextTimeBounds()` reads pre-computed bounds from start-time nodes on the `ScheduleContext`. The problem is these bounds were computed before chain constraints were considered.

**New approach:** For each combo, each task's context already has a specific resource set (the `ScheduleContext.slot.resources`). The start-time engine already computed range windows for that exact resource intersection. Extract them from the context's start-time nodes as `CTPRangeWindows` — a linked list of `CTPRangeValues`, each with `est`, `eet`, `lst`, `lett`.

**Key difference:** We now work with the **full set of range windows** (multiple disjoint windows per task), not just the min/max bounds across all windows. A task might have:

```
Window 1: EST=6:00   EET=6:30   LST=8:00   LET=8:30     (morning)
Window 2: EST=10:30  EET=11:00  LST=15:00  LET=15:30    (after C001 finishes)
```

Collapsing these to min/max (EST=6:00, LST=15:00) loses the gap from 8:30-10:30 where the resource is busy.

### Step 1: Identify primary task per combo

For each combo, walk each task's range windows and compute total feasible duration:

```typescript
function computeFeasibleDuration(rangeWindows: CTPRangeWindows): number {
  let total = 0;
  let node = rangeWindows.head;
  while (node) {
    const range = node.data.lst - node.data.est;
    if (range > 0) total += range;
    node = node.next;
  }
  return total;
}
```

The task with the **smallest** total feasible duration is the most constrained — tag it as `primaryIndex` on the combo. **Do not filter by task type.** If RECOVERY has the tightest windows (bays are slammed), it should drive placement — PROC and SETUP derive their placement from RECOVERY's constraints, not the other way around. Let the data decide what's constraining the chain.

**Note:** This can vary per combo. Combo with AN-JONES might have PROC less constrained (Jones has wide availability) while combo with AN-GARCIA has PROC more constrained (Garcia's shift limits it). Different combos may have different primary tasks. Even within the same chain, Combo A might anchor on PROC while Combo B anchors on RECOVERY.

### Step 2: Propagate outward from primary

Replace the current linear forward-then-backward propagation with **outward propagation from the primary task**.

**From primary, propagate backward to predecessors:**

For each predecessor (walking from primary toward the first task):

```
pred.LST = min(pred.LST, succ.EST - pred.duration - maxGap_adjustment)
pred.EST = max(pred.EST, succ.EST - pred.duration - maxGap)  // if maxGap is set
```

But critically: this must be done **per range window**, not on collapsed bounds. If the primary task has two feasible windows (morning and afternoon), the predecessor's windows must be computed relative to each.

**From primary, propagate forward to successors:**

For each successor (walking from primary toward the last task):

```
succ.EST = max(succ.EST, pred.EET + maxGap_adjustment)
succ.LST = min(succ.LST, pred.LET + maxGap)  // if maxGap is set
```

**After propagation, eliminate range windows that are no longer feasible:**

For each task, walk its range windows and remove any where `est > lst` (the window collapsed). If all windows are eliminated for any task, the combo is infeasible.

### Step 3: Compute chain-level feasible window

After propagation, each task has a tightened set of range windows. The chain's feasible window is determined by the intersection of all tasks' propagated windows, respecting precedence.

For each remaining range window of the primary task:
1. Walk backward: does each predecessor have a range window that can produce a valid placement?
2. Walk forward: does each successor have a range window that can accept the output?

If yes → this is a valid chain placement option with a chain-level EST (earliest the first task can start) and LST (latest the first task can start).

### Step 4: Assign start times (revised)

Replace the current Task-0-anchored `assignStartTimes()`.

New logic:
1. Pick the primary task's earliest feasible range window
2. Assign the primary task to the earliest start within that window
3. Walk backward: for each predecessor, find the latest start that satisfies maxGap (pack the chain tight)
4. Walk forward: for each successor, find the earliest start that satisfies maxGap

This produces the tightest possible chain placement anchored on the primary task.

### Step 5: Score and select (unchanged)

Score combos as today (sum of blended scores + gap penalty). Sort by earliest chain start, then by score. Pick the winner.

---

## Changes to `chaincontextengine.ts`

### New: `computeComboRangeWindows()`

```typescript
private computeComboRangeWindows(
  combo: ChainContextCombo,
  tasks: CTPTask[],
): CTPRangeWindows[] {
  // For each task's context in the combo, extract range windows
  // from the context's start-time nodes
  const windows: CTPRangeWindows[] = [];
  for (let i = 0; i < combo.contexts.length; i++) {
    const ctx = combo.contexts[i];
    const rw = this.extractRangeWindows(ctx);
    windows.push(rw);
  }
  return windows;
}
```

### New: `identifyPrimary()`

```typescript
private identifyPrimary(windows: CTPRangeWindows[]): number {
  let minDuration = Number.MAX_VALUE;
  let primaryIndex = 0;
  for (let i = 0; i < windows.length; i++) {
    const total = this.computeFeasibleDuration(windows[i]);
    if (total < minDuration) {
      minDuration = total;
      primaryIndex = i;
    }
  }
  return primaryIndex;
}

private computeFeasibleDuration(rw: CTPRangeWindows): number {
  let total = 0;
  let node = rw.head;
  while (node) {
    const range = node.data.lst - node.data.est;
    if (range > 0) total += range;
    node = node.next;
  }
  return total;
}
```

### Modified: `propagateCombo()` → `propagateFromPrimary()`

Replace the current forward-then-backward pass with outward propagation from `primaryIndex`.

```typescript
private propagateFromPrimary(
  combo: ChainContextCombo,
  tasks: CTPTask[],
  windows: CTPRangeWindows[],
  primaryIndex: number,
): void {
  // Backward pass: from primaryIndex-1 down to 0
  for (let i = primaryIndex - 1; i >= 0; i--) {
    const succ = windows[i + 1];
    const pred = windows[i];
    const succTask = tasks[i + 1];
    const maxGap = succTask.linkId?.maxGap ?? null;
    const predDuration = tasks[i].duration?.duration() ?? 0;

    // Tighten predecessor's latest start: must finish before successor's earliest start
    // Walk successor's range windows and compute the constraint on predecessor
    this.tightenPredecessorFromSuccessor(pred, succ, predDuration, maxGap);

    // Eliminate infeasible windows
    this.eliminateInfeasibleWindows(pred);
    if (this.isEmpty(pred)) { combo.feasible = false; return; }
  }

  // Forward pass: from primaryIndex+1 up to last task
  for (let i = primaryIndex + 1; i < windows.length; i++) {
    const pred = windows[i - 1];
    const succ = windows[i];
    const succTask = tasks[i];
    const maxGap = succTask.linkId?.maxGap ?? null;
    const predDuration = tasks[i - 1].duration?.duration() ?? 0;

    // Tighten successor's earliest start: must be after predecessor's earliest end
    this.tightenSuccessorFromPredecessor(succ, pred, predDuration, maxGap);

    // Eliminate infeasible windows
    this.eliminateInfeasibleWindows(succ);
    if (this.isEmpty(succ)) { combo.feasible = false; return; }
  }
}
```

### Modified: `assignStartTimes()` → anchor on primary

```typescript
public assignStartTimes(combo: ChainContextCombo, primaryIndex: number): void {
  const windows = combo.rangeWindows; // stored from Step 0

  // 1. Pick primary task's earliest feasible range window
  const primaryWindow = this.getEarliestWindow(windows[primaryIndex]);
  if (!primaryWindow) return;

  const primaryStart = primaryWindow.est;
  const primaryDuration = combo.contexts[primaryIndex].task.duration?.duration() ?? 0;
  const primaryEnd = primaryStart + primaryDuration;

  combo.startTimes[primaryIndex].assignedStart = primaryStart;
  combo.startTimes[primaryIndex].assignedEnd = primaryEnd;

  // 2. Walk backward from primary — assign predecessors
  let succStart = primaryStart;
  for (let i = primaryIndex - 1; i >= 0; i--) {
    const predDuration = combo.contexts[i].task.duration?.duration() ?? 0;
    const maxGap = combo.contexts[i + 1].task.linkId?.maxGap ?? null;

    // Find the latest predecessor start that ends at or before succStart (respecting maxGap)
    const targetEnd = succStart; // maxGap=0 means pred must end exactly at succ start
    const predStart = this.findLatestFeasibleStart(
      windows[i], targetEnd - predDuration, targetEnd, maxGap, predDuration,
    );
    if (predStart === null) { this.clearAssignments(combo); return; }

    combo.startTimes[i].assignedStart = predStart;
    combo.startTimes[i].assignedEnd = predStart + predDuration;
    succStart = predStart;
  }

  // 3. Walk forward from primary — assign successors
  let predEnd = primaryEnd;
  for (let i = primaryIndex + 1; i < combo.contexts.length; i++) {
    const succDuration = combo.contexts[i].task.duration?.duration() ?? 0;
    const maxGap = combo.contexts[i].task.linkId?.maxGap ?? null;

    const succStart = this.findEarliestFeasibleStartInWindows(
      windows[i], predEnd, maxGap,
    );
    if (succStart === null) { this.clearAssignments(combo); return; }

    combo.startTimes[i].assignedStart = succStart;
    combo.startTimes[i].assignedEnd = succStart + succDuration;
    predEnd = succStart + succDuration;
  }
}
```

### Modified: `evaluateChain()` flow

Update the main flow to use the new approach:

```
Step 1: getContextsPerTask (unchanged)
Step 2: detectLanes (unchanged)
Step 3: buildLaneCombos / crossProduct (unchanged)
Step 4: computeComboRangeWindows (NEW — replaces cached bounds)
Step 5: identifyPrimary per combo (NEW)
Step 6: propagateFromPrimary (MODIFIED — outward from primary)
Step 7: Eliminate infeasible combos (unchanged)
Step 8: scoreChainCombos (unchanged)
Step 9: assignStartTimes with primaryIndex (MODIFIED — anchor on primary)
Step 10: Select winner (unchanged — earliest chain start, then score)
```

---

## Data Structures

### Add to `ChainContextCombo`

```typescript
export interface ChainContextCombo {
  // ... existing fields ...
  primaryIndex: number;                    // NEW — index of the most constrained task
  rangeWindows: CTPRangeWindows[];         // NEW — per-task range windows for this combo
}
```

### Range window helpers needed

```typescript
// Extract CTPRangeWindows from a ScheduleContext's start-time nodes
private extractRangeWindows(ctx: ScheduleContext): CTPRangeWindows

// Tighten predecessor windows based on successor's earliest window
private tightenPredecessorFromSuccessor(
  pred: CTPRangeWindows, succ: CTPRangeWindows,
  predDuration: number, maxGap: number | null,
): void

// Tighten successor windows based on predecessor's latest window
private tightenSuccessorFromPredecessor(
  succ: CTPRangeWindows, pred: CTPRangeWindows,
  predDuration: number, maxGap: number | null,
): void

// Remove windows where est > lst
private eliminateInfeasibleWindows(rw: CTPRangeWindows): void

// Check if any windows remain
private isEmpty(rw: CTPRangeWindows): boolean

// Get the window with the smallest est
private getEarliestWindow(rw: CTPRangeWindows): CTPRangeValues | null

// Find latest start within windows that allows ending by targetEnd
private findLatestFeasibleStart(
  rw: CTPRangeWindows, targetStart: number, targetEnd: number,
  maxGap: number | null, duration: number,
): number | null

// Find earliest start within windows that is >= predEnd (+ maxGap constraint)
private findEarliestFeasibleStartInWindows(
  rw: CTPRangeWindows, predEnd: number, maxGap: number | null,
): number | null
```

---

## What NOT to change

- **Cross-product generation** — same lane-based combo building
- **Scoring** — same blended score + gap penalty
- **Commit chain** — same `commitChain()` logic
- **Bump-and-retry** — same `findBlockers` / `selectBumpCandidate` / `unscheduleChain`
- **Infeasibility reporting** — same `buildInfeasibilityReport` (but report will now include `primaryIndex` info)
- **Context explosion** — still happens per task before the chain engine runs. The chain engine reuses these contexts but drives placement from the primary task's windows.

---

## Verification

### Unit Tests

1. **identifyPrimary — picks most constrained regardless of task type**
   - Chain: SETUP (1 resource, wide availability), PROC (3 resources, moderate availability), RECOVERY (1 resource, very tight availability)
   - RECOVERY has smallest feasible duration → primaryIndex = 2 (not PROC)
   - Engine propagates backward from RECOVERY to PROC to SETUP

2. **identifyPrimary — most constrained varies by combo**
   - Combo A: PROC with Jones → wide windows → primary = SETUP (narrow nurse window)
   - Combo B: PROC with Garcia → narrow window (shift constraint) → primary = PROC

3. **propagateFromPrimary — backward tightening**
   - PROC EST=10:30, maxGap=0, SETUP duration=30min
   - SETUP windows before propagation: [6:00-17:00]
   - After propagation: SETUP window tightened, all start times before 10:00 eliminated

4. **propagateFromPrimary — forward tightening**
   - PROC LET=16:30, RECOVERY duration=60min
   - RECOVERY windows tightened: must start by 16:30

5. **propagateFromPrimary — infeasible combo eliminated**
   - PROC only feasible 10:30-12:00, SETUP resource only available 6:00-8:00
   - maxGap=0 → SETUP must be at 10:00-10:30 → no SETUP window covers 10:00 → combo infeasible

6. **assignStartTimes — anchors on primary, not Task 0**
   - Primary is PROC (index 1), PROC EST=10:30
   - SETUP assigned at 10:00 (backward from PROC), not 6:30 (earliest available)

7. **Multiple range windows — gap preserved**
   - PROC has two windows: [7:00-8:30] and [10:30-15:00]
   - SETUP available 6:00-17:00, maxGap=0
   - Two valid chain placements: 6:30/7:00/8:30 and 10:00/10:30/12:00
   - Engine returns earliest valid: 6:30 start (if all resources work at 7:00)

8. **No lane resource on SETUP**
   - SETUP needs only a nurse, PROC needs OR + surgeon + anesthesiologist
   - No shared primary → no lane detected → simple cross-product
   - Primary is PROC → SETUP flexes around PROC placement

### Integration Tests — Healthcare

9. **C003 Monday placement**
   - Current: C003 scheduled Wednesday
   - After this sprint: C003 should schedule Monday (OR-02 + PATEL + GARCIA at 10:30)
   - SETUP at 10:00, PROC at 10:30-12:00, RECOVERY at 12:00-13:00

10. **C003 doesn't break other cases**
    - C001, C002, C004, C005 still scheduled correctly
    - Total scheduled count same or higher

11. **Manufacturing tenant unaffected**
    - No chains / single-task chains → primaryIndex = 0 → same as before
    - Results identical to pre-change

12. **HRMD sports tenant**
    - 3-task chains (Prep → Play → Reset) with cadence
    - Primary should be Play (most resource constraints)
    - Verify cadence alignment still works after primary-driven placement

### Performance

13. **Solve time comparable**
    - Healthcare: < 2x current solve time
    - HRMD: < 2x current solve time
    - If > 3x, investigate and optimize (likely too many range window operations)

---

## Summary

| Change | File | Type |
|--------|------|------|
| `computeComboRangeWindows()` | chaincontextengine.ts | New method |
| `identifyPrimary()` | chaincontextengine.ts | New method |
| `computeFeasibleDuration()` | chaincontextengine.ts | New method |
| `extractRangeWindows()` | chaincontextengine.ts | New method |
| `propagateFromPrimary()` | chaincontextengine.ts | New method (replaces `propagateCombo`) |
| `tightenPredecessorFromSuccessor()` | chaincontextengine.ts | New method |
| `tightenSuccessorFromPredecessor()` | chaincontextengine.ts | New method |
| `eliminateInfeasibleWindows()` | chaincontextengine.ts | New method |
| `assignStartTimes()` | chaincontextengine.ts | Modified — anchor on primary |
| `evaluateChain()` | chaincontextengine.ts | Modified — new step order |
| `ChainContextCombo` interface | chaincontextengine.ts | Add `primaryIndex`, `rangeWindows` |

Commit: "feat(engine): primary-task-driven chain placement — anchor on most constrained task, propagate outward"
