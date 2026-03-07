# Logging Sprint — Part 1: Backend Logger Service

Build a pluggable `LoggerService` that captures AI tool calls, solve events, and API
errors. Transport is configured at deploy time via environment variable. A memory
transport always runs in parallel to feed the in-app debug panel (built in Part 2).

---

## Overview

Four event types are logged:
- **AICallEvent** — every `/ai/chat` request: tools called, params, errors, timing
- **SolveEvent** — every `/ctp/solve`: strategy, timing, feasibility rate
- **APIErrorEvent** — any deliberate 4xx response: endpoint, status, message
- **SystemErrorEvent** — unhandled exceptions, database errors, config failures, startup crashes

One logger, multiple transports, configured at startup:

```
TELEMETRY_TRANSPORT=console        # local dev / data file iteration
TELEMETRY_TRANSPORT=azure-insights # beta clients on Azure
TELEMETRY_TRANSPORT=file           # self-hosted / air-gapped
TELEMETRY_TRANSPORT=none           # silent (memory still runs)
```

Memory transport always runs regardless of `TELEMETRY_TRANSPORT`. It stores the last
200 events in a ring buffer and is read by the debug endpoint (Part 2).

---

## Part 1: Event Interfaces

Create `src/logging/events.ts`:

```typescript
export type LogEventType = 'ai_call' | 'solve' | 'api_error' | 'system_error';

export interface BaseLogEvent {
  type: LogEventType;
  tenantId: string;
  timestamp: string;          // ISO 8601
  sessionId?: string;
}

export interface AIToolCall {
  name: string;
  params: Record<string, any>;
  durationMs: number;
  success: boolean;
  resultSummary?: string;     // e.g. "3 options returned" — not full payload
  error?: string;
}

export interface AICallEvent extends BaseLogEvent {
  type: 'ai_call';
  sessionId: string;
  userMessage: string;
  iterations: number;
  totalDurationMs: number;
  tools: AIToolCall[];
  finalResponseLength: number;
  error?: string;
}

export interface SolveEvent extends BaseLogEvent {
  type: 'solve';
  strategy: string;
  solveTimeMs: number;
  propagationTimeMs?: number;
  taskCount: number;
  scheduledCount: number;
  infeasibleCount: number;
  feasibilityRate: number;
  resourceCount: number;
  horizonDays: number;
  windowsTightened?: number;
  error?: string;
}

export interface APIErrorEvent extends BaseLogEvent {
  type: 'api_error';
  endpoint: string;
  method: string;
  statusCode: number;
  message: string;
  stack?: string;             // only in console/file transports, never sent to client
}

export interface SystemErrorEvent extends BaseLogEvent {
  type: 'system_error';
  severity: 'warning' | 'error' | 'fatal';
  category: 'database' | 'config' | 'engine' | 'ai_provider' | 'unknown';
  message: string;
  stack?: string;             // never sent to client
  context?: Record<string, any>;  // e.g. { query, table } — no PII, no full payloads
}

export type LogEvent = AICallEvent | SolveEvent | APIErrorEvent | SystemErrorEvent;
```

---

## Part 2: Transport Interface

Create `src/logging/transports/transport.interface.ts`:

```typescript
import { LogEvent } from '../events';

export interface LogTransport {
  write(event: LogEvent): void | Promise<void>;
  name: string;
}
```

---

## Part 3: Memory Transport

Create `src/logging/transports/memory.transport.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { LogTransport } from './transport.interface';
import { LogEvent } from '../events';

const MAX_EVENTS = 200;

@Injectable()
export class MemoryTransport implements LogTransport {
  name = 'memory';
  private events: LogEvent[] = [];

  write(event: LogEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
  }

  getEvents(type?: string, limit = 100): LogEvent[] {
    const filtered = type
      ? this.events.filter(e => e.type === type)
      : this.events;
    return filtered.slice(-limit);
  }

  clear(): void {
    this.events = [];
  }

  getSummary() {
    const aiCalls = this.events.filter(e => e.type === 'ai_call');
    const solves = this.events.filter(e => e.type === 'solve');
    const errors = this.events.filter(e => e.type === 'api_error');
    const systemErrors = this.events.filter(e => e.type === 'system_error');
    return {
      totalEvents: this.events.length,
      aiCalls: aiCalls.length,
      solves: solves.length,
      errors: errors.length,
      systemErrors: systemErrors.length,
      oldestEvent: this.events[0]?.timestamp ?? null,
      newestEvent: this.events[this.events.length - 1]?.timestamp ?? null,
    };
  }
}
```

