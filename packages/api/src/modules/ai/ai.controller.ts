import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('ai')
@Controller('ai')
export class AIController {
  @Post('chat')
  @ApiOperation({ summary: 'Proxy chat request to Anthropic API' })
  async chat(@Body() body: { model?: string; max_tokens?: number; system?: string; messages?: any[]; tools?: any[] }) {
    const apiKey = process.env.CTP_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpException('CTP_ANTHROPIC_API_KEY not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

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
      const error = await response.text();
      throw new HttpException(
        `Anthropic API error: ${response.status} ${error}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    return response.json();
  }
}
