import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
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
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export interface DispatchState {
  readonly landscape: SchedulingLandscape | null;
  readonly settings: CTPAppSettings | null;
  /** The ready set this round — the chain-head tasks eligible for selection. */
  readonly readyTasks: CTPTask[];
  /** Evaluation frontier: earliest feasible/window start among ready tasks (epoch s). ATC's `t`. */
  now(): number;
  /** Mean remaining processing time over the ready set (seconds). ATC's `p̄` normalizer. */
  avgRemainingDuration(): number;
  /** Total required processing time (seconds) per primary resource key over the
   *  landscape's tasks. Memoized. DBR argmaxes this to find the constraint. */
  resourceLoad(): ReadonlyMap<string, number>;
}

export class DispatchStateLens implements DispatchState {
  private _now?: number;
  private _avg?: number;
  private _load?: Map<string, number>;

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
}