---

## Part 4: Console Transport

Create `src/logging/transports/console.transport.ts`:

```typescript
import { LogTransport } from './transport.interface';
import { LogEvent } from '../events';

export class ConsoleTransport implements LogTransport {
  name = 'console';

  write(event: LogEvent): void {
    // Structured JSON — one line per event, easy to grep
    console.log(JSON.stringify({
      ...event,
      _transport: 'console',
    }));
  }
}
```

---

## Part 5: File Transport

Create `src/logging/transports/file.transport.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { LogTransport } from './transport.interface';
import { LogEvent } from '../events';

export class FileTransport implements LogTransport {
  name = 'file';
  private logDir: string;
  private currentFile: string;

  constructor(logDir = './logs') {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    // New file per day: logs/2026-03-07.jsonl
    const date = new Date().toISOString().split('T')[0];
    this.currentFile = path.join(logDir, `${date}.jsonl`);
  }

  write(event: LogEvent): void {
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.currentFile, line, 'utf8');
  }
}
```

---

## Part 6: Azure Application Insights Transport

Create `src/logging/transports/azure-insights.transport.ts`:

```typescript
import { LogTransport } from './transport.interface';
import { LogEvent, AICallEvent, SolveEvent, APIErrorEvent, SystemErrorEvent } from '../events';

// Only import appinsights if available — graceful fallback if not installed
let appInsights: any = null;
try {
  appInsights = require('applicationinsights');
} catch {
  console.warn('[LoggerService] applicationinsights not installed — azure-insights transport disabled');
}

export class AzureInsightsTransport implements LogTransport {
  name = 'azure-insights';
  private client: any = null;

  constructor(connectionString: string) {
    if (!appInsights) return;
    appInsights.setup(connectionString)
      .setAutoDependencyCorrelation(false)
      .setAutoCollectRequests(false)
      .setAutoCollectPerformance(false)
      .setAutoCollectExceptions(false)
      .start();
    this.client = appInsights.defaultClient;
  }

  write(event: LogEvent): void {
    if (!this.client) return;

    switch (event.type) {
      case 'ai_call':
        this.trackAICall(event as AICallEvent);
        break;
      case 'solve':
        this.trackSolve(event as SolveEvent);
        break;
      case 'api_error':
        this.trackError(event as APIErrorEvent);
        break;
      case 'system_error':
        this.trackSystemError(event as SystemErrorEvent);
        break;
    }
  }

  private trackAICall(e: AICallEvent) {
    this.client.trackEvent({
      name: 'AI_Call',
      properties: {
        tenantId: e.tenantId,
        sessionId: e.sessionId,
        iterations: String(e.iterations),
        toolCount: String(e.tools.length),
        toolNames: e.tools.map(t => t.name).join(','),
        hasError: String(!!e.error),
        error: e.error ?? '',
      },
      measurements: {
        totalDurationMs: e.totalDurationMs,
        responseLength: e.finalResponseLength,
      },
    });

    // Log each failed tool call as a separate event for easy filtering
    for (const tool of e.tools.filter(t => !t.success)) {
      this.client.trackEvent({
        name: 'AI_Tool_Error',
        properties: {
          tenantId: e.tenantId,
          sessionId: e.sessionId,
          toolName: tool.name,
          error: tool.error ?? 'unknown',
          params: JSON.stringify(tool.params),
        },
      });
    }
  }

  private trackSolve(e: SolveEvent) {
    this.client.trackEvent({
      name: 'Solve',
      properties: {
        tenantId: e.tenantId,
        strategy: e.strategy,
        hasError: String(!!e.error),
      },
      measurements: {
        solveTimeMs: e.solveTimeMs,
        feasibilityRate: e.feasibilityRate,
        taskCount: e.taskCount,
        infeasibleCount: e.infeasibleCount,
        windowsTightened: e.windowsTightened ?? 0,
      },
    });
  }

  private trackError(e: APIErrorEvent) {
    this.client.trackException({
      exception: new Error(e.message),
      properties: {
        tenantId: e.tenantId,
        endpoint: e.endpoint,
        method: e.method,
        statusCode: String(e.statusCode),
      },
    });
  }

  private trackSystemError(e: SystemErrorEvent) {
    // Fatal and error severities go as exceptions for alerting
    // Warnings go as events
    if (e.severity === 'warning') {
      this.client.trackEvent({
        name: 'System_Warning',
        properties: {
          tenantId: e.tenantId,
          category: e.category,
          message: e.message,
          context: JSON.stringify(e.context ?? {}),
        },
      });
    } else {
      this.client.trackException({
        exception: new Error(e.message),
        properties: {
          tenantId: e.tenantId,
          severity: e.severity,
          category: e.category,
          context: JSON.stringify(e.context ?? {}),
        },
        severity: e.severity === 'fatal'
          ? appInsights.Contracts.SeverityLevel.Critical
          : appInsights.Contracts.SeverityLevel.Error,
      });
    }
  }
}
```

