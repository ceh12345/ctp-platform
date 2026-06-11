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

export class TaskSegmentDto {
  @ApiProperty({ description: 'Segment start (ISO 8601)' }) start!: string;
  @ApiProperty({ description: 'Segment end (ISO 8601)' })   end!: string;
}

export class TaskCompatibleResourceDto {
  @ApiProperty()                                                resourceKey!: string;
  @ApiPropertyOptional()                                        resourceName!: string | null;
  @ApiPropertyOptional({ description: 'AVAILABLE / PREFERRED / REQUIRED / EXCLUDED' })
  mode?: string;
  @ApiPropertyOptional({ description: 'Preference rank (lower = preferred)' })
  rank?: number;
  @ApiPropertyOptional({ description: 'Speed factor (1.0 = baseline)' })
  speedFactor?: number;
}

export class TaskCostDto {
  @ApiProperty() total!: number;
  @ApiProperty() resource!: number;
  @ApiProperty() material!: number;
}

/**
 * Task projection returned by /v1/ctp/solve-and-sync.
 *
 * Contract for the Schedule tab and any future task-shape consumer. Keep this
 * DTO in sync with the inline projection in ctp.service.ts; new fields go
 * here AND in the projection together, never one without the other. The
 * `taskResult: TaskResultDto = { ... }` annotation at the projection site
 * makes drift a compile error rather than a silent UI bug.
 *
 * Hierarchies / attributes are NOT denormalised on tasks — clients join
 * `task.groupKey` against `workOrderGroups[].key` to read them. See groupKey
 * field doc.
 */
export class TaskResultDto {
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Task state (0=NOT_SCHEDULED, 1=SCHEDULED)' })
  state!: number;
  @ApiProperty({ description: 'Whether this task was submitted to the solver' })
  included!: boolean;
  @ApiPropertyOptional({ description: 'Whether this task is pinned (locked in place)' })
  pinned?: boolean;

  @ApiPropertyOptional({ description: 'Scheduled start time (ISO 8601)' })
  scheduledStart!: string | null;
  @ApiPropertyOptional({ description: 'Scheduled end time (ISO 8601)' })
  scheduledEnd!: string | null;
  @ApiPropertyOptional({ description: 'Wall-clock duration in seconds (envelope, includes shift gaps for FLOAT tasks)' })
  durationSeconds!: number | null;
  @ApiPropertyOptional({ description: 'Actual on-shift working time in seconds. Equals durationSeconds for FIXED tasks; smaller for FLOAT tasks crossing shift gaps.' })
  workDurationSeconds!: number | null;
  @ApiPropertyOptional({ description: 'On-shift slices of the assignment envelope. Populated only for FLOAT tasks; null for FIXED. UI renders one Gantt block per segment.', type: [TaskSegmentDto] })
  segments!: TaskSegmentDto[] | null;

  @ApiProperty({ description: 'Resources scheduled to this task', type: [AssignedResourceDto] })
  assignedResources!: AssignedResourceDto[];
  @ApiProperty({ description: 'Material resource assignments with mode', type: [AssignedResourceDto] })
  materialResources!: AssignedResourceDto[];
  @ApiProperty({ description: 'All resources eligible for this task, with rank/mode/speedFactor. Surfaced for the unscheduled-tasks panel and where-to-go suggestions.', type: [TaskCompatibleResourceDto] })
  compatibleResources!: TaskCompatibleResourceDto[];

  @ApiPropertyOptional({ description: 'Blended score (null if infeasible)' })
  score!: number | null;
  @ApiPropertyOptional({ description: 'Same as `score` but surfaced under a UI-friendlier alias for intermediate+ detail level' })
  blendedScore?: number | null;
  @ApiProperty({ description: 'Whether the task was successfully scheduled' })
  feasible!: boolean;
  @ApiProperty({ description: 'Whether the task is schedulable given its inputs (i.e. has duration, resources, etc.)' })
  schedulable!: boolean;
  @ApiProperty({ description: 'Errors encountered during scheduling', type: [TaskErrorDto] })
  errors!: TaskErrorDto[];
  @ApiProperty({ description: 'Validation errors found at hydration (config-level, not solve-level)' })
  validationErrors!: unknown[];
  @ApiPropertyOptional({ description: 'Bottleneck slot + contention report when infeasible' })
  infeasibilityReport!: unknown | null;
  @ApiProperty({ description: 'Typed attributes on this task' })
  typedAttributes!: unknown[];

