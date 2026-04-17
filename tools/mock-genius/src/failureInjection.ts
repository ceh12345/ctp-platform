// Failure injection engine for mock-genius.
//
// State is module-level and mutable (single-process test server).
// Queues are per-endpoint plus a wildcard queue. When a request arrives:
//   1. Consume one failure from the matching endpoint queue if present
//   2. Otherwise consume one from the wildcard queue if present
//   3. Otherwise let the normal fixture response flow
//
// `count` controls how many times a queued failure fires before being
// removed from the queue. `count: 1` (default) is single-shot.

export type FailureType =
  | '500'
  | '503'
  | '401'
  | '429'
  | 'timeout'
  | 'slow'
  | 'malformed-json'
  | 'truncated'
  | 'wrong-shape'
  | 'empty-result'
  | 'partial-records';

export interface Failure {
  failureType: FailureType;
  endpoint: string;         // specific path (e.g. "/api/data/fetch/salesOrderDetailEntity") or "*"
  count: number;            // remaining fires before the failure is removed
  timeoutMs?: number;       // for 'timeout' — cap at this value (default 60_000)
  delayMs?: number;         // for 'slow' — delay before normal response (default 2_000)
  records?: number;         // for 'partial-records' — how many records to return (default 1)
}

// endpoint → FIFO queue
const queues = new Map<string, Failure[]>();

// Request counter (for /_mock/state introspection)
let requestCount = 0;

export function incrementRequestCount(): void {
  requestCount++;
}

export function getRequestCount(): number {
  return requestCount;
}

export function enqueueFailure(failure: Omit<Failure, 'count'> & { count?: number }): Failure {
  const f: Failure = { count: 1, ...failure };
  const key = f.endpoint;
  const q = queues.get(key) ?? [];
  q.push(f);
  queues.set(key, q);
  return f;
}

// Consume one failure for the given request path.
// Endpoint-specific queue wins over wildcard.
export function consumeFailureFor(path: string): Failure | null {
  const f = peekAndConsume(path) ?? peekAndConsume('*');
  return f;
}

function peekAndConsume(key: string): Failure | null {
  const q = queues.get(key);
  if (!q || q.length === 0) return null;
  const head = q[0];
  head.count -= 1;
  if (head.count <= 0) q.shift();
  if (q.length === 0) queues.delete(key);
  return head;
}

export function resetFailures(): void {
  queues.clear();
  requestCount = 0;
}

export function getPendingFailures(): Failure[] {
  const all: Failure[] = [];
  for (const q of queues.values()) all.push(...q);
  return all;
}

// Parse a query-string one-shot failure: ?_mock_fail=500 or ?_mock_delay=5000.
// Returns a Failure applied once, or null if no shortcut present.
export function parseQuerystringFailure(
  endpoint: string,
  query: Record<string, string | undefined>,
): Failure | null {
  if (query._mock_fail) {
    return {
      failureType: query._mock_fail as FailureType,
      endpoint,
      count: 1,
      records: query._mock_records ? parseInt(query._mock_records, 10) : undefined,
    };
  }
  if (query._mock_delay) {
    return {
      failureType: 'slow',
      endpoint,
      count: 1,
      delayMs: parseInt(query._mock_delay, 10),
    };
  }
  return null;
}
