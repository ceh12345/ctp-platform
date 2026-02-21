import { describe, it, expect } from 'vitest';
import { DurationPolicy } from '../../Models/Core/duration-policy';
import { CTPDuration } from '../../Models/Core/window';
import { CTPDurationConstants } from '../../Models/Core/constants';

const policy = new DurationPolicy();

function makeDur(duration: number, qty?: number, type?: number): CTPDuration {
  return new CTPDuration(duration, qty, type);
}

describe('DurationPolicy', () => {
  describe('consumed', () => {
    it('FIXED_DURATION returns duration()', () => {
      const d = makeDur(100, 1, CTPDurationConstants.FIXED_DURATION);
      expect(policy.consumed(d)).toBe(100);
    });

    it('FLOAT_DURATION returns duration()', () => {
      const d = makeDur(50, 1, CTPDurationConstants.FLOAT_DURATION);
      expect(policy.consumed(d)).toBe(50);
    });

    it('UNTRACKED returns duration()', () => {
      const d = makeDur(30, 1, CTPDurationConstants.UNTRACKED);
      expect(policy.consumed(d)).toBe(30);
    });

    it('STATIC returns duration()', () => {
      const d = makeDur(60, 1, CTPDurationConstants.STATIC);
      expect(policy.consumed(d)).toBe(60);
    });

    it('FIXED_RUN_RATE returns runRate', () => {
      const d = makeDur(100, 25, CTPDurationConstants.FIXED_RUN_RATE);
      expect(policy.consumed(d)).toBe(25);
    });

    it('FLOAT_RUN_RATE returns runRate', () => {
      const d = makeDur(100, 40, CTPDurationConstants.FLOAT_RUN_RATE);
      expect(policy.consumed(d)).toBe(40);
    });

    it('FIXED_RUN_RATE with null runRate returns 0', () => {
      const d = new CTPDuration(100, undefined, CTPDurationConstants.FIXED_RUN_RATE);
      expect(policy.consumed(d)).toBe(0);
    });

    it('zero duration returns 0', () => {
      const d = makeDur(0, 1, CTPDurationConstants.FIXED_DURATION);
      expect(policy.consumed(d)).toBe(0);
    });
  });

  describe('byRunRate', () => {
    it('FIXED_DURATION → false', () => {
      expect(policy.byRunRate(makeDur(100, 1, CTPDurationConstants.FIXED_DURATION))).toBe(false);
    });

    it('FLOAT_DURATION → false', () => {
      expect(policy.byRunRate(makeDur(100, 1, CTPDurationConstants.FLOAT_DURATION))).toBe(false);
    });

    it('STATIC → false', () => {
      expect(policy.byRunRate(makeDur(100, 1, CTPDurationConstants.STATIC))).toBe(false);
    });

    it('UNTRACKED → false', () => {
      expect(policy.byRunRate(makeDur(100, 1, CTPDurationConstants.UNTRACKED))).toBe(false);
    });

    it('FIXED_RUN_RATE → true', () => {
      expect(policy.byRunRate(makeDur(100, 25, CTPDurationConstants.FIXED_RUN_RATE))).toBe(true);
    });

    it('FLOAT_RUN_RATE → true', () => {
      expect(policy.byRunRate(makeDur(100, 40, CTPDurationConstants.FLOAT_RUN_RATE))).toBe(true);
    });
  });

  describe('isMissingRunRate', () => {
    it('FIXED_DURATION → false (runRate not required)', () => {
      expect(policy.isMissingRunRate(makeDur(100, 1, CTPDurationConstants.FIXED_DURATION))).toBe(false);
    });

    it('FIXED_RUN_RATE with runRate set → false', () => {
      expect(policy.isMissingRunRate(makeDur(100, 25, CTPDurationConstants.FIXED_RUN_RATE))).toBe(false);
    });

    it('FIXED_RUN_RATE with null runRate → true', () => {
      const d = new CTPDuration(100, undefined, CTPDurationConstants.FIXED_RUN_RATE);
      expect(policy.isMissingRunRate(d)).toBe(true);
    });

    it('FLOAT_RUN_RATE with null runRate → true', () => {
      const d = new CTPDuration(100, undefined, CTPDurationConstants.FLOAT_RUN_RATE);
      expect(policy.isMissingRunRate(d)).toBe(true);
    });
  });

  describe('isStatic', () => {
    it('STATIC → true', () => {
      expect(policy.isStatic(makeDur(100, 1, CTPDurationConstants.STATIC))).toBe(true);
    });

    it('FIXED_DURATION → false', () => {
      expect(policy.isStatic(makeDur(100, 1, CTPDurationConstants.FIXED_DURATION))).toBe(false);
    });

    it('FLOAT_DURATION → false', () => {
      expect(policy.isStatic(makeDur(100, 1, CTPDurationConstants.FLOAT_DURATION))).toBe(false);
    });
  });

  describe('isFixed', () => {
    it('FIXED_DURATION → true', () => {
      expect(policy.isFixed(makeDur(100, 1, CTPDurationConstants.FIXED_DURATION))).toBe(true);
    });

    it('FIXED_RUN_RATE → true', () => {
      expect(policy.isFixed(makeDur(100, 25, CTPDurationConstants.FIXED_RUN_RATE))).toBe(true);
    });

    it('FLOAT_DURATION → false', () => {
      expect(policy.isFixed(makeDur(100, 1, CTPDurationConstants.FLOAT_DURATION))).toBe(false);
    });

    it('FLOAT_RUN_RATE → false', () => {
      expect(policy.isFixed(makeDur(100, 40, CTPDurationConstants.FLOAT_RUN_RATE))).toBe(false);
    });

    it('STATIC → false', () => {
      expect(policy.isFixed(makeDur(100, 1, CTPDurationConstants.STATIC))).toBe(false);
    });

    it('UNTRACKED → false', () => {
      expect(policy.isFixed(makeDur(100, 1, CTPDurationConstants.UNTRACKED))).toBe(false);
    });
  });
});
