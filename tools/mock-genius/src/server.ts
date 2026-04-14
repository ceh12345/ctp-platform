import fastify from 'fastify';
import { getScenario, setScenario, loadFixture } from './fixtures';
import { geniusEnvelope } from './responseFormat';

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
// All four endpoints follow the same pattern: load fixture, wrap in envelope.
// Query params (filter, limit, pageIndex) are accepted but not enforced —
// the mock honours their presence so the adapter can verify it sends them.

const GENIUS_ENTITIES = [
  'salesOrderDetailEntity',
  'workOrderWithAdvancedInformationViewEntity',
  'productionTaskWithAdvancedInfoViewEntity',
  'machineAndRessourceEntity',    // note: Genius typo ("Ressource") preserved
] as const;

for (const entity of GENIUS_ENTITIES) {
  app.get<{ Querystring: Record<string, string> }>(
    `/api/data/fetch/${entity}`,
    async (req, reply) => {
      if (LOG_REQUESTS) {
        const qs = new URLSearchParams(req.query as Record<string, string>).toString();
        console.log(`[mock-genius] GET /api/data/fetch/${entity}${qs ? `?${qs}` : ''} scenario=${getScenario()}`);
      }
      const records = loadFixture(entity);
      return reply.header('Content-Type', 'application/json').send(geniusEnvelope(records));
    }
  );
}

// ── Control endpoints ──────────────────────────────────────────────────────

app.get('/_mock/health', async (_req, reply) => {
  return reply.send({ status: 'ok', scenario: getScenario() });
});

app.get('/_mock/state', async (_req, reply) => {
  return reply.send({ scenario: getScenario() });
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

// ── Start ──────────────────────────────────────────────────────────────────

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
});
