import fastify from 'fastify';
import { getScenario, setScenario, loadFixture, resetScenario } from './fixtures';
import { geniusPagedEnvelope } from './responseFormat';
import {
  enqueueFailure,
  consumeFailureFor,
  resetFailures,
  getPendingFailures,
  getRequestCount,
  incrementRequestCount,
  parseQuerystringFailure,
  FailureType,
} from './failureInjection';
import { applyFailure } from './failureApplier';
import {
  buildRecordingConfig,
  proxyAndCapture,
  getRecordingMetadata,
  resetRecordingMetadata,
  RecordingConfig,
} from './recording';

const PORT = parseInt(process.env.MOCK_PORT ?? '8080', 10);
const LOG_REQUESTS = process.env.MOCK_LOG_REQUESTS !== 'false';

// Resolve recording mode once at module load. If MOCK_RECORD_FROM is set the
// mock enters recording mode for its entire lifetime — the session directory
// is created here (under MOCK_RECORD_DIR, timestamped at startup).
const recordingConfig: RecordingConfig | null = buildRecordingConfig();

const app = fastify({ logger: false });

// ── Content-type for request bodies ───────────────────────────────────────
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, JSON.parse(body as string));
  } catch (e) {
    done(e as Error, undefined);
  }
});

// ── Genius data endpoints ──────────────────────────────────────────────────
// Each endpoint: check for queued/querystring failure → apply if present,
// otherwise paginate the fixture and return a Genius envelope.

const GENIUS_ENTITIES = [
  'salesOrderDetailEntity',
  'workOrderWithAdvancedInformationViewEntity',
  'productionTaskWithAdvancedInfoViewEntity',
  'machineAndRessourceEntity',    // note: Genius typo ("Ressource") preserved
] as const;

for (const entity of GENIUS_ENTITIES) {
  const endpointPath = `/api/data/fetch/${entity}`;
  app.get<{ Querystring: Record<string, string> }>(
    endpointPath,
    async (req, reply) => {
      incrementRequestCount();

      if (LOG_REQUESTS) {
        const qs = new URLSearchParams(req.query as Record<string, string>).toString();
        const mode = recordingConfig ? 'RECORDING' : `scenario=${getScenario()}`;
        console.log(`[mock-genius] GET ${endpointPath}${qs ? `?${qs}` : ''} ${mode}`);
      }

      // Recording mode: proxy to upstream, save raw body to disk, return
      // response transparently to the caller. Failure injection and fixture
      // loading are skipped entirely — recording captures reality, not
      // simulations.
      if (recordingConfig) {
        const result = await proxyAndCapture(recordingConfig, entity, endpointPath, req.query);
        return reply.status(result.status)
          .header('Content-Type', result.contentType)
          .send(result.body);
      }

      const records = loadFixture(entity);

      // 1. Check for a query-string shortcut (one-shot failure)
      const qsFailure = parseQuerystringFailure(endpointPath, req.query);
      if (qsFailure) {
        await applyFailure(qsFailure, reply, records);
        return reply;
      }

      // 2. Check for a queued failure (endpoint-specific, then wildcard)
      const queued = consumeFailureFor(endpointPath);
      if (queued) {
        await applyFailure(queued, reply, records);
        return reply;
      }

      // 3. Normal response — honor pagination. Accept Genius-correct names (pageNumber/pageSize)
      //    and the legacy adapter names (pageIndex/limit) so old and new clients both work.
      const pageIndex = parseInt(req.query.pageNumber ?? req.query.pageIndex ?? '1', 10) || 1;
      const pageSize  = parseInt(req.query.pageSize   ?? req.query.limit     ?? '100', 10) || 100;
      return reply.header('Content-Type', 'application/json')
        .send(geniusPagedEnvelope(records, pageIndex, pageSize));
    }
  );
}

// ── Control endpoints ──────────────────────────────────────────────────────

app.get('/_mock/health', async (_req, reply) => {
  // Health reports the mock's own health, never the upstream's, even in
  // recording mode. Probes against /_mock/health should never proxy.
  if (recordingConfig) {
    return reply.send({ status: 'ok', mode: 'recording' });
  }
  return reply.send({ status: 'ok', scenario: getScenario() });
});

