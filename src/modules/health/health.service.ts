import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseService } from '../../database/supabase.client';
import { HorizonClientService } from '../../stellar/horizon-client.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly horizonClientService: HorizonClientService,
    private readonly supabaseService: SupabaseService,
    @InjectQueue('blockchain-indexer')
    private readonly indexerQueue: Queue,
    @InjectQueue('payment-reminders')
    private readonly paymentRemindersQueue: Queue,
    @InjectQueue('transaction-status-checker')
    private readonly txStatusQueue: Queue,
    @InjectQueue('nonce-cleanup')
    private readonly nonceCleanupQueue: Queue,
  ) {}
  ) {
    this.horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';
  }

  async check() {
    const [db, horizon, indexer] = await Promise.all([
      this.checkDatabase(),
      this.checkHorizon(),
      this.checkIndexerLag(),
    ]);

    const allOk = [db, horizon, indexer].every(
      (c) => c.status === 'ok',
    );

    return {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      service: 'StepFi API',
      checks: {
        database: db,
        horizon: horizon,
        indexer: indexer,
      },
    };
  }

  async checkDatabase() {
    try {
      const client = this.supabaseService.getClient();
      const { error } = await client.auth.getSession();
      if (error && error.message !== 'Invalid Refresh Token' && !error.message.includes('JWT')) {
        throw error;
      }
      return { status: 'ok', database: 'connected', message: 'Supabase reachable' };
    } catch (error) {
      this.logger.error({ 
        context: 'HealthService', 
        action: 'checkDatabase', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return { 
        status: 'error', 
        database: 'disconnected', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async checkHorizon(): Promise<Record<string, unknown>> {
  async checkHorizon(): Promise<{ status: string; [key: string]: unknown }> {
    try {
      const root = await this.horizonClientService.getRoot();
      const endpoints = this.horizonClientService.getEndpointStatuses();
      const healthyPrimary = endpoints.some((e) => e.isPrimary && e.status === 'closed');
      return {
        status: healthyPrimary ? 'ok' : 'degraded',
        horizon: root.horizon_version,
        network: root.network,
        protocolVersion: root.core_version,
        endpoints,
      };
    } catch (error) {
      this.logger.error({ context: 'HealthService', action: 'checkHorizon', error: (error as Error).message });
      return {
        status: 'error',
        horizon: 'unreachable',
        message: (error as Error).message,
        endpoints: this.horizonClientService.getEndpointStatuses(),
      };
    }
  }

  async checkIndexerLag(): Promise<{ status: string; [key: string]: unknown }> {
    try {
      const cursor = await this.getIndexerCursor();
      const root = await this.horizonClientService.getRoot();
      const latestLedger = root.history_latest_ledger;
      const lag = latestLedger - cursor;
      const status = lag < 100 ? 'ok' : lag < 500 ? 'warning' : 'error';
      return { status, cursor, latestLedger, lag };
    } catch (error) {
      return { status: 'unknown', message: (error as Error).message };
    }
  }

  async checkDatabaseMinimal() {
    return this.checkDatabase();
  }

  private async getIndexerCursor(): Promise<number> {
    try {
      const db = this.supabaseService.getServiceRoleClient();
      const { data } = await db
        .from('indexer_state')
        .select('last_ledger')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      return data ? Number(data.last_ledger) : 0;
    } catch {
      return 0;
    }
  }
}
