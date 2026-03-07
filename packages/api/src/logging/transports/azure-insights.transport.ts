import { LogTransport } from './transport.interface';
import { LogEvent, AICallEvent, SolveEvent, APIErrorEvent, SystemErrorEvent } from '../events';

// Only import appinsights if available — graceful fallback if not installed
let appInsights: any = null;
try {
  appInsights = require('applicationinsights');
} catch {
  // Will warn at construction time if transport is selected
}

export class AzureInsightsTransport implements LogTransport {
  name = 'azure-insights';
  private client: any = null;

  constructor(connectionString: string) {
    if (!appInsights) {
      console.warn('[LoggerService] applicationinsights not installed — azure-insights transport disabled');
      return;
    }
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
