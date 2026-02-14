import { Controller, Post, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StateService } from './state.service';

@ApiTags('State')
@Controller('state')
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Post('sync')
  @ApiOperation({ summary: 'Sync scheduling state from config files' })
  @ApiResponse({ status: 201, description: 'State loaded successfully' })
  sync() {
    return this.stateService.syncFromConfig();
  }

  @Post('reload')
  @ApiOperation({ summary: 'Reload config files and rebuild state' })
  @ApiResponse({ status: 201, description: 'State reloaded successfully' })
  reload() {
    return this.stateService.reloadAndSync();
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get current landscape summary' })
  @ApiResponse({ status: 200, description: 'Current state summary' })
  summary() {
    return this.stateService.getSummary();
  }
}
