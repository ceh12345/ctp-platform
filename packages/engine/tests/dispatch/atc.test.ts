import { describe, it, expect } from "vitest";
import { ATCDispatchPriority } from "../../AI/Dispatch/atcdispatchpriority";
import { DispatchState } from "../../AI/Dispatch/dispatchstate";
import { CTPTask } from "../../Models/Entities/task";

const DAY = 86400;

// Minimal stubs — ATC.compare reads only these fields off task/state.
function task(dueDate: number, durSec: number, rank = 0, penalty = 0): CTPTask {
  return {
    dueDate,
    rank,
    latenessPenaltyPerDay: penalty,
    duration: { duration: () => durSec },
    window: { startW: 0 },
  } as unknown as CTPTask;
}
function state(now: number, avg: number): DispatchState {
  return {
    landscape: null,
    settings: null,
    readyTasks: [],
    now: () => now,
    avgRemainingDuration: () => avg,
  } as DispatchState;
}

describe("ATCDispatchPriority", () => {
  const atc = new ATCDispatchPriority(3.0);

  it("a tight-slack job overtakes a shorter but slack-rich job (slack term beats WSPT)", () => {
    const tight = task(3 * DAY, 2 * DAY); // due 3d, 2d work → ~1d slack, low w/p
    const relaxedShort = task(30 * DAY, DAY / 2); // due 30d, 0.5d work → huge slack, high w/p
    const s = state(0, 1.25 * DAY);
    expect(atc.compare(tight, relaxedShort, s)).toBeLessThan(0); // tight picked first
    expect(atc.compare(relaxedShort, tight, s)).toBeGreaterThan(0);
  });

  it("a job overtakes a competitor as its slack collapses (look-ahead)", () => {
    const j = task(20 * DAY, DAY / 2); // short (high w/p), far due date
    const k = task(4 * DAY, 2 * DAY); // long (low w/p), near due date
    const avg = 1.25 * DAY;
    const early = state(0, avg); // j buried in slack
    const late = state(19 * DAY, avg); // j's slack nearly gone
    expect(atc.compare(j, k, early)).toBeGreaterThan(0); // early: k is more urgent
    expect(atc.compare(j, k, late)).toBeLessThan(0); // late: j overtakes k
  });

  it("is deterministic on ties (falls back to rank)", () => {
    const a = task(10 * DAY, DAY, /* rank */ 5);
    const b = task(10 * DAY, DAY, /* rank */ 9);
    const s = state(0, DAY);
    expect(atc.compare(a, b, s)).toBeLessThan(0); // equal ATC → lower rank first
    expect(atc.compare(b, a, s)).toBeGreaterThan(0);
  });
});
