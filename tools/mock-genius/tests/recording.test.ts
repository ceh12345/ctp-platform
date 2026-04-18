// Recording-mode test suite — 18 scenarios per sprint spec.
//
// Tests 1-12: unit tests against proxyAndCapture + metadata state, using a
//             fake upstream spun up per test.
// Tests 13-15: server integration via app.inject() — a recording-mode server
//             is built ad-hoc in the test to avoid colliding with the
//             playback-mode singleton used by mock.test.ts.
// Tests 16-18: strip-envelope.js script tests — run the script on a
//             prepared directory, check outputs.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import fastify from 'fastify';
import { startFakeUpstream, envelope, FakeUpstream } from './fake-upstream';
import {
  buildRecordingConfig,
  proxyAndCapture,
  getRecordingMetadata,
  resetRecordingMetadata,
  isRecordingEnabled,
  _resetConfigForTests,
  RecordingConfig,
} from '../src/recording';

// ── Helpers ─────────────────────────────────────────────────────────────────

function freshSessionDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mock-genius-rec-'));
}

function configFor(upstream: FakeUpstream, sessionDir: string, overrides: Partial<RecordingConfig> = {}): RecordingConfig {
  return { upstreamUrl: upstream.url, sessionDir, timeoutMs: 5000, ...overrides };
}

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// Allow async disk writes to flush before asserting on files. The proxy
// fires write ops via unawaited promises; under load (full suite running
// many worker threads) 30ms can be short. 200ms is a generous margin.
function flush(ms = 200): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Tests 1-12 — proxyAndCapture ───────────────────────────────────────────

