import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import {
  InjectMetric,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const HTTP_REQUEST_COUNT = 'http_requests_total';
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';
export const INDEXER_LAG = 'indexer_lag_ledgers';
export const HORIZON_HEALTH = 'horizon_up';
export const DB_POOL_OPEN = 'db_pool_open';
export const RECONCILIATION_DRIFT = 'state_reconciliation_drift';
export const JOB_LAST_SUCCESS_TIMESTAMP_SECONDS =
  'job_last_success_timestamp_seconds';
export const JOB_CONSECUTIVE_FAILURES = 'job_consecutive_failures';

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
  makeGaugeProvider({
    name: RECONCILIATION_DRIFT,
    help: 'Current reconciliation drift count by mismatch type',
    labelNames: ['type'] as const,
  }),
  makeGaugeProvider({
    name: JOB_LAST_SUCCESS_TIMESTAMP_SECONDS,
    help: 'Unix timestamp of the last successful run for a background job',
    labelNames: ['job'] as const,
  }),
  makeGaugeProvider({
    name: JOB_CONSECUTIVE_FAILURES,
    help: 'Number of consecutive failed runs for a background job',
    labelNames: ['job'] as const,
  }),
];

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric(HTTP_REQUEST_COUNT)
    private readonly requestCounter: Counter<string>,
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly requestDuration: Histogram<string>,
    @InjectMetric(INDEXER_LAG)
    private readonly indexerLag: Gauge<string>,
    @InjectMetric(HORIZON_HEALTH)
    private readonly horizonHealth: Gauge<string>,
    @InjectMetric(DB_POOL_OPEN)
    private readonly dbPoolOpen: Gauge<string>,
    @InjectMetric(RECONCILIATION_DRIFT)
    private readonly reconciliationDrift: Gauge<string>,
    @InjectMetric(JOB_LAST_SUCCESS_TIMESTAMP_SECONDS)
    private readonly jobLastSuccessTimestamp: Gauge<string>,
    @InjectMetric(JOB_CONSECUTIVE_FAILURES)
    private readonly jobConsecutiveFailures: Gauge<string>,
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

  setIndexerLag(lag: number): void {
    this.indexerLag.set(lag);
  }

  setHorizonHealth(up: boolean): void {
    this.horizonHealth.set(up ? 1 : 0);
  }

  setDbPoolOpen(count: number): void {
    this.dbPoolOpen.set(count);
  }

  setReconciliationDrift(type: string, count: number): void {
    this.reconciliationDrift.labels(type).set(count);
  }

  setJobLastSuccessTimestamp(job: string, timestampSeconds: number): void {
    this.jobLastSuccessTimestamp.labels(job).set(timestampSeconds);
  }

  setJobConsecutiveFailures(job: string, count: number): void {
    this.jobConsecutiveFailures.labels(job).set(count);
  }
}
