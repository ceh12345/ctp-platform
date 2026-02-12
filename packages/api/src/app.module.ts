import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { StateModule } from './modules/state/state.module';

@Module({
  imports: [HealthModule, StateModule],
})
export class AppModule {}
