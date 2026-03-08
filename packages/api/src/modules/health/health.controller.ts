import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import * as versionInfo from '../../version.json';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('version')
  @ApiOperation({ summary: 'Get application version and build info' })
  getVersion() {
    return {
      version: versionInfo.version,
      fullVersion: versionInfo.fullVersion,
      gitHash: versionInfo.gitHash,
      gitBranch: versionInfo.gitBranch,
      buildDate: versionInfo.buildDate,
      nodeVersion: process.version,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
