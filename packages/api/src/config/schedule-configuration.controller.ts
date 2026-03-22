import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { ScheduleConfigurationService } from './schedule-configuration.service';

@ApiTags('configurations')
@Controller('configurations')
export class ScheduleConfigurationController {
  constructor(private readonly configService: ScheduleConfigurationService) {}

  @Get()
  @ApiOperation({ summary: 'List all schedule configurations for the tenant' })
  @ApiResponse({ status: 200, description: 'Configuration list with active key' })
  getAll() {
    return this.configService.getAll();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a single configuration by key' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiResponse({ status: 200, description: 'Full configuration object' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  getByKey(@Param('key') key: string) {
    const config = this.configService.getByKey(key);
    if (!config) return { status: 'not_found' };
    return config;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new schedule configuration' })
  @ApiBody({ description: 'Configuration data with required name field' })
  @ApiResponse({ status: 201, description: 'Created configuration' })
  @ApiResponse({ status: 409, description: 'Configuration key already exists' })
  create(@Body() body: any) {
    return this.configService.create(body);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Update an existing configuration (partial update)' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiBody({ description: 'Partial configuration data' })
  @ApiResponse({ status: 200, description: 'Updated configuration' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  update(@Param('key') key: string, @Body() body: any) {
    return this.configService.update(key, body);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete a configuration' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiResponse({ status: 200, description: 'Configuration deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete default configuration' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  delete(@Param('key') key: string) {
    this.configService.delete(key);
    return { status: 'deleted', key };
  }

  @Post(':key/activate')
  @ApiOperation({ summary: 'Set this configuration as active for the current session' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiResponse({ status: 200, description: 'Configuration activated' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  activate(@Param('key') key: string) {
    this.configService.activate(key);
    return { status: 'activated', key };
  }

  @Post(':key/set-default')
  @ApiOperation({ summary: 'Make this configuration the tenant default' })
  @ApiParam({ name: 'key', description: 'Configuration key' })
  @ApiResponse({ status: 200, description: 'Default updated' })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  setDefault(@Param('key') key: string) {
    this.configService.setDefault(key);
    return { status: 'default_set', key };
  }
}
