export interface BlockingTaskDetail {
  taskKey: string;
  taskName: string;
  chainKey: string | null;
  startW: number;
  endW: number;
  commitmentLevel?: string;
  dispatched?: boolean;
  materialsPulled?: boolean;
  holdReason?: string | null;
  percentComplete?: number;
}

export interface ResourceAvailabilityDetail {
  resourceKey: string;
  resourceName: string;
  availableMinutes: number;
  totalWindowMinutes: number;
  status: 'available' | 'partial' | 'blocked';
  blockingTasks: BlockingTaskDetail[];
  note: string | null;
}

export interface ResourceSlotReport {
  slotIndex: number;
  slotLabel: string;
  isPrimary: boolean;
  status: 'available' | 'partial' | 'blocked';
  bestAvailableMinutes: number;
  isBottleneck: boolean;
  resources: ResourceAvailabilityDetail[];
}

export type ConflictType = 'availability' | 'capacity' | 'dependency' | 'horizon';

export function classifyConflict(report: InfeasibilityReport): { type: ConflictType; reason: string } {
  const bottleneck = report.slots.find(s => s.isBottleneck);
  if (!bottleneck) return { type: 'dependency', reason: 'No bottleneck identified' };

  const anyOffShift = bottleneck.resources.some(r =>
    (r.note?.toLowerCase().includes('off shift') ||
     r.note?.toLowerCase().includes('no availability') ||
     (r.availableMinutes === 0 && r.blockingTasks.length === 0))
  );
  const anyBlockedByOthers = bottleneck.resources.some(r => r.blockingTasks.length > 0);

  if (anyOffShift && !anyBlockedByOthers) {
    const offShiftNames = bottleneck.resources
      .filter(r => r.availableMinutes === 0 && r.blockingTasks.length === 0)
      .map(r => r.resourceName)
      .join(', ');
    return {
      type: 'availability',
      reason: `${bottleneck.slotLabel} has no availability in the window (${offShiftNames} off shift)`,
    };
  }

  const allUnavailable = bottleneck.resources.every(r => r.status === 'blocked');
  const anyHasOnlyNote = bottleneck.resources.some(r =>
    r.status === 'blocked' && r.blockingTasks.length === 0 && r.note
  );
  if (allUnavailable && anyHasOnlyNote) {
    return {
      type: 'availability',
      reason: `${bottleneck.slotLabel} — insufficient availability in the window`,
    };
  }

  if (anyBlockedByOthers) {
    const blockerChains = new Set<string>();
    bottleneck.resources.forEach(r => {
      r.blockingTasks.forEach(bt => {
        blockerChains.add(bt.chainKey || bt.taskName);
      });
    });
    return {
      type: 'capacity',
      reason: `${bottleneck.slotLabel} capacity consumed by ${Array.from(blockerChains).join(', ')}`,
    };
  }

  // No contention from here down (anyBlockedByOthers is false). If the task's
  // window runs into the horizon and the bottleneck can't supply the hours it
  // needs before then, that's a HORIZON limit — the resource isn't a bottleneck,
  // there simply isn't enough time left. Decided here (detection time) so it's
  // immune to demand-ordering shifts that move the window around.
  if (report.windowCappedByHorizon
      && report.requiredMinutes != null
      && bottleneck.bestAvailableMinutes < report.requiredMinutes) {
    const needH = (report.requiredMinutes / 60).toFixed(1);
    const haveH = (bottleneck.bestAvailableMinutes / 60).toFixed(1);
    return {
      type: 'horizon',
      reason: `${bottleneck.slotLabel} — window capped by the horizon: ${needH}h required, only ${haveH}h available before the horizon ends`,
    };
  }

  if (report.combosGenerated > 0 && report.combosSurvivedPropagation === 0) {
    return {
      type: 'dependency',
      reason: 'All resource combinations eliminated by timing constraints (maxGap)',
    };
  }

  if (report.combosSurvivedPropagation > 0 && report.combosPassedAssignment === 0) {
    return {
      type: 'capacity',
      reason: `${bottleneck.slotLabel} — timing feasible but resource capacity insufficient at required times`,
    };
  }

  // A bottleneck slot was identified, nothing else is contending for it
  // (anyBlockedByOthers is false here), and it's not horizon-capped — so the
  // resource simply doesn't have enough availability in the window. That is an
  // availability constraint, not a capacity (contention) one. Calling it
  // 'capacity' with no blocking tasks is the misleading attribution we're fixing.
  // Successors blocked by an unscheduled predecessor are relabeled 'dependency'
  // separately, post-solve, in basescheduler.reclassifyChainInfeasibility.
  return {
    type: 'availability',
    reason: `${bottleneck.slotLabel} — insufficient availability in the window`,
  };
}

