import { describe, it, expect } from "vitest";
import { SlackDispatchPriority } from "../../AI/Dispatch/slackdispatchpriority";
import { DispatchState } from "../../AI/Dispatch/dispatchstate";
import { CTPTask } from "../../Models/Entities/task";

const DAY = 86400;

// Minimal stubs — Slack reads customerDeliveryDate, dueDate, duration, rank,
// window off the task and now() off the state. No lens accessor beyond now().
function task(opts: {
  customerDeliveryDate?: number | null;
  dueDate?: number;
  durSec?: number;
  rank?: number;
}): CTPTask {
  return {
    customerDeliveryDate: opts.customerDeliveryDate ?? null,
    dueDate: opts.dueDate ?? 0,
    rank: opts.rank ?? 0,
    latenessPenaltyPerDay: 0,
    duration: { duration: () => opts.durSec ?? 0 },
    window: { startW: 0 },
  } as unknown as CTPTask;
}
function state(now = 0): DispatchState {
  return {
    landscape: null,
    settings: null,
    readyTasks: [],
    now: () => now,
    avgRemainingDuration: () => 0,
    resourceLoad: () => new Map(),
  } as unknown as DispatchState;
}

describe("SlackDispatchPriority", () => {
  const slack = new SlackDispatchPriority();

  it("ranks the least-slack job first", () => {
    const tight = task({ customerDeliveryDate: 3 * DAY, durSec: DAY }); // slack ~2d
    const loose = task({ customerDeliveryDate: 30 * DAY, durSec: DAY }); // slack ~29d
    const s = state(0);
    expect(slack.compare(tight, loose, s)).toBeLessThan(0);
    expect(slack.compare(loose, tight, s)).toBeGreaterThan(0);
  });

  it("at equal delivery dates, the job with more remaining work outranks the lighter one", () => {
    const heavy = task({ customerDeliveryDate: 10 * DAY, durSec: 4 * DAY }); // slack 6d
    const light = task({ customerDeliveryDate: 10 * DAY, durSec: 1 * DAY }); // slack 9d
    const s = state(0);
    expect(slack.compare(heavy, light, s)).toBeLessThan(0); // heavy = less slack = first
  });

  it("customer delivery date drives the ranking over the internal dueDate", () => {
    // A: near customer promise but far internal dueDate — should still lead.
    const a = task({ customerDeliveryDate: 2 * DAY, dueDate: 40 * DAY, durSec: DAY });
    // B: far customer promise but near internal dueDate.
    const b = task({ customerDeliveryDate: 20 * DAY, dueDate: 3 * DAY, durSec: DAY });
    const s = state(0);
    expect(slack.compare(a, b, s)).toBeLessThan(0); // customer date wins
  });

  it("falls back to internal dueDate when no customer delivery date is set", () => {
    const nearDue = task({ customerDeliveryDate: null, dueDate: 3 * DAY, durSec: DAY });
    const farDue = task({ customerDeliveryDate: null, dueDate: 30 * DAY, durSec: DAY });
    const s = state(0);
    expect(slack.compare(nearDue, farDue, s)).toBeLessThan(0);
  });

  it("a task with no customer date and no dueDate sorts last but still schedules", () => {
    const dated = task({ customerDeliveryDate: 5 * DAY, durSec: DAY });
    const undated = task({ customerDeliveryDate: null, dueDate: 0, durSec: DAY });
    const s = state(0);
    expect(slack.compare(dated, undated, s)).toBeLessThan(0); // dated leads
    expect(slack.compare(undated, dated, s)).toBeGreaterThan(0); // undated last (not dropped)
  });

  it("is deterministic on ties (falls back to rank)", () => {
    const a = task({ customerDeliveryDate: 10 * DAY, durSec: DAY, rank: 4 });
    const b = task({ customerDeliveryDate: 10 * DAY, durSec: DAY, rank: 8 });
    const s = state(0);
    expect(slack.compare(a, b, s)).toBeLessThan(0); // equal slack → lower rank first
  });
});
