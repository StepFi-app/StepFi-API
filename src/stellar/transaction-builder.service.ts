import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { StellarService } from './stellar.service';

interface CachedFeeStats {
  stats: FeeStats;
  expiresAt: number;
}

interface FeeStats {
  lastLedgerBaseFee: bigint;
  feeChargedP95: bigint;
}

interface FeeBumpTransactionOptions {
  baseFee?: string;
  percentile?: number;
}

@Injectable()
export class TransactionBuilderService {
  private readonly logger = new Logger(TransactionBuilderService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;
  private feeStatsCache: CachedFeeStats | null = null;

  private readonly feeStatsCacheTtlMs = 15_000;
  private readonly maxBuildAttempts = 2;
  private readonly maxSubmitAttempts = 1;
  private readonly feeRetryMultipliers = [125, 150, 200];

  constructor(
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
  ) {
    this.horizonServer = this.stellarService.getHorizonServer();
    this.networkPassphrase = this.stellarService.getNetworkPassphrase();
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  async estimateBaseFee(percentile = 95): Promise<string> {
    const stats = await this.getFeeStats();
    const baseFee = this.max([
      BigInt(StellarSdk.BASE_FEE),
      stats.lastLedgerBaseFee,
      stats.feeChargedP95,
    ]);

    return baseFee.toString();
  }

  async estimateFee(operationCount: number, percentile = 95): Promise<string> {
    const normalizedOperationCount = Math.max(1, Math.ceil(operationCount));
    const baseFee = BigInt(await this.estimateBaseFee(percentile));
    return (baseFee * BigInt(normalizedOperationCount)).toString();
  }

  async estimateFeeForTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
    percentile = 95,
  ): Promise<string> {
    return this.estimateFee(this.getTransactionOperationCount(transaction), percentile);
  }

  async buildFeeBumpTransaction(
    innerXdr: string,
    options: FeeBumpTransactionOptions = {},
  ): Promise<string> {
    const parsed = StellarSdk.TransactionBuilder.fromXDR(innerXdr, this.networkPassphrase);

    if (this.isFeeBumpTransaction(parsed)) {
      throw new Error('Cannot fee bump an already fee-bumped transaction.');
    }

    const innerTransaction = parsed;
    const baseFee =
      options.baseFee ?? (await this.estimateBaseFee(options.percentile ?? 95));
    const minimumBaseFee = this.getInnerBaseFee(innerTransaction);
    const normalizedBaseFee = this.max([
      BigInt(StellarSdk.BASE_FEE),
      BigInt(baseFee),
      minimumBaseFee,
    ]).toString();
    const feeSourceSecret =
      this.configService.get<string>('STELLAR_FEE_BUMP_SECRET') ||
      this.configService.get<string>('STELLAR_FEE_SOURCE_SECRET');

    if (!feeSourceSecret) {
      throw new Error('STELLAR_FEE_BUMP_SECRET is not configured.');
    }

    const feeSourceKeypair = StellarSdk.Keypair.fromSecret(feeSourceSecret);
    const feeBumpTransaction = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feeSourceKeypair,
      normalizedBaseFee,
      innerTransaction,
      this.networkPassphrase,
    );

    feeBumpTransaction.sign(feeSourceKeypair);
    return feeBumpTransaction.toXDR();
  }

  async buildWithFeeRetry<T>(
    operationCount: number,
    label: string,
    build: (fee: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxBuildAttempts; attempt++) {
      const percentile = attempt === 0 ? 95 : 99;
      const fee = await this.estimateFee(operationCount, percentile);

      try {
        return await build(fee);
      } catch (error) {
        lastError = error;

        if (!this.isInsufficientFeeError(error) || attempt >= this.maxBuildAttempts) {
          throw error;
        }

        this.logger.warn(`${label} failed with an insufficient fee; retrying with a higher fee`);
      }
    }

    throw new Error(`Failed to build ${label} after fee retries`);
  }

  async submitWithFeeRetry<T>(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
    submit: (
      transactionToSubmit: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    let currentTransaction = transaction;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxSubmitAttempts; attempt++) {
      try {
        return await submit(currentTransaction);
      } catch (error) {
        lastError = error;

        if (
          !this.isInsufficientFeeError(error) ||
          attempt >= this.maxSubmitAttempts ||
          this.isFeeBumpTransaction(currentTransaction)
        ) {
          throw error;
        }

        const baseFee = this.scaleBaseFee(
          await this.estimateBaseFee(attempt === 0 ? 95 : 99),
          this.feeRetryMultipliers[attempt],
        );
        currentTransaction = StellarSdk.TransactionBuilder.fromXDR(
          await this.buildFeeBumpTransaction(currentTransaction.toXDR(), { baseFee }),
          this.networkPassphrase,
        );
      }
    }

    throw lastError;
  }

  isInsufficientFeeError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();

    return (
      normalized.includes('tx_insufficient_fee') ||
      normalized.includes('insufficient fee') ||
      normalized.includes('fee is too low')
    );
  }

  private async getFeeStats(): Promise<FeeStats> {
    const now = Date.now();

    if (this.feeStatsCache && this.feeStatsCache.expiresAt > now) {
      return this.feeStatsCache.stats;
    }

    try {
      const response = await this.horizonServer.feeStats();
      const stats = {
        lastLedgerBaseFee: this.parseStroopValue(
          response.last_ledger_base_fee,
          BigInt(StellarSdk.BASE_FEE),
        ),
        feeChargedP95: this.parseStroopValue(
          response.fee_charged.p95,
          BigInt(StellarSdk.BASE_FEE),
        ),
      };

      this.feeStatsCache = {
        stats,
        expiresAt: now + this.feeStatsCacheTtlMs,
      };

      return stats;
    } catch (error) {
      this.logger.warn(`Horizon fee_stats unavailable; falling back to base fee: ${error.message}`);
      const fallback = BigInt(StellarSdk.BASE_FEE);

      return {
        lastLedgerBaseFee: fallback,
        feeChargedP95: fallback,
      };
    }
  }

  private parseStroopValue(value: unknown, fallback: bigint): bigint {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return BigInt(Math.round(value));
    }

    if (typeof value === 'string') {
      const normalized = value.trim();

      if (/^\d+$/.test(normalized)) {
        return BigInt(normalized);
      }
    }

    return fallback;
  }

  private getInnerBaseFee(transaction: StellarSdk.Transaction): bigint {
    const operationCount = BigInt(Math.max(1, transaction.operations.length));
    const fee = BigInt(transaction.fee);

    return (fee + operationCount - 1n) / operationCount;
  }

  private getTransactionOperationCount(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): number {
    if (this.isFeeBumpTransaction(transaction)) {
      return transaction.innerTransaction.operations.length + 1;
    }

    return transaction.operations.length;
  }

  private isFeeBumpTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): transaction is StellarSdk.FeeBumpTransaction {
    return 'innerTransaction' in transaction;
  }

  private scaleBaseFee(baseFee: string, multiplier: number): string {
    const fee = BigInt(baseFee);

    return ((fee * BigInt(multiplier) + 99n) / 100n).toString();
  }

  private max(values: bigint[]): bigint {
    return values.reduce((current, value) => (value > current ? value : current), 0n);
  }
}
