import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { DataService } from './data.service';
import { DataController } from './data.controller';

@Module({
  imports: [ConfigModule],
  controllers: [DataController],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
