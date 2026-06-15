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

  app.setGlobalPrefix(apiPrefix, { exclude: ['metrics'] });

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
