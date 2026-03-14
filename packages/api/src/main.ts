import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './logging/all-exceptions.filter';
import { LoggerService } from './logging/logger.service';

if (!process.env.CTP_ANTHROPIC_API_KEY) {
  console.warn('⚠️ CTP_ANTHROPIC_API_KEY not set — AI chat will be unavailable');
}

async function bootstrap() {
  try {
    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
    );

    // TODO: custom AllExceptionsFilter disabled — broken on Fastify adapter.
    // NestJS default exception handling works correctly out of the box.
    // const loggerService = app.get(LoggerService);
    // app.useGlobalFilters(new AllExceptionsFilter(loggerService));

    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    const config = new DocumentBuilder()
      .setTitle('CTP Scheduling Engine API')
      .setDescription('Capable to Promise & Slot Finder scheduling engine')
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addGlobalParameters({ name: 'x-tenant-id', in: 'header', required: false, schema: { type: 'string', default: 'demo-manufacturing' } })
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);

    // Serve built Vite UI as static files (if public/ exists)
    // __dirname is packages/api/dist/src/ at runtime
    const publicDir = path.join(__dirname, '..', '..', 'public');
    if (fs.existsSync(publicDir)) {
      const fastify = app.getHttpAdapter().getInstance();
      await fastify.register(require('@fastify/static'), {
        root: publicDir,
        prefix: '/',
        decorateReply: false,
        wildcard: false,
      });
      // SPA fallback: serve index.html for non-API, non-file routes
      fastify.setNotFoundHandler((req: any, reply: any) => {
        if (req.url.startsWith('/v1/') || req.url.startsWith('/docs')) {
          reply.code(404).send({ statusCode: 404, message: 'Not Found' });
        } else {
          reply.sendFile('index.html');
        }
      });
    }

    const port = process.env.PORT || 3000;
    await app.listen(port, '0.0.0.0');
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Swagger docs at http://localhost:${port}/docs`);
  } catch (err: any) {
    // LoggerService not available — write directly to file
    const logDir = process.env.TELEMETRY_LOG_DIR ?? './logs';
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const event = {
      type: 'system_error',
      severity: 'fatal',
      category: guessStartupCategory(err.message),
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
      tenantId: 'system',
      context: { phase: 'startup' },
    };

    fs.appendFileSync(
      `${logDir}/startup-errors.jsonl`,
      JSON.stringify(event) + '\n',
      'utf8',
    );

    console.error('[Bootstrap] FATAL STARTUP ERROR:', err.message);
    console.error('[Bootstrap] Written to', `${logDir}/startup-errors.jsonl`);
    process.exit(1);
  }
}

function guessStartupCategory(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('json') || m.includes('parse') ||
      m.includes('enoent') || m.includes('config')) return 'config';
  if (m.includes('postgres') || m.includes('connect') ||
      m.includes('database')) return 'database';
  return 'unknown';
}

bootstrap();
