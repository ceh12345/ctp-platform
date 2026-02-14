import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BOMInputDto {
  @ApiProperty({ description: 'Input product key' })
  productKey!: string;

  @ApiProperty({ description: 'Quantity per unit of output' })
  qtyPer!: number;

  @ApiPropertyOptional({ description: 'Scrap rate for this input (0.02 = 2%)' })
  scrapRate?: number;
}

export class ProductDto {
  @ApiProperty({ description: 'Product key' })
  key!: string;

  @ApiProperty({ description: 'Product name' })
  name!: string;

  @ApiProperty({ description: 'Product type: RAW, INTERMEDIATE, or FINISHED' })
  productType!: string;

  @ApiProperty({ description: 'Unit of measure' })
  unitOfMeasure!: string;

  @ApiPropertyOptional({ description: 'Output scrap rate (0.03 = 3%)' })
  outputScrapRate?: number;

  @ApiProperty({ description: 'Bill of materials inputs', type: [BOMInputDto] })
  bomInputs!: BOMInputDto[];
}