  @ApiPropertyOptional({ description: 'Order reference (linkId name)' })
  orderRef!: string | null;
  @ApiPropertyOptional({ description: 'WorkOrderGroup this task belongs to (null when ungrouped). Reference-shared from the order at rebuildGroups time; clients join `task.groupKey` against `workOrderGroups[].key` to read hierarchies / attributes without server-side duplication.' })
  groupKey!: string | null;
  @ApiPropertyOptional({ description: 'Predecessor task key in the chain (linkId.prevLink)' })
  predKey!: string | null;

  @ApiPropertyOptional() outputProductKey!: string | null;
  @ApiPropertyOptional() outputQty!: number | null;
  @ApiPropertyOptional({ description: 'Output scrap rate (0.03 = 3%)' })
  outputScrapRate!: number | null;
  @ApiProperty({ description: 'Material inputs consumed by this task', type: [TaskMaterialInputDto] })
  inputMaterials!: TaskMaterialInputDto[];

  @ApiPropertyOptional({ description: 'Process chain this task belongs to' })
  process!: string | null;
  @ApiPropertyOptional({ description: 'Process display name (joined from processes config)' })
  processName!: string | null;
  @ApiPropertyOptional({ description: 'Process category (joined from processes config)' })
  processCategory!: string | null;
  @ApiPropertyOptional({ description: 'Cadence interval in minutes for repeating tasks' })
  cadenceIntervalMinutes!: number | null;

  @ApiPropertyOptional({ description: 'Task type: PROCESS / SETUP / TEAR_DOWN' })
  type?: string;
  @ApiPropertyOptional({ description: 'Task subtype (e.g. CHANGEOVER)' })
  subType!: string | null;

  @ApiProperty({ description: 'Effective priority (numeric)' })
  priority!: number;
  @ApiProperty({ description: 'Priority as originally configured (before runtime overrides)' })
  originalPriority!: number;

  @ApiPropertyOptional({ description: 'Earliest allowed start (ISO 8601)' })
  windowStart!: string | null;
  @ApiPropertyOptional({ description: 'Latest allowed end (ISO 8601)' })
  windowEnd!: string | null;
  @ApiPropertyOptional({ description: 'Original window end before any runtime extension (ISO 8601)' })
  originalWindowEnd!: string | null;

  @ApiProperty({ description: 'planned / dispatched / running / on_hold / completed / unscheduled' })
  commitmentLevel!: string;
  @ApiProperty() dispatched!: boolean;
  @ApiPropertyOptional() dispatchedAt!: string | null;
  @ApiProperty() materialsPulled!: boolean;
  @ApiProperty({ description: 'Percent complete 0-100 (running / on-hold tasks)' })
  percentComplete!: number;
  @ApiPropertyOptional({ description: 'Remaining duration in seconds (running / on-hold tasks)' })
  remainingDuration!: number | null;
  @ApiPropertyOptional({ description: 'Actual start when running (ISO 8601)' })
  actualStart!: string | null;
  @ApiPropertyOptional({ description: 'Actual end when completed (ISO 8601)' })
  actualEnd!: string | null;
  @ApiPropertyOptional({ description: 'Resources actually used (running / completed tasks)' })
  actualResources!: unknown;
  @ApiPropertyOptional({ description: 'Hold reason text (on_hold tasks only)' })
  holdReason!: string | null;
  @ApiPropertyOptional({ description: 'Estimated resume time (on_hold tasks only)' })
  estimatedResumeTime!: string | null;

  @ApiProperty({ description: 'Whether the task is past its due date' })
  isPastDue!: boolean;
  @ApiProperty({ description: 'Days past due (0 if not past due)' })
  pastDueDays!: number;
  @ApiProperty({ description: 'Horizon bucket label (e.g. THIS_WEEK, NEXT_WEEK)' })
  horizonBucket!: string;

