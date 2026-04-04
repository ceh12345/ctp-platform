import { DisjunctiveGraph } from './disjunctivegraph';
import { TranslationResult, TaskDiff } from './types';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { ScheduleEngine } from '../scheduleengine';
import { StateChangeEngine } from '../statechangeerengine';
import { ScheduleEvaluator } from '../../Solvers/evaluator';
import { BestScheduleContext, ScheduleContext } from '../../Models/Entities/schedulecontext';
import { CTPAppSettings } from '../../Models/Entities/appsettings';
import { CTPStartTimes, CTPStartTime } from '../../Models/Entities/starttime';
import { CTPResourceSlot, CTPResourceSlots } from '../../Models/Entities/slot';
import {
  CTPAssignmentConstants,
  CTPScheduleDirectionConstants,
  CTPTaskTypeConstants,
  CTPTaskStateConstants,
} from '../../Models/Core/constants';
import { CTPTask } from '../../Models/Entities/task';

// ═══════════════════════════════════════════════════════════════
//  Topological Sort
// ═══════════════════════════════════════════════════════════════

/**
 * Topological sort of graph nodes using Kahn's algorithm.
 * Returns node indices in dependency-respecting order suitable
 * for sequential rescheduling.
 *
 * Uses head-pointer queue (not .shift()) for O(T+E) performance.
 */
export function topologicalSort(graph: DisjunctiveGraph): number[] {
  const n = graph.nodes.length;
  const inDegree = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i];
    for (const succ of node.conjSuccessors) {
      inDegree[succ]++;
    }
    for (const succ of node.disjSuccessors) {
      inDegree[succ]++;
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const order: number[] = [];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    order.push(idx);
    const node = graph.nodes[idx];

    for (const succ of node.conjSuccessors) {
      if (--inDegree[succ] === 0) queue.push(succ);
    }
    for (const succ of node.disjSuccessors) {
      if (--inDegree[succ] === 0) queue.push(succ);
    }
  }

  return order;
}

// ═══════════════════════════════════════════════════════════════
//  Find Closest Start Time
// ═══════════════════════════════════════════════════════════════

/**
 * Walk the start-time linked list and find the window closest to targetStart.
 *
 * Priority:
 *  1. Exact containment: targetStart falls within [eStartW, lStartW] → immediate return.
 *  2. Closest: minimum distance from targetStart to either edge of the window.
 *
 * Returns null only if the list is empty.
 */
export function findClosestStartTime(
  startTimes: CTPStartTimes,
  targetStart: number,
): CTPStartTime | null {
  let best: CTPStartTime | null = null;
  let bestDelta = Infinity;

  let node = startTimes.head;
  while (node) {
    const st = node.data;

    // Exact containment — target falls within this window
    if (targetStart >= st.eStartW && targetStart <= st.lStartW) {
      return st;
    }

    // Otherwise track closest edge
    const delta = Math.min(
      Math.abs(targetStart - st.eStartW),
      Math.abs(targetStart - st.lStartW),
    );
    if (delta < bestDelta) {
      bestDelta = delta;
      best = st;
    }

    node = node.next;
  }

  return best;
}

// ═══════════════════════════════════════════════════════════════
//  Apply Optimized Graph to Landscape
// ═══════════════════════════════════════════════════════════════

/**
 * Translate an optimized DisjunctiveGraph back into a SchedulingLandscape.
 *
 * Algorithm:
 *  1. Unschedule all non-frozen tasks (state change tasks first, then the task itself).
 *  2. Topological-sort the optimized graph.
 *  3. For each non-frozen task in topo order:
 *     a. Build scheduling contexts via ScheduleEvaluator.
 *     b. Find the context matching the graph's target resource.
 *     c. Compute start times, pick the one closest to the graph's earliestStart.
 *     d. Schedule using ScheduleEngine.
 *     e. Create state change (changeover) tasks.
 *  4. Return counts of rescheduled / failed tasks.
 *
 * Frozen tasks are never touched — they stay exactly where the constructive solve placed them.
 *
 * @param optimizedGraph   The graph after tabu search (with optimized arc orientations).
 * @param landscape        The live landscape — will be mutated (tasks unscheduled then rescheduled).
 * @param scheduleEngine   Existing engine for schedule/unschedule operations.
 * @param stateChangeEngine  Existing engine for changeover task management.
 * @param settings         App settings (scheduleDirection, etc.).
 */
