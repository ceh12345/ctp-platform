import {
  CombinationEngine,
  ResourceCombinationEngine,
} from "../../Engines/combinationengine";
import { ScheduleEngine } from "../../Engines/scheduleengine";
import { StateChangeEngine } from "../../Engines/statechangeerengine";
import { CTPAssignmentConstants, CTPScheduleDirectionConstants, CTPTaskStateConstants, CTPTaskTypeConstants } from "../../Models/Core/constants";
import { List } from "../../Models/Core/list";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPHorizon } from "../../Models/Entities/horizon";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPProcesses } from "../../Models/Entities/process";
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
  schedule(tasks: List<CTPTask>): void;
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

  constructor() {
    this.landscape = new SchedulingLandscape();
    this.scheduleContexts = new ScheduleContexts();
    this.scoring = null;
    this.settings = null;
    this.init = false;
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
          resourceArr.push(res.preferences);
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
    if (task && this.settings?.requiresPreds)
      this.applyRequiredTiming(task);

    let taskscores: TaskScheduleContexts[] = [];
    let bestscoreagent = this.getBestScoreForTaskAgent();

    this.scheduleContexts.byTask.forEach((schedule) => {
      if (!schedule.value.hasScore() && !schedule.value.processed)
        taskscores.push(schedule);
    });
    bestscoreagent.solve(taskscores);
  }

  protected nextTasksToSchedule(
    tasks: List<CTPTask>,
    numOfTasks: number,
  ): List<CTPTask> {
    let agent = this.getNextNeighborhoodAgent();
    agent.setDependencyLookAhead(this.settings?.requiresPreds ? this.getDependentLookaheadAgent() : null);
    let next = agent.solve(tasks, numOfTasks,this.settings);
    return next;
  }
  
  protected applyRequiredTiming(task: CTPTask) : void
  {
    let agent = this.getTimingSequenceAgent();
    agent.solve(this.landscape,task,this.scheduleContexts,this.settings)
  }
  protected requiresPreds(task: CTPTask) : boolean
  {
      return this.settings ? this.settings.requiresPreds : false;
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
    
      console.log("  SCHEDULED STATE CHANGE " + st.name);
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
        this.reComputeScheduleContexts(task);
        this.endTask(task);
      }
    });
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

  public schedule(tasks: List<CTPTask>) {
    if (tasks)
      tasks.forEach((task) => {
        task.processed = false;
        task.errors = [];
      });

    
    this.initScheduling(tasks);

    if (!this.assert()) throw "Scheduler not initialized" + this.errors;

    this.solverSequence = 0;

    let topTasksToSchedule = this.settings
      ? this.settings.topTasksToSchedule
      : 10;

    this.reComputeScheduleContexts();

    this.startScheduling();

    let counter = 0;
    let max = tasks.length + 10;

    let next = this.nextTasksToSchedule(tasks, topTasksToSchedule);

    while (next.length > 0) {
      this.explodeScheduleContexts(next);
      this.scheduleTasks(next);

      next = this.nextTasksToSchedule(tasks, topTasksToSchedule);
      counter += 1;
      if (counter > max) break;
    }

    this.endScheduling();
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
