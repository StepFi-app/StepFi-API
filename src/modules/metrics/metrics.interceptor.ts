import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = http.getResponse<FastifyReply>();
        const duration = (Date.now() - start) / 1000;
        const path = request.routeOptions?.url || request.url || 'unknown';
        const method = request.method || 'UNKNOWN';
        const status = response.statusCode || 200;

        this.metricsService.incrementHttpRequest(method, status, path);
        this.metricsService.observeHttpDuration(method, status, path, duration);
      }),
    );
  }
}
