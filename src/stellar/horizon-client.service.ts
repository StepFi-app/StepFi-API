import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';

export interface EndpointStatus {
  url: string;
  status: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: string | null;
  isPrimary: boolean;
}

export interface HorizonRoot {
  horizon_version: string;
  network: string;
  core_version: string;
  history_latest_ledger: number;
}

interface CircuitBreakerState {
  url: string;
  status: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: string | null;
  cooldownUntil: number | null;
}

@Injectable()
export class HorizonClientService implements OnModuleInit {
  private readonly logger = new Logger(HorizonClientService.name);
  private readonly endpoints: string[];
  private readonly states: CircuitBreakerState[] = [];
  private currentIndex = 0;
  private readonly networkPassphrase: string;
  private readonly maxFailures = 3;
  private readonly cooldownMs = 30_000;

  constructor(private readonly configService: ConfigService) {
    const urlsEnv = this.configService.get<string>('STELLAR_HORIZON_URLS');
    const singleUrl = this.configService.get<string>('STELLAR_HORIZON_URL');

    if (urlsEnv) {
      this.endpoints = urlsEnv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      this.endpoints = [singleUrl || 'https://horizon-testnet.stellar.org'];
    }

    if (this.endpoints.length === 0) {
      this.endpoints = ['https://horizon-testnet.stellar.org'];
    }

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;
  }

  onModuleInit() {
    for (const url of this.endpoints) {
      this.states.push({
        url,
        status: 'closed',
        failureCount: 0,
        lastFailure: null,
        cooldownUntil: null,
      });
    }
    this.logger.log(
      `Horizon client initialized with ${this.endpoints.length} endpoint(s): ${this.endpoints.join(', ')}`,
    );
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  getEndpointStatuses(): EndpointStatus[] {
    return this.states.map((s, i) => ({
      url: s.url,
      status: s.status,
      failureCount: s.failureCount,
      lastFailure: s.lastFailure,
      isPrimary: i === this.currentIndex,
    }));
  }

  async getRoot(): Promise<HorizonRoot> {
    return this.withFailover(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        const error: Record<string, unknown> = { message: `Horizon returned ${response.status}` };
        error.response = { status: response.status };
        throw error;
      }
      return response.json() as Promise<HorizonRoot>;
    });
  }

  async submitTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): Promise<Record<string, unknown>> {
    return this.withFailover(async (url) => {
      const server = new StellarSdk.Horizon.Server(url);
      const result = await server.submitTransaction(transaction);
      return result as unknown as Record<string, unknown>;
    });
  }

  async getTransaction(hash: string): Promise<Record<string, unknown>> {
    return this.withFailover(async (url) => {
      const server = new StellarSdk.Horizon.Server(url);
      const result = await server.transactions().transaction(hash).call();
      return result as unknown as Record<string, unknown>;
    });
  }

  private async withFailover<T>(
    operation: (url: string) => Promise<T>,
  ): Promise<T> {
    const startIndex = this.currentIndex;
    const tried = new Set<number>();

    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (startIndex + i) % this.endpoints.length;

      if (tried.has(idx)) {
        continue;
      }
      tried.add(idx);

      const state = this.states[idx];

      if (state.status === 'open') {
        if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
          continue;
        }
        state.status = 'half-open';
      }

      try {
        const result = await operation(state.url);

        state.status = 'closed';
        state.failureCount = 0;
        state.lastFailure = null;
        state.cooldownUntil = null;

        if (idx !== this.currentIndex) {
          this.logger.warn(`Failing over to Horizon endpoint: ${state.url}`);
          this.currentIndex = idx;
        }

        return result;
      } catch (error) {
        if (!this.isEndpointError(error)) {
          throw error;
        }

        state.failureCount++;
        state.lastFailure = (error as Error).message;

        this.logger.error(
          `Horizon endpoint ${state.url} failed: ${(error as Error).message}`,
        );

        if (state.failureCount >= this.maxFailures) {
          state.status = 'open';
          state.cooldownUntil = Date.now() + this.cooldownMs;
          this.logger.warn(
            `Circuit breaker opened for ${state.url} (${this.cooldownMs}ms cooldown)`,
          );
        }
      }
    }

    throw new Error('All Horizon endpoints are unavailable');
  }

  private isEndpointError(error: unknown): boolean {
    if (error instanceof StellarSdk.NetworkError) {
      return true;
    }

    const err = error as {
      response?: {
        status?: number;
        data?: { extras?: { result_codes?: unknown } };
      };
      message?: string;
    };

    if (err?.response?.data?.extras?.result_codes) {
      return false;
    }

    const status = err?.response?.status;

    if (status === 404) {
      return false;
    }

    if (status && status >= 400 && status < 500 && status !== 429) {
      return false;
    }

    if (status === 429 || (status && status >= 500)) {
      return true;
    }

    const message = String(err?.message ?? '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('network') ||
      message.includes('socket')
    );
  }
}
