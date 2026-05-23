import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DateParseabilityRule } from '../../../validation/rules/date-parseability';
import { makeRawDir, rmDir, writeEntity } from '../test-fixtures';

describe('DateParseabilityRule', () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    await Promise.all(dirs.map(rmDir));
  });

  it('passes when all date fields are parseable', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'someEntity', [
      { StartDate: '2026-05-23T10:00:00Z', EndTime: '2026-05-23T18:00:00Z' },
    ]);
    const result = await new DateParseabilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('flags unparseable date values', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'someEntity', [
      { StartDate: 'not-a-date' },
      { EndTime: 'also-broken' },
    ]);
    const result = await new DateParseabilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(false);
    const details = result.details as { unparseable: unknown[]; total: number };
    expect(details.total).toBe(2);
  });

  it('skips null, undefined, and empty values', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'someEntity', [
      { StartDate: null, EndTime: '' },
      { StartDate: undefined },
    ]);
    const result = await new DateParseabilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });

  it('ignores fields not matching Date/Time suffix', async () => {
    const dir = await makeRawDir();
    dirs.push(dir);
    await writeEntity(dir, 'someEntity', [{ Name: 'not-a-date', Code: 'XYZ' }]);
    const result = await new DateParseabilityRule().check({ rawDir: dir, previousRawDir: null });
    expect(result.ok).toBe(true);
  });
});
