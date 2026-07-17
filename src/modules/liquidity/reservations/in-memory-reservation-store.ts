import { Injectable, Logger } from '@nestjs/common';
import {
  ReservationAcquireOutcome,
  ReservationMetadata,
  ReservationStore,
} from './reservation-store.interface';

/**
 * In-process implementation of the reservation ledger.
 *
 * Used when:
 *   - `NODE_ENV === 'test'`
 *   - `REDIS_URL` / `LIQUIDITY_RESERVATION_REDIS_URL` is not configured
 *
 * Semantics are a faithful, JS-faithful reproduction of the Redis Lua
 * scripts in {@link ./reservations.constants}. Atomicity within a single
 * process is guaranteed by a per-pool promise-chain mutex; cross-process
 * atomicity would require the Redis-backed implementation instead.
 */
@Injectable()
export class InMemoryReservationStore implements ReservationStore {
  private readonly logger = new Logger(InMemoryReservationStore.name);

  private readonly metadata = new Map<string, ReservationMetadata>();
  private readonly byLoan = new Map<string, string>();
  /** poolId -> array of { reservationId, amount, expiresAt } */
  private readonly pools = new Map<string, ReservationEntry[]>();
  private readonly chainTail = new Map<string, Promise<unknown>>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  async acquire(input: {
    poolId: string;
    capacity: bigint;
    reservationId: string;
    amount: bigint;
    ttlSeconds: number;
    metadata: ReservationMetadata;
  }): Promise<ReservationAcquireOutcome> {
    return this.withPoolLock(input.poolId, async () => {
      this.pruneExpired(input.poolId);

      if (this.metadata.has(input.reservationId)) {
        return {
          kind: 'duplicate',
          reservationId: input.reservationId,
          code: 'LIQUIDITY_RESERVATION_CONFLICT' as const,
        } as ReservationAcquireOutcome;
      }

      const sum = this.computeSum(input.poolId);
      if (sum + input.amount > input.capacity) {
        return {
          kind: 'insufficient',
          currentlyReserved: sum,
          capacity: input.capacity,
          code: 'LIQUIDITY_RESERVATION_INSUFFICIENT' as const,
        } as ReservationAcquireOutcome;
      }

      const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
      const entry: ReservationEntry = {
        reservationId: input.reservationId,
        amount: input.amount,
        expiresAt,
      };

      this.metadata.set(input.reservationId, input.metadata);
      this.byLoan.set(input.metadata.loanId, input.reservationId);

      const list = this.pools.get(input.poolId) ?? [];
      list.push(entry);
      this.pools.set(input.poolId, list);

      this.scheduleExpiry(input.poolId, input.reservationId, input.ttlSeconds * 1000);

      return {
        kind: 'acquired',
        reservationId: input.reservationId,
        totalReserved: sum + input.amount,
        expiresAt,
      } as ReservationAcquireOutcome;
    });
  }

  async release(input: {
    poolId: string;
    reservationId: string;
    amount: bigint;
  }): Promise<boolean> {
    return this.withPoolLock(input.poolId, async () => {
      this.pruneExpired(input.poolId);

      const idx = this.findEntryIndex(input.poolId, input.reservationId, input.amount);
      if (idx < 0) {
        // Already gone — make idempotent (matches Redis Lua semantics).
        return false;
      }

      const meta = this.metadata.get(input.reservationId);
      this.pools.get(input.poolId)!.splice(idx, 1);
      this.metadata.delete(input.reservationId);
      if (meta) {
        this.byLoan.delete(meta.loanId);
      }

      const timer = this.expiryTimers.get(input.reservationId);
      if (timer) {
        clearTimeout(timer);
        this.expiryTimers.delete(input.reservationId);
      }

      return true;
    });
  }

