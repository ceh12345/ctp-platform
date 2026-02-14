import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignedResourceDto {
  @ApiProperty({ description: 'Assigned resource key' })
  resourceKey!: string;

  @ApiProperty({ description: 'Whether this is the primary resource' })
  isPrimary!: boolean;
}

export class TaskErrorDto {
  @ApiProperty({ description: 'Agent that reported the error' })
  agent!: string;

  @ApiProperty({ description: 'Error type' })
  type!: string;

  @ApiProperty({ description: 'Error reason' })
  reason!: string;
}

export class TaskResultDto {
  @ApiProperty({ description: 'Task key' })
  key!: string;

  @ApiProperty({ description: 'Task name' })
  name!: string;

  @ApiProperty({ description: 'Task state (0=NOT_SCHEDULED, 1=SCHEDULED)' })
  state!: number;

  @ApiProperty({ description: 'Whether this task was submitted to the solver' })
  included!: boolean;

  @ApiPropertyOptional({ description: 'Scheduled start time (ISO 8601)' })
  scheduledStart!: string | null;

  @ApiPropertyOptional({ description: 'Scheduled end time (ISO 8601)' })
  scheduledEnd!: string | null;

  @ApiPropertyOptional({ description: 'Scheduled duration in seconds' })
  durationSeconds!: number | null;

  @ApiProperty({ description: 'Assigned resources', type: [AssignedResourceDto] })
  assignedResources!: AssignedResourceDto[];

  @ApiPropertyOptional({ description: 'Blended score (null if infeasible)' })
  score!: number | null;

  @ApiProperty({ description: 'Whether the task was successfully scheduled' })
  feasible!: boolean;

  @ApiProperty({ description: 'Errors encountered during scheduling', type: [TaskErrorDto] })
  errors!: TaskErrorDto[];

  @ApiProperty({ description: 'Typed attributes on this task' })
  typedAttributes!: any[];
}

export class ResourceUtilizationDto {
  @ApiProperty({ description: 'Resource key' })
  resourceKey!: string;

  @ApiProperty({ description: 'Resource name' })
  resourceName!: string;

  @ApiProperty({ description: 'Total available time in seconds' })
  totalAvailable!: number;

  @ApiProperty({ description: 'Total assigned time in seconds' })
  totalAssigned!: number;

  @ApiProperty({ description: 'Utilization percentage (0-100)' })
  utilization!: number;
}

export class SolveSummaryDto {
  @ApiProperty({ description: 'Total tasks in landscape' })
  totalTasks!: number;

  @ApiProperty({ description: 'Tasks submitted to solver' })
  includedTasks!: number;

  @ApiProperty({ description: 'Successfully scheduled tasks' })
  scheduledTasks!: number;

  @ApiProperty({ description: 'Included but could not schedule' })
  unscheduledTasks!: number;

  @ApiProperty({ description: 'Not included in this solve run' })
  skippedTasks!: number;

  @ApiProperty({ description: 'Percentage of included tasks that were scheduled' })
  feasibilityRate!: number;

  @ApiProperty({ description: 'Horizon start (ISO 8601)' })
  horizonStart!: string;

  @ApiProperty({ description: 'Horizon end (ISO 8601)' })
  horizonEnd!: string;

  @ApiProperty({ description: 'Makespan in seconds (max endW - min startW of scheduled tasks)' })
  makespan!: number;
}

export class CTPSolveResultDto {
  @ApiProperty({ description: 'Status: "ok" or "not_solved"' })
  status!: string;

  @ApiProperty({ description: 'Solve summary', type: SolveSummaryDto })
  summary!: SolveSummaryDto;

  @ApiProperty({ description: 'Per-task results', type: [TaskResultDto] })
  tasks!: TaskResultDto[];

  @ApiProperty({ description: 'Per-resource utilization', type: [ResourceUtilizationDto] })
  resourceUtilization!: ResourceUtilizationDto[];
}
