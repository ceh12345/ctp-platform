import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StateChangeDto {
  @ApiProperty({ example: 'Machines' })
  @IsString()
  resourceType!: string;

  @ApiPropertyOptional({ example: 'PROCESS CHANGE', description: 'Default: PROCESS CHANGE' })
  @IsOptional()
  @IsString()
  changeType?: string;

  @ApiProperty({ example: 'ProductA' })
  @IsString()
  fromState!: string;

  @ApiProperty({ example: 'ProductB' })
  @IsString()
  toState!: string;

  @ApiPropertyOptional({ example: 0, description: 'Duration in seconds (default 0)' })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiPropertyOptional({ example: 0, description: 'Penalty (default 0)' })
  @IsOptional()
  @IsNumber()
  penalty?: number;
}
