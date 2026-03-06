# Solver Phase 3: Chain Context Engine with Bump-and-Retry

**Start a fresh CC session. Revert any Phase 2.5 propagation changes. Phase 1 (chain-aware ordering) and Phase 2 (window tightening) remain — Phase 3 replaces the per-task greedy scheduling within chains with chain-level evaluation and adds cross-chain conflict resolution.**

Stop any running dev servers on ports 3000 and 3001 before starting. Restart both after all changes are complete.

---

**What it does:** Two-pass chain solver:

- **Pass 1 (Chain Context Engine):** Evaluates entire chains as a unit. Builds the cross-product of contexts across all tasks in a chain, groups them by **lane** (shared primary resource), propagates timing constraints forward and backward within each lane combination, eliminates infeasible combos, scores survivors as complete chains, and commits the best chain combination in one shot.

- **Pass 2 (Bump-and-Retry):** When a chain fails because a lower-priority chain holds a needed resource, bump the blocker, schedule the blocked chain, then re-evaluate the bumped chain. One retry cycle, no cascading.

**Replaces:** Phase 2 per-task window tightening + Phase 2.5 propagation. Phase 1 chain-aware ordering remains — Phase 3 operates within the chain groups that Phase 1 builds.

**Size:** ~4-5 hours CC work  
**Depends on:** Phase 1 (chain ordering)

---

## Why

Phase 2 schedules chains greedily per-task: place Setup at its best slot, tighten Procedure's window based on where Setup landed, place Procedure. Each decision is permanent. If Setup picks 6:00 AM but Procedure needs DR-SMITH who starts at 7:00, there's a 45-minute gap violating maxGap=0. The solver can't go back and move Setup to 6:45.

Propagation (Phase 2.5) tried to fix this but couldn't — it operates on individual task contexts without knowing which contexts pair together across the chain. Without the cross-product, backward propagation has nothing meaningful to tighten against.

Additionally, chains evaluated independently in priority order can't handle inter-chain resource contention — Chain A grabs a resource that Chain B needed more.

Phase 3 solves both: intra-chain timing via the chain context engine, inter-chain contention via bump-and-retry.

---

## Part 1: Core Concepts

### 1a. Lane

A **lane** is a resource that must be consistent across tasks in a chain. If Setup uses OR-01, Procedure must also use OR-01.

**V1 rule: primary resource = lane resource.** `isPrimary: true` on a task resource means this resource defines the lane.

Detection:

```typescript
function getLaneResources(task: CTPTask): CTPTaskResource[] {
  return task.capacityResources?.filter(r => r.isPrimary) ?? [];
}
```

For healthcare:
```
Setup:  OR (primary, LANE), RN (float)
Proc:   OR (primary, LANE), Surgeon (float), Anesthesiologist (float), RN (float)
Rec:    Recovery Bay (primary, LANE), RN (float)
```

OR is a lane between Setup and Proc. Recovery Bay is its own lane — Rec doesn't share a primary with Setup/Proc.

For manufacturing:
```
Setup:  CNC-01 (primary, LANE)
Proc:   CNC-01 (primary, LANE)
Teardown: CNC-01 (primary, LANE)
```

All three share the machine as a lane.

### 1b. Chain Context Combination

A **ChainContextCombo** is one specific pairing of contexts across all tasks in the chain:

```typescript
interface ChainContextCombo {
  chainKey: string;                    // e.g. "CASE-002"
  contexts: ScheduleContext[];         // one per task, in sequence order
  laneResources: Map<number, string>;  // lane index → resource key (e.g. 0 → "OR-01")
  startTimes: ChainStartTime[];        // tightened start time per task
  chainScore: number;                  // combined blended score
  feasible: boolean;                   // survives propagation?
  totalGap: number;                    // sum of gaps between phases (seconds)
}
```

### 1c. ChainStartTime

Per-task timing within a chain combo, after propagation:

```typescript
interface ChainStartTime {
  taskKey: string;
  eStartW: number;        // tightened earliest start
  lStartW: number;        // tightened latest start
  eEndW: number;          // tightened earliest end
  lEndW: number;          // tightened latest end
  assignedStart: number;  // final picked start time (after scoring)
  assignedEnd: number;    // final picked end time
}
```

---

## Part 2: Add maxGap to CTPLinkId

Update `linkid.ts`:

```typescript
export interface ILinkId {
  name: string;
  type: string;
  prevLink: string;
  maxGap: number | null;    // max seconds between predecessor end and successor start
                            //  null = unconstrained (no gap limit)
                            //   0   = back-to-back (no gap allowed)
                            //  >0   = max seconds of gap allowed (900 = 15 min)
                            //  <0   = RESERVED for future overlap support (successor starts before pred ends)
                            //         Do NOT use negative values in V1 — treat as null if encountered
}

export class CTPLinkId implements ILinkId {
  public name: string;
  public type: string;
  public prevLink: string;
  public maxGap: number | null;

  constructor(n?: string, t?: string, prev?: string, maxGap?: number | null) {
    this.name = n ?? '';
    this.type = t ?? '';
    this.prevLink = prev ?? '';
    this.maxGap = maxGap ?? null;  // default unconstrained
  }
}
```

