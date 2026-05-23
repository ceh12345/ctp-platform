import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrossEntityRefsRule } from '../../../validation/rules/cross-entity-refs';
import { makeRawDir, rmDir, writeEntity } from '../test-fixtures';

describe('CrossEntityRefsRule', () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    await Promise.all(dirs.map(rmDir));
  });

  it('passes when every task ref resolves to a known work order', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'workOrderWithAdvancedInformationViewEntity', [
      { WorkOrderCode: 'WO1' },
      { WorkOrderCode: 'WO2' },
    ]);
    await writeEntity(dir, 'productionTaskWithAdvancedInfoViewEntity', [
      { WorkOrderCode: 'WO1', TaskCode: 'T1' },
      { WorkOrderCode: 'WO2', TaskCode: 'T2' },
    ]);

    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('fails when a task references an unknown work order', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'workOrderWithAdvancedInformationViewEntity', [{ WorkOrderCode: 'WO1' }]);
    await writeEntity(dir, 'productionTaskWithAdvancedInfoViewEntity', [
      { WorkOrderCode: 'WO1', TaskCode: 'T1' },
      { WorkOrderCode: 'WO_GHOST', TaskCode: 'T2' },
    ]);

    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(false);
    const details = result.details as { dangling: Array<{ workOrderCode: unknown }> };
    expect(details.dangling[0].workOrderCode).toBe('WO_GHOST');
  });

  it('passes (skips) when tasks or work orders are absent', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('skips tasks with null/undefined WorkOrderCode', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'workOrderWithAdvancedInformationViewEntity', [{ WorkOrderCode: 'WO1' }]);
    await writeEntity(dir, 'productionTaskWithAdvancedInfoViewEntity', [
      { WorkOrderCode: null, TaskCode: 'T1' },
      { TaskCode: 'T2' },
      { WorkOrderCode: 'WO1', TaskCode: 'T3' },
    ]);

    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });
});
