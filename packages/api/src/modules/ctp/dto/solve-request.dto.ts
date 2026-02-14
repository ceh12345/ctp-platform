import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsArray,
  IsString,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SolveTaskFilterDto {
  @ApiPropertyOptional({
    description: 'Typed attribute name to filter on',
    example: 'productType',
  })
  @IsString()
  attribute!: string;

  @ApiPropertyOptional({
    description: 'Value to match (single value or array for "in" operator)',
    example: 'Widget-A',
  })
  value!: any;

  @ApiPropertyOptional({
    description: 'Comparison operator',
    enum: ['equals', 'in', 'greaterThan', 'lessThan'],
    default: 'equals',
  })
  @IsOptional()
  @IsString()
  @IsIn(['equals', 'in', 'greaterThan', 'lessThan'])
  operator?: string;
}

export class SolveRequestDto {
  @ApiPropertyOptional({
    description: 'Specific task keys to schedule',
    example: ['OP-001', 'OP-003'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taskKeys?: string[];

  @ApiPropertyOptional({
    description: 'Filter tasks by typed attribute value',
    type: SolveTaskFilterDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SolveTaskFilterDto)
  filter?: SolveTaskFilterDto;
}
