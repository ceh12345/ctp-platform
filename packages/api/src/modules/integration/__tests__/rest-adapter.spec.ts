import { describe, it, expect, vi, afterEach } from 'vitest';
import { RestAdapter } from '../rest-adapter';
import { IAdapterConfig } from '../../../config/interfaces/config-store.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<IAdapterConfig> = {}): IAdapterConfig {
  return {
    adapterType: 'rest',
    source: 'genius-api-mock',
    connection: {
      baseUrl: 'http://localhost:8080/api/data/fetch',
      timeout: 5000,
      retries: 0,
      retryDelay: 100,
    },
    endpoints: {
      salesOrders: { path: '/salesOrderDetailEntity',                    pageSize: 100 },
      tasks:       { path: '/productionTaskWithAdvancedInfoViewEntity',   pageSize: 200 },
      resources:   { path: '/machineAndRessourceEntity',                 pageSize: 100 },
    },
    ...overrides,
  };
}

function makeGeniusEnvelope(records: any[], totalPages = 1, currentPage = 1) {
  return {
    Result: records,
    Messages: [],
    PagingInfos: { CurrentPageIndex: currentPage, PageSize: 100, TotalElementsFound: records.length, TotalPagesFound: totalPages },
    Tag: null,
  };
}

function mockFetch(responses: Record<string, any>) {
  return vi.fn(async (url: string) => {
    const urlStr = url.toString();
    const match = Object.keys(responses).find(k => urlStr.includes(k));
    const body = match ? responses[match] : { Result: [], PagingInfos: { TotalPagesFound: 1 } };
    return {
      ok: true,
      json: async () => body,
    };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RestAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── adapterType ───────────────────────────────────────────────────────────

  it('has adapterType "rest"', () => {
    const adapter = new RestAdapter(makeConfig());
    expect(adapter.adapterType).toBe('rest');
  });

  // ── Envelope extraction ───────────────────────────────────────────────────

  it('extracts Result array from Genius envelope', async () => {
    const salesOrders = [{ Id: 1, JobCode: 'PV-001' }];
    const tasks       = [{ Id: 101, JobCode: 'PV-001', OperationCode: 'CUT' }];
    const resources   = [{ Id: 4001, MachineCode: 'SAW-01' }];

    vi.stubGlobal('fetch', mockFetch({
      salesOrderDetailEntity:                  makeGeniusEnvelope(salesOrders),
      productionTaskWithAdvancedInfoViewEntity: makeGeniusEnvelope(tasks),
      machineAndRessourceEntity:               makeGeniusEnvelope(resources),
    }));

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.orders).toEqual(salesOrders);
    expect(payload.tasks).toEqual(tasks);
    expect(payload.resources).toEqual(resources);
  });

  it('returns empty arrays for endpoints with no results', async () => {
    vi.stubGlobal('fetch', mockFetch({
      salesOrderDetailEntity:                  makeGeniusEnvelope([]),
      productionTaskWithAdvancedInfoViewEntity: makeGeniusEnvelope([]),
      machineAndRessourceEntity:               makeGeniusEnvelope([]),
    }));

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.orders).toEqual([]);
    expect(payload.tasks).toEqual([]);
    expect(payload.resources).toEqual([]);
  });

  // ── Missing endpoint ──────────────────────────────────────────────────────

  it('returns empty array when endpoint path is not configured', async () => {
    vi.stubGlobal('fetch', mockFetch({}));

    // Config has no salesOrders endpoint
    const config = makeConfig({ endpoints: { tasks: { path: '/productionTaskWithAdvancedInfoViewEntity', pageSize: 100 }, resources: { path: '/machineAndRessourceEntity', pageSize: 100 } } });
    const adapter = new RestAdapter(config);
    const payload = await adapter.fetchRawData();

    expect(payload.orders).toEqual([]);
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it('fetches all pages when TotalPagesFound > 1', async () => {
    const page1 = [{ Id: 1 }, { Id: 2 }];
    const page2 = [{ Id: 3 }, { Id: 4 }];
    const page3 = [{ Id: 5 }];

    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      callCount++;
      const urlStr = url.toString();
      if (!urlStr.includes('salesOrderDetailEntity')) return { ok: true, json: async () => makeGeniusEnvelope([]) };
      const pageMatch = urlStr.match(/pageIndex=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1]) : 1;
      const data = page === 1 ? page1 : page === 2 ? page2 : page3;
      return { ok: true, json: async () => makeGeniusEnvelope(data, 3, page) };
    }));

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.orders).toHaveLength(5);
    expect(payload.orders).toEqual([...page1, ...page2, ...page3]);
  });

  // ── HTTP errors ───────────────────────────────────────────────────────────

  it('throws after exhausting retries on HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    })));

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 1, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow('HTTP 500');
  });

  // ── Non-retryable 4xx errors — fail fast, no retry ───────────────────────

  it('HTTP 401 throws immediately without retrying', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 3, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow(/401/);
    // 3 parallel endpoint fetches, each hit exactly once (no retry on 401)
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('HTTP 403 throws immediately without retrying', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 403, statusText: 'Forbidden', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 3, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow(/403/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('HTTP 404 throws immediately without retrying', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 404, statusText: 'Not Found', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 3, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow(/404/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  // ── Transient 4xx — do retry ─────────────────────────────────────────────

  it('HTTP 408 Request Timeout retries (treated as transient)', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 408, statusText: 'Request Timeout', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 2, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow(/408/);
    // 3 endpoints × (1 initial + 2 retries) = 9
    expect(fetchFn).toHaveBeenCalledTimes(9);
  });

  it('HTTP 429 Too Many Requests retries (treated as transient)', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 2, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(9);
  });

  // ── HTTP 500 first, 200 second — retry succeeds ──────────────────────────

  it('retries transient 500 and succeeds on second attempt', async () => {
    // Map of URL-snippet → call counter. First call per endpoint 500s, second returns data.
    const callCounts = new Map<string, number>();
    const fetchFn = vi.fn(async (url: string) => {
      const urlStr = url.toString();
      const key = Object.keys({
        salesOrderDetailEntity: 1,
        productionTaskWithAdvancedInfoViewEntity: 1,
        machineAndRessourceEntity: 1,
      }).find(k => urlStr.includes(k)) ?? 'unknown';
      const count = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, count);
      if (count === 1) {
        return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) };
      }
      return { ok: true, json: async () => makeGeniusEnvelope([{ Id: 42 }]) };
    });
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 2, retryDelay: 10 } }));
    const payload = await adapter.fetchRawData();
    expect(payload.orders).toEqual([{ Id: 42 }]);
    expect(payload.tasks).toEqual([{ Id: 42 }]);
    expect(payload.resources).toEqual([{ Id: 42 }]);
  });

  // ── Empty body shapes ────────────────────────────────────────────────────

  it('returns [] when response body is {} (no Result field)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();
    expect(payload.orders).toEqual([]);
    expect(payload.tasks).toEqual([]);
    expect(payload.resources).toEqual([]);
  });

  it('returns [] when response body is {"Result": null}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ Result: null, PagingInfos: { TotalPagesFound: 1 } }),
    })));

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();
    expect(payload.orders).toEqual([]);
    expect(payload.tasks).toEqual([]);
    expect(payload.resources).toEqual([]);
  });

  // ── Malformed JSON ───────────────────────────────────────────────────────

  it('wraps JSON parse error with endpoint URL and preserves cause', async () => {
    const parseErr = new SyntaxError('Unexpected token < in JSON at position 0');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => { throw parseErr; },
    })));

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 0, retryDelay: 10 } }));

    try {
      await adapter.fetchRawData();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toMatch(/Invalid JSON from/);
      expect(err.message).toMatch(/Entity/);  // URL contains one of the entity paths
      expect(err.cause).toBe(parseErr);
    }
  });

  // ── Timeout (AbortError) ─────────────────────────────────────────────────

  it('wraps AbortError as "Timeout after Xms" with endpoint URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err: any = new Error('signal aborted');
      err.name = 'AbortError';
      throw err;
    }));

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 5000, retries: 0, retryDelay: 10 } }));

    try {
      await adapter.fetchRawData();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toMatch(/Timeout after 5000ms/);
      expect(err.message).toMatch(/Entity/);
      expect(err.cause?.name).toBe('AbortError');
    }
  });

  // ── Pagination mid-failure ───────────────────────────────────────────────

  it('pagination mid-failure throws without returning partial data', async () => {
    // Page 1 returns 2 records, page 2 fails. Adapter must throw, not return [rec1, rec2].
    const fetchFn = vi.fn(async (url: string) => {
      const urlStr = url.toString();
      // Only salesOrders uses pagination here; other endpoints return a single-page []
      if (!urlStr.includes('salesOrderDetailEntity')) {
        return { ok: true, json: async () => makeGeniusEnvelope([]) };
      }
      const pageMatch = urlStr.match(/pageIndex=(\d+)/);
      const page = pageMatch ? parseInt(pageMatch[1]) : 1;
      if (page === 1) {
        return { ok: true, json: async () => makeGeniusEnvelope([{ Id: 1 }, { Id: 2 }], 3, 1) };
      }
      // Page 2 fails
      return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchFn);

    const adapter = new RestAdapter(makeConfig({ connection: { baseUrl: 'http://localhost:8080/api/data/fetch', timeout: 1000, retries: 0, retryDelay: 10 } }));
    await expect(adapter.fetchRawData()).rejects.toThrow(/500/);
  });

  // ── Non-empty arrays in payload ───────────────────────────────────────────

  it('always returns empty arrays for calendars, stateChanges, materials, processes', async () => {
    vi.stubGlobal('fetch', mockFetch({
      salesOrderDetailEntity:                  makeGeniusEnvelope([{ Id: 1 }]),
      productionTaskWithAdvancedInfoViewEntity: makeGeniusEnvelope([{ Id: 2 }]),
      machineAndRessourceEntity:               makeGeniusEnvelope([{ Id: 3 }]),
    }));

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.calendars).toEqual([]);
    expect(payload.stateChanges).toEqual([]);
    expect(payload.materials).toEqual([]);
    expect(payload.processes).toEqual([]);
    expect(payload.uomConversions).toBeNull();
  });
});
