import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DataService } from './data.service';
import { ProductDto } from './dto/product.dto';
import { OrderDto } from './dto/order.dto';
import { MaterialDto } from './dto/material.dto';

@ApiTags('data')
@Controller('data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  @Get('products')
  @ApiOperation({ summary: 'List all products (BOM hierarchy)' })
  @ApiResponse({ status: 200, description: 'Product list', type: [ProductDto] })
  getProducts() {
    return this.dataService.getProducts();
  }

  @Get('orders')
  @ApiOperation({ summary: 'List all work orders / demand' })
  @ApiResponse({ status: 200, description: 'Order list', type: [OrderDto] })
  getOrders() {
    return this.dataService.getOrders();
  }

  @Get('materials')
  @ApiOperation({ summary: 'List raw material inventory' })
  @ApiResponse({ status: 200, description: 'Material list', type: [MaterialDto] })
  getMaterials() {
    return this.dataService.getMaterials();
  }

  @Get('colors')
  @ApiOperation({ summary: 'Get tenant color configuration' })
  @ApiResponse({ status: 200, description: 'Color config' })
  getColors() {
    return this.dataService.getColors();
  }

  @Get('terminology')
  @ApiOperation({ summary: 'Get tenant terminology configuration' })
  @ApiResponse({ status: 200, description: 'Terminology config' })
  getTerminology() {
    return this.dataService.getTerminology();
  }

  @Get('locale')
  @ApiOperation({ summary: 'Get tenant locale configuration' })
  @ApiResponse({ status: 200, description: 'Locale config' })
  getLocale() {
    return this.dataService.getLocale();
  }

  @Get('strategies')
  @ApiOperation({ summary: 'Get solver strategies available to current tenant' })
  @ApiResponse({ status: 200, description: 'Strategy list with default' })
  getStrategies() {
    return this.dataService.getStrategies();
  }
}
