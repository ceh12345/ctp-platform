import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { CTPOrder } from "../../Models/Entities/order";
import { CTPTask } from "../../Models/Entities/task";

/**
 * The primary (or first) required resource key a task loads, read from its
 * capacity requirements — available pre-schedule (unlike `scheduledResource`).
 * Used for DBR bottleneck attribution.
 */
export function primaryResourceKey(task: CTPTask): string | undefined {
  let primary: string | undefined;
  let first: string | undefined;
  task.capacityResources?.forEach((tr) => {
    if (tr.resource && first === undefined) first = tr.resource;
    if (tr.isPrimary && tr.resource && primary === undefined) primary = tr.resource;
  });
  return primary ?? first;
}

/**
 * Read-only lens over the live landscape, handed to a dispatch-priority rule on
 * each selection round. Derived accessors are **memoized per round** and computed
 * once, one way, so every plug reads the same numbers (the bake-off fairness
 * invariant). A static rule (StaticRankPriority) reads none of them.
 *
 * **Dates are demand attributes, read off the ORDER** (`task.linkId.name` →
 * `landscape.orders`), not the task. `hydrateDueDates` stamps dates onto chain
 * terminals only — correct for window propagation, but it leaves a chain head's
 * own `dueDate`/`customerDeliveryDate` at 0/null. Dispatch selects heads, so it
 * must resolve the governing WO date through the order pointer every task carries.
 * Null stays null (honest): an order with no `customerDeliveryDate` has no demand
 * deadline — the plug treats it as backfill, it is NOT collapsed onto the date axis.
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export interface DispatchState {
  readonly landscape: SchedulingLandscape | null;
  readonly settings: CTPAppSettings | null;
  /** The ready set this round — the chain-head tasks eligible for selection. */
  readonly readyTasks: CTPTask[];
  /** Evaluation frontier: earliest feasible/window start among ready tasks (epoch s). */
  now(): number;
  /** The fixed snapshot clock for the solve — the horizon start (the ClockService
   *  `asOf` materialized). Stable per solve, unlike `now()` which creeps forward as
   *  the ready set drains. ATC/Slack measure slack against this. */
  asOf(): number;
  /** Mean remaining processing time over the ready set (seconds). ATC's `p̄` normalizer. */
  avgRemainingDuration(): number;
  /** Total required processing time (seconds) per primary resource key over the
   *  landscape's tasks. Memoized. DBR argmaxes this to find the constraint. */
  resourceLoad(): ReadonlyMap<string, number>;
  /** The governing WO internal due date (JobEndDate), read off the order; 0 if none. */
  dueDateOf(task: CTPTask): number;
  /** The governing WO customer delivery date, read off the order; null = no demand
   *  deadline (stock/internal work → the plug ranks it as backfill, not "very late"). */
  deliveryDateOf(task: CTPTask): number | null;
  /** The governing WO lateness penalty/day, read off the order; 0 if none. */
  penaltyOf(task: CTPTask): number;
}

export class DispatchStateLens implements DispatchState {
  private _now?: number;
  private _avg?: number;
  private _load?: Map<string, number>;
  private readonly _orderCache = new Map<string, CTPOrder | null>();

  constructor(
    public readonly landscape: SchedulingLandscape | null,
    public readonly settings: CTPAppSettings | null,
    public readonly readyTasks: CTPTask[] = [],
  ) {}

  now(): number {
    if (this._now === undefined) {
      let min = Number.MAX_SAFE_INTEGER;
      for (const t of this.readyTasks) {
        const s = t.feasible ? t.feasible.startW : t.window?.startW;
        if (s != null && s < min) min = s;
      }
      this._now = min === Number.MAX_SAFE_INTEGER ? 0 : min;
    }
    return this._now;
  }

  asOf(): number {
    const startW = this.landscape?.horizon?.startW;
    return startW != null ? startW : this.now();
  }

  avgRemainingDuration(): number {
    if (this._avg === undefined) {
      let sum = 0;
      let n = 0;
      for (const t of this.readyTasks) {
        const d = t.duration ? t.duration.duration() : 0;
        if (d > 0) {
          sum += d;
          n++;
        }
      }
      this._avg = n > 0 ? sum / n : 0;
    }
    return this._avg;
  }

  resourceLoad(): ReadonlyMap<string, number> {
    if (this._load === undefined) {
      const load = new Map<string, number>();
      this.landscape?.tasks?.forEach((t) => {
        const key = primaryResourceKey(t);
        if (!key) return;
        const d = t.duration ? t.duration.duration() : 0;
        if (d <= 0) return;
        load.set(key, (load.get(key) ?? 0) + d);
      });
      this._load = load;
    }
    return this._load;
  }

  /** Resolve a task's governing order via its WO pointer (`linkId.name`); memoized. */
  private orderOf(task: CTPTask): CTPOrder | null {
    const name = task.linkId?.name;
    if (!name || !this.landscape?.orders) return null;
    const cached = this._orderCache.get(name);
    if (cached !== undefined) return cached;
    const order = this.landscape.orders.getEntity(name) ?? null;
    this._orderCache.set(name, order);
    return order;
  }

  dueDateOf(task: CTPTask): number {
    const order = this.orderOf(task);
    return order ? order.dueDate : task.dueDate; // no order (unit stubs) → own field
  }

  deliveryDateOf(task: CTPTask): number | null {
    const order = this.orderOf(task);
    return order ? order.customerDeliveryDate : task.customerDeliveryDate;
  }

  penaltyOf(task: CTPTask): number {
    const order = this.orderOf(task);
    return order ? order.latenessPenaltyPerDay : task.latenessPenaltyPerDay;
  }
}
