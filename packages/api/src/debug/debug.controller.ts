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
