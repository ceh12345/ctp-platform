import { describe, it, expect } from 'vitest';
import { CTPInterval, CTPDuration, CTPAssignment, CTPRunRate } from '../../Models/Core/window';
import { CTPDurationConstants, CTPAssignmentConstants } from '../../Models/Core/constants';

describe('CTPInterval', () => {
  it('constructor sets startW, endW, qty', () => {
    const i = new CTPInterval(10, 100, 5);
    expect(i.startW).toBe(10);
    expect(i.endW).toBe(100);
    expect(i.qty).toBe(5);
  });

  it('constructor defaults qty to 1.0', () => {
    const i = new CTPInterval(0, 10);
    expect(i.qty).toBe(1.0);
  });

  it('constructor with no args defaults to zeros', () => {
    const i = new CTPInterval();
    expect(i.startW).toBe(0);
    expect(i.endW).toBe(0);
    expect(i.qty).toBe(1.0);
  });

  it('duration() returns endW - startW', () => {
    const i = new CTPInterval(10, 50);
    expect(i.duration()).toBe(40);
  });

  it('duration() with zero-length interval returns 0', () => {
    const i = new CTPInterval(10, 10);
    expect(i.duration()).toBe(0);
  });

  it('set() updates values and saves originals', () => {
    const i = new CTPInterval(0, 10, 1);
    i.set(100, 200, 5);
    expect(i.startW).toBe(100);
    expect(i.endW).toBe(200);
    expect(i.qty).toBe(5);
  });

  it('reset() reverts to original values', () => {
    const i = new CTPInterval(0, 10, 1);
    i.set(100, 200, 5);
    // Modify current values
    i.startW = 999;
    i.endW = 999;
    i.qty = 999;
    i.reset();
    expect(i.startW).toBe(100);
    expect(i.endW).toBe(200);
    expect(i.qty).toBe(5);
  });

  it('copy() creates independent copy with all fields', () => {
    const a = new CTPInterval(10, 20, 3);
    a.runRate = 2.5;
    a.flowLeft = false;
    const b = new CTPInterval();
    b.copy(a);
    expect(b.startW).toBe(10);
    expect(b.endW).toBe(20);
    expect(b.qty).toBe(3);
    expect(b.runRate).toBe(2.5);
    expect(b.flowLeft).toBe(false);
    // Modifying b doesn't affect a
    b.startW = 999;
    expect(a.startW).toBe(10);
  });

  it('hasQty() returns true when qty is set', () => {
    const i = new CTPInterval(0, 10, 5);
    expect(i.hasQty()).toBe(true);
  });

  it('hasQty() returns false when qty is null', () => {
    const i = new CTPInterval(0, 10);
    i.qty = null;
    expect(i.hasQty()).toBe(false);
  });

  it('runRateQty() returns duration * runRate', () => {
    const i = new CTPInterval(0, 100, 1);
    i.runRate = 2.0;
    expect(i.runRateQty()).toBe(200);
  });

  it('runRateQty() returns 0 when runRate is null', () => {
    const i = new CTPInterval(0, 100, 1);
    expect(i.runRateQty()).toBe(0);
  });
});

describe('CTPDuration', () => {
  it('constructor sets duration and default type', () => {
    const d = new CTPDuration(3600, 1);
    expect(d.duration()).toBe(3600);
    expect(d.qty).toBe(1);
    expect(d.durationType).toBe(CTPDurationConstants.FIXED_DURATION);
  });

  it('handles FIXED_RUN_RATE type — sets runRate to qty', () => {
    const d = new CTPDuration(3600, 5, CTPDurationConstants.FIXED_RUN_RATE);
    expect(d.durationType).toBe(CTPDurationConstants.FIXED_RUN_RATE);
    expect(d.runRate).toBe(5);
  });

  it('handles FLOAT_DURATION type', () => {
    const d = new CTPDuration(7200, 2, CTPDurationConstants.FLOAT_DURATION);
    expect(d.durationType).toBe(CTPDurationConstants.FLOAT_DURATION);
  });

  it('type is DURATION assignment type', () => {
    const d = new CTPDuration(100);
    expect(d.type).toBe(CTPAssignmentConstants.DURATION);
  });
});

describe('CTPRunRate', () => {
  it('constructor sets runRate', () => {
    const r = new CTPRunRate(0, 100, 5, 2.5);
    expect(r.runRate).toBe(2.5);
    expect(r.qty).toBe(5);
  });
});

describe('CTPAssignment', () => {
  it('defaults to PROCESS type with empty name', () => {
    const a = new CTPAssignment(0, 100, 1);
    expect(a.type).toBe(CTPAssignmentConstants.PROCESS);
    expect(a.name).toBe('');
  });
});
