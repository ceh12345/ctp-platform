import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { AdapterFactory } from './adapter-factory';
import { MappingEngine } from './mapping-engine';
import { StagingModule } from './staging/staging.module';
import { SyncService } from './sync.service';

@Module({
  imports: [ConfigModule, StagingModule],
  providers: [MappingEngine, AdapterFactory, SyncService],
  exports: [SyncService],
})
export class IntegrationModule {}