**Important:** Negative values are reserved for future overlap support (where a successor can start before the predecessor ends). In V1, if a negative value is encountered, treat it as `null` (unconstrained). This reserves the negative range for later without breaking anything now.

Update the config loader/hydration to read maxGap from the task JSON:

```json
{ "key": "C001-PROC", "linkId": { "name": "CASE-001", "prevLink": "C001-SETUP", "type": "ES", "maxGap": 0 } }
{ "key": "C001-REC",  "linkId": { "name": "CASE-001", "prevLink": "C001-PROC",  "type": "ES", "maxGap": 900 } }
```

---

## Part 3: Chain Context Engine

Create: `Engines/chaincontextengine.ts`

### 3a. Entry Point

```typescript
export class ChainContextEngine {

  /**
   * Evaluate an entire chain and return the best ChainContextCombo.
   * Called by the solver's chain loop instead of per-task scheduling.
   */
  public evaluateChain(
    chain: CTPProcess,
    allContexts: ScheduleContexts,
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
  ): ChainContextCombo | null {

    const tasks = chain.tasks;
    if (!tasks || tasks.length === 0) return null;

    // Step 1: Get contexts per task
    const taskContextsMap = this.getContextsPerTask(tasks, allContexts);

    // Step 2: Detect lane resources across the chain
    const lanes = this.detectLanes(tasks);

    // Step 3: Build cross-product grouped by lane
    const combos = this.buildLaneCombos(tasks, taskContextsMap, lanes);

    // Step 4: Propagate timing constraints (forward + backward)
    this.propagateAll(combos, tasks);

    // Step 5: Eliminate infeasible combos
    const feasible = combos.filter(c => c.feasible);
    if (feasible.length === 0) return null;

    // Step 6: Score surviving combos
    this.scoreChainCombos(feasible, landscape, scoring);

    // Step 7: Pick best
    feasible.sort((a, b) => a.chainScore - b.chainScore);
    return feasible[0];
  }
}
```

### 3b. Get Contexts Per Task

```typescript
private getContextsPerTask(
  tasks: CTPTaskList,
  allContexts: ScheduleContexts,
): Map<string, ScheduleContext[]> {

  const map = new Map<string, ScheduleContext[]>();

  tasks.forEach(task => {
    const taskContexts = allContexts.byTask.getEntity(task.hashKey);
    if (taskContexts) {
      const contexts: ScheduleContext[] = [];
      taskContexts.contexts.forEach(ctx => {
        if (ctx.slot.hasStartTimes()) {
          contexts.push(ctx);
        }
      });
      map.set(task.key, contexts);
    } else {
      map.set(task.key, []);
    }
  });

  return map;
}
```

### 3c. Detect Lanes

Scan primary resources across all tasks. If the same primary resource index references overlapping resource preferences in multiple tasks, it's a lane.

```typescript
interface LaneDefinition {
  laneIndex: number;                     // index into capacityResources
  taskKeys: string[];                    // which tasks participate in this lane
  resourceKeys: string[];                // all possible resource keys for this lane
}

private detectLanes(tasks: CTPTaskList): LaneDefinition[] {
  const lanes: LaneDefinition[] = [];

  // Collect primary resources from each task
  const primaryByTask = new Map<string, { index: number; prefKeys: string[] }[]>();

  tasks.forEach(task => {
    const primaries: { index: number; prefKeys: string[] }[] = [];
    task.capacityResources?.forEach((tr, idx) => {
      if (tr.isPrimary) {
        const prefKeys = tr.getEffectivePreferences().map(p => p.resourceKey);
        if (tr.resource && prefKeys.length === 0) prefKeys.push(tr.resource);
        primaries.push({ index: idx, prefKeys });
      }
    });
    primaryByTask.set(task.key, primaries);
  });

  // Find shared primary resources across tasks
  const taskKeys = Array.from(primaryByTask.keys());
  const visited = new Set<string>();

  for (let i = 0; i < taskKeys.length; i++) {
    for (let j = i + 1; j < taskKeys.length; j++) {
      const taskA = primaryByTask.get(taskKeys[i])!;
      const taskB = primaryByTask.get(taskKeys[j])!;

      for (const primA of taskA) {
        for (const primB of taskB) {
          const overlap = primA.prefKeys.filter(k => primB.prefKeys.includes(k));
          if (overlap.length > 0) {
            const laneKey = `${primA.index}:${overlap.sort().join(',')}`;
            if (!visited.has(laneKey)) {
              visited.add(laneKey);

              const laneTasks: string[] = [];
              const allPrefKeys = new Set<string>();

              tasks.forEach(task => {
                const prims = primaryByTask.get(task.key) || [];
                for (const p of prims) {
                  const ov = p.prefKeys.filter(k => overlap.includes(k));
                  if (ov.length > 0) {
                    laneTasks.push(task.key);
                    ov.forEach(k => allPrefKeys.add(k));
                    break;
                  }
                }
              });

              lanes.push({
                laneIndex: primA.index,
                taskKeys: laneTasks,
                resourceKeys: Array.from(allPrefKeys),
              });
            }
          }
        }
      }
    }
  }

  return lanes;
}
```

### 3d. Build Lane Combos (Cross-Product)

For each lane, group contexts by the lane resource they use. Then cross-product within each lane group.

