import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
    );
    return pkg.version || '1.0';
  } catch {
    return '1.0';
  }
}

export function setupSwagger(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const swaggerEnabled = configService.get<string>('SWAGGER_ENABLED', 'true');

  if (swaggerEnabled === 'false') {
    return;
  }

  const version = readPackageVersion();

  const config = new DocumentBuilder()
    .setTitle('StepFi API')
    .setDescription(
      'Off-chain orchestration layer for learner BNPL (Buy Now, Pay Later) on Stellar.\n\n'
      + 'This API manages wallet-based authentication, loan lifecycle, reputation scoring, liquidity pools, '
      + 'vendor registry, mentor vouching, and blockchain transaction submission.\n\n'
      + '## Authentication\n'
      + '- **JWT Bearer Token** — Most endpoints require a valid JWT obtained via `POST /auth/verify`.\n'
      + '- **X-API-Key** — Reserved for admin/vendor service-to-service calls (not yet implemented).',
    )
    .setVersion(version)
    .addBearerAuth()
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for service-to-service authentication',
      },
      'ApiKey-auth',
    )
    .addTag('auth', 'Wallet-based authentication (nonce, verify, refresh, register)')
    .addTag('users', 'User profile management')
    .addTag('learners', 'Learner-specific profile and educational details')
    .addTag('loans', 'Loan lifecycle — quote, create, repay, list, available credit')
    .addTag('reputation', 'On-chain reputation scoring and credit tiers')
    .addTag('liquidity', 'Liquidity pool operations — overview, deposit, withdraw')
    .addTag('sponsors', 'Sponsor registration and pool management')
    .addTag('vendors', 'Learning vendor registry')
    .addTag('vouching', 'Mentor vouching system for credit limit boosts')
    .addTag('transactions', 'Stellar transaction submission and status tracking')
    .addTag('notifications', 'User notifications — list, read, mark as read')
    .addTag('health', 'System health checks (database, Horizon, indexer, Redis, BullMQ)')
    .build();

  const document = SwaggerModule.createDocument(app, config, { deepScanRoutes: true });

  SwaggerModule.setup(`${configService.get('API_PREFIX', 'api/v1')}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      docExpansion: 'list',
    },
    customSiteTitle: 'StepFi API Documentation',
  });
}
