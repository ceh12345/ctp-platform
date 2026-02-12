import { IsNumber, IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SettingsDto {
  @ApiPropertyOptional({ example: 1, description: '1=FORWARD, 2=BACKWARD (default 1)' })
  @IsOptional()
  @IsNumber()
  scheduleDirection?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  flowAround?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  maxLateness?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  tasksPerLoop?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  topTasksToSchedule?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requiresPreds?: boolean;
}
