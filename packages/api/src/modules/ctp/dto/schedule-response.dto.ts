import { ApiProperty } from '@nestjs/swagger';

export const SKIP_REASONS = [
  'committed', 'running', 'not_found', 'already_in_target_state',
  'no_feasible_slot', 'unmet_predecessor', 'engine_error',
] as const;

export const SKIP_REASON_LABELS: Record<string, string> = {
  committed: 'committed',
  running: 'running',
  not_found: 'not found',
  already_in_target_state: 'already scheduled',
  no_feasible_slot: 'no feasible slot',
  unmet_predecessor: 'predecessor not scheduled',
  engine_error: 'engine error',
};

export class ScheduleTaskResultDto {
  @ApiProperty() key!: string;
  @ApiProperty() success!: boolean;
  @ApiProperty({ enum: SKIP_REASONS, required: false }) skipReason?: string;
}

export class ScheduleSummaryDto {
  @ApiProperty() requestedCount!: number;
  @ApiProperty() expandedCount!: number;
  @ApiProperty() scheduledCount!: number;
  @ApiProperty() processCount!: number;
  @ApiProperty() setupCount!: number;
  @ApiProperty() teardownCount!: number;
  @ApiProperty() skippedCount!: number;
}

export class ScheduleResponseDto {
  @ApiProperty({ type: [ScheduleTaskResultDto] }) results!: ScheduleTaskResultDto[];
  @ApiProperty({ type: ScheduleSummaryDto }) summary!: ScheduleSummaryDto;
}
