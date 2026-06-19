import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 0.1,
});

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger';

const BANNER = `
  ___  _            ___ _
 / __|| |_ ___  _ _| __(_)
 \__ \|  _/ -_)| '_| _|| |
 |___/ \__\___||_| |_| |_|
   Step into your future, pay small small.
`;

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  const port = process.env.PORT || 4000;
  const apiPrefix = process.env.API_PREFIX || 'api/v1';

  app.setGlobalPrefix(apiPrefix, { exclude: ['metrics', '.well-known/stellar.toml'] });

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupSwagger(app);

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    const docsUsername = process.env.DOCS_USERNAME;
    const docsPassword = process.env.DOCS_PASSWORD;

    if (docsUsername && docsPassword) {
      const docsPaths = [`/${apiPrefix}/docs`, `/${apiPrefix}/docs-json`];

      app.getHttpAdapter().getInstance().addHook('preHandler', (request: any, reply: any, done: () => void) => {
        if (!docsPaths.includes(request.url)) {
          done();
          return;
        }

        const authHeader = request.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          reply.header('WWW-Authenticate', 'Basic realm="StepFi API Docs"');
          reply.status(401).send({ message: 'Documentation requires authentication' });
          return;
        }

        const base64 = authHeader.slice(6);
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        const colonIdx = decoded.indexOf(':');

        if (colonIdx === -1) {
          reply.status(401).send({ message: 'Invalid authorization header format' });
          return;
        }

        const username = decoded.slice(0, colonIdx);
        const password = decoded.slice(colonIdx + 1);

        if (username !== docsUsername || password !== docsPassword) {
          reply.header('WWW-Authenticate', 'Basic realm="StepFi API Docs"');
          reply.status(401).send({ message: 'Invalid credentials' });
          return;
        }

        done();
      });
    }
  }

  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(BANNER);
  logger.log(`Server running at: http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger docs at:   http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`Environment:       ${process.env.NODE_ENV || 'development'}`);
  logger.log(`Started at:        ${new Date().toISOString()}`);
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
