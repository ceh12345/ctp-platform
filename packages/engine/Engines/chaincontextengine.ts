import { CTPProcess } from '../Models/Entities/process';
import { CTPTask, CTPTaskList, CTPTaskResource } from '../Models/Entities/task';
import { ScheduleContext, ScheduleContexts, BestScheduleContext, StartTimesCache } from '../Models/Entities/schedulecontext';
import { SchedulingLandscape } from '../Models/Entities/landscape';
import { CTPScoring } from '../Models/Entities/score';
import { CTPStartTime } from '../Models/Entities/starttime';
import { CTPResource } from '../Models/Entities/resource';
import { ScoringEngine } from './scoringengine';
import { ScheduleEngine } from './scheduleengine';
import { CTPTaskStateConstants } from '../Models/Core/constants';
import { workingEndForwardW, workingStartBackwardW } from '../Models/Core/interval-walker';
import {
  InfeasibilityReport,
  ConflictType,
  classifyConflict,
  ResourceSlotReport,
  ResourceAvailabilityDetail,
  BlockingTaskDetail,
} from '../Models/Entities/infeasibilityreport';

// ── Interfaces ──────────────────────────────────────────────────────

export interface ChainStartTime {
  taskKey: string;
  eStartW: number;
  lStartW: number;
  eEndW: number;
  lEndW: number;
  assignedStart: number;
  assignedEnd: number;
}

export interface ChainContextCombo {
  chainKey: string;
  contexts: ScheduleContext[];
  laneResources: Map<number, string>;
  startTimes: ChainStartTime[];
  chainScore: number;
  feasible: boolean;
  totalGap: number;
  primaryIndex: number;
}

export interface LaneDefinition {
  laneIndex: number;
  taskKeys: string[];
  resourceKeys: string[];
}

interface ContextTimeBounds {
  eStartW: number;
  lStartW: number;
  eEndW: number;
  lEndW: number;
  duration: number;
  processChangeDuration: number;  // max state-change offset across start-time nodes
}

export interface BlockerInfo {
  blockedChainKey: string;
  blockedChainPriority: number;
  resourceKey: string;
  blockerTaskKey: string;
  blockerChainKey: string;
  blockerChainPriority: number;
  blockWindow: { start: number; end: number };
}

export interface BumpEvent {
  bumpedChainKey: string;
  bumpedChainPriority: number;
  beneficiaryChainKey: string;
  beneficiaryChainPriority: number;
  contestedResource: string;
  bumpedChainResult: 'rescheduled' | 'infeasible';
}

// ── ChainContextEngine ─────────────────────────────────────────────

export class ChainContextEngine {

  // CODE-OPTIMIZATION-SPRINT Ticket 3 — temporary A/B flag during the bench
  // window. When true, the 6 startTimes hot-path helpers
  // (isWithinStartTimeNode, getAssignedProcessChangeDuration,
  // findStartTimeNode, findEarliestFeasibleStart,
  // findLatestFeasibleStartForPred, computeContextFeasibleDuration) use a
  // typed-array cache on ScheduleContext + binary search where applicable
  // instead of head-walking ctx.slot.startTimes. Cleanup commit will remove
  // the flag and replace each helper's body with the fast path only.
  public useStartTimesCache: boolean = false;

  /**
   * Build (or return cached) the typed-array snapshot of ctx.slot.startTimes.
   * Invalidated by bumping ctx._stCacheVersion at every in-cycle mutation
   * site (currently only truncateContextStartTimes — see comment there).
   */
  private getStCache(ctx: ScheduleContext): StartTimesCache | null {
    if (ctx._stCache && ctx._stCache.version === ctx._stCacheVersion) {
      return ctx._stCache;
    }
    const st = ctx.slot.startTimes;
    if (!st?.head) {
      ctx._stCache = null;
      return null;
    }
    // First pass: count nodes so we can allocate exact-size typed arrays.
    // Narrowed scope (find-pattern helpers only) populates 3 arrays:
    // eStart and lStart for the binary search, pcd for getAssignedProcessChangeDuration.
    let n: typeof st.head | null = st.head;
    let count = 0;
    while (n) { count++; n = n.next; }
    const eStart = new Float64Array(count);
    const lStart = new Float64Array(count);
    const pcd = new Float64Array(count);
    n = st.head;
    let i = 0;
    while (n) {
      eStart[i] = n.data.eStartW;
      lStart[i] = n.data.lStartW;
      pcd[i] = n.data.processChangeDuration;
      i++;
      n = n.next;
    }
    ctx._stCache = {
      count, eStart, lStart, pcd,
      version: ctx._stCacheVersion,
    };
    return ctx._stCache;
  }

