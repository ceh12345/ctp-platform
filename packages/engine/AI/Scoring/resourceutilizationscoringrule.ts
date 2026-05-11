import { ScheduleContext } from "../../Models/Entities/schedulecontext";
import { CTPScore, IScore } from "../../Models/Entities/score";
import { CTPScoringRule } from "./scoringrule";

/**
 * ResourceUtilizationScoringRule — MAXIMIZE
 *
 * Prefers assignments to less-utilized resources for balanced loading.
 * Score = minimum headroom (1 - utilization) across all resources in the slot.
 * Uses the bottleneck resource to prevent piling onto near-capacity resources.
 *
 * Returns 0.5 (neutral) if resource availability data is missing.
 */
export class ResourceUtilizationScoringRule extends CTPScoringRule {
  constructor(w: number, o?: number, p?: number) {
    super("ResourceUtilizationScoringRule", w, o, p);
  }

  public compute(schedule: ScheduleContext): IScore {
    const score: IScore = new CTPScore(this.name);
    const resources = schedule.slot.resources;

    if (!resources || resources.length === 0) {
      score.score = 0.5;
      return score;
    }

    let minHeadroom = 1.0;

    resources.forEach((resSlot) => {
      const resource = resSlot.resource;
      if (!resource) return;

      const original = resource.available?.staticOriginal;
      const assignments = resource.available?.staticAssignments;

      if (original && original.atleastOne()) {
        let totalAvailable = 0;
        let totalAssigned = 0;

        let ptr = original.head;
        while (ptr) {
          totalAvailable += (ptr.data.endW - ptr.data.startW) * (ptr.data.qty ?? 1);
          ptr = ptr.next;
        }

        if (assignments && assignments.atleastOne()) {
          let aPtr = assignments.head;
          while (aPtr) {
            // workDuration() returns segment-summed working time for FLOAT
            // assignments and falls back to envelope duration for FIXED.
            // Prevents over-reporting utilization when FLOAT tasks span gaps.
            totalAssigned += aPtr.data.workDuration() * (aPtr.data.qty ?? 1);
            aPtr = aPtr.next;
          }
        }

        if (totalAvailable > 0) {
          const utilization = totalAssigned / totalAvailable;
          const headroom = 1.0 - Math.min(utilization, 1.0);
          if (headroom < minHeadroom) {
            minHeadroom = headroom;
          }
        }
      }
    });

    score.score = minHeadroom;
    return score;
  }
}
