import { describe, it, expect } from "vitest";
import { SlackDispatchPriority } from "../../AI/Dispatch/slackdispatchpriority";
import { DispatchState } from "../../AI/Dispatch/dispatchstate";
import { CTPTask } from "../../Models/Entities/task";

const DAY = 86400;

// Minimal stubs — Slack reads customerDeliveryDate (via deliveryDateOf), duration,
// rank, window off the task and asOf() off the state. No dueDate fallback.
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
function state(asOf = 0): DispatchState {
  return {
    landscape: null,
    settings: null,
    readyTasks: [],
    now: () => asOf,
    asOf: () => asOf,
    avgRemainingDuration: () => 0,
    resourceLoad: () => new Map(),
    // No landscape graph in these stubs → each mock task is its own order.
    dueDateOf: (t: any) => t.dueDate,
    deliveryDateOf: (t: any) => t.customerDeliveryDate ?? null,
    penaltyOf: (t: any) => t.latenessPenaltyPerDay,
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

  it("ranks by the CUSTOMER date only — internal dueDate is ignored", () => {
    // A: near customer promise but far internal dueDate — should still lead.
    const a = task({ customerDeliveryDate: 2 * DAY, dueDate: 40 * DAY, durSec: DAY });
    // B: far customer promise but near internal dueDate.
    const b = task({ customerDeliveryDate: 20 * DAY, dueDate: 3 * DAY, durSec: DAY });
    const s = state(0);
    expect(slack.compare(a, b, s)).toBeLessThan(0); // customer date decides, not dueDate
  });

  it("null customerDeliveryDate = BACKFILL, below dated work — regardless of internal dueDate", () => {
    // The stock order has a near internal dueDate but NO customer promise → backfill.
    const stock = task({ customerDeliveryDate: null, dueDate: 1 * DAY, durSec: DAY });
    // The customer order is dated, even with a far delivery date.
    const customer = task({ customerDeliveryDate: 100 * DAY, durSec: DAY });
    const s = state(0);
    expect(slack.compare(customer, stock, s)).toBeLessThan(0); // dated customer work first
    expect(slack.compare(stock, customer, s)).toBeGreaterThan(0); // stock sinks to backfill (no dueDate fallback)
  });

  it("two backfill (null customer date) tasks fall to the legacy order (rank)", () => {
    const a = task({ customerDeliveryDate: null, dueDate: 3 * DAY, durSec: DAY, rank: 2 });
    const b = task({ customerDeliveryDate: null, dueDate: 30 * DAY, durSec: DAY, rank: 5 });
    const s = state(0);
    // Both backfill → NOT ordered by dueDate; the legacy (rank, window) tie-break decides.
    expect(slack.compare(a, b, s)).toBeLessThan(0); // lower rank first
    expect(slack.compare(b, a, s)).toBeGreaterThan(0);
  });

  it("is deterministic on ties (falls back to rank)", () => {
    const a = task({ customerDeliveryDate: 10 * DAY, durSec: DAY, rank: 4 });
    const b = task({ customerDeliveryDate: 10 * DAY, durSec: DAY, rank: 8 });
    const s = state(0);
    expect(slack.compare(a, b, s)).toBeLessThan(0); // equal slack → lower rank first
  });
});
