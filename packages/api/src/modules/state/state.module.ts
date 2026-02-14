import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { StateController } from './state.controller';
import { StateService } from './state.service';
import { StateHydratorService } from './state-hydrator.service';

@Module({
  imports: [ConfigModule],
  controllers: [StateController],
  providers: [StateHydratorService, StateService],
  exports: [StateService],
})
export class StateModule {}
