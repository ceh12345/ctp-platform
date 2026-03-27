import {
  CombinationEngine,
  ResourceCombinationEngine,
} from "../../Engines/combinationengine";
import { ScheduleEngine } from "../../Engines/scheduleengine";
import { StateChangeEngine } from "../../Engines/statechangeerengine";
import { CTPAssignmentConstants, CTPScheduleDirectionConstants, CTPTaskStateConstants, CTPTaskTypeConstants } from "../../Models/Core/constants";
import { CTPDateTime } from "../../Models/Core/date";
import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPHorizon } from "../../Models/Entities/horizon";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPProcess, CTPProcesses } from "../../Models/Entities/process";
import {
  CTPResourcePreference,
  CTPResources,
} from "../../Models/Entities/resource";
import {
  BestScheduleContext,
  ScheduleContext,
  ScheduleContexts,
  TaskScheduleContexts,
} from "../../Models/Entities/schedulecontext";
import { CTPScoring } from "../../Models/Entities/score";
import { CTPResourceSlot, CTPResourceSlots } from "../../Models/Entities/slot";
import { CTPStartTime } from "../../Models/Entities/starttime";
import {
  CTPStateChange,
  CTPStateChanges,
} from "../../Models/Entities/statechange";
import { CTPTask, CTPTasks } from "../../Models/Entities/task";
import { BestScoreForTaskAgent } from "../Agents/bestscorefortask";
import { CommonStartTimesAgent } from "../Agents/commonstarttimes";
import { ComputeScheduleContextsAgent } from "../Agents/computeschedulecontexts";
import { ComputeScoreAgent } from "../Agents/computescores";
import { DependencyLookAheadAgent } from "../Agents/LookAhead Agents/dependencylookahead";
import { NextNeighborhoodAgent } from "../Agents/nextneighborhood";
import { PickBestScheduleAgent } from "../Agents/pickbestschedule";
import { TimingSequenceAgent } from "../Agents/timing";
import { INeighborhoodStrategy } from "../Neighborhoods/neighborhood";
import { GreedyNeighborhood } from "../Neighborhoods/greedyneighborhood";
import { ChainNeighborhood } from "../Neighborhoods/chainneighborhood";
import { ChainFirstFitNeighborhood } from "../Neighborhoods/chainfirstfitneighborhood";
import { DueDateNeighborhood } from "../Neighborhoods/duedateneighborhood";
import { ShortestFirstNeighborhood } from "../Neighborhoods/shortestfirstneighborhood";
import { CTPSolveResult } from "../../Models/Entities/solveresult";
import { SolveStep, SolveAction } from "../../Models/Entities/solvestep";
import { SolutionStateBuilder } from "../../Models/Entities/solutionstate";
import {
  ChainContextEngine,
  BumpEvent,
  findBlockers,
  getChainPriority,
  selectBumpCandidate,
  markChainInfeasible,
} from "../../Engines/chaincontextengine";
import {
  InfeasibilityReport,
  classifyConflict,
  ResourceSlotReport,
  ResourceAvailabilityDetail,
  BlockingTaskDetail,
} from "../../Models/Entities/infeasibilityreport";

export interface IScheduler {
  initLandscape(
    hor: CTPHorizon,
    tasks: CTPTasks,
    resources: CTPResources,
    stateChanges: CTPStateChanges,
    process: CTPProcesses,
  ): void;
  initSettings(settings: CTPAppSettings | null): void;
  initAgents(): void;
  initScoring(scoring: CTPScoring): void;
  schedule(tasks: List<CTPTask>): CTPSolveResult;
  unschedule(tasks: List<CTPTask>): void;
}

export abstract class CTPBaseScheduler {
  protected landscape: SchedulingLandscape;
  protected scoring: CTPScoring | null;
  protected scheduleContexts: ScheduleContexts;
  protected settings: CTPAppSettings | null;
  protected init: boolean;
  protected errors: string = "";
  protected solverSequence: number = 0;
  protected neighborhoodAgent: NextNeighborhoodAgent | null = null;
  protected contextsEvaluated: number = 0;
  protected bumpEvents: BumpEvent[] = [];
  protected solveSteps: SolveStep[] = [];
  private stepSequence: number = 0;

  constructor() {
    this.landscape = new SchedulingLandscape();
    this.scheduleContexts = new ScheduleContexts();
    this.scoring = null;
    this.settings = null;
    this.init = false;
  }

  protected recordStep(
    action: SolveAction,
    task: CTPTask,
    chainKey: string | null,
    resourceKey?: string | null,
    resourceName?: string | null,
    startW?: number | null,
    endW?: number | null,
    score?: number | null,
    reason?: string | null,
    bumpTarget?: string | null,
  ): void {
    if (!this.settings?.recordSolveSteps) return;
    if (this.solveSteps.length >= (this.settings?.maxSolveSteps ?? 500)) return;
    this.stepSequence++;
    this.solveSteps.push({
      sequence: this.stepSequence,
      action,
      taskKey: task.key,
      chainKey: chainKey ?? task.linkId?.name ?? null,
      resourceKey: resourceKey ?? null,
      resourceName: resourceName ?? null,
      startTime: startW ? CTPDateTime.toDateTime(startW).toISO() : null,
      endTime: endW ? CTPDateTime.toDateTime(endW).toISO() : null,
      score: score ?? null,
      reason: reason ?? null,
      chainPhase: task.type != null ? String(task.type) : null,
      bumpTarget: bumpTarget ?? null,
    });
  }

