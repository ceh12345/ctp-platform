import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * OvertimeCostScoringRule — MINIMIZE
 *
 * Computes the premium cost of scheduling work during overtime hours.
 * Uses resource.overtimeMultiplier (default 1.5) applied to hours
 * that fall outside the resource's standard availability windows.
 *
 * Only the premium portion is counted — standard-rate hours contribute 0
 * (those are already counted by ResourceCostScoringRule).
 *
 * Simplified approach: if a task's start time extends into hours where
 * the resource has reduced availability (gaps in the availability profile),
 * that suggests overtime. For now, uses a flat multiplier on the hourly rate
 * for the proportion of the task that falls outside standard availability.
 */
export class OvertimeCostScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("OvertimeCostScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const resources = schedule.slot.resources;

    if (!resources || resources.length === 0 || !schedule.slot.startTimes?.head) {
      score.score = 0;
      score.cost = 0;
      return score;
    }

    let premiumCost = 0;
    const taskStart = schedule.slot.startTimes.head.data.eStartW;
    const taskDuration = schedule.task.duration?.duration() ?? 0;
    const taskEnd = taskStart + taskDuration;

    resources.forEach(resSlot => {
      const resource = resSlot.resource;
      if (!resource || !resource.hourlyRate) return;

      const multiplier = (resource as any).overtimeMultiplier ?? 1.5;
      const rate = resource.hourlyRate;

      // Check how much of the task falls outside standard availability
      // by examining the resource's original availability windows
      const original = resource.available?.staticOriginal;
      if (!original || !original.head) return;

      // Calculate overlap with standard availability
      let standardHours = 0;
      let ptr: any = original.head;
      while (ptr) {
        const availStart = ptr.data.startW;
        const availEnd = ptr.data.endW;
        const overlapStart = Math.max(taskStart, availStart);
        const overlapEnd = Math.min(taskEnd, availEnd);
        if (overlapEnd > overlapStart) {
          standardHours += (overlapEnd - overlapStart) / 3600;
        }
        ptr = ptr.next;
      }

      const totalHours = taskDuration / 3600;
      const overtimeHours = Math.max(0, totalHours - standardHours);

      if (overtimeHours > 0) {
        // Only the premium portion (multiplier - 1.0) is the extra cost
        premiumCost += overtimeHours * rate * (multiplier - 1.0);
      }
    });

    score.score = premiumCost;
    score.cost = premiumCost;
    return score;
  }
}
