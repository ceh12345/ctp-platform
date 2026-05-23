import { ILandscape } from "./landscape";
import { CTPResourceSlots } from "./slot";
import { CTPTask } from "./task";
import { CTPScores, IScore, CTPScore } from "./score";
import { EntityHashMap } from "../Core/hashmap";
import { CTPEntity, CTPEntityHashed, CTPKeyEntity } from "../Core/entity";
import { List } from "../Core/list";
import { CTPResource } from "./resource";
import { CTPStateChanges } from "./statechange";
import { CTPStartTime } from "./starttime";
import { RecomputeTracker } from "./recompute-tracker";

// CODE-OPTIMIZATION-SPRINT Ticket 3 — typed-array cache of the per-context
// startTimes list, used by the 3 find-pattern helpers in ChainContextEngine
// (isWithinStartTimeNode, getAssignedProcessChangeDuration, findStartTimeNode)
// to replace head-walks with binary search. Iterate-all helpers
// (computeContextFeasibleDuration, findEarliestFeasibleStart,
// findLatestFeasibleStartForPred) stay on linked-list walks — the narrowed
// scope intentionally trades a smaller cache footprint for those callers' ×2
// cache-locality win. See ticket-03 evidence in the spec.
//
// Lazily built by ChainContextEngine.getStCache. Invalidated by bumping
// ctx._stCacheVersion at the single in-cycle mutation site
// (truncateContextStartTimes).
export interface StartTimesCache {
  count: number;
  eStart: Float64Array;
  lStart: Float64Array;
  pcd: Float64Array; // processChangeDuration per node
  version: number;   // captured at build; compared against ctx._stCacheVersion
}

export class ScheduleContext extends CTPEntityHashed {
  public landscape: ILandscape;
  public task: CTPTask;
  public slot: CTPResourceSlots;
  public scores: CTPScores;
  public blendedScore: IScore;

  // T3 cache state — managed by ChainContextEngine, not used elsewhere.
  public _stCache: StartTimesCache | null = null;
  public _stCacheVersion: number = 0;

  constructor(l: ILandscape, t: CTPTask, s: CTPResourceSlots) {
    super();
    this.landscape = l;
    this.task = t;
    this.slot = s;
    this.scores = new CTPScores();
    this.blendedScore = new CTPScore("Blended");
    this.hashKey = this.createhash();
  }

  public debug() {
    console.log("SCHEDULE CONTEXT");
    console.log("Task: " + this.task.name);
    this.slot.resources?.forEach((res) => {
      console.log(" Resource: " + res.resource?.name);
    });
  }
  public createhash() {
    if (this.landscape && this.task && this.slot) {
      this.key = this.task.hashKey + ":" + this.slot.createHash();
    }
    return this.key;
  }
}

export class ScheduleContextsFor<T extends CTPEntity> extends CTPEntityHashed {
  public value: T;
  public contexts: List<ScheduleContext>;

  constructor(t: T) {
    super();
    this.value = t;
    this.contexts = new List<ScheduleContext>();
    this.hashKey = t.key;
  }

  public createhash() {
    if (this.value) return this.value.key;
    return "";
  }
}
export class TaskScheduleContexts extends ScheduleContextsFor<CTPTask> {}

export class ResourceScheduleContexts extends ScheduleContextsFor<CTPResource> {}

export class ScheduleContexts extends EntityHashMap<ScheduleContext> {
  public byTask: EntityHashMap<TaskScheduleContexts>;
  public byResource: EntityHashMap<ResourceScheduleContexts>;
  private tracker: RecomputeTracker;

  public constructor(t?: string, n?: string, k?: string) {
    super();
    this.byTask = new EntityHashMap<TaskScheduleContexts>();
    this.byResource = new EntityHashMap<ResourceScheduleContexts>();
    this.tracker = new RecomputeTracker(this.byTask, this.byResource);
  }

  public addEntity(s: ScheduleContext) {
    super.addEntity(s);
    let task = this.byTask.getEntity(s.task?.hashKey);
    if (!task) {
      task = new TaskScheduleContexts(s.task);
      this.byTask.addEntity(task);
    }
    task.contexts.add(s);

    if (s.slot.resources) {
      s.slot.resources.forEach((res) => {
        if (res.resource) {
          let resource = this.byResource.getEntity(res.resource.hashKey);
          if (!resource) {
            resource = new ResourceScheduleContexts(res.resource);
            this.byResource.addEntity(resource);
          }
          resource.contexts.add(s);
        }
      });
    }
  }

  public override clear(): void {
    super.clear();
    this.byTask.clear();
    this.byResource.clear();
  }

  public removeByTask(t: CTPTask): void {
    if (!t) return;
    const taskContexts = this.byTask.getEntity(t.hashKey);
    if (!taskContexts) return;

    // Remove each context from the main map and from byResource
    taskContexts.contexts.forEach((ctx) => {
      this.removeEntity(ctx);
      ctx.slot.resources?.forEach((res) => {
        if (res.resource) {
          const rsc = this.byResource.getEntity(res.resource.hashKey);
          if (rsc) {
            rsc.contexts.remove(ctx);
          }
        }
      });
    });

    // Remove the task entry itself
    this.byTask.removeEntity(taskContexts);
  }

  public updateRecomputeByTask(t: CTPTask) {
    this.tracker.markUnscheduled(t);
  }

  public updateRecompute(s: ScheduleContext) {
    this.tracker.markScheduled(s);
  }
}

export class BestScheduleContext {
  public best: ScheduleContext;
  public startTimes: CTPStartTime;
  public startTime: number;
  public subType: number;
 

  constructor(f: ScheduleContext, startTimes:CTPStartTime, st: number) {
    this.best = f;
    this.startTime = st;
    this.startTimes = startTimes;
    this.subType = -1;
  }
}