Install the package only if using Azure:
```bash
npm install applicationinsights
```

---

## Part 7: LoggerService

Create `src/logging/logger.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { LogEvent, AICallEvent, SolveEvent, APIErrorEvent } from './events';
import { LogTransport } from './transports/transport.interface';
import { MemoryTransport } from './transports/memory.transport';
import { ConsoleTransport } from './transports/console.transport';
import { FileTransport } from './transports/file.transport';
import { AzureInsightsTransport } from './transports/azure-insights.transport';

@Injectable()
export class LoggerService implements OnModuleInit {
  private transports: LogTransport[] = [];
  readonly memory: MemoryTransport;

  constructor() {
    // Memory transport always runs
    this.memory = new MemoryTransport();
    this.transports.push(this.memory);
  }

  onModuleInit() {
    const transport = process.env.TELEMETRY_TRANSPORT ?? 'console';
    const endpoint = process.env.TELEMETRY_ENDPOINT ?? '';

    switch (transport) {
      case 'console':
        this.transports.push(new ConsoleTransport());
        break;
      case 'azure-insights':
        if (!endpoint) {
          console.warn('[LoggerService] TELEMETRY_TRANSPORT=azure-insights but TELEMETRY_ENDPOINT not set');
        } else {
          this.transports.push(new AzureInsightsTransport(endpoint));
        }
        break;
      case 'file':
        const logDir = process.env.TELEMETRY_LOG_DIR ?? './logs';
        this.transports.push(new FileTransport(logDir));
        break;
      case 'none':
        // Memory only
        break;
      default:
        console.warn(`[LoggerService] Unknown TELEMETRY_TRANSPORT="${transport}", defaulting to console`);
        this.transports.push(new ConsoleTransport());
    }

    console.log(`[LoggerService] Active transports: ${this.transports.map(t => t.name).join(', ')}`);
  }

  private write(event: LogEvent): void {
    for (const transport of this.transports) {
      try {
        transport.write(event);
      } catch (err) {
        // Never let logging break the app
        console.error(`[LoggerService] Transport ${transport.name} failed:`, err);
      }
    }
  }

  aiCall(event: Omit<AICallEvent, 'type' | 'timestamp'>): void {
    this.write({
      ...event,
      type: 'ai_call',
      timestamp: new Date().toISOString(),
    });
  }

  solve(event: Omit<SolveEvent, 'type' | 'timestamp'>): void {
    this.write({
      ...event,
      type: 'solve',
      timestamp: new Date().toISOString(),
    });
  }

  apiError(event: Omit<APIErrorEvent, 'type' | 'timestamp'>): void {
    this.write({
      ...event,
      type: 'api_error',
      timestamp: new Date().toISOString(),
    });
  }

  systemError(event: Omit<SystemErrorEvent, 'type' | 'timestamp'>): void {
    this.write({
      ...event,
      type: 'system_error',
      timestamp: new Date().toISOString(),
    });
  }
}
```

---

## Part 8: LoggingModule

Create `src/logging/logging.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Global()  // ← global so every module can inject LoggerService without importing
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggingModule {}
```

Import in `AppModule` (or the root module):

```typescript
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [
    LoggingModule,   // ← add this
    // ... existing imports
  ],
})
export class AppModule {}
```

---

## Part 9: Instrument the Solve Endpoint

In `ctp.service.ts`, inject `LoggerService` and log after every solve:

