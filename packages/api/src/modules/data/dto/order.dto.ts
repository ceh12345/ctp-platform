import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderDto {
  @ApiProperty({ description: 'Order key' })
  key!: string;

  @ApiProperty({ description: 'Order name' })
  name!: string;

  @ApiProperty({ description: 'Product key demanded' })
  productKey!: string;

  @ApiProperty({ description: 'Demand quantity' })
  demandQty!: number;

  @ApiProperty({ description: 'Due date (ISO 8601)' })
  dueDate!: string;

  @ApiPropertyOptional({ description: 'Late due date (ISO 8601)' })
  lateDueDate?: string;

  @ApiPropertyOptional({ description: 'Priority (lower = higher priority)' })
  priority?: number;
}
