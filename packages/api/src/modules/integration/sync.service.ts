import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { AdapterFactory } from './adapter-factory';
import { MappingEngine, MappingResult } from './mapping-engine';
import { StagingReadAdapter } from './staging/staging-read.adapter';
import { StagingService } from './staging/staging.service';
import { SyncOrchestrator } from './staging/sync-orchestrator';

@Injectable()
export class SyncService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly mappingEngine: MappingEngine,
    private readonly configService: ConfigService,
    private readonly syncOrchestrator: SyncOrchestrator,
    private readonly stagingService: StagingService,
  ) {}

  async sync(): Promise<MappingResult> {
    const profile = this.configService.getMappingProfile();
    const stagingCfg = this.configService.getStagingConfig();

    if (stagingCfg.enabled) {
      const tenant = this.configService.getTenantId();
      const adapter = this.adapterFactory.create();
      await this.syncOrchestrator.runSync(tenant, adapter);
      const reader = new StagingReadAdapter(this.stagingService, tenant);
      const raw = await reader.fetchRawData();
      return this.mappingEngine.transform(raw, profile);
    }

    const adapter = this.adapterFactory.create();
    const raw = await adapter.fetchRawData();
    return this.mappingEngine.transform(raw, profile);
  }
}
