import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IStagingPointer } from '../../pointer/staging-pointer.interface';

export function runPointerTests(
  label: string,
  factory: (linkPath: string) => IStagingPointer,
): void {
  describe(label, () => {
    let workDir: string;
    let pointer: IStagingPointer;
    let linkPath: string;

    beforeEach(async () => {
      workDir = path.join(os.tmpdir(), `staging-ptr-${crypto.randomUUID()}`);
      await fs.promises.mkdir(workDir, { recursive: true });
      linkPath = path.join(workDir, 'current');
      pointer = factory(linkPath);
    });

    afterEach(async () => {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    });

    it('exists() is false before point()', async () => {
      expect(await pointer.exists()).toBe(false);
    });

    it('resolve() returns null before point()', async () => {
      expect(await pointer.resolve()).toBeNull();
    });

    it('point() then resolve() returns absolute target', async () => {
      const target = path.join(workDir, 'snap-a');
      await fs.promises.mkdir(target);
      await pointer.point(target);
      const resolved = await pointer.resolve();
      expect(resolved).not.toBeNull();
      expect(await fs.promises.realpath(resolved!)).toBe(await fs.promises.realpath(target));
    });

    it('exists() is true after point()', async () => {
      const target = path.join(workDir, 'snap-a');
      await fs.promises.mkdir(target);
      await pointer.point(target);
      expect(await pointer.exists()).toBe(true);
    });

    it('point() over existing pointer replaces target', async () => {
      const a = path.join(workDir, 'snap-a');
      const b = path.join(workDir, 'snap-b');
      await fs.promises.mkdir(a);
      await fs.promises.mkdir(b);
      await pointer.point(a);
      await pointer.point(b);
      const resolved = await pointer.resolve();
      expect(await fs.promises.realpath(resolved!)).toBe(await fs.promises.realpath(b));
    });

    it('concurrent point() calls leave pointer in valid state', async () => {
      const a = path.join(workDir, 'snap-a');
      const b = path.join(workDir, 'snap-b');
      await fs.promises.mkdir(a);
      await fs.promises.mkdir(b);
      const results = await Promise.allSettled([pointer.point(a), pointer.point(b)]);
      // At least one should succeed.
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const resolved = await pointer.resolve();
      expect(resolved).not.toBeNull();
      const real = await fs.promises.realpath(resolved!);
      expect([await fs.promises.realpath(a), await fs.promises.realpath(b)]).toContain(real);
    });
  });
}
