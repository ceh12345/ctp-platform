import { IStagingPointer } from './staging-pointer.interface';
import { JunctionPointer } from './junction-pointer';
import { SymlinkPointer } from './symlink-pointer';

export function createPointer(linkPath: string): IStagingPointer {
  return process.platform === 'win32'
    ? new JunctionPointer(linkPath)
    : new SymlinkPointer(linkPath);
}
