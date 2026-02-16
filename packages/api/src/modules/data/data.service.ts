import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import {
  IProductData,
  IOrderData,
  IMaterialData,
} from '../../config/interfaces/config-store.interface';

@Injectable()
export class DataService {
  constructor(private readonly configService: ConfigService) {}

  getProducts(): IProductData[] {
    return this.configService.getProducts();
  }

  getOrders(): IOrderData[] {
    return this.configService.getOrders();
  }

  getMaterials(): IMaterialData[] {
    return this.configService.getMaterials();
  }

  getColors(): any {
    return this.configService.getColors();
  }

  getTerminology(): any {
    return this.configService.getTerminology();
  }

  getLocale(): any {
    return this.configService.getLocale();
  }

  getStrategies(): any {
    return this.configService.getStrategies();
  }
}
