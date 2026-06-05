import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { AdapterFactory } from './adapter-factory';
import { MappingEngine, MappingResult } from './mapping-engine';
import { crossFilterByActiveJobs } from './cross-filter';

@Injectable()
export class SyncService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly mappingEngine: MappingEngine,
    private readonly configService: ConfigService,
  ) {}

  // Full async sync: fetch → cross-filter → map → return transformed payload + mapping errors.
  // StateService.applyTransformed() receives payload; mapping errors flow into
  // the sync result (Sprint 1a plumbs the channel; Sprint 1b populates it from
  // `toUTC` on !isValid).
  async sync(): Promise<MappingResult> {
    const adapter = this.adapterFactory.create();
    const raw = await adapter.fetchRawData();
    const filtered = crossFilterByActiveJobs(raw);
    const profile = this.configService.getMappingProfile();
    return this.mappingEngine.transform(filtered, profile);
  }
}
