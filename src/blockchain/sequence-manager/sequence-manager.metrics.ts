import { Injectable, Optional } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import {
  InjectMetric,
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Metric names exported via the global Prometheus registry.
 * The local blockchain module only registers / observes these — the
 * `MetricsModule` already exposes them on `/metrics` because the providers
 * are imported by `SequenceManagerModule`.
 */
export const SOURCE_SUBMISSIONS_IN_FLIGHT =
  'blockchain_source_submissions_in_flight';
export const SOURCE_BAD_SEQ_RETRIES_TOTAL =
  'blockchain_source_bad_seq_retries_total';
export const SOURCE_SUBMISSIONS_TOTAL =
  'blockchain_source_submissions_total';
export const SOURCE_NEXT_SEQUENCE = 'blockchain_source_next_sequence';

export const sequenceManagerMetricProviders = [
  makeGaugeProvider({
    name: SOURCE_SUBMISSIONS_IN_FLIGHT,
    help: 'Number of server-signed Stellar transactions currently in flight, grouped by source account',
    labelNames: ['source_account'] as const,
  }),
  makeCounterProvider({
    name: SOURCE_BAD_SEQ_RETRIES_TOTAL,
    help: 'Number of tx_bad_seq re-sync retries performed by the sequence manager, grouped by source account',
    labelNames: ['source_account'] as const,
  }),
  makeCounterProvider({
    name: SOURCE_SUBMISSIONS_TOTAL,
    help: 'Number of server-signed Stellar transaction submission attempts, grouped by source account and outcome',
    labelNames: ['source_account', 'outcome'] as const,
  }),
  makeGaugeProvider({
    name: SOURCE_NEXT_SEQUENCE,
    help: 'Next sequence number expected to be used by the sequence manager, grouped by source account',
    labelNames: ['source_account'] as const,
  }),
];

/**
 * Thin helper for emitting sequence-manager metrics. Injectable so the
 * service can be unit-tested without a Nest module, but registered as a
 * global provider by `SequenceManagerModule`.
 */
@Injectable()
export class SequenceMetrics {
  constructor(
    @Optional()
    @InjectMetric(SOURCE_SUBMISSIONS_IN_FLIGHT)
    private readonly inFlight?: Gauge<string>,
    @Optional()
    @InjectMetric(SOURCE_BAD_SEQ_RETRIES_TOTAL)
    private readonly badSeqRetries?: Counter<string>,
    @Optional()
    @InjectMetric(SOURCE_SUBMISSIONS_TOTAL)
    private readonly submissions?: Counter<string>,
    @Optional()
    @InjectMetric(SOURCE_NEXT_SEQUENCE)
    private readonly nextSequence?: Gauge<string>,
  ) {}

  incInFlight(publicKey: string): void {
    this.inFlight?.labels(publicKey).inc();
  }

  decInFlight(publicKey: string): void {
    this.inFlight?.labels(publicKey).dec();
  }

  setInFlight(labeledCount: number): void {
    this.inFlight?.set(labeledCount);
  }

  incBadSeqRetry(publicKey: string): void {
    this.badSeqRetries?.labels(publicKey).inc();
  }

  resetBadSeqRetries(): void {
    this.badSeqRetries?.reset();
  }

  incSubmitted(publicKey: string): void {
    this.submissions?.labels(publicKey, 'success').inc();
  }

  incSubmissionError(publicKey: string, outcome: string): void {
    this.submissions?.labels(publicKey, outcome).inc();
  }

  observeSequence(publicKey: string, sequence: bigint): void {
    this.nextSequence?.labels(publicKey).set(Number(sequence));
  }

  /**
   * Test helper — snapshots the labeled values of the bad-seq counter so
   * unit tests can assert the metric actually incremented. Returns an
   * empty array if the metric is unmocked in the test module.
   */
  async badSeqRetriesSnapshot(): Promise<
    Array<{ labels: { source_account: string }; value: number }>
  > {
    if (!this.badSeqRetries) return [];
    const metric = await this.badSeqRetries.get();
    return metric.values.map((v) => ({
      labels: v.labels as { source_account: string },
      value: v.value,
    }));
  }
}
