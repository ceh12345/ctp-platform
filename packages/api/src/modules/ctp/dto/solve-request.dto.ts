import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsArray,
  IsString,
  IsIn,
  IsObject,
  IsBoolean,
  IsNumber,
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

  // --- Override fields ---

  @ApiPropertyOptional({
    description: 'Neighborhood strategy: Chain, ChainFirstFit, DueDate, Greedy, ShortestFirst',
    default: 'Chain',
  })
  @IsOptional()
  @IsString()
  strategy?: string;

  @ApiPropertyOptional({
    description: 'Detail level for response',
    enum: ['novice', 'intermediate', 'expert', 'diagnostic'],
    default: 'novice',
  })
  @IsOptional()
  @IsString()
  @IsIn(['novice', 'intermediate', 'expert', 'diagnostic'])
  detailLevel?: string;

  @ApiPropertyOptional({
    description: 'Order modes: { "WO-101": "LOCKED", "WO-103": "EXCLUDE" }',
    example: { 'WO-101': 'LOCKED' },
  })
  @IsOptional()
  @IsObject()
  orderModes?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Task pins: { "OP-007": true }',
    example: { 'OP-007': true },
  })
  @IsOptional()
  @IsObject()
  taskPins?: Record<string, boolean>;

  @ApiPropertyOptional({
    description: 'Task excludes: { "OP-012": true }',
    example: { 'OP-012': true },
  })
  @IsOptional()
  @IsObject()
  taskExcludes?: Record<string, boolean>;

  @ApiPropertyOptional({
    description: 'Task keys to unschedule before solving',
    example: ['OP-005'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taskUnschedules?: string[];

  @ApiPropertyOptional({
    description: 'Resource mode overrides: { "OP-007:CNC-01:capacity": "TRACK" }',
    example: { 'OP-007:CNC-01:capacity': 'TRACK' },
  })
  @IsOptional()
  @IsObject()
  resourceModes?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Material mode overrides: { "STEEL-ROD": "OFF" }',
    example: { 'STEEL-ROD': 'OFF' },
  })
  @IsOptional()
  @IsObject()
  materialModes?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Per-task resource preference overrides: { taskKey: { resourceKey: mode } }',
    example: { 'OP-001': { 'CNC-01': 'EXCLUDED', 'CNC-02': 'PREFERRED' } },
  })
  @IsOptional()
  @IsObject()
  resourcePreferenceOverrides?: Record<string, Record<string, string>>;

  @ApiPropertyOptional({
    description: 'Per-task priority overrides: { taskKey: priority (1=highest, 100=lowest) }',
    example: { 'OP-001': 1, 'OP-003': 10 },
  })
  @IsOptional()
  @IsObject()
  priorityOverrides?: Record<string, number>;

  @ApiPropertyOptional({
    description: 'Per-task window overrides: { taskKey: { startW?: isoString, endW?: isoString } }',
    example: { 'OP-005': { endW: '2026-03-05T23:59:59' } },
  })
  @IsOptional()
  @IsObject()
  windowOverrides?: Record<string, { startW?: string; endW?: string }>;

  @ApiPropertyOptional({
    description: 'Scoring rule overrides — replaces tenant scoring.json for this solve',
    example: [
      { ruleName: 'DueDateScoringRule', weight: 0.35, objective: 0, includeInSolve: true, penaltyFactor: 2.0 },
      { ruleName: 'EarliestStartTimeScoringRule', weight: 0.65, objective: 0, includeInSolve: true, penaltyFactor: 0 },
    ],
  })
  @IsOptional()
  @IsArray()
  scoringOverrides?: {
    ruleName: string;
    weight: number;
    objective: number;
    includeInSolve: boolean;
    penaltyFactor: number;
    group?: string;
  }[];

  @ApiPropertyOptional({
    description: 'Record solve steps for replay (default: false)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  recordSolveSteps?: boolean;

  @ApiPropertyOptional({
    description: 'Use a named schedule configuration (loads scoring + strategy + tier)',
  })
  @IsOptional()
  @IsString()
  configurationKey?: string;

  @ApiPropertyOptional({
    description: 'Skip config reload — solve against live landscape state',
  })
  @IsOptional()
  @IsBoolean()
  preserveLandscape?: boolean;

  @ApiPropertyOptional({
    description: 'Temp-pin non-target tasks during targeted solve. Only meaningful when taskKeys is also set.',
  })
  @IsOptional()
  @IsBoolean()
  protectOthers?: boolean;

  @ApiPropertyOptional({
    description: 'Auto-include chain siblings in taskKeys (default: true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  expandChains?: boolean;
}

export class UnscheduleTaskDto {
  @ApiPropertyOptional({ description: 'Reset task score', default: true })
  @IsOptional()
  @IsBoolean()
  resetScore?: boolean;
}

export class ScheduleTaskDto {
  @ApiPropertyOptional({
    description: 'Detail level for response',
    enum: ['novice', 'intermediate', 'expert', 'diagnostic'],
    default: 'novice',
  })
  @IsOptional()
  @IsString()
  @IsIn(['novice', 'intermediate', 'expert', 'diagnostic'])
  detailLevel?: string;

  @ApiPropertyOptional({ description: 'Preferred resource key' })
  @IsOptional()
  @IsString()
  preferredResource?: string;

  @ApiPropertyOptional({ description: 'Preferred start after (ISO date)' })
  @IsOptional()
  @IsString()
  preferredStartAfter?: string;
}

export class PinTaskDto {
  @ApiPropertyOptional({ description: 'Whether to pin the task' })
  @IsBoolean()
  pinned!: boolean;
}

export class UpdateResourceModeDto {
  @ApiPropertyOptional({
    description: 'New mode',
    enum: ['ON', 'TRACK', 'OFF'],
  })
  @IsString()
  @IsIn(['ON', 'TRACK', 'OFF'])
  mode!: string;

  @ApiPropertyOptional({
    description: 'Resource type',
    enum: ['capacity', 'material'],
  })
  @IsString()
  @IsIn(['capacity', 'material'])
  type!: string;
}

export class UpdateMaterialModesDto {
  @ApiPropertyOptional({
    description: 'Material modes: { "STEEL-ROD": "OFF", "BEARINGS": "TRACK" }',
    example: { 'STEEL-ROD': 'OFF' },
  })
  @IsObject()
  modes!: Record<string, string>;
}

export class SetTaskWindowDto {
  @ApiPropertyOptional({ description: 'New window start (ISO datetime). Null to keep current.' })
  @IsOptional()
  @IsString()
  windowStart?: string;

  @ApiPropertyOptional({ description: 'New window end (ISO datetime). Null to keep current.' })
  @IsOptional()
  @IsString()
  windowEnd?: string;
}

export class SetTaskPriorityDto {
  @ApiPropertyOptional({ description: 'New priority value (1 = highest/rush, 100 = normal)', minimum: 1 })
  @IsNumber()
  priority!: number;
}