```typescript
private buildLaneCombos(
  tasks: CTPTaskList,
  taskContextsMap: Map<string, ScheduleContext[]>,
  lanes: LaneDefinition[],
): ChainContextCombo[] {

  const taskArray: CTPTask[] = [];
  tasks.forEach(t => taskArray.push(t));

  if (lanes.length === 0) {
    return this.simpleCrossProduct(taskArray, taskContextsMap);
  }

  const combos: ChainContextCombo[] = [];

  for (const lane of lanes) {
    for (const resourceKey of lane.resourceKeys) {
      const contextSets: ScheduleContext[][] = [];
      let viable = true;

      for (const task of taskArray) {
        const taskContexts = taskContextsMap.get(task.key) || [];

        if (lane.taskKeys.includes(task.key)) {
          // Lane task — only contexts using this lane resource
          const filtered = taskContexts.filter(ctx =>
            this.contextUsesResource(ctx, resourceKey)
          );
          if (filtered.length === 0) { viable = false; break; }
          contextSets.push(filtered);
        } else {
          // Float task — all contexts
          if (taskContexts.length === 0) { viable = false; break; }
          contextSets.push(taskContexts);
        }
      }

      if (!viable) continue;

      // Apply hard cap before cross-product
      const MAX = 500;  // from landscape.appSettings?.maxChainCombos
      let estimate = 1;
      for (const set of contextSets) estimate *= set.length;
      if (estimate > MAX) {
        for (let i = 0; i < contextSets.length; i++) {
          contextSets[i].sort((a, b) => a.blendedScore.score - b.blendedScore.score);
          contextSets[i] = contextSets[i].slice(0, 3);
        }
      }

      const crossProduct = this.crossProductContexts(contextSets);

      for (const combo of crossProduct) {
        const laneMap = new Map<number, string>();
        laneMap.set(lane.laneIndex, resourceKey);

        combos.push({
          chainKey: taskArray[0].linkId?.name || '',
          contexts: combo,
          laneResources: laneMap,
          startTimes: [],
          chainScore: Number.MAX_VALUE,
          feasible: true,
          totalGap: 0,
        });
      }
    }
  }

  return combos;
}

private contextUsesResource(ctx: ScheduleContext, resourceKey: string): boolean {
  let found = false;
  ctx.slot.resources?.forEach(slot => {
    if (slot.resource?.key === resourceKey) found = true;
  });
  return found;
}

private crossProductContexts(contextSets: ScheduleContext[][]): ScheduleContext[][] {
  if (contextSets.length === 0) return [];
  if (contextSets.length === 1) return contextSets[0].map(c => [c]);

  let result: ScheduleContext[][] = contextSets[0].map(c => [c]);

  for (let i = 1; i < contextSets.length; i++) {
    const newResult: ScheduleContext[][] = [];
    for (const existing of result) {
      for (const ctx of contextSets[i]) {
        newResult.push([...existing, ctx]);
      }
    }
    result = newResult;
  }

  return result;
}

private simpleCrossProduct(
  tasks: CTPTask[],
  taskContextsMap: Map<string, ScheduleContext[]>,
): ChainContextCombo[] {
  const contextSets: ScheduleContext[][] = [];
  for (const task of tasks) {
    const taskContexts = taskContextsMap.get(task.key) || [];
    if (taskContexts.length === 0) return [];
    contextSets.push(taskContexts);
  }

  const crossProduct = this.crossProductContexts(contextSets);

  return crossProduct.map(combo => ({
    chainKey: tasks[0].linkId?.name || '',
    contexts: combo,
    laneResources: new Map(),
    startTimes: [],
    chainScore: Number.MAX_VALUE,
    feasible: true,
    totalGap: 0,
  }));
}
```

---

## Part 4: Timing Propagation

For each ChainContextCombo, run forward then backward passes to tighten start time ranges. Both passes operate on the specific contexts in the combo — not global ranges.

### 4a. Extract Time Bounds from Context

```typescript
interface ContextTimeBounds {
  eStartW: number;
  lStartW: number;
  eEndW: number;
  lEndW: number;
  duration: number;
}

private getContextTimeBounds(ctx: ScheduleContext): ContextTimeBounds | null {
  const st = ctx.slot.startTimes;
  if (!st || !st.head) return null;

  let eStartW = Number.MAX_VALUE;
  let lStartW = Number.MIN_VALUE;
  let eEndW = Number.MAX_VALUE;
  let lEndW = Number.MIN_VALUE;
  let duration = 0;

  let node = st.head;
  while (node) {
    if (node.data.eStartW < eStartW) eStartW = node.data.eStartW;
    if (node.data.lStartW > lStartW) lStartW = node.data.lStartW;
    if (node.data.eEndW < eEndW) eEndW = node.data.eEndW;
    if (node.data.lEndW > lEndW) lEndW = node.data.lEndW;
    duration = node.data.duration;
    node = node.next;
  }

  return { eStartW, lStartW, eEndW, lEndW, duration };
}
```

### 4b. Propagate Single Combo (Forward + Backward)

