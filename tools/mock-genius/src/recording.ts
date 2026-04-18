// Recording mode for mock-genius.
//
// When MOCK_RECORD_FROM is set, the mock stops serving fixtures and starts
// acting as a transparent proxy: forward request to upstream, save raw
// response body to disk, return response unchanged to caller.
//
// Checkpoint A scope (shipped):
//   - Proxy + capture one file per entity (no pagination, no metadata).
//   - Raw envelope captured as-is (fixture extraction is strip-envelope.js).
//   - 502 on unreachable, 504 on timeout, pass-through on upstream errors.
//
// Checkpoint B scope (this file):
//   - Incremental _metadata.json writes per endpoint completion.
//   - Multi-page detection → {entity}_page{N}.json files.
//   - In-memory capture state exposed via getRecordingMetadata() for /_mock/state.
//   - resetRecordingMetadata() clears in-memory state; disk files untouched.

import * as fs from 'fs';
import * as path from 'path';

export interface RecordingConfig {
  upstreamUrl: string;
  sessionDir: string;
  authUser?: string;
  authPass?: string;
  timeoutMs: number;
}

export interface ProxyResult {
  status: number;
  body: string;
  contentType: string;
}

export interface EndpointCapture {
  status: number;
  recordCount: number;
  pages: number;
  queryParams: Record<string, string>;
  durationMs: number;
}

export interface CaptureError {
  endpoint: string;
  message: string;
  status?: number;
}

export interface CaptureMetadata {
  capturedAt: string;
  upstreamUrl: string;
  endpoints: Record<string, EndpointCapture>;
  errors: CaptureError[];
}

// Session timestamp: YYYY-MM-DDTHH-MM-SS (colons→dashes for Windows).
function computeSessionTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').slice(0, 19);
}

let cachedConfig: RecordingConfig | null | undefined = undefined;

export function isRecordingEnabled(): boolean {
  return !!process.env.MOCK_RECORD_FROM;
}

export function buildRecordingConfig(): RecordingConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  if (!isRecordingEnabled()) {
    cachedConfig = null;
    return null;
  }
  const baseDir    = process.env.MOCK_RECORD_DIR ?? path.resolve(process.cwd(), 'recorded');
  const sessionDir = path.resolve(baseDir, computeSessionTimestamp());
  fs.mkdirSync(sessionDir, { recursive: true });
  cachedConfig = {
    upstreamUrl: process.env.MOCK_RECORD_FROM!,
    sessionDir,
    authUser:    process.env.MOCK_RECORD_AUTH_USER,
    authPass:    process.env.MOCK_RECORD_AUTH_PASS,
    timeoutMs:   parseInt(process.env.MOCK_RECORD_TIMEOUT ?? '60000', 10),
  };
  return cachedConfig;
}

export function _resetConfigForTests(): void {
  cachedConfig = undefined;
}

// ── Metadata state ─────────────────────────────────────────────────────────

let metadata: CaptureMetadata | null = null;

// Serialized write queue. Multiple endpoint handlers calling
// writeMetadataToDisk concurrently would otherwise race on the file; the chain
// ensures each write sees the latest in-memory state and completes in order.
let writeQueue: Promise<void> = Promise.resolve();

function ensureMetadata(config: RecordingConfig): CaptureMetadata {
  if (metadata === null) {
    metadata = {
      capturedAt:  new Date().toISOString(),
      upstreamUrl: config.upstreamUrl,
      endpoints:   {},
      errors:      [],
    };
  }
  return metadata;
}

export function getRecordingMetadata(): CaptureMetadata | null {
  return metadata;
}

// Reset in-memory capture tracking. Disk files are NOT deleted — the spec
// calls this out explicitly. Use this when you want the metadata to reflect
// a fresh session without restarting the process.
export function resetRecordingMetadata(): void {
  metadata = null;
}

function writeMetadataToDisk(sessionDir: string): void {
  const snapshot = metadata ? JSON.parse(JSON.stringify(metadata)) : null;
  if (!snapshot) return;
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.promises.writeFile(
        path.join(sessionDir, '_metadata.json'),
        JSON.stringify(snapshot, null, 2),
      );
    } catch (err: any) {
      console.error(`[mock-genius] Failed to persist metadata: ${err?.message ?? err}`);
    }
  });
}

function recordEndpoint(config: RecordingConfig, entity: string, capture: EndpointCapture): void {
  const meta = ensureMetadata(config);
  meta.endpoints[entity] = capture;
  writeMetadataToDisk(config.sessionDir);
}

