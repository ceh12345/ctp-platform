import { CTPDuration } from './window';
import { CTPDurationConstants } from './constants';

/**
 * Interprets a CTPDuration's durationType to answer scheduling questions:
 * - How much "work" must be consumed?
 * - Is consumption measured by runRate?
 * - Does a single interval need to hold all the work (FIXED types)?
 * - Is this a static/pass-through duration?
 */
export interface IDurationPolicy {
  /** How much "work" must be consumed — duration or runRate qty */
  consumed(d: CTPDuration): number;

  /** Whether consumption is measured by runRate instead of time */
  byRunRate(d: CTPDuration): boolean;

  /** Whether runRate is required but missing (null) */
  isMissingRunRate(d: CTPDuration): boolean;

  /** Whether this is a static duration (no interval walking needed) */
  isStatic(d: CTPDuration): boolean;

  /** Whether a single interval must hold all consumed (FIXED types reset on undersized intervals) */
  isFixed(d: CTPDuration): boolean;
}

export class DurationPolicy implements IDurationPolicy {
  consumed(d: CTPDuration): number {
    if (
      d.durationType === CTPDurationConstants.FIXED_RUN_RATE ||
      d.durationType === CTPDurationConstants.FLOAT_RUN_RATE
    ) {
      return d.runRate ?? 0;
    }
    return d.duration();
  }

  byRunRate(d: CTPDuration): boolean {
    return (
      d.durationType === CTPDurationConstants.FIXED_RUN_RATE ||
      d.durationType === CTPDurationConstants.FLOAT_RUN_RATE
    );
  }

  isMissingRunRate(d: CTPDuration): boolean {
    if (
      d.durationType === CTPDurationConstants.FIXED_RUN_RATE ||
      d.durationType === CTPDurationConstants.FLOAT_RUN_RATE
    ) {
      return d.runRate === null;
    }
    return false;
  }

  isStatic(d: CTPDuration): boolean {
    return d.durationType === CTPDurationConstants.STATIC;
  }

  isFixed(d: CTPDuration): boolean {
    return (
      d.durationType === CTPDurationConstants.FIXED_DURATION ||
      d.durationType === CTPDurationConstants.FIXED_RUN_RATE
    );
  }
}