```typescript
private propagateCombo(
  combo: ChainContextCombo,
  tasks: CTPTask[],
): void {

  const bounds: (ContextTimeBounds | null)[] = combo.contexts.map(
    ctx => this.getContextTimeBounds(ctx)
  );

  for (let i = 0; i < bounds.length; i++) {
    if (!bounds[i]) { combo.feasible = false; return; }
  }

  // Working copies for propagation
  const working: ChainStartTime[] = bounds.map((b, i) => ({
    taskKey: tasks[i].key,
    eStartW: b!.eStartW,
    lStartW: b!.lStartW,
    eEndW: b!.eEndW,
    lEndW: b!.lEndW,
    assignedStart: 0,
    assignedEnd: 0,
  }));

  // FORWARD PASS: tighten successor based on predecessor
  for (let i = 1; i < working.length; i++) {
    const pred = working[i - 1];
    const succ = working[i];
    const task = tasks[i];
    const maxGap = task.linkId?.maxGap ?? null;
    const duration = bounds[i]!.duration;

    // Floor: successor can't start before predecessor's earliest end
    const floor = pred.eEndW;
    if (floor > succ.eStartW) {
      succ.eStartW = floor;
      succ.eEndW = succ.eStartW + duration;
    }

    // Ceiling: if maxGap is set, successor must start within maxGap of predecessor's latest end
    if (maxGap !== null && maxGap >= 0) {
      const ceiling = pred.lEndW + maxGap;
      if (ceiling < succ.lStartW) {
        succ.lStartW = ceiling;
        succ.lEndW = succ.lStartW + duration;
      }
    }

    if (succ.eStartW > succ.lStartW) { combo.feasible = false; return; }
  }

  // BACKWARD PASS: tighten predecessor based on successor
  for (let i = working.length - 2; i >= 0; i--) {
    const pred = working[i];
    const succ = working[i + 1];
    const succTask = tasks[i + 1];
    const maxGap = succTask.linkId?.maxGap ?? null;
    const predDuration = bounds[i]!.duration;

    // Predecessor must end before successor's latest start
    const latestPredStart = succ.lStartW - predDuration;
    if (latestPredStart < pred.lStartW) {
      pred.lStartW = latestPredStart;
      pred.lEndW = pred.lStartW + predDuration;
    }

    // If maxGap is set: predecessor must end no earlier than succ.eStartW - maxGap
    if (maxGap !== null && maxGap >= 0) {
      const earliestPredEnd = succ.eStartW - maxGap;
      const earliestPredStart = earliestPredEnd - predDuration;
      if (earliestPredStart > pred.eStartW) {
        pred.eStartW = earliestPredStart;
        pred.eEndW = pred.eStartW + predDuration;
      }
    }

    if (pred.eStartW > pred.lStartW) { combo.feasible = false; return; }
  }

  // Truncate actual CTPStartTime nodes to match propagated bounds
  for (let i = 0; i < combo.contexts.length; i++) {
    const ctx = combo.contexts[i];
    const w = working[i];

    this.truncateContextStartTimes(ctx, w.eStartW, w.lStartW);

    if (!ctx.slot.hasStartTimes()) { combo.feasible = false; return; }
  }

  combo.startTimes = working;

  // Calculate total gap
  combo.totalGap = 0;
  for (let i = 1; i < working.length; i++) {
    const gap = working[i].eStartW - working[i - 1].eEndW;
    if (gap > 0) combo.totalGap += gap;
  }
}

private truncateContextStartTimes(
  ctx: ScheduleContext,
  newEStartW: number,
  newLStartW: number,
): void {
  const st = ctx.slot.startTimes;
  if (!st) return;

  let node = st.head;
  while (node) {
    const next = node.next;

    if (node.data.lStartW < newEStartW || node.data.eStartW > newLStartW) {
      st.deleteNode(node);
    } else {
      if (node.data.eStartW < newEStartW) {
        node.data.eStartW = newEStartW;
        node.data.eEndW = newEStartW + node.data.duration;
      }
      if (node.data.lStartW > newLStartW) {
        node.data.lStartW = newLStartW;
        node.data.lEndW = newLStartW + node.data.duration;
      }
      if (!node.data.stillFeasible()) {
        st.deleteNode(node);
      }
    }

    node = next;
  }
}

private propagateAll(
  combos: ChainContextCombo[],
  tasks: CTPTaskList,
): void {
  const taskArray: CTPTask[] = [];
  tasks.forEach(t => taskArray.push(t));

  for (const combo of combos) {
    this.propagateCombo(combo, taskArray);
  }
}
```

---

## Part 5: Chain Scoring

```typescript
private scoreChainCombos(
  combos: ChainContextCombo[],
  landscape: SchedulingLandscape,
  scoring: CTPScoring,
): void {
  for (const combo of combos) {
    const scoringEngine = new ScoringEngine();
    scoringEngine.computeScores(landscape, combo.contexts, scoring);

    let chainScore = 0;
    for (const ctx of combo.contexts) {
      chainScore += ctx.blendedScore.score;
    }

    // Gap penalty: 0.1 per minute of total gap
    const gapPenalty = (combo.totalGap / 60) * 0.1;
    chainScore += gapPenalty;

    combo.chainScore = chainScore;
  }
}
```

---

## Part 6: Assign Start Times and Commit

### 6a. Pick start times for winning combo

