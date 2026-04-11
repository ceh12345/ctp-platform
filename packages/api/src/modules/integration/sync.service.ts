import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { IRawDataPayload } from './adapter.interface';
import { AdapterFactory } from './adapter-factory';
import { MappingEngine } from './mapping-engine';

@Injectable()
export class SyncService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly mappingEngine: MappingEngine,
    private readonly configService: ConfigService,
  ) {}

  // Full async sync: fetch → map → return transformed payload.
  // StateService.applyTransformed() receives the result and updates the landscape.
  // Phase 1: FileAdapter returns in-memory config data synchronously (wrapped in Promise).
  // Phase 2: RestAdapter makes real HTTP calls; callers must await.
  async sync(): Promise<IRawDataPayload> {
    const adapter = this.adapterFactory.create();
    const raw = await adapter.fetchRawData();
    const profile = this.configService.getMappingProfile();
    return this.mappingEngine.transform(raw, profile);
  }
}
