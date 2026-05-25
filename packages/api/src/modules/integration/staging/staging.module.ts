import { Module } from '@nestjs/common';
import { ConfigModule } from '../../../config/config.module';
import { StagingLifecycleService } from './staging-lifecycle.service';

// During beta, the only runtime concern is ensuring each tenant's data/current
// symlink exists at boot. StagingService + ValidationRunner + pointer abstraction
// remain as substrate for the future cleanse tool (CLI), which constructs them
// directly without DI.
@Module({
  imports: [ConfigModule],
  providers: [StagingLifecycleService],
})
export class StagingModule {}
