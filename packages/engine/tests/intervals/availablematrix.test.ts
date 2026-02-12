import { describe, it, expect } from 'vitest';
import { AvailableMatrix } from '../../Models/Intervals/availablematrix';
import { CTPDurationConstants } from '../../Models/Core/constants';
import { makeAvailable } from '../helpers/builders';

describe('AvailableMatrix', () => {
  it('constructor creates 3 available times slots (FIXED, FLOAT, UNTRACKED)', () => {
    const m = new AvailableMatrix('test');
    expect(m.availableTimes.length).toBe(3);
    expect(m.name).toBe('test');
    expect(m.recalc).toBe(true);
  });

  it('clear() with no args clears all slots and state changes', () => {
    const m = new AvailableMatrix();
    // Verify clearing doesn't throw on fresh matrix
    m.clear();
    expect(m.availableTimes.length).toBe(3);
  });

  it('clear(0) clears only FIXED slot (index 0)', () => {
    const m = new AvailableMatrix();
    // Should not throw — this was a bug (i > 0 instead of i >= 0)
    m.clear(0);
    expect(m.availableTimes.length).toBe(3);
  });

  it('clear(1) clears only FLOAT slot', () => {
    const m = new AvailableMatrix();
    m.clear(1);
    expect(m.availableTimes.length).toBe(3);
  });

  it('index(0) returns FIXED slot', () => {
    const m = new AvailableMatrix();
    const slot = m.index(CTPDurationConstants.FIXED_DURATION);
    expect(slot).not.toBeNull();
  });

  it('index(2) returns UNTRACKED slot', () => {
    const m = new AvailableMatrix();
    const slot = m.index(CTPDurationConstants.UNTRACKED);
    expect(slot).not.toBeNull();
  });

  it('index(-1) returns null', () => {
    const m = new AvailableMatrix();
    expect(m.index(-1)).toBeNull();
  });

  it('index(3) returns null (out of bounds)', () => {
    const m = new AvailableMatrix();
    expect(m.index(3)).toBeNull();
  });

  it('setOriginal / setAssignments / setAvailable', () => {
    const m = new AvailableMatrix();
    const orig = makeAvailable([{ s: 0, e: 100, q: 5 }]);
    const assignments = makeAvailable([{ s: 10, e: 20, q: 1 }]);
    m.setLists(orig, assignments, null);
    expect(m.staticOriginal).toBe(orig);
    expect(m.staticAssignments).toBe(assignments);
  });

  it('findRunRate returns rate at given time', () => {
    const m = new AvailableMatrix();
    const orig = makeAvailable([{ s: 0, e: 100, q: 5 }]);
    orig.head!.data.runRate = 2.5;
    m.setOriginal(orig);
    const rr = m.findRunRate(50);
    expect(rr).toBe(2.5);
  });

  it('findRunRate returns null when no original', () => {
    const m = new AvailableMatrix();
    expect(m.findRunRate(50)).toBeNull();
  });

  it('setAvailable / revertAvailable restores reference', () => {
    const m = new AvailableMatrix();
    const avail = makeAvailable([{ s: 0, e: 100, q: 5 }]);
    m.setAvailable(avail);
    expect(m.staticAvailable).toBe(avail);
    m.staticAvailable = null;
    m.revertAvailable();
    expect(m.staticAvailable).toBe(avail);
  });
});