```typescript
public assignStartTimes(combo: ChainContextCombo): void {
  for (let i = 0; i < combo.contexts.length; i++) {
    const ctx = combo.contexts[i];
    const st = ctx.slot.startTimes;
    if (!st || !st.head) continue;

    if (i === 0) {
      combo.startTimes[i].assignedStart = st.head.data.eStartW;
      combo.startTimes[i].assignedEnd = st.head.data.eStartW + st.head.data.duration;
    } else {
      const predEnd = combo.startTimes[i - 1].assignedEnd;
      const maxGap = combo.contexts[i].task.linkId?.maxGap ?? null;

      let bestStart = Number.MAX_VALUE;
      let node = st.head;
      while (node) {
        const candidateStart = Math.max(node.data.eStartW, predEnd);

        if (maxGap !== null && maxGap >= 0 && candidateStart > predEnd + maxGap) {
          node = node.next;
          continue;
        }

        if (candidateStart <= node.data.lStartW && candidateStart < bestStart) {
          bestStart = candidateStart;
        }

        node = node.next;
      }

      if (bestStart < Number.MAX_VALUE) {
        combo.startTimes[i].assignedStart = bestStart;
        combo.startTimes[i].assignedEnd = bestStart + combo.contexts[i].task.duration!.duration();
      }
    }
  }
}
```

### 6b. Commit chain

```typescript
public commitChain(
  combo: ChainContextCombo,
  scheduleEngine: ScheduleEngine,
  landscape: SchedulingLandscape,
  direction: number,
): void {
  for (let i = 0; i < combo.contexts.length; i++) {
    const ctx = combo.contexts[i];
    const assignedStart = combo.startTimes[i].assignedStart;

    const startTimeNode = this.findStartTimeNode(ctx, assignedStart);
    if (!startTimeNode) continue;

    const best = new BestScheduleContext(ctx, startTimeNode, assignedStart);
    scheduleEngine.schedule(landscape, ctx.task, best, direction);
  }
}

private findStartTimeNode(ctx: ScheduleContext, assignedStart: number): CTPStartTime | null {
  const st = ctx.slot.startTimes;
  if (!st) return null;

  let node = st.head;
  while (node) {
    if (assignedStart >= node.data.eStartW && assignedStart <= node.data.lStartW) {
      return node.data;
    }
    node = node.next;
  }
  return null;
}
```

---

## Part 7: Bump-and-Retry (Cross-Chain Conflict Resolution)

When Pass 1 leaves chains infeasible, Pass 2 identifies resource blockers and bumps lower-priority chains to free resources.

### 7a. BlockerInfo

```typescript
interface BlockerInfo {
  blockedChainKey: string;
  blockedChainPriority: number;
  resourceKey: string;
  blockerTaskKey: string;
  blockerChainKey: string;
  blockerChainPriority: number;
  blockWindow: { start: number; end: number };
}
```

### 7b. Find Blockers

```typescript
function findBlockers(
  chain: CTPProcess,
  landscape: SchedulingLandscape,
): BlockerInfo[] {
  const blockers: BlockerInfo[] = [];
  const chainPriority = getChainPriority(chain, landscape);

  chain.tasks?.forEach(task => {
    if (!task.capacityResources) return;

    task.capacityResources.forEach(tr => {
      const prefs = tr.getEffectivePreferences();

      for (const pref of prefs) {
        const resource = landscape.resources?.getEntity(pref.resourceKey);
        if (!resource || !resource.assignments) continue;

        let node = resource.assignments.head;
        while (node) {
          const assignment = node.data;

          if (task.window && assignment.endW > task.window.startW && assignment.startW < task.window.endW) {
            const blockerTaskKey = assignment.name;
            if (!blockerTaskKey) { node = node.next; continue; }

            const blockerTask = landscape.tasks?.getEntity(blockerTaskKey);
            if (!blockerTask) { node = node.next; continue; }

            const blockerChainKey = blockerTask.linkId?.name || blockerTaskKey;
            const blockerPriority = getChainPriority(
              landscape.processes?.getEntity(blockerChainKey), landscape
            );

            if (blockerChainKey !== chain.key) {
              blockers.push({
                blockedChainKey: chain.key,
                blockedChainPriority: chainPriority,
                resourceKey: pref.resourceKey,
                blockerTaskKey,
                blockerChainKey,
                blockerChainPriority: blockerPriority,
                blockWindow: { start: assignment.startW, end: assignment.endW },
              });
            }
          }
          node = node.next;
        }
      }
    });
  });

  return blockers;
}

function getChainPriority(
  chain: CTPProcess | undefined,
  landscape: SchedulingLandscape,
): number {
  if (!chain?.tasks) return Number.MAX_VALUE;
  let best = Number.MAX_VALUE;
  chain.tasks.forEach(task => {
    if (task.priority < best) best = task.priority;
  });
  return best;
}
```

### 7c. Bump Candidate Selection

Rules:
1. **Only bump lower-priority chains** (higher number = lower priority). Don't disrupt important work.
2. **Only bump once per chain per solve.** No cascading.
3. **Max total bumps per solve:** `appSettings.maxBacktrackAttempts` (default 3).
4. **Equal priority — don't bump.** First-committed wins among equals.

