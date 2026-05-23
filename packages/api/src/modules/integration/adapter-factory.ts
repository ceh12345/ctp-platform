import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { IDataAdapter } from './adapter.interface';
import { FileAdapter } from './file-adapter';
import { RestAdapter } from './rest-adapter';
import { StagingReadAdapter } from './staging/staging-read.adapter';
import { StagingService } from './staging/staging.service';

@Injectable()
export class AdapterFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly stagingService: StagingService,
  ) {}

  create(): IDataAdapter {
    const config = this.configService.getAdapterConfig();
    if (config?.adapterType === 'rest') {
      return new RestAdapter(config);
    }
    if (config?.adapterType === 'staging-read') {
      return new StagingReadAdapter(this.stagingService, this.configService.getTenantId());
    }
    return new FileAdapter(this.configService);
  }
}
