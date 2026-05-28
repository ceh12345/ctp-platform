import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import * as versionInfo from '../../version.json';
import { TenantHealthService } from './tenant-health.service';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly tenantHealth: TenantHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('tenant')
  @ApiOperation({ summary: 'Per-tenant runtime health: config, data layout, entity files, engine landscape' })
  @ApiResponse({ status: 200, description: 'Health report; check `status` field for healthy/degraded/unhealthy' })
  tenant() {
    return this.tenantHealth.build();
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
