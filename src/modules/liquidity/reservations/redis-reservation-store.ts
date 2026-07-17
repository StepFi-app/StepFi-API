import { Injectable, Logger } from '@nestjs/common';
import type { Redis as RedisClient } from 'ioredis';
import {
  ReservationAcquireOutcome,
  ReservationMetadata,
  ReservationStore,
} from './reservation-store.interface';
import {
  ACQUIRE_RESERVATION_LUA,
  RELEASE_RESERVATION_LUA,
  LOOKUP_RESERVATION_BY_LOAN_LUA,
  SUM_ACTIVE_RESERVATIONS_LUA,
  reservationKey,
  RESERVATION_ERROR_CODES,
  ReservationErrorCode,
} from './reservations.constants';

/**
 * Cross-process, Lua-atomic implementation of the reservation ledger.
 *
 * Uses a single ioredis connection. All acquire / release / totalReserved
 * operations are wrapped in Lua scripts so the ZSET and metadata key moves
 * are atomic even under heavy concurrency.
 */
@Injectable()
export class RedisReservationStore implements ReservationStore {
  private readonly logger = new Logger(RedisReservationStore.name);
  private readonly shaAcquire = this.scriptLoad(ACQUIRE_RESERVATION_LUA);
  private readonly shaRelease = this.scriptLoad(RELEASE_RESERVATION_LUA);
  private readonly shaLookup = this.scriptLoad(LOOKUP_RESERVATION_BY_LOAN_LUA);
  private readonly shaSum = this.scriptLoad(SUM_ACTIVE_RESERVATIONS_LUA);

  constructor(private readonly redis: RedisClient) {}

  async acquire(input: {
    poolId: string;
    capacity: bigint;
    reservationId: string;
    amount: bigint;
    ttlSeconds: number;
    metadata: ReservationMetadata;
  }): Promise<ReservationAcquireOutcome> {
    const keys = [
      reservationKey.poolActive(input.poolId),
      reservationKey.metadata(input.reservationId),
      reservationKey.byLoan(input.metadata.loanId),
    ];
    const argv = [
      String(Date.now()),
      input.reservationId,
      input.amount.toString(),
      String(input.ttlSeconds),
      `${input.reservationId}|${input.amount.toString()}`,
      input.capacity.toString(),
      JSON.stringify(input.metadata),
    ];

    const raw = (await this.evalsha(this.shaAcquire, ACQUIRE_RESERVATION_LUA, keys, argv)) as
      | string[]
      | null;

    if (!raw || raw.length === 0) {
      throw new Error('Empty response from ACQUIRE_RESERVATION_LUA');
    }
    const status = raw[0];
    if (status === 'ok') {
      const totalReserved = BigInt(raw[2] ?? '0');
      const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
      return {
        kind: 'acquired',
        reservationId: input.reservationId,
        totalReserved,
        expiresAt,
      } satisfies ReservationAcquireOutcome;
    }
    if (status === 'insufficient') {
      return {
        kind: 'insufficient',
        currentlyReserved: BigInt(raw[1] ?? '0'),
        capacity: BigInt(raw[2] ?? input.capacity.toString()),
        code: RESERVATION_ERROR_CODES.INSUFFICIENT as ReservationErrorCode,
      } satisfies ReservationAcquireOutcome;
    }
    if (status === 'already') {
      return {
        kind: 'duplicate',
        reservationId: input.reservationId,
        code: RESERVATION_ERROR_CODES.CONFLICT as ReservationErrorCode,
      } satisfies ReservationAcquireOutcome;
    }
    throw new Error(`Unexpected ACQUIRE_RESERVATION_LUA status: ${status}`);
  }

  async release(input: {
    poolId: string;
    reservationId: string;
    amount: bigint;
  }): Promise<boolean> {
    const keys = [
      reservationKey.poolActive(input.poolId),
      reservationKey.metadata(input.reservationId),
      reservationKey.byLoan(''), // filled below using current loanId
    ];

    // We need the loanId for the by-loan key lookup. Pull it first (best
    // effort — release is idempotent regardless).
    const metadataRaw = await this.redis.get(reservationKey.metadata(input.reservationId));
    let loanId = '';
    if (metadataRaw) {
      try {
        const meta = JSON.parse(metadataRaw) as { loanId?: string };
        loanId = meta.loanId ?? '';
      } catch (error) {
        this.logger.warn(
          { reservationId: input.reservationId, err: (error as Error).message },
          'Failed to parse reservation metadata during release',
        );
      }
    }
    keys[2] = reservationKey.byLoan(loanId);

    const argv = [
      input.reservationId,
      input.amount.toString(),
      String(Date.now()),
    ];

    const result = (await this.evalsha(this.shaRelease, RELEASE_RESERVATION_LUA, keys, argv)) as
      | number
      | null;

    return (result ?? 0) === 1;
  }

  async findByLoanId(loanId: string): Promise<string | null> {
    const raw = (await this.evalsha(
      this.shaLookup,
      LOOKUP_RESERVATION_BY_LOAN_LUA,
      [reservationKey.byLoan(loanId)],
      [],
    )) as string | null;
    return raw ?? null;
  }

  async getMetadata(reservationId: string): Promise<ReservationMetadata | null> {
    const raw = await this.redis.get(reservationKey.metadata(reservationId));
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as ReservationMetadata;
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        return null;
      }
      return parsed;
    } catch (error) {
      this.logger.warn(
        { reservationId, err: (error as Error).message },
        'Failed to parse reservation metadata',
      );
      return null;
    }
  }

  async totalReserved(poolId: string): Promise<bigint> {
    const raw = (await this.evalsha(
      this.shaSum,
      SUM_ACTIVE_RESERVATIONS_LUA,
      [reservationKey.poolActive(poolId)],
      [String(Date.now())],
    )) as string | null;
    return BigInt(raw ?? '0');
  }

  async listActive(poolId: string): Promise<ReservationMetadata[]> {
    const now = Date.now();
    const rawMembers = await this.redis.zrangebyscore(
      reservationKey.poolActive(poolId),
      now,
      '+inf',
    );
    if (rawMembers.length === 0) {
      return [];
    }
    const reservationIds = rawMembers.map((m) => m.split('|', 1)[0]);
    const metadataBlobs = await this.redis.mget(
      ...reservationIds.map((rid) => reservationKey.metadata(rid)),
    );
    const out: ReservationMetadata[] = [];
    metadataBlobs.forEach((blob, index) => {
      if (!blob) {
        return;
      }
      try {
        out.push(JSON.parse(blob) as ReservationMetadata);
      } catch (error) {
        this.logger.warn(
          { reservationId: reservationIds[index], err: (error as Error).message },
          'Skipping malformed reservation metadata in listActive',
        );
      }
    });
    return out;
  }

  private scriptLoad(script: string): string {
    // SHA1 of the script for EVALSHA, with EVAL fallback when the script
    // has not yet been loaded (returns NOSCRIPT).
    return require('crypto').createHash('sha1').update(script).digest('hex');
  }

  private async evalsha(
    sha: string,
    source: string,
    keys: string[],
    argv: string[],
  ): Promise<unknown> {
    try {
      return await this.redis.evalsha(sha, keys.length, ...keys, ...argv);
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('NOSCRIPT')) {
        return this.redis.eval(source, keys.length, ...keys, ...argv);
      }
      throw error;
    }
  }
}
