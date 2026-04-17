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

    const [salesOrders, tasks, resources] = await Promise.all([
      this.fetchAllPages(`${baseUrl}${endpoints.salesOrders?.path ?? ''}`, endpoints.salesOrders?.pageSize ?? 100, timeout, retries, retryDelay),
      this.fetchAllPages(`${baseUrl}${endpoints.tasks?.path ?? ''}`, endpoints.tasks?.pageSize ?? 200, timeout, retries, retryDelay),
      this.fetchAllPages(`${baseUrl}${endpoints.resources?.path ?? ''}`, endpoints.resources?.pageSize ?? 100, timeout, retries, retryDelay),
    ]);

    return {
      orders:         salesOrders,
      tasks,
      resources,
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
  ): Promise<unknown[]> {
    if (!url || url.endsWith('/')) return [];

    let page = 1;
    let totalPages = 1;
    const results: unknown[] = [];

    do {
      const fullUrl = `${url}?limit=${pageSize}&pageIndex=${page}`;
      const data = await this.fetchWithRetry(fullUrl, timeout, retries, retryDelay);
      const records: unknown[] = data?.Result ?? (Array.isArray(data) ? data : []);
      results.push(...records);
      totalPages = data?.PagingInfos?.TotalPagesFound ?? 1;
      page++;
    } while (page <= totalPages);

    return results;
  }

  private async fetchWithRetry(url: string, timeout: number, maxRetries: number, retryDelay: number): Promise<any> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
        return await response.json();
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }
}
