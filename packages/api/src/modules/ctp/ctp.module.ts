import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { StateModule } from '../state/state.module';
import { CTPController } from './ctp.controller';
import { CTPService } from './ctp.service';

@Module({
  imports: [ConfigModule, StateModule],
  controllers: [CTPController],
  providers: [CTPService],
  exports: [CTPService],
})
export class CTPModule {}
