import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { StateModule } from './modules/state/state.module';
import { ConfigModule } from './config/config.module';
import { CTPModule } from './modules/ctp/ctp.module';
import { DataModule } from './modules/data/data.module';

@Module({
  imports: [HealthModule, StateModule, ConfigModule, CTPModule, DataModule],
})
export class AppModule {}