  /** Get primary resource info from a task after it's been scheduled */
  private getPrimaryResourceInfo(task: CTPTask): { key: string | null; name: string | null } {
    let key: string | null = null;
    let name: string | null = null;
    task.capacityResources?.forEach(tr => {
      if (tr.isPrimary && tr.scheduledResource) {
        key = tr.scheduledResource;
        const res = this.landscape.resources?.getEntity(tr.scheduledResource);
        name = res?.name ?? tr.scheduledResource;
      }
    });
    return { key, name };
  }

  protected startScheduling(): void {}
  protected endScheduling(): void {}

  protected getComputeScheduleContextsAgent() {
    return new ComputeScheduleContextsAgent();
  }
  protected getComputeScoreAgent() {
    return new ComputeScoreAgent();
  }
  protected getCommonStartTimesAgent() {
    return new CommonStartTimesAgent();
  }
  protected getCombinationEngine() {
    return new CombinationEngine();
  }
  protected getResourceCombinationEngine() {
    return new ResourceCombinationEngine();
  }
  protected getScheduleEngine() {
    return new ScheduleEngine();
  }
  protected getUnScheduleEngine() {
    return new ScheduleEngine();
  }
  protected getStateChangeEngine() {
    return new StateChangeEngine();
  }
  protected getNextNeighborhoodAgent() {
    return new NextNeighborhoodAgent();
  }
  protected getPickBestScheduleAgent() {
    return new PickBestScheduleAgent();
  }
  protected getBestScoreForTaskAgent() {
    return new BestScoreForTaskAgent();
  }

  protected getTimingSequenceAgent() {
    return new TimingSequenceAgent();
  }

  protected getDependentLookaheadAgent() {
    return new DependencyLookAheadAgent();
  }

  protected explodeScheduleContexts(tasks: List<CTPTask>) {
    this.init = true;
    if (!tasks) return;
    if (tasks.length === 0) return;

    const comboEngine = this.getResourceCombinationEngine();
    tasks.forEach((task) => {
      const found = this.scheduleContexts.byTask.getEntity(task.hashKey);
      if (!found) {
        let resourceArr: any[] = [];
        task.capacityResources?.forEach((res) => {
          if (res.isIgnored()) return;  // Skip ignored resources
          const effective = res.getEffectivePreferences();
          if (effective.length === 0) return;  // All preferences excluded
          resourceArr.push(effective);
        });
        const resourecombos = comboEngine.resourcecombinations(resourceArr);
        if (resourecombos) {
          resourecombos.forEach((schedule) => {
            const slot = new CTPResourceSlots();
            let i = 0;
            schedule.forEach((res: CTPResourcePreference) => {
              const resource = this.landscape.resources?.getEntity(
                res.resourceKey,
              );
              if (resource)
                slot.resources?.add(new CTPResourceSlot(resource, i));
              else slot.addToErrors("Could not find resource " + res);
              i = i + 1;
            });

            const context = new ScheduleContext(this.landscape, task, slot);
            this.scheduleContexts.addEntity(context);
            this.contextsEvaluated++;
          });
        }
      }
    });
  }

  protected reComputeScheduleContexts(task: CTPTask | null = null) {
    let agent = this.getComputeScheduleContextsAgent();
    let computescores: ScheduleContext[] = [];

    this.scheduleContexts.forEach((schedule) => {
      if (
        schedule.recompute &&
        schedule.task &&
        schedule.task.duration &&
        !schedule.task.processed
      ) {
        // Reset the overall task score
        schedule.task.score = Number.MAX_VALUE;

        computescores.push(schedule);
      }
    });
    agent.solve(this.landscape, computescores, this.scoring);

    // If Dependency adjust furture schedueled tasks
    if (task && this.settings?.hasChains)
      this.applyRequiredTiming(task);

    let taskscores: TaskScheduleContexts[] = [];
    let bestscoreagent = this.getBestScoreForTaskAgent();

    this.scheduleContexts.byTask.forEach((schedule) => {
      if (!schedule.value.hasScore() && !schedule.value.processed)
        taskscores.push(schedule);
    });
    bestscoreagent.solve(taskscores);
  }

  /**
   * Map a strategy name to an INeighborhoodStrategy instance.
   * Falls back to Chain (hasChains) or Greedy (no chains).
   */
  protected resolveStrategy(name: string | undefined): INeighborhoodStrategy {
    switch (name) {
      case 'Chain':          return new ChainNeighborhood();
      case 'ChainFirstFit':  return new ChainFirstFitNeighborhood();
      case 'DueDate':        return new DueDateNeighborhood();
      case 'Greedy':         return new GreedyNeighborhood();
      case 'ShortestFirst':  return new ShortestFirstNeighborhood();
      default:
        // Default: Chain for chain-aware, Greedy otherwise
        return this.settings?.hasChains
          ? new ChainNeighborhood()
          : new GreedyNeighborhood();
    }
  }

  protected nextTasksToSchedule(
    tasks: List<CTPTask>,
    numOfTasks: number,
  ): List<CTPTask> {
    if (!this.neighborhoodAgent) {
      this.neighborhoodAgent = this.getNextNeighborhoodAgent();

      // Resolve strategy from settings
      const strategy = this.resolveStrategy(this.settings?.solverStrategy);
      this.neighborhoodAgent.setStrategy(strategy);

      // Strategy compatibility guard — when chains exist, use ChainNeighborhood
      // for task selection (respects chain sequence) even if the scheduling path
      // is per-task (controlled by chainCompatible gate in schedule())
      if (this.settings?.hasChains && !strategy.chainCompatible) {
        this.neighborhoodAgent.setStrategy(new ChainNeighborhood());
      }
    }

    let next = this.neighborhoodAgent.solve(tasks, numOfTasks, this.settings, this.landscape);
    return next;
  }
  
