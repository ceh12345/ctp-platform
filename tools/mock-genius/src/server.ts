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

const PORT = parseInt(process.env.MOCK_PORT ?? '8080', 10);
const LOG_REQUESTS = process.env.MOCK_LOG_REQUESTS !== 'false';

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
        console.log(`[mock-genius] GET ${endpointPath}${qs ? `?${qs}` : ''} scenario=${getScenario()}`);
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

      // 3. Normal response — honor pagination via pageIndex/limit
      const pageIndex = parseInt(req.query.pageIndex ?? '1', 10) || 1;
      const pageSize  = parseInt(req.query.limit ?? '100', 10) || 100;
      return reply.header('Content-Type', 'application/json')
        .send(geniusPagedEnvelope(records, pageIndex, pageSize));
    }
  );
}

// ── Control endpoints ──────────────────────────────────────────────────────

app.get('/_mock/health', async (_req, reply) => {
  return reply.send({ status: 'ok', scenario: getScenario() });
});

app.get('/_mock/state', async (_req, reply) => {
  return reply.send({
    scenario: getScenario(),
    pendingFailures: getPendingFailures(),
    requestCount: getRequestCount(),
  });
});

app.post<{ Body: { scenario?: string } }>('/_mock/scenario', async (req, reply) => {
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
  });
}
