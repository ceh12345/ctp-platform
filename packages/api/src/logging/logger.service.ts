import { Injectable, OnModuleInit } from '@nestjs/common';
import { LogEvent, AICallEvent, SolveEvent, APIErrorEvent, SystemErrorEvent } from './events';
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
      case 'file': {
        const logDir = process.env.TELEMETRY_LOG_DIR ?? './logs';
        this.transports.push(new FileTransport(logDir));
        break;
      }
      case 'none':
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