  protected applyRequiredTiming(task: CTPTask) : void
  {
    let agent = this.getTimingSequenceAgent();
    agent.solve(this.landscape,task,this.scheduleContexts,this.settings)
  }
  protected hasChains(task: CTPTask) : boolean
  {
      return this.settings ? !!this.settings.hasChains : false;
  }

  protected selectBestScheduleForTask(
    task: CTPTask,
  ): BestScheduleContext | null {
    if (task.processed) return null;

    let agent = this.getPickBestScheduleAgent();
    const scheduled = this.scheduleContexts.byTask.getEntity(task.hashKey);

    let best = agent.solve(this.landscape, task, scheduled, this.scoring,this.settings);
    
    return best;
  }
  
  protected scheduleATask(task: CTPTask, bestSchedule: BestScheduleContext) {
    let engine = this.getScheduleEngine();
    engine.schedule(this.landscape, task, bestSchedule,this.settings?.scheduleDirection);
  }

   protected unScheduleATask(task: CTPTask) {
    let engine = this.getUnScheduleEngine();
    engine.unschedule(this.landscape, task);
  }

  protected scheduleAStateChangeTask(st: CTPTask, from: CTPTask, setup: boolean = true) {
    if (from.scheduled && st.duration && st.duration.duration() > 0) {
      const stC = new ScheduleContext(this.landscape, st,new CTPResourceSlots());
      const stBest = new BestScheduleContext(stC,new CTPStartTime(),0);
      stBest.subType = CTPAssignmentConstants.CHANGE_OVER;

      if (setup) {
        stBest.startTime = from.scheduled.startW - st.duration.duration();
      }
      else {
        stBest.startTime = from.scheduled.endW;
      }

      stBest.startTimes.eStartW = stBest.startTime;
      stBest.startTimes.eEndW = stBest.startTime;
      stBest.startTimes.processChangeDuration = 0;
      
      st.capacityResources?.forEach((res) => {
        const resource = this.landscape.resources?.getEntity(res.scheduledResource?? '');
        if (resource) {
          stBest.best.slot.resources?.add(new CTPResourceSlot(resource, res.index));
        }
      });
      this.landscape.tasks.addEntity(st);
      this.scheduleATask(st, stBest);
    }
  }
  protected scheduleStateChanges(task: CTPTask, bestSchedule: BestScheduleContext) {
    let engine = this.getStateChangeEngine();
    let stTasks = engine.getScheduleStateChangeTasks(
                          task,
                          bestSchedule,
                          this.landscape);
    if (stTasks && stTasks.length > 0) {
      stTasks.forEach((st) => {
        const isSetup = st.type !== CTPTaskTypeConstants.TEAR_DOWN;
        this.scheduleAStateChangeTask(st,task, isSetup);
      });
    }
  }

  protected scheduleTask(task: CTPTask, bestSchedule: BestScheduleContext) {
    task.processed = true;
    task.solverSequence = this.solverSequence;
    if (task.state === CTPTaskStateConstants.SCHEDULED) return;
    this.scheduleATask(task, bestSchedule);
    this.scheduleStateChanges(task, bestSchedule);
    this.scheduleContexts.updateRecompute(bestSchedule.best);
  }

  protected unScheduleStateChanges(task: CTPTask) {
    
    let engine = this.getStateChangeEngine();
    let stTasks = engine.getUnScheduleStateChangeTasks(
                          task,
                          this.landscape);
    if (stTasks && stTasks.length > 0) {
      stTasks.forEach((st) => {
       this.unScheduleATask(st);
       this.landscape.tasks.removeEntity(st);
      });
    }
   
  }
  protected unscheduleTask(task: CTPTask) {
    task.processed = true;
    if (task.state === CTPTaskStateConstants.NOT_SCHEDULED) return;
    if (!task.canMove())  return;
    task.errors = [];

    this.unScheduleStateChanges(task);
    this.unScheduleATask(task);
    this.scheduleContexts.updateRecomputeByTask(task);
    task.score = Number.MAX_VALUE;
  }

  /**
   * Public entry point for unscheduling a task by key.
   * Removes associated state change tasks (SETUP/TEARDOWN/changeover) before
   * unscheduling the main task so they don't remain orphaned in the landscape.
   */
  public unscheduleTaskWithStateChanges(taskKey: string, resetScore: boolean = true): boolean {
    const task = this.landscape.tasks?.getEntity(taskKey);
    if (!task) return false;
    if (task.pinned) return false;
    if (task.state === CTPTaskStateConstants.NOT_SCHEDULED) return false;

    task.errors = [];
    this.unScheduleStateChanges(task);
    return this.landscape.unscheduleTask(taskKey, resetScore);
  }

  public initLandscape(
    hor: CTPHorizon,
    tasks: CTPTasks,
    resources: CTPResources,
    stateChanges: CTPStateChanges,
    process: CTPProcesses
  ) {
    this.landscape.horizon = hor;
    this.landscape.tasks = tasks;
    this.landscape.resources = resources;
    this.landscape.stateChanges = stateChanges;
    this.landscape.processes =  process;
    this.landscape.resources.forEach(r => r.recompute = true);

  }
  public initAgents() {}
  public initScoring(scoring: CTPScoring) {
    this.scoring = scoring;
  }
  public initSettings(settings: CTPAppSettings | null): void {
    this.settings = settings;
  }

  protected startTask(task: CTPTask) {}

  protected endTask(task: CTPTask) {
    task.processed = true;
    task.feasible = null;
    // Here is where you may want to take a resource down after X amoung of use
  }

