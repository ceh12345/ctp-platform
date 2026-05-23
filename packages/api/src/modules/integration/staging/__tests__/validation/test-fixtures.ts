import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export async function makeRawDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `staging-val-${crypto.randomUUID()}`);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeEntity(dir: string, entity: string, records: unknown[]): Promise<void> {
  await fs.promises.writeFile(path.join(dir, `${entity}.json`), JSON.stringify(records, null, 2));
}

export async function rmDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true });
}
