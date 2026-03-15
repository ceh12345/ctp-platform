"strict";
import { DateTime } from "luxon";
import { CTPInterval } from "../Core/window";
import { CTPResourceModeConstants, CTPResourcePreferenceModeConstants, CTPTaskStateConstants } from "../Core/constants";
import { CTPAppSettings, IAppSettings } from "./appsettings";
import { CTPHorizon } from "./horizon";
import { CTPTask, CTPTasks } from "./task";
import { CTPResource, CTPResources } from "./resource";
import { CTPProcess, CTPProcesses } from "./process";
import { CTPStateChanges } from "./statechange";
import { CTPBatchRules } from "./batchrule";
import { CTPOrders } from "./order";

export interface ILandscape {
  horizon: CTPHorizon | null;
  tasks: CTPTasks | null;
  resources: CTPResources | null;
  processes: CTPProcesses | null;
  appSettings: CTPAppSettings | null;
  stateChanges: CTPStateChanges | null;
  stateTasks: CTPTasks | null;
  batchRules: CTPBatchRules | null;
  orders: CTPOrders | null;
}

export class SchedulingLandscape implements ILandscape {
  public horizon: CTPHorizon;
  public tasks: CTPTasks;
  public resources: CTPResources;
  public processes: CTPProcesses;
  public stateChanges: CTPStateChanges;
  public stateTasks: CTPTasks;
  public batchRules: CTPBatchRules;
  public orders: CTPOrders;

  public appSettings: CTPAppSettings | null = null;

  public setSettings(a: CTPAppSettings): void {
    this.appSettings = a;
  }

  public setHorizon(st: DateTime, et: DateTime) {
    this.horizon.set(st, et);
  }

  // Build Tasks that are linked together
  public buildProcesses()
  {
      if (!this.processes) this.processes = new CTPProcesses();
      this.processes.clear();

      if (this.tasks)
      {
          this.tasks.forEach(t => {
              if (t.hasLinkId() && t.linkId?.name)
              {

                  let newP = this.processes.getEntity(t.linkId.name);

                  if (!newP)
                  {
                      newP = new CTPProcess(t.linkId.name);
                      this.processes.addEntity(newP);
                  }
                  newP.tasks?.add(t);
              }
          });
          this.processes.forEach(p => {
              p.tasks?.sortBySequence();
          });

      }
  }
  /**
   * Remove all assignments for a task from a resource's assignment list.
   */
  private removeTaskFromResource(resource: CTPResource, task: CTPTask): void {
    if (!resource.assignments) return;
    let node = resource.assignments.head;
    while (node) {
      if (node.data && node.data.name === task.key) {
        const toDelete = node;
        node = node.next;
        resource.assignments.deleteNode(toDelete);
      } else {
        node = node.next;
      }
    }
    resource.recompute = true;
  }

  /**
   * Unschedule a single task: clear its assignment, restore resource availability.
   * Returns true if the task was successfully unscheduled.
   */
  public unscheduleTask(taskKey: string, resetScore: boolean = true): boolean {
    const task = this.tasks?.getEntity(taskKey);
    if (!task) return false;
    if (task.state !== CTPTaskStateConstants.SCHEDULED) return false;
    if (task.pinned) return false;

    // Remove assignments from capacity resources
    if (task.capacityResources) {
      task.capacityResources.forEach(tr => {
        if (tr.isIgnored()) return;
        const resKey = tr.scheduledResource || tr.resource;
        if (!resKey) return;
        const resource = this.resources?.getEntity(resKey);
        if (resource) this.removeTaskFromResource(resource, task);
      });
    }

    // Remove assignments from material resources
    if (task.materialsResources) {
      task.materialsResources.forEach(tr => {
        const resKey = tr.scheduledResource || tr.resource;
        if (!resKey) return;
        const resource = this.resources?.getEntity(resKey);
        if (resource) this.removeTaskFromResource(resource, task);
      });
    }

    // Clear task state
    task.state = CTPTaskStateConstants.NOT_SCHEDULED;
    task.scheduled = null;
    task.feasible = null;
    task.processed = false;
    if (resetScore) task.resetScore();

    // Clear scheduled resource on each task resource
    if (task.capacityResources) {
      task.capacityResources.forEach(tr => { tr.scheduledResource = undefined; });
    }
    if (task.materialsResources) {
      task.materialsResources.forEach(tr => { tr.scheduledResource = undefined; });
    }

    return true;
  }

  /**
   * Unschedule all tasks for a given order.
   * Returns the count of tasks unscheduled.
   */
  public unscheduleOrder(orderKey: string): number {
    let count = 0;
    this.tasks?.forEach(task => {
      if (task.linkId?.name === orderKey) {
        if (this.unscheduleTask(task.key)) count++;
      }
    });
    return count;
  }

  /**
   * Apply order modes: INCLUDE / EXCLUDE / LOCKED
   */
  public applyOrderModes(orderModes: Record<string, string>): void {
    for (const [orderKey, mode] of Object.entries(orderModes)) {
      this.tasks?.forEach(task => {
        const taskOrder = task.linkId?.name;
        if (taskOrder !== orderKey) return;

        switch (mode) {
          case 'EXCLUDE':
            task.includeInSolve = false;
            if (task.state === CTPTaskStateConstants.SCHEDULED) {
              this.unscheduleTask(task.key, false);
            }
            break;
          case 'LOCKED':
            task.includeInSolve = false;
            task.pinned = true;
            break;
          case 'INCLUDE':
          default:
            task.includeInSolve = true;
            break;
        }
      });
    }
  }

