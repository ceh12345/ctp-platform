/* eslint-disable no-console */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ConfigService } from '../config/config.service';
import { FileConfigStore } from '../config/file-config-store';
import { StagingService } from '../modules/integration/staging/staging.service';
import { defaultRules } from '../modules/integration/staging/validation/rules';
import { ValidationRunner } from '../modules/integration/staging/validation/validation-runner';

interface Args {
  command: string;
  tenant: string;
  positional: string[];
  flags: Record<string, boolean>;
}

const USAGE = `Usage:
  staging list <tenant>
  staging promote <tenant> <ts> [--yes]
  staging inspect <tenant> <ts>
  staging rollback <tenant> [--yes]
  staging seed <tenant> <source-dir> [--yes] [--force-promote]
  staging history <tenant>

Flags:
  --yes              skip confirmation prompts
  --force-promote    on seed, promote even if validation has failures (report still attached)

Environment:
  CONFIG_ROOT   override default config root (defaults to ../../config from cwd)
`;

export function parseArgs(argv: string[]): Args | null {
  if (argv.length < 2) return null;
  const command = argv[0];
  if (!['list', 'promote', 'inspect', 'rollback', 'seed', 'history'].includes(command)) return null;
  const tenant = argv[1];
  const rest = argv.slice(2);
  const positional = rest.filter((a) => !a.startsWith('--'));
  const flags: Record<string, boolean> = {};
  for (const a of rest) {
    if (a.startsWith('--')) flags[a.slice(2)] = true;
  }
  return { command, tenant, positional, flags };
}

