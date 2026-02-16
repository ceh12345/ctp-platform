import { Module } from '@nestjs/common';
import * as path from 'path';
import { FileConfigStore } from './file-config-store';
import { ConfigService } from './config.service';
import { StrategyConfigService } from './strategy-config.service';

@Module({
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
  ],
  exports: ['CONFIG_STORE', ConfigService, StrategyConfigService],
})
export class ConfigModule {}