  protected scheduleTasks(tasks: List<CTPTask>): void {
    tasks.forEach((task) => {
      this.startTask(task);
      this.solverSequence += 1;
      const best = this.selectBestScheduleForTask(task);
      if (best) {
        this.scheduleTask(task, best);
        const pri = this.getPrimaryResourceInfo(task);
        this.recordStep('schedule', task, null, pri.key, pri.name,
          task.scheduled?.startW, task.scheduled?.endW,
          best.best.blendedScore?.score);
        this.reComputeScheduleContexts(task);
        this.endTask(task);
      } else {
        this.recordStep('infeasible', task, null, null, null,
          null, null, null, task.errors?.[0]?.reason ?? 'No feasible context');
        this.buildStandaloneInfeasibilityReport(task);
      }
    });
  }

  /**
   * Per-task scheduling for chain-aware mode (hasChains).
   * Tightens each task's window from its predecessor before exploding contexts.
   */
  protected scheduleTasksChainAware(tasks: List<CTPTask>): void {
    tasks.forEach((task) => {
      // Tighten window before explosion
      const feasible = this.tightenWindowFromPredecessor(task);
      if (!feasible) {
        // Check if the failure is because predecessor isn't scheduled yet
        // (vs a genuine constraint violation). If predecessor just hasn't been
        // placed yet, skip without marking processed so we retry later.
        const predKey = task.linkId?.prevLink;
        const predecessor = predKey ? this.landscape.tasks.getEntity(predKey) : null;
        if (predecessor && !predecessor.scheduled) {
          // Predecessor not yet scheduled — skip, don't mark processed
          task.errors = []; // clear the temporary error
          return;
        }
        task.processed = true;
        this.recordStep('infeasible', task, null, null, null,
          null, null, null, task.errors?.[0]?.reason ?? 'Predecessor not scheduled');
        return;
      }

      // Explode contexts for just this task
      const singleTask = new List<CTPTask>();
      singleTask.add(task);
      this.explodeScheduleContexts(singleTask);

      this.reComputeScheduleContexts();

      // Schedule
      this.startTask(task);
      this.solverSequence += 1;
      const best = this.selectBestScheduleForTask(task);
      if (best) {
        this.scheduleTask(task, best);
        const pri = this.getPrimaryResourceInfo(task);
        this.recordStep('schedule', task, null, pri.key, pri.name,
          task.scheduled?.startW, task.scheduled?.endW,
          best.best.blendedScore?.score);
        this.reComputeScheduleContexts(task);
        this.endTask(task);
      } else {
        // No feasible schedule — stop retrying this task
        task.processed = true;
        this.recordStep('infeasible', task, null, null, null,
          null, null, null, task.errors?.[0]?.reason ?? 'No feasible context');
        this.buildStandaloneInfeasibilityReport(task);
      }

      // Free contexts for this task to prevent heap accumulation
      this.scheduleContexts.removeByTask(task);
    });
  }

  protected tightenWindowFromPredecessor(task: CTPTask): boolean {
    if (!this.settings?.hasChains) return true;

    const predKey = task.linkId?.prevLink;
    if (!predKey || predKey === '') return true; // Chain root or standalone

    const predecessor = this.landscape.tasks.getEntity(predKey);
    if (!predecessor) {
      task.addError('ChainConstraint', `Predecessor ${predKey} not found`);
      return false;
    }

    if (!predecessor.scheduled) {
      task.addError('ChainConstraint',
        `Predecessor ${predecessor.name} is not scheduled — cannot schedule ${task.name}`);
      return false;
    }

    const predEnd = predecessor.scheduled.endW;

    if (task.window) {
      if (task.window.startW < predEnd) {
        task.window.startW = predEnd;
      }

      if (task.window.startW >= task.window.endW) {
        task.addError('ChainConstraint',
          `Window collapsed: predecessor ${predecessor.name} ends at ${predEnd} but task window ends at ${task.window.endW}`);
        return false;
      }

      const duration = task.duration?.duration() ?? 0;
      if ((task.window.endW - task.window.startW) < duration) {
        task.addError('ChainConstraint',
          `Window too narrow after tightening: need ${duration}s but only ${task.window.endW - task.window.startW}s available`);
        return false;
      }
    }

    return true;
  }

  protected abstract initScheduling(tasks: List<CTPTask>): void;
  protected abstract initUnScheduling(tasks: List<CTPTask>): void;

  protected assert(): boolean {
    this.errors = "";

    // set to default settings if not provided
    if (!this.settings ) this.settings = new CTPAppSettings();

    // Do not require resources if task have only durations
    const hasLandscape = this.landscape.horizon && this.landscape.tasks;
    const hasSettings = this.settings != null;
    const hasScoring = this.scoring != null;
    if (!hasLandscape) {
      this.errors += "Landscape is not initialized.";
    }
    if (!hasSettings) {
      this.errors += "Settings are not initialized.";
    }
    if (!hasScoring) {
      this.errors += "Scoring is not initialized.";
    }
    return this.init && hasLandscape && hasSettings && hasScoring;
  }

