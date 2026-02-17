import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { StateModule } from '../state/state.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [ConfigModule, StateModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
