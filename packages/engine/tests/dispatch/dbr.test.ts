import { describe, it, expect } from "vitest";
import { DBRDispatchPriority } from "../../AI/Dispatch/dbrdispatchpriority";
import { DispatchState } from "../../AI/Dispatch/dispatchstate";
import { CTPTask } from "../../Models/Entities/task";

const DAY = 86400;

// Minimal stubs — DBR reads a task's primary resource key (via capacityResources),
// rank, window; and the constraint from state.resourceLoad().
function task(resourceKey: string, durSec: number, dueDate = Number.MAX_SAFE_INTEGER, rank = 0): CTPTask {
  return {
    dueDate,
    rank,
    latenessPenaltyPerDay: 0,
    duration: { duration: () => durSec },
    window: { startW: 0 },
    capacityResources: { forEach: (cb: (tr: unknown) => void) => cb({ resource: resourceKey, isPrimary: true }) },
  } as unknown as CTPTask;
}
function state(load: Map<string, number>): DispatchState {
  return {
    landscape: null,
    settings: null,
    readyTasks: [],
    now: () => 0,
    avgRemainingDuration: () => 0,
    resourceLoad: () => load,
  } as unknown as DispatchState;
}

describe("DBRDispatchPriority", () => {
  it("down-ranks bottleneck-bound work behind non-bottleneck work, even when it's due-urgent", () => {
    const dbr = new DBRDispatchPriority();
    const s = state(new Map([["DRUM", 1000], ["OTHER", 10]]));
    dbr.prepare(s); // DRUM is the constraint

    const drumUrgent = task("DRUM", 100, 1 * DAY); // on the drum, tight due date
    const offDrumRelaxed = task("OTHER", 100, 100 * DAY); // off the drum, slack-rich

    // Non-constraint flows first despite the drum task being far more due-urgent.
    expect(dbr.compare(drumUrgent, offDrumRelaxed, s)).toBeGreaterThan(0);
    expect(dbr.compare(offDrumRelaxed, drumUrgent, s)).toBeLessThan(0);
  });

  it("still releases work when every ready head is bottleneck-bound (no stall)", () => {
    const dbr = new DBRDispatchPriority();
    const s = state(new Map([["DRUM", 1000]]));
    dbr.prepare(s);

    const a = task("DRUM", 100, 10 * DAY, /* rank */ 3);
    const b = task("DRUM", 100, 10 * DAY, /* rank */ 7);

    // Both on the drum → same class → default (rank) order decides; one is released.
    expect(dbr.compare(a, b, s)).toBeLessThan(0);
    expect(dbr.compare(b, a, s)).toBeGreaterThan(0);
  });

  it("identifies the constraint deterministically (max load; lowest key breaks a tie)", () => {
    const dbr = new DBRDispatchPriority();
    const load = new Map([["A", 50], ["B", 50], ["C", 10]]);
    dbr.prepare(state(load)); // A and B tie at 50 → lowest key A wins

    const onA = task("A", 10);
    const onC = task("C", 10);
    expect(dbr.compare(onA, onC, state(load))).toBeGreaterThan(0); // A is the drum → down-ranked
  });

  it("is a no-op reordering when there is no constraint (empty load)", () => {
    const dbr = new DBRDispatchPriority();
    const s = state(new Map());
    dbr.prepare(s); // no bottleneck

    const a = task("X", 10, 10 * DAY, /* rank */ 2);
    const b = task("Y", 10, 10 * DAY, /* rank */ 5);
    // Nothing is bottleneck-bound → pure static order (rank).
    expect(dbr.compare(a, b, s)).toBeLessThan(0);
  });
});
