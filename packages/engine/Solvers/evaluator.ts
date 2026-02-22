import { CTPTask } from '../Models/Entities/task';
import { CTPResource, CTPResourcePreference } from '../Models/Entities/resource';
import { SchedulingLandscape } from '../Models/Entities/landscape';
import { ScheduleContext } from '../Models/Entities/schedulecontext';
import { CTPStartTime, CTPStartTimes } from '../Models/Entities/starttime';
import { CTPScoring } from '../Models/Entities/score';
import { CTPResourceSlot, CTPResourceSlots } from '../Models/Entities/slot';
import { ResourceCombinationEngine } from '../Engines/combinationengine';
import { CommonStartTimesAgent } from '../AI/Agents/commonstarttimes';
import { StateChangeAgent } from '../AI/Agents/statechangeagent';
import { ComputeScoreAgent } from '../AI/Agents/computescores';

export interface WhereToOption {
  rank: number;
  resources: { resourceKey: string; resourceName: string; isPrimary: boolean }[];
  startTime: number;
  endTime: number;
  latestStart: number;
  latestEnd: number;
  duration: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  changeover: {
    from: string;
    to: string;
    duration: number;
    penalty: number;
  } | null;
  impact: {
    tightensWindow: string[];
  };
  contextHash: string;
}

export interface WhereToResult {
  taskKey: string;
  taskName: string;
  currentAssignment: {
    resources: string[];
    start: number;
    end: number;
  } | null;
  options: WhereToOption[];
  stats: {
    contextsEvaluated: number;
    feasibleCount: number;
    infeasibleCount: number;
    timeMs: number;
  };
}

export interface WhereToConstraints {
  onlyResources?: string[];
  startAfter?: number;
  startBefore?: number;
  maxResults?: number;
}

export class ScheduleEvaluator {

  /**
   * Build all feasible resource combinations for a task.
   * Replicates basescheduler.explodeScheduleContexts() logic.
   * Does NOT mutate the landscape structurally.
   */
  public buildContexts(
    task: CTPTask,
    landscape: SchedulingLandscape,
  ): ScheduleContext[] {
    const contexts: ScheduleContext[] = [];

    if (!task.capacityResources) return contexts;

    const comboEngine = new ResourceCombinationEngine();
    const resourceArr: any[] = [];

    task.capacityResources.forEach((res) => {
      if (res.isIgnored()) return;
      const effective = res.getEffectivePreferences();
      if (effective.length === 0) return;  // All preferences excluded
      resourceArr.push(effective);
    });

    if (resourceArr.length === 0) return contexts;

    const combos = comboEngine.resourcecombinations(resourceArr);
    if (!combos) return contexts;

    for (const combo of combos) {
      const slot = new CTPResourceSlots();
      let i = 0;
      for (const pref of combo) {
        const resource = landscape.resources?.getEntity(pref.resourceKey);
        if (resource) {
          slot.resources?.add(new CTPResourceSlot(resource, i));
        } else {
          slot.addToErrors('Could not find resource ' + pref.resourceKey);
        }
        i++;
      }

      const context = new ScheduleContext(landscape, task, slot);
      contexts.push(context);
    }

    return contexts;
  }

  /**
   * Compute start times for a single context.
   * Uses CommonStartTimesAgent and StateChangeAgent, then removes invalid start times.
   * Does NOT mutate the landscape structurally (only resource.recompute cache hint).
   */
  public computeStartTimes(
    context: ScheduleContext,
    landscape: SchedulingLandscape,
  ): CTPStartTimes | null {
    if (!landscape.horizon || !context.task.duration) return null;

    const st = landscape.horizon.startW;
    const et = landscape.horizon.endW;

    // Use task window if available, otherwise use horizon
    const windowStart = context.task.window ? context.task.window.startW : st;
    const windowEnd = context.task.window ? context.task.window.endW : et;

    // Compute start times using existing agent
    const startTimesAgent = new CommonStartTimesAgent();
    startTimesAgent.solve(windowStart, windowEnd, context.task.duration, context.slot, landscape);

    // Apply state changes
    const stateChangeAgent = new StateChangeAgent();
    stateChangeAgent.solve(st, et, context, landscape);

    // Remove invalid start times (replicated from ComputeScheduleContextsAgent)
    this.removeInvalidStartTimes(context);

    if (!context.slot.hasStartTimes()) return null;

    return context.slot.startTimes;
  }