  @ApiPropertyOptional({ description: 'Cost breakdown for scheduled tasks (resource + material)' })
  cost?: TaskCostDto;
  @ApiPropertyOptional({ description: 'False for completed tasks whose chain is fully done (UI hides them by default)' })
  visible?: boolean;
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

  @ApiPropertyOptional({ description: 'Work center (hierarchy level 1)' })
  workCenter?: string;

  @ApiPropertyOptional({ description: 'Line (hierarchy level 2)' })
  line?: string;

  @ApiPropertyOptional({ description: 'Resource class: REUSABLE or CONSUMABLE' })
  resourceClass?: string;
}

/**
 * Order projection returned by /v1/ctp/solve-and-sync.
 *
 * Contract for any consumer of the solve response's `orders` array. Keep in
 * sync with the inline projection in ctp.service.ts — the
 * `const orders: OrderResultDto[] = ...` annotation at the projection site
 * makes drift a compile error rather than a silent UI bug.
 *
 * Same hierarchy/attribute story as TaskResultDto: clients join `groupKey`
 * against `workOrderGroups[].key` instead of duplicating on every order row.
 */
export class OrderResultDto {
  @ApiProperty({ description: 'Order key' })
  orderKey!: string;

  @ApiPropertyOptional({ description: 'Order display name' })
  name!: string;

  @ApiProperty({ description: 'Product key demanded' })
  productKey!: string;

  @ApiProperty({ description: 'Demand quantity' })
  demandQty!: number;

  @ApiProperty({ description: 'Scheduled output quantity (sum across the order chain)' })
  scheduledQty!: number;

  @ApiProperty({ description: 'Fill rate (0-1)' })
  fillRate!: number;

  @ApiPropertyOptional({ description: 'Due date (ISO 8601). Null when source dueDate == 0 ("not set").' })
  dueDate!: string | null;

  @ApiPropertyOptional({ description: 'Late due date (ISO 8601). Null when not set or when the same as dueDate.' })
  lateDueDate!: string | null;

  @ApiProperty({ description: 'Order priority' })
  priority!: number;

  @ApiPropertyOptional({ description: 'WorkOrderGroup this order belongs to (null when ungrouped). Join `groupKey` against `workOrderGroups[].key` to read hierarchies / attributes.' })
  groupKey!: string | null;

  @ApiPropertyOptional({ description: 'Parent order key for the WO tree. Equal to orderKey for head WOs (Stafford convention); null for tenants that use null for heads.' })
  parentOrderKey!: string | null;

  @ApiProperty({ description: 'Validation errors found at hydration (config-level, not solve-level)' })
  validationErrors!: unknown[];
}

export class HierarchySlotDto {
  @ApiProperty({ description: 'Slot position (1-5)' })
  slot!: number;

  @ApiProperty({ description: 'Dimension label (e.g. "Customer", "Project")' })
  name!: string;

  @ApiProperty({ description: 'Resolved value for this slot. Null is reserved for live-mode resolver failures (not currently emitted — synthetic and field resolvers always produce a string).' })
  value!: string | null;
}

export class NamedValueDto {
  @ApiProperty({ description: 'Attribute name' })
  name!: string;

  @ApiProperty({ description: 'Attribute value' })
  value!: string;
}

export class WorkOrderGroupResultDto {
  @ApiProperty({ description: 'Group key (e.g. Stafford Job number)' })
  key!: string;

  @ApiProperty({ description: 'Display name composed by the mapping (tenant-specific)' })
  name!: string;

  @ApiPropertyOptional({ description: 'Head work-order key (null when no single head was identified)' })
  headWorkOrderKey!: string | null;

  @ApiProperty({ description: 'Keys of all member orders', type: [String] })
  workOrderKeys!: string[];

  @ApiPropertyOptional({ description: 'Source-of-truth start date from the ERP (ISO 8601). Null when not provided.' })
  sourceStart!: string | null;

  @ApiPropertyOptional({ description: 'Source-of-truth end date from the ERP (ISO 8601). Null when not provided.' })
  sourceEnd!: string | null;

