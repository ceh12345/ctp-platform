# Engine Sprint: Cadence Profiles

**What it does:** Introduces **cadence profiles** — tenant-level scheduling rules that snap task start times to defined boundaries (every 30 min, 15 min, 60 min, etc.). Cadences are NOT resources. They're post-filters on computed start times. Defined in tenant config, assigned at the process level (with task override), and span the entire horizon.

**Replaces:** The PB-TIMESLOT pooled resource hack in the HRMD tenant.

**Size:** ~1-2 hours CC work  
**Depends on:** Nothing  
**Enables:** Clean pickleball scheduling, reusable for any tenant needing time-grid alignment

---

## Why

The current PB-TIMESLOT approach models a scheduling rule as a capacity resource. This causes:

1. **Duration mismatch** — a 60-minute game must span two 30-minute timeslot intervals
2. **Perfect-fit rejection** — zero-slack start windows get discarded, creating phantom gaps
3. **Context explosion** — the timeslot multiplies resource combinations unnecessarily
4. **Conceptual mismatch** — "games start on the half hour" is a policy, not a resource

A cadence is a **start-time filter**: after the solver computes feasible start times from real resources (courts, fields, staff), the cadence eliminates any start that doesn't land on a boundary tick. Simple, clean, no side effects.

---

## Part 1: Cadence Configuration

### 1a. New tenant config file: `cadences.json`

Each tenant can define zero or more cadence profiles:

```json
[
  { "key": "CADENCE-30", "name": "30-Minute Boundaries", "intervalMinutes": 30 },
  { "key": "CADENCE-15", "name": "15-Minute Boundaries", "intervalMinutes": 15 },
  { "key": "CADENCE-60", "name": "Hourly Boundaries", "intervalMinutes": 60 }
]
```

That's it. No operating hours, no capacity, no resource class. The cadence spans the **entire horizon** — ticks are generated from horizon start to horizon end at the specified interval.

Manufacturing tenant might have no `cadences.json` (or an empty array). Healthcare might have `CADENCE-15`. HRMD has `CADENCE-30` and optionally `CADENCE-60`.

### 1b. Config loader

Add to `ConfigService`:

```typescript
private cadences: Map<string, CadenceProfile> = new Map();

loadCadences(): void {
  const data = this.readJsonFile('cadences.json');
  if (!data || !Array.isArray(data)) return;

  for (const c of data) {
    this.cadences.set(c.key, {
      key: c.key,
      name: c.name,
      intervalMinutes: c.intervalMinutes,
    });
  }
}

getCadence(key: string): CadenceProfile | undefined {
  return this.cadences.get(key);
}

getCadences(): CadenceProfile[] {
  return Array.from(this.cadences.values());
}
```

### 1c. CadenceProfile interface

```typescript
export interface CadenceProfile {
  key: string;
  name: string;
  intervalMinutes: number;
}
```

---

## Part 2: Process-Level Assignment

### 2a. Add `cadence` field to processes.json

Cadence is set at the process level. All tasks in that process inherit it.

**HRMD Sports:**
```json
[
  { "key": "baseball-tball", "name": "T-Ball Game", "category": "Baseball", "cadence": "CADENCE-60" },
  { "key": "baseball-coachpitch", "name": "Coach Pitch Game", "category": "Baseball", "cadence": "CADENCE-60" },
  { "key": "baseball-minors", "name": "Minors Game", "category": "Baseball", "cadence": "CADENCE-60" },
  { "key": "baseball-majors", "name": "Majors Game", "category": "Baseball", "cadence": "CADENCE-60" },
  { "key": "flag-football-k2", "name": "Flag Football K-2", "category": "Flag Football", "cadence": "CADENCE-60" },
  { "key": "flag-football-35", "name": "Flag Football 3-5", "category": "Flag Football", "cadence": "CADENCE-60" },
  { "key": "flag-football-68", "name": "Flag Football 6-8", "category": "Flag Football", "cadence": "CADENCE-60" },
  { "key": "pickleball-open", "name": "Pickleball Open Doubles", "category": "Pickleball", "cadence": "CADENCE-30" },
  { "key": "pickleball-dropin", "name": "Pickleball Drop-In Reservation", "category": "Pickleball", "cadence": "CADENCE-30" }
]
```

**Healthcare:**
```json
[
  { "key": "knee-replacement", "name": "Knee Replacement", "category": "Orthopedic", "cadence": "CADENCE-15" },
  { "key": "cataract", "name": "Cataract Surgery", "category": "Ophthalmology", "cadence": "CADENCE-15" }
]
```

