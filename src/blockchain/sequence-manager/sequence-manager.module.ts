import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  SequenceManagerService,
} from './sequence-manager.service';
import {
  SequenceMetrics,
  sequenceManagerMetricProviders,
} from './sequence-manager.metrics';

/**
 * Global module so the sequence manager is available everywhere without a
 * per-feature import dance. Metric providers attach to the prom-client
 * global registry that `MetricsModule` exposes; we deliberately do NOT
 * call `PrometheusModule.register()` here so we don't create a second
 * Prometheus controller/registry.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    ...sequenceManagerMetricProviders,
    SequenceMetrics,
    SequenceManagerService,
  ],
  exports: [SequenceManagerService, SequenceMetrics],
})
export class SequenceManagerModule {}
