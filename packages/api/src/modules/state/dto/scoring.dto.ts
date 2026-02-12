import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScoringRuleDto {
  @ApiProperty({ example: 'EarliestStartTimeScoringRule' })
  @IsString()
  ruleName!: string;

  @ApiProperty({ example: 0.3 })
  @IsNumber()
  weight!: number;

  @ApiPropertyOptional({ example: 0, description: '0=MINIMIZE, 1=MAXIMIZE (default 0)' })
  @IsOptional()
  @IsNumber()
  objective?: number;

  @ApiPropertyOptional({ example: true, description: 'Include in solve (default true)' })
  @IsOptional()
  @IsBoolean()
  includeInSolve?: boolean;

  @ApiPropertyOptional({ example: 0, description: 'Penalty factor (default 0)' })
  @IsOptional()
  @IsNumber()
  penaltyFactor?: number;
}

export class ScoringDto {
  @ApiProperty({ example: 'Default Scoring' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'default-scoring' })
  @IsString()
  key!: string;

  @ApiProperty({ type: [ScoringRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoringRuleDto)
  rules!: ScoringRuleDto[];
}