**Manufacturing:** No cadence field — tasks start whenever capacity allows.

### 2b. Add `cadence` to CTPProcess

In `process.ts`:

```typescript
export class CTPProcess extends CTPKeyEntity implements IProcess {
  tasks: CTPTaskList | undefined;
  category: string | undefined;
  cadence: string | undefined;          // NEW — cadence profile key

  constructor(n: string) {
    super('', n, n);
    this.tasks = new CTPTaskList();
    this.category = undefined;
    this.cadence = undefined;
  }
}
```

Populate during process config loading:

```typescript
const process = new CTPProcess(p.name);
process.key = p.key;
process.category = p.category ?? undefined;
process.cadence = p.cadence ?? undefined;   // NEW
```

### 2c. Task-level override (optional)

A task can override its process cadence in `tasks.json`:

```json
{
  "key": "SPECIAL-GAME-01",
  "cadence": "CADENCE-15"
}
```

Or explicitly disable cadence for one task:

```json
{
  "key": "MAKEUP-GAME-01",
  "cadence": null
}
```

### 2d. Add `cadence` to CTPTask

```typescript
export class CTPTask extends CTPKeyEntity implements ITask {
  // ... existing fields ...
  public cadence: string | null | undefined = undefined;  // NEW
  // undefined = inherit from process (default)
  // string = use this cadence profile key
  // null = explicitly no cadence (override process default)
}
```

### 2e. Resolve effective cadence for a task

```typescript
function getEffectiveCadence(
  task: CTPTask,
  landscape: SchedulingLandscape,
  configService: ConfigService
): CadenceProfile | undefined {
  // Task-level override takes priority
  if (task.cadence !== undefined) {
    if (task.cadence === null) return undefined;  // explicitly disabled
    return configService.getCadence(task.cadence);
  }

  // Fall back to process-level cadence
  if (task.process) {
    const proc = landscape.processes?.getEntity(task.process);
    if (proc?.cadence) {
      return configService.getCadence(proc.cadence);
    }
  }

  return undefined;  // no cadence — start times unfiltered
}
```

---

## Part 3: Boundary Tick Generation

### 3a. Generate ticks for a cadence profile

Generate boundary ticks across the entire horizon.

```typescript
function generateCadenceTicks(
  cadence: CadenceProfile,
  horizon: CTPHorizon
): number[] {
  const ticks: number[] = [];
  const intervalSec = cadence.intervalMinutes * 60;

  // Align to the interval grid from midnight
  const horizonStartSec = horizon.startW;
  const midnight = Math.floor(horizonStartSec / 86400) * 86400;
  let tick = midnight;

  // Advance to first tick >= horizon start
  while (tick < horizonStartSec) {
    tick += intervalSec;
  }

  // Generate ticks until horizon end
  while (tick <= horizon.endW) {
    ticks.push(tick);
    tick += intervalSec;
  }

  return ticks;
}
```

### 3b. Cache ticks per cadence profile per solve

Generate once, reuse for all tasks with that cadence:

```typescript
const cadenceTickCache = new Map<string, number[]>();

function getCachedTicks(
  cadenceKey: string,
  configService: ConfigService,
  horizon: CTPHorizon
): number[] {
  let ticks = cadenceTickCache.get(cadenceKey);
  if (!ticks) {
    const cadence = configService.getCadence(cadenceKey);
    if (!cadence) return [];
    ticks = generateCadenceTicks(cadence, horizon);
    cadenceTickCache.set(cadenceKey, ticks);
  }
  return ticks;
}
```

For a 7-day horizon with 30-minute cadence: 7 × 48 = 336 ticks. Trivial memory.

---

## Part 4: Start Time Filtering

### 4a. Where to hook in

In the solver's inner loop, AFTER feasible start times (`CTPStartTimes`) are computed for a context from the primary resource intersection, and BEFORE scoring:

```typescript
// After start times computed for this context:
if (startTimes && startTimes.atleastOne()) {
  const cadence = getEffectiveCadence(task, landscape, configService);
  if (cadence) {
    const ticks = getCachedTicks(cadence.key, configService, landscape.horizon);
    filterStartTimesByCadence(startTimes, ticks);
  }
}
// Then proceed to scoring as normal
```

### 4b. Filter logic

Walk the `CTPStartTimes` linked list. For each `CTPStartTime` node, find boundary ticks within `[eStartW, lStartW]`. If none exist, remove the node. If some exist, tighten the window.

