import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HorizonSummaryDto {
  @ApiProperty({ description: 'Start date (ISO 8601)' })
  start!: string;

  @ApiProperty({ description: 'End date (ISO 8601)' })
  end!: string;
}

export class SettingsSummaryDto {
  @ApiProperty({ description: 'Schedule direction (1=FORWARD, 2=BACKWARD)' })
  scheduleDirection!: number;
}

export class StateSummaryDetailDto {
  @ApiProperty({ description: 'Number of resources' })
  resources!: number;

  @ApiProperty({ description: 'Number of tasks' })
  tasks!: number;

  @ApiProperty({ description: 'Horizon range', type: HorizonSummaryDto })
  horizon!: HorizonSummaryDto;

  @ApiProperty({ description: 'Number of state changes' })
  stateChanges!: number;

  @ApiProperty({ description: 'Settings overview', type: SettingsSummaryDto })
  settings!: SettingsSummaryDto;
}

export class StateSummaryDto {
  @ApiProperty({ description: 'Status: "ok" or "not_loaded"' })
  status!: string;

  @ApiPropertyOptional({
    description: 'Summary details (present when status is "ok")',
    type: StateSummaryDetailDto,
  })
  summary?: StateSummaryDetailDto;
}
