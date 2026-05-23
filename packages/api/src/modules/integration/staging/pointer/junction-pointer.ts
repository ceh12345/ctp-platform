import * as fs from 'fs';
import { IStagingPointer } from './staging-pointer.interface';

export class JunctionPointer implements IStagingPointer {
  constructor(private readonly linkPath: string) {}

  async point(targetDir: string): Promise<void> {
    const stagingPath = `${this.linkPath}.new`;
    await this.removeIfExists(stagingPath);
    await fs.promises.symlink(targetDir, stagingPath, 'junction');
    try {
      await fs.promises.rename(stagingPath, this.linkPath);
    } catch (err) {
      // Windows fs.rename can refuse to replace an existing junction in rare cases
      // (locked directory, antivirus). Fall back to unlink-then-rename. The gap is
      // a few microseconds; documented limitation, not a correctness issue.
      if ((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'EEXIST') {
        await this.removeIfExists(this.linkPath);
        await fs.promises.rename(stagingPath, this.linkPath);
      } else {
        throw err;
      }
    }
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
      return st.isSymbolicLink() || st.isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  private async removeIfExists(p: string): Promise<void> {
    try {
      await fs.promises.unlink(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code === 'EPERM' || code === 'EISDIR') {
        await fs.promises.rmdir(p);
        return;
      }
      throw err;
    }
  }
}