  public schedule(tasks: List<CTPTask>): CTPSolveResult {
    const startTime = performance.now();

    if (tasks)
      tasks.forEach((task) => {
        task.processed = false;
        task.errors = [];
      });

    this.neighborhoodAgent = null; // Reset for fresh strategy selection
    this.contextsEvaluated = 0;
    this.bumpEvents = [];

    // Ensure default settings exist before auto-detection
    if (!this.settings) this.settings = new CTPAppSettings();

    // Auto-detect chains (must run before initScheduling)
    {
      let detected = false;
      this.landscape.tasks.forEach(task => {
        if (task.hasLinkId()) detected = true;
      });
      this.settings.hasChains = detected;
    }

    this.initScheduling(tasks);

    if (!this.assert()) throw "Scheduler not initialized" + this.errors;

    this.solverSequence = 0;
    this.solveSteps = [];
    this.stepSequence = 0;

    let topTasksToSchedule = this.settings
      ? this.settings.topTasksToSchedule
      : 10;

    this.reComputeScheduleContexts();

    this.startScheduling();

    // PASS 1: Manual — schedule planner-prioritized tasks first
    this.scheduleManualPass(tasks);

    // PASS 2: Solver — everything else, using the selected neighborhood strategy
    const strategy = this.resolveStrategy(this.settings?.solverStrategy);
    if (this.settings?.hasChains && strategy.chainCompatible) {
      // Chain-aware: ChainContextEngine + bump-and-retry
      this.scheduleChainPass(tasks);
    } else {
      // Per-task loop (Greedy/DueDate) — chains respected via propagation
      // Use chain-aware per-task scheduling when chains exist (tightens
      // predecessor windows before context explosion for each task)
      const useChainAware = !!this.settings?.hasChains;
      let counter = 0;
      let max = tasks.length + 10;

      let next = this.nextTasksToSchedule(tasks, topTasksToSchedule);

      while (next.length > 0) {
        if (useChainAware) {
          this.scheduleTasksChainAware(next);
        } else {
          this.explodeScheduleContexts(next);
          this.scheduleTasks(next);
        }

        next = this.nextTasksToSchedule(tasks, topTasksToSchedule);
        counter += 1;
        if (counter > max) break;
      }
    }

    this.endScheduling();

    // Capture final solution state
    const finalState = SolutionStateBuilder.capture(this.landscape, 'Final');
    finalState.bumpCount = this.bumpEvents.length;

    // Build solve result
    const result = new CTPSolveResult();
    result.finalState = finalState;
    const agent = this.neighborhoodAgent as NextNeighborhoodAgent | null;
    result.strategy = (this.settings?.hasChains && strategy.chainCompatible)
      ? 'Chain'
      : (this.settings?.solverStrategy ?? strategy.name);
    result.totalTasks = tasks.length;
    result.solveTimeMs = performance.now() - startTime;
    result.contextsEvaluated = this.contextsEvaluated;
    result.bumps = this.bumpEvents;
    result.totalBumps = this.bumpEvents.length;
    result.maxBumpsReached = this.bumpEvents.length >= (this.settings?.maxBacktrackAttempts ?? 3);

    tasks.forEach(task => {
      if (task.state === CTPTaskStateConstants.SCHEDULED) result.scheduled++;
      else if (task.errors && task.errors.length > 0) result.infeasible++;
      else {
        result.notScheduled++;
        // Record skip step for tasks that were never processed by the solver
        if (task.pinned) {
          this.recordStep('skip', task, task.linkId?.name ?? null,
            null, null, null, null, null, 'Pinned');
        } else if (!task.includeInSolve) {
          this.recordStep('skip', task, task.linkId?.name ?? null,
            null, null, null, null, null, 'Excluded');
        }
      }
    });

    result.solveSteps = this.solveSteps;
    result.debug(this.settings?.debugLogging ?? false);
    return result;
  }

  /**
   * Pass 1: Schedule tasks with manualPriority > 0 in the planner's exact order.
   * Auto-includes chain predecessors so chains remain valid.
   * Uses the same scheduling pipeline as Pass 2.
   */
  protected scheduleManualPass(tasks: List<CTPTask>): void {
    // Collect manual tasks
    const manualTasks: CTPTask[] = [];
    tasks.forEach(task => {
      if (task.manualPriority > 0 && task.canSolve() &&
          task.state === CTPTaskStateConstants.NOT_SCHEDULED) {
        manualTasks.push(task);
      }
    });

    if (manualTasks.length === 0) return;

    // Sort by manualPriority (lower = first)
    manualTasks.sort((a, b) => a.manualPriority - b.manualPriority);

    // Build the ordered list, auto-including chain predecessors
    const orderedManual = new List<CTPTask>();
    const added = new Set<string>();

    for (const task of manualTasks) {
      // Walk up the chain and add unscheduled predecessors first
      this.addChainPredecessors(task, orderedManual, added);

      if (!added.has(task.hashKey)) {
        orderedManual.add(task);
        added.add(task.hashKey);
      }
    }

    // Schedule using the same pipeline
    if (this.settings?.hasChains) {
      this.scheduleTasksChainAware(orderedManual);
    } else {
      this.explodeScheduleContexts(orderedManual);
      this.scheduleTasks(orderedManual);
    }
  }

  /**
   * Recursively add chain predecessors before a task so the chain
   * schedules in the correct order during Pass 1.
   */
  private addChainPredecessors(
    task: CTPTask,
    orderedList: List<CTPTask>,
    added: Set<string>
  ): void {
    const predKey = task.linkId?.prevLink;
    if (!predKey || predKey === '') return;

    const predecessor = this.landscape.tasks.getEntity(predKey);
    if (!predecessor) return;
    if (predecessor.state === CTPTaskStateConstants.SCHEDULED) return;
    if (added.has(predecessor.hashKey)) return;

    // Recurse up the chain first
    this.addChainPredecessors(predecessor, orderedList, added);

    if (!added.has(predecessor.hashKey) && predecessor.canSolve() && !predecessor.processed) {
      orderedList.add(predecessor);
      added.add(predecessor.hashKey);
    }
  }

  // ── Standalone infeasibility reporting ──────────────────────────────

