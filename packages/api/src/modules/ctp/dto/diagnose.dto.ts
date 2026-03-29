import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsArray, IsString, IsBoolean, IsNumber, IsIn } from 'class-validator';

export class DiagnoseRequestDto {
  @ApiPropertyOptional({ description: 'Task keys to diagnose. If empty, diagnose all infeasible tasks.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taskKeys?: string[];

  @ApiPropertyOptional({ description: 'Include ripple analysis for each recommendation', default: false })
  @IsOptional()
  @IsBoolean()
  includeRippleAnalysis?: boolean;

  @ApiPropertyOptional({ description: 'Max recommendations per task', default: 5 })
  @IsOptional()
  @IsNumber()
  maxRecommendations?: number;

  @ApiPropertyOptional({ description: 'Filter to specific action types', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actionTypes?: string[];

  @ApiPropertyOptional({ description: 'Detail level', enum: ['novice', 'intermediate', 'expert', 'diagnostic'] })
  @IsOptional()
  @IsString()
  detailLevel?: string;
}

export interface RootCause {
  type: 'no_capacity' | 'window_too_tight' | 'resource_excluded' | 'material_shortage'
      | 'chain_conflict' | 'priority_displaced' | 'multi_resource_clash' | 'unknown';
  summary: string;
  bottleneckSlot?: string;
  blockingTasks?: BlockingTaskSummary[];
}

export interface BlockingTaskSummary {
  taskKey: string;
  taskName: string;
  orderKey: string | null;
  priority: number;
  resourceKey: string;
  start: string;
  end: string;
}

export interface TradeoffSummary {
  gains: string[];
  costs: string[];
  metrics?: {
    dueDateImpactDays?: number;
    utilizationDelta?: number;
    tasksDisplaced?: number;
    changeoversAdded?: number;
    feasibilityRateChange?: number;
  };
}

export interface RecommendationCommand {
  type: 'move_to' | 'set_window' | 'unschedule' | 'solve'
      | 'set_priority' | 'set_resource_preference'
      | 'set_order_mode' | 'pin'
      | 'dispatch' | 'start' | 'hold' | 'resume' | 'complete' | 'revert_dispatch';
  scope?: 'targeted' | 'full';
  expandChains?: boolean;
  taskKey?: string;
  taskKeys?: string[];
  contextHash?: string;
  startTime?: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  priority?: number;
  resourceKey?: string;
  mode?: string;
  orderKey?: string;
  strategy?: string;
  pinned?: boolean;
}

export interface Recommendation {
  id: string;
  action: 'move_resource' | 'expand_window' | 'bump_lower_priority'
        | 'reprioritize' | 'redirect_work' | 'exclude_order'
        | 'pin_and_protect' | 'change_strategy';
  description: string;
  score: number;
  rank: number;
  tradeoffs: TradeoffSummary;
  commands: RecommendationCommand[];
}

export interface TaskDiagnosis {
  taskKey: string;
  taskName: string;
  orderKey: string | null;
  chainKey: string | null;
  status: 'infeasible' | 'suboptimal' | 'scheduled';
  rootCause: RootCause;
  infeasibilityReport?: any;
  recommendations: Recommendation[];
}

export interface DiagnoseResponse {
  diagnoses: TaskDiagnosis[];
  globalRecommendations: Recommendation[];
  timestamp: string;
  landscapeHash: string;
}

export class ApplyRecommendationRequestDto {
  @ApiProperty({ description: 'Recommendation ID from diagnose response' })
  @IsString()
  recommendationId!: string;

  @ApiProperty({ description: 'Commands to execute', type: 'array' })
  @IsArray()
  commands!: RecommendationCommand[];

  @ApiProperty({ description: 'Landscape hash for staleness check' })
  @IsString()
  landscapeHash!: string;

  @ApiPropertyOptional({ description: 'Detail level for returned state' })
  @IsOptional()
  @IsString()
  detailLevel?: string;
}

export class ExecuteCommandsRequestDto {
  @ApiProperty({ description: 'Ordered list of commands to execute', type: 'array' })
  @IsArray()
  commands!: RecommendationCommand[];

  @ApiPropertyOptional({ description: 'Optional name for logging/audit' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Detail level for returned state', enum: ['novice', 'intermediate', 'expert'] })
  @IsOptional()
  @IsString()
  detailLevel?: string;
}

export interface ApplyRecommendationResponse {
  success: boolean;
  stale?: boolean;
  rolledBack?: boolean;
  actionsApplied: { type: string; taskKey?: string; result: 'ok' | 'failed' | 'skipped'; detail?: string }[];
  newState?: any;
  rippleEffects?: { taskKey: string; taskName: string; impact: string; detail: string }[];
  reason?: string;
}
