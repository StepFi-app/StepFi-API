import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { randomUUID } from 'node:crypto';
import { ReservationStore } from './reservation-store.interface';
import {
  DEFAULT_LIQUIDITY_POOL_ID,
  reservationKey,
  RESERVATION_DEFAULTS,
  RESERVATION_ERROR_CODES,
  RESERVATION_STORE,
} from './reservations.constants';
import { LiquidityPoolContractClient } from '../../../stellar/contracts/clients/liquidity-pool.client';
import {
  LIQUIDITY_RESERVATION_METRICS,
  LiquidityReservationMetrics,
} from './liquidity-reservation.metrics';

const STROOPS = 10_000_000n;

/**
 * Orchestrates pool-fund reservations around credit assessment →
 * funding-XDR → on-chain settlement.
 *
 * Responsibilities:
 *   1. Look up the on-chain pool capacity (Liquid + Locked) so the
 *      "available" figure accounts for in-flight capital.
 *   2. Translate user-supplied dollar amounts ↔ stroops.
 *   3. Delegate atomic acquire / release to the injected {@link ReservationStore}
 *      (Redis in production, in-memory in tests).
 *   4. Reconcile reservations against on-chain `locked_liquidity` on a
 *      cadence (default every 5 min) and surface drift via metrics.
 */
@Injectable()
export class LiquidityReservationService implements OnModuleDestroy {
  private readonly logger = new Logger(LiquidityReservationService.name);
  private readonly ttlSeconds: number;
  private readonly poolId: string;

  constructor(
    @Inject(RESERVATION_STORE) private readonly store: ReservationStore,
    private readonly poolClient: LiquidityPoolContractClient,
    private readonly configService: ConfigService,
    @InjectMetric(LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_INFLIGHT)
    private readonly inflightGauge: Gauge<string>,
    @InjectMetric(LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_ACQUIRED_TOTAL)
    private readonly acquiredCounter: Counter<string>,
    @InjectMetric(LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_RELEASED_TOTAL)
    private readonly releasedCounter: Counter<string>,
    @InjectMetric(LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_REJECTED_TOTAL)
    private readonly rejectedCounter: Counter<string>,
    @InjectMetric(LIQUIDITY_RESERVATION_METRICS.DRIFT_DETECTED)
    private readonly driftGauge: Gauge<string>,
  ) {
    this.ttlSeconds = this.configService.get<number>(
      'LIQUIDITY_RESERVATION_TTL_SECONDS',
      RESERVATION_DEFAULTS.ttlSeconds,
    );
    this.poolId = this.configService.get<string>(
      'LIQUIDITY_RESERVATION_POOL_ID',
      DEFAULT_LIQUIDITY_POOL_ID,
    );
  }

  /**
   * Acquire a reservation for a pending loan. Throws Nest exceptions that
   * map cleanly to HTTP responses — controllers forward them.
   */
  async reserveForLoan(input: {
    loanId: string;
    wallet: string;
    amountUsd: number;
  }): Promise<{ reservationId: string; expiresAt: Date; poolCapacityUsd: number }> {
    const amountStroops = this.toStroops(input.amountUsd);

    const poolStats = await this.fetchPoolStats();
    const availableStroops = poolStats.availableLiquidity;

    // Sum currently-reserved stroops and use the smaller of contract's
    // availableLiquidity and (available - reserved) as the effective
    // capacity. We ALWAYS submit capacity = availableLiquidity in the
    // Lua script so the reserve-side and on-chain view cannot drift
    // beyond what the contract says is liquid.
    const currentlyReserved = await this.store.totalReserved(this.poolId);
    const effectiveCapacity = availableStroops;

    const reservationId = `resv-${input.loanId}-${randomUUID()}`;
    const metadata = {
      poolId: this.poolId,
      wallet: input.wallet,
      loanId: input.loanId,
      amount: amountStroops,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
    };

    const outcome = await this.store.acquire({
      poolId: this.poolId,
      capacity: effectiveCapacity,
      reservationId,
      amount: amountStroops,
      ttlSeconds: this.ttlSeconds,
      metadata,
    });

    if (outcome.kind === 'acquired') {
      this.acquiredCounter.inc();
      this.inflightGauge.inc();
      this.logger.log(
        {
          reservationId,
          loanId: input.loanId,
          amountUsd: input.amountUsd,
          wallet: input.wallet,
          totalReservedStroops: outcome.totalReserved.toString(),
        },
        'Liquidity reservation acquired',
      );
      return {
        reservationId,
        expiresAt: outcome.expiresAt,
        poolCapacityUsd: this.fromStroops(effectiveCapacity),
      };
    }

    if (outcome.kind === 'insufficient') {
      this.rejectedCounter.inc({ reason: 'insufficient' });
      throw new BadRequestException({
        code: RESERVATION_ERROR_CODES.INSUFFICIENT,
        message: `Pool has insufficient liquidity for $${input.amountUsd}. Available: $${this.fromStroops(outcome.capacity - currentlyReserved).toFixed(2)}.`,
      });
    }

    // duplicate
    this.rejectedCounter.inc({ reason: 'duplicate' });
    throw new InternalServerErrorException({
      code: RESERVATION_ERROR_CODES.CONFLICT,
      message: 'A reservation for this loan already exists.',
    });
  }

