import { ConfigService } from '../../config/config.service';
import { IDataAdapter, IRawDataPayload } from './adapter.interface';

export class FileAdapter implements IDataAdapter {
  readonly adapterType = 'file';

  constructor(private readonly configService: ConfigService) {}

  async fetchRawData(): Promise<IRawDataPayload> {
    return {
      resources:      this.configService.getResources(),
      tasks:          this.configService.getTasks(),
      calendars:      this.configService.getCalendars(),
      stateChanges:   this.configService.getStateChanges(),
      products:       this.configService.getProducts(),
      orders:         this.configService.getOrders(),
      materials:      this.configService.getMaterials(),
      processes:      this.configService.getProcesses(),
      cadences:       this.configService.getCadences(),
      uomConversions: this.configService.getUomConversions(),
    };
  }
}