function makeService(tenant: string): StagingService {
  const configRoot =
    process.env.CONFIG_ROOT ?? path.join(process.cwd(), '..', '..', 'config');
  const store = new FileConfigStore(configRoot, tenant);
  const config = new ConfigService(store);
  return new StagingService(config.getStagingConfig().rootDir);
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function cmdList(staging: StagingService, tenant: string): Promise<number> {
  const snapshots = await staging.listSnapshots(tenant);
  if (snapshots.length === 0) {
    console.log(`(no snapshots for tenant '${tenant}')`);
    return 0;
  }
  console.log(`${snapshots.length} snapshot(s) for tenant '${tenant}':`);
  for (const s of snapshots) {
    const marker = s.isCurrent ? '* ' : '  ';
    const counts = s.metadata?.recordCounts
      ? Object.entries(s.metadata.recordCounts)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}=${n}`)
          .join(' ')
      : '(no metadata)';
    console.log(`${marker}${s.ts}  ${counts}`);
  }
  return 0;
}

export async function cmdInspect(
  staging: StagingService,
  tenant: string,
  ts: string,
): Promise<number> {
  const snapshots = await staging.listSnapshots(tenant);
  const target = snapshots.find((s) => s.ts === ts);
  if (!target) {
    console.error(`error: snapshot '${ts}' not found for tenant '${tenant}'`);
    return 1;
  }
  const fs = await import('fs');
  const reportPath = path.join(target.fullPath, '_validation-report.json');
  try {
    const text = await fs.promises.readFile(reportPath, 'utf8');
    console.log(text);
    return 0;
  } catch {
    console.error(`error: no validation report at ${reportPath}`);
    return 1;
  }
}

export async function cmdPromote(
  staging: StagingService,
  tenant: string,
  ts: string,
  yes: boolean,
  confirmFn: (prompt: string) => Promise<boolean> = confirm,
): Promise<number> {
  const snapshots = await staging.listSnapshots(tenant);
  const target = snapshots.find((s) => s.ts === ts);
  if (!target) {
    console.error(`error: snapshot '${ts}' not found for tenant '${tenant}'`);
    return 1;
  }
  if (target.isCurrent) {
    console.log(`'${ts}' is already current; nothing to do.`);
    return 0;
  }
  if (!yes && !(await confirmFn(`Promote '${ts}' for tenant '${tenant}'?`))) {
    console.log('aborted.');
    return 1;
  }
  await staging.repointAt(tenant, target.fullPath);
  console.log(`promoted '${ts}' for tenant '${tenant}'.`);
  return 0;
}

export async function cmdHistory(staging: StagingService, tenant: string): Promise<number> {
  const events = await staging.readHistory(tenant);
  if (events.length === 0) {
    console.log(`(no history for tenant '${tenant}')`);
    return 0;
  }
  for (const e of events) {
    console.log(JSON.stringify(e));
  }
  return 0;
}

export async function cmdRollback(
  staging: StagingService,
  tenant: string,
  yes: boolean,
  confirmFn: (prompt: string) => Promise<boolean> = confirm,
): Promise<number> {
  const snapshots = await staging.listSnapshots(tenant);
  if (snapshots.length < 2) {
    console.error(`error: need at least 2 snapshots to rollback; have ${snapshots.length}`);
    return 1;
  }
  // listSnapshots returns descending. Index 0 is newest (likely current); index 1 is prior.
  const currentIdx = snapshots.findIndex((s) => s.isCurrent);
  if (currentIdx === -1) {
    console.error(`error: no current snapshot to roll back from`);
    return 1;
  }
  if (currentIdx === snapshots.length - 1) {
    console.error(`error: current is the oldest snapshot; nothing to roll back to`);
    return 1;
  }
  const prior = snapshots[currentIdx + 1];
  if (!yes && !(await confirmFn(`Rollback tenant '${tenant}' from '${snapshots[currentIdx].ts}' to '${prior.ts}'?`))) {
    console.log('aborted.');
    return 1;
  }
  await staging.repointAt(tenant, prior.fullPath);
  console.log(`rolled back to '${prior.ts}' for tenant '${tenant}'.`);
  return 0;
}

// IRawDataPayload top-level keys. Matches what SyncOrchestrator writes.
const ARRAY_ENTITIES = [
  'resources',
  'tasks',
  'calendars',
  'stateChanges',
  'products',
  'orders',
  'materials',
  'processes',
  'cadences',
] as const;
const SINGLE_ENTITY = 'uomConversions';

// Stafford Genius API entity names for seeding from a captured fixture.
// Tenant-specific; promote to per-tenant config in a future sprint.
const GENIUS_ENTITY_FALLBACKS: Record<string, string> = {
  resources: 'machineAndRessourceEntity',
  tasks: 'productionTaskWithAdvancedInfoViewEntity',
  orders: 'salesOrderDetailEntity',
};

// Filename variants to try for each entity. camelCase first, kebab fallback for
// multi-word names (matches conventions on disk in tenant config dirs), then
// Genius entity-name fallback for seeding from captured API fixtures.
function sourceCandidates(key: string): string[] {
  const variants = [`${key}.json`];
  if (/[A-Z]/.test(key)) {
    variants.push(`${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}.json`);
  }
  const geniusName = GENIUS_ENTITY_FALLBACKS[key];
  if (geniusName) variants.push(`${geniusName}.json`);
  return variants;
}

async function readSource(sourceDir: string, key: string): Promise<unknown | null> {
  for (const name of sourceCandidates(key)) {
    const file = path.join(sourceDir, name);
    try {
      const text = await fs.promises.readFile(file, 'utf8');
      return JSON.parse(text);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  return null;
}

export async function cmdSeed(
  staging: StagingService,
  tenant: string,
  sourceDir: string,
  yes: boolean,
  confirmFn: (prompt: string) => Promise<boolean> = confirm,
  forcePromote = false,
): Promise<number> {
  const sourceExists = await fs.promises
    .stat(sourceDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!sourceExists) {
    console.error(`error: source dir not found: ${sourceDir}`);
    return 1;
  }

  if (!yes && !(await confirmFn(`Seed staging for '${tenant}' from '${sourceDir}'?`))) {
    console.log('aborted.');
    return 1;
  }

  const handle = staging.createSnapshot(tenant);
  await staging.appendHistory(tenant, {
    event: 'seed-started',
    sourceDir,
    ts: handle.ts,
  });
  const recordCounts: Record<string, number> = {};

  for (const key of ARRAY_ENTITIES) {
    const raw = await readSource(sourceDir, key);
    const arr = Array.isArray(raw) ? raw : [];
    await staging.writeRaw(handle, key, arr);
    recordCounts[key] = arr.length;
  }

  const uom = await readSource(sourceDir, SINGLE_ENTITY);
  if (uom != null) {
    const arr = Array.isArray(uom) ? uom : [uom];
    await staging.writeRaw(handle, SINGLE_ENTITY, arr);
    recordCounts[SINGLE_ENTITY] = 1;
  } else {
    recordCounts[SINGLE_ENTITY] = 0;
  }

  await staging.writeMetadata(handle, {
    capturedAt: new Date().toISOString(),
    adapterType: 'fixture-seed',
    recordCounts,
  });

  const runner = new ValidationRunner(defaultRules());
  const previous = await staging.current(tenant);
  const previousRawDir = previous ? path.join(previous, 'raw') : null;
  const report = await runner.run({ rawDir: handle.rawDir, previousRawDir });
  await staging.writeReport(handle, report);

  if (!report.passed) {
    if (!forcePromote) {
      await staging.markFailed(handle);
      await staging.appendHistory(tenant, {
        event: 'sync-marked-failed',
        ts: handle.ts,
        failedRules: report.failedRules,
      });
      console.error(`error: validation failed for seed; snapshot left at .failed/`);
      console.error(`failed rules: ${report.failedRules.join(', ')}`);
      console.error(`pass --force-promote to promote anyway (report stays attached)`);
      return 1;
    }
    console.warn(`warning: validation failed but --force-promote set; promoting anyway`);
    console.warn(`failed rules: ${report.failedRules.join(', ')}`);
    await staging.promote(handle);
    await staging.appendHistory(tenant, {
      event: 'sync-force-promoted',
      ts: handle.ts,
      failedRules: report.failedRules,
    });
  } else {
    await staging.promote(handle);
    await staging.appendHistory(tenant, {
      event: 'sync-promoted',
      ts: handle.ts,
      recordCounts,
    });
  }

  const summary = Object.entries(recordCounts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  console.log(`seeded '${handle.ts}' for tenant '${tenant}': ${summary}`);
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 1;
  }
  const staging = makeService(args.tenant);
  const yes = args.flags.yes === true;

  switch (args.command) {
    case 'list':
      return cmdList(staging, args.tenant);
    case 'inspect': {
      const ts = args.positional[0];
      if (!ts) {
        console.error('error: inspect requires a timestamp argument');
        return 1;
      }
      return cmdInspect(staging, args.tenant, ts);
    }
    case 'promote': {
      const ts = args.positional[0];
      if (!ts) {
        console.error('error: promote requires a timestamp argument');
        return 1;
      }
      return cmdPromote(staging, args.tenant, ts, yes);
    }
    case 'rollback':
      return cmdRollback(staging, args.tenant, yes);
    case 'history':
      return cmdHistory(staging, args.tenant);
    case 'seed': {
      const sourceDir = args.positional[0];
      if (!sourceDir) {
        console.error('error: seed requires a source directory argument');
        return 1;
      }
      const forcePromote = args.flags['force-promote'] === true;
      return cmdSeed(staging, args.tenant, sourceDir, yes, undefined, forcePromote);
    }
    default:
      console.error(USAGE);
      return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('error:', err.message ?? err);
      process.exit(2);
    });
}
