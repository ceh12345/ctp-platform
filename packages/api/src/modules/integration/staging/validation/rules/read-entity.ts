import * as fs from 'fs';
import * as path from 'path';

export async function readEntity(rawDir: string, entity: string): Promise<unknown[]> {
  const file = path.join(rawDir, `${entity}.json`);
  try {
    const text = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function listEntities(rawDir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(rawDir);
    return entries.filter((e) => e.endsWith('.json')).map((e) => e.replace(/\.json$/, ''));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
