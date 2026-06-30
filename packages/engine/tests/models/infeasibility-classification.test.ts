import { describe, it, expect } from 'vitest';
import {
  classifyConflict,
  InfeasibilityReport,
  BlockingTaskDetail,
} from '../../Models/Entities/infeasibilityreport';

/**
 * Pins the detection-time conflict classification — the regression guard that was
 * missing when the horizon tag silently flipped to 'capacity' after a demand
 * reorder. The decisive signals are: contention (blockingTasks), horizon-capped
 * window, and available-vs-required working minutes.
 */
function reportWith(opts: {
  avail: number;
  status?: 'available' | 'partial' | 'blocked';
  blocking?: BlockingTaskDetail[];
  note?: string | null;
  windowCappedByHorizon?: boolean;
  requiredMinutes?: number;
}): InfeasibilityReport {
  const { avail, status = 'partial', blocking = [], note = null, windowCappedByHorizon, requiredMinutes } = opts;
  return {
    taskKey: 'T', chainKey: 'C', reason: '', bottleneckSlot: 'GRANT',
    conflictType: 'dependency', conflictTypeReason: '',
    slots: [{
      slotIndex: 0, slotLabel: 'GRANT', isPrimary: true, status,
      bestAvailableMinutes: avail, isBottleneck: true,
      resources: [{
        resourceKey: '41', resourceName: 'GRANT',
        availableMinutes: avail, totalWindowMinutes: 15180, status, blockingTasks: blocking, note,
      }],
    }],
    combosGenerated: 0, combosSurvivedPropagation: 0, combosPassedAssignment: 0,
    windowCappedByHorizon, requiredMinutes,
  };
}

const blocker: BlockingTaskDetail = { taskKey: 'X-1', taskName: 'X-1', chainKey: 'X', startW: 0, endW: 100 };

describe('classifyConflict (detection-time)', () => {
  it('HORIZON: window capped by horizon + insufficient hours + no contention (the F-16 case)', () => {
    // GRANT has 52h available, task needs 96h, window runs into the horizon, nothing else contends.
    const c = classifyConflict(reportWith({ avail: 52 * 60, requiredMinutes: 96 * 60, windowCappedByHorizon: true }));
    expect(c.type).toBe('horizon');
  });

  it('AVAILABILITY: insufficient hours + no contention but NOT horizon-capped', () => {
    const c = classifyConflict(reportWith({ avail: 52 * 60, requiredMinutes: 96 * 60, windowCappedByHorizon: false }));
    expect(c.type).toBe('availability');
  });

  it('CAPACITY: a real bottleneck — other tasks are consuming the resource', () => {
    const c = classifyConflict(reportWith({ avail: 30, status: 'partial', blocking: [blocker], windowCappedByHorizon: true, requiredMinutes: 96 * 60 }));
    expect(c.type).toBe('capacity'); // contention wins, even when horizon-capped
  });

  it('AVAILABILITY: fully off-shift (zero availability, nothing blocking)', () => {
    const c = classifyConflict(reportWith({ avail: 0, status: 'blocked', note: 'Off shift' }));
    expect(c.type).toBe('availability');
  });

  it('does NOT label a no-contention shortfall as capacity (the bug)', () => {
    // No blockingTasks anywhere → must never be 'capacity'.
    const c = classifyConflict(reportWith({ avail: 100, requiredMinutes: 96 * 60 }));
    expect(c.type).not.toBe('capacity');
  });
});
