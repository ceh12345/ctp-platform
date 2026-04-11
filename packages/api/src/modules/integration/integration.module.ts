import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { AdapterFactory } from './adapter-factory';
import { MappingEngine } from './mapping-engine';
import { SyncService } from './sync.service';

@Module({
  imports: [ConfigModule],
  providers: [MappingEngine, AdapterFactory, SyncService],
  exports: [SyncService],
})
export class IntegrationModule {}
