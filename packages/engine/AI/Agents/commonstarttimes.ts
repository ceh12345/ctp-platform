import "./agent";
import { AIAgent, IAIAgent } from "./agent";
import { CTPResourceSlot, CTPResourceSlots } from "../../Models/Entities/slot";
import { CTPDuration, CTPInterval } from "../../Models/Core/window";
import { theEngines } from "../../Engines/engines";
import { CTPIntervals } from "../../Models/Intervals/intervals";
import { CTPTask, CTPTasks } from "../../Models/Entities/task";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { ListNode } from "../../Models/Core/linklist";
import { CTPStartTime, CTPStartTimes } from "../../Models/Entities/starttime";
import { workingEndForwardW } from "../../Models/Core/interval-walker";

interface ICommonStartTimesAgent extends IAIAgent {
  solve(
    st: number,
    et: number,
    duration: CTPDuration,
    resorceSlots: CTPResourceSlots,
    landscape: SchedulingLandscape,
  ): void;
}

class Feasible {
  public startTimes: CTPIntervals | null = new CTPIntervals();
}
///
//   Agent to find the common start times between a set  of resources
//
///
export class CommonStartTimesAgent
  extends AIAgent
  implements ICommonStartTimesAgent
{
  private NO_RESOURCES_TO_PROCESS = "No Common Resources to process ";
  private NO_RESOURCE_AVAILABILTY = "Could Not Find Availablity for ";
  private INVALID_WINDOW = "Duration is greater than window";

  constructor() {
    super("CommonStartTimesAgent");
  }

  init(resourceSlots: CTPResourceSlots): void {
    resourceSlots.clearErrors();
    resourceSlots.startTimes?.clear();
    resourceSlots.startTimes = null;
    resourceSlots.startTimes = new CTPStartTimes();
  }

  computeAvailable(rs: CTPResourceSlot, l: SchedulingLandscape): void {
    if (rs.resource) {
      rs.resource.available.setLists(
        rs.resource.original,
        rs.resource.assignments,
      );
      theEngines.availableEngine.recalculate(rs.resource.available, l);

      rs.resource.recompute = false;
    }
  }

  createStateChanges(
    st: number,
    et: number,
    resourceSlots: CTPResourceSlots,
    startTime: CTPStartTime,
  ) {
    startTime.states = [];
  }
  createStartTimes(
    st: number,
    et: number,
    duration: CTPDuration,
    resourceSlots: CTPResourceSlots,
    feasibe: Feasible,
  ) {
    resourceSlots.startTimes?.clear();
    if (resourceSlots.errors && resourceSlots.errors.length > 0) return false;
    if (feasibe.startTimes && feasibe.startTimes.size() > 0) {
      // For FLOAT durations the wall-clock end depends on the start (shift
      // gaps don't accumulate working time), so we walk the canonical
      // resource's calendar instead of using startW + duration arithmetic.
      // For FIXED, workingEndForwardW falls back to arithmetic — same answer.
      const calendar = resourceSlots.resources?.at(0)?.resource?.available?.staticAvailable;
      let a: ListNode<CTPInterval> | null = feasibe.startTimes?.head;
      while (a) {
        const eEndW = workingEndForwardW(calendar, a.data.startW, duration);
        const lEndW = workingEndForwardW(calendar, a.data.endW, duration);
        const st1 = new CTPStartTime(
          a.data.startW,
          eEndW,
          a.data.endW,
          lEndW,
          duration.duration()
        );
        this.createStateChanges(st, et, resourceSlots, st1);
        resourceSlots.startTimes?.insertAtEnd(st1);
        a = a.next;
      }
    }
  }

  computeFeasible(
    st: number,
    et: number,
    duration: CTPDuration,
    rs: CTPResourceSlot,
    resourceSlots: CTPResourceSlots,
    landscape: SchedulingLandscape,
    feasible: Feasible,
    firstTime: boolean,
  ): void {
    if (!rs.resource) {
      resourceSlots.addToErrors(
        this.NO_RESOURCE_AVAILABILTY + " Unknown Resource",
      );
      feasible.startTimes?.clear();
      return;
    }

    if (rs.resource?.recompute) this.computeAvailable(rs, landscape);

    theEngines.startTimeEngine.setLists(
      st,
      et,
      duration,
      rs.resource.available,
      landscape,
    );
    const starts = theEngines.startTimeEngine.computeStartTimes();
    // Remove Changeovers
    const combinedStarts = feasible.startTimes;

    let error = !starts || (starts && starts.size() === 0);

    // If Resource is not feasible add to error list
    if (combinedStarts && !error && starts) {
      // If first Time init startTimes
      if (firstTime) feasible.startTimes = starts;
      else if (combinedStarts.size() > 0) {
        feasible.startTimes = theEngines.intersectEngine.execute(
          starts,
          combinedStarts,
        );
        error =
          !feasible.startTimes ||
          (feasible.startTimes && feasible.startTimes.size() === 0);
      }
    }
    if (error) {
      resourceSlots.addToErrors(
        this.NO_RESOURCE_AVAILABILTY + rs.resource?.name,
      );
      feasible.startTimes?.clear();
    }
  }
  compute(
    st: number,
    et: number,
    duration: CTPDuration,
    resourceSlots: CTPResourceSlots,
    landscape: SchedulingLandscape,
  ): Feasible {
    let feasible = new Feasible();

    resourceSlots.recompute = false;

    // Pure-duration path: no capacity resources declared, so feasibility is
    // determined by temporal constraints alone (window bounds + duration).
    // Chain sequencing and calendar constraints are enforced upstream via st/et
    // before this method is called — this branch does NOT bypass those constraints.
    if (!resourceSlots.resources || resourceSlots.resources.length === 0) {
      if (et - duration.duration() < st)
        resourceSlots.addToErrors(this.INVALID_WINDOW);
      else {
        feasible.startTimes?.add(new CTPInterval(st, et - duration.duration()));
      }
      return feasible;
    }

    let i = 0;
    resourceSlots.resources.forEach((resourceSlot) => {
      if (i >= 0) {
        this.computeFeasible(
          st,
          et,
          duration,
          resourceSlot,
          resourceSlots,
          landscape,
          feasible,
          i == 0,
        );
        i += 1;
        if (!feasible.startTimes || feasible.startTimes.size() === 0) i = -1; // Short Circut the forEach loop
      }
    });
    return feasible;
  }

  solve(
    st: number,
    et: number,
    duration: CTPDuration,
    resourceSlots: CTPResourceSlots,
    landscape: SchedulingLandscape,
  ): void {
    this.init(resourceSlots);
    let feasible = this.compute(st, et, duration, resourceSlots, landscape);
    this.createStartTimes(st, et, duration, resourceSlots, feasible);
    feasible.startTimes?.clear();
  }
}