  /**
   * Score a batch of contexts. Must be called with ALL feasible contexts
   * for proper normalization (min/max across all contexts).
   * Mutates only the freshly-created ScheduleContext objects (scores/blendedScore).
   */
  public scoreContexts(
    contexts: ScheduleContext[],
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
  ): void {
    const scoreAgent = new ComputeScoreAgent();
    scoreAgent.solve(landscape, contexts, scoring);
  }

  /**
   * Get the blended score and breakdown from a scored context.
   */
  public getScoreBreakdown(
    context: ScheduleContext,
  ): { blendedScore: number; breakdown: Record<string, number> } {
    const breakdown: Record<string, number> = {};
    context.scores.forEach((score) => {
      breakdown[score.name] = score.score;
    });
    return {
      blendedScore: context.blendedScore.score,
      breakdown,
    };
  }

  /**
   * Check changeover requirements for a context.
   */
  public checkChangeover(
    task: CTPTask,
    context: ScheduleContext,
    landscape: SchedulingLandscape,
  ): { from: string; to: string; duration: number; penalty: number } | null {
    if (!landscape.stateChanges || landscape.stateChanges.size() === 0) return null;

    const primarySlot = context.slot.resources?.at(0);
    if (!primarySlot?.resource) return null;

    const resource = primarySlot.resource;
    const taskProcess = task.process || task.subType || '';

    const stateChange = landscape.stateChanges.getOrDefaultProcessChange(
      resource.type,
      '',
      String(taskProcess),
    );

    if (!stateChange || stateChange.duration === 0) return null;

    return {
      from: stateChange.fromState,
      to: stateChange.toState,
      duration: stateChange.duration,
      penalty: stateChange.penalty || 0,
    };
  }

  /**
   * Main WhereTo method. Read-only — NO structural mutation of the landscape.
   */
  public whereTo(
    task: CTPTask,
    landscape: SchedulingLandscape,
    scoring: CTPScoring,
    constraints?: WhereToConstraints,
  ): WhereToResult {
    const startMs = Date.now();

    const result: WhereToResult = {
      taskKey: task.key,
      taskName: task.name,
      currentAssignment: null,
      options: [],
      stats: { contextsEvaluated: 0, feasibleCount: 0, infeasibleCount: 0, timeMs: 0 },
    };

    // Capture current assignment
    if (task.scheduled && task.scheduled.startW > 0 && task.capacityResources) {
      const resources: string[] = [];
      task.capacityResources.forEach(r => {
        if (r.scheduledResource) resources.push(r.scheduledResource);
      });
      result.currentAssignment = {
        resources,
        start: task.scheduled.startW,
        end: task.scheduled.endW,
      };
    }

    // 1. Build all contexts
    let contexts = this.buildContexts(task, landscape);
    result.stats.contextsEvaluated = contexts.length;

    // 2. Filter by resource constraints
    if (constraints?.onlyResources && constraints.onlyResources.length > 0) {
      contexts = contexts.filter(ctx => {
        const keys = this.getResourceKeys(ctx);
        return constraints.onlyResources!.some(r => keys.includes(r));
      });
    }

    // 3. Compute start times for each context, collect feasible
    const feasibleContexts: ScheduleContext[] = [];

    for (const ctx of contexts) {
      ctx.recompute = true;
      const startTimes = this.computeStartTimes(ctx, landscape);

      if (!startTimes) {
        result.stats.infeasibleCount++;
        continue;
      }

      // Apply time constraints by removing out-of-range start time entries
      if (constraints?.startAfter !== undefined) {
        this.filterStartTimesAfter(startTimes, constraints.startAfter);
        if (!startTimes.atleastOne()) {
          result.stats.infeasibleCount++;
          continue;
        }
      }

      if (constraints?.startBefore !== undefined) {
        this.filterStartTimesBefore(startTimes, constraints.startBefore);
        if (!startTimes.atleastOne()) {
          result.stats.infeasibleCount++;
          continue;
        }
      }

      result.stats.feasibleCount++;
      feasibleContexts.push(ctx);
    }

    // 4. Batch score ALL feasible contexts (required for normalization)
    if (feasibleContexts.length > 0) {
      this.scoreContexts(feasibleContexts, landscape, scoring);
    }

    // 5. Sort by blended score ascending (lower is better)
    feasibleContexts.sort((a, b) => a.blendedScore.score - b.blendedScore.score);

    // 6. Limit results
    const maxResults = constraints?.maxResults || 10;
    const limited = feasibleContexts.slice(0, maxResults);

    // 7. Build options
    result.options = limited.map((ctx, i) => {
      const firstStart = ctx.slot.startTimes!.head!.data;
      const { blendedScore, breakdown } = this.getScoreBreakdown(ctx);
      const changeover = this.checkChangeover(task, ctx, landscape);

      return {
        rank: i + 1,
        resources: this.getResourceDetails(ctx),
        startTime: firstStart.eStartW,
        endTime: firstStart.eEndW,
        latestStart: firstStart.lStartW,
        latestEnd: firstStart.lEndW,
        duration: firstStart.duration,
        score: blendedScore,
        scoreBreakdown: breakdown,
        changeover,
        impact: { tightensWindow: [] },
        contextHash: ctx.hashKey,
      };
    });

    result.stats.timeMs = Date.now() - startMs;
    return result;
  }