function recordError(config: RecordingConfig, err: CaptureError): void {
  const meta = ensureMetadata(config);
  meta.errors.push(err);
  writeMetadataToDisk(config.sessionDir);
}

// ── Proxy ──────────────────────────────────────────────────────────────────

export async function proxyAndCapture(
  config: RecordingConfig,
  entity: string,
  requestPath: string,
  query: Record<string, string | string[] | undefined>,
): Promise<ProxyResult> {
  const url = buildUpstreamUrl(config.upstreamUrl, requestPath, query);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.authUser && config.authPass) {
    headers.Authorization = 'Basic ' +
      Buffer.from(`${config.authUser}:${config.authPass}`).toString('base64');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const startedAt = Date.now();
  let status: number;
  let body: string;
  let contentType: string;

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    status      = response.status;
    body        = await response.text();
    contentType = response.headers.get('content-type') ?? 'application/json';
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    const errStatus = isTimeout ? 504 : 502;
    const errMsg = isTimeout
      ? `Recording mode: upstream timeout after ${config.timeoutMs}ms fetching ${url}`
      : `Recording mode: upstream unreachable at ${url}. Check VPN connection and MOCK_RECORD_FROM.`;

    recordError(config, { endpoint: entity, message: errMsg, status: errStatus });

    return {
      status: errStatus,
      body: JSON.stringify({ error: errMsg }),
      contentType: 'application/json',
    };
  }

  const durationMs = Date.now() - startedAt;

  // Inspect the body to detect pagination and extract record count. A response
  // that isn't Genius-shaped (e.g. a raw string, or an error body) is saved
  // as-is with recordCount 0 and a single page.
  const parsed = safeParseJson(body);
  const pagination = detectPagination(parsed, query);
  const recordCount = extractRecordCount(parsed);

  // Save body to disk. Multi-page → {entity}_page{N}.json; single-page → {entity}.json.
  const fileName = pagination.totalPages > 1
    ? `${entity}_page${pagination.currentPage}.json`
    : `${entity}.json`;
  void persistResponseBody(config.sessionDir, fileName, body);

  // Track the capture. For multi-page endpoints, the "pages" field accumulates
  // across requests to the same entity — we keep a running max of totalPages
  // and count how many distinct page files we've written.
  const prior = metadata?.endpoints[entity];
  const pagesSeen = Math.max(prior?.pages ?? 0, pagination.totalPages);
  const capture: EndpointCapture = {
    status,
    recordCount: (prior?.recordCount ?? 0) + recordCount,
    pages: pagesSeen,
    queryParams: flattenQuery(query),
    durationMs: (prior?.durationMs ?? 0) + durationMs,
  };
  recordEndpoint(config, entity, capture);

  return { status, body, contentType };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildUpstreamUrl(
  upstreamBase: string,
  requestPath: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach(val => qs.append(k, val));
    else qs.append(k, v);
  }
  const qsStr = qs.toString();
  const base = upstreamBase.endsWith('/') ? upstreamBase.slice(0, -1) : upstreamBase;
  return `${base}${requestPath}${qsStr ? '?' + qsStr : ''}`;
}

async function persistResponseBody(sessionDir: string, fileName: string, body: string): Promise<void> {
  const filePath = path.join(sessionDir, fileName);
  try {
    await fs.promises.writeFile(filePath, body);
  } catch (err: any) {
    console.error(`[mock-genius] Failed to persist ${filePath}: ${err?.message ?? err}`);
  }
}

function safeParseJson(body: string): any {
  try { return JSON.parse(body); } catch { return null; }
}

function detectPagination(
  parsed: any,
  query: Record<string, string | string[] | undefined>,
): { currentPage: number; totalPages: number } {
  const paging = parsed?.PagingInfos;
  const totalPages  = typeof paging?.TotalPagesFound === 'number' ? paging.TotalPagesFound : 1;
  // Prefer the upstream's CurrentPageIndex; fall back to the request's pageIndex.
  const upstreamPage = typeof paging?.CurrentPageIndex === 'number' ? paging.CurrentPageIndex : null;
  const requestPage  = parsePageFromQuery(query);
  const currentPage  = upstreamPage ?? requestPage ?? 1;
  return { currentPage, totalPages };
}

function parsePageFromQuery(query: Record<string, string | string[] | undefined>): number | null {
  const raw = query.pageIndex;
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractRecordCount(parsed: any): number {
  if (Array.isArray(parsed)) return parsed.length;
  if (Array.isArray(parsed?.Result)) return parsed.Result.length;
  return 0;
}

function flattenQuery(query: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(',') : v;
  }
  return out;
}
