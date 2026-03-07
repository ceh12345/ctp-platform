// Placeholder for TypeORM database query logger — wire in when PostgreSQL is integrated.

import { LoggerService } from './logger.service';

const SLOW_QUERY_THRESHOLD_MS = 1000;

export class DatabaseQueryLogger {
  constructor(private readonly logger: LoggerService) {}

  logQueryError(error: string, query: string, _parameters?: any[]) {
    this.logger.systemError({
      tenantId: 'system',
      severity: 'error',
      category: 'database',
      message: `Query error: ${error}`,
      context: {
        query: query.slice(0, 300),
      },
    });
  }

  logQuerySlow(time: number, query: string, _parameters?: any[]) {
    if (time >= SLOW_QUERY_THRESHOLD_MS) {
      this.logger.systemError({
        tenantId: 'system',
        severity: 'warning',
        category: 'database',
        message: `Slow query: ${time}ms`,
        context: {
          query: query.slice(0, 300),
          durationMs: time,
        },
      });
    }
  }

  logQuery() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}
