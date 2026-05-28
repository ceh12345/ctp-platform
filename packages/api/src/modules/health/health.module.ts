import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { StateModule } from '../state/state.module';
import { HealthController } from './health.controller';
import { TenantHealthService } from './tenant-health.service';

@Module({
  imports: [ConfigModule, StateModule],
  controllers: [HealthController],
  providers: [TenantHealthService],
})
export class HealthModule {}