describe('recording — proxyAndCapture', () => {
  let upstream: FakeUpstream;
  let sessionDir: string;

  beforeEach(async () => {
    upstream = await startFakeUpstream();
    sessionDir = freshSessionDir();
    resetRecordingMetadata();
  });
  afterEach(async () => {
    await upstream.close();
    // Leave tmp session dirs on disk — OS cleans them up
  });

  // #1 — recording mode gates on the env var
  it('#1 isRecordingEnabled reflects MOCK_RECORD_FROM env var', () => {
    const prev = process.env.MOCK_RECORD_FROM;
    delete process.env.MOCK_RECORD_FROM;
    _resetConfigForTests();
    expect(isRecordingEnabled()).toBe(false);
    expect(buildRecordingConfig()).toBeNull();

    process.env.MOCK_RECORD_FROM = 'http://example.com';
    _resetConfigForTests();
    expect(isRecordingEnabled()).toBe(true);
    const cfg = buildRecordingConfig();
    expect(cfg?.upstreamUrl).toBe('http://example.com');

    // cleanup
    if (prev === undefined) delete process.env.MOCK_RECORD_FROM; else process.env.MOCK_RECORD_FROM = prev;
    _resetConfigForTests();
  });

  // #2 — request is proxied
  it('#2 a request to proxyAndCapture triggers a request to the upstream', async () => {
    upstream.setResponse('/api/data/fetch', { body: envelope([{ Id: 1 }]) });
    await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', { limit: '100' });
    expect(upstream.requestCount).toBe(1);
  });

  // #3 — auth headers
  it('#3 basic auth header is forwarded when MOCK_RECORD_AUTH_USER/PASS are set', async () => {
    upstream.setResponse('/api/data/fetch', { body: envelope([]) });
    await proxyAndCapture(
      configFor(upstream, sessionDir, { authUser: 'greg', authPass: 'hunter2' }),
      'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity',
      {},
    );
    const expected = 'Basic ' + Buffer.from('greg:hunter2').toString('base64');
    expect(upstream.lastHeaders.authorization).toBe(expected);
  });

  // #4 — response body saved to disk
  it('#4 response body is saved at {sessionDir}/{entity}.json', async () => {
    const env = envelope([{ Id: 1 }, { Id: 2 }]);
    upstream.setResponse('/api/data/fetch', { body: env });
    await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', {});
    await flush();
    const file = path.join(sessionDir, 'salesOrderDetailEntity.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  // #5 — full envelope captured, not just Result
  it('#5 saved file contains the full Genius envelope (Result + PagingInfos + Messages)', async () => {
    upstream.setResponse('/api/data/fetch', { body: envelope([{ Id: 42 }]) });
    await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', {});
    await flush();
    const body = readJson(path.join(sessionDir, 'salesOrderDetailEntity.json'));
    expect(body).toHaveProperty('Result');
    expect(body).toHaveProperty('PagingInfos');
    expect(body).toHaveProperty('Messages');
    expect(body.Result).toEqual([{ Id: 42 }]);
  });

  // #6 — _metadata.json written with correct shape
  it('#6 _metadata.json captures status, recordCount, queryParams, durationMs', async () => {
    upstream.setResponse('/api/data/fetch', { body: envelope([{ Id: 1 }, { Id: 2 }, { Id: 3 }]) });
    await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', { limit: '100', filter: 'Active=true' });
    await flush();
    const meta = readJson(path.join(sessionDir, '_metadata.json'));
    expect(meta.upstreamUrl).toBe(upstream.url);
    const cap = meta.endpoints.salesOrderDetailEntity;
    expect(cap.status).toBe(200);
    expect(cap.recordCount).toBe(3);
    expect(cap.pages).toBe(1);
    expect(cap.queryParams).toEqual({ limit: '100', filter: 'Active=true' });
    expect(cap.durationMs).toBeGreaterThanOrEqual(0);
    expect(meta.errors).toEqual([]);
  });

  // #7 — upstream 500 captured AND returned
  it('#7 upstream 500 is returned to caller with status 500 and body persisted to disk', async () => {
    upstream.setResponse('/api/data/fetch', { status: 500, body: { error: 'boom' } });
    const res = await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', {});
    expect(res.status).toBe(500);
    await flush();
    const body = readJson(path.join(sessionDir, 'salesOrderDetailEntity.json'));
    expect(body).toEqual({ error: 'boom' });
    const meta = readJson(path.join(sessionDir, '_metadata.json'));
    expect(meta.endpoints.salesOrderDetailEntity.status).toBe(500);
  });

  // #8 — upstream 401 captured AND returned
  it('#8 upstream 401 is returned to caller with status 401 and body persisted to disk', async () => {
    upstream.setResponse('/api/data/fetch', { status: 401, body: { error: 'unauthorized' } });
    const res = await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', {});
    expect(res.status).toBe(401);
    await flush();
    const body = readJson(path.join(sessionDir, 'salesOrderDetailEntity.json'));
    expect(body).toEqual({ error: 'unauthorized' });
  });

  // #9 — upstream unreachable
  it('#9 upstream unreachable returns 502 with diagnostic message; metadata records the error', async () => {
    await upstream.close();                        // kill the upstream before proxying
    const res = await proxyAndCapture(
      { upstreamUrl: upstream.url, sessionDir, timeoutMs: 3000 },
      'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity',
      {},
    );
    expect(res.status).toBe(502);
    expect(res.body).toMatch(/upstream unreachable/);
    await flush();
    const meta = readJson(path.join(sessionDir, '_metadata.json'));
    expect(meta.errors.length).toBe(1);
    expect(meta.errors[0].status).toBe(502);
    expect(meta.errors[0].endpoint).toBe('salesOrderDetailEntity');
  });

  // #10 — timeout
  it('#10 upstream timeout returns 504 after MOCK_RECORD_TIMEOUT expires', async () => {
    upstream.setResponse('/api/data/fetch', { body: envelope([]), delayMs: 500 });
    const res = await proxyAndCapture(
      { upstreamUrl: upstream.url, sessionDir, timeoutMs: 100 },   // 100ms < 500ms delay
      'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity',
      {},
    );
    expect(res.status).toBe(504);
    expect(res.body).toMatch(/timeout after 100ms/);
    await flush();
    const meta = readJson(path.join(sessionDir, '_metadata.json'));
    expect(meta.errors[0].status).toBe(504);
  });

  // #11 — disk write failure tolerated
  it('#11 disk write failure does not block the client response', async () => {
    upstream.setResponse('/api/data/fetch', { body: envelope([{ Id: 1 }]) });
    // Spy on writeFile to force a failure
    const spy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('EACCES'));
    const res = await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', {});
    // Client still got a valid response
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.Result).toEqual([{ Id: 1 }]);
    spy.mockRestore();
  });

  // #12 — pagination: per-page files
  it('#12 multi-page responses are saved as {entity}_pageN.json', async () => {
    upstream.setResponse('/api/data/fetch', (req) => {
      const q = req.query as any;
      const page = parseInt(q.pageIndex ?? '1', 10);
      return { body: envelope([{ Id: page * 10 }], { currentPage: page, totalPages: 3 }) };
    });

    await proxyAndCapture(configFor(upstream, sessionDir), 'productionTaskWithAdvancedInfoViewEntity',
      '/api/data/fetch/productionTaskWithAdvancedInfoViewEntity', { pageIndex: '1' });
    await proxyAndCapture(configFor(upstream, sessionDir), 'productionTaskWithAdvancedInfoViewEntity',
      '/api/data/fetch/productionTaskWithAdvancedInfoViewEntity', { pageIndex: '2' });
    await proxyAndCapture(configFor(upstream, sessionDir), 'productionTaskWithAdvancedInfoViewEntity',
      '/api/data/fetch/productionTaskWithAdvancedInfoViewEntity', { pageIndex: '3' });
    await flush();

    expect(fs.existsSync(path.join(sessionDir, 'productionTaskWithAdvancedInfoViewEntity_page1.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'productionTaskWithAdvancedInfoViewEntity_page2.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'productionTaskWithAdvancedInfoViewEntity_page3.json'))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, 'productionTaskWithAdvancedInfoViewEntity.json'))).toBe(false);

    // metadata reflects all three pages and total record count
    const meta = readJson(path.join(sessionDir, '_metadata.json'));
    const cap = meta.endpoints.productionTaskWithAdvancedInfoViewEntity;
    expect(cap.pages).toBe(3);
    expect(cap.recordCount).toBe(3);  // 1 record per page × 3 pages
  });
});

