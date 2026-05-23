import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '../../../../');
const STAGING_PATH_FRAGMENT = path.join('integration', 'staging');

async function walkTsFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTsFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('staging module dormancy', () => {
  it('no production code outside staging/ imports from staging/', async () => {
    const allFiles = await walkTsFiles(SRC_ROOT);

    const offenders: { file: string; line: string }[] = [];

    for (const file of allFiles) {
      // Skip files inside the staging module itself
      if (file.includes(STAGING_PATH_FRAGMENT)) continue;

      const content = await fs.promises.readFile(file, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes('import')) continue;
        if (/from\s+['"][^'"]*integration\/staging/.test(line)) {
          offenders.push({ file: path.relative(SRC_ROOT, file), line: line.trim() });
        }
      }
    }

    if (offenders.length > 0) {
      // Helpful diagnostic in the assertion message.
      const summary = offenders.map((o) => `${o.file}: ${o.line}`).join('\n');
      throw new Error(`Staging module is no longer dormant. Importers found:\n${summary}`);
    }
    expect(offenders).toEqual([]);
  });
});
