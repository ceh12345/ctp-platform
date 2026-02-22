import { describe, it, expect } from 'vitest';
import { SchedulingLandscape } from '../../Models/Entities/landscape';
import { CTPTask, CTPTasks, CTPTaskResource, CTPTaskResourceList } from '../../Models/Entities/task';
import { CTPResourcePreference } from '../../Models/Entities/resource';
import { CTPResourcePreferenceModeConstants } from '../../Models/Core/constants';

function buildLandscape(): SchedulingLandscape {
  const landscape = new SchedulingLandscape();

  // Create a task with 3 resource preferences
  const task = new CTPTask('PROCESS', 'Mill Housing', 'OP-001');
  const tr = new CTPTaskResource('CNC', true, 0);
  tr.preferences = [
    new CTPResourcePreference('CNC-01', 1),
    new CTPResourcePreference('CNC-02', 2),
    new CTPResourcePreference('CNC-03', 3),
  ];
  task.capacityResources = new CTPTaskResourceList();
  task.capacityResources.add(tr);

  // Second task
  const task2 = new CTPTask('PROCESS', 'Bore Cylinder', 'OP-002');
  const tr2 = new CTPTaskResource('CNC', true, 0);
  tr2.preferences = [
    new CTPResourcePreference('CNC-01', 1),
    new CTPResourcePreference('CNC-02', 2),
  ];
  task2.capacityResources = new CTPTaskResourceList();
  task2.capacityResources.add(tr2);

  landscape.tasks = new CTPTasks();
  landscape.tasks.addEntity(task);
  landscape.tasks.addEntity(task2);

  return landscape;
}

describe('SchedulingLandscape.applyResourcePreferenceOverrides', () => {
  it('sets mode on matching preference', () => {
    const landscape = buildLandscape();
    landscape.applyResourcePreferenceOverrides({
      'OP-001': { 'CNC-01': 'EXCLUDED' },
    });

    const task = landscape.tasks!.getEntity('OP-001')!;
    const prefs = task.capacityResources.at(0)!.preferences;
    expect(prefs[0].mode).toBe('EXCLUDED');
    expect(prefs[1].mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);
    expect(prefs[2].mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);
  });

  it('sets multiple modes on same task', () => {
    const landscape = buildLandscape();
    landscape.applyResourcePreferenceOverrides({
      'OP-001': { 'CNC-01': 'EXCLUDED', 'CNC-02': 'PREFERRED' },
    });

    const prefs = landscape.tasks!.getEntity('OP-001')!.capacityResources.at(0)!.preferences;
    expect(prefs[0].mode).toBe('EXCLUDED');
    expect(prefs[1].mode).toBe('PREFERRED');
    expect(prefs[2].mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);
  });

  it('applies to multiple tasks independently', () => {
    const landscape = buildLandscape();
    landscape.applyResourcePreferenceOverrides({
      'OP-001': { 'CNC-01': 'EXCLUDED' },
      'OP-002': { 'CNC-02': 'REQUIRED' },
    });

    const prefs1 = landscape.tasks!.getEntity('OP-001')!.capacityResources.at(0)!.preferences;
    expect(prefs1[0].mode).toBe('EXCLUDED');
    expect(prefs1[1].mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);

    const prefs2 = landscape.tasks!.getEntity('OP-002')!.capacityResources.at(0)!.preferences;
    expect(prefs2[0].mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);
    expect(prefs2[1].mode).toBe('REQUIRED');
  });

  it('unknown task key is silently skipped', () => {
    const landscape = buildLandscape();
    landscape.applyResourcePreferenceOverrides({
      'DOES-NOT-EXIST': { 'CNC-01': 'EXCLUDED' },
    });
    // Should not throw — verify existing tasks unchanged
    const prefs = landscape.tasks!.getEntity('OP-001')!.capacityResources.at(0)!.preferences;
    expect(prefs[0].mode).toBe(CTPResourcePreferenceModeConstants.AVAILABLE);
  });

  it('unknown resource key within task leaves preferences unchanged', () => {
    const landscape = buildLandscape();
    landscape.applyResourcePreferenceOverrides({
      'OP-001': { 'UNKNOWN-RES': 'EXCLUDED' },
    });
    const prefs = landscape.tasks!.getEntity('OP-001')!.capacityResources.at(0)!.preferences;
    expect(prefs.every(p => p.mode === CTPResourcePreferenceModeConstants.AVAILABLE)).toBe(true);
  });

  it('getEffectivePreferences reflects applied overrides', () => {
    const landscape = buildLandscape();
    landscape.applyResourcePreferenceOverrides({
      'OP-001': { 'CNC-01': 'EXCLUDED', 'CNC-03': 'PREFERRED' },
    });

    const effective = landscape.tasks!.getEntity('OP-001')!.capacityResources.at(0)!.getEffectivePreferences();
    expect(effective).toHaveLength(2);
    expect(effective[0].resourceKey).toBe('CNC-03');  // PREFERRED first
    expect(effective[1].resourceKey).toBe('CNC-02');  // AVAILABLE
  });
});