  private buildStandaloneInfeasibilityReport(task: CTPTask): void {
    const slots: ResourceSlotReport[] = [];
    const windowStart = task.window?.startW ?? 0;
    const windowEnd = task.window?.endW ?? Number.MAX_VALUE;
    const windowMinutes = (windowEnd - windowStart) / 60;
    const taskDuration = task.duration?.duration() ?? 0;

    task.capacityResources?.forEach((tr, idx) => {
      if (tr.isIgnored()) return;
      const prefs = tr.getEffectivePreferences();
      const resourceDetails: ResourceAvailabilityDetail[] = [];
      let bestAvailMinutes = 0;

      for (const pref of prefs) {
        const resource = this.landscape.resources?.getEntity(pref.resourceKey);
        if (!resource) continue;

        let availMinutes = 0;
        const blockingTasks: BlockingTaskDetail[] = [];
        let note: string | null = null;

        if (resource.original) {
          let node = resource.original.head;
          let hasAny = false;
          let earliestStart = Number.MAX_VALUE;
          while (node) {
            const oS = Math.max(node.data.startW, windowStart);
            const oE = Math.min(node.data.endW, windowEnd);
            if (oE > oS) { hasAny = true; availMinutes += (oE - oS) / 60; if (node.data.startW < earliestStart) earliestStart = node.data.startW; }
            node = node.next;
          }
          if (!hasAny) { resourceDetails.push({ resourceKey: pref.resourceKey, resourceName: resource.name || pref.resourceKey, availableMinutes: 0, totalWindowMinutes: Math.round(windowMinutes), status: 'blocked', blockingTasks: [], note: 'Off shift during entire window' }); continue; }
          if (earliestStart > windowStart) note = `Available from ${earliestStart} only`;
        }

        if (resource.assignments) {
          let assNode = resource.assignments.head;
          while (assNode) {
            const a = assNode.data;
            const oS = Math.max(a.startW, windowStart);
            const oE = Math.min(a.endW, windowEnd);
            if (oE > oS) {
              availMinutes -= (oE - oS) / 60;
              if (a.name && !blockingTasks.find(bt => bt.taskKey === a.name)) {
                const bt = this.landscape.tasks?.getEntity(a.name);
                blockingTasks.push({ taskKey: a.name, taskName: bt?.name || a.name, chainKey: bt?.linkId?.name || null, startW: a.startW, endW: a.endW, commitmentLevel: bt?.commitmentLevel, dispatched: bt?.dispatched, materialsPulled: bt?.materialsPulled, holdReason: bt?.holdReason, percentComplete: bt?.percentComplete });
              }
            }
            assNode = assNode.next;
          }
        }
        if (availMinutes < 0) availMinutes = 0;
        if (availMinutes > bestAvailMinutes) bestAvailMinutes = availMinutes;

        const status: 'available' | 'partial' | 'blocked' =
          availMinutes >= (taskDuration / 60) ? 'available' : availMinutes > 0 ? 'partial' : 'blocked';
        resourceDetails.push({ resourceKey: pref.resourceKey, resourceName: resource.name || pref.resourceKey, availableMinutes: Math.round(availMinutes), totalWindowMinutes: Math.round(windowMinutes), status, blockingTasks, note });
      }

      if (resourceDetails.length === 0) return;
      const names = resourceDetails.map(r => r.resourceName);
      let slotLabel = names[0];
      if (names.length > 1) {
        let prefix = names[0];
        for (let i = 1; i < names.length; i++) { while (!names[i].startsWith(prefix) && prefix.length > 0) prefix = prefix.slice(0, -1); }
        slotLabel = prefix.replace(/[\s\-_,]+$/, '').trim() || 'Resource Group';
      }
      const slotStatus: 'available' | 'partial' | 'blocked' =
        bestAvailMinutes >= (taskDuration / 60) ? 'available' : bestAvailMinutes > 0 ? 'partial' : 'blocked';
      slots.push({ slotIndex: idx, slotLabel, isPrimary: tr.isPrimary, status: slotStatus, bestAvailableMinutes: Math.round(bestAvailMinutes), isBottleneck: false, resources: resourceDetails });
    });

    if (slots.length > 0) {
      const sorted = [...slots].sort((a, b) => a.bestAvailableMinutes - b.bestAvailableMinutes);
      sorted[0].isBottleneck = true;
    }
    const bottleneckSlot = slots.find(s => s.isBottleneck);
    let reason = `No feasible schedule for ${task.name || task.key}`;
    if (bottleneckSlot) {
      reason += ` — ${bottleneckSlot.slotLabel} is the bottleneck`;
    }

    const report: InfeasibilityReport = {
      taskKey: task.key, chainKey: task.linkId?.name || null, reason,
      bottleneckSlot: bottleneckSlot?.slotLabel || null,
      conflictType: 'dependency', conflictTypeReason: '',
      slots,
      combosGenerated: 0, combosSurvivedPropagation: 0, combosPassedAssignment: 0,
    };

    const classification = classifyConflict(report);
    report.conflictType = classification.type;
    report.conflictTypeReason = classification.reason;
    report.reason = `[${classification.type.toUpperCase()}] ${report.reason}`;

    task.infeasibilityReport = report;
  }

  // ── Chain Context Engine integration ──────────────────────────────