  @ApiPropertyOptional({ description: 'Customer-facing promise date (ISO 8601). Null when not provided.' })
  promiseDate!: string | null;

  @ApiPropertyOptional({ description: 'Computed start from the post-solve rollup — min(task.scheduled.start) across members. Null when nothing is scheduled.' })
  computedStart!: string | null;

  @ApiPropertyOptional({ description: 'Computed end from the post-solve rollup — max(task.scheduled.end) across members. Null when nothing is scheduled.' })
  computedEnd!: string | null;

  @ApiProperty({ description: 'Status code: 0=ON_TRACK, 1=AT_RISK, 2=LATE, 3=BLOCKED, 4=COMPLETED, 5=CANCELLED' })
  status!: number;

  @ApiProperty({ description: 'Status label (matches the enum name)' })
  statusLabel!: string;

  @ApiProperty({ description: 'Total work orders in the group' })
  totalWorkOrders!: number;

  @ApiProperty({ description: 'Members marked completed (pending Decision 5)' })
  completedWorkOrders!: number;

  @ApiProperty({ description: 'Members in process (pending Decision 5)' })
  inProcessWorkOrders!: number;

  @ApiProperty({ description: 'Members not started (pending Decision 5)' })
  notStartedWorkOrders!: number;

  @ApiProperty({ description: 'Members matched by the tenant cancellation predicate' })
  cancelledWorkOrders!: number;

  @ApiProperty({ description: 'Sum of demandQty across members' })
  totalDemandQty!: number;

  @ApiProperty({ description: 'Sum of scheduledQty across members' })
  totalScheduledQty!: number;

  @ApiProperty({ description: 'Sum of producedQty across members (pending source-field exposure)' })
  totalProducedQty!: number;

  @ApiProperty({ description: 'completedWorkOrders / totalWorkOrders. Returns 0 when totalWorkOrders is 0.' })
  completionRatio!: number;

  @ApiProperty({ description: 'True when every member is completed (and totalWorkOrders > 0).' })
  isFullyComplete!: boolean;

  @ApiProperty({ description: 'True when computedEnd > sourceEnd. Returns false when either is null.' })
  isLate!: boolean;

  @ApiProperty({ description: 'Populated hierarchy slots (empty slots omitted)', type: [HierarchySlotDto] })
  hierarchies!: HierarchySlotDto[];

  @ApiProperty({ description: 'Tenant-defined attributes', type: [NamedValueDto] })
  attributes!: NamedValueDto[];
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

  @ApiPropertyOptional({ description: 'Incoming stock arrival date (ISO 8601)' })
  incomingDate?: string | null;

  @ApiPropertyOptional({ description: 'Date when shortage first occurs (ISO 8601)' })
  firstShortageDate?: string | null;

  @ApiPropertyOptional({ description: 'Deficit quantity at shortage point' })
  shortageQty?: number;

  @ApiPropertyOptional({ description: 'Task key that triggers the shortage' })
  firstNeedTaskKey?: string | null;

  @ApiPropertyOptional({ description: 'Task name that triggers the shortage' })
  firstNeedTaskName?: string | null;
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

  @ApiPropertyOptional({ description: 'Count of auto-generated setup/changeover tasks' })
  setupTasks?: number;

  @ApiPropertyOptional({ description: 'Count of pinned tasks' })
  pinnedTasks?: number;

  @ApiPropertyOptional({ description: 'Count of excluded tasks' })
  excludedTasks?: number;
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

  @ApiPropertyOptional({ description: 'Rolled-up WorkOrderGroups (e.g. Stafford Jobs). Empty when the tenant has no workOrderGroups mapping configured.', type: [WorkOrderGroupResultDto] })
  workOrderGroups?: WorkOrderGroupResultDto[];

  @ApiPropertyOptional({ description: 'Solve statistics (depth varies by detailLevel)' })
  stats?: any;

  @ApiPropertyOptional({ description: 'Product list' })
  products?: any[];

  @ApiPropertyOptional({ description: 'Tenant color configuration' })
  colors?: any;

  @ApiPropertyOptional({ description: 'Tenant terminology configuration' })
  terminology?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Tenant locale configuration' })
  locale?: any;
}
