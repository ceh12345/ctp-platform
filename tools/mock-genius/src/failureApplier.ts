// Applies a queued/injected Failure to an outgoing response.
//
// Each failure type has a well-defined effect documented in the sprint spec.
// Separated from failureInjection.ts so the pure queue logic stays reply-agnostic.

import type { FastifyReply } from 'fastify';
import { Failure } from './failureInjection';
import { geniusEnvelope } from './responseFormat';

// A no-op promise that never resolves — used for the 'timeout' failure.
// Capped at timeoutMs so tests don't wedge forever if the client forgets to
// set its own timeout.
function hang(timeoutMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('mock-genius: hang cap reached')), timeoutMs);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function applyFailure(
  failure: Failure,
  reply: FastifyReply,
  records: unknown[],
): Promise<void> {
  switch (failure.failureType) {
    case '500':
      reply.status(500).header('Content-Type', 'application/json')
        .send({ error: 'Internal Server Error' });
      return;

    case '503':
      reply.status(503).header('Content-Type', 'application/json')
        .send({ error: 'Service Unavailable' });
      return;

    case '401':
      reply.status(401).header('Content-Type', 'application/json')
        .send({ error: 'Unauthorized' });
      return;

    case '429':
      reply.status(429)
        .header('Content-Type', 'application/json')
        .header('Retry-After', '30')
        .send({ error: 'Too Many Requests' });
      return;

    case 'timeout':
      // Hold the socket open until the client times out, capped by timeoutMs
      // so test suites don't block indefinitely.
      await hang(failure.timeoutMs ?? 60_000);
      return;

    case 'slow':
      await delay(failure.delayMs ?? 2_000);
      reply.header('Content-Type', 'application/json').send(geniusEnvelope(records));
      return;

    case 'malformed-json':
      reply.status(200).header('Content-Type', 'application/json')
        .send('{"Result":[{"Id":1,"not_valid');   // intentional: unclosed string + object
      return;

    case 'truncated': {
      // Serialize a valid envelope, then drop the final brace so the client
      // sees a well-formed prefix followed by EOF mid-object.
      const body = JSON.stringify(geniusEnvelope(records));
      reply.status(200).header('Content-Type', 'application/json')
        .send(body.slice(0, -1));
      return;
    }

    case 'wrong-shape':
      // Return a raw array with no Genius envelope. Adapter must tolerate
      // this via its `Array.isArray(data) ? data : []` fallback, OR treat
      // it as an error — either is acceptable; the test asserts what we
      // chose to do.
      reply.status(200).header('Content-Type', 'application/json').send(records);
      return;

    case 'empty-result':
      reply.status(200).header('Content-Type', 'application/json').send(geniusEnvelope([]));
      return;

    case 'partial-records': {
      const n = failure.records ?? 1;
      reply.status(200).header('Content-Type', 'application/json')
        .send(geniusEnvelope(records.slice(0, n)));
      return;
    }
  }
}
