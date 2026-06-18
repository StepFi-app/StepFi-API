import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { SupabaseService } from '../../database/supabase.client';

@Injectable()
export class MetricsUpdater implements OnModuleInit {
  private readonly logger = new Logger(MetricsUpdater.name);
  private readonly horizonUrl: string;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    @InjectQueue('blockchain-indexer') private readonly blockchainIndexerQueue: Queue,
    @InjectQueue('payment-reminders') private readonly paymentRemindersQueue: Queue,
    @InjectQueue('transaction-status-checker') private readonly txStatusQueue: Queue,
    @InjectQueue('nonce-cleanup') private readonly nonceCleanupQueue: Queue,
  ) {
    this.horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';
  }

  onModuleInit(): void {
    this.updateMetrics();
    setInterval(() => this.updateMetrics(), 30_000);
  }

  private async updateMetrics(): Promise<void> {
    await Promise.allSettled([
      this.updateQueueDepths(),
      this.updateIndexerLag(),
      this.updateHorizonHealth(),
      this.updateDbPool(),
    ]);
  }

  private async updateQueueDepths(): Promise<void> {
    const queues: { name: string; queue: Queue }[] = [
      { name: 'blockchain-indexer', queue: this.blockchainIndexerQueue },
      { name: 'payment-reminders', queue: this.paymentRemindersQueue },
      { name: 'transaction-status-checker', queue: this.txStatusQueue },
      { name: 'nonce-cleanup', queue: this.nonceCleanupQueue },
    ];

    for (const { name, queue } of queues) {
      try {
        const count = await queue.getWaitingCount();
        this.metricsService.setQueueDepth(name, count);
      } catch (err) {
        this.logger.warn({ context: 'MetricsUpdater', action: 'queueDepth', queue: name, error: err.message });
      }
    }
  }

  private async updateIndexerLag(): Promise<void> {
    try {
      const db = this.supabaseService.getServiceRoleClient();
      const { data } = await db
        .from('indexer_state')
        .select('last_ledger')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      const cursorLedger = data ? Number(data.last_ledger) : 0;

      const response = await fetch(this.horizonUrl);
      if (!response.ok) {
        throw new Error(`Horizon returned ${response.status}`);
      }
      const root: any = await response.json();
      const latestLedger = Number(root.history_latest_ledger);
      const lag = latestLedger - cursorLedger;

      this.metricsService.setIndexerLag(Math.max(0, lag));
    } catch (err) {
      this.logger.warn({ context: 'MetricsUpdater', action: 'indexerLag', error: err.message });
    }
  }

  private async updateHorizonHealth(): Promise<void> {
    try {
      const response = await fetch(this.horizonUrl);
      this.metricsService.setHorizonHealth(response.ok);
    } catch {
      this.metricsService.setHorizonHealth(false);
    }
  }

  private async updateDbPool(): Promise<void> {
    try {
      const db = this.supabaseService.getServiceRoleClient();
      const poolerUrl = process.env.DATABASE_URL || '';
      if (!poolerUrl) {
        this.metricsService.setDbPoolOpen(0);
        return;
      }
      const { count } = await db
        .from('_connection_pool')
        .select('*', { count: 'exact', head: true })
        .limit(1);
      this.metricsService.setDbPoolOpen(count ?? 0);
    } catch {
      this.metricsService.setDbPoolOpen(-1);
    }
  }
}
