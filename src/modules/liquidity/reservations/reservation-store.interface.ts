import { ReservationErrorCode } from './reservations.constants';

/**
 * Outcome of an acquire request.
 *
 * - `acquired`: the reservation is now authoritative; the caller MUST
 *   commit to it (release on failure, settlement on success).
 * - `insufficient`: pool capacity is below the requested amount.
 * - `duplicate`: an identically-identified reservation already exists.
 */
export type ReservationAcquireOutcome =
  | { kind: 'acquired'; reservationId: string; totalReserved: bigint; expiresAt: Date }
  | {
      kind: 'insufficient';
      currentlyReserved: bigint;
      capacity: bigint;
      code: ReservationErrorCode;
    }
  | { kind: 'duplicate'; reservationId: string; code: ReservationErrorCode };

export interface ReservationMetadata {
  poolId: string;
  wallet: string;
  loanId: string;
  amount: bigint;
  acquiredAt: string;
  expiresAt: string;
}

export interface ReservationStore {
  /**
   * Atomically acquire `amount` from `poolId` against `capacity`.
   * Reservations auto-expire after `ttlSeconds` and are removed on the
   * next acquire / release / reconcile call.
   */
  acquire(input: {
    poolId: string;
    capacity: bigint;
    reservationId: string;
    amount: bigint;
    ttlSeconds: number;
    metadata: ReservationMetadata;
  }): Promise<ReservationAcquireOutcome>;

  /**
   * Release a previously-acquired reservation. Idempotent: a second
   * call returns false (no-op).
   */
  release(input: {
    poolId: string;
    reservationId: string;
    amount: bigint;
  }): Promise<boolean>;

  /**
   * Resolve the active reservation backing a given loanId (read-only).
   * Returns null if expired or already released.
   */
  findByLoanId(loanId: string): Promise<string | null>;

  /**
   * Get the full metadata document for a reservationId, or null.
   */
  getMetadata(reservationId: string): Promise<ReservationMetadata | null>;

  /**
   * Sum the stroops currently held by active (non-expired) reservations
   * for `poolId`. Expired entries are pruned as a side effect.
   */
  totalReserved(poolId: string): Promise<bigint>;

  /**
   * List active reservation metadata entries (used by reconcile & tests).
   */
  listActive(poolId: string): Promise<ReservationMetadata[]>;
}
