import { describe, it } from 'vitest';
import { JunctionPointer } from '../../pointer/junction-pointer';
import { runPointerTests } from './shared-pointer-tests';

const skip = process.platform !== 'win32';

if (skip) {
  describe.skip('JunctionPointer (skipped on non-win32)', () => {
    it('skipped', () => undefined);
  });
} else {
  runPointerTests('JunctionPointer', (linkPath) => new JunctionPointer(linkPath));
}
