import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { StateModule } from '../state/state.module';
import { InspectorExportController } from './inspector-export.controller';
import { InspectorExportService } from './inspector-export.service';

@Module({
  imports: [ConfigModule, StateModule],
  controllers: [InspectorExportController],
  providers: [InspectorExportService],
})
export class InspectorModule {}
