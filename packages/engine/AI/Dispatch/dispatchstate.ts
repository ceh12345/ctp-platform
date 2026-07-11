import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPAppSettings } from "../../Models/Entities/appsettings";

/**
 * Read-only lens over the live landscape, handed to a dispatch-priority rule on
 * each selection round. Phase 1 carries only the landscape/settings escape hatch;
 * derived, memoized accessors (`now`, `avgRemainingDuration`, `bottleneckQueue`)
 * are added by the ATC (Phase 2) and DBR (Phase 3) plugs when those rules need
 * them — computed once, one way, so every plug reads the same numbers.
 *
 * See docs/sprints/SPRINT-dispatch-strategy-seam.md.
 */
export interface DispatchState {
  readonly landscape: SchedulingLandscape | null;
  readonly settings: CTPAppSettings | null;
}

export class DispatchStateLens implements DispatchState {
  constructor(
    public readonly landscape: SchedulingLandscape | null,
    public readonly settings: CTPAppSettings | null,
  ) {}
}