  async findByLoanId(loanId: string): Promise<string | null> {
    const reservationId = this.byLoan.get(loanId);
    if (!reservationId) {
      return null;
    }
    const meta = this.metadata.get(reservationId);
    if (!meta) {
      // Index is stale; clean up
      this.byLoan.delete(loanId);
      return null;
    }
    if (meta.expiresAt && new Date(meta.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return reservationId;
  }

  async getMetadata(reservationId: string): Promise<ReservationMetadata | null> {
    const meta = this.metadata.get(reservationId);
    if (!meta) {
      return null;
    }
    if (new Date(meta.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return meta;
  }

  async totalReserved(poolId: string): Promise<bigint> {
    return this.withPoolLock(poolId, async () => {
      this.pruneExpired(poolId);
      return this.computeSum(poolId);
    });
  }

  async listActive(poolId: string): Promise<ReservationMetadata[]> {
    return this.withPoolLock(poolId, async () => {
      this.pruneExpired(poolId);
      const entries = this.pools.get(poolId) ?? [];
      const out: ReservationMetadata[] = [];
      for (const entry of entries) {
        const meta = this.metadata.get(entry.reservationId);
        if (meta) {
          out.push(meta);
        }
      }
      return out;
    });
  }

  /** Internal: serialize logic around a single pool's state. */
  private withPoolLock<T>(poolId: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chainTail.get(poolId) ?? Promise.resolve();
    const next = prev.then(() => fn());
    this.chainTail.set(poolId, next.catch(() => undefined));
    return next;
  }

  private pruneExpired(poolId: string): void {
    const now = Date.now();
    const list = this.pools.get(poolId);
    if (!list) {
      return;
    }
    const survivors: ReservationEntry[] = [];
    for (const entry of list) {
      if (entry.expiresAt.getTime() > now) {
        survivors.push(entry);
        continue;
      }
      // Expired — clean up
      this.metadata.delete(entry.reservationId);
      this.expiryTimers.delete(entry.reservationId);
      // byLoan: we don't know the loanId without metadata, so leave the
      // reverse index alone; the next `findByLoanId` will reconcile it.
    }
    if (survivors.length !== list.length) {
      this.pools.set(poolId, survivors);
    }
  }

  private computeSum(poolId: string): bigint {
    const list = this.pools.get(poolId) ?? [];
    let sum = 0n;
    for (const entry of list) {
      sum += entry.amount;
    }
    return sum;
  }

  private findEntryIndex(poolId: string, reservationId: string, amount: bigint): number {
    const list = this.pools.get(poolId) ?? [];
    return list.findIndex(
      (entry) => entry.reservationId === reservationId && entry.amount === amount,
    );
  }

  private scheduleExpiry(poolId: string, reservationId: string, ttlMs: number): void {
    const timer = setTimeout(() => {
      const list = this.pools.get(poolId);
      if (!list) {
        return;
      }
      const idx = list.findIndex((entry) => entry.reservationId === reservationId);
      if (idx < 0) {
        return;
      }
      const entry = list[idx];
      if (entry.expiresAt.getTime() > Date.now()) {
        // Window was extended — re-schedule with remaining time.
        this.scheduleExpiry(poolId, reservationId, entry.expiresAt.getTime() - Date.now());
        return;
      }
      list.splice(idx, 1);
      this.metadata.delete(reservationId);
      const meta = this.metadata.get(reservationId);
      if (meta) {
        this.byLoan.delete(meta.loanId);
      }
      this.expiryTimers.delete(reservationId);
    }, ttlMs);

    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }

    this.expiryTimers.set(reservationId, timer);
  }

  /**
   * Test-only helpers — not part of the public ReservationStore interface.
   */
  __test_only_clear(): void {
    this.metadata.clear();
    this.byLoan.clear();
    this.pools.clear();
    this.chainTail.clear();
    for (const t of this.expiryTimers.values()) {
      clearTimeout(t);
    }
    this.expiryTimers.clear();
  }
}

interface ReservationEntry {
  reservationId: string;
  amount: bigint;
  expiresAt: Date;
}
