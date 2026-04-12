import { ApiProperty } from '@nestjs/swagger';
import { SKIP_REASONS, SKIP_REASON_LABELS } from './schedule-response.dto';

export { SKIP_REASON_LABELS };

export class UnscheduleTaskResultDto {
  @ApiProperty() key!: string;
  @ApiProperty() success!: boolean;
  @ApiProperty({ enum: SKIP_REASONS, required: false }) skipReason?: string;
}

export class UnscheduleSummaryDto {
  @ApiProperty() requestedCount!: number;
  @ApiProperty() unscheduledCount!: number;
  @ApiProperty() processCount!: number;
  @ApiProperty() cascadedSetupCount!: number;
  @ApiProperty() cascadedTeardownCount!: number;
  @ApiProperty() skippedCount!: number;
  @ApiProperty({ type: [String] }) affectedChains!: string[];
}

export class UnscheduleResponseDto {
  @ApiProperty({ type: [UnscheduleTaskResultDto] }) results!: UnscheduleTaskResultDto[];
  @ApiProperty({ type: UnscheduleSummaryDto }) summary!: UnscheduleSummaryDto;
}
