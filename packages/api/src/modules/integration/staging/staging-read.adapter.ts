import * as fs from 'fs';
import * as path from 'path';
import { IDataAdapter, IRawDataPayload } from '../adapter.interface';
import { rawDir as rawDirOf } from './staging-paths';
import { StagingService } from './staging.service';

export class StagingReadAdapter implements IDataAdapter {
  readonly adapterType = 'staging-read';

  constructor(
    private readonly staging: StagingService,
    private readonly tenant: string,
  ) {}

  async fetchRawData(): Promise<IRawDataPayload> {
    const current = await this.staging.current(this.tenant);
    if (current == null) {
      throw new Error(`StagingReadAdapter: no current snapshot for tenant '${this.tenant}'`);
    }
    const raw = rawDirOf(current);

    return {
      resources: await readArray(raw, 'resources'),
      tasks: await readArray(raw, 'tasks'),
      calendars: await readArray(raw, 'calendars'),
      stateChanges: await readArray(raw, 'stateChanges'),
      products: await readArray(raw, 'products'),
      orders: await readArray(raw, 'orders'),
      materials: await readArray(raw, 'materials'),
      processes: await readArray(raw, 'processes'),
      cadences: await readArray(raw, 'cadences'),
      uomConversions: await readSingle(raw, 'uomConversions'),
    };
  }
}

async function readArray(rawDir: string, entity: string): Promise<unknown[]> {
  try {
    const text = await fs.promises.readFile(path.join(rawDir, `${entity}.json`), 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function readSingle(rawDir: string, entity: string): Promise<unknown | null> {
  try {
    const text = await fs.promises.readFile(path.join(rawDir, `${entity}.json`), 'utf8');
    const parsed = JSON.parse(text);
    // SyncOrchestrator wraps uomConversions in a 1-element array; unwrap on read.
    return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