```typescript
function filterStartTimesByCadence(
  startTimes: CTPStartTimes,
  ticks: number[]
): void {
  let stNode = startTimes.head;

  while (stNode) {
    const st = stNode.data;
    const nextNode = stNode.next;

    // Binary search for first tick >= eStartW
    let lo = 0, hi = ticks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] < st.eStartW) lo = mid + 1;
      else hi = mid;
    }

    // Collect ticks within [eStartW, lStartW]
    const firstTickIdx = lo;
    let lastTickIdx = -1;

    for (let i = firstTickIdx; i < ticks.length && ticks[i] <= st.lStartW; i++) {
      lastTickIdx = i;
    }

    if (lastTickIdx < firstTickIdx) {
      // No boundary tick in this start time range — remove it
      startTimes.deleteNode(stNode);
    } else {
      // Tighten to boundary-aligned window
      const duration = st.eEndW - st.eStartW;  // preserve original duration

      st.eStartW = ticks[firstTickIdx];
      st.lStartW = ticks[lastTickIdx];
      st.eEndW = st.eStartW + duration;
      st.lEndW = st.lStartW + duration;
    }

    stNode = nextNode;
  }
}
```

### 4c. What this does NOT touch

- **Context explosion** — cadence is not a resource, doesn't create contexts
- **CTPRange interval walking** — unchanged, computes start times from real resources
- **Resource assignment** — no cadence assignment created
- **Resource utilization** — cadence doesn't appear
- **Unschedule** — nothing to clean up for cadence
- **Gantt** — cadence doesn't show as a resource row

---

## Part 5: Remove PB-TIMESLOT from HRMD Tenant

### 5a. Remove from resources.json

Delete the PB-TIMESLOT resource entry entirely. Remove all its availability intervals.

### 5b. Remove from task resource requirements

Every pickleball task that currently has a `capacityResources` entry for PB-TIMESLOT — remove that entry. Tasks should only reference their court resources (and staff/equipment if applicable).

**Before:**
```json
"capacityResources": [
  { "isPrimary": true, "preferences": [{ "resource": "SP-COURT11" }] },
  { "isPrimary": false, "resource": "PB-TIMESLOT" }
]
```

**After:**
```json
"capacityResources": [
  { "isPrimary": true, "preferences": [{ "resource": "SP-COURT11" }] }
]
```

The cadence alignment comes from the process definition, not the task's resource list.

### 5c. Add cadences.json

```json
[
  { "key": "CADENCE-30", "name": "30-Minute Boundaries", "intervalMinutes": 30 },
  { "key": "CADENCE-60", "name": "Hourly Boundaries", "intervalMinutes": 60 }
]
```

### 5d. Update processes.json with cadence references

As shown in Part 2a — pickleball processes get `CADENCE-30`, baseball and flag football get `CADENCE-60`.

---

## Part 6: Solve Response

### 6a. Include cadence info on task response (optional)

In `extractResults()`, if a task has an effective cadence, include it:

```typescript
// Look up effective cadence for this task
let cadenceInfo: any = undefined;
if (task.cadence !== null) {
  const cadenceKey = task.cadence ?? proc?.cadence;
  if (cadenceKey) {
    const cadence = this.configService.getCadence(cadenceKey);
    if (cadence) {
      cadenceInfo = {
        key: cadence.key,
        intervalMinutes: cadence.intervalMinutes,
      };
    }
  }
}

const taskResult = {
  // ... existing fields ...
  cadence: cadenceInfo,
};
```

### 6b. Include cadence profiles in response metadata (optional)

```typescript
return {
  // ... existing response ...
  cadences: this.configService.getCadences(),
};
```

---

## Part 7: Tests

Create: `tests/engine/cadence.test.ts`

### Tick Generation Tests

**Test 1: Basic tick generation**
```
Cadence: 30-minute intervals
Horizon: Sat Jun 6 07:00 – Sat Jun 6 10:00 (3 hours)
Expected: 7 ticks at 07:00, 07:30, 08:00, 08:30, 09:00, 09:30, 10:00
```

**Test 2: Multi-day tick generation**
```
Cadence: 60-minute intervals
Horizon: Sat Jun 6 07:00 – Mon Jun 8 07:00 (48 hours)
Expected: 49 ticks (one per hour including both endpoints)
```

**Test 3: 15-minute cadence**
```
Cadence: 15-minute intervals
Horizon: Mon Jun 8 08:00 – Mon Jun 8 10:00 (2 hours)
Expected: 9 ticks at 08:00, 08:15, 08:30, 08:45, 09:00, 09:15, 09:30, 09:45, 10:00
```

