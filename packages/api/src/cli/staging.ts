/* eslint-disable no-console */
import * as path from 'path';
import * as readline from 'readline';
import { ConfigService } from '../config/config.service';
import { FileConfigStore } from '../config/file-config-store';
import { StagingService } from '../modules/integration/staging/staging.service';

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

Environment:
  CONFIG_ROOT   override default config root (defaults to ../../config from cwd)
`;

export function parseArgs(argv: string[]): Args | null {
  if (argv.length < 2) return null;
  const command = argv[0];
  if (!['list', 'promote', 'inspect', 'rollback'].includes(command)) return null;
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
