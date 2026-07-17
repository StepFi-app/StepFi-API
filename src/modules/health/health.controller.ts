import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Comprehensive health check' })
  @ApiResponse({ status: 200, description: 'All systems healthy' })
  @ApiResponse({ status: 503, description: 'One or more systems degraded' })
  async check() {
    const result = await this.healthService.check();
    return result;
  }

  @Get('db')
  @ApiOperation({ summary: 'Database connection check' })
  @ApiResponse({ status: 200, description: 'Database is connected' })
  @ApiResponse({ status: 503, description: 'Database connection failed' })
  async checkDatabase() {
    return this.healthService.checkDatabaseMinimal();
  }

  @Get('sentry-test')
  @ApiOperation({ summary: 'Trigger a deliberate error to verify Sentry integration' })
  @ApiResponse({ status: 500, description: 'Sentry test error triggered successfully' })
  async triggerSentryTest() {
    throw new Error('sentry test');
  }
}
