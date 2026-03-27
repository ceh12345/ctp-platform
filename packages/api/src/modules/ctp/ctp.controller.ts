import { Controller, Post, Get, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CTPService } from './ctp.service';
import {
  SolveRequestDto,
  UnscheduleTaskDto,
  ScheduleTaskDto,
  PinTaskDto,
  UpdateResourceModeDto,
  UpdateMaterialModesDto,
  SetTaskWindowDto,
  SetTaskPriorityDto,
} from './dto/solve-request.dto';
import { CTPQueryDto } from './dto/ctp-query.dto';
import { DiagnoseRequestDto, ApplyRecommendationRequestDto } from './dto/diagnose.dto';
import { CTPSolveResultDto } from './dto/solve-result.dto';
import {
  WhereToRequestDto,
  WhereToResponseDto,
  MoveToRequestDto,
  MoveToResponseDto,
} from './dto/whereto.dto';

@ApiTags('ctp')
@Controller('ctp')
export class CTPController {
  constructor(private readonly ctpService: CTPService) {}

  // ─── Endpoint 1: Solve with Overrides ───

  @Post('solve')
  @ApiOperation({
    summary: 'Run scheduler with optional overrides and return results.',
    description: 'When preserveLandscape is true, solves against the current in-memory state without reloading from config. When protectOthers is true with taskKeys, non-target scheduled tasks are temporarily pinned.',
  })
  @ApiBody({
    type: SolveRequestDto,
    required: false,
    description: 'Optional overrides: order modes, task pins/excludes, resource modes, material modes.',
  })
  @ApiResponse({ status: 200, description: 'Schedule results', type: CTPSolveResultDto })
  @ApiResponse({ status: 400, description: 'State not loaded or scoring config missing' })
  solve(@Body() body?: SolveRequestDto) {
    return this.ctpService.solve(body);
  }

  @Get('results')
  @ApiOperation({ summary: 'Get last solve results without re-running' })
  @ApiResponse({ status: 200, description: 'Last solve results or not_solved status' })
  results() {
    const result = this.ctpService.getLastResult();
    if (!result) {
      return { status: 'not_solved' };
    }
    return result;
  }

  @Post('solve-and-sync')
  @ApiOperation({ summary: 'Reload config, solve, and return results (demo endpoint)' })
  @ApiBody({ type: SolveRequestDto, required: false })
  @ApiResponse({ status: 200, description: 'Schedule results', type: CTPSolveResultDto })
  solveAndSync(@Body() body?: SolveRequestDto) {
    return this.ctpService.solve(body);
  }

  // ─── Endpoint 2: Unschedule Single Task ───

  @Post('tasks/:taskKey/unschedule')
  @ApiOperation({ summary: 'Unschedule a single task without re-solving' })
  @ApiParam({ name: 'taskKey', description: 'Task key to unschedule' })
  @ApiBody({ type: UnscheduleTaskDto, required: false })
  @ApiResponse({ status: 200, description: 'Task unscheduled successfully' })
  @ApiResponse({ status: 400, description: 'Task is not scheduled' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 409, description: 'Task is pinned' })
  unscheduleTask(@Param('taskKey') taskKey: string, @Body() body?: UnscheduleTaskDto) {
    return this.ctpService.unscheduleTask(taskKey, body?.resetScore ?? true);
  }

  // ─── Endpoint 3: Schedule Single Task ───

