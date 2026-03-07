import { CTPTaskStateConstants, CTPAssignmentConstants } from '../Core/constants';
import { CTPInterval } from '../Core/window';
import { SchedulingLandscape } from './landscape';
import { ScheduleEngine } from '../../Engines/scheduleengine';

export interface TaskAssignment {
  taskKey: string;
  resourceKeys: string[];
  primaryResourceKey: string;
  startW: number;
  endW: number;
  score: number;
  chainKey: string | null;
}

export interface SolutionState {
  id: string;
  label: string;
  timestamp: number;
  assignments: Map<string, TaskAssignment>;
  totalScore: number;
  feasibilityRate: number;
  scheduledCount: number;
  infeasibleCount: number;
  totalGap: number;
  bumpCount: number;
}

export interface TaskMovement {
  taskKey: string;
  fromResource: string;
  toResource: string;
  fromStartW: number;
  toStartW: number;
  scoreDelta: number;
}

export interface SolutionDelta {
  moved: TaskMovement[];
  added: string[];
  removed: string[];
  scoreDelta: number;
  feasibilityDelta: number;
  scheduledDelta: number;
}

export class SolutionStateBuilder {

  static capture(
    landscape: SchedulingLandscape,
    label: string = 'snapshot',
  ): SolutionState {
    const assignments = new Map<string, TaskAssignment>();
    let totalScore = 0;
    let scheduledCount = 0;
    let infeasibleCount = 0;

    landscape.tasks?.forEach(task => {
      if (task.state === CTPTaskStateConstants.SCHEDULED && task.scheduled) {
        const resourceKeys: string[] = [];
        let primaryKey = '';

        task.capacityResources?.forEach(tr => {
          if (tr.scheduledResource) {
            resourceKeys.push(tr.scheduledResource);
            if (tr.isPrimary) primaryKey = tr.scheduledResource;
          }
        });

        const taskScore = task.score !== Number.MAX_VALUE ? task.score : 0;
        assignments.set(task.key, {
          taskKey: task.key,
          resourceKeys,
          primaryResourceKey: primaryKey,
          startW: task.scheduled.startW,
          endW: task.scheduled.endW,
          score: taskScore,
          chainKey: task.linkId?.name || null,
        });

        totalScore += taskScore;
        scheduledCount++;
      } else {
        infeasibleCount++;
      }
    });

    const total = scheduledCount + infeasibleCount;
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      label,
      timestamp: Date.now(),
      assignments,
      totalScore,
      feasibilityRate: total > 0 ? scheduledCount / total : 0,
      scheduledCount,
      infeasibleCount,
      totalGap: 0,
      bumpCount: 0,
    };
  }

  static restore(
    landscape: SchedulingLandscape,
    state: SolutionState,
    scheduleEngine: ScheduleEngine,
  ): void {
    // Unschedule all currently scheduled tasks
    landscape.tasks?.forEach(task => {
      if (task.state === CTPTaskStateConstants.SCHEDULED) {
        landscape.unscheduleTask(task.key, true);
      }
    });

    // Restore assignments from snapshot
    for (const [taskKey, assignment] of state.assignments) {
      const task = landscape.tasks?.getEntity(taskKey);
      if (!task || !task.duration) continue;

      task.state = CTPTaskStateConstants.SCHEDULED;
      if (!task.scheduled) task.scheduled = new CTPInterval();
      task.scheduled.set(assignment.startW, assignment.endW, 1);

      let index = 0;
      task.capacityResources?.forEach(tr => {
        const resKey = assignment.resourceKeys[index];
        if (resKey) {
          const resource = landscape.resources?.getEntity(resKey);
          if (resource) {
            scheduleEngine.addTaskToResource(
              resource, task,
              assignment.startW, assignment.endW,
              CTPAssignmentConstants.PROCESS, index,
            );
            tr.scheduledResource = resKey;
          }
        }
        index++;
      });
    }
  }

  static compare(a: SolutionState, b: SolutionState): SolutionDelta {
    const moved: TaskMovement[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    for (const [key, bAssign] of b.assignments) {
      const aAssign = a.assignments.get(key);
      if (!aAssign) {
        added.push(key);
      } else if (aAssign.startW !== bAssign.startW ||
                 aAssign.primaryResourceKey !== bAssign.primaryResourceKey) {
        moved.push({
          taskKey: key,
          fromResource: aAssign.primaryResourceKey,
          toResource: bAssign.primaryResourceKey,
          fromStartW: aAssign.startW,
          toStartW: bAssign.startW,
          scoreDelta: bAssign.score - aAssign.score,
        });
      }
    }

    for (const key of a.assignments.keys()) {
      if (!b.assignments.has(key)) removed.push(key);
    }

    return {
      moved,
      added,
      removed,
      scoreDelta: b.totalScore - a.totalScore,
      feasibilityDelta: b.feasibilityRate - a.feasibilityRate,
      scheduledDelta: b.scheduledCount - a.scheduledCount,
    };
  }
}
