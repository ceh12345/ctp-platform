import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { StateModule } from './modules/state/state.module';
import { ConfigModule } from './config/config.module';
import { CTPModule } from './modules/ctp/ctp.module';
import { DataModule } from './modules/data/data.module';
import { TenantMiddleware } from './config/tenant.middleware';

@Module({
  imports: [HealthModule, StateModule, ConfigModule, CTPModule, DataModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
