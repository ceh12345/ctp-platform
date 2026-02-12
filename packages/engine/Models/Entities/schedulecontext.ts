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

export class ScheduleContext extends CTPEntityHashed {
  public landscape: ILandscape;
  public task: CTPTask;
  public slot: CTPResourceSlots;
  public scores: CTPScores;
  public blendedScore: IScore;

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

  public constructor(t?: string, n?: string, k?: string) {
    super();
    this.byTask = new EntityHashMap<TaskScheduleContexts>();
    this.byResource = new EntityHashMap<ResourceScheduleContexts>();
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

  public updateRecomputeByTask(t: CTPTask) {
    if (!t) return;
    const task = this.byTask.getEntity(t.key);
    if (task) {
      t.capacityResources?.forEach((res) => {
        const resource = this.byResource.getEntity(res.scheduledResource ?? "");
        if (resource) {
          resource.value.recompute = true;
          resource.contexts.forEach((schedule) => {
            if (schedule.task && schedule.task.key != t.key) {
              schedule.recompute = true;
              if (!schedule.task.processed)
                schedule.task.score = Number.MAX_VALUE;
            }
          });
        }
      });
    }
  }
  public updateRecompute(s: ScheduleContext) {
    if (!s) return;
    if (!s.slot.hasStartTimes()) return;

    const task = this.byTask.getEntity(s.task.key);
    if (task) {
      s.recompute = false;
      s.task.processed = true;
      s.slot.resources?.forEach((res) => {
        const resource = this.byResource.getEntity(res.resource?.hashKey ?? "");
        if (resource) {
          resource.value.recompute = true;
          resource.contexts.forEach((schedule) => {
            if (schedule.task && !schedule.task.processed) {
              schedule.recompute = true;
              schedule.task.score = Number.MAX_VALUE;
            }
          });
        }
      });
    }
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