  /**
   * Evaluate an entire chain and return the best ChainContextCombo.
   * Returns null if no feasible combination exists.
   */
  public evaluateChain(
    chain: CTPProcess,
    allContexts: ScheduleContexts,
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
    maxCombos?: number,
  ): ChainContextCombo | null {
    const tasks = chain.tasks;
    if (!tasks || tasks.length === 0) return null;

    // Step 1: Collect feasible contexts per task
    const taskContextsMap = this.getContextsPerTask(tasks, allContexts);

    // Build task array sorted by sequence (chain order)
    const taskArray: CTPTask[] = [];
    tasks.forEach(t => taskArray.push(t));
    taskArray.sort((a, b) => a.sequence - b.sequence);
    for (const task of taskArray) {
      const ctxs = taskContextsMap.get(task.key);
      if (!ctxs || ctxs.length === 0) {
        this.attachInfeasibilityReport(chain, taskArray, 0, 0, 0, landscape);
        return null;
      }
    }

    // Step 2: Detect lane resources
    const lanes = this.detectLanes(tasks);

    // Step 2.5: Pre-compute context time bounds (cached for reuse across combos)
    const boundsCache = new Map<string, ContextTimeBounds>();
    taskContextsMap.forEach((contexts, taskKey) => {
      for (const ctx of contexts) {
        const cacheKey = ctx.hashKey || ctx.key;
        if (!boundsCache.has(cacheKey)) {
          const bounds = this.getContextTimeBounds(ctx);
          if (bounds) boundsCache.set(cacheKey, bounds);
        }
      }
    });

    // Step 3: Build cross-product grouped by lane
    const cap = maxCombos ?? landscape.appSettings?.maxChainCombos ?? 500;
    const combos = this.buildLaneCombos(taskArray, taskContextsMap, lanes, cap);
    if (combos.length === 0) {
      this.attachInfeasibilityReport(chain, taskArray, 0, 0, 0, landscape);
      return null;
    }

    // Step 4: Propagate timing constraints (using cached bounds)
    this.propagateAll(combos, taskArray, boundsCache);

    // Step 5: Eliminate infeasible combos
    const feasible = combos.filter(c => c.feasible);
    if (feasible.length === 0) {
      this.attachInfeasibilityReport(chain, taskArray, combos.length, 0, 0, landscape);
      return null;
    }

    // Step 5.5: Identify primary (most constrained) task per combo
    for (const combo of feasible) {
      combo.primaryIndex = this.identifyPrimary(combo);
    }

    // Step 6: Score surviving combos
    this.scoreChainCombos(feasible, landscape, scoring);

    // Step 7: Try all combos — assign start times and collect valid placements
    feasible.sort((a, b) => a.chainScore - b.chainScore);

    const validCombos: ChainContextCombo[] = [];
    for (const candidate of feasible) {
      this.assignStartTimes(candidate);

      const allAssigned = candidate.startTimes.every(
        st => st.assignedStart > 0 && st.assignedEnd > st.assignedStart
      );
      if (!allAssigned) continue;
      validCombos.push(candidate);
    }

    if (validCombos.length === 0) {
      this.attachInfeasibilityReport(chain, taskArray, combos.length, feasible.length, 0, landscape);
      return null;
    }

    // Pick the combo with the earliest first-task assignedStart.
    // Among ties, prefer lower chainScore.
    validCombos.sort((a, b) => {
      const startDiff = a.startTimes[0].assignedStart - b.startTimes[0].assignedStart;
      if (startDiff !== 0) return startDiff;
      return a.chainScore - b.chainScore;
    });

    return validCombos[0];
  }

  /**
   * Evaluate a chain and return the top-K valid combos (not just the best).
   * Used by CTP Query to present multiple placement options.
   */
  public evaluateChainAll(
    chain: CTPProcess,
    allContexts: ScheduleContexts,
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
    maxResults: number = 3,
    maxCombos?: number,
  ): ChainContextCombo[] {
    const tasks = chain.tasks;
    if (!tasks || tasks.length === 0) return [];

    // Step 1: Collect feasible contexts per task
    const taskContextsMap = this.getContextsPerTask(tasks, allContexts);

    const taskArray: CTPTask[] = [];
    tasks.forEach(t => taskArray.push(t));
    taskArray.sort((a, b) => a.sequence - b.sequence);
    for (const task of taskArray) {
      const ctxs = taskContextsMap.get(task.key);
      if (!ctxs || ctxs.length === 0) return [];
    }

    // Step 2: Detect lanes
    const lanes = this.detectLanes(tasks);

    // Step 2.5: Pre-compute context time bounds
    const boundsCache = new Map<string, ContextTimeBounds>();
    taskContextsMap.forEach((contexts) => {
      for (const ctx of contexts) {
        const cacheKey = ctx.hashKey || ctx.key;
        if (!boundsCache.has(cacheKey)) {
          const bounds = this.getContextTimeBounds(ctx);
          if (bounds) boundsCache.set(cacheKey, bounds);
        }
      }
    });

    // Step 3: Build cross-product
    const cap = maxCombos ?? landscape.appSettings?.maxChainCombos ?? 500;
    const combos = this.buildLaneCombos(taskArray, taskContextsMap, lanes, cap);
    if (combos.length === 0) return [];

    // Step 4: Propagate timing constraints
    this.propagateAll(combos, taskArray, boundsCache);

    // Step 5: Filter feasible
    const feasible = combos.filter(c => c.feasible);
    if (feasible.length === 0) return [];

    // Step 5.5: Identify primary task
    for (const combo of feasible) {
      combo.primaryIndex = this.identifyPrimary(combo);
    }

    // Step 6: Score
    this.scoreChainCombos(feasible, landscape, scoring);

    // Step 7: Assign start times and collect valid combos
    feasible.sort((a, b) => a.chainScore - b.chainScore);

    const validCombos: ChainContextCombo[] = [];
    for (const candidate of feasible) {
      this.assignStartTimes(candidate);
      const allAssigned = candidate.startTimes.every(
        st => st.assignedStart > 0 && st.assignedEnd > st.assignedStart
      );
      if (!allAssigned) continue;
      validCombos.push(candidate);
    }

    if (validCombos.length === 0) return [];

    // Sort by earliest start so first-seen per resource set is the earliest
    validCombos.sort((a, b) => {
      const startDiff = a.startTimes[0].assignedStart - b.startTimes[0].assignedStart;
      if (startDiff !== 0) return startDiff;
      return a.chainScore - b.chainScore;
    });

    // Deduplicate: keep only the earliest placement per unique resource combination
    const seenResourceSets = new Set<string>();
    const deduplicated: ChainContextCombo[] = [];
    for (const combo of validCombos) {
      const resourceHash = combo.contexts
        .map(ctx => {
          const keys: string[] = [];
          ctx.slot.resources?.forEach(r => {
            if (r.resource) keys.push(r.resource.key);
          });
          return keys.sort().join('+');
        })
        .join('|');
      if (!seenResourceSets.has(resourceHash)) {
        seenResourceSets.add(resourceHash);
        deduplicated.push(combo);
      }
    }

    return deduplicated.slice(0, maxResults);
  }

