import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HierarchySlotDto {
  @ApiProperty() slot!: 1 | 2 | 3 | 4 | 5;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) value!: string | null;
}

export class AttributeDto {
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) value!: string | null;
}

export class OrdersRowDto {
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) groupKey?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'WorkOrderGroup display name (for grouped-mode summary rows)' })
  groupName?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'WorkOrderGroup sourceEnd (for grouped-mode due-date column)' })
  groupSourceEnd?: string | null;
  @ApiPropertyOptional({ nullable: true }) parentOrderKey?: string | null;
  @ApiProperty({ description: 'True when parentOrderKey === key (head of chain)' })
  isHead!: boolean;
  @ApiPropertyOptional({ nullable: true }) dueDate?: string | null;
  /** Customer promise from the sales-order line — what a late-delivery
   *  penalty is measured against. Null on internal / stock / rework work. */
  @ApiPropertyOptional({ nullable: true }) customerDeliveryDate?: string | null;
  /** Earliest scheduled start across the order's tasks (null before a solve). */
  @ApiPropertyOptional({ nullable: true }) projectedStart?: string | null;
  /** Latest scheduled end across the order's tasks (null before a solve). */
  @ApiPropertyOptional({ nullable: true }) projectedEnd?: string | null;
  @ApiPropertyOptional({ nullable: true }) statusLabel?: string | null;
  @ApiPropertyOptional({ nullable: true }) quantityPlanned?: number | null;
  @ApiProperty({ type: [HierarchySlotDto] }) hierarchies!: HierarchySlotDto[];
  @ApiProperty({ type: [AttributeDto] }) attributes!: AttributeDto[];
}

export class OrdersListResponseDto {
  @ApiProperty() totalCount!: number;
  @ApiProperty() filteredCount!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: [OrdersRowDto] }) rows!: OrdersRowDto[];
}

export class DistinctValueDto {
  @ApiProperty({ nullable: true, type: String }) value!: string | null;
  @ApiProperty() count!: number;
}

export class DistinctResponseDto {
  @ApiProperty() column!: string;
  @ApiProperty({ type: [DistinctValueDto] }) values!: DistinctValueDto[];
  @ApiProperty() truncated!: boolean;
}
