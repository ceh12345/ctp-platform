import { IDataAdapter, IRawDataPayload } from './adapter.interface';
import { IAdapterConfig } from '../../config/interfaces/config-store.interface';

export class RestAdapter implements IDataAdapter {
  readonly adapterType = 'rest';

  constructor(private readonly config: IAdapterConfig) {}

  async fetchRawData(): Promise<IRawDataPayload> {
    const baseUrl = (this.config.connection?.baseUrl as string) ?? '';
    const endpoints = (this.config.endpoints ?? {}) as Record<string, { path: string; pageSize?: number }>;
    const timeout = (this.config.connection?.timeout as number) ?? 30000;
    const retries = (this.config.connection?.retries as number) ?? 3;
    const retryDelay = (this.config.connection?.retryDelay as number) ?? 2000;
    // Pagination param names default to Genius conventions. Per-tenant override via connection.{pageSizeParam,pageNumberParam}.
    const pageSizeParam   = (this.config.connection?.pageSizeParam   as string) ?? 'pageSize';
    const pageNumberParam = (this.config.connection?.pageNumberParam as string) ?? 'pageNumber';

    // Each slot is fetched only when its `path` is configured. An unconfigured
    // slot returns []; we do NOT fall back to fetching baseUrl bare (would 404).
    const buildUrl = (path: string | undefined) => (path ? `${baseUrl}${path}` : '');

    const [salesOrders, tasks, resources, jobs, operations, salesOrderLines] = await Promise.all([
      this.fetchAllPages(buildUrl(endpoints.salesOrders?.path), endpoints.salesOrders?.pageSize ?? 100, timeout, retries, retryDelay, pageSizeParam, pageNumberParam),
      this.fetchAllPages(buildUrl(endpoints.tasks?.path),       endpoints.tasks?.pageSize       ?? 200, timeout, retries, retryDelay, pageSizeParam, pageNumberParam),
      this.fetchAllPages(buildUrl(endpoints.resources?.path),   endpoints.resources?.pageSize   ?? 100, timeout, retries, retryDelay, pageSizeParam, pageNumberParam),
      this.fetchAllPages(buildUrl(endpoints.jobs?.path),        endpoints.jobs?.pageSize        ?? 100, timeout, retries, retryDelay, pageSizeParam, pageNumberParam),
      this.fetchAllPages(buildUrl(endpoints.operations?.path),  endpoints.operations?.pageSize  ?? 100, timeout, retries, retryDelay, pageSizeParam, pageNumberParam),
      this.fetchAllPages(buildUrl(endpoints.salesOrderLines?.path), endpoints.salesOrderLines?.pageSize ?? 100, timeout, retries, retryDelay, pageSizeParam, pageNumberParam),
    ]);

    return {
      orders:         salesOrders,
      tasks,
      resources,
      jobs,
      operations,
      salesOrderLines,
      calendars:      [],
      stateChanges:   [],
      products:       [],
      materials:      [],
      processes:      [],
      cadences:       [],
      uomConversions: null,
    };
  }

  private async fetchAllPages(
    url: string,
    pageSize: number,
    timeout: number,
    retries: number,
    retryDelay: number,
    pageSizeParam: string,
    pageNumberParam: string,
  ): Promise<unknown[]> {
    if (!url || url.endsWith('/')) return [];

    let page = 1;
    let totalPages = 1;
    const results: unknown[] = [];

    do {
      const sep = url.includes('?') ? '&' : '?';
      const fullUrl = `${url}${sep}${pageSizeParam}=${pageSize}&${pageNumberParam}=${page}`;
      const data = await this.fetchWithRetry(fullUrl, timeout, retries, retryDelay);
      const records: unknown[] = data?.Result ?? (Array.isArray(data) ? data : []);
      results.push(...records);
      totalPages = data?.PagingInfos?.TotalPagesFound ?? 1;
      page++;
    } while (page <= totalPages);

    return results;
  }

  private async fetchWithRetry(url: string, timeout: number, maxRetries: number, retryDelay: number): Promise<any> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let response: Response;
        try {
          response = await fetch(url, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          const err: any = new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
          err.status = response.status;
          // 4xx are permanent (auth, not-found, bad request) — except 408 Request Timeout
          // and 429 Too Many Requests, which are transient and should be retried.
          err.retryable =
            response.status >= 500 ||
            response.status < 400 ||
            response.status === 408 ||
            response.status === 429;
          throw err;
        }
        try {
          return await response.json();
        } catch (parseErr: any) {
          throw new Error(`Invalid JSON from ${url}: ${parseErr.message}`, { cause: parseErr });
        }
      } catch (err: any) {
        // AbortError from the timeout controller — wrap with context before retry/throw
        if (err?.name === 'AbortError') {
          lastError = new Error(`Timeout after ${timeout}ms fetching ${url}`, { cause: err });
          // AbortError from a timeout is transient — let it retry
        } else {
          lastError = err;
        }
        // Non-retryable errors short-circuit the retry loop (saves ~6s on auth failures)
        if (err?.retryable === false) break;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }
}
