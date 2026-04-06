import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { StateModule } from '../state/state.module';
import { CTPController } from './ctp.controller';
import { CTPService } from './ctp.service';
import { OptimizeController } from './optimize.controller';
import { OptimizeService } from './optimize.service';

@Module({
  imports: [ConfigModule, StateModule],
  controllers: [CTPController, OptimizeController],
  providers: [CTPService, OptimizeService],
  exports: [CTPService],
})
export class CTPModule {}
