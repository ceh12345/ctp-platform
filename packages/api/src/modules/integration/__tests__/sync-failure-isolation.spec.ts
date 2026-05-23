/**
 * Landscape-integrity isolation tests.
 *
 * Asserts that a failed REST sync never mutates the in-memory landscape:
 * - A prior successful sync is preserved verbatim when a subsequent sync fails.
 * - A first-ever failed sync leaves getLandscape() returning null.
 *
 * Self-contained: fetch is stubbed, no mock-genius server required.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import * as os from 'os';
import * as crypto from 'crypto';
import { AdapterFactory } from '../adapter-factory';
import { MappingEngine } from '../mapping-engine';
import { StagingService } from '../staging/staging.service';
import { SyncOrchestrator } from '../staging/sync-orchestrator';
import { SyncService } from '../sync.service';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID = 'stafford-engineering-test';

function createServices() {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const mappingEngine = new MappingEngine();
  // Staging is disabled by default (no staging.json in tenant); these instances
  // are present to satisfy SyncService's constructor and stay dormant at runtime.
  const stagingRoot = path.join(os.tmpdir(), `sync-fi-${crypto.randomUUID()}`);
  const stagingService = new StagingService(stagingRoot);
  const syncOrchestrator = new SyncOrchestrator(stagingService);
  const adapterFactory = new AdapterFactory(configService, stagingService);
  const syncService = new SyncService(
    adapterFactory,
    mappingEngine,
    configService,
    syncOrchestrator,
    stagingService,
  );
  const stateService = new StateService(hydrator, configService, syncService);
  return { stateService };
}

// Minimal Genius envelope wrapping a records array.
function envelope(records: unknown[]) {
  return {
    Result: records,
    Messages: [],
    PagingInfos: { CurrentPageIndex: 1, PageSize: 100, TotalElementsFound: records.length, TotalPagesFound: 1 },
    Tag: null,
  };
}

// Respond to any endpoint with an empty Genius envelope. Enough to produce a
// valid (if empty) landscape — we only care that getLandscape() becomes non-null.
const okEmptyFetch = () =>
  vi.fn(async () => ({ ok: true, json: async () => envelope([]) }));

const failingFetch = (status = 500) =>
  vi.fn(async () => ({
    ok: false,
    status,
    statusText: status === 500 ? 'Internal Server Error' : 'Error',
    json: async () => ({}),
  }));

describe('syncFromAdapter failure isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The 500 tests exercise the real retry chain (3 × 2s backoff = ~12s).
  // 30s timeout gives comfortable headroom without masking genuine hangs.
  it('preserves prior landscape when a subsequent REST sync fails', { timeout: 30000 }, async () => {
    const { stateService } = createServices();

    // 1. First sync succeeds
    vi.stubGlobal('fetch', okEmptyFetch());
    await stateService.syncFromAdapter();
    const original = stateService.getLandscape();
    expect(original).not.toBeNull();

    // 2. Swap fetch to always fail
    vi.stubGlobal('fetch', failingFetch(500));

    // 3. syncFromAdapter rejects
    await expect(stateService.syncFromAdapter()).rejects.toThrow(/500/);

    // 4. Landscape is the same reference (not merely equal — literally unchanged)
    const preserved = stateService.getLandscape();
    expect(preserved).toBe(original);
    expect(stateService.isLoaded()).toBe(true);
  });

  it('first-ever sync failure leaves getLandscape() returning null', { timeout: 30000 }, async () => {
    const { stateService } = createServices();
    vi.stubGlobal('fetch', failingFetch(500));

    await expect(stateService.syncFromAdapter()).rejects.toThrow(/500/);

    expect(stateService.getLandscape()).toBeNull();
    expect(stateService.isLoaded()).toBe(false);
  });

  it('HTTP 401 (non-retryable) also preserves prior landscape', async () => {
    const { stateService } = createServices();

    vi.stubGlobal('fetch', okEmptyFetch());
    await stateService.syncFromAdapter();
    const original = stateService.getLandscape();

    vi.stubGlobal('fetch', failingFetch(401));
    await expect(stateService.syncFromAdapter()).rejects.toThrow(/401/);

    expect(stateService.getLandscape()).toBe(original);
  });
});