```typescript
function selectBumpCandidate(
  blockers: BlockerInfo[],
  bumpedChains: Set<string>,
): BlockerInfo | null {
  const candidates = blockers.filter(b =>
    b.blockerChainPriority > b.blockedChainPriority &&
    !bumpedChains.has(b.blockerChainKey)
  );

  if (candidates.length === 0) return null;

  // Pick the lowest-priority blocker (most expendable)
  candidates.sort((a, b) => b.blockerChainPriority - a.blockerChainPriority);
  return candidates[0];
}
```

### 7d. Helper Functions

```typescript
function unscheduleChain(
  chain: CTPProcess,
  landscape: SchedulingLandscape,
  allContexts: ScheduleContexts,
): void {
  chain.tasks?.forEach(task => {
    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      task.window?.reset();
      landscape.unscheduleTask(task.key);
      allContexts.updateRecomputeByTask(task);
    }
  });
}

function recomputeChainContexts(
  chain: CTPProcess,
  landscape: SchedulingLandscape,
  allContexts: ScheduleContexts,
): void {
  chain.tasks?.forEach(task => {
    allContexts.removeByTask(task);
    task.resetScore();
    task.clearErrors();
    task.window?.reset();
    task.processed = false;
  });

  chain.tasks?.forEach(task => {
    if (task.canSolve()) {
      explodeScheduleContexts(task, landscape, allContexts);
      computeStartTimesForTask(task, allContexts);
    }
  });
}

function markChainInfeasible(chain: CTPProcess, reason: string): void {
  chain.tasks?.forEach(task => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED) {
      task.addError('ChainContextEngine', reason);
    }
  });
}
```

---

## Part 8: Full Solver Loop Integration

This is the complete two-pass flow. Replace the existing per-task chain scheduling with this:

```typescript
// ═══════════════════════════════════════════════
// SOLVER MAIN LOOP
// ═══════════════════════════════════════════════

const chainEngine = new ChainContextEngine();
const bumpedChains = new Set<string>();
const failedChains: CTPProcess[] = [];
let bumpCount = 0;
const maxBumps = landscape.appSettings?.maxBacktrackAttempts ?? 3;
const bumpEvents: BumpEvent[] = [];

// ── PASS 1: Schedule all chains in priority order ──

for (const chain of chainsInPriorityOrder) {

  // Single-task chains: use existing per-task greedy
  if (!chain.tasks || chain.tasks.length <= 1) {
    chain.tasks?.forEach(task => {
      if (task.canSolve()) {
        scheduleTaskGreedy(task, landscape, allContexts, scoring, scheduleEngine);
      }
    });
    continue;
  }

  // Multi-task chains: use chain context engine
  // Explode contexts for ALL tasks in chain first
  chain.tasks.forEach(task => {
    if (task.canSolve()) {
      explodeScheduleContexts(task, landscape, allContexts);
      computeStartTimesForTask(task, allContexts);
    }
  });

  // Evaluate chain as a unit
  const bestCombo = chainEngine.evaluateChain(chain, allContexts, landscape, scoring);

  if (bestCombo) {
    chainEngine.assignStartTimes(bestCombo);
    chainEngine.commitChain(bestCombo, scheduleEngine, landscape, direction);

    // Cascade recompute
    for (const ctx of bestCombo.contexts) {
      allContexts.updateRecompute(ctx);
    }
  } else {
    failedChains.push(chain);
  }
}

// ── PASS 2: Bump-and-retry for failed chains ──

for (const failedChain of failedChains) {
  if (bumpCount >= maxBumps) {
    markChainInfeasible(failedChain, 'Max bump attempts reached');
    continue;
  }

  const blockers = findBlockers(failedChain, landscape);
  const bumpCandidate = selectBumpCandidate(blockers, bumpedChains);

  if (!bumpCandidate) {
    markChainInfeasible(failedChain,
      blockers.length > 0
        ? `Blocked by higher-priority chain(s): ${[...new Set(blockers.map(b => b.blockerChainKey))].join(', ')}`
        : 'No feasible context combination found'
    );
    continue;
  }

  // BUMP: unschedule the blocking chain
  const blockerChain = landscape.processes?.getEntity(bumpCandidate.blockerChainKey);
  if (!blockerChain) continue;

  unscheduleChain(blockerChain, landscape, allContexts);
  bumpedChains.add(bumpCandidate.blockerChainKey);
  bumpCount++;

  console.log(`BUMP: Unscheduled ${bumpCandidate.blockerChainKey} (priority ${bumpCandidate.blockerChainPriority}) to free ${bumpCandidate.resourceKey} for ${failedChain.key}`);

  // RETRY: re-evaluate the failed chain with freed resources
  recomputeChainContexts(failedChain, landscape, allContexts);
  const retryCombo = chainEngine.evaluateChain(failedChain, allContexts, landscape, scoring);

  let beneficiaryResult: 'rescheduled' | 'infeasible' = 'infeasible';
  if (retryCombo) {
    chainEngine.assignStartTimes(retryCombo);
    chainEngine.commitChain(retryCombo, scheduleEngine, landscape, direction);
    for (const ctx of retryCombo.contexts) { allContexts.updateRecompute(ctx); }
    beneficiaryResult = 'rescheduled';
  } else {
    markChainInfeasible(failedChain, 'Still infeasible after bump');
  }

  // RESCHEDULE: re-evaluate the bumped chain with remaining resources
  recomputeChainContexts(blockerChain, landscape, allContexts);
  const bumperRetry = chainEngine.evaluateChain(blockerChain, allContexts, landscape, scoring);

  let bumpedResult: 'rescheduled' | 'infeasible' = 'infeasible';
  if (bumperRetry) {
    chainEngine.assignStartTimes(bumperRetry);
    chainEngine.commitChain(bumperRetry, scheduleEngine, landscape, direction);
    for (const ctx of bumperRetry.contexts) { allContexts.updateRecompute(ctx); }
    bumpedResult = 'rescheduled';
  } else {
    markChainInfeasible(blockerChain, `Bumped by ${failedChain.key}, could not reschedule`);
  }

  bumpEvents.push({
    bumpedChainKey: bumpCandidate.blockerChainKey,
    bumpedChainPriority: bumpCandidate.blockerChainPriority,
    beneficiaryChainKey: failedChain.key,
    beneficiaryChainPriority: getChainPriority(failedChain, landscape),
    contestedResource: bumpCandidate.resourceKey,
    bumpedChainResult: bumpedResult,
  });
}
```

