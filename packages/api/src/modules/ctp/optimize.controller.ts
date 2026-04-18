import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { OptimizeService, OptimizeJobConfig, OptimizationResult } from './optimize.service';
import { CTPService } from './ctp.service';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';

// ═══════════════════════════════════════════════════════════════
//  Request / Response DTOs
// ═══════════════════════════════════════════════════════════════

export class StartOptimizeDto {
  /** Time budget in seconds for the entire optimization run. Default: 300 (5 min). */
  @IsOptional() @IsNumber() @Min(5)
  timeBudgetSeconds?: number;

  /** Number of ILS passes. Default: 5. */
  @IsOptional() @IsNumber() @Min(1)
  passes?: number;

  /** Perturbation strength (0–1). Default: 0.07. */
  @IsOptional() @IsNumber() @Min(0) @Max(1)
  perturbStrength?: number;

  /** ISO datetime — tasks scheduled before this are frozen. Optional. */
  @IsOptional() @IsString()
  freezeHorizon?: string;

  /** Per-pass tabu iteration cap. Optional — falls back to settings.tabuIterations ?? 2000. */
  @IsOptional() @IsNumber() @Min(1)
  maxIterations?: number;

  /** Per-pass no-improvement cutoff. Optional — falls back to settings.tabuStagnation ?? 300. */
  @IsOptional() @IsNumber() @Min(1)
  stagnationLimit?: number;

  /** Convergence chart heartbeat — emit a sample every N iterations. Default 25. */
  @IsOptional() @IsNumber() @Min(1)
  sampleEveryN?: number;
}

// ═══════════════════════════════════════════════════════════════
//  Controller
// ═══════════════════════════════════════════════════════════════

@Controller('ctp/optimize')
export class OptimizeController {
  constructor(
    private readonly optimizeService: OptimizeService,
    private readonly ctpService: CTPService,
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
  ) {}

  // ─── POST /v1/ctp/optimize — kick off background optimization ───

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  startOptimize(@Body() dto: StartOptimizeDto): { jobId: string } {
    const tenantId = this.configService.getTenantId();
    const landscape = this.stateService.getLandscape();

    if (!landscape) {
      throw new BadRequestException('No schedule loaded. Run a solve first.');
    }

    // Snapshot the landscape hash so we can detect drift at accept time.
    const landscapeHash = this.ctpService.computeLandscapeHash();

    const config: OptimizeJobConfig = {
      timeBudgetSeconds: dto.timeBudgetSeconds ?? 300,
      passes: dto.passes ?? 5,
      perturbStrength: dto.perturbStrength ?? 0.07,
      freezeHorizon: dto.freezeHorizon,
      maxIterations: dto.maxIterations,
      stagnationLimit: dto.stagnationLimit,
      sampleEveryN: dto.sampleEveryN,
    };

    try {
      // Cleanup stale jobs before starting a new one.
      this.optimizeService.cleanupJobs();
      const jobId = this.optimizeService.startJob(tenantId, landscape, landscapeHash, config);
      return { jobId };
    } catch (err: any) {
      throw new ConflictException(err.message);
    }
  }

  // ─── GET /v1/ctp/optimize/:jobId — poll status + results ───

  @Get(':jobId')
  getJobStatus(
    @Param('jobId') jobId: string,
    @Query('since') since?: string,
  ) {
    const job = this.optimizeService.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Optimization job ${jobId} not found`);
    }

    // Filter samples incrementally if the caller is tracking cumulativeIteration.
    // Clients send ?since=<lastSeenCumulativeIteration> so each poll only
    // returns new samples, not the whole buffer.
    let progress = job.progress;
    if (progress) {
      const sinceN = since !== undefined ? parseInt(since, 10) : NaN;
      if (Number.isFinite(sinceN)) {
        progress = {
          ...progress,
          samples: progress.samples.filter(s => s.cumulativeIteration > sinceN),
        };
      }
    }

    return {
      jobId: job.jobId,
      status: job.status,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      config: job.config,
      ...(progress ? { progress } : {}),
      ...(job.status === 'complete' && job.result ? { result: job.result } : {}),
      ...(job.status === 'failed' && job.error ? { error: job.error } : {}),
    };
  }

  // ─── POST /v1/ctp/optimize/:jobId/accept — commit optimized schedule ───

  @Post(':jobId/accept')
  @HttpCode(HttpStatus.OK)
  acceptJob(@Param('jobId') jobId: string): { accepted: boolean; result?: OptimizationResult } {
    const job = this.optimizeService.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Optimization job ${jobId} not found`);
    }

    if (job.status !== 'complete') {
      throw new BadRequestException(
        `Job ${jobId} is ${job.status} — can only accept completed jobs`,
      );
    }

    if (!job.bestGraph) {
      throw new BadRequestException(
        `Job ${jobId} has no optimized result — it may have already been accepted or rejected`,
      );
    }

    const liveLandscape = this.stateService.getLandscape();
    if (!liveLandscape) {
      throw new BadRequestException('No live schedule found for this tenant');
    }

    // Drift check: compare current landscape hash against what was recorded at job start.
    const currentHash = this.ctpService.computeLandscapeHash();

    let result: OptimizationResult | null;
    try {
      result = this.optimizeService.acceptJob(jobId, liveLandscape, currentHash);
    } catch (err: any) {
      // Drift detected — surface as 409 Conflict so the UI can prompt re-run
      throw new ConflictException(err.message);
    }

    return { accepted: true, result: result ?? undefined };
  }

  // ─── POST /v1/ctp/optimize/:jobId/reject — discard optimization ───

  @Post(':jobId/reject')
  @HttpCode(HttpStatus.OK)
  rejectJob(@Param('jobId') jobId: string): { rejected: boolean } {
    const job = this.optimizeService.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Optimization job ${jobId} not found`);
    }

    this.optimizeService.rejectJob(jobId);
    return { rejected: true };
  }
}
