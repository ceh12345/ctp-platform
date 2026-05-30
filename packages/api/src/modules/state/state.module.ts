import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { IntegrationModule } from '../integration/integration.module';
import { StateController } from './state.controller';
import { StateService } from './state.service';
import { StateHydratorService } from './state-hydrator.service';
import { WorkOrderGroupService } from './workordergroup.service';

@Module({
  imports: [ConfigModule, IntegrationModule],
  controllers: [StateController],
  providers: [StateHydratorService, StateService, WorkOrderGroupService],
  exports: [StateService, WorkOrderGroupService],
})
export class StateModule {}