---

## Part 9: Solve Response — Bump Reporting

### 9a. BumpEvent interface

```typescript
interface BumpEvent {
  bumpedChainKey: string;
  bumpedChainPriority: number;
  beneficiaryChainKey: string;
  beneficiaryChainPriority: number;
  contestedResource: string;
  bumpedChainResult: 'rescheduled' | 'infeasible';
}
```

### 9b. Add to solve stats

```typescript
solveStats: {
  // ... existing fields ...
  bumps: BumpEvent[];
  totalBumps: number;
  maxBumpsReached: boolean;
}
```

### 9c. UI display in solve summary

```
Solved: 28/30 tasks scheduled
  ⟳ 2 bumps: CASE-009 bumped for CASE-008 (rescheduled OK)
              CASE-007 bumped for CASE-003 (rescheduled OK)
```

Or:
```
  ⚠ CASE-009 bumped for CASE-008 — could not reschedule (infeasible)
```

---

## Part 10: AppSettings

```typescript
export class CTPAppSettings implements IAppSettings {
  // ... existing fields ...
  public maxBacktrackAttempts: number = 3;  // already exists — controls max bumps per solve
  public maxChainCombos: number = 500;      // NEW — hard cap on cross-product combos per chain
}
```

---

## Part 11: Update Healthcare Tenant

### 11a. Add maxGap to all 10 cases

```json
{ "key": "C001-SETUP", "linkId": { "name": "CASE-001", "prevLink": "",           "type": "ES"               } },
{ "key": "C001-PROC",  "linkId": { "name": "CASE-001", "prevLink": "C001-SETUP", "type": "ES", "maxGap": 0   } },
{ "key": "C001-REC",   "linkId": { "name": "CASE-001", "prevLink": "C001-PROC",  "type": "ES", "maxGap": 900 } }
```

