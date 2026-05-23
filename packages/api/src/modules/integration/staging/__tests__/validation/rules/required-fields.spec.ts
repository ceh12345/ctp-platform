import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequiredFieldsRule } from '../../../validation/rules/required-fields';
import { makeRawDir, rmDir, writeEntity } from '../test-fixtures';

describe('RequiredFieldsRule', () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    await Promise.all(dirs.map(rmDir));
  });

  it('passes when all required keys present', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'tasks', [{ WorkOrderCode: 'WO1', OperationCode: 'OP1' }]);
    await writeEntity(dir, 'orders', [{ JobCode: 'J1' }]);
    await writeEntity(dir, 'resources', [{ Code: 'R1' }]);

    const result = await new RequiredFieldsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('fails when a record is missing a required key', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'tasks', [{ WorkOrderCode: 'WO1' }]); // missing OperationCode

    const result = await new RequiredFieldsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(false);
    const details = result.details as { violations: Array<{ missing: string[] }> };
    expect(details.violations[0].missing).toContain('OperationCode');
  });

  it('handles missing entity files (treated as zero records)', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    const result = await new RequiredFieldsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('caps violation details at 50 but reports total', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    const bad = Array.from({ length: 100 }, () => ({ WorkOrderCode: 'WO1' })); // all missing OperationCode
    await writeEntity(dir, 'tasks', bad);

    const result = await new RequiredFieldsRule().check({ rawDir: dir, previousRawDir: null });
    const details = result.details as { violations: unknown[]; totalViolations: number };
    expect(details.violations.length).toBe(50);
    expect(details.totalViolations).toBe(100);
  });
});