/**
 * Assemble the shared tail of an infeasibility report. Both scheduling paths —
 * the ChainContextEngine (chain-as-unit) and the base scheduler (per-task /
 * bump-and-retry) — build resource `slots` their own way, then delegate here so
 * the bottleneck pick, reason text, HORIZON signals, and classification live in
 * ONE place. Previously this tail was duplicated in two builders, which let the
 * horizon signal silently diverge between them (the regression this fixes).
 */
export function assembleInfeasibilityReport(opts: {
  taskKey: string;
  chainKey: string | null;
  baseReason: string;
  slots: ResourceSlotReport[];
  horizonEndW?: number | null;
  subjectWindowEndW?: number | null;
  requiredMinutes?: number;
  combosGenerated?: number;
  combosSurvivedPropagation?: number;
  combosPassedAssignment?: number;
}): InfeasibilityReport {
  // Bottleneck = the slot with the least availability.
  if (opts.slots.length > 0) {
    const sorted = [...opts.slots].sort((a, b) => a.bestAvailableMinutes - b.bestAvailableMinutes);
    sorted[0].isBottleneck = true;
  }
  const bottleneckSlot = opts.slots.find(s => s.isBottleneck);

  let reason = opts.baseReason;
  if (bottleneckSlot) {
    reason += ` — ${bottleneckSlot.slotLabel} is the bottleneck`;
    const blocked = bottleneckSlot.resources.filter(r => r.status === 'blocked');
    if (blocked.length > 0) {
      reason += ` (${blocked.map(r => r.resourceName).join(', ')} fully blocked)`;
    }
  }

  const windowCappedByHorizon =
    opts.horizonEndW != null && opts.subjectWindowEndW != null
    && opts.subjectWindowEndW >= opts.horizonEndW - 60;

  const report: InfeasibilityReport = {
    taskKey: opts.taskKey,
    chainKey: opts.chainKey,
    reason,
    bottleneckSlot: bottleneckSlot?.slotLabel || null,
    conflictType: 'dependency',
    conflictTypeReason: '',
    slots: opts.slots,
    combosGenerated: opts.combosGenerated ?? 0,
    combosSurvivedPropagation: opts.combosSurvivedPropagation ?? 0,
    combosPassedAssignment: opts.combosPassedAssignment ?? 0,
    windowCappedByHorizon,
    requiredMinutes: opts.requiredMinutes,
  };

  const classification = classifyConflict(report);
  report.conflictType = classification.type;
  report.conflictTypeReason = classification.reason;
  report.reason = `[${classification.type.toUpperCase()}] ${report.reason}`;
  return report;
}

export interface InfeasibilityReport {
  taskKey: string;
  chainKey: string | null;
  reason: string;
  bottleneckSlot: string | null;
  conflictType: ConflictType;
  conflictTypeReason: string;
  slots: ResourceSlotReport[];
  combosGenerated: number;
  combosSurvivedPropagation: number;
  combosPassedAssignment: number;
  /**
   * True when this report was attributed to the specific binding task at the
   * point of detection (e.g. the chain task with zero feasible contexts), rather
   * than computed chain-wide. The post-solve reclassification pass leaves these
   * alone — the engine already identified the real cause.
   */
  attributed?: boolean;
  /**
   * Detection-time horizon signals, stamped by buildInfeasibilityReport (which
   * has the landscape horizon + the task's window/duration in hand). Let
   * classifyConflict decide 'horizon' at the source instead of a fragile
   * post-solve wall-clock proxy.
   */
  windowCappedByHorizon?: boolean;  // task window runs up against the horizon end
  requiredMinutes?: number;         // working minutes the task needs (duration)
}
