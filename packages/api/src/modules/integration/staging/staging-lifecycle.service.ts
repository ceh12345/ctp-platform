import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../../../config/config.service';
import { createPointer } from './pointer/create-pointer';

const INITIAL_FIXTURE = 'initial-fixture';

// Ensures every tenant on boot has a `data/current` junction/symlink pointing
// at a snapshot directory. Symlinks aren't committed (Windows+git incompatibility)
// — they're generated locally at first boot and persist on disk afterward.
@Injectable()
export class StagingLifecycleService implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const tenantId = this.config.getTenantId();
    const tenantDir = path.join(this.config.getConfigRoot(), 'tenants', tenantId);
    const dataDir = path.join(tenantDir, 'data');
    const currentLink = path.join(dataDir, 'current');

    if (!fs.existsSync(dataDir)) return; // tenant has no data dir; nothing to do

    if (fs.existsSync(currentLink)) return; // operator already pointed it somewhere; leave alone

    const target = this.pickInitialTarget(dataDir);
    if (target == null) {
      // eslint-disable-next-line no-console
      console.warn(`[staging] tenant '${tenantId}' has no snapshot directory under data/; current pointer not created`);
      return;
    }

    const targetPath = path.join(dataDir, target);
    const pointer = createPointer(currentLink);
    await pointer.point(targetPath);
  }

  private pickInitialTarget(dataDir: string): string | null {
    const entries = fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'current')
      .map((e) => e.name);

    if (entries.length === 0) return null;
    if (entries.includes(INITIAL_FIXTURE) && entries.length === 1) return INITIAL_FIXTURE;

    // Multiple subdirs (initial-fixture + cleanse-tool-produced timestamps).
    // Prefer the lex-greatest timestamped one; YYYY-MM-DD-HHMM sorts correctly.
    // Fall back to initial-fixture if nothing better exists.
    const timestamped = entries
      .filter((n) => n !== INITIAL_FIXTURE)
      .sort()
      .reverse();
    if (timestamped.length > 0) return timestamped[0];
    return INITIAL_FIXTURE;
  }
}