  /**
   * Get resource keys from a context.
   */
  public getResourceKeys(ctx: ScheduleContext): string[] {
    const keys: string[] = [];
    ctx.slot.resources?.forEach(r => {
      if (r.resource) keys.push(r.resource.key);
    });
    return keys;
  }

  /**
   * Get resource details from a context.
   */
  public getResourceDetails(ctx: ScheduleContext): { resourceKey: string; resourceName: string; isPrimary: boolean }[] {
    const details: { resourceKey: string; resourceName: string; isPrimary: boolean }[] = [];
    ctx.slot.resources?.forEach((r, i) => {
      if (r.resource) {
        details.push({
          resourceKey: r.resource.key,
          resourceName: r.resource.name,
          isPrimary: i === 0,
        });
      }
    });
    return details;
  }

  /**
   * Remove start time entries that start before the given time.
   * Entries where eStartW >= afterTime are kept.
   * Entries where lStartW >= afterTime have their eStartW adjusted.
   * Entries entirely before afterTime are removed.
   */
  private filterStartTimesAfter(startTimes: CTPStartTimes, afterTime: number): void {
    let node = startTimes.head;
    while (node) {
      if (node.data.eStartW >= afterTime) {
        // Entire range is after constraint — keep as-is
        node = node.next;
      } else if (node.data.lStartW >= afterTime) {
        // Late start is after constraint — adjust earliest to constraint
        node.data.eStartW = afterTime;
        node.data.eEndW = afterTime + node.data.duration;
        node = node.next;
      } else {
        // Entire range is before constraint — remove
        const toRemove = node;
        node = node.next;
        startTimes.deleteNode(toRemove);
      }
    }
  }

  /**
   * Remove start time entries that start after the given time.
   * Entries where lStartW <= beforeTime are kept.
   * Entries where eStartW <= beforeTime have their lStartW adjusted.
   * Entries entirely after beforeTime are removed.
   */
  private filterStartTimesBefore(startTimes: CTPStartTimes, beforeTime: number): void {
    let node = startTimes.head;
    while (node) {
      if (node.data.lStartW <= beforeTime) {
        // Entire range is before constraint — keep as-is
        node = node.next;
      } else if (node.data.eStartW <= beforeTime) {
        // Early start is before constraint — adjust latest to constraint
        node.data.lStartW = beforeTime;
        node.data.lEndW = beforeTime + node.data.duration;
        node = node.next;
      } else {
        // Entire range is after constraint — remove
        const toRemove = node;
        node = node.next;
        startTimes.deleteNode(toRemove);
      }
    }
  }

  /**
   * Remove start times where changeover invalidates the window.
   * Replicated from ComputeScheduleContextsAgent.removeInvalidStartTimes().
   */
  private removeInvalidStartTimes(schedule: ScheduleContext): void {
    if (
      schedule.slot &&
      schedule.slot.startTimes &&
      (schedule.slot.hasInfeasibleDueToChangeOver || !schedule.task?.requiresSetup)
    ) {
      let i = schedule.slot.startTimes.head;
      while (i) {
        if (i.data.stillFeasible() || !schedule.task?.requiresSetup) {
          if (!schedule.task?.requiresSetup) i.data.processChangeDuration = 0;
          i = i.next;
        } else {
          const st = i;
          i = i.next;
          schedule.slot.startTimes!.deleteNode(st);
        }
      }
    }
  }
}
