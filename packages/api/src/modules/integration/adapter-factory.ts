import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { IDataAdapter } from './adapter.interface';
import { FileAdapter } from './file-adapter';

@Injectable()
export class AdapterFactory {
  constructor(private readonly configService: ConfigService) {}

  create(): IDataAdapter {
    const config = this.configService.getAdapterConfig();
    // Phase 1: only 'file' type exists. Null config (no adapter.json) also defaults to file.
    // Phase 2 adds: if (config?.adapterType === 'rest') return new RestAdapter(config, ...)
    if (!config || config.adapterType === 'file') {
      return new FileAdapter(this.configService);
    }
    // Fallback to file for any unknown type in Phase 1
    return new FileAdapter(this.configService);
  }
}
