import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

// ── Request ──

export class CTPQueryDto {
  @ApiProperty({ description: 'Existing chain key to clone as template (e.g., "C001")' })
  @IsString()
  sourceChainKey!: string;

  @ApiProperty({ description: 'Name for the new order (e.g., "Johnson Knee Replacement")' })
  @IsString()
  orderName!: string;

  @ApiPropertyOptional({ description: 'Override priority (default: same as source)' })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({ description: 'Optional due date (ISO datetime)' })
  @IsOptional()
  @IsString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Need-by date for promise status (ISO date, e.g., "2026-03-20")' })
  @IsOptional()
  @IsString()
  needByDate?: string;

  @ApiPropertyOptional({ description: 'Resource preference overrides: { "Surgeon": ["DR-PATEL"] }' })
  @IsOptional()
  @IsObject()
  preferredResources?: Record<string, string[]>;

  @ApiPropertyOptional({ description: 'Max placement options to return (default: 3)' })
  @IsOptional()
  @IsNumber()
  maxOptions?: number;
}

// ── Response ──

export interface CTPQueryTaskPlacement {
  taskKey: string;
  taskName: string;
  taskType: string;
  start: string;
  end: string;
  durationMinutes: number;
  resources: {
    resourceKey: string;
    resourceName: string;
    resourceType: string;
  }[];
}

export interface CTPQueryPromiseStatus {
  needByDate: string;
  completionDate: string;
  slackDays: number;
  status: 'early' | 'on-time' | 'late';
}

export interface CTPQueryOption {
  rank: number;
  feasible: boolean;
  chainScore: number;
  tasks: CTPQueryTaskPlacement[];
  promiseStatus?: CTPQueryPromiseStatus;
}

export interface CTPQueryResponse {
  orderName: string;
  sourceChainKey: string;
  feasible: boolean;
  options: CTPQueryOption[];
  infeasibilityReason: string | null;
}

// ── Chain Templates ──

export interface ChainTemplateTask {
  type: string;
  name: string;
  durationMinutes: number;
  resourceCount: number;
}

export interface ChainTemplate {
  chainKey: string;
  name: string;
  category: string;
  taskCount: number;
  totalDurationMinutes: number;
  tasks: ChainTemplateTask[];
}

export interface ChainTemplatesResponse {
  templates: ChainTemplate[];
}
