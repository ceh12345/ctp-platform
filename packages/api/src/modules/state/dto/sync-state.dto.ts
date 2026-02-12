import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HorizonDto } from './horizon.dto';
import { ResourceDto } from './resource.dto';
import { TaskDto } from './task.dto';
import { StateChangeDto } from './state-change.dto';
import { ScoringDto } from './scoring.dto';
import { SettingsDto } from './settings.dto';

export class SyncStateDto {
  @ApiPropertyOptional({ example: 'default', description: 'Tenant ID (default: "default")' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty({ type: HorizonDto })
  @ValidateNested()
  @Type(() => HorizonDto)
  horizon!: HorizonDto;

  @ApiProperty({ type: [ResourceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResourceDto)
  resources!: ResourceDto[];

  @ApiProperty({ type: [TaskDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskDto)
  tasks!: TaskDto[];

  @ApiPropertyOptional({ type: [StateChangeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StateChangeDto)
  stateChanges?: StateChangeDto[];

  @ApiProperty({ type: ScoringDto })
  @ValidateNested()
  @Type(() => ScoringDto)
  scoring!: ScoringDto;

  @ApiPropertyOptional({ type: SettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettingsDto)
  settings?: SettingsDto;
}
