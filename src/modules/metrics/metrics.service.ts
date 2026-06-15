import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const HTTP_REQUEST_COUNT = 'http_requests_total';
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';
export const BULLMQ_QUEUE_DEPTH = 'bullmq_queue_depth';
export const INDEXER_LAG = 'indexer_lag_ledgers';
export const HORIZON_HEALTH = 'horizon_up';
export const DB_POOL_OPEN = 'db_pool_open';

export const metricProviders = [
  makeCounterProvider({
    name: HTTP_REQUEST_COUNT,
    help: 'Total HTTP requests',
    labelNames: ['method', 'status', 'path'] as const,
  }),
  makeHistogramProvider({
    name: HTTP_REQUEST_DURATION_SECONDS,
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'status', 'path'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),
  makeGaugeProvider({
    name: BULLMQ_QUEUE_DEPTH,
    help: 'Current depth of BullMQ queues',
    labelNames: ['queue'] as const,
  }),
  makeGaugeProvider({
    name: INDEXER_LAG,
    help: 'Indexer lag in ledger count behind the network tip',
  }),
  makeGaugeProvider({
    name: HORIZON_HEALTH,
    help: 'Whether the Stellar Horizon endpoint is reachable (1 = up, 0 = down)',
  }),
  makeGaugeProvider({
    name: DB_POOL_OPEN,
    help: 'Number of open database connections',
  }),
];

@Injectable()
export class MetricsService {
  constructor(
    @Inject(HTTP_REQUEST_COUNT)
    private readonly requestCounter: Counter<string>,
    @Inject(HTTP_REQUEST_DURATION_SECONDS)
    private readonly requestDuration: Histogram<string>,
    @Inject(BULLMQ_QUEUE_DEPTH)
    private readonly queueDepth: Gauge<string>,
    @Inject(INDEXER_LAG)
    private readonly indexerLag: Gauge<string>,
    @Inject(HORIZON_HEALTH)
    private readonly horizonHealth: Gauge<string>,
    @Inject(DB_POOL_OPEN)
    private readonly dbPoolOpen: Gauge<string>,
  ) {}

  async getMetrics(): Promise<string> {
    const register = (await import('prom-client')).register;
    return register.metrics();
  }

  incrementHttpRequest(method: string, status: number, path: string): void {
    this.requestCounter.labels(method, String(status), path).inc();
  }

  observeHttpDuration(method: string, status: number, path: string, seconds: number): void {
    this.requestDuration.labels(method, String(status), path).observe(seconds);
  }

  setQueueDepth(queue: string, depth: number): void {
    this.queueDepth.labels(queue).set(depth);
  }

  setIndexerLag(lag: number): void {
    this.indexerLag.set(lag);
  }

  setHorizonHealth(up: boolean): void {
    this.horizonHealth.set(up ? 1 : 0);
  }

  setDbPoolOpen(count: number): void {
    this.dbPoolOpen.set(count);
  }
}
