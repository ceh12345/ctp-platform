/**
 * Live adapter integration tests against a running mock-genius server.
 *
 * Unlike rest-adapter.spec.ts (which stubs global fetch), these tests exercise
 * the actual HTTP round-trip: RestAdapter → real fetch() → mock-genius → real
 * response → JSON parse → payload. They surface bugs the stub can't catch
 * (network stack, connection handling, content-type behavior, timing).
 *
 * Requires the mock running on localhost:8080. Start via:
 *   cd tools/mock-genius && npm run dev
 *
 * Tests skip cleanly if the mock is unreachable.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { RestAdapter } from '../rest-adapter';
import { IAdapterConfig } from '../../../config/interfaces/config-store.interface';

const MOCK_URL = 'http://localhost:8080';
const ORDERS    = '/api/data/fetch/salesOrderDetailEntity';
const TASKS     = '/api/data/fetch/productionTaskWithAdvancedInfoViewEntity';
const RESOURCES = '/api/data/fetch/machineAndRessourceEntity';

function makeConfig(overrides: Partial<IAdapterConfig> = {}): IAdapterConfig {
  return {
    adapterType: 'rest',
    source: 'mock-genius',
    connection: {
      baseUrl: `${MOCK_URL}/api/data/fetch`,
      timeout: 5000,
      retries: 2,
      retryDelay: 50,      // fast — we want tests to complete quickly
    },
    endpoints: {
      salesOrders: { path: '/salesOrderDetailEntity',                    pageSize: 100 },
      tasks:       { path: '/productionTaskWithAdvancedInfoViewEntity',   pageSize: 200 },
      resources:   { path: '/machineAndRessourceEntity',                 pageSize: 100 },
    },
    ...overrides,
  };
}

// ── Mock liveness gate ────────────────────────────────────────────────────

let mockAvailable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${MOCK_URL}/_mock/health`, { signal: AbortSignal.timeout(1500) });
    mockAvailable = res.ok;
  } catch {
    mockAvailable = false;
  }
  if (!mockAvailable) {
    console.warn('  ⚠ mock-genius not running on :8080 — skipping adapter integration tests');
  }
});

async function mockReset() {
  await fetch(`${MOCK_URL}/_mock/reset`, { method: 'POST' });
}

async function mockScenario(scenario: string) {
  await fetch(`${MOCK_URL}/_mock/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
}

async function mockInject(body: Record<string, unknown>) {
  await fetch(`${MOCK_URL}/_mock/inject-failure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('RestAdapter against live mock-genius', () => {
  beforeEach(async () => {
    if (!mockAvailable) return;   // per-test ctx.skip() handles the skipped state
    await mockReset();
  });

  // ── #1 Happy path: stafford-clean ────────────────────────────────────────

  it('#1 stafford-clean — adapter fetches all three entities successfully', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.orders.length).toBeGreaterThan(0);
    expect(payload.tasks.length).toBeGreaterThan(0);
    expect(payload.resources.length).toBeGreaterThan(0);
  });

  // ── #2 Empty scenario ────────────────────────────────────────────────────

  it('#2 empty scenario — adapter returns empty arrays for all entities', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('empty');

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.orders).toEqual([]);
    expect(payload.tasks).toEqual([]);
    expect(payload.resources).toEqual([]);
  });

  // ── #3 Transient 500 → retry → success ───────────────────────────────────

  it('#3 transient 500 on tasks endpoint retries and succeeds', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');
    await mockInject({ endpoint: TASKS, failureType: '500', count: 1 });

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    expect(payload.tasks.length).toBeGreaterThan(0);   // retry succeeded
  });

  // ── #4 401 fails fast (no wasted retry time) ─────────────────────────────

  it('#4 HTTP 401 fails fast — no retry spam', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');
    await mockInject({ endpoint: '*', failureType: '401', count: 10 });

    const adapter = new RestAdapter(makeConfig({
      connection: { baseUrl: `${MOCK_URL}/api/data/fetch`, timeout: 5000, retries: 3, retryDelay: 1000 },
    }));

    const start = Date.now();
    await expect(adapter.fetchRawData()).rejects.toThrow(/401/);
    const elapsed = Date.now() - start;
    // With retry: 3 × 1000ms = 3+s. Fail-fast: < 500ms. We allow headroom.
    expect(elapsed).toBeLessThan(1000);
  });

  // ── #5 Malformed JSON → "Invalid JSON" wrapping ──────────────────────────

  it('#5 malformed JSON surfaces wrapped error with endpoint URL', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');
    await mockInject({ endpoint: TASKS, failureType: 'malformed-json', count: 5 });

    const adapter = new RestAdapter(makeConfig({
      connection: { baseUrl: `${MOCK_URL}/api/data/fetch`, timeout: 5000, retries: 0, retryDelay: 10 },
    }));

    try {
      await adapter.fetchRawData();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toMatch(/Invalid JSON from/);
      expect(err.message).toMatch(/productionTaskWithAdvancedInfoViewEntity/);
    }
  });

  // ── #6 Wrong shape (raw array) — tolerated via fallback ─────────────────

  it('#6 wrong-shape (raw array) falls back through Array.isArray path', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');
    await mockInject({ endpoint: TASKS, failureType: 'wrong-shape', count: 1 });

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    // Adapter's extractor: `data?.Result ?? (Array.isArray(data) ? data : [])`
    // — so a raw array response for tasks still yields records.
    expect(Array.isArray(payload.tasks)).toBe(true);
    expect(payload.tasks.length).toBeGreaterThan(0);
  });

  // ── #7 Pagination — small pageSize forces multi-page loop ────────────────

  it('#7 small pageSize causes adapter to loop through all pages', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');

    // Force pageSize=2 — stafford-clean has >2 tasks, so adapter must loop
    const adapter = new RestAdapter(makeConfig({
      endpoints: {
        salesOrders: { path: '/salesOrderDetailEntity',                    pageSize: 2 },
        tasks:       { path: '/productionTaskWithAdvancedInfoViewEntity',   pageSize: 2 },
        resources:   { path: '/machineAndRessourceEntity',                 pageSize: 2 },
      },
    }));
    const payload = await adapter.fetchRawData();

    // Task count matches the full fixture even though each page returned only 2
    expect(payload.tasks.length).toBeGreaterThan(2);
  });

  // ── #8 Partial records scenario — landscape sees only what the mock sends ─

  it('#8 partial-records failure returns exactly N records — adapter faithfully reports truncated payload', async (ctx) => {
    if (!mockAvailable) ctx.skip();
    await mockScenario('stafford-clean');
    await mockInject({ endpoint: TASKS, failureType: 'partial-records', records: 3, count: 1 });

    const adapter = new RestAdapter(makeConfig());
    const payload = await adapter.fetchRawData();

    // Adapter doesn't second-guess the mock's response — it reports what
    // came back. This test locks in that "adapter is transparent; upstream
    // is authoritative."
    expect(payload.tasks.length).toBe(3);
  });
});