```typescript
import { LoggerService } from '../../logging/logger.service';

@Injectable()
export class CTPService {
  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
    private readonly strategyConfigService: StrategyConfigService,
    private readonly logger: LoggerService,   // ← add
  ) {}

  solve(request?: SolveRequestDto, tenantId = 'unknown'): CTPSolveResult {
    const startTime = Date.now();
    let error: string | undefined;

    try {
      // ... existing solve logic unchanged ...

      const result = this.buildSolveResult(/* ... */);

      // Log solve event
      this.logger.solve({
        tenantId,
        strategy: result.stats?.strategy ?? 'unknown',
        solveTimeMs: result.stats?.totalTimeMs ?? (Date.now() - startTime),
        propagationTimeMs: result.stats?.propagationTimeMs,
        taskCount: result.summary.totalTasks,
        scheduledCount: result.summary.scheduledTasks,
        infeasibleCount: result.summary.unscheduledTasks,
        feasibilityRate: result.summary.feasibilityRate,
        resourceCount: landscape.resources?.length ?? 0,
        horizonDays: Math.round((new Date(result.summary.horizonEnd).getTime() -
          new Date(result.summary.horizonStart).getTime()) / 86400000),
        windowsTightened: result.stats?.windowsTightened,
      });

      return result;
    } catch (err: any) {
      this.logger.solve({
        tenantId,
        strategy: 'unknown',
        solveTimeMs: Date.now() - startTime,
        taskCount: 0, scheduledCount: 0, infeasibleCount: 0,
        feasibilityRate: 0, resourceCount: 0, horizonDays: 0,
        error: err.message,
      });
      throw err;
    }
  }
}
```

The `tenantId` comes from the `X-Tenant-Id` header. Pass it through from the controller:

```typescript
// ctp.controller.ts
import { Headers } from '@nestjs/common';

@Post('solve')
solve(@Body() body?: SolveRequestDto, @Headers('x-tenant-id') tenantId = 'unknown') {
  return this.ctpService.solve(body, tenantId);
}
```

---

## Part 10: Instrument the AI Chat Endpoint

The AI chat endpoint already calls Claude with tool use. Wrap it to capture the full
tool call sequence. The exact file will be wherever the `/ai/chat` route is handled
(likely `src/ai/ai.service.ts` or similar).

Add structured logging around the tool-use loop:

```typescript
import { LoggerService } from '../../logging/logger.service';

// In the AI service, after the full tool-use loop completes:

const toolCalls: AIToolCall[] = [];

// Inside the tool-use loop, after each tool call:
toolCalls.push({
  name: toolName,
  params: toolParams,
  durationMs: toolDurationMs,
  success: !toolError,
  resultSummary: buildResultSummary(toolName, toolResult),
  error: toolError?.message,
});

// After the loop, log the full call:
this.logger.aiCall({
  tenantId,
  sessionId: body.sessionId ?? 'no-session',
  userMessage: body.message,
  iterations,
  totalDurationMs: Date.now() - callStart,
  tools: toolCalls,
  finalResponseLength: finalText.length,
  error: topLevelError?.message,
});
```

`buildResultSummary` returns a short human-readable string per tool, not the full
payload:

```typescript
function buildResultSummary(toolName: string, result: any): string {
  switch (toolName) {
    case 'where_can_task_go':
      return `${result?.options?.length ?? 0} options returned`;
    case 'get_resource_agenda':
      return `${result?.assignments?.length ?? 0} assignments found`;
    case 'get_chain_detail':
      return `${result?.phases?.length ?? 0} phases in chain`;
    case 'find_available_resources':
      return `${result?.resources?.length ?? 0} resources available`;
    case 'query_resources':
      return `${result?.resources?.length ?? 0} resources matched`;
    case 'analyze_impact':
      return `impact: ${result?.freedResources?.length ?? 0} resources freed`;
    case 'compare_tasks':
      return `${result?.tasks?.length ?? 0} tasks compared`;
    default:
      return 'ok';
  }
}
```

---

## Part 11: Global Exception Filter

Catches everything that escapes normal error handling — unhandled promise rejections,
unexpected throws, database driver errors. Registered globally so no exception is silent.

Create `src/logging/all-exceptions.filter.ts`:

```typescript
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { LoggerService } from './logger.service';
import { SystemErrorEvent } from './events';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof Error
      ? exception.message
      : 'Unknown error';

    const stack = exception instanceof Error ? exception.stack : undefined;

    // Only log unhandled (non-deliberate) exceptions as system_error
    // Deliberate HttpExceptions (4xx thrown by services) are api_error, not system_error
    if (!(exception instanceof HttpException)) {
      this.logger.systemError({
        tenantId: request?.headers?.['x-tenant-id'] ?? 'unknown',
        severity: 'fatal',
        category: categorizeError(message),
        message,
        stack,
        context: {
          endpoint: request?.url,
          method: request?.method,
        },
      });
    }

    // Never leak stack traces or internal messages to the client
    response.status(status).json({
      statusCode: status,
      message: status >= 500 ? 'Internal server error' : message,
    });
  }
}

function categorizeError(message: string): SystemErrorEvent['category'] {
  const m = message.toLowerCase();
  if (
    m.includes('connect') || m.includes('postgres') ||
    m.includes('database') || m.includes('relation') ||
    m.includes('column') || m.includes('query') ||
    m.includes('econnrefused') || m.includes('pg ')
  ) return 'database';
  if (
    m.includes('config') || m.includes('json') ||
    m.includes('parse') || m.includes('no such file') ||
    m.includes('enoent')
  ) return 'config';
  if (
    m.includes('anthropic') || m.includes('rate limit') ||
    m.includes('api key') || m.includes('overloaded') ||
    m.includes('529') || m.includes('529')
  ) return 'ai_provider';
  if (
    m.includes('engine') || m.includes('landscape') ||
    m.includes('scheduler') || m.includes('horizon') ||
    m.includes('ctptask') || m.includes('ctpresource')
  ) return 'engine';
  return 'unknown';
}
```

Register in `main.ts` after the app is created:

```typescript
import { AllExceptionsFilter } from './logging/all-exceptions.filter';
import { LoggerService } from './logging/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Register global exception filter using the already-initialized LoggerService
  const loggerService = app.get(LoggerService);
  app.useGlobalFilters(new AllExceptionsFilter(loggerService));

  // ... rest of setup
  await app.listen(3000);
}
```

---

## Part 12: Database Query Logger (TypeORM)

Add this when PostgreSQL is integrated. Placeholder now so the pattern is established.

Create `src/logging/database-logger.ts`:

```typescript
import { Logger as TypeOrmLogger } from 'typeorm';
import { LoggerService } from './logger.service';

const SLOW_QUERY_THRESHOLD_MS = 1000;

export class DatabaseQueryLogger implements TypeOrmLogger {
  constructor(private readonly logger: LoggerService) {}

  logQueryError(error: string, query: string, _parameters?: any[]) {
    this.logger.systemError({
      tenantId: 'system',
      severity: 'error',
      category: 'database',
      message: `Query error: ${error}`,
      context: {
        // Truncate query — never log with parameter values (PII risk)
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

  // Required by TypeORM interface — no-ops for now
  logQuery() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}
```

Wire into TypeORM config when database is added:

```typescript
TypeOrmModule.forRootAsync({
  useFactory: (logger: LoggerService) => ({
    // ... connection config
    logger: new DatabaseQueryLogger(logger),
  }),
  inject: [LoggerService],
})
```

---

## Part 13: Startup Error Capture

Config file parse failures and missing env vars happen before any HTTP request exists
and before `LoggerService` is initialized. Write directly to file as a fallback.

In `main.ts`, wrap the entire bootstrap in try/catch:

```typescript
import * as fs from 'fs';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule);
    const loggerService = app.get(LoggerService);
    app.useGlobalFilters(new AllExceptionsFilter(loggerService));
    // ... rest of setup
    await app.listen(3000);
    console.log('[Bootstrap] Server started successfully');
  } catch (err: any) {
    // LoggerService not available — write directly to file
    const logDir = process.env.TELEMETRY_LOG_DIR ?? './logs';
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const event = {
      type: 'system_error',
      severity: 'fatal',
      category: guessStartupCategory(err.message),
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
      tenantId: 'system',
      context: { phase: 'startup' },
    };

    fs.appendFileSync(
      `${logDir}/startup-errors.jsonl`,
      JSON.stringify(event) + '\n',
      'utf8',
    );

    console.error('[Bootstrap] FATAL STARTUP ERROR:', err.message);
    console.error('[Bootstrap] Written to', `${logDir}/startup-errors.jsonl`);
    process.exit(1);
  }
}

function guessStartupCategory(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('json') || m.includes('parse') ||
      m.includes('enoent') || m.includes('config')) return 'config';
  if (m.includes('postgres') || m.includes('connect') ||
      m.includes('database')) return 'database';
  return 'unknown';
}

bootstrap();
```

---

## Part 14: Debug Endpoint

Add a `GET /debug/logs` endpoint that the frontend debug panel will call.
This endpoint is only active when `NODE_ENV !== 'production'` OR when the
`X-Debug-Key` header matches `DEBUG_KEY` environment variable.

Create `src/debug/debug.controller.ts`:

```typescript
import { Controller, Get, Delete, Query, Headers, ForbiddenException } from '@nestjs/common';
import { LoggerService } from '../logging/logger.service';

@Controller('debug')
export class DebugController {
  constructor(private readonly logger: LoggerService) {}

  private checkAccess(debugKey: string) {
    const expected = process.env.DEBUG_KEY;
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && debugKey !== expected) {
      throw new ForbiddenException('Debug access denied');
    }
  }

  @Get('logs')
  getLogs(
    @Query('type') type?: string,
    @Query('limit') limit = '100',
    @Headers('x-debug-key') debugKey = '',
  ) {
    this.checkAccess(debugKey);
    return {
      events: this.logger.memory.getEvents(type, parseInt(limit)),
      summary: this.logger.memory.getSummary(),
    };
  }

  @Delete('logs')
  clearLogs(@Headers('x-debug-key') debugKey = '') {
    this.checkAccess(debugKey);
    this.logger.memory.clear();
    return { cleared: true };
  }

  @Get('config')
  getConfig(@Headers('x-debug-key') debugKey = '') {
    this.checkAccess(debugKey);
    return {
      transport: process.env.TELEMETRY_TRANSPORT ?? 'console',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      appVersion: process.env.APP_VERSION ?? 'unknown',
    };
  }
}
```

Create `src/debug/debug.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';

@Module({
  controllers: [DebugController],
})
export class DebugModule {}
```

Import in `AppModule`.

---

## Part 15: Environment Variables Reference

Add to `.env.example`:

```bash
# Logging / Telemetry
# Options: console | azure-insights | file | none
TELEMETRY_TRANSPORT=console

# Required when TELEMETRY_TRANSPORT=azure-insights
# Value: your Application Insights connection string
TELEMETRY_ENDPOINT=

# Required when TELEMETRY_TRANSPORT=file
# Default: ./logs
TELEMETRY_LOG_DIR=./logs

# Debug panel access key (optional in dev, required in prod)
DEBUG_KEY=your-secret-key-here

# App version shown in debug panel
APP_VERSION=0.1.0
```

---

## Verification Checklist

- [ ] `LoggingModule` is `@Global()` and imported in `AppModule`
- [ ] `LoggerService` injects cleanly into `CTPService` and AI service
- [ ] `TELEMETRY_TRANSPORT=console` — structured JSON appears in stdout on every solve and AI call
- [ ] `TELEMETRY_TRANSPORT=none` — no stdout output but memory transport still populates
- [ ] `TELEMETRY_TRANSPORT=file` — `./logs/YYYY-MM-DD.jsonl` file created and appended
- [ ] `TELEMETRY_TRANSPORT=azure-insights` — events visible in Application Insights (if connection string valid)
- [ ] `GET /debug/logs` returns last N events from memory
- [ ] `GET /debug/logs?type=ai_call` filters correctly
- [ ] `GET /debug/logs?type=system_error` returns system errors only
- [ ] `DELETE /debug/logs` clears memory transport
- [ ] A failed tool call in an AI conversation appears in `ai_call` event `tools` array with `success: false` and `error` populated
- [ ] A solve appears in memory within the same request cycle
- [ ] Throwing an unhandled error in a controller produces a `system_error` event with correct category
- [ ] Deliberate `HttpException` (404, 400) does NOT produce a `system_error` event
- [ ] Database connection failure (simulate with bad port) produces `system_error` with `category: "database"`
- [ ] Config JSON parse failure produces `system_error` with `category: "config"`
- [ ] Startup crash writes to `./logs/startup-errors.jsonl` and exits with code 1
- [ ] `AllExceptionsFilter` never leaks stack traces in HTTP response body
- [ ] Logging never throws — all transport errors are caught and printed to stderr only
- [ ] In production (`NODE_ENV=production`), `GET /debug/logs` without correct `X-Debug-Key` returns 403

---

## Size Estimate

- Event interfaces (+ SystemErrorEvent): ~10 min
- Memory + Console + File transports: ~20 min
- Azure Insights transport (+ system_error tracking): ~25 min
- LoggerService + LoggingModule: ~15 min
- Instrument solve endpoint: ~15 min
- Instrument AI chat endpoint: ~20 min
- Global exception filter + categorizeError: ~20 min
- Database query logger stub: ~10 min
- Startup error capture in main.ts: ~10 min
- Debug controller + module: ~15 min
- Env config + verification: ~10 min
- **Total: ~2.5 hours**
