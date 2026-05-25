import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { AdapterFactory } from './adapter-factory';
import { MappingEngine, MappingResult } from './mapping-engine';

@Injectable()
export class SyncService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly mappingEngine: MappingEngine,
    private readonly configService: ConfigService,
  ) {}

  async sync(): Promise<MappingResult> {
    const profile = this.configService.getMappingProfile();
    const adapter = this.adapterFactory.create();
    const raw = await adapter.fetchRawData();
    return this.mappingEngine.transform(raw, profile);
  }
}
