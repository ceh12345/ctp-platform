import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResourcePreferenceDto {
  @ApiProperty({ example: 'Machine-A' })
  @IsString()
  resourceKey!: string;

  @ApiPropertyOptional({ example: 1.0, description: 'Speed factor (default 1.0)' })
  @IsOptional()
  @IsNumber()
  speedFactor?: number;
}

export class TaskResourceDto {
  @ApiProperty({ example: 'Machines', description: 'Resource type — matches resource.type' })
  @IsString()
  resourceType!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isPrimary!: boolean;

  @ApiProperty({ type: [ResourcePreferenceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourcePreferenceDto)
  preferences!: ResourcePreferenceDto[];
}

export class DurationDto {
  @ApiProperty({ example: 7200, description: 'Duration in seconds' })
  @IsNumber()
  seconds!: number;

  @ApiPropertyOptional({ example: 1.0, description: 'Quantity (default 1.0)' })
  @IsOptional()
  @IsNumber()
  qty?: number;

  @ApiPropertyOptional({ example: 0, description: 'Duration type (default FIXED_DURATION = 0)' })
  @IsOptional()
  @IsNumber()
  durationType?: number;
}

export class WindowDto {
  @ApiProperty({ example: '2025-06-02T00:00:00' })
  @IsString()
  startTime!: string;

  @ApiProperty({ example: '2025-06-09T00:00:00' })
  @IsString()
  endTime!: string;
}

export class LinkDto {
  @ApiProperty({ example: 'JOB-100', description: 'Link group name' })
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ example: 'JOB-100-OP10', description: 'Key of predecessor task' })
  @IsString()
  prevLink!: string;
}

export class TaskDto {
  @ApiProperty({ example: 'JOB-100-OP10' })
  @IsString()
  key!: string;

  @ApiProperty({ example: 'Job 100 Op 10' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'PROCESS', description: 'Task type (default PROCESS)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  sequence!: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  rank?: number;

  @ApiProperty({ type: DurationDto })
  @ValidateNested()
  @Type(() => DurationDto)
  duration!: DurationDto;

  @ApiPropertyOptional({ type: WindowDto, description: 'Task window (defaults to horizon)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => WindowDto)
  window?: WindowDto;

  @ApiProperty({ type: [TaskResourceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskResourceDto)
  capacityResources!: TaskResourceDto[];

  @ApiPropertyOptional({ type: [TaskResourceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskResourceDto)
  materialsResources?: TaskResourceDto[];

  @ApiPropertyOptional({ example: 'PROC-A' })
  @IsOptional()
  @IsString()
  process?: string;

  @ApiPropertyOptional({ type: LinkDto, description: 'Predecessor link' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LinkDto)
  linkId?: LinkDto;
}
