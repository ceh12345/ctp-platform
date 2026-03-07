import { Controller, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LoggerService } from '../../logging/logger.service';

@ApiTags('ai')
@Controller('ai')
export class AIController {
  constructor(private readonly logger: LoggerService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Proxy chat request to Anthropic API' })
  async chat(
    @Body() body: { model?: string; max_tokens?: number; system?: string; messages?: any[]; tools?: any[]; sessionId?: string; userMessage?: string },
    @Headers('x-tenant-id') tenantId = 'unknown',
  ) {
    const callStart = Date.now();
    const apiKey = process.env.CTP_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpException('CTP_ANTHROPIC_API_KEY not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    let error: string | undefined;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: body.model || process.env.CTP_AI_MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: Math.min(body.max_tokens || 1500, 4000),
          system: body.system,
          messages: body.messages,
          ...(body.tools?.length ? { tools: body.tools } : {}),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        error = `Anthropic API error: ${response.status} ${errText.slice(0, 300)}`;
        throw new HttpException(error, HttpStatus.BAD_GATEWAY);
      }

      const result = await response.json();

      // Log successful AI call
      this.logger.aiCall({
        tenantId,
        sessionId: body.sessionId ?? 'no-session',
        userMessage: (body.userMessage ?? '').slice(0, 200),
        iterations: 1,
        totalDurationMs: Date.now() - callStart,
        tools: [],
        finalResponseLength: JSON.stringify(result).length,
      });

      return result;
    } catch (err: any) {
      if (err instanceof HttpException) {
        // Log API error for non-ok responses
        this.logger.apiError({
          tenantId,
          endpoint: '/ai/chat',
          method: 'POST',
          statusCode: err.getStatus(),
          message: err.message,
        });
        throw err;
      }
      // Unexpected error
      error = err.message;
      this.logger.systemError({
        tenantId,
        severity: 'error',
        category: 'ai_provider',
        message: error!,
        stack: err.stack,
        context: { endpoint: '/ai/chat' },
      });
      throw new HttpException('AI service error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