export function applyOptimizedGraph(
  optimizedGraph: DisjunctiveGraph,
  landscape: SchedulingLandscape,
  scheduleEngine: ScheduleEngine,
  stateChangeEngine: StateChangeEngine,
  settings: CTPAppSettings,
): TranslationResult {
  const result: TranslationResult = {
    tasksRescheduled: 0,
    tasksFailed: 0,
    failedTaskKeys: [],
  };

  // ─── 1. Collect non-frozen nodes ───
  const movedNodes = optimizedGraph.nodes.filter(n => !n.isFrozen);

  // ─── 2. Unschedule all non-frozen tasks ───
  // State change tasks must be removed before the parent task is unscheduled.
  const unscheduledKeys = new Set<string>();

  for (const node of movedNodes) {
    const task = landscape.tasks.getEntity(node.key);
    if (!task) continue;

    if (task.state === CTPTaskStateConstants.SCHEDULED) {
      // Remove associated state change tasks (changeovers) first
      const stTasks = stateChangeEngine.getUnScheduleStateChangeTasks(task, landscape);
      for (const st of stTasks) {
        scheduleEngine.unschedule(landscape, st);
        landscape.tasks.removeEntity(st);
      }
      // Unschedule the task itself
      scheduleEngine.unschedule(landscape, task);
    }
    unscheduledKeys.add(node.key);
  }

  // ─── 3. Topological sort of optimized graph ───
  const topoOrder = topologicalSort(optimizedGraph);

  // ─── 4. Reschedule in topological order ───
  for (const nodeIdx of topoOrder) {
    const node = optimizedGraph.nodes[nodeIdx];

    // Skip frozen tasks — they were never unscheduled
    if (node.isFrozen) continue;

    // Skip tasks we didn't unschedule (shouldn't happen, but defensive)
    if (!unscheduledKeys.has(node.key)) continue;

    const task = landscape.tasks.getEntity(node.key);
    if (!task) {
      result.tasksFailed++;
      result.failedTaskKeys.push(node.key);
      continue;
    }

    // ─── 4a. Find target resource ───
    const targetResourceKey = node.resourceKey;
    const resource = landscape.resources.getEntity(targetResourceKey);
    if (!resource) {
      result.tasksFailed++;
      result.failedTaskKeys.push(node.key);
      continue;
    }

    // Force availability recompute (intervals changed after mass unschedule)
    resource.recompute = true;

    // ─── 4b. Build scheduling contexts and find matching resource ───
    const evaluator = new ScheduleEvaluator();
    const contexts = evaluator.buildContexts(task, landscape);

    const matchingCtx = contexts.find(ctx => {
      let match = false;
      ctx.slot.resources?.forEach(r => {
        if (r.resource?.key === targetResourceKey) match = true;
      });
      return match;
    });

    if (!matchingCtx) {
      result.tasksFailed++;
      result.failedTaskKeys.push(node.key);
      continue;
    }

    // ─── 4c. Compute start times and pick closest to optimized position ───
    const startTimes = evaluator.computeStartTimes(matchingCtx, landscape);
    if (!startTimes || !startTimes.atleastOne()) {
      result.tasksFailed++;
      result.failedTaskKeys.push(node.key);
      continue;
    }

    const startTimeNode = findClosestStartTime(startTimes, node.earliestStart);
    if (!startTimeNode) {
      result.tasksFailed++;
      result.failedTaskKeys.push(node.key);
      continue;
    }

    // ─── 4d. Schedule the task ───
    const best = new BestScheduleContext(matchingCtx, startTimeNode, startTimeNode.eStartW);
    scheduleEngine.schedule(landscape, task, best, settings.scheduleDirection);

    // ─── 4e. Create state change tasks (changeovers) ───
    const scTasks = stateChangeEngine.getScheduleStateChangeTasks(task, best, landscape);
    for (const st of scTasks) {
      scheduleStateChangeTask(st, task, landscape, scheduleEngine);
    }

    result.tasksRescheduled++;
  }

  return result;
}

