import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('utilization')
  @ApiOperation({ summary: 'Resource utilization grouped by hierarchy' })
  @ApiQuery({ name: 'hierarchy', required: false, description: 'Filter by hierarchy1 group name' })
  @ApiQuery({ name: 'date', required: false, description: 'Filter by date (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Utilization data per resource group' })
  getUtilization(
    @Query('hierarchy') hierarchy?: string,
    @Query('date') date?: string,
  ) {
    return this.analyticsService.getUtilization({ hierarchy, date });
  }

  @Get('scheduling')
  @ApiOperation({ summary: 'Scheduling quality metrics (on-time, turnovers, feasibility)' })
  @ApiResponse({ status: 200, description: 'Scheduling metrics' })
  getScheduling() {
    return this.analyticsService.getScheduling();
  }

  @Get('chains')
  @ApiOperation({ summary: 'Case/order chain integrity — gaps between phases' })
  @ApiQuery({ name: 'caseKey', required: false, description: 'Filter by specific case/order key' })
  @ApiResponse({ status: 200, description: 'Chain integrity data with gap analysis' })
  getChains(@Query('caseKey') caseKey?: string) {
    return this.analyticsService.getChains({ caseKey });
  }

  @Get('summary')
  @ApiOperation({ summary: 'All KPI summary values for the analytics catalog' })
  @ApiResponse({ status: 200, description: 'KPI summary list with status indicators' })
  getSummary() {
    return this.analyticsService.getSummary();
  }

  @Get('critical-path')
  @ApiOperation({ summary: 'Critical path analysis for Analytics tab' })
  @ApiResponse({ status: 200, description: 'Critical path analysis with resource breakdown and slack distribution' })
  getCriticalPathAnalytics() {
    return this.analyticsService.getCriticalPathAnalytics();
  }

  @Get('cost')
  @ApiOperation({ summary: 'Cost analysis — resource cost breakdown by resource and order' })
  @ApiResponse({ status: 200, description: 'Cost analytics with per-resource and per-order breakdown' })
  getCostAnalytics() {
    return this.analyticsService.getCostAnalytics();
  }
}
