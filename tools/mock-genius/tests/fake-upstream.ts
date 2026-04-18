// Test helper: a tiny Fastify server on an ephemeral port that acts as the
// upstream in recording-mode tests. Lets tests inject canned responses,
// capture the headers and query parameters the mock forwarded, and exercise
// the proxy end-to-end without needing real Genius or live VPN.

import fastify, { FastifyInstance, FastifyRequest } from 'fastify';

export interface CannedResponse {
  status?: number;
  body: unknown;              // object → JSON-stringified; string → sent as-is
  headers?: Record<string, string>;
  delayMs?: number;           // delay before responding (for timeout tests)
}

export type ResponseSelector = CannedResponse | ((req: FastifyRequest) => CannedResponse | Promise<CannedResponse>);

export interface FakeUpstream {
  url: string;
  readonly lastHeaders: Record<string, string>;
  readonly requestCount: number;
  readonly requestUrls: string[];
  setResponse(pathPrefix: string, selector: ResponseSelector): void;
  close(): Promise<void>;
}

export async function startFakeUpstream(): Promise<FakeUpstream> {
  const app: FastifyInstance = fastify({ logger: false });

  const responses = new Map<string, ResponseSelector>();
  let lastHeaders: Record<string, string> = {};
  let requestCount = 0;
  const requestUrls: string[] = [];

  app.all('*', async (req, reply) => {
    requestCount++;
    lastHeaders = { ...(req.headers as Record<string, string>) };
    requestUrls.push(req.url);

    // Prefix match, longest first
    const pathOnly = req.url.split('?')[0];
    const prefixes = [...responses.keys()].sort((a, b) => b.length - a.length);
    const matched = prefixes.find(p => pathOnly.startsWith(p));
    if (!matched) {
      return reply.status(404).send({ error: `no canned response for ${pathOnly}` });
    }

    const selector = responses.get(matched)!;
    const chosen = typeof selector === 'function' ? await selector(req) : selector;

    if (chosen.delayMs) {
      await new Promise(r => setTimeout(r, chosen.delayMs));
    }
    if (chosen.headers) {
      for (const [k, v] of Object.entries(chosen.headers)) reply.header(k, v);
    }
    return reply.status(chosen.status ?? 200).send(chosen.body);
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('fake upstream failed to bind');
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    get lastHeaders() { return lastHeaders; },
    get requestCount() { return requestCount; },
    get requestUrls() { return requestUrls; },
    setResponse(pathPrefix, selector) { responses.set(pathPrefix, selector); },
    close: async () => { await app.close(); },
  };
}

// Convenience: wrap records into a Genius-shape envelope.
export function envelope<T>(records: T[], opts: { currentPage?: number; totalPages?: number; pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 100;
  const currentPage = opts.currentPage ?? 1;
  const totalPages  = opts.totalPages ?? 1;
  return {
    Result: records,
    Messages: [],
    PagingInfos: {
      CurrentPageIndex: currentPage,
      PageSize: pageSize,
      TotalElementsFound: records.length,
      TotalPagesFound: totalPages,
    },
    Tag: null,
  };
}
