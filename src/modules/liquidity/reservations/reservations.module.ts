import { Module, Global, FactoryProvider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { LiquidityReservationService } from './liquidity-reservation.service';
import { InMemoryReservationStore } from './in-memory-reservation-store';
import { RedisReservationStore } from './redis-reservation-store';
import {
  ReservationStore,
} from './reservation-store.interface';
import {
  LIQUIDITY_RESERVATION_METRICS,
} from './liquidity-reservation.metrics';
import { StellarModule } from '../../../stellar/stellar.module';

/**
 * DI tokens are declared once in {@link ./reservations.constants} and
 * imported here from there, so the service's `@Inject(RESERVATION_STORE)`
 * matches the providers below to the SAME symbol instance.
 */
import { RESERVATION_STORE, RESERVATION_REDIS_CLIENT } from './reservations.constants';

/** Token for the ioredis client used by the RedisReservationStore. */
// re-exported above from reservations.constants to maintain the public
// shape of this module (Nest provider tokens come from the constants file).
export { RESERVATION_STORE, RESERVATION_REDIS_CLIENT };

/**
 * Global module that wires the liquidity reservation ledger.
 * Exports LiquidityReservationService so loans and the
 * transaction-status pipeline can inject it without re-importing.
 */
@Global()
@Module({
  imports: [ConfigModule, StellarModule, PrometheusModule.register()],
  providers: [
    InMemoryReservationStore,
    {
      provide: RESERVATION_REDIS_CLIENT,
      useFactory: (configService: ConfigService): unknown => {
        const isTest = process.env.NODE_ENV === 'test';
        const configuredUrl =
          configService.get<string>('LIQUIDITY_RESERVATION_REDIS_URL') ??
          configService.get<string>('REDIS_URL');
        if (isTest || !configuredUrl) {
          return null;
        }
        try {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const IoRedis = require('ioredis');
            return new IoRedis(configuredUrl, {
              maxRetriesPerRequest: 3,
              enableReadyCheck: true,
              lazyConnect: false,
            });
          } catch {
            return null;
          }
        } catch {
          return null;
        }
      },
      inject: [ConfigService],
    } satisfies FactoryProvider,
    /**
     * ReservationStore selector. Returns RedisReservationStore when
     * `LIQUIDITY_RESERVATION_REDIS_URL` (or `REDIS_URL`) is configured
     * and the client is constructable; otherwise InMemoryReservationStore
     * is used. Tests (NODE_ENV=test) always use the in-memory backend.
     */
    {
      provide: RESERVATION_STORE,
      useFactory: (
        configService: ConfigService,
        redisClient: unknown,
        inMemoryImpl: InMemoryReservationStore,
      ): ReservationStore => {
        const isTest = process.env.NODE_ENV === 'test';
        const configuredUrl =
          configService.get<string>('LIQUIDITY_RESERVATION_REDIS_URL') ??
          configService.get<string>('REDIS_URL');
        if (isTest || !configuredUrl || !redisClient) {
          return inMemoryImpl;
        }
        return new RedisReservationStore(redisClient as never);
      },
      inject: [ConfigService, RESERVATION_REDIS_CLIENT, InMemoryReservationStore],
    } satisfies FactoryProvider,
    // Prometheus metric providers — keyed by the metric NAME so
    // @InjectMetric(name) in the service resolves to the same token.
    makeGaugeProvider({
      name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_INFLIGHT,
      help: 'Number of in-flight liquidity reservations currently held.',
    }),
    makeCounterProvider({
      name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_ACQUIRED_TOTAL,
      help: 'Total number of liquidity reservations acquired since process start.',
    }),
    makeCounterProvider({
      name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_RELEASED_TOTAL,
      help: 'Total number of liquidity reservations released since process start.',
    }),
    makeCounterProvider({
      name: LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_REJECTED_TOTAL,
      help: 'Total number of liquidity reservation attempts rejected by the store, labeled by reason.',
      labelNames: ['reason'],
    }),
    makeGaugeProvider({
      name: LIQUIDITY_RESERVATION_METRICS.DRIFT_DETECTED,
      help: 'Drift (in stroops) between reservation total and on-chain locked liquidity. Positive only.',
    }),
    LiquidityReservationService,
  ],
  exports: [
    LiquidityReservationService,
    RESERVATION_STORE,
    InMemoryReservationStore,
  ],
})
export class ReservationsModule {}
