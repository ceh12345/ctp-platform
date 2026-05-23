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

  it('passes when every task ref resolves to a known order', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'orders', [{ JobCode: 'J1' }, { JobCode: 'J2' }]);
    await writeEntity(dir, 'tasks', [
      { JobCode: 'J1', TaskCode: 'T1' },
      { JobCode: 'J2', TaskCode: 'T2' },
    ]);

    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('fails when a task references an unknown order', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'orders', [{ JobCode: 'J1' }]);
    await writeEntity(dir, 'tasks', [
      { JobCode: 'J1', TaskCode: 'T1' },
      { JobCode: 'J_GHOST', TaskCode: 'T2' },
    ]);

    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(false);
    const details = result.details as { dangling: Array<{ ref: unknown }> };
    expect(details.dangling[0].ref).toBe('J_GHOST');
  });

  it('passes (skips) when tasks or orders are absent', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('skips tasks with null/undefined ref field', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'orders', [{ JobCode: 'J1' }]);
    await writeEntity(dir, 'tasks', [
      { JobCode: null, TaskCode: 'T1' },
      { TaskCode: 'T2' },
      { JobCode: 'J1', TaskCode: 'T3' },
    ]);

    const result = await new CrossEntityRefsRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });
});