  // ── Step 1: Contexts per task ──

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

  // ── Step 2: Lane detection ──

  public detectLanes(tasks: CTPTaskList): LaneDefinition[] {
    const lanes: LaneDefinition[] = [];

    // Collect primary resource preferences from each task
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

    // Find shared primary resources across task pairs
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
              const laneKey = overlap.sort().join(',');
              if (!visited.has(laneKey)) {
                visited.add(laneKey);

                const laneTasks: string[] = [];
                const allPrefKeys = new Set<string>();

                tasks.forEach(task => {
                  const prims = primaryByTask.get(task.key) || [];
                  for (const p of prims) {
                    if (p.prefKeys.some(k => overlap.includes(k))) {
                      laneTasks.push(task.key);
                      p.prefKeys.forEach(k => allPrefKeys.add(k));
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

  // ── Step 3: Build lane combos (cross-product) ──

  private buildLaneCombos(
    tasks: CTPTask[],
    taskContextsMap: Map<string, ScheduleContext[]>,
    lanes: LaneDefinition[],
    maxCombos: number,
  ): ChainContextCombo[] {
    if (lanes.length === 0) {
      return this.simpleCrossProduct(tasks, taskContextsMap, maxCombos);
    }

    const combos: ChainContextCombo[] = [];

    for (const lane of lanes) {
      for (const resourceKey of lane.resourceKeys) {
        const contextSets: ScheduleContext[][] = [];
        let viable = true;

        for (const task of tasks) {
          const taskContexts = taskContextsMap.get(task.key) || [];

          if (lane.taskKeys.includes(task.key)) {
            // Lane task — only contexts using this lane resource
            const filtered = taskContexts.filter(ctx =>
              this.contextUsesResource(ctx, resourceKey)
            );
            if (filtered.length === 0) { viable = false; break; }
            contextSets.push(filtered);
          } else {
            // Non-lane task — all contexts
            if (taskContexts.length === 0) { viable = false; break; }
            contextSets.push(taskContexts);
          }
        }

        if (!viable) continue;

        // Safety cap individual sets if cross-product would be enormous (>10k)
        this.preCapContextSets(contextSets, 10000);

        const crossProduct = this.crossProductContexts(contextSets);

        for (const combo of crossProduct) {
          const laneMap = new Map<number, string>();
          laneMap.set(lane.laneIndex, resourceKey);

          combos.push({
            chainKey: tasks[0].linkId?.name || '',
            contexts: combo,
            laneResources: laneMap,
            startTimes: [],
            chainScore: Number.MAX_VALUE,
            feasible: true,
            totalGap: 0,
            primaryIndex: 0,
          });
        }
      }
    }

    return this.capCombos(combos, maxCombos);
  }

  private simpleCrossProduct(
    tasks: CTPTask[],
    taskContextsMap: Map<string, ScheduleContext[]>,
    maxCombos: number,
  ): ChainContextCombo[] {
    const contextSets: ScheduleContext[][] = [];
    for (const task of tasks) {
      const taskContexts = taskContextsMap.get(task.key) || [];
      if (taskContexts.length === 0) return [];
      contextSets.push(taskContexts);
    }

    this.preCapContextSets(contextSets, 10000);

    const crossProduct = this.crossProductContexts(contextSets);

    const combos = crossProduct.map(combo => ({
      chainKey: tasks[0].linkId?.name || '',
      contexts: combo,
      laneResources: new Map<number, string>(),
      startTimes: [] as ChainStartTime[],
      chainScore: Number.MAX_VALUE,
      feasible: true,
      totalGap: 0,
      primaryIndex: 0,
    }));

    return this.capCombos(combos, maxCombos);
  }

  /**
   * Safety cap: if cross-product would exceed hardLimit, trim each set
   * using nth-root sizing so diversity is preserved across all sets.
   */
  private preCapContextSets(contextSets: ScheduleContext[][], hardLimit: number): void {
    let estimate = 1;
    for (const set of contextSets) estimate *= set.length;
    if (estimate <= hardLimit) return;

    const n = contextSets.length;
    const perSetCap = Math.max(3, Math.floor(Math.pow(hardLimit, 1 / n)));
    for (let i = 0; i < contextSets.length; i++) {
      if (contextSets[i].length > perSetCap) {
        // Sort by earliest start time (meaningful before scoring is computed)
        contextSets[i].sort((a, b) => {
          const aStart = a.slot.startTimes?.head?.data.eStartW ?? Number.MAX_VALUE;
          const bStart = b.slot.startTimes?.head?.data.eStartW ?? Number.MAX_VALUE;
          return aStart - bStart;
        });
        contextSets[i] = contextSets[i].slice(0, perSetCap);
      }
    }
  }

  /**
   * Stratified sampling: guarantee at least one combo per lane resource
   * for coverage, then fill remaining slots with strided sampling for diversity.
   */
  private capCombos(combos: ChainContextCombo[], maxCombos: number): ChainContextCombo[] {
    if (combos.length <= maxCombos) return combos;

    const result: ChainContextCombo[] = [];
    const used = new Set<number>();

    // 1. Guarantee one combo per lane resource (coverage)
    const byLane = new Map<string, number[]>();
    combos.forEach((combo, idx) => {
      const laneKey = Array.from(combo.laneResources.values()).join(',') || 'none';
      if (!byLane.has(laneKey)) byLane.set(laneKey, []);
      byLane.get(laneKey)!.push(idx);
    });

    for (const [, indices] of byLane) {
      // Pick the middle element deterministically for each lane group
      const pick = indices[Math.floor(indices.length / 2)];
      result.push(combos[pick]);
      used.add(pick);
    }

    // 2. Fill remaining slots with strided sampling across the full array
    const remaining = maxCombos - result.length;
    if (remaining > 0) {
      const stride = combos.length / remaining;
      for (let i = 0; i < remaining; i++) {
        const pick = Math.floor(i * stride);
        if (!used.has(pick)) {
          result.push(combos[pick]);
          used.add(pick);
        } else {
          // Find nearest unused
          for (let j = pick + 1; j < combos.length; j++) {
            if (!used.has(j)) {
              result.push(combos[j]);
              used.add(j);
              break;
            }
          }
        }
      }
    }

    return result;
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

  // ── Step 4: Timing propagation ──

  private propagateAll(
    combos: ChainContextCombo[],
    tasks: CTPTask[],
    boundsCache: Map<string, ContextTimeBounds>,
  ): void {
    for (const combo of combos) {
      this.propagateCombo(combo, tasks, boundsCache);
    }
  }

  private propagateCombo(
    combo: ChainContextCombo,
    tasks: CTPTask[],
    boundsCache: Map<string, ContextTimeBounds>,
  ): void {
    const bounds: (ContextTimeBounds | null)[] = combo.contexts.map(
      ctx => boundsCache.get(ctx.hashKey || ctx.key) ?? this.getContextTimeBounds(ctx)
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
      // State-change offset shifts the predecessor's actual end on the resource
      const predOffset = bounds[i - 1]!.processChangeDuration;
      const succCalendar = combo.contexts[i].slot.resources?.at(0)?.resource?.available?.staticAvailable;

      // Floor: successor can't start before predecessor's effective end
      const predEffectiveEEnd = pred.eEndW + predOffset;
      const predEffectiveLEnd = pred.lEndW + predOffset;
      if (predEffectiveEEnd > succ.eStartW) {
        succ.eStartW = predEffectiveEEnd;
        // For FLOAT, eEndW is wall-clock end after walking succ's calendar from
        // the new eStartW for `duration` working seconds. For FIXED, falls back
        // to startW + duration.
        succ.eEndW = task.duration
          ? workingEndForwardW(succCalendar, succ.eStartW, task.duration)
          : succ.eStartW + duration;
      }

      // Ceiling: if maxGap is set, successor must start within maxGap of predecessor's latest effective end
      if (maxGap !== null) {
        const ceiling = predEffectiveLEnd + maxGap;
        if (ceiling < succ.lStartW) {
          succ.lStartW = ceiling;
          succ.lEndW = task.duration
            ? workingEndForwardW(succCalendar, succ.lStartW, task.duration)
            : succ.lStartW + duration;
        }
      }

      if (succ.eStartW > succ.lStartW) { combo.feasible = false; return; }
    }

    // BACKWARD PASS: tighten predecessor based on successor
    for (let i = working.length - 2; i >= 0; i--) {
      const pred = working[i];
      const succ = working[i + 1];
      const succTask = tasks[i + 1];
      const predTask = tasks[i];
      const maxGap = succTask.linkId?.maxGap ?? null;
      const predDuration = bounds[i]!.duration;
      const predOffset = bounds[i]!.processChangeDuration;
      const predCalendar = combo.contexts[i].slot.resources?.at(0)?.resource?.available?.staticAvailable;

      // Predecessor must finish (including state-change offset) before successor's latest start.
      // For FLOAT, derive pred.lStartW by walking back from pred.lEndW (= succ.lStartW − offset).
      const predLEndCandidate = succ.lStartW - predOffset;
      const latestPredStart = predTask.duration
        ? workingStartBackwardW(predCalendar, predLEndCandidate, predTask.duration)
        : predLEndCandidate - predDuration;
      if (latestPredStart < pred.lStartW) {
        pred.lStartW = latestPredStart;
        pred.lEndW = predTask.duration
          ? workingEndForwardW(predCalendar, pred.lStartW, predTask.duration)
          : pred.lStartW + predDuration;
      }

      // If maxGap is set: predecessor's effective end can't be earlier than succ.eStartW - maxGap
      if (maxGap !== null) {
        const earliestPredEffEnd = succ.eStartW - maxGap;
        const earliestPredEndCandidate = earliestPredEffEnd - predOffset;
        const earliestPredStart = predTask.duration
          ? workingStartBackwardW(predCalendar, earliestPredEndCandidate, predTask.duration)
          : earliestPredEndCandidate - predDuration;
        if (earliestPredStart > pred.eStartW) {
          pred.eStartW = earliestPredStart;
          pred.eEndW = predTask.duration
            ? workingEndForwardW(predCalendar, pred.eStartW, predTask.duration)
            : pred.eStartW + predDuration;
        }
      }

      if (pred.eStartW > pred.lStartW) { combo.feasible = false; return; }
    }

    combo.startTimes = working;

    // Calculate total gap (accounting for state-change offsets)
    combo.totalGap = 0;
    for (let i = 1; i < working.length; i++) {
      const predOffset = bounds[i - 1]!.processChangeDuration;
      const gap = working[i].eStartW - (working[i - 1].eEndW + predOffset);
      if (gap > 0) combo.totalGap += gap;
    }
  }

  private getContextTimeBounds(ctx: ScheduleContext): ContextTimeBounds | null {
    const st = ctx.slot.startTimes;
    if (!st) return null;

    let node = st.head;
    if (!node) return null;

    let eStartW = Number.MAX_VALUE;
    let lStartW = -Number.MAX_VALUE;
    let eEndW = Number.MAX_VALUE;
    let lEndW = -Number.MAX_VALUE;
    let duration = 0;
    let processChangeDuration = 0;

    while (node) {
      if (node.data.eStartW < eStartW) eStartW = node.data.eStartW;
      if (node.data.lStartW > lStartW) lStartW = node.data.lStartW;
      if (node.data.eEndW < eEndW) eEndW = node.data.eEndW;
      if (node.data.lEndW > lEndW) lEndW = node.data.lEndW;
      duration = node.data.duration;
      if (node.data.processChangeDuration > processChangeDuration) {
        processChangeDuration = node.data.processChangeDuration;
      }
      node = node.next;
    }

    return { eStartW, lStartW, eEndW, lEndW, duration, processChangeDuration };
  }

  // ── Primary task identification ──

  /**
   * Identify the most constrained task in a combo by total feasible duration.
   * The task with the smallest sum of (lStartW - eStartW) across its start-time
   * nodes is the most constrained — it has the least scheduling flexibility.
   */
  private identifyPrimary(combo: ChainContextCombo): number {
    let minDuration = Number.MAX_VALUE;
    let primaryIndex = 0;
    for (let i = 0; i < combo.contexts.length; i++) {
      const total = this.computeContextFeasibleDuration(combo.contexts[i]);
      if (total < minDuration) {
        minDuration = total;
        primaryIndex = i;
      }
    }
    return primaryIndex;
  }

  private computeContextFeasibleDuration(ctx: ScheduleContext): number {
    const st = ctx.slot.startTimes;
    if (!st) return 0;
    // T3 scope: iterate-all helpers were NOT included in the narrowed ship
    // (typed-array sum gave only ×2 local with measurable cache complexity).
    // Only the 3 find-pattern helpers use the binary-search fast path.
    let total = 0;
    let node = st.head;
    while (node) {
      const range = node.data.lStartW - node.data.eStartW;
      if (range > 0) total += range;
      node = node.next;
    }
    return total;
  }

  private truncateContextStartTimes(
    ctx: ScheduleContext,
    newEStartW: number,
    newLStartW: number,
  ): void {
    const st = ctx.slot.startTimes;
    if (!st) return;
    // T3 invalidation — the only in-cycle mutation site for startTimes during
    // chain evaluation. Bumping the version causes getStCache to rebuild the
    // typed arrays on next access. The other 5 startTimes mutation sites
    // (cadencefilter, computeschedulecontexts, commonstarttimes ×2,
    // evaluator unschedule) all run outside the evaluate-chain window.
    ctx._stCacheVersion++;

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

  // ── Step 6: Chain scoring ──

  private scoreChainCombos(
    combos: ChainContextCombo[],
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
  ): void {
    const scoringEngine = new ScoringEngine();

    for (const combo of combos) {
      // Save blendedScore values — contexts may be shared across combos
      const savedScores = combo.contexts.map(ctx => ctx.blendedScore.score);

      scoringEngine.computeScores(landscape, combo.contexts, scoring);

      let chainScore = 0;
      for (const ctx of combo.contexts) {
        chainScore += ctx.blendedScore.score;
      }

      // Gap penalty: 0.1 per minute of total gap
      const gapPenalty = (combo.totalGap / 60) * 0.1;
      chainScore += gapPenalty;

      combo.chainScore = chainScore;

      // Restore original scores so shared contexts aren't mutated
      combo.contexts.forEach((ctx, i) => { ctx.blendedScore.score = savedScores[i]; });
    }
  }

  // ── Step 7: Assign start times (primary-task-driven) ──

  /**
   * Assign concrete start/end times to each task in the combo.
   * Anchors on the PRIMARY task (most constrained by feasible duration),
   * then walks backward to assign predecessors and forward for successors.
   */
  public assignStartTimes(combo: ChainContextCombo): void {
    const primaryIndex = combo.primaryIndex ?? 0;
    const primaryCtx = combo.contexts[primaryIndex];
    const primarySt = primaryCtx?.slot.startTimes;
    if (!primarySt?.head) return;

    const propagatedEStartP = combo.startTimes[primaryIndex].eStartW;
    const propagatedLStartP = combo.startTimes[primaryIndex].lStartW;
    const primaryDuration = primarySt.head.data.duration;

    // Collect candidate starts for the primary task
    const candidateSet = new Set<number>();

    // 1. Direct candidates from primary's start-time nodes
    let node = primarySt.head as (typeof primarySt.head) | null;
    while (node) {
      const earliest = Math.max(node.data.eStartW, propagatedEStartP);
      const latest = Math.min(node.data.lStartW, propagatedLStartP);
      if (earliest <= latest) {
        candidateSet.add(earliest);
        candidateSet.add(latest);
      }
      node = node.next;
    }

    // 2. Predecessor-derived candidates: walk forward from each predecessor's
    //    start-time node to compute what primary start would result.
    //    For FLOAT tasks the wall-clock end depends on the calendar (working
    //    time accumulates across shift gaps), so use workingEndForwardW
    //    instead of arithmetic.
    for (let p = 0; p < primaryIndex; p++) {
      const predSt = combo.contexts[p].slot.startTimes;
      if (!predSt) continue;
      let pNode = predSt.head as (typeof predSt.head) | null;
      while (pNode) {
        let targetStart = pNode.data.eStartW;
        for (let k = p; k < primaryIndex; k++) {
          const kTask = combo.contexts[k].task;
          const offset = this.getAssignedProcessChangeDuration(combo.contexts[k], targetStart);
          const kCalendar = combo.contexts[k].slot.resources?.at(0)?.resource?.available?.staticAvailable;
          const kEnd = kTask.duration
            ? workingEndForwardW(kCalendar, targetStart, kTask.duration)
            : targetStart;
          targetStart = kEnd + offset;
        }
        if (targetStart >= propagatedEStartP && targetStart <= propagatedLStartP
            && this.isWithinStartTimeNode(primarySt, targetStart, primaryCtx)) {
          candidateSet.add(targetStart);
        }
        pNode = pNode.next;
      }
    }

    // 3. Successor-derived candidates: walk backward from each successor's
    //    start-time node to compute what primary start would align the chain.
    //    For FLOAT use workingStartBackwardW.
    for (let s = primaryIndex + 1; s < combo.contexts.length; s++) {
      const succSt = combo.contexts[s].slot.startTimes;
      if (!succSt) continue;
      let sNode = succSt.head as (typeof succSt.head) | null;
      while (sNode) {
        let targetStart = sNode.data.eStartW;
        for (let k = s - 1; k >= primaryIndex; k--) {
          const kTask = combo.contexts[k].task;
          const kCalendar = combo.contexts[k].slot.resources?.at(0)?.resource?.available?.staticAvailable;
          targetStart = kTask.duration
            ? workingStartBackwardW(kCalendar, targetStart, kTask.duration)
            : targetStart;
        }
        if (targetStart >= propagatedEStartP && targetStart <= propagatedLStartP
            && this.isWithinStartTimeNode(primarySt, targetStart, primaryCtx)) {
          candidateSet.add(targetStart);
        }
        sNode = sNode.next;
      }
    }

    const candidates = Array.from(candidateSet).sort((a, b) => a - b);

    // Apply cadence to primary if needed
    const cadence = primaryCtx.task?.cadenceIntervalMinutes;
    const cadenceSec = cadence ? cadence * 60 : 0;

    // For each primary candidate, simulate outward — collect all valid placements
    const validPlacements: { start: number; end: number }[][] = [];

    for (const rawStart of candidates) {
      let pStart = rawStart;
      if (cadenceSec > 0 && pStart % cadenceSec !== 0) {
        pStart = Math.ceil(pStart / cadenceSec) * cadenceSec;
      }
      if (pStart > propagatedLStartP) continue;
      if (!this.isWithinStartTimeNode(primarySt, pStart, primaryCtx)) continue;

      const trial: ({ start: number; end: number } | null)[] =
        new Array(combo.contexts.length).fill(null);
      // Primary trial end: walk the calendar for FLOAT, arithmetic for FIXED.
      const primaryTask = primaryCtx.task;
      const primaryCalendar = primaryCtx.slot.resources?.at(0)?.resource?.available?.staticAvailable;
      const primaryEnd = primaryTask.duration
        ? workingEndForwardW(primaryCalendar, pStart, primaryTask.duration)
        : pStart + primaryDuration;
      trial[primaryIndex] = { start: pStart, end: primaryEnd };

      let feasible = true;

      // Walk backward from primary — assign predecessors (latest feasible start)
      for (let i = primaryIndex - 1; i >= 0; i--) {
        const succStart = trial[i + 1]!.start;
        const maxGap = combo.contexts[i + 1].task.linkId?.maxGap ?? null;

        const predStart = this.findLatestFeasibleStartForPred(
          combo.contexts[i], succStart, maxGap,
          combo.startTimes[i].eStartW, combo.startTimes[i].lStartW,
        );
        if (predStart === null) { feasible = false; break; }

        const predTask = combo.contexts[i].task;
        const predCalendar = combo.contexts[i].slot.resources?.at(0)?.resource?.available?.staticAvailable;
        const predEnd = predTask.duration
          ? workingEndForwardW(predCalendar, predStart, predTask.duration)
          : predStart;
        trial[i] = { start: predStart, end: predEnd };
      }

      if (!feasible) continue;

      // Walk forward from primary — assign successors (earliest feasible start)
      for (let i = primaryIndex + 1; i < combo.contexts.length; i++) {
        const prevEnd = trial[i - 1]!.end;
        const prevOffset = this.getAssignedProcessChangeDuration(
          combo.contexts[i - 1], trial[i - 1]!.start);
        const predEffectiveEnd = prevEnd + prevOffset;
        const maxGap = combo.contexts[i].task.linkId?.maxGap ?? null;
        const propagatedEStartI = combo.startTimes[i].eStartW;

        const succStart = this.findEarliestFeasibleStart(
          combo.contexts[i], predEffectiveEnd, propagatedEStartI);
        if (succStart === null) { feasible = false; break; }

        if (maxGap !== null && succStart > predEffectiveEnd + maxGap) {
          feasible = false;
          break;
        }

        const succTask = combo.contexts[i].task;
        const succCalendar = combo.contexts[i].slot.resources?.at(0)?.resource?.available?.staticAvailable;
        const succEnd = succTask.duration
          ? workingEndForwardW(succCalendar, succStart, succTask.duration)
          : succStart;
        trial[i] = { start: succStart, end: succEnd };
      }

      if (feasible && trial.every(t => t !== null)) {
        validPlacements.push(trial as { start: number; end: number }[]);
      }
    }

    if (validPlacements.length === 0) return;

    // Pick the placement with smallest total gap (tightest chain)
    let bestPlacement = validPlacements[0];
    let bestGap = Number.MAX_VALUE;
    for (const placement of validPlacements) {
      let totalGap = 0;
      for (let i = 1; i < placement.length; i++) {
        const gap = placement[i].start - placement[i - 1].end;
        if (gap > 0) totalGap += gap;
      }
      if (totalGap < bestGap) {
        bestGap = totalGap;
        bestPlacement = placement;
      }
    }

    for (let i = 0; i < bestPlacement.length; i++) {
      combo.startTimes[i].assignedStart = bestPlacement[i].start;
      combo.startTimes[i].assignedEnd = bestPlacement[i].end;
    }
  }

  /**
   * Check if a given start time falls within any start-time node's [eStartW, lStartW] range.
   */
  private isWithinStartTimeNode(
    startTimes: any,
    start: number,
    ctx?: ScheduleContext,
  ): boolean {
    if (this.useStartTimesCache && ctx) {
      const c = this.getStCache(ctx);
      if (c) {
        // Binary search for greatest i with eStart[i] <= start.
        let lo = 0, hi = c.count - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (c.eStart[mid] <= start) { idx = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        return idx >= 0 && start <= c.lStart[idx];
      }
    }
    let node = startTimes.head;
    while (node) {
      if (start >= node.data.eStartW && start <= node.data.lStartW) return true;
      node = node.next;
    }
    return false;
  }

  /**
   * Find the earliest start from a context's start-time nodes that is
   * >= predEffectiveEnd and >= propagatedEStart.
   * Respects cadence: if the task has cadenceIntervalMinutes, snaps up
   * to the next cadence boundary within the node's range.
   */
  private findEarliestFeasibleStart(
    ctx: ScheduleContext, predEffectiveEnd: number, propagatedEStart: number,
  ): number | null {
    const st = ctx.slot.startTimes;
    if (!st) return null;

    const cadence = ctx.task?.cadenceIntervalMinutes;
    const cadenceSec = cadence ? cadence * 60 : 0;
    // T3 scope: iterate-all path stays on linked-list walk — see comment in
    // computeContextFeasibleDuration for the narrowing rationale.

    let best = Number.MAX_VALUE;
    let node = st.head;
    while (node) {
      let candidateStart = Math.max(node.data.eStartW, predEffectiveEnd, propagatedEStart);

      // Snap to next cadence boundary if needed
      if (cadenceSec > 0 && candidateStart % cadenceSec !== 0) {
        candidateStart = Math.ceil(candidateStart / cadenceSec) * cadenceSec;
      }

      if (candidateStart <= node.data.lStartW && candidateStart < best) {
        best = candidateStart;
      }
      node = node.next;
    }
    return best < Number.MAX_VALUE ? best : null;
  }

  /**
   * Find the latest feasible start for a predecessor task such that its
   * effective end (start + duration + processChangeDuration) satisfies
   * the successor's start time and maxGap constraint.
   * Used in backward walk from the primary task.
   */
  private findLatestFeasibleStartForPred(
    ctx: ScheduleContext,
    succStart: number,
    maxGap: number | null,
    propagatedEStart: number,
    propagatedLStart: number,
  ): number | null {
    const st = ctx.slot.startTimes;
    if (!st) return null;

    const duration = ctx.task.duration?.duration() ?? 0;
    const cadence = ctx.task?.cadenceIntervalMinutes;
    const cadenceSec = cadence ? cadence * 60 : 0;
    // T3 scope: iterate-all path stays on linked-list walk — see comment in
    // computeContextFeasibleDuration for the narrowing rationale.

    let best: number | null = null;
    let node = st.head;
    while (node) {
      const offset = node.data.processChangeDuration;

      // Latest start: effective end (start + duration + offset) <= succStart
      const latestBySucc = succStart - duration - offset;

      // If maxGap is set: gap = succStart - effectiveEnd <= maxGap
      // → start >= succStart - maxGap - duration - offset
      let floor = propagatedEStart;
      if (maxGap !== null) {
        floor = Math.max(floor, succStart - maxGap - duration - offset);
      }

      // Candidate: latest possible within this node
      let candidateStart = Math.min(latestBySucc, node.data.lStartW, propagatedLStart);

      // Snap to cadence boundary (snap down for latest)
      if (cadenceSec > 0 && candidateStart % cadenceSec !== 0) {
        candidateStart = Math.floor(candidateStart / cadenceSec) * cadenceSec;
      }

      // Check bounds
      const lowerBound = Math.max(node.data.eStartW, floor);
      if (candidateStart >= lowerBound) {
        if (best === null || candidateStart > best) {
          best = candidateStart;
        }
      }
      node = node.next;
    }
    return best;
  }

  /**
   * Get the processChangeDuration for a specific assigned start time within a context.
   * Finds the startTime node that covers the assigned start and returns its offset.
   */
  private getAssignedProcessChangeDuration(ctx: ScheduleContext, assignedStart: number): number {
    const st = ctx.slot.startTimes;
    if (!st) return 0;

    if (this.useStartTimesCache) {
      const c = this.getStCache(ctx);
      if (c) {
        let lo = 0, hi = c.count - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (c.eStart[mid] <= assignedStart) { idx = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (idx >= 0 && assignedStart <= c.lStart[idx]) return c.pcd[idx];
        return c.pcd[0] ?? 0;
      }
    }

    let node = st.head;
    while (node) {
      if (assignedStart >= node.data.eStartW && assignedStart <= node.data.lStartW) {
        return node.data.processChangeDuration;
      }
      node = node.next;
    }

    // Fallback: return head's processChangeDuration
    return st.head?.data.processChangeDuration ?? 0;
  }

  // ── Commit chain ──

  public commitChain(
    combo: ChainContextCombo,
    scheduleEngine: ScheduleEngine,
    landscape: SchedulingLandscape,
    direction: number,
  ): BestScheduleContext[] {
    const results: BestScheduleContext[] = [];

    for (let i = 0; i < combo.contexts.length; i++) {
      const ctx = combo.contexts[i];
      const task = ctx.task;

      // Skip pinned+scheduled tasks (actuals) — their position and resource
      // assignments were already set by applyCommitmentStack
      if (task.pinned && task.state === CTPTaskStateConstants.SCHEDULED) continue;

      const assignedStart = combo.startTimes[i].assignedStart;

      const startTimeNode = this.findStartTimeNode(ctx, assignedStart);
      if (!startTimeNode) continue;

      const best = new BestScheduleContext(ctx, startTimeNode, assignedStart);
      scheduleEngine.schedule(landscape, task, best, direction);
      results.push(best);
    }

    return results;
  }

  private findStartTimeNode(ctx: ScheduleContext, assignedStart: number): CTPStartTime | null {
    const st = ctx.slot.startTimes;
    if (!st) return null;

    if (this.useStartTimesCache) {
      const c = this.getStCache(ctx);
      if (c) {
        let lo = 0, hi = c.count - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (c.eStart[mid] <= assignedStart) { idx = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        // Map the typed-array index back to the linked-list node by walking
        // (the cache doesn't store CTPStartTime references — that would defeat
        // the cache locality benefit on the sum-path). idx is small (avg N/2
        // walks worst case, but most callers hit the same node multiple times
        // so this is dominated by binary search wins elsewhere).
        let n = st.head;
        let k = 0;
        while (n && k < idx) { n = n.next; k++; }
        if (idx >= 0 && n && assignedStart <= c.lStart[idx]) return n.data;
        return st.head?.data ?? null;
      }
    }

    let node = st.head;
    while (node) {
      if (assignedStart >= node.data.eStartW && assignedStart <= node.data.lStartW) {
        return node.data;
      }
      node = node.next;
    }

    // Fallback: return head if available
    return st.head?.data ?? null;
  }

  // ── Infeasibility Reporting ──

  private attachInfeasibilityReport(
    chain: CTPProcess,
    tasks: CTPTask[],
    combosGenerated: number,
    combosSurvivedPropagation: number,
    combosPassedAssignment: number,
    landscape: SchedulingLandscape,
  ): void {
    const report = this.buildInfeasibilityReport(
      chain, tasks, combosGenerated, combosSurvivedPropagation, combosPassedAssignment, landscape,
    );
    chain.tasks?.forEach(task => {
      task.infeasibilityReport = report;
      task.addError('ChainContextEngine', report.reason);
    });
  }

  public buildInfeasibilityReport(
    chain: CTPProcess,
    tasks: CTPTask[],
    combosGenerated: number,
    combosSurvivedPropagation: number,
    combosPassedAssignment: number,
    landscape: SchedulingLandscape,
  ): InfeasibilityReport {
    const slots: ResourceSlotReport[] = [];
    const chainKey = chain.key || tasks[0]?.linkId?.name || null;

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
            resource, windowStart, windowEnd, taskDuration, landscape,
          );

          if (analysis.availMinutes > bestAvailMinutes) bestAvailMinutes = analysis.availMinutes;

          const status: 'available' | 'partial' | 'blocked' =
            analysis.availMinutes >= (taskDuration / 60) ? 'available'
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

        const slotLabel = this.deriveSlotLabel(tr, resourceDetails);
        const existingSlot = slots.find(s => s.slotLabel === slotLabel);

        if (existingSlot) {
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
          const slotStatus: 'available' | 'partial' | 'blocked' =
            bestAvailMinutes >= (taskDuration / 60) ? 'available'
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

    // Identify bottleneck: slot with least availability
    if (slots.length > 0) {
      const sorted = [...slots].sort((a, b) => a.bestAvailableMinutes - b.bestAvailableMinutes);
      sorted[0].isBottleneck = true;
    }

    const bottleneckSlot = slots.find(s => s.isBottleneck);

    let reason = `No valid placement for ${chainKey || tasks[0]?.key}`;
    if (bottleneckSlot) {
      reason += ` — ${bottleneckSlot.slotLabel} is the bottleneck`;
      const blockedRes = bottleneckSlot.resources.filter(r => r.status === 'blocked');
      if (blockedRes.length > 0) {
        const names = blockedRes.map(r => r.resourceName).join(', ');
        reason += ` (${names} fully blocked)`;
      }
    }

    const report: InfeasibilityReport = {
      taskKey: tasks[0]?.key || '',
      chainKey,
      reason,
      bottleneckSlot: bottleneckSlot?.slotLabel || null,
      conflictType: 'dependency',
      conflictTypeReason: '',
      slots,
      combosGenerated,
      combosSurvivedPropagation,
      combosPassedAssignment,
    };

    const classification = classifyConflict(report);
    report.conflictType = classification.type;
    report.conflictTypeReason = classification.reason;
    report.reason = `[${classification.type.toUpperCase()}] ${report.reason}`;

    return report;
  }

  private analyzeResourceAvailability(
    resource: CTPResource,
    windowStart: number,
    windowEnd: number,
    taskDuration: number,
    landscape: SchedulingLandscape,
  ): { availMinutes: number; blockingTasks: BlockingTaskDetail[]; note: string | null } {
    let availMinutes = 0;
    const blockingTasks: BlockingTaskDetail[] = [];
    let note: string | null = null;

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
              commitmentLevel: blockerTask?.commitmentLevel,
              dispatched: blockerTask?.dispatched,
              materialsPulled: blockerTask?.materialsPulled,
              holdReason: blockerTask?.holdReason,
              percentComplete: blockerTask?.percentComplete,
            });
          }
        }
        assNode = assNode.next;
      }
    }

    if (availMinutes < 0) availMinutes = 0;
    return { availMinutes, blockingTasks, note };
  }

  private deriveSlotLabel(
    tr: CTPTaskResource,
    resources: ResourceAvailabilityDetail[],
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
}

// ── Standalone Bump-and-Retry Functions ─────────────────────────────

export function findBlockers(
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
            if (blockerChainKey === (chain.key || chain.tasks?.at(0)?.linkId?.name)) {
              node = node.next;
              continue;
            }

            const blockerChain = landscape.processes?.getEntity(blockerChainKey);
            const blockerPriority = getChainPriority(blockerChain, landscape);

            blockers.push({
              blockedChainKey: chain.key || chain.tasks?.at(0)?.linkId?.name || '',
              blockedChainPriority: chainPriority,
              resourceKey: pref.resourceKey,
              blockerTaskKey,
              blockerChainKey,
              blockerChainPriority: blockerPriority,
              blockWindow: { start: assignment.startW, end: assignment.endW },
            });
          }
          node = node.next;
        }
      }
    });
  });

  return blockers;
}

export function getChainPriority(
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

export function selectBumpCandidate(
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

export function unscheduleChain(
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

export function markChainInfeasible(chain: CTPProcess, reason: string): void {
  chain.tasks?.forEach(task => {
    if (task.state !== CTPTaskStateConstants.SCHEDULED) {
      task.addError('ChainContextEngine', reason);
    }
  });
}
