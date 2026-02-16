import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsArray,
  IsString,
  IsNumber,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Where-To ───

export class WhereToConstraintsDto {
  @ApiPropertyOptional({
    description: 'Only consider these resource keys',
    example: ['CNC-02'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  onlyResources?: string[];

  @ApiPropertyOptional({
    description: 'Only options starting after this ISO date',
    example: '2025-02-18T08:00:00',
  })
  @IsOptional()
  @IsString()
  startAfter?: string;

  @ApiPropertyOptional({
    description: 'Only options starting before this ISO date',
    example: '2025-02-20T17:00:00',
  })
  @IsOptional()
  @IsString()
  startBefore?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of options to return',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  maxResults?: number;
}

export class WhereToRequestDto {
  @ApiPropertyOptional({
    description: 'Response detail level',
    enum: ['novice', 'intermediate', 'expert'],
    default: 'novice',
  })
  @IsOptional()
  @IsString()
  @IsIn(['novice', 'intermediate', 'expert'])
  detailLevel?: string;

  @ApiPropertyOptional({
    description: 'Constraints to filter options',
    type: WhereToConstraintsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WhereToConstraintsDto)
  constraints?: WhereToConstraintsDto;
}

export class WhereToResourceDto {
  @ApiProperty() resourceKey!: string;
  @ApiProperty() resourceName!: string;
  @ApiProperty() isPrimary!: boolean;
}

export class WhereToChangeoverDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() duration!: number;
  @ApiProperty() penalty!: number;
}

export class WhereToOptionDto {
  @ApiProperty() rank!: number;
  @ApiProperty({ type: [WhereToResourceDto] }) resources!: WhereToResourceDto[];
  @ApiProperty() start!: string;
  @ApiProperty() end!: string;
  @ApiProperty() latestStart!: string;
  @ApiProperty() latestEnd!: string;
  @ApiProperty() duration!: number;
  @ApiProperty() score!: number;
  @ApiProperty() scoreBreakdown!: Record<string, number>;
  @ApiPropertyOptional({ type: WhereToChangeoverDto, nullable: true })
  changeover!: WhereToChangeoverDto | null;
  @ApiProperty() impact!: { tightensWindow: string[] };
  @ApiProperty() contextHash!: string;
}

export class WhereToCurrentAssignmentDto {
  @ApiProperty({ type: [String] }) resources!: string[];
  @ApiProperty() start!: string;
  @ApiProperty() end!: string;
}

export class WhereToStatsDto {
  @ApiProperty() contextsEvaluated!: number;
  @ApiProperty() feasibleCount!: number;
  @ApiProperty() infeasibleCount!: number;
  @ApiProperty() timeMs!: number;
}

export class WhereToResponseDto {
  @ApiProperty() taskKey!: string;
  @ApiProperty() taskName!: string;
  @ApiPropertyOptional({ type: WhereToCurrentAssignmentDto, nullable: true })
  currentAssignment!: WhereToCurrentAssignmentDto | null;
  @ApiProperty({ type: [WhereToOptionDto] }) options!: WhereToOptionDto[];
  @ApiProperty({ type: WhereToStatsDto }) stats!: WhereToStatsDto;
}

// ─── Move-To ───

export class MoveToRequestDto {
  @ApiProperty({
    description: 'contextHash from a where-to option',
    example: 'OP-001:CNC-01,',
  })
  @IsString()
  contextHash!: string;

  @ApiProperty({
    description: 'Desired start time (ISO date string)',
    example: '2025-02-17T08:00:00',
  })
  @IsString()
  startTime!: string;
}

export class MoveToAssignmentDto {
  @ApiProperty({ type: [String] }) resources!: string[];
  @ApiProperty() start!: string;
  @ApiProperty() end!: string;
}

export class MoveToResponseDto {
  @ApiProperty() taskKey!: string;
  @ApiProperty() success!: boolean;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() suggestRefresh?: boolean;
  @ApiPropertyOptional({ type: MoveToAssignmentDto })
  assignment?: MoveToAssignmentDto;
  @ApiPropertyOptional({ type: WhereToChangeoverDto, nullable: true })
  changeover?: WhereToChangeoverDto | null;
  @ApiPropertyOptional({ type: [String] }) affectedTasks?: string[];
  @ApiPropertyOptional() requiresResolve?: boolean;
}
