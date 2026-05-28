import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../config/config.service';
import { StateService } from '../../state/state.service';
import { TenantHealthService } from '../tenant-health.service';

const TENANT = 'health-test';

function makeStubConfig(configRoot: string, tenantId: string) {
  return {
    getConfigRoot: () => configRoot,
    getTenantId: () => tenantId,
    getMappingProfile: () => null,
    getAdapterConfig: () => null,
  } as unknown as ConfigService;
}

function makeStubState(landscape: 'loaded' | 'not_loaded', counts = { resources: 0, tasks: 0 }) {
  return {
    getSummary: () =>
      landscape === 'not_loaded'
        ? { status: 'not_loaded' as const, mappingErrors: [], validationSummary: { recordsWithErrors: 0, recordsWithWarnings: 0, unschedulableTasks: 0, byCode: {}, byEntity: { tasks: 0, orders: 0, resources: 0 } } }
        : {
            status: 'ok' as const,
            summary: {
              resources: counts.resources,
              tasks: counts.tasks,
              stateChanges: 0,
              horizon: { start: '2026-02-07T00:00:00Z', end: '2026-12-04T00:00:00Z' },
              settings: { scheduleDirection: 1 },
            },
            mappingErrors: [],
            validationSummary: { recordsWithErrors: 0, recordsWithWarnings: 0, unschedulableTasks: 0, byCode: {}, byEntity: { tasks: 0, orders: 0, resources: 0 } },
          },
  } as unknown as StateService;
}

async function setupTenant(configRoot: string, opts: { tenantJson?: boolean; data?: boolean; initialFixture?: boolean; currentSymlink?: 'real' | null; entities?: Record<string, unknown[]> } = {}) {
  const tenantDir = path.join(configRoot, 'tenants', TENANT);
  await fs.promises.mkdir(tenantDir, { recursive: true });
  if (opts.tenantJson !== false) {
    await fs.promises.writeFile(
      path.join(tenantDir, 'tenant.json'),
      JSON.stringify({ tenantId: TENANT, name: 'Health Test', vertical: 'manufacturing', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    );
  }
  if (opts.data !== false) {
    const dataDir = path.join(tenantDir, 'data');
    await fs.promises.mkdir(dataDir, { recursive: true });
    if (opts.initialFixture !== false) {
      const fixtureDir = path.join(dataDir, 'initial-fixture');
      await fs.promises.mkdir(fixtureDir, { recursive: true });
      const defaults: Record<string, unknown[]> = {
        resources: [{ key: 'R1' }],
        tasks: [{ key: 'T1' }],
        orders: [{ key: 'O1' }],
        calendars: [],
        'state-changes': [],
      };
      const entities = { ...defaults, ...(opts.entities ?? {}) };
      for (const [name, data] of Object.entries(entities)) {
        await fs.promises.writeFile(path.join(fixtureDir, `${name}.json`), JSON.stringify(data));
      }
    }
    if (opts.currentSymlink === 'real') {
      await fs.promises.symlink(
        path.join(dataDir, 'initial-fixture'),
        path.join(dataDir, 'current'),
        'junction',
      );
    }
  }
  return tenantDir;
}

describe('TenantHealthService', () => {
  let configRoot: string;

  beforeEach(async () => {
    configRoot = path.join(os.tmpdir(), `tenant-health-${crypto.randomUUID()}`);
    await fs.promises.mkdir(configRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(configRoot, { recursive: true, force: true });
  });

  it('healthy: tenant.json + data/current symlink + entity files + engine loaded', async () => {
    await setupTenant(configRoot, { currentSymlink: 'real' });
    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('loaded', { resources: 1, tasks: 1 }));
    const report = svc.build();

    expect(report.status).toBe('healthy');
    expect(report.checks.config.tenantJson).toBe('present');
    expect(report.checks.data.currentSymlink).toBe('resolves');
    expect(report.checks.data.fallbackInUse).toBe(false);
    expect(report.checks.entities.resources.count).toBe(1);
    expect(report.checks.engine.landscapeLoaded).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it('degraded: no symlink, fallback to initial-fixture in use', async () => {
    await setupTenant(configRoot, { currentSymlink: null });
    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('loaded', { resources: 1, tasks: 1 }));
    const report = svc.build();

    expect(report.status).toBe('degraded');
    expect(report.checks.data.currentSymlink).toBe('missing');
    expect(report.checks.data.fallbackInUse).toBe(true);
    expect(report.warnings.some((w) => w.includes('current symlink absent'))).toBe(true);
  });

  it('unhealthy: tenant.json missing', async () => {
    await setupTenant(configRoot, { tenantJson: false, currentSymlink: 'real' });
    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('not_loaded'));
    const report = svc.build();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.config.tenantJson).toBe('absent');
    expect(report.errors.some((e) => e.includes('tenant.json'))).toBe(true);
  });

  it('unhealthy: data dir missing entirely', async () => {
    await setupTenant(configRoot, { data: false });
    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('not_loaded'));
    const report = svc.build();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.data.dataDir).toBe('absent');
  });

  it('unhealthy: required entity file missing', async () => {
    // Don't pass `tasks` in entities; defaults include it, so override with empty fixture set
    const tenantDir = path.join(configRoot, 'tenants', TENANT);
    await fs.promises.mkdir(path.join(tenantDir, 'data', 'initial-fixture'), { recursive: true });
    await fs.promises.writeFile(
      path.join(tenantDir, 'tenant.json'),
      JSON.stringify({ tenantId: TENANT, name: 'X', vertical: 'manufacturing', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
    );
    await fs.promises.writeFile(
      path.join(tenantDir, 'data', 'initial-fixture', 'resources.json'),
      JSON.stringify([{ key: 'R1' }]),
    );
    // tasks.json deliberately absent

    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('not_loaded'));
    const report = svc.build();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.entities.tasks.present).toBe(false);
    expect(report.errors.some((e) => e.includes('tasks.json'))).toBe(true);
  });

  it('engine not loaded is informational, not unhealthy', async () => {
    await setupTenant(configRoot, { currentSymlink: 'real' });
    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('not_loaded'));
    const report = svc.build();

    expect(report.checks.engine.landscapeLoaded).toBe(false);
    // status depends on other checks; with everything else green, no errors → not unhealthy
    expect(report.status).not.toBe('unhealthy');
  });

  it('reports snapshot count and target', async () => {
    const tenantDir = await setupTenant(configRoot, { currentSymlink: 'real' });
    await fs.promises.mkdir(path.join(tenantDir, 'data', '2026-05-23-1430'), { recursive: true });
    const svc = new TenantHealthService(makeStubConfig(configRoot, TENANT), makeStubState('loaded', { resources: 1, tasks: 1 }));
    const report = svc.build();

    expect(report.checks.data.snapshotCount).toBe(2);
    expect(report.checks.data.snapshots).toContain('initial-fixture');
    expect(report.checks.data.snapshots).toContain('2026-05-23-1430');
    expect(report.checks.data.currentTarget).toBe('initial-fixture');
  });
});
