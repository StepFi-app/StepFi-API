/**
 * Spec for LiquidityReservationService — minimal Nest DI plumbing.
 *
 * Does NOT import {@link ReservationsModule} so we can wire every
 * dependency explicitly via `providers:` and avoid the duplicate-provider
 * collision (ReservationsModule transitively re-supplies
 * LiquidityPoolContractClient via StellarModule). This keeps the
 * test focused on LiquidityReservationService's behaviour without
 * pulling in unrelated globals.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PrometheusModule,
  makeGaugeProvider,
  makeCounterProvider,
} from '@willsoto/nestjs-prometheus';
import {
  LiquidityReservationService,
} from '../../../../../src/modules/liquidity/reservations/liquidity-reservation.service';
import { InMemoryReservationStore } from '../../../../../src/modules/liquidity/reservations/in-memory-reservation-store';
import { LiquidityPoolContractClient } from '../../../../../src/stellar/contracts/clients/liquidity-pool.client';
import { LIQUIDITY_RESERVATION_METRICS } from '../../../../../src/modules/liquidity/reservations/liquidity-reservation.metrics';
import { RESERVATION_STORE } from '../../../../../src/modules/liquidity/reservations/reservations.constants';

const STROOPS = 10_000_000n;
const POOL_ID = 'default';

interface PoolMock {
  getLpShares: jest.Mock;
  getPoolStats: jest.Mock;
  calculateWithdrawal: jest.Mock;
  calculateDeposit: jest.Mock;
  buildDepositTx: jest.Mock;
  buildWithdrawTx: jest.Mock;
}

function makePoolMock(): PoolMock {
  return {
    getLpShares: jest.fn(),
    getPoolStats: jest.fn(),
    calculateWithdrawal: jest.fn(),
    calculateDeposit: jest.fn(),
    buildDepositTx: jest.fn(),
    buildWithdrawTx: jest.fn(),
  };
}

async function makeModule(): Promise<{
  service: LiquidityReservationService;
  store: InMemoryReservationStore;
  pool: PoolMock;
}> {
  const store = new InMemoryReservationStore();
  const pool = makePoolMock();

  // Default mock pool state.
  pool.getPoolStats.mockResolvedValue({
    totalLiquidity: 50_000n * STROOPS,
    lockedLiquidity: 0n,
    availableLiquidity: 10_000n * STROOPS,
    totalShares: 25_000n * STROOPS,
    sharePrice: 20_000n,
    withdrawalFeeBps: 0n,
  });

  // Wire PrometheusModule without default metrics (defaultMetrics.enabled=false
  // disables the lib's own collectors — our manual providers below are
  // the only ones we need). makeGaugeProvider / makeCounterProvider
  // pick up the registry that PrometheusModule provides internally
  // via the PROMETHEUS_REGISTRY DI token, which is what @InjectMetric(name)
  // resolves against.
  const module: TestingModule = await Test.createTestingModule({
    imports: [PrometheusModule.register({ defaultMetrics: { enabled: false } })],
    providers: [
      LiquidityReservationService,
      InMemoryReservationStore,
      { provide: RESERVATION_STORE, useValue: store },
      { provide: LiquidityPoolContractClient, useValue: pool },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string, fallback?: unknown) => {
            if (key === 'LIQUIDITY_RESERVATION_POOL_ID') return POOL_ID;
            if (key === 'LIQUIDITY_RESERVATION_TTL_SECONDS') return 60;
            return fallback;
          }),
        },
      },
      makeGaugeProvider({
        name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_INFLIGHT,
        help: 'inflight reservations',
      }),
      makeCounterProvider({
        name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_ACQUIRED_TOTAL,
        help: 'reservations acquired',
      }),
      makeCounterProvider({
        name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_RELEASED_TOTAL,
        help: 'reservations released',
      }),
      makeCounterProvider({
        name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_REJECTED_TOTAL,
        help: 'reservations rejected',
        labelNames: ['reason'],
      }),
      makeGaugeProvider({
        name: LIQUIDITY_RESERVATION_METRICS.DRIFT_DETECTED,
        help: 'reservation drift stroops',
      }),
    ],
  }).compile();

  return {
    service: module.get(LiquidityReservationService),
    store,
    pool,
  };
}

describe('LiquidityReservationService', () => {
  describe('reserveForLoan', () => {
    it('acquires the reservation and surfaces the handle to the caller', async () => {
      const { service, pool, store } = await makeModule();

      const handle = await service.reserveForLoan({
        loanId: 'pending-1-abc',
        wallet: 'GABC',
        amountUsd: 400,
      });

      expect(handle.reservationId).toMatch(/^resv-pending-1-abc-/);
      expect(pool.getPoolStats).toHaveBeenCalled();
      expect(await store.totalReserved(POOL_ID)).toBe(400n * STROOPS);
    });

    it('throws BadRequest with structured code when pool capacity is insufficient', async () => {
      const { service, pool } = await makeModule();
      pool.getPoolStats.mockResolvedValue({
        totalLiquidity: 1_000n * STROOPS,
        lockedLiquidity: 0n,
        availableLiquidity: 100n * STROOPS,
        totalShares: 0n,
        sharePrice: 10_000n,
        withdrawalFeeBps: 0n,
      });

      await expect(
        service.reserveForLoan({ loanId: 'pending-ins', wallet: 'GABC', amountUsd: 500 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.reserveForLoan({ loanId: 'pending-ins2', wallet: 'GABC', amountUsd: 500 }),
      ).rejects.toMatchObject({
        response: { code: 'LIQUIDITY_RESERVATION_INSUFFICIENT' },
      });
    });

    it('throws ServiceUnavailable when pool stats cannot be read', async () => {
      const { service, pool } = await makeModule();
      pool.getPoolStats.mockRejectedValue(new Error('contract down'));

      await expect(
        service.reserveForLoan({ loanId: 'pending-x', wallet: 'GABC', amountUsd: 50 }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('releaseForLoan', () => {
    it('returns false when no reservation is attached to the loanId', async () => {
      const { service } = await makeModule();
      const result = await service.releaseForLoan('never-reserved');
      expect(result).toBe(false);
    });

    it('releases by loanId after a previous acquire and zeroes the totalReserved', async () => {
      const { service, store, pool } = await makeModule();
      pool.getPoolStats.mockResolvedValue({
        totalLiquidity: 50_000n * STROOPS,
        lockedLiquidity: 0n,
        availableLiquidity: 10_000n * STROOPS,
        totalShares: 25_000n * STROOPS,
        sharePrice: 20_000n,
        withdrawalFeeBps: 0n,
      });

      await service.reserveForLoan({ loanId: 'pending-rel', wallet: 'GABC', amountUsd: 200 });
      expect(await store.totalReserved(POOL_ID)).toBe(200n * STROOPS);

      const ok = await service.releaseForLoan('pending-rel');
      expect(ok).toBe(true);
      expect(await store.totalReserved(POOL_ID)).toBe(0n);
    });
  });

  /**
   * **The acceptance test for issue #81**: 10 parallel acquirers against
   * a pool whose capacity fits exactly 5 must produce exactly 5 acquires
   * and 5 insufficient rejections — no double-spend.
   */
  describe('concurrency: parallel acquirers must not double-spend', () => {
    it('5 out of 10 parallel acquirers succeed when capacity fits exactly 5', async () => {
      const { service, pool } = await makeModule();
      const SUBMITTERS = 10;
      const EACH = 100n * STROOPS;
      const CAPACITY = 5n * EACH; // exactly 5 fit

      pool.getPoolStats.mockResolvedValue({
        totalLiquidity: CAPACITY,
        lockedLiquidity: 0n,
        availableLiquidity: CAPACITY,
        totalShares: 0n,
        sharePrice: 10_000n,
        withdrawalFeeBps: 0n,
      });

      const outcomes: Array<'ok' | 'fail'> = await Promise.all(
        Array.from({ length: SUBMITTERS }, (_, i) =>
          service
            .reserveForLoan({
              loanId: `loan-${String(i).padStart(3, '0')}`,
              wallet: 'GABC',
              amountUsd: 100,
            })
            .then(() => 'ok' as const)
            .catch(() => 'fail' as const),
        ),
      );

      const okCount = outcomes.filter((o) => o === 'ok').length;
      const failCount = outcomes.filter((o) => o === 'fail').length;

      expect(okCount).toBe(5);
      expect(failCount).toBe(5);
      expect(await service.getCurrentReservationTotal()).toBe(CAPACITY);
    });
  });
});
