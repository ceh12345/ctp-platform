import { describe, it, expect } from "vitest";
import { ATCDispatchPriority } from "../../AI/Dispatch/atcdispatchpriority";
import { SlackDispatchPriority } from "../../AI/Dispatch/slackdispatchpriority";
import { StaticRankPriority } from "../../AI/Dispatch/staticrankpriority";
import { DBRDispatchPriority } from "../../AI/Dispatch/dbrdispatchpriority";
import { DispatchState } from "../../AI/Dispatch/dispatchstate";
import { CTPTask } from "../../Models/Entities/task";

const DAY = 86400;

function task(opts: { dueDate?: number; customerDeliveryDate?: number | null; rank?: number; durSec?: number }): CTPTask {
  return {
    dueDate: opts.dueDate ?? 0,
    customerDeliveryDate: opts.customerDeliveryDate ?? null,
    rank: opts.rank ?? 0,
    latenessPenaltyPerDay: 0,
    duration: { duration: () => opts.durSec ?? DAY },
    window: { startW: 0 },
  } as unknown as CTPTask;
}
function state(): DispatchState {
  return {
    landscape: null,
    settings: null,
    readyTasks: [],
    now: () => 0,
    asOf: () => 0,
    avgRemainingDuration: () => DAY,
    resourceLoad: () => new Map(),
    dueDateOf: (t: any) => t.dueDate,
    deliveryDateOf: (t: any) => t.customerDeliveryDate ?? null,
    penaltyOf: (t: any) => t.latenessPenaltyPerDay,
  } as unknown as DispatchState;
}

describe("two-class partition — per-plug datedness (governingDate)", () => {
  const s = state();

  it("Static governs on null for every task (all-backfill → legacy order)", () => {
    const st = new StaticRankPriority();
    expect(st.governingDate(s, task({ dueDate: 5 * DAY, customerDeliveryDate: 5 * DAY }))).toBeNull();
  });

  it("DBR governs non-null for every task (never backfill — orthogonal to dates)", () => {
    const dbr = new DBRDispatchPriority();
    expect(dbr.governingDate(s, task({ dueDate: 0, customerDeliveryDate: null }))).not.toBeNull();
  });

  it("THE DISCRIMINATOR: dueDate present + customerDeliveryDate null → backfill under Slack, dated under ATC", () => {
    const atc = new ATCDispatchPriority();
    const slack = new SlackDispatchPriority();
    // A stock order: internal target set, no customer promise.
    const stock = task({ dueDate: 10 * DAY, customerDeliveryDate: null });

    // Same task, opposite classification — this is what a shared `isDated` flag would break.
    expect(atc.governingDate(s, stock)).not.toBeNull(); // ATC axis = dueDate → DATED
    expect(slack.governingDate(s, stock)).toBeNull(); // Slack axis = customer date → BACKFILL
  });

  it("discriminator, behaviorally: the stock task ranks among dated under ATC but sinks under Slack", () => {
    const atc = new ATCDispatchPriority();
    const slack = new SlackDispatchPriority();
    const stock = task({ dueDate: 2 * DAY, customerDeliveryDate: null, rank: 1 }); // urgent internal, no customer date
    const customer = task({ dueDate: 40 * DAY, customerDeliveryDate: 40 * DAY, rank: 9 }); // relaxed customer order

    // ATC: both have a dueDate → both dated → the urgent internal one leads on index.
    expect(atc.compare(stock, customer, s)).toBeLessThan(0);
    // Slack: stock has no customer date → backfill → sinks below the dated customer order.
    expect(slack.compare(stock, customer, s)).toBeGreaterThan(0);
  });
});