// ── Tests 13-15 — server in recording mode ─────────────────────────────────
//
// We don't import ../src/server here (that'd collide with the playback-mode
// import in mock.test.ts). Instead we build a tiny fastify app that wires the
// same three control endpoints in the recording configuration.

describe('recording — server control endpoints', () => {
  let upstream: FakeUpstream;
  let sessionDir: string;
  let app: ReturnType<typeof fastify>;

  beforeEach(async () => {
    upstream = await startFakeUpstream();
    sessionDir = freshSessionDir();
    resetRecordingMetadata();
    const recordingConfig: RecordingConfig = configFor(upstream, sessionDir);

    app = fastify({ logger: false });
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
    });

    // Mirror server.ts's recording-mode behavior on the three control endpoints.
    app.get('/_mock/health', async (_req, reply) =>
      reply.send({ status: 'ok', mode: 'recording' }));
    app.get('/_mock/state', async (_req, reply) => {
      const meta = getRecordingMetadata();
      return reply.send({
        mode: 'recording',
        upstreamUrl: recordingConfig.upstreamUrl,
        sessionDir: recordingConfig.sessionDir,
        capturedEndpoints: meta?.endpoints ?? {},
        errors: meta?.errors ?? [],
      });
    });
    app.post('/_mock/scenario', async (_req, reply) =>
      reply.status(409).send({ error: 'Scenario switching is disabled in recording mode.' }));
    app.post('/_mock/inject-failure', async (_req, reply) =>
      reply.status(409).send({ error: 'Failure injection is disabled in recording mode.' }));
  });
  afterEach(async () => {
    await app.close();
    await upstream.close();
  });

  // #13 — /_mock/health does not proxy
  it('#13 /_mock/health returns {status:ok, mode:recording} — no upstream call', async () => {
    const res = await app.inject({ method: 'GET', url: '/_mock/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', mode: 'recording' });
    expect(upstream.requestCount).toBe(0);
  });

  // #14 — /_mock/inject-failure rejected
  it('#14 /_mock/inject-failure returns 409 in recording mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/_mock/inject-failure',
      payload: { endpoint: '*', failureType: '500' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/disabled in recording mode/);
  });

  // #15 — /_mock/state includes mode, upstreamUrl, capturedEndpoints
  it('#15 /_mock/state reports recording mode with upstream URL and captured endpoints', async () => {
    // Prime some capture data
    upstream.setResponse('/api/data/fetch', { body: envelope([{ Id: 1 }]) });
    await proxyAndCapture(configFor(upstream, sessionDir), 'salesOrderDetailEntity',
      '/api/data/fetch/salesOrderDetailEntity', { limit: '100' });

    const res = await app.inject({ method: 'GET', url: '/_mock/state' });
    const body = res.json();
    expect(body.mode).toBe('recording');
    expect(body.upstreamUrl).toBe(upstream.url);
    expect(body.sessionDir).toBe(sessionDir);
    expect(Object.keys(body.capturedEndpoints)).toContain('salesOrderDetailEntity');
  });

  it('(bonus) /_mock/scenario returns 409 in recording mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/_mock/scenario',
      payload: { scenario: 'empty' },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── Tests 16-18 — strip-envelope.js ────────────────────────────────────────

describe('recording — strip-envelope.js', () => {
  const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'strip-envelope.js');

  function runStrip(dir: string): string {
    return execFileSync('node', [SCRIPT, dir], { encoding: 'utf-8' });
  }

  function makeCapture(): string {
    const dir = freshSessionDir();
    // Case a — single-file envelope to strip
    fs.writeFileSync(path.join(dir, 'salesOrderDetailEntity.json'),
      JSON.stringify(envelope([{ Id: 1 }, { Id: 2 }]), null, 2));
    // Case b — multi-page files to merge
    fs.writeFileSync(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity_page1.json'),
      JSON.stringify(envelope([{ Id: 10 }, { Id: 11 }], { currentPage: 1, totalPages: 3 }), null, 2));
    fs.writeFileSync(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity_page2.json'),
      JSON.stringify(envelope([{ Id: 12 }], { currentPage: 2, totalPages: 3 }), null, 2));
    fs.writeFileSync(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity_page3.json'),
      JSON.stringify(envelope([{ Id: 13 }, { Id: 14 }], { currentPage: 3, totalPages: 3 }), null, 2));
    // Case c — already an array (hand-edited)
    fs.writeFileSync(path.join(dir, 'machineAndRessourceEntity.json'),
      JSON.stringify([{ Id: 100 }], null, 2));
    // Case d — _metadata.json preserved
    fs.writeFileSync(path.join(dir, '_metadata.json'),
      JSON.stringify({ capturedAt: 'x', upstreamUrl: 'y', endpoints: {}, errors: [] }, null, 2));
    return dir;
  }

  // #16 — strip-envelope extracts Result arrays and merges page files
  it('#16 strip-envelope produces fixture-format output', () => {
    const dir = makeCapture();
    runStrip(dir);

    // Envelope stripped to array
    const orders = readJson(path.join(dir, 'salesOrderDetailEntity.json'));
    expect(orders).toEqual([{ Id: 1 }, { Id: 2 }]);

    // Paged files merged in page order; per-page files removed
    const tasks = readJson(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity.json'));
    expect(tasks).toEqual([{ Id: 10 }, { Id: 11 }, { Id: 12 }, { Id: 13 }, { Id: 14 }]);
    expect(fs.existsSync(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity_page1.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity_page2.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'productionTaskWithAdvancedInfoViewEntity_page3.json'))).toBe(false);

    // _metadata.json preserved untouched
    const meta = readJson(path.join(dir, '_metadata.json'));
    expect(meta).toEqual({ capturedAt: 'x', upstreamUrl: 'y', endpoints: {}, errors: [] });
  });

  // #17 — idempotent
  it('#17 running strip-envelope twice produces the same result as once', () => {
    const dir = makeCapture();
    runStrip(dir);
    const after1 = fs.readdirSync(dir).sort();
    const content1: Record<string, string> = {};
    for (const f of after1) content1[f] = fs.readFileSync(path.join(dir, f), 'utf-8');

    runStrip(dir);
    const after2 = fs.readdirSync(dir).sort();
    const content2: Record<string, string> = {};
    for (const f of after2) content2[f] = fs.readFileSync(path.join(dir, f), 'utf-8');

    expect(after2).toEqual(after1);
    expect(content2).toEqual(content1);
  });

  // #18 — preserves non-envelope files
  it('#18 strip-envelope leaves already-array files alone', () => {
    const dir = makeCapture();
    const before = fs.readFileSync(path.join(dir, 'machineAndRessourceEntity.json'), 'utf-8');
    runStrip(dir);
    const after  = fs.readFileSync(path.join(dir, 'machineAndRessourceEntity.json'), 'utf-8');
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
  });
});
