import { describe, it, expect } from 'vitest';
import { CombinationEngine, ResourceCombinationEngine } from '../../Engines/combinationengine';
import { CTPResourcePreference } from '../../Models/Entities/resource';

describe('CombinationEngine', () => {
  const engine = new CombinationEngine();

  it('2x2 produces 4 combinations', () => {
    const result = engine.combinations([['A', 'B'], ['C', 'D']]);
    expect(result.length).toBe(4);
    expect(result).toEqual([
      ['A', 'C'],
      ['A', 'D'],
      ['B', 'C'],
      ['B', 'D'],
    ]);
  });

  it('2x3 produces 6 combinations', () => {
    const result = engine.combinations([['A', 'B'], ['C', 'D', 'E']]);
    expect(result.length).toBe(6);
  });

  it('2x3x2 produces 12 combinations', () => {
    const result = engine.combinations([['A', 'B'], ['C', 'D', 'E'], ['F', 'G']]);
    expect(result.length).toBe(12);
  });

  it('single array passes through', () => {
    const result = engine.combinations([['A', 'B', 'C']]);
    expect(result.length).toBe(3);
    expect(result).toEqual([['A'], ['B'], ['C']]);
  });

  it('1x1 produces 1 combination', () => {
    const result = engine.combinations([['A'], ['B']]);
    expect(result.length).toBe(1);
    expect(result).toEqual([['A', 'B']]);
  });

  it('preserves order of elements', () => {
    const result = engine.combinations([['X', 'Y'], ['1', '2', '3']]);
    expect(result[0]).toEqual(['X', '1']);
    expect(result[result.length - 1]).toEqual(['Y', '3']);
  });
});

describe('ResourceCombinationEngine', () => {
  function makePref(key: string, resKey: string): CTPResourcePreference {
    const pref = new CTPResourcePreference();
    pref.key = key;
    pref.resourceKey = resKey;
    return pref;
  }

  it('generates resource preference combinations', () => {
    const engine = new ResourceCombinationEngine();
    const input = [
      [makePref('p1', 'R1'), makePref('p2', 'R2')],
      [makePref('p3', 'R3'), makePref('p4', 'R4')],
    ] as any;
    const result = engine.resourcecombinations(input);
    expect(result.length).toBe(4);
  });

  it('filters duplicate resources when uniqueness=true', () => {
    const engine = new ResourceCombinationEngine();
    const input = [
      [makePref('p1', 'R1'), makePref('p2', 'R2')],
      [makePref('p3', 'R1'), makePref('p4', 'R2')],
    ] as any;
    const result = engine.resourcecombinations(input, true);
    // R1+R1 and R2+R2 filtered out, leaving R1+R2 and R2+R1
    expect(result.length).toBe(2);
    result.forEach((combo) => {
      expect(combo[0].resourceKey).not.toBe(combo[1].resourceKey);
    });
  });

  it('allows duplicates when uniqueness=false', () => {
    const engine = new ResourceCombinationEngine();
    const input = [
      [makePref('p1', 'R1'), makePref('p2', 'R2')],
      [makePref('p3', 'R1'), makePref('p4', 'R2')],
    ] as any;
    const result = engine.resourcecombinations(input, false);
    expect(result.length).toBe(4);
  });

  // CODE-OPTIMIZATION-SPRINT Ticket 14 — str.includes substring false-positive
  //
  // Bug (combinationengine.ts:70): uniqueness check uses `str.includes(key)`
  // against a comma-joined accumulator. When a later resource key is a prefix
  // of an earlier one (e.g. "r1" arriving after "r10," is already in str),
  // includes() reports a false-positive collision and the combo is dropped.
  //
  // Expected to FAIL against current code, PASS after fix replaces the string
  // check with a Set<string>.
  it('treats r1 and r10 as distinct keys (Ticket 14 substring bug)', () => {
    const engine = new ResourceCombinationEngine();
    // Order matters for the bug: longer key first so str = "r10,", then "r1"
    // arrives and falsely matches.
    const input = [
      [makePref('p1', 'r10')],
      [makePref('p2', 'r1')],
    ] as any;
    const result = engine.resourcecombinations(input, true);
    expect(result.length).toBe(1);
    expect(result[0].map((p: any) => p.resourceKey)).toEqual(['r10', 'r1']);
  });
});
