import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { StateModule } from './modules/state/state.module';
import { ConfigModule } from './config/config.module';
import { CTPModule } from './modules/ctp/ctp.module';

@Module({
  imports: [HealthModule, StateModule, ConfigModule, CTPModule],
})
export class AppModule {}
