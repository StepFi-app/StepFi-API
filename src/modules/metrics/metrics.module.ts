import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsController } from './metrics.controller';
import { MetricsService, metricProviders } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsUpdater } from './metrics.updater';
import { SupabaseService } from '../../database/supabase.client';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  controllers: [],
  providers: [
    ...metricProviders,
    MetricsService,
    MetricsUpdater,
    SupabaseService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
