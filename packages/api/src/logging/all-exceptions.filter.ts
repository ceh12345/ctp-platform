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

    // Check if HttpException already carries structured error envelope
    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;

    const isStructured = typeof exceptionResponse === 'object'
      && exceptionResponse !== null
      && 'error' in exceptionResponse;

    const errorBody = isStructured
      ? exceptionResponse  // Already structured — pass through
      : {
          error: {
            code: status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN',
            message: exception instanceof Error ? exception.message : 'Unknown error',
            category: status >= 500 ? 'system' : 'engine',
            timestamp: new Date().toISOString(),
            tenant: request?.headers?.['x-tenant-id'] ?? 'unknown',
          },
        };

    // Only log unhandled (non-deliberate) exceptions as system_error
    if (!(exception instanceof HttpException)) {
      const message = exception instanceof Error ? exception.message : 'Unknown error';
      const stack = exception instanceof Error ? exception.stack : undefined;
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

    response.status(status).send(errorBody);
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
    m.includes('529')
  ) return 'ai_provider';
  if (
    m.includes('engine') || m.includes('landscape') ||
    m.includes('scheduler') || m.includes('horizon') ||
    m.includes('ctptask') || m.includes('ctpresource')
  ) return 'engine';
  return 'unknown';
}
