import { IsString, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IntervalDto {
  @ApiProperty({ example: '2025-06-02T08:00:00', description: 'ISO 8601 start time' })
  @IsString()
  startTime!: string;

  @ApiProperty({ example: '2025-06-02T16:00:00', description: 'ISO 8601 end time' })
  @IsString()
  endTime!: string;

  @ApiPropertyOptional({ example: 1, description: 'Quantity (default 1)' })
  @IsOptional()
  @IsNumber()
  qty?: number;

  @ApiPropertyOptional({ example: 0, description: 'Run rate (default 0)' })
  @IsOptional()
  @IsNumber()
  runRate?: number;
}

export class ResourceDto {
  @ApiProperty({ example: 'Machine-A' })
  @IsString()
  key!: string;

  @ApiProperty({ example: 'Machine A' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Machines', description: 'Resource type group' })
  @IsString()
  type!: string;

  @ApiProperty({ example: 'REUSABLE', description: 'REUSABLE or CONSUMABLE' })
  @IsString()
  resourceClass!: string;

  @ApiPropertyOptional({ example: 'Group-1', description: 'Maps to hierarchy.first' })
  @IsOptional()
  @IsString()
  hierarchyGroup?: string;

  @ApiProperty({ type: [IntervalDto], description: 'Original availability windows' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntervalDto)
  availability!: IntervalDto[];

  @ApiPropertyOptional({ type: [IntervalDto], description: 'Existing committed assignments' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntervalDto)
  assignments?: IntervalDto[];
}
