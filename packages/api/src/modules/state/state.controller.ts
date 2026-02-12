import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StateService } from './state.service';
import { SyncStateDto } from './dto/sync-state.dto';

@ApiTags('State')
@Controller('state')
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Post('sync')
  @ApiOperation({ summary: 'Sync full scheduling state' })
  @ApiResponse({ status: 201, description: 'State loaded successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  sync(@Body() dto: SyncStateDto) {
    return this.stateService.sync(dto);
  }
}
