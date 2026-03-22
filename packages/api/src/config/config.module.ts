import { Module } from '@nestjs/common';
import * as path from 'path';
import { FileConfigStore } from './file-config-store';
import { ConfigService } from './config.service';
import { StrategyConfigService } from './strategy-config.service';
import { ScheduleConfigurationService } from './schedule-configuration.service';
import { ScheduleConfigurationController } from './schedule-configuration.controller';

@Module({
  controllers: [ScheduleConfigurationController],
  providers: [
    {
      provide: 'CONFIG_STORE',
      useFactory: () => {
        const tenantId = process.env.TENANT_ID ?? 'demo-manufacturing';
        const configRoot =
          process.env.CONFIG_ROOT ??
          path.join(process.cwd(), '..', '..', 'config');
        return new FileConfigStore(configRoot, tenantId);
      },
    },
    ConfigService,
    StrategyConfigService,
    ScheduleConfigurationService,
  ],
  exports: ['CONFIG_STORE', ConfigService, StrategyConfigService, ScheduleConfigurationService],
})
export class ConfigModule {}
