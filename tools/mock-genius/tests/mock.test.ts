import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/server';
import { DEFAULT_SCENARIO } from '../src/fixtures';

// Shared helper — reset between tests so queues don't leak.
async function resetServer() {
  await app.inject({ method: 'POST', url: '/_mock/reset' });
}

const ORDERS   = '/api/data/fetch/salesOrderDetailEntity';
const TASKS    = '/api/data/fetch/productionTaskWithAdvancedInfoViewEntity';
const RESOURCES = '/api/data/fetch/machineAndRessourceEntity';

describe('mock-genius', () => {
  beforeEach(async () => { await resetServer(); });

  // ── #1 Health ────────────────────────────────────────────────────────────

  it('#1 GET /_mock/health returns 200 with ok status', async () => {
    const res = await app.inject({ method: 'GET', url: '/_mock/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', scenario: expect.any(String) });
  });

  // ── #2 Default scenario serves ───────────────────────────────────────────

  it('#2 default scenario serves fixture data wrapped in Genius envelope', async () => {
    const res = await app.inject({ method: 'GET', url: RESOURCES });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('Result');
    expect(body).toHaveProperty('PagingInfos');
    expect(body).toHaveProperty('Messages');
    expect(Array.isArray(body.Result)).toBe(true);
    expect(body.Result.length).toBeGreaterThan(0);
  });

  // ── #3 Empty scenario ────────────────────────────────────────────────────

  it('#3 empty scenario returns Result:[] for every entity', async () => {
    await app.inject({ method: 'POST', url: '/_mock/scenario', payload: { scenario: 'empty' } });
    for (const path of [ORDERS, TASKS, RESOURCES]) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(200);
      expect(res.json().Result).toEqual([]);
    }
  });

  // ── #4 Scenario switching ────────────────────────────────────────────────

  it('#4 POST /_mock/scenario switches active scenario without restart', async () => {
    const before = await app.inject({ method: 'GET', url: '/_mock/state' });
    expect(before.json().scenario).toBe(DEFAULT_SCENARIO);

    const switchRes = await app.inject({ method: 'POST', url: '/_mock/scenario', payload: { scenario: 'empty' } });
    expect(switchRes.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/_mock/state' });
    expect(after.json().scenario).toBe('empty');
  });

  it('#4b POST /_mock/scenario with unknown scenario returns 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/_mock/scenario', payload: { scenario: 'does-not-exist' } });
    expect(res.statusCode).toBe(404);
  });

  // ── #5 Failure injection — 500 ───────────────────────────────────────────

  it('#5 injecting 500 makes the next request return 500', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: '500' },
    });
    const res = await app.inject({ method: 'GET', url: TASKS });
    expect(res.statusCode).toBe(500);
  });

  // ── #6 Failure injection — count ─────────────────────────────────────────

  it('#6 count=3 fails three requests then succeeds on the fourth', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: '500', count: 3 },
    });
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(200);
  });

  // ── #7 Endpoint specificity ──────────────────────────────────────────────

  it('#7 failure on tasks endpoint does not affect orders endpoint', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: '500' },
    });
    expect((await app.inject({ method: 'GET', url: ORDERS })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(500);
  });

  // ── #8 Wildcard ─────────────────────────────────────────────────────────

  it('#8 endpoint:"*" affects all endpoints', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: '*', failureType: '401', count: 3 },
    });
    expect((await app.inject({ method: 'GET', url: ORDERS })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: RESOURCES })).statusCode).toBe(401);
  });

  // ── #9 Timeout ──────────────────────────────────────────────────────────

  it('#9 timeout failure holds the connection until cap fires', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: 'timeout', timeoutMs: 200 },
    });
    // After 200ms the server throws; Fastify converts that to 500.
    // What we're asserting: the response does NOT come back quickly, AND
    // when it does come back it's an error — both confirm the hang.
    const start = Date.now();
    const res = await app.inject({ method: 'GET', url: TASKS });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  }, 5000);

  // ── #10 Malformed JSON ───────────────────────────────────────────────────

  it('#10 malformed-json returns 200 with syntactically invalid body', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: 'malformed-json' },
    });
    const res = await app.inject({ method: 'GET', url: TASKS });
    expect(res.statusCode).toBe(200);
    // JSON.parse must throw on the body
    expect(() => JSON.parse(res.body)).toThrow();
  });

  // ── #11 Auth required — SKIPPED (not in Phase 2 scope) ──────────────────
  // Spec mentions MOCK_REQUIRE_AUTH env var but Phase 2 focuses on failure
  // injection. Auth middleware is a Phase 3 concern.

  // ── #12 Pagination ──────────────────────────────────────────────────────

  it('#12 pagination: limit=2 slices the fixture into pages with correct PagingInfos', async () => {
    // stafford-clean has multiple records; ask for tiny pages so we can see
    // multi-page behavior regardless of the exact record count.
    const p1 = await app.inject({ method: 'GET', url: `${RESOURCES}?limit=2&pageIndex=1` });
    const p2 = await app.inject({ method: 'GET', url: `${RESOURCES}?limit=2&pageIndex=2` });
    expect(p1.statusCode).toBe(200);
    expect(p2.statusCode).toBe(200);

    const b1 = p1.json();
    const b2 = p2.json();
    expect(b1.Result.length).toBeLessThanOrEqual(2);
    expect(b1.PagingInfos.CurrentPageIndex).toBe(1);
    expect(b1.PagingInfos.PageSize).toBe(2);
    expect(b1.PagingInfos.TotalPagesFound).toBeGreaterThan(1);
    expect(b2.PagingInfos.CurrentPageIndex).toBe(2);
    // Page 1 and page 2 must hold different records (assuming at least 3 total)
    if (b1.PagingInfos.TotalElementsFound >= 3) {
      expect(b1.Result[0]).not.toEqual(b2.Result[0]);
    }
  });

  // ── #13 Reset ───────────────────────────────────────────────────────────

  it('#13 POST /_mock/reset clears injected failures AND resets scenario to default', async () => {
    await app.inject({ method: 'POST', url: '/_mock/scenario', payload: { scenario: 'empty' } });
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: '*', failureType: '500', count: 5 },
    });

    const beforeState = (await app.inject({ method: 'GET', url: '/_mock/state' })).json();
    expect(beforeState.scenario).toBe('empty');
    expect(beforeState.pendingFailures.length).toBe(1);

    await app.inject({ method: 'POST', url: '/_mock/reset' });

    const afterState = (await app.inject({ method: 'GET', url: '/_mock/state' })).json();
    expect(afterState.scenario).toBe(DEFAULT_SCENARIO);
    expect(afterState.pendingFailures).toEqual([]);

    // And the next request should succeed cleanly
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(200);
  });

  // ── #14 State inspection ────────────────────────────────────────────────

  it('#14 GET /_mock/state reports scenario, pendingFailures, requestCount', async () => {
    // Make a data request to bump requestCount
    await app.inject({ method: 'GET', url: TASKS });
    await app.inject({ method: 'GET', url: ORDERS });

    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: '500', count: 2 },
    });

    const state = (await app.inject({ method: 'GET', url: '/_mock/state' })).json();
    expect(state.scenario).toBe(DEFAULT_SCENARIO);
    expect(state.requestCount).toBeGreaterThanOrEqual(2);
    expect(state.pendingFailures.length).toBe(1);
    expect(state.pendingFailures[0]).toMatchObject({
      endpoint: TASKS, failureType: '500', count: 2,
    });
  });

  // ── #15 Recording mode — SKIPPED (Phase 3) ──────────────────────────────

  // ── Additional: query-string failure shortcut ────────────────────────────

  it('?_mock_fail=500 query-string shortcut fails the one request it is on', async () => {
    const failed = await app.inject({ method: 'GET', url: `${TASKS}?_mock_fail=500` });
    expect(failed.statusCode).toBe(500);
    const ok = await app.inject({ method: 'GET', url: TASKS });
    expect(ok.statusCode).toBe(200);
  });

  it('?_mock_delay=150 query-string shortcut delays the response', async () => {
    const start = Date.now();
    const res = await app.inject({ method: 'GET', url: `${TASKS}?_mock_delay=150` });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(res.statusCode).toBe(200);
  });

  // ── Additional: failure types exercised ─────────────────────────────────

  it('wrong-shape returns a raw array with no envelope', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: 'wrong-shape' },
    });
    const res = await app.inject({ method: 'GET', url: TASKS });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).not.toHaveProperty('Result');
  });

  it('empty-result returns envelope with Result:[]', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: 'empty-result' },
    });
    const res = await app.inject({ method: 'GET', url: TASKS });
    const body = res.json();
    expect(body.Result).toEqual([]);
    expect(body).toHaveProperty('PagingInfos');
  });

  it('partial-records slices the fixture to N records', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: 'partial-records', records: 1 },
    });
    const res = await app.inject({ method: 'GET', url: TASKS });
    const body = res.json();
    expect(body.Result.length).toBe(1);
  });

  it('truncated returns a prefix of a valid envelope (closing brace missing)', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: 'truncated' },
    });
    const res = await app.inject({ method: 'GET', url: TASKS });
    expect(res.statusCode).toBe(200);
    // Body is NOT valid JSON (last char dropped)
    expect(() => JSON.parse(res.body)).toThrow();
    // But it does start like a Genius envelope
    expect(res.body.startsWith('{"Result":[')).toBe(true);
  });

  it('injecting 503 and 429 returns those status codes', async () => {
    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: '503' },
    });
    expect((await app.inject({ method: 'GET', url: TASKS })).statusCode).toBe(503);

    await app.inject({
      method: 'POST', url: '/_mock/inject-failure',
      payload: { endpoint: TASKS, failureType: '429' },
    });
    const r = await app.inject({ method: 'GET', url: TASKS });
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBe('30');
  });

  // ── Control endpoint validation ─────────────────────────────────────────

  it('inject-failure without endpoint/failureType returns 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/_mock/inject-failure', payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
