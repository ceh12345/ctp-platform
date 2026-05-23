import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordCountPlausibilityRule } from '../../../validation/rules/record-count-plausibility';
import { makeRawDir, rmDir, writeEntity } from '../test-fixtures';

describe('RecordCountPlausibilityRule', () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    await Promise.all(dirs.map(rmDir));
  });

  it('passes when all entities have records', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'salesOrderDetailEntity', [{ OrderCode: 'O1' }]);
    await writeEntity(dir, 'machineAndRessourceEntity', [{ ResourceCode: 'M1' }]);

    const result = await new RecordCountPlausibilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('passes on first sync when at least one entity is populated', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'orders', []);
    await writeEntity(dir, 'resources', [{ MachineCode: 'M1' }]);

    const result = await new RecordCountPlausibilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('fails on first sync when every entity is empty', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'orders', []);
    await writeEntity(dir, 'resources', []);

    const result = await new RecordCountPlausibilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/zero records/);
  });

  it('fails when an entity drops to zero compared to previous', async () => {
    const dir = await makeRawDir();
    const prev = await makeRawDir();
    dirs.push(dir, prev);
    await writeEntity(prev, 'salesOrderDetailEntity', [{ OrderCode: 'O1' }, { OrderCode: 'O2' }]);
    await writeEntity(dir, 'salesOrderDetailEntity', []);

    const result = await new RecordCountPlausibilityRule().check({ rawDir: dir, previousRawDir: prev });
    expect(result.ok).toBe(false);
  });

  it('annotates >10x drift but does not fail', async () => {
    const dir = await makeRawDir();
    const prev = await makeRawDir();
    dirs.push(dir, prev);
    await writeEntity(prev, 'salesOrderDetailEntity', [{ OrderCode: 'O1' }]);
    const big = Array.from({ length: 100 }, (_, i) => ({ OrderCode: `O${i}` }));
    await writeEntity(dir, 'salesOrderDetailEntity', big);

    const result = await new RecordCountPlausibilityRule().check({ rawDir: dir, previousRawDir: prev });
    expect(result.ok).toBe(true);
    const details = result.details as { drift?: unknown[] };
    expect(details.drift).toBeDefined();
  });

  it('fails when raw dir is empty', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    const result = await new RecordCountPlausibilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(false);
  });
});