  /**
   * Pass 1: Schedule chains as units via ChainContextEngine.
   * Pass 2: Bump-and-retry for failed chains.
   * Also handles standalone (unchained) tasks via greedy.
   */
  protected scheduleChainPass(tasks: List<CTPTask>): void {
    const chainEngine = new ChainContextEngine();
    const schedEngine = this.getScheduleEngine();
    const direction = this.settings?.scheduleDirection ?? CTPScheduleDirectionConstants.FORWARD;
    const failedChains: CTPProcess[] = [];

    // Build set of submitted task keys to scope the chain pass
    const submittedKeys = new Set<string>();
    tasks.forEach(t => submittedKeys.add(t.key));

    // Get chains sorted by priority (lowest number = highest priority)
    const chains = this.getChainsInPriorityOrder();

    // Pass 1: Schedule each chain
    for (const chain of chains) {
      const chainTasks = chain.tasks;
      if (!chainTasks || chainTasks.length === 0) continue;

      // Only process chains with at least one submitted task
      let hasSubmitted = false;
      chainTasks.forEach(t => { if (submittedKeys.has(t.key)) hasSubmitted = true; });
      if (!hasSubmitted) continue;

      // Skip chains where all tasks are already processed or pinned
      let hasWork = false;
      chainTasks.forEach(t => { if (!t.processed && t.canSolve()) hasWork = true; });
      if (!hasWork) continue;

      // Record chain-start
      const firstTask = chainTasks.at(0)!;
      this.recordStep('chain-start', firstTask, chain.key ?? null);

      if (chainTasks.length === 1) {
        // Single-task chain: use existing per-task greedy
        const singleList = new List<CTPTask>();
        chainTasks.forEach(t => { if (!t.processed && t.canSolve()) singleList.add(t); });
        if (singleList.length > 0) {
          this.scheduleTasksChainAware(singleList);
        }
      } else {
        // Multi-task chain: use ChainContextEngine
        const chainTaskList = new List<CTPTask>();
        chainTasks.forEach(t => chainTaskList.add(t));

        // Explode contexts for all tasks in the chain
        this.explodeScheduleContexts(chainTaskList);
        this.reComputeScheduleContexts();

        const bestCombo = chainEngine.evaluateChain(
          chain, this.scheduleContexts, this.landscape, this.scoring!,
          this.settings?.maxChainCombos
        );

        if (bestCombo) {
          // Mark pinned tasks as processed — commitChain skips them to preserve
          // their positions and resource assignments from applyCommitmentStack
          chainTasks.forEach(t => {
            if (t.pinned && t.state === CTPTaskStateConstants.SCHEDULED) t.processed = true;
          });

          // evaluateChain already called assignStartTimes and validated
          const results = chainEngine.commitChain(bestCombo, schedEngine, this.landscape, direction);

          for (const best of results) {
            const task = best.best.task;
            task.processed = true;
            this.solverSequence += 1;
            task.solverSequence = this.solverSequence;

            this.scheduleStateChanges(task, best);
            this.scheduleContexts.updateRecompute(best.best);

            const pri = this.getPrimaryResourceInfo(task);
            this.recordStep('schedule', task, chain.key ?? null, pri.key, pri.name,
              task.scheduled?.startW, task.scheduled?.endW,
              best.best.blendedScore?.score);
          }

          // Free contexts for this chain
          chainTasks.forEach(t => this.scheduleContexts.removeByTask(t));
        } else {
          // No valid combo — check if chain has maxGap constraints
          let hasMaxGap = false;
          chainTasks.forEach(t => {
            if (t.linkId?.maxGap !== null && t.linkId?.maxGap !== undefined) hasMaxGap = true;
          });

          chainTasks.forEach(t => this.scheduleContexts.removeByTask(t));

          if (hasMaxGap) {
            // Chain with maxGap constraints is infeasible — do not fall back to greedy
            markChainInfeasible(chain, 'No valid chain placement — resource contention violates maxGap constraints');
            chainTasks.forEach(t => {
              this.recordStep('infeasible', t, chain.key ?? null, null, null,
                null, null, null, 'Resource contention violates maxGap constraints');
            });
            failedChains.push(chain);
          } else {
            // Chain without maxGap — safe to fall back to per-task scheduling
            const fallbackList = new List<CTPTask>();
            chainTasks.forEach(t => {
              if (!t.processed && t.canSolve()) fallbackList.add(t);
            });
            if (fallbackList.length > 0) {
              this.scheduleTasksChainAware(fallbackList);
            }
            let anyFailed = false;
            chainTasks.forEach(t => {
              if (t.state !== CTPTaskStateConstants.SCHEDULED && !t.processed) anyFailed = true;
            });
            if (anyFailed) failedChains.push(chain);
          }
        }
      }

      // Record chain-end
      this.recordStep('chain-end', firstTask, chain.key ?? null);
    }

    // Schedule standalone tasks (not in any chain)
    this.scheduleStandaloneTasks(tasks);

    // Pass 2: Bump-and-retry for failed chains
    this.bumpAndRetry(failedChains, chainEngine, schedEngine, direction);
  }

  /**
   * Get all chains from landscape.processes sorted by priority (lowest = first).
   */
  private getChainsInPriorityOrder(): CTPProcess[] {
    const chains: CTPProcess[] = [];
    this.landscape.processes?.forEach(p => chains.push(p));
    chains.sort((a, b) =>
      getChainPriority(a, this.landscape) - getChainPriority(b, this.landscape)
    );
    return chains;
  }

  /**
   * Schedule any tasks not belonging to a chain via greedy.
   */
  private scheduleStandaloneTasks(tasks: List<CTPTask>): void {
    const standalone = new List<CTPTask>();
    tasks.forEach(t => {
      if (!t.processed && t.canSolve() && !t.hasLinkId()) {
        standalone.add(t);
      }
    });
    if (standalone.length === 0) return;

    this.explodeScheduleContexts(standalone);
    this.reComputeScheduleContexts();
    this.scheduleTasks(standalone);
  }