  async releaseForLoan(loanId: string): Promise<boolean> {
    const reservationId = await this.store.findByLoanId(loanId);
    if (!reservationId) {
      // Nothing to release — could be already cleaned up by TTL.
      return false;
    }
    const meta = await this.store.getMetadata(reservationId);
    if (!meta) {
      return false;
    }
    const released = await this.store.release({
      poolId: this.poolId,
      reservationId,
      amount: meta.amount,
    });
    if (released) {
      this.releasedCounter.inc();
      this.inflightGauge.dec();
      this.logger.log(
        { reservationId, loanId, amountStroops: meta.amount.toString() },
        'Liquidity reservation released',
      );
    }
    return released;
  }

  /** Force release using a known reservation handle (used in error paths). */
  async releaseReservation(reservationId: string): Promise<boolean> {
    const meta = await this.store.getMetadata(reservationId);
    if (!meta) {
      return false;
    }
    const released = await this.store.release({
      poolId: meta.poolId,
      reservationId,
      amount: meta.amount,
    });
    if (released) {
      this.releasedCounter.inc();
      this.inflightGauge.dec();
    }
    return released;
  }

  /**
   * Pure introspection helper; used by tests and the admin-style
   * reconciliation log. Note: returns stroops.
   */
  async getCurrentReservationTotal(): Promise<bigint> {
    return this.store.totalReserved(this.poolId);
  }

  /**
   * Cron reconciliation: prune expired entries (already done lazily by
   * the store) AND emit metrics about the drift between reservation
   * total and on-chain locked_liquidity. Drift is expected early in a
   * reservation window (the on-chain lock hasn't happened yet) so we
   * only flag it when reservations > locked.
   */
  @Cron(RESERVATION_DEFAULTS.reconcileCron)
  async reconcile(): Promise<void> {
    try {
      const poolStats = await this.fetchPoolStats().catch(() => null);
      const reserved = await this.store.totalReserved(this.poolId);

      if (!poolStats) {
        this.driftGauge.set(0);
        return;
      }

      const onchainLocked = poolStats.lockedLiquidity;
      // Positive drift = we have stale reservations above what's locked on-chain.
      // (Reservations < on-chain locked is the expected interim state during
      //  in-flight funding, so we don't flag that direction.)
      const drift = reserved > onchainLocked ? reserved - onchainLocked : 0n;
      this.driftGauge.set(Number(this.fromStroops(drift)));

      if (drift > 0n) {
        this.logger.warn(
          {
            reservedStroops: reserved.toString(),
            onchainLockedStroops: onchainLocked.toString(),
            driftStroops: drift.toString(),
          },
          'Reservations exceed on-chain locked liquidity — possible drift (likely expired reservations not yet observed by contract)',
        );
      }
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        'Reservation reconciliation failed',
      );
    }
  }

  onModuleDestroy(): void {
    // No persistent client owned here — the ioredis connection is owned
    // by {@link RedisClientFactory}.
  }

  private async fetchPoolStats() {
    try {
      return await this.poolClient.getPoolStats();
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        'Failed to fetch pool stats for reservation; refusing to proceed',
      );
      throw new ServiceUnavailableException({
        code: 'LIQUIDITY_POOL_STATS_UNAVAILABLE',
        message: 'Unable to read liquidity pool stats right now. Please try again later.',
      });
    }
  }

  private toStroops(value: number): bigint {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException({
        code: 'LIQUIDITY_RESERVATION_INVALID_AMOUNT',
        message: 'Reservation amount must be a positive, finite number.',
      });
    }
    return BigInt(Math.round(value * Number(STROOPS)));
  }

  private fromStroops(value: bigint): number {
    return Math.round(Number(value) / Number(STROOPS) * Number(STROOPS)) / Number(STROOPS);
  }
}

export const RESERVATION_SERVICE_TOKEN = Symbol('LiquidityReservationService');
// Re-export the metric constants so tests can locate the symbol names.
export type { LiquidityReservationMetrics };
export { reservationKey };
