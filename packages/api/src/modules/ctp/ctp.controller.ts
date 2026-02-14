import { Controller, Post, Get, Body } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { CTPService } from './ctp.service';
import { SolveRequestDto } from './dto/solve-request.dto';
import { CTPSolveResultDto } from './dto/solve-result.dto';

@ApiTags('ctp')
@Controller('ctp')
export class CTPController {
  constructor(private readonly ctpService: CTPService) {}

  @Post('solve')
  @ApiOperation({
    summary:
      'Run scheduler and return results. Optionally filter which tasks to schedule.',
  })
  @ApiBody({
    type: SolveRequestDto,
    required: false,
    description: 'Optional task filter. Omit to schedule all tasks.',
  })
  @ApiResponse({
    status: 200,
    description: 'Schedule results',
    type: CTPSolveResultDto,
  })
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
  @ApiOperation({
    summary: 'Reload config, solve, and return results (demo endpoint)',
  })
  @ApiBody({
    type: SolveRequestDto,
    required: false,
    description: 'Optional task filter. Omit to schedule all tasks.',
  })
  @ApiResponse({
    status: 200,
    description: 'Schedule results',
    type: CTPSolveResultDto,
  })
  solveAndSync(@Body() body?: SolveRequestDto) {
    return this.ctpService.solve(body);
  }
}
