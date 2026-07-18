import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../database/supabase.client';

interface HorizonRoot {
  horizon_version: string;
  network: string;
  core_version: string;
  history_latest_ledger: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly horizonUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
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
      return {
        status: 'ok',
        database: 'connected',
        message: 'Supabase reachable',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error({ context: 'HealthService', action: 'checkDatabase', error: error.message });
      return {
        status: 'error',
        database: 'disconnected',
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async checkHorizon(): Promise<{ status: string; [key: string]: unknown }> {
    try {
      const root = await this.fetchHorizonRoot();
      return {
        status: 'ok',
        horizon: root.horizon_version,
        network: root.network,
        protocolVersion: root.core_version,
      };
    } catch (error) {
      this.logger.error({ context: 'HealthService', action: 'checkHorizon', error: error.message });
      return { status: 'error', horizon: 'unreachable', message: error.message };
    }
  }

  async checkIndexerLag(): Promise<{ status: string; [key: string]: unknown }> {
    try {
      const cursor = await this.getIndexerCursor();
      const root = await this.fetchHorizonRoot();
      const latestLedger = root.history_latest_ledger;
      const lag = latestLedger - cursor;
      const status = lag < 100 ? 'ok' : lag < 500 ? 'warning' : 'error';
      return { status, cursor, latestLedger, lag };
    } catch (error) {
      return { status: 'unknown', message: error.message };
    }
  }

  async checkDatabaseMinimal() {
    return this.checkDatabase();
  }

  private async fetchHorizonRoot(): Promise<HorizonRoot> {
    const response = await fetch(this.horizonUrl);
    if (!response.ok) {
      throw new Error(`Horizon returned ${response.status}`);
    }
    return response.json() as Promise<HorizonRoot>;
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
