import { describe, it, expect } from 'vitest';
import { CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPTaskResource } from '../../Models/Entities/task';
import { CTPResourcePreferenceModeConstants } from '../../Models/Core/constants';

function makePref(key: string, rank: number, mode?: string): CTPResourcePreference {
  const p = new CTPResourcePreference(key, rank);
  if (mode) p.mode = mode;
  return p;
}

function makeTaskResource(...prefs: CTPResourcePreference[]): CTPTaskResource {
  const tr = new CTPTaskResource('RES', true, 0);
  tr.preferences = prefs;
  return tr;
}

describe('CTPResourcePreference mode', () => {
  it('defaults to AVAILABLE', () => {
    const p = new CTPResourcePreference('CNC-01', 1);
    expect(p.mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);
  });

  it('accepts mode in constructor', () => {
    const p = new CTPResourcePreference('CNC-01', 1, 'PREFERRED');
    expect(p.mode).toBe('PREFERRED');
  });
});

describe('CTPTaskResource.getEffectivePreferences', () => {
  it('returns all when no overrides (all AVAILABLE)', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1),
      makePref('CNC-02', 2),
      makePref('CNC-03', 3),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(3);
    expect(result.map(p => p.resourceKey)).toEqual(['CNC-01', 'CNC-02', 'CNC-03']);
  });

  it('EXCLUDED removes resource from list', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1, 'EXCLUDED'),
      makePref('CNC-02', 2),
      makePref('CNC-03', 3),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(2);
    expect(result.map(p => p.resourceKey)).toEqual(['CNC-02', 'CNC-03']);
  });

  it('REQUIRED filters to only required resources', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1),
      makePref('CNC-02', 2, 'REQUIRED'),
      makePref('CNC-03', 3),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(1);
    expect(result[0].resourceKey).toBe('CNC-02');
  });

  it('PREFERRED sorts to top before AVAILABLE', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1),
      makePref('CNC-02', 2),
      makePref('CNC-03', 3, 'PREFERRED'),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(3);
    expect(result[0].resourceKey).toBe('CNC-03');  // PREFERRED first
    expect(result[1].resourceKey).toBe('CNC-01');  // AVAILABLE by rank
    expect(result[2].resourceKey).toBe('CNC-02');
  });

  it('all EXCLUDED returns empty list', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1, 'EXCLUDED'),
      makePref('CNC-02', 2, 'EXCLUDED'),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(0);
  });

  it('EXCLUDED + PREFERRED combo works correctly', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1, 'EXCLUDED'),
      makePref('CNC-02', 2, 'PREFERRED'),
      makePref('CNC-03', 3),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(2);
    expect(result[0].resourceKey).toBe('CNC-02');  // PREFERRED first
    expect(result[1].resourceKey).toBe('CNC-03');  // AVAILABLE
  });

  it('multiple REQUIRED keeps only required, sorted by rank', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1),
      makePref('CNC-02', 2, 'REQUIRED'),
      makePref('CNC-03', 3, 'REQUIRED'),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(2);
    expect(result[0].resourceKey).toBe('CNC-02');  // rank 2
    expect(result[1].resourceKey).toBe('CNC-03');  // rank 3
  });

  it('REQUIRED + EXCLUDED: excludes first, then requires', () => {
    const tr = makeTaskResource(
      makePref('CNC-01', 1, 'EXCLUDED'),
      makePref('CNC-02', 2, 'REQUIRED'),
      makePref('CNC-03', 3),
    );
    const result = tr.getEffectivePreferences();
    expect(result).toHaveLength(1);
    expect(result[0].resourceKey).toBe('CNC-02');
  });
});
