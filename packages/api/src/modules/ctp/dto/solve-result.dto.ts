import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignedResourceDto {
  @ApiProperty({ description: 'Assigned resource key' })
  resourceKey!: string;

  @ApiProperty({ description: 'Whether this is the primary resource' })
  isPrimary!: boolean;

  @ApiPropertyOptional({ description: 'Resource mode: ON, OFF, or TRACK' })
  mode!: string;

  @ApiPropertyOptional({ description: 'Originally requested resource key' })
  requestedResource!: string | null;

  @ApiPropertyOptional({ description: 'Resource display name' })
  resourceName!: string | null;

  @ApiPropertyOptional({ description: 'Resource class (e.g. CNC, Assembly)' })
  resourceClass!: string | null;
}

export class TaskErrorDto {
  @ApiProperty({ description: 'Agent that reported the error' })
  agent!: string;

  @ApiProperty({ description: 'Error type' })
  type!: string;

  @ApiProperty({ description: 'Error reason' })
  reason!: string;
}

export class TaskMaterialInputDto {
  @ApiProperty({ description: 'Product/material key consumed' })
  productKey!: string;

  @ApiProperty({ description: 'Required quantity' })
  requiredQty!: number;

  @ApiProperty({ description: 'Scrap rate (0.02 = 2%)' })
  scrapRate!: number;

  @ApiProperty({ description: 'Unit of measure' })
  unitOfMeasure!: string;
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

  @ApiPropertyOptional({ description: 'Order reference (linkId name)' })
  orderRef!: string | null;

  @ApiPropertyOptional({ description: 'Output product key this task produces' })
  outputProductKey!: string | null;

  @ApiPropertyOptional({ description: 'Output quantity produced' })
  outputQty!: number | null;

  @ApiPropertyOptional({ description: 'Output scrap rate (0.03 = 3%)' })
  outputScrapRate!: number | null;

  @ApiProperty({ description: 'Material inputs consumed by this task', type: [TaskMaterialInputDto] })
  inputMaterials!: TaskMaterialInputDto[];

  @ApiPropertyOptional({ description: 'Process chain this task belongs to' })
  process!: string | null;

  @ApiProperty({ description: 'Material resource assignments with mode', type: [AssignedResourceDto] })
  materialResources!: AssignedResourceDto[];
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

export class OrderResultDto {
  @ApiProperty({ description: 'Order key' })
  orderKey!: string;

  @ApiProperty({ description: 'Product key demanded' })
  productKey!: string;

  @ApiProperty({ description: 'Demand quantity' })
  demandQty!: number;

  @ApiProperty({ description: 'Scheduled output quantity' })
  scheduledQty!: number;

  @ApiProperty({ description: 'Fill rate (0-1)' })
  fillRate!: number;

  @ApiProperty({ description: 'Due date (ISO 8601)' })
  dueDate!: string;

  @ApiPropertyOptional({ description: 'Late due date (ISO 8601)' })
  lateDueDate!: string | null;

  @ApiProperty({ description: 'Order priority' })
  priority!: number;
}

export class MaterialStatusDto {
  @ApiProperty({ description: 'Material key' })
  materialKey!: string;

  @ApiProperty({ description: 'Material name' })
  materialName!: string;

  @ApiProperty({ description: 'Unit of measure' })
  unit!: string;

  @ApiProperty({ description: 'On-hand inventory' })
  onHand!: number;

  @ApiProperty({ description: 'Total consumed by scheduled tasks' })
  consumed!: number;

  @ApiProperty({ description: 'Remaining after consumption' })
  remaining!: number;

  @ApiPropertyOptional({ description: 'Incoming replenishment quantity' })
  incoming!: number;
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

  @ApiProperty({ description: 'Order fill-rate results', type: [OrderResultDto] })
  orders!: OrderResultDto[];

  @ApiProperty({ description: 'Material consumption status', type: [MaterialStatusDto] })
  materials!: MaterialStatusDto[];
}