/**
 * Schedule a single state change (changeover) task.
 * Mirrors basescheduler.scheduleAStateChangeTask exactly:
 *   - Setup tasks go BEFORE the parent (startW - duration).
 *   - Teardown tasks go AFTER the parent (endW).
 *   - Directly constructs ScheduleContext / BestScheduleContext without the evaluator.
 *   - Wires capacity resources from the state change task's capacityResources.
 */
function scheduleStateChangeTask(
  st: CTPTask,
  parentTask: CTPTask,
  landscape: SchedulingLandscape,
  scheduleEngine: ScheduleEngine,
): void {
  if (!parentTask.scheduled || !st.duration || st.duration.duration() <= 0) return;

  const isSetup = st.type !== CTPTaskTypeConstants.TEAR_DOWN;

  const stC = new ScheduleContext(landscape, st, new CTPResourceSlots());
  const stBest = new BestScheduleContext(stC, new CTPStartTime(), 0);

  stBest.subType = CTPAssignmentConstants.CHANGE_OVER;
  stBest.startTime = isSetup
    ? parentTask.scheduled.startW - st.duration.duration()
    : parentTask.scheduled.endW;
  stBest.startTimes.eStartW = stBest.startTime;
  stBest.startTimes.eEndW = stBest.startTime;
  stBest.startTimes.processChangeDuration = 0;

  st.capacityResources?.forEach(res => {
    const resource = landscape.resources?.getEntity(res.scheduledResource ?? '');
    if (resource) {
      stBest.best.slot.resources?.add(new CTPResourceSlot(resource, res.index));
    }
  });

  landscape.tasks.addEntity(st);
  scheduleEngine.schedule(landscape, st, stBest, CTPScheduleDirectionConstants.FORWARD);
}

// ═══════════════════════════════════════════════════════════════
//  Diff Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compare original and optimized graphs to produce a list of task movements.
 *
 * Only reports non-frozen tasks that moved by more than 60 seconds or changed resource.
 * Sorted by absolute start delta (largest moves first) for UI relevance.
 *
 * Both graphs must have the same nodes in the same index positions
 * (guaranteed since they were built from the same landscape).
 */
export function computeDiff(
  originalGraph: DisjunctiveGraph,
  optimizedGraph: DisjunctiveGraph,
): TaskDiff[] {
  const diffs: TaskDiff[] = [];
  const minDeltaThreshold = 60; // Only report moves > 1 minute

  for (let i = 0; i < originalGraph.nodes.length; i++) {
    const orig = originalGraph.nodes[i];
    const opt = optimizedGraph.nodes[i];

    if (orig.isFrozen) continue;

    const startDelta = opt.earliestStart - orig.earliestStart;
    const movedResource = opt.resourceKey !== orig.resourceKey;

    if (Math.abs(startDelta) > minDeltaThreshold || movedResource) {
      diffs.push({
        taskKey: orig.key,
        taskName: orig.name,
        orderKey: orig.chainKey,
        originalStart: orig.startW,
        originalEnd: orig.endW,
        originalResource: orig.resourceKey,
        optimizedStart: opt.earliestStart,
        optimizedEnd: opt.earliestStart + opt.duration,
        optimizedResource: opt.resourceKey,
        startDelta,
        movedResource,
      });
    }
  }

  // Largest absolute moves first
  diffs.sort((a, b) => Math.abs(b.startDelta) - Math.abs(a.startDelta));
  return diffs;
}