app.get('/_mock/state', async (_req, reply) => {
  if (recordingConfig) {
    const meta = getRecordingMetadata();
    return reply.send({
      mode: 'recording',
      upstreamUrl: recordingConfig.upstreamUrl,
      sessionDir: recordingConfig.sessionDir,
      capturedEndpoints: meta?.endpoints ?? {},
      errors: meta?.errors ?? [],
      requestCount: getRequestCount(),
    });
  }
  return reply.send({
    scenario: getScenario(),
    pendingFailures: getPendingFailures(),
    requestCount: getRequestCount(),
  });
});

app.post<{ Body: { scenario?: string } }>('/_mock/scenario', async (req, reply) => {
  if (recordingConfig) {
    return reply.status(409).send({
      error: 'Scenario switching is disabled in recording mode.',
    });
  }
  const { scenario } = req.body ?? {};
  if (!scenario) {
    return reply.status(400).send({ error: 'Missing scenario field' });
  }
  try {
    setScenario(scenario);
    console.log(`[mock-genius] Scenario switched to: ${scenario}`);
    return reply.send({ scenario: getScenario() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return reply.status(404).send({ error: msg });
  }
});

interface InjectFailureBody {
  endpoint?: string;      // specific path or '*'
  failureType?: FailureType;
  count?: number;
  timeoutMs?: number;
  delayMs?: number;
  records?: number;       // for partial-records
}

app.post<{ Body: InjectFailureBody }>('/_mock/inject-failure', async (req, reply) => {
  if (recordingConfig) {
    return reply.status(409).send({
      error: 'Failure injection is disabled in recording mode.',
    });
  }
  const body = req.body ?? {};
  if (!body.endpoint || !body.failureType) {
    return reply.status(400).send({ error: 'endpoint and failureType are required' });
  }
  const f = enqueueFailure({
    endpoint: body.endpoint,
    failureType: body.failureType,
    count: body.count ?? 1,
    timeoutMs: body.timeoutMs,
    delayMs: body.delayMs,
    records: body.records,
  });
  console.log(`[mock-genius] Injected failure: ${f.failureType} × ${f.count} on ${f.endpoint}`);
  return reply.send({ injected: f });
});

app.post('/_mock/reset', async (_req, reply) => {
  if (recordingConfig) {
    // In recording mode, reset clears in-memory capture tracking only —
    // disk files and request counter stay. Fixture/scenario/failure state
    // don't apply in recording mode.
    resetRecordingMetadata();
    console.log(`[mock-genius] Reset — in-memory capture tracking cleared (disk files untouched)`);
    return reply.send({
      ok: true,
      mode: 'recording',
      sessionDir: recordingConfig.sessionDir,
    });
  }
  resetFailures();
  resetScenario();
  console.log(`[mock-genius] Reset — all injected failures cleared, scenario restored to default`);
  return reply.send({ ok: true, scenario: getScenario() });
});

// ── Start ──────────────────────────────────────────────────────────────────
// Only bind a port when run directly. When imported (tests), the caller
// uses app.inject() or starts the server on an ephemeral port.

export { app };

if (require.main === module) {
  app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    if (recordingConfig) {
      // Loud, unambiguous banner — operators should never mistake which mode
      // they're in. Failure-injection and fixture-loading are explicitly
      // called out as disabled so nobody tries them during a recording session.
      console.log(``);
      console.log(`Mock Genius Server`);
      console.log(`Mode: RECORDING`);
      console.log(`Upstream: ${recordingConfig.upstreamUrl}`);
      console.log(`Record dir: ${recordingConfig.sessionDir}`);
      const authLine = recordingConfig.authUser
        ? `basic (user: ${recordingConfig.authUser})`
        : 'none';
      console.log(`Auth: ${authLine}`);
      console.log(`Timeout: ${recordingConfig.timeoutMs}ms`);
      console.log(``);
      console.log(`Failure injection: DISABLED`);
      console.log(`Fixture loading: DISABLED`);
      console.log(``);
      console.log(`Listening on ${address}`);
    } else {
      console.log(`[mock-genius] Listening on ${address}  scenario: ${getScenario()}`);
      console.log(`[mock-genius] Endpoints:`);
      for (const entity of GENIUS_ENTITIES) {
        console.log(`  GET  ${address}/api/data/fetch/${entity}`);
      }
      console.log(`  GET  ${address}/_mock/health`);
      console.log(`  GET  ${address}/_mock/state`);
      console.log(`  POST ${address}/_mock/scenario`);
      console.log(`  POST ${address}/_mock/inject-failure`);
      console.log(`  POST ${address}/_mock/reset`);
    }
  });
}
