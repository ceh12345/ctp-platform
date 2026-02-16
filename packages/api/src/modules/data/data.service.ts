import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { StrategyConfigService } from '../../config/strategy-config.service';
import {
  IProductData,
  IOrderData,
  IMaterialData,
} from '../../config/interfaces/config-store.interface';
import { StrategyConfig } from '../../config/interfaces/strategy.interface';

@Injectable()
export class DataService {
  constructor(
    private readonly configService: ConfigService,
    private readonly strategyConfigService: StrategyConfigService,
  ) {}

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

  getStrategies(): { strategies: StrategyConfig[]; defaultStrategy: string } {
    return this.strategyConfigService.getStrategiesForTenant();
  }
}
