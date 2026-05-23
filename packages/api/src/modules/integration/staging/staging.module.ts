import { Module } from '@nestjs/common';
import { ConfigModule } from '../../../config/config.module';
import { ConfigService } from '../../../config/config.service';
import { StagingLifecycleService } from './staging-lifecycle.service';
import { STAGING_ROOT_DIR, StagingService } from './staging.service';
import { SyncOrchestrator } from './sync-orchestrator';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STAGING_ROOT_DIR,
      useFactory: (config: ConfigService) => config.getStagingConfig().rootDir,
      inject: [ConfigService],
    },
    StagingService,
    SyncOrchestrator,
    StagingLifecycleService,
  ],
  exports: [StagingService, SyncOrchestrator],
})
export class StagingModule {}