  /**
   * Pass 2: For each failed chain, try bumping a lower-priority blocker.
   * If bump succeeds, retry both chains.
   */
  private bumpAndRetry(
    failedChains: CTPProcess[],
    chainEngine: ChainContextEngine,
    schedEngine: ScheduleEngine,
    direction: number,
  ): void {
    const maxBumps = this.settings?.maxBacktrackAttempts ?? 3;
    const bumpedChains = new Set<string>();

    for (const chain of failedChains) {
      if (this.bumpEvents.length >= maxBumps) break;

      const blockers = findBlockers(chain, this.landscape);
      const candidate = selectBumpCandidate(blockers, bumpedChains);
      if (!candidate) {
        markChainInfeasible(chain, 'No bumpable blocker found');
        continue;
      }

      const blockerChain = this.landscape.processes?.getEntity(candidate.blockerChainKey);
      if (!blockerChain) {
        markChainInfeasible(chain, 'Blocker chain not found');
        continue;
      }

      // Record bump-remove for each task in the blocker chain
      this.recordStep('bump', blockerChain.tasks!.at(0)!, candidate.blockerChainKey,
        null, null, null, null, null,
        `Bumped to free ${candidate.resourceKey} for ${chain.key}`, chain.key ?? null);

      // Unschedule the blocker chain (with state change cleanup)
      blockerChain.tasks?.forEach(t => {
        if (t.state === CTPTaskStateConstants.SCHEDULED) {
          const pri = this.getPrimaryResourceInfo(t);
          this.recordStep('bump-remove', t, candidate.blockerChainKey, pri.key, pri.name,
            t.scheduled?.startW, t.scheduled?.endW, null,
            `Bumped to free ${candidate.resourceKey} for ${chain.key}`, chain.key ?? null);
          this.unScheduleStateChanges(t);
          this.landscape.unscheduleTask(t.key);
          t.processed = false;
        }
      });
      bumpedChains.add(candidate.blockerChainKey);

      // Retry the failed chain
      this.recordStep('retry', chain.tasks!.at(0)!, chain.key ?? null);
      const retryResult = this.retryChain(chain, chainEngine, schedEngine, direction, true);

      // Retry the bumped chain
      const bumperResult = this.retryChain(blockerChain, chainEngine, schedEngine, direction, true);
      if (bumperResult === 'infeasible') {
        markChainInfeasible(blockerChain, `Bumped for ${chain.key} — could not reschedule`);
      }

      // Record bump event
      this.bumpEvents.push({
        bumpedChainKey: candidate.blockerChainKey,
        bumpedChainPriority: candidate.blockerChainPriority,
        beneficiaryChainKey: chain.key || '',
        beneficiaryChainPriority: candidate.blockedChainPriority,
        contestedResource: candidate.resourceKey,
        bumpedChainResult: bumperResult,
      });
    }
  }

  /**
   * Re-explode, recompute, and retry a chain after a bump.
   * Returns 'rescheduled' or 'infeasible'.
   */
  private retryChain(
    chain: CTPProcess,
    chainEngine: ChainContextEngine,
    schedEngine: ScheduleEngine,
    direction: number,
    isRetry: boolean = false,
  ): 'rescheduled' | 'infeasible' {
    const chainTasks = chain.tasks;
    if (!chainTasks) return 'infeasible';
    const chainKeyStr = chain.key ?? null;

    // Reset tasks (including window and score for clean retry)
    const taskList = new List<CTPTask>();
    chainTasks.forEach(t => {
      t.processed = false;
      t.errors = [];
      t.window?.reset();
      t.resetScore();
      taskList.add(t);
    });

    // Re-explode & recompute
    this.scheduleContexts.removeByTask(chainTasks.at(0)!);
    chainTasks.forEach(t => this.scheduleContexts.removeByTask(t));
    this.explodeScheduleContexts(taskList);
    this.reComputeScheduleContexts();

    let result: 'rescheduled' | 'infeasible' = 'infeasible';

    if (chainTasks.length > 1) {
      const combo = chainEngine.evaluateChain(
        chain, this.scheduleContexts, this.landscape, this.scoring!,
        this.settings?.maxChainCombos
      );
      if (combo) {
        // evaluateChain already called assignStartTimes
        const results = chainEngine.commitChain(combo, schedEngine, this.landscape, direction);
        for (const best of results) {
          const task = best.best.task;
          task.processed = true;
          this.solverSequence += 1;
          task.solverSequence = this.solverSequence;
          this.scheduleStateChanges(task, best);
          this.scheduleContexts.updateRecompute(best.best);

          if (isRetry) {
            const pri = this.getPrimaryResourceInfo(task);
            this.recordStep('retry-success', task, chainKeyStr, pri.key, pri.name,
              task.scheduled?.startW, task.scheduled?.endW,
              best.best.blendedScore?.score);
          }
        }
        result = 'rescheduled';
      } else if (isRetry) {
        chainTasks.forEach(t => {
          this.recordStep('retry-fail', t, chainKeyStr, null, null,
            null, null, null, 'Still infeasible after bump');
        });
      }
    } else {
      // Single-task: use greedy (scheduleTasksChainAware already records steps)
      this.scheduleTasksChainAware(taskList);
      let gotScheduled = true;
      chainTasks.forEach(t => {
        if (t.state !== CTPTaskStateConstants.SCHEDULED) gotScheduled = false;
      });
      result = gotScheduled ? 'rescheduled' : 'infeasible';
    }

    // Free contexts
    chainTasks.forEach(t => this.scheduleContexts.removeByTask(t));
    return result;
  }

  public unschedule(tasks: List<CTPTask>) {
    
    this.initUnScheduling(tasks);
    if (!this.assert()) return;

    this.startScheduling();
    tasks.forEach((task) => {
      this.startTask(task);
      this.unscheduleTask(task);
      this.endTask(task);
    });
    this.endScheduling();
  }
}
