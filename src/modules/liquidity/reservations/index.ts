/**
 * Public surface of the reservations package.
 *
 * Only export value-bearing modules here; re-exporting interfaces or
 * the same symbol from two modules triggers "duplicate export" errors.
 */
export {
  RESERVATION_DEFAULTS,
  RESERVATION_ERROR_CODES,
  reservationKey,
  ACQUIRE_RESERVATION_LUA,
  RELEASE_RESERVATION_LUA,
  LOOKUP_RESERVATION_BY_LOAN_LUA,
  SUM_ACTIVE_RESERVATIONS_LUA,
  type ReservationErrorCode,
} from './reservations.constants';
export type {
  ReservationAcquireOutcome,
  ReservationMetadata,
  ReservationStore,
} from './reservation-store.interface';
export { InMemoryReservationStore } from './in-memory-reservation-store';
export { RedisReservationStore } from './redis-reservation-store';
export {
  ReservationsModule,
  RESERVATION_STORE,
  RESERVATION_REDIS_CLIENT,
} from './reservations.module';
export { LiquidityReservationService } from './liquidity-reservation.service';
export { LIQUIDITY_RESERVATION_METRICS } from './liquidity-reservation.metrics';
