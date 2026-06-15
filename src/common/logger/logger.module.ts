import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'trace'),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.headers["set-cookie"]',
            'body.password',
            'body.secret',
            'body.token',
            'body.refreshToken',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: true } }
            : undefined,
        customProps: (req) => ({
          correlationId: (req as any).correlationId || (req as any).id || randomUUID(),
        }),
        autoLogging: {
          ignore: (req) => (req as any).url === '/metrics',
        },
      },
    }),
  ],
})
export class LoggerModule {}
