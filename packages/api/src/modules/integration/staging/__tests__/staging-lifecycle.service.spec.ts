import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../../config/config.service';
import { StagingLifecycleService } from '../staging-lifecycle.service';

const TENANT = 'tenant-under-test';

class StubConfig {
  constructor(private readonly configRoot: string, private readonly tenantId: string) {}
  getConfigRoot() {
    return this.configRoot;
  }
  getTenantId() {
    return this.tenantId;
  }
}

async function setupTenant(configRoot: string): Promise<string> {
  const tenantDir = path.join(configRoot, 'tenants', TENANT);
  await fs.promises.mkdir(path.join(tenantDir, 'data', 'initial-fixture'), { recursive: true });
  return tenantDir;
}

describe('StagingLifecycleService (data/current bootstrap)', () => {
  let configRoot: string;

  beforeEach(async () => {
    configRoot = path.join(os.tmpdir(), `lifecycle-${crypto.randomUUID()}`);
    await fs.promises.mkdir(configRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(configRoot, { recursive: true, force: true });
  });

  it('creates data/current pointing at initial-fixture when no pointer exists', async () => {
    const tenantDir = await setupTenant(configRoot);

    const config = new StubConfig(configRoot, TENANT) as unknown as ConfigService;
    const svc = new StagingLifecycleService(config);
    await svc.onModuleInit();

    const currentLink = path.join(tenantDir, 'data', 'current');
    const resolved = await fs.promises.realpath(currentLink);
    expect(resolved).toBe(
      await fs.promises.realpath(path.join(tenantDir, 'data', 'initial-fixture')),
    );
  });

  it('leaves existing data/current alone (operator may have re-pointed it)', async () => {
    const tenantDir = await setupTenant(configRoot);
    // operator created a custom pointer pointing somewhere else
    const otherDir = path.join(tenantDir, 'data', 'custom-snapshot');
    await fs.promises.mkdir(otherDir, { recursive: true });
    await fs.promises.symlink(otherDir, path.join(tenantDir, 'data', 'current'), 'junction');

    const config = new StubConfig(configRoot, TENANT) as unknown as ConfigService;
    const svc = new StagingLifecycleService(config);
    await svc.onModuleInit();

    const resolved = await fs.promises.realpath(path.join(tenantDir, 'data', 'current'));
    expect(resolved).toBe(await fs.promises.realpath(otherDir));
  });

  it('prefers most recent timestamped snapshot over initial-fixture when both exist', async () => {
    const tenantDir = await setupTenant(configRoot);
    await fs.promises.mkdir(path.join(tenantDir, 'data', '2026-05-23-1430'), { recursive: true });
    await fs.promises.mkdir(path.join(tenantDir, 'data', '2026-05-22-1100'), { recursive: true });

    const config = new StubConfig(configRoot, TENANT) as unknown as ConfigService;
    const svc = new StagingLifecycleService(config);
    await svc.onModuleInit();

    const resolved = await fs.promises.realpath(path.join(tenantDir, 'data', 'current'));
    expect(resolved).toBe(
      await fs.promises.realpath(path.join(tenantDir, 'data', '2026-05-23-1430')),
    );
  });

  it('no-ops when tenant has no data dir', async () => {
    // tenant config exists but no data/ — shouldn't crash
    const tenantDir = path.join(configRoot, 'tenants', TENANT);
    await fs.promises.mkdir(tenantDir, { recursive: true });

    const config = new StubConfig(configRoot, TENANT) as unknown as ConfigService;
    const svc = new StagingLifecycleService(config);
    await expect(svc.onModuleInit()).resolves.not.toThrow();
  });
});