  /**
   * Apply task-level pins
   */
  public applyTaskPins(taskPins: Record<string, boolean>): void {
    for (const [taskKey, pinned] of Object.entries(taskPins)) {
      const task = this.tasks?.getEntity(taskKey);
      if (task) {
        task.pinned = pinned;
        if (pinned) task.includeInSolve = false;
      }
    }
  }

  /**
   * Apply task-level excludes
   */
  public applyTaskExcludes(taskExcludes: Record<string, boolean>): void {
    for (const [taskKey, excluded] of Object.entries(taskExcludes)) {
      const task = this.tasks?.getEntity(taskKey);
      if (task) {
        task.includeInSolve = !excluded;
        if (excluded && task.state === CTPTaskStateConstants.SCHEDULED) {
          this.unscheduleTask(taskKey, false);
        }
      }
    }
  }

  /**
   * Apply resource mode overrides on specific task-resource relationships.
   * Keys are "taskKey:resourceKey:type" format.
   */
  public applyResourceModes(modeOverrides: Record<string, string>): void {
    for (const [compoundKey, newMode] of Object.entries(modeOverrides)) {
      const parts = compoundKey.split(':');
      if (parts.length < 3) continue;

      const [taskKey, resourceKey, type] = parts;
      const task = this.tasks?.getEntity(taskKey);
      if (!task) continue;

      const resourceList = type === 'capacity' ? task.capacityResources : task.materialsResources;
      if (!resourceList) continue;

      resourceList.forEach(tr => {
        if (tr.resource === resourceKey || tr.scheduledResource === resourceKey) {
          tr.mode = newMode;
        }
      });
    }
  }

  /**
   * Apply per-task resource preference overrides.
   * Input: { taskKey: { resourceKey: mode } } where mode is REQUIRED/PREFERRED/AVAILABLE/EXCLUDED.
   * Sets mode on matching CTPResourcePreference objects within the task's capacity resources.
   */
  public applyResourcePreferenceOverrides(
    overrides: Record<string, Record<string, string>>
  ): void {
    for (const [taskKey, resourceModes] of Object.entries(overrides)) {
      const task = this.tasks?.getEntity(taskKey);
      if (!task || !task.capacityResources) continue;

      task.capacityResources.forEach((taskResource) => {
        taskResource.preferences.forEach((pref) => {
          const prefMode = resourceModes[pref.resourceKey];
          if (prefMode) {
            pref.mode = prefMode;
          }
        });
      });
    }
  }

  /**
   * Constraint propagation — tighten task windows based on predecessor relationships.
   * Call after applying overrides, before running the solver.
   * Returns the number of windows tightened.
   */
  public propagateConstraints(): number {
    let changed = true;
    let iterations = 0;
    let tightenCount = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      this.tasks?.forEach(task => {
        if (!task.window || !task.includeInSolve) return;
        if (!task.linkId?.prevLink) return;

        const pred = this.tasks?.getEntity(task.linkId.prevLink);
        if (!pred || !pred.window || !pred.duration) return;

        // Forward: tighten successor's earliest start
        const earliestStart = pred.window.startW + pred.duration.duration();
        if (earliestStart > task.window.startW) {
          task.window.startW = earliestStart;
          changed = true;
          tightenCount++;
        }

        // Backward: tighten predecessor's latest end
        if (task.duration) {
          const latestEnd = task.window.endW - task.duration.duration();
          if (latestEnd < pred.window.endW) {
            pred.window.endW = latestEnd;
            changed = true;
            tightenCount++;
          }
        }

        // Detect collapsed window — infeasible
        if (task.window.startW >= task.window.endW) {
          task.addError('ConstraintPropagation',
            `Window collapsed: earliest start ${task.window.startW} >= latest end ${task.window.endW}`);
          task.includeInSolve = false;
        }
      });
    }

    return tightenCount;
  }

  /**
   * Hydrate due dates from orders onto tasks.
   * Called once per solve after syncFromConfig and before the scheduling loop.
   *
   * Due date is stamped only on chain-terminal tasks (no successor).
   * Intermediate tasks get dueDate === 0 (neutral for DueDateScoringRule).
   * Order priority is stamped on ALL tasks in the chain.
   */
  public hydrateDueDates(): void {
    if (!this.tasks || !this.orders) return;

    // Find tasks that have a successor (another task references them as prevLink)
    const hasSuccessor = new Set<string>();
    this.tasks.forEach((task) => {
      if (task.linkId?.prevLink) {
        hasSuccessor.add(task.linkId.prevLink);
      }
    });

    // Stamp due dates on terminal tasks only, priority on all
    this.tasks.forEach((task) => {
      if (task.linkId?.name) {
        const order = this.orders.getEntity(task.linkId.name);
        if (order) {
          if (!hasSuccessor.has(task.key)) {
            task.dueDate = order.dueDate;
            task.lateDueDate = order.lateDueDate;
          }
          if (task.orderPriority === 0 && order.priority > 0) {
            task.orderPriority = order.priority;
          }
        }
      }
    });
  }

  constructor(s?: DateTime, e?: DateTime, a?: CTPAppSettings) {
    this.horizon = new CTPHorizon(s, e);
    this.tasks = new CTPTasks();
    this.resources = new CTPResources();
    this.processes = new CTPProcesses();
    this.stateChanges = new CTPStateChanges();
    this.stateTasks = new CTPTasks();
    this.batchRules = new CTPBatchRules();
    this.orders = new CTPOrders();
    if (s !== undefined && e !== undefined) this.setHorizon(s, e);
    if (a) this.setSettings(a);
    else this.appSettings = new CTPAppSettings();
  }
}
