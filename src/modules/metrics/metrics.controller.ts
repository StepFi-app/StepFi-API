import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { FastifyReply } from 'fastify';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @ApiExcludeEndpoint()
  async getMetrics(@Res() reply: FastifyReply): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.send(metrics);
  }
}