Apply to all 10 cases:
- First task in chain (Setup): no maxGap field (defaults to null = unconstrained, no predecessor constraint)
- Setup → Proc: `maxGap: 0` (back-to-back, OR can't sit empty)
- Proc → Recovery: `maxGap: 900` (15 min transfer window)

---

## Part 12: Tests

Create: `tests/engine/chain-context-engine.test.ts`

### Lane Detection Tests

**Test 1: Healthcare — OR is a lane**
```
Setup: primary=OR-01, Proc: primary=OR-01, Rec: primary=REC-01
Detected lanes: [{ taskKeys: [Setup, Proc], resourceKeys: [OR-01, OR-02] }]
Rec is NOT in the OR lane
```

**Test 2: Manufacturing — machine is a lane across all three tasks**
```
Setup: primary=CNC-01, Process: primary=CNC-01, Teardown: primary=CNC-01
Detected lanes: [{ taskKeys: [Setup, Process, Teardown], resourceKeys: [CNC-01, CNC-02] }]
```

**Test 3: No shared primaries — no lanes**
```
Task A: primary=Machine-01, Task B: primary=QC-Station-01
No lanes. Cross-product uses all contexts.
```

**Test 4: Sports — single task, no chain**
```
Chain engine not invoked. Falls through to per-task greedy.
```

### Cross-Product Tests

**Test 5: Lane filtering reduces combos**
```
Setup(2) × Proc(6) × Rec(4) = 48 without lanes
With OR lane: OR-01(1×3×4=12) + OR-02(1×3×4=12) = 24 (50% reduction)
```

**Test 6: Hard cap reduces contexts per task**
```
maxChainCombos = 50
Setup(5) × Proc(20) × Rec(10) = 1000 > 50
After reduction: Setup(3) × Proc(3) × Rec(3) = 27 ≤ 50
```

### Propagation Tests

**Test 7: Forward pass — floor**
```
Setup eEndW=6:15, Proc eStartW=6:00
After forward: Proc.eStartW = 6:15
```

**Test 8: Backward pass — CASE-002 scenario**
```
Proc eStartW=7:00 (DR-SMITH), Setup duration=15min, maxGap=0
After backward: Setup.eStartW = 6:45 (must end by 7:00)
Result: Setup 6:45-7:00, Proc 7:00-8:00. Zero gap.
```

**Test 9: Forward + backward together**
```
Setup range: [6:00-7:45], Proc range: [7:00-17:00], maxGap=0
Forward: Proc.eStartW = max(7:00, 6:15) = 7:00
Backward: Setup.eStartW = 7:00 - 0 - 15min = 6:45
```

**Test 10: Infeasible combo**
```
Setup range: [6:00-6:30], Proc range: [10:00-17:00], maxGap=0
Backward: Setup needs to start 9:45 but range ends at 6:30 → infeasible
```

**Test 11: Proc → Rec maxGap=900**
```
Proc ends 8:00, Rec range: [7:00-17:00], maxGap=900
Forward: Rec eStartW=8:00, lStartW=min(17:00, 8:15) = 8:15
```

### Scoring Tests

**Test 12: Chain score = sum + gap penalty**
```
Combo A: scores sum=6.5, gap=0 → 6.5
Combo B: scores sum=4.0, gap=600s → 4.0 + 1.0 = 5.0
Combo B wins despite gap.
```

**Test 13: Zero-gap preferred when scores similar**
```
Combo A: sum=5.0, gap=0 → 5.0
Combo B: sum=4.8, gap=900s → 4.8 + 1.5 = 6.3
Combo A wins.
```

### Bump Decision Tests

**Test 14: Lower-priority blocker gets bumped**
```
CASE-008 (priority 1) blocked by CASE-009 (priority 5)
selectBumpCandidate returns CASE-009. Bump succeeds.
```

**Test 15: Higher-priority blocker NOT bumped**
```
CASE-009 (priority 5) blocked by CASE-001 (priority 1)
selectBumpCandidate returns null. CASE-009 stays infeasible.
```

**Test 16: Equal priority — no bump**
```
CASE-005 (priority 3) blocked by CASE-006 (priority 3)
No bump. First-committed wins.
```

**Test 17: Already bumped chain not bumped again**
```
CASE-009 already in bumpedChains set.
selectBumpCandidate skips it. No cascading.
```

**Test 18: Max bumps reached**
```
maxBacktrackAttempts=3, three bumps done.
Fourth failed chain → "Max bump attempts reached" → infeasible.
```

### Bump Flow Tests

**Test 19: Successful bump — both chains schedule**
```
CASE-002 holds AN-JONES. CASE-001 needs it.
Bump CASE-002 → CASE-001 gets AN-JONES.
CASE-002 reschedules with AN-GARCIA. Both scheduled ✓
```

**Test 20: Bump — bumped chain goes infeasible**
```
CASE-009 bumped. CASE-008 schedules.
CASE-009 re-evaluates: no resources left.
CASE-009 infeasible: "Bumped by CASE-008, could not reschedule"
```

**Test 21: Failed chain has multiple blockers — pick lowest priority**
```
CASE-003 blocked by CASE-007 (priority 3) and CASE-010 (priority 8)
Picks CASE-010 (most expendable).
```

### Integration Tests

**Test 22: CASE-002 — full chain placed correctly**
```
Setup(15min) → Proc(60min, maxGap=0) → Rec(90min, maxGap=900)
DR-SMITH available 7:00+
Expected: Setup 6:45-7:00, Proc 7:00-8:00, Rec 8:00-9:30
Zero gap Setup→Proc on same OR (lane).
```

**Test 23: Multiple chains, no bumps needed**
```
All chains fit on Pass 1. failedChains empty. bumpCount=0.
```

**Test 24: Non-chain tasks unaffected**
```
Standalone tasks with no linkId → per-task greedy. No regression.
```

**Test 25: Window reset between solves**
```
Solve → chains tighten windows. Solve again → windows reset. No stale data.
```

**Test 26: Pinned tasks in chain**
```
CASE-001-PROC pinned at 8:00-9:00 on OR-01.
Chain engine treats as fixed. SETUP must end by 8:00. REC must start by 9:15.
Only compatible combos survive.
```

**Test 27: Bump stats in solve response**
```
solveStats.bumps = [{ bumpedChainKey: "CASE-009", beneficiaryChainKey: "CASE-008", ... }]
solveStats.totalBumps = 1, maxBumpsReached = false
```

---

## Summary

Phase 3 is a complete two-pass chain solver:

**Pass 1 — Chain Context Engine:**
- **Lanes** — primary resources consistent across tasks. V1: isPrimary = lane.
- **Cross-product** — context combinations grouped by lane resource.
- **Forward + backward propagation** — per combo, not global. Setup at 6:45 because Proc needs 7:00 with maxGap=0.
- **Chain scoring** — sum of blended scores + gap penalty.
- **Commit all at once** — no partial placements.
- **Combinatorial control** — lane filtering + hard cap + early termination.

**Pass 2 — Bump-and-Retry:**
- **Detect** who's blocking a failed chain.
- **Bump** only lower-priority chains.
- **Retry** the failed chain with freed resources.
- **Reschedule** the bumped chain with remaining resources.
- **One bump per chain, max 3 per solve** — no cascading.
- **Report** bumps in solve stats.

Handles both intra-chain timing (propagation) and inter-chain contention (bump) in one delivery.
