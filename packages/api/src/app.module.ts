import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { StateModule } from './modules/state/state.module';
import { ConfigModule } from './config/config.module';
import { CTPModule } from './modules/ctp/ctp.module';
import { DataModule } from './modules/data/data.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AIModule } from './modules/ai/ai.module';
import { LoggingModule } from './logging/logging.module';
import { DebugModule } from './debug/debug.module';
import { TenantMiddleware } from './config/tenant.middleware';

@Module({
  imports: [LoggingModule, HealthModule, StateModule, ConfigModule, CTPModule, DataModule, AnalyticsModule, AIModule, DebugModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