  @Post('tasks/:taskKey/schedule')
  @ApiOperation({ summary: 'Schedule a single task (find best slot)' })
  @ApiParam({ name: 'taskKey', description: 'Task key to schedule' })
  @ApiBody({ type: ScheduleTaskDto, required: false })
  @ApiResponse({ status: 200, description: 'Task scheduled or errors returned' })
  @ApiResponse({ status: 400, description: 'Task is already scheduled or pinned' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  scheduleTask(@Param('taskKey') taskKey: string, @Body() body?: ScheduleTaskDto) {
    return this.ctpService.scheduleTask(taskKey, body);
  }

  // ─── Endpoint 4: Update Resource Mode ───

  @Patch('tasks/:taskKey/resources/:resourceKey/mode')
  @ApiOperation({ summary: 'Change mode of a task-resource relationship' })
  @ApiParam({ name: 'taskKey', description: 'Task key' })
  @ApiParam({ name: 'resourceKey', description: 'Resource key' })
  @ApiBody({ type: UpdateResourceModeDto })
  @ApiResponse({ status: 200, description: 'Mode updated' })
  @ApiResponse({ status: 404, description: 'Task or resource not found' })
  updateResourceMode(
    @Param('taskKey') taskKey: string,
    @Param('resourceKey') resourceKey: string,
    @Body() body: UpdateResourceModeDto,
  ) {
    return this.ctpService.updateResourceMode(taskKey, resourceKey, body.mode, body.type);
  }

  // ─── Endpoint 5: Update Material Modes (Bulk) ───

  @Patch('materials/modes')
  @ApiOperation({ summary: 'Bulk update material modes' })
  @ApiBody({ type: UpdateMaterialModesDto })
  @ApiResponse({ status: 200, description: 'Material modes updated' })
  updateMaterialModes(@Body() body: UpdateMaterialModesDto) {
    return this.ctpService.updateMaterialModes(body.modes);
  }

  // ─── Endpoint 6: Pin/Unpin Task ───

  @Patch('tasks/:taskKey/pin')
  @ApiOperation({ summary: 'Pin or unpin a task' })
  @ApiParam({ name: 'taskKey', description: 'Task key' })
  @ApiBody({ type: PinTaskDto })
  @ApiResponse({ status: 200, description: 'Pin state updated' })
  @ApiResponse({ status: 400, description: 'Cannot pin unscheduled task' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  pinTask(@Param('taskKey') taskKey: string, @Body() body: PinTaskDto) {
    return this.ctpService.pinTask(taskKey, body.pinned);
  }

  // ─── Endpoint 7: Get Solve State ───

  @Get('state')
  @ApiOperation({ summary: 'Get current landscape state without solving' })
  @ApiQuery({ name: 'detailLevel', required: false, enum: ['novice', 'intermediate', 'expert', 'diagnostic'] })
  @ApiResponse({ status: 200, description: 'Current state', type: CTPSolveResultDto })
  getState(@Query('detailLevel') detailLevel?: string) {
    return this.ctpService.getState(detailLevel || 'novice');
  }

  // ─── Endpoint 8: Where-To ───

  @Post('tasks/:taskKey/where-to')
  @ApiOperation({ summary: 'Evaluate all scheduling options for a task (read-only)' })
  @ApiParam({ name: 'taskKey', description: 'Task key to evaluate' })
  @ApiBody({ type: WhereToRequestDto, required: false })
  @ApiResponse({ status: 200, description: 'Where-to options', type: WhereToResponseDto })
  @ApiResponse({ status: 404, description: 'Task not found' })
  whereTo(@Param('taskKey') taskKey: string, @Body() body?: WhereToRequestDto) {
    return this.ctpService.whereTo(taskKey, body);
  }

  // ─── Endpoint 10: Query Resources by Attribute ───

  @Get('resources/query')
  @ApiOperation({ summary: 'Query resources by typed attributes' })
  @ApiQuery({ name: 'attribute', required: true, description: 'Attribute name, e.g. "lightingAvailable"' })
  @ApiQuery({ name: 'value', required: false, description: 'Value to match' })
  @ApiQuery({ name: 'includeAvailability', required: false, type: Boolean })
  @ApiQuery({ name: 'startTime', required: false, description: 'Filter availability to this window start (ISO datetime)' })
  @ApiQuery({ name: 'endTime', required: false, description: 'Filter availability to this window end (ISO datetime)' })
  @ApiResponse({ status: 200, description: 'Matching resources with optional availability' })
  queryResources(
    @Query('attribute') attribute: string,
    @Query('value') value?: string,
    @Query('includeAvailability') includeAvailability?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    return this.ctpService.queryResources(
      attribute,
      value,
      includeAvailability === 'true',
      startTime,
      endTime,
    );
  }

  // ─── Endpoint 11: CTP Query (Stateless) ───

  @Post('query')
  @ApiOperation({ summary: 'Stateless CTP query — when can this order be scheduled?' })
  @ApiBody({ type: CTPQueryDto })
  @ApiResponse({ status: 200, description: 'Feasible placement options' })
  @ApiResponse({ status: 404, description: 'Source chain not found' })
  ctpQuery(@Body() body: CTPQueryDto) {
    return this.ctpService.ctpQuery(body);
  }

  // ─── Endpoint 12: Chain Templates ───

  @Get('chain-templates')
  @ApiOperation({ summary: 'List existing chains available as CTP query templates' })
  @ApiResponse({ status: 200, description: 'Chain templates with task structure' })
  getChainTemplates() {
    return this.ctpService.getChainTemplates();
  }

  // ─── Endpoint 15: Critical Path Analysis ───

  @Get('critical-path')
  @ApiOperation({
    summary: 'Compute critical path analysis for the current schedule',
    description: 'Builds a disjunctive graph from the scheduled landscape and returns the critical path, bottleneck resource, per-task slack, and critical-path segments by resource. Read-only.',
  })
  @ApiResponse({ status: 200, description: 'Critical path analysis' })
  @ApiResponse({ status: 400, description: 'No scheduled tasks' })
  getCriticalPath() {
    return this.ctpService.getCriticalPath();
  }

  // ─── Endpoint 13: Set Task Window ───

  @Patch('tasks/:taskKey/window')
  @ApiOperation({
    summary: 'Directly modify a task\'s scheduling window on the live landscape',
    description: 'Mutates the task window in memory. Does NOT trigger a re-solve. Use with preserveLandscape solve for multi-step operations.',
  })
  @ApiParam({ name: 'taskKey', description: 'Task key to modify' })
  @ApiBody({ type: SetTaskWindowDto })
  @ApiResponse({ status: 200, description: 'Window updated' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  setTaskWindow(@Param('taskKey') taskKey: string, @Body() body: SetTaskWindowDto) {
    return this.ctpService.setTaskWindow(taskKey, body.windowStart, body.windowEnd);
  }

  // ─── Endpoint 14: Set Task Priority ───

  @Patch('tasks/:taskKey/priority')
  @ApiOperation({
    summary: 'Directly modify a task\'s priority on the live landscape',
    description: 'Mutates the task priority in memory. Does NOT trigger a re-solve.',
  })
  @ApiParam({ name: 'taskKey', description: 'Task key to modify' })
  @ApiBody({ type: SetTaskPriorityDto })
  @ApiResponse({ status: 200, description: 'Priority updated' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  setTaskPriority(@Param('taskKey') taskKey: string, @Body() body: SetTaskPriorityDto) {
    return this.ctpService.setTaskPriority(taskKey, body.priority);
  }

  // ─── Endpoint 9: Move-To ───

  @Post('tasks/:taskKey/move-to')
  @ApiOperation({ summary: 'Move a task to a specific scheduling option' })
  @ApiParam({ name: 'taskKey', description: 'Task key to move' })
  @ApiBody({ type: MoveToRequestDto })
  @ApiResponse({ status: 200, description: 'Task moved', type: MoveToResponseDto })
  @ApiResponse({ status: 400, description: 'Option not feasible' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  moveTo(@Param('taskKey') taskKey: string, @Body() body: MoveToRequestDto) {
    return this.ctpService.moveTo(taskKey, body);
  }

  // ─── Endpoint 16: Diagnose ───

  @Post('diagnose')
  @ApiOperation({
    summary: 'Diagnose infeasible/suboptimal tasks and recommend resolutions',
    description: 'Analyzes root causes, generates ranked recommendations with tradeoffs. Read-only — does not modify the schedule.',
  })
  @ApiBody({ type: DiagnoseRequestDto })
  @ApiResponse({ status: 200, description: 'Diagnoses with ranked recommendations' })
  diagnose(@Body() body: DiagnoseRequestDto) {
    return this.ctpService.diagnose(body);
  }

  // ─── Endpoint 17: Apply Recommendation ───

  @Post('apply-recommendation')
  @ApiOperation({
    summary: 'Apply a recommendation from diagnose results',
    description: 'Executes a command sequence with staleness check and rollback on failure. Used by AI chat and future UI workflows.',
  })
  @ApiBody({ type: ApplyRecommendationRequestDto })
  @ApiResponse({ status: 200, description: 'Recommendation applied with result' })
  @ApiResponse({ status: 409, description: 'Landscape changed — re-diagnose required' })
  applyRecommendation(@Body() body: ApplyRecommendationRequestDto) {
    return this.ctpService.applyRecommendation(body);
  }

  // ─── Commitment Stack Transitions ───

  @Post('tasks/dispatch')
  @ApiOperation({ summary: 'Mark tasks as dispatched (materials pulled, operator assigned)' })
  @ApiResponse({ status: 200, description: 'Tasks dispatched' })
  dispatch(@Body() body: { taskKeys: string[]; actualResources?: string[] }) {
    return this.ctpService.dispatchTasks(body.taskKeys, body.actualResources);
  }

  @Post('tasks/start')
  @ApiOperation({ summary: 'Mark a task as running (in process)' })
  @ApiResponse({ status: 200, description: 'Task started' })
  startTask(@Body() body: { taskKey: string; actualStart?: string; actualResources?: string[] }) {
    return this.ctpService.startTask(body.taskKey, body.actualStart, body.actualResources);
  }

  @Post('tasks/hold')
  @ApiOperation({ summary: 'Put a running task on hold' })
  @ApiResponse({ status: 200, description: 'Task on hold' })
  holdTask(@Body() body: { taskKey: string; holdReason: string; estimatedResumeTime?: string }) {
    return this.ctpService.holdTask(body.taskKey, body.holdReason, body.estimatedResumeTime);
  }

  @Post('tasks/resume')
  @ApiOperation({ summary: 'Resume a held task' })
  @ApiResponse({ status: 200, description: 'Task resumed' })
  resumeTask(@Body() body: { taskKey: string }) {
    return this.ctpService.resumeTask(body.taskKey);
  }

  @Post('tasks/complete')
  @ApiOperation({ summary: 'Mark a task as completed' })
  @ApiResponse({ status: 200, description: 'Task completed' })
  completeTask(@Body() body: { taskKey: string; actualEnd?: string }) {
    return this.ctpService.completeTask(body.taskKey, body.actualEnd);
  }

  @Patch('tasks/:taskKey/progress')
  @ApiOperation({ summary: 'Update percent complete and/or remaining duration' })
  @ApiResponse({ status: 200, description: 'Progress updated' })
  updateProgress(@Param('taskKey') taskKey: string, @Body() body: { percentComplete?: number; remainingDuration?: number }) {
    return this.ctpService.updateProgress(taskKey, body);
  }

  // ─── Admin: Tenant Management ───

  @Get('admin/tenants')
  @ApiOperation({ summary: 'List all available tenants' })
  @ApiResponse({ status: 200, description: 'Tenant list' })
  listTenants() {
    return this.ctpService.listTenants();
  }

  @Post('admin/clone-tenant')
  @ApiOperation({ summary: 'Clone a tenant configuration' })
  @ApiResponse({ status: 201, description: 'Tenant cloned' })
  @ApiResponse({ status: 400, description: 'Invalid tenant name' })
  @ApiResponse({ status: 404, description: 'Source tenant not found' })
  @ApiResponse({ status: 409, description: 'Target tenant already exists' })
  cloneTenant(@Body() body: { sourceTenant: string; targetTenant: string; displayName?: string }) {
    return this.ctpService.cloneTenant(body.sourceTenant, body.targetTenant, body.displayName);
  }

  @Delete('admin/tenant/:tenantId')
  @ApiOperation({ summary: 'Delete a cloned tenant' })
  @ApiResponse({ status: 200, description: 'Tenant deleted' })
  @ApiResponse({ status: 403, description: 'Cannot delete source tenant' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  deleteTenant(@Param('tenantId') tenantId: string) {
    return this.ctpService.deleteTenant(tenantId);
  }

  @Post('admin/tenant/:tenantId/reset')
  @ApiOperation({ summary: 'Reset a cloned tenant to its source state' })
  @ApiResponse({ status: 200, description: 'Tenant reset' })
  @ApiResponse({ status: 400, description: 'Not a clone' })
  @ApiResponse({ status: 403, description: 'Cannot reset source tenant' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  resetTenant(@Param('tenantId') tenantId: string) {
    return this.ctpService.resetTenant(tenantId);
  }
}
