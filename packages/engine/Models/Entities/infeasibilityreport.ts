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

  return { type: 'dependency', reason: 'Chain timing constraints could not be satisfied' };
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
}