**Test 4: Ticks align to midnight grid**
```
Cadence: 30-minute intervals
Horizon starts at 07:15 (not on a boundary)
First tick should be 07:30 (next boundary after horizon start)
NOT 07:15 or 07:45
```

**Test 5: Empty horizon**
```
Cadence: 30-minute
Horizon: start = end (zero duration)
Expected: 0 or 1 tick
```

### Start Time Filtering Tests

**Test 6: Snaps to nearest boundaries**
```
Task: 60-min duration
Start times before: eStartW=07:10, lStartW=08:45
Cadence: 30-min ticks
After filter: eStartW=07:30, lStartW=08:30
```

**Test 7: Already on boundaries — unchanged**
```
Start times: eStartW=08:00, lStartW=09:00
Cadence: 30-min ticks
After filter: eStartW=08:00, lStartW=09:00 (unchanged)
```

**Test 8: Perfect fit on boundary — preserved**
```
Start times: eStartW=08:00, lStartW=08:00 (zero slack)
Cadence: 30-min ticks including 08:00
After filter: eStartW=08:00, lStartW=08:00 (STILL VALID)
```

**Test 9: No boundary in range — start time removed**
```
Start times: eStartW=08:05, lStartW=08:20
Cadence: 30-min ticks (08:00, 08:30)
After filter: start time node REMOVED from list
```

**Test 10: Multiple start time nodes — each filtered independently**
```
Two start time nodes:
  Node 1: eStart=07:10, lStart=07:50 → filtered to 07:30, 07:30
  Node 2: eStart=09:00, lStart=10:15 → filtered to 09:00, 10:00
Both survive, both snapped
```

**Test 11: All start time nodes removed → task infeasible**
```
Three start time nodes, none contain a boundary tick
After filter: startTimes is empty
Task should be marked infeasible
```

### Process Inheritance Tests

**Test 12: Task inherits cadence from process**
```
Process "pickleball-dropin" has cadence: "CADENCE-30"
Task RES-PB-01 has no cadence override (cadence = undefined)
getEffectiveCadence() returns CADENCE-30
```

**Test 13: Task overrides process cadence**
```
Process "pickleball-dropin" has cadence: "CADENCE-30"
Task SPECIAL-PB has cadence: "CADENCE-15"
getEffectiveCadence() returns CADENCE-15
```

**Test 14: Task disables cadence**
```
Process "pickleball-dropin" has cadence: "CADENCE-30"
Task MAKEUP-PB has cadence: null
getEffectiveCadence() returns undefined (no cadence applied)
```

**Test 15: Process has no cadence — task unconstrained**
```
Process "cnc-rough" has no cadence field
Task OP-001 has no cadence override
getEffectiveCadence() returns undefined
Start times pass through unfiltered
```

### Integration Tests

**Test 16: Back-to-back scheduling — no phantom gaps**
```
Court 11 available 07:00-22:00
Cadence: CADENCE-30
Task A: 30 min → scheduled 08:00-08:30
Task B: 30 min → should schedule 08:30-09:00 (NOT 09:00-09:30)
Verify: no phantom gap between A and B
```

**Test 17: 60-min game on 30-min cadence**
```
Court available 07:00-22:00
Cadence: CADENCE-30
Task: 60 min → scheduled at 08:00
Runs 08:00-09:00 on the court
Next task can start at 09:00
```

**Test 18: 90-min game on 30-min cadence**
```
Court available 07:00-22:00
Cadence: CADENCE-30
Task: 90 min → scheduled at 09:30
Runs 09:30-11:00
```

**Test 19: Two different cadences coexist**
```
CADENCE-30 for pickleball, CADENCE-60 for baseball
Pickleball task snaps to :00/:30
Baseball task snaps to :00 only
Both scheduled correctly, no interference
```

**Test 20: No cadences.json — engine works normally**
```
Tenant has no cadences.json file
All tasks schedule as before — no filtering
No errors, no warnings
```

---

## Summary

Cadence profiles are:
- **Tenant config** (`cadences.json`) — not resources
- **Process-level defaults** with task-level override
- **ON or OFF** — no TRACK mode
- **Horizon-spanning** — no per-day operating hours needed
- **Post-filter** on start times — no context explosion, no assignment, no utilization
- **Cached** per solve — generated once, reused for all tasks with that cadence
- **Invisible** to Gantt and resource views

This cleanly replaces PB-TIMESLOT and is immediately reusable for healthcare (15-min OR slots) and manufacturing (shift-aligned starts).
