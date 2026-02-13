import { Module } from '@nestjs/common';
import * as path from 'path';
import { FileConfigStore } from './file-config-store';
import { ConfigService } from './config.service';

@Module({
  providers: [
    {
      provide: 'CONFIG_STORE',
      useFactory: () => {
        const tenantId = process.env.TENANT_ID ?? 'default';
        const configRoot =
          process.env.CONFIG_ROOT ??
          path.join(process.cwd(), '..', '..', 'config');
        return new FileConfigStore(configRoot, tenantId);
      },
    },
    ConfigService,
  ],
  exports: ['CONFIG_STORE', ConfigService],
})
export class ConfigModule {}
