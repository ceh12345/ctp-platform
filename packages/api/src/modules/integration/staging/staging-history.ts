import * as fs from 'fs';
import * as path from 'path';
import { tenantRoot } from './staging-paths';

export type StagingHistoryEvent =
  | { event: 'sync-started'; adapterType: string; ts: string }
  | { event: 'sync-promoted'; ts: string; recordCounts: Record<string, number> }
  | { event: 'sync-marked-failed'; ts: string; failedRules: string[] }
  | { event: 'sync-force-promoted'; ts: string; failedRules: string[] }
  | { event: 'sync-errored'; ts: string | null; phase: string; error: string }
  | { event: 'seed-started'; sourceDir: string; ts: string }
  | { event: 'orphan-cleanup'; removed: string[] }
  | { event: 'retention-prune'; deleted: string[]; skipped: number };

export const HISTORY_FILE = '_history.log';

export function historyPath(rootDir: string, tenant: string): string {
  return path.join(tenantRoot(rootDir, tenant), HISTORY_FILE);
}

export async function appendHistoryEvent(
  rootDir: string,
  tenant: string,
  event: StagingHistoryEvent,
): Promise<void> {
  // `at` is the wall-clock log timestamp. `ts` (when present on the event payload)
  // is the snapshot timestamp — keep them on separate keys to avoid spread shadowing.
  const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n';
  const file = historyPath(rootDir, tenant);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, line, 'utf8');
}

export async function readHistory(
  rootDir: string,
  tenant: string,
): Promise<Array<{ at: string } & StagingHistoryEvent>> {
  const file = historyPath(rootDir, tenant);
  try {
    const text = await fs.promises.readFile(file, 'utf8');
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
