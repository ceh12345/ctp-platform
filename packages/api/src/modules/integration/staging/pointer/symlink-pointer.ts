import * as fs from 'fs';
import { IStagingPointer } from './staging-pointer.interface';

export class SymlinkPointer implements IStagingPointer {
  constructor(private readonly linkPath: string) {}

  async point(targetDir: string): Promise<void> {
    const stagingPath = `${this.linkPath}.new`;
    try {
      await fs.promises.unlink(stagingPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.promises.symlink(targetDir, stagingPath, 'dir');
    await fs.promises.rename(stagingPath, this.linkPath);
  }

  async resolve(): Promise<string | null> {
    try {
      return await fs.promises.realpath(this.linkPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(): Promise<boolean> {
    try {
      const st = await fs.promises.lstat(this.linkPath);
      return st.isSymbolicLink();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}
