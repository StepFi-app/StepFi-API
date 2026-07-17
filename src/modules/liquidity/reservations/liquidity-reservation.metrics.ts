/**
 * Prometheus metric identifiers for the liquidity reservation layer.
 *
 * These tokens are shared between the Nest module that registers the
 * metrics and the service that emits them, ensuring both sides agree on
 * the label names and bucket boundaries.
 */

export const LIQUIDITY_RESERVATION_METRICS = {
  RESERVATIONS_INFLIGHT: 'stepfi_liquidity_reservations_inflight',
  RESERVATIONS_ACQUIRED_TOTAL: 'stepfi_liquidity_reservations_acquired_total',
  RESERVATIONS_RELEASED_TOTAL: 'stepfi_liquidity_reservations_released_total',
  RESERVATIONS_REJECTED_TOTAL: 'stepfi_liquidity_reservations_rejected_total',
  DRIFT_DETECTED: 'stepfi_liquidity_reservations_drift_stroops',
} as const;

export type LiquidityReservationMetricName =
  (typeof LIQUIDITY_RESERVATION_METRICS)[keyof typeof LIQUIDITY_RESERVATION_METRICS];

export interface LiquidityReservationMetrics {
  readonly RESERVATIONS_INFLIGHT: typeof LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_INFLIGHT;
  readonly RESERVATIONS_ACQUIRED_TOTAL: typeof LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_ACQUIRED_TOTAL;
  readonly RESERVATIONS_RELEASED_TOTAL: typeof LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_RELEASED_TOTAL;
  readonly RESERVATIONS_REJECTED_TOTAL: typeof LIQUIDITY_RESERVATION_METRICS.RESERVATIONS_REJECTED_TOTAL;
  readonly DRIFT_DETECTED: typeof LIQUIDITY_RESERVATION_METRICS.DRIFT_DETECTED;
}
