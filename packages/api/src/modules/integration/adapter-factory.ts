import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { IDataAdapter } from './adapter.interface';
import { FileAdapter } from './file-adapter';
import { RestAdapter } from './rest-adapter';

@Injectable()
export class AdapterFactory {
  constructor(private readonly configService: ConfigService) {}

  create(): IDataAdapter {
    const config = this.configService.getAdapterConfig();
    if (config?.adapterType === 'rest') {
      return new RestAdapter(config);
    }
    return new FileAdapter(this.configService);
  }
}
