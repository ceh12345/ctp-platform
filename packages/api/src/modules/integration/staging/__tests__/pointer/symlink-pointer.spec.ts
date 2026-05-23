import { describe, it } from 'vitest';
import { SymlinkPointer } from '../../pointer/symlink-pointer';
import { runPointerTests } from './shared-pointer-tests';

const skip = process.platform === 'win32';

if (skip) {
  describe.skip('SymlinkPointer (skipped on win32)', () => {
    it('skipped', () => undefined);
  });
} else {
  runPointerTests('SymlinkPointer', (linkPath) => new SymlinkPointer(linkPath));
}
