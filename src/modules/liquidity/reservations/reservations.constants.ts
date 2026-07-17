/**
 * Constants, key builders, and default configuration for the liquidity
 * reservation ledger.
 *
 * The reservation layer prevents double-spend of pool funds between the
 * credit assessment / XDR build step and the on-chain `create_loan`
 * settlement. Until that link is sealed, the assessed amount is held
 * against the pool so a second concurrent caller cannot pass the same
 * availability check.
 */

export const RESERVATION_DEFAULTS = {
  /**
   * How long a reservation is considered authoritative. After this
   * window a non-submitted loan simply expires and the funds return to
   * the pool. Starlight wallets should sign & submit well within this.
   */
  ttlSeconds: 15 * 60,

  /** Pool identifier used when none is configured. */
  poolId: 'default',

  /** Reconciliation cron cadence (cleaning expired entries). */
  reconcileCron: '0 */5 * * * *',
} as const;

export const RESERVATION_ERROR_CODES = {
  INSUFFICIENT: 'LIQUIDITY_RESERVATION_INSUFFICIENT',
  POOL_UNCONFIGURED: 'LIQUIDITY_POOL_UNCONFIGURED',
  CONFLICT: 'LIQUIDITY_RESERVATION_CONFLICT',
  REDIS_UNAVAILABLE: 'LIQUIDITY_RESERVATION_STORE_UNAVAILABLE',
  INTERNAL: 'LIQUIDITY_RESERVATION_INTERNAL_ERROR',
} as const;

/**
 * Single canonical DI token for the configured {@link ReservationStore}.
 *
 * Declared once here so the service's `@Inject(RESERVATION_STORE)` and
 * any module / test / NestJS provider resolve to the SAME JavaScript
 * symbol instance. Two `Symbol('RESERVATION_STORE')` calls would
 * produce two distinct symbols and Nest would not link them.
 */
export const RESERVATION_STORE = Symbol('RESERVATION_STORE');
export const RESERVATION_REDIS_CLIENT = Symbol('RESERVATION_REDIS_CLIENT');

export type ReservationErrorCode =
  (typeof RESERVATION_ERROR_CODES)[keyof typeof RESERVATION_ERROR_CODES];

/** Pool identifier for the global Aprende.fi liquidity pool. */
export const DEFAULT_LIQUIDITY_POOL_ID = 'default';

export const reservationKey = {
  /** Per-reservation metadata blob. JSON-encoded, TTL = LOCK_TTL. */
  metadata: (reservationId: string): string =>
    `liquidity:reservation:${reservationId}`,

  /**
   * Reverse index by `loanId` so the status checker can locate the
   * reservation when finalising a transaction. TTL is aligned with the
   * metadata key — if one is gone, the other is gone.
   */
  byLoan: (loanId: string): string => `liquidity:reservation:byLoan:${loanId}`,

  /**
   * The active-reservations ZSET for a pool.
   *   score  = epoch-ms expiry timestamp
   *   member = `${reservationId}|${amount}`
   *
   * The total reserved amount is derived from this set's active
   * (non-expired) members — no separate counter to drift.
   */
  poolActive: (poolId: string): string =>
    `liquidity:reservation:pool:${poolId}:active`,
} as const;

/**
 * Reserve `amount` against `poolId` atomically.
 *
 * KEYS:
 *   [1] = pool active ZSET
 *   [2] = metadata key for the prospective reservation
 *   [3] = by-loan index key for the prospective reservation
 *
 * ARGV:
 *   [1] now (ms)
 *   [2] reservationId
 *   [3] amountStr (integer, stroops)
 *   [4] ttlSeconds
 *   [5] memberStr (`<reservationId>|<amountStr>`)
 *   [6] capacityStr (integer, stroops) — max reservable amount
 *   [7] metadataJson
 *
 * Returns:
 *   {'ok',reservationId}                          on success
 *   {'insufficient',currentReserved,capacity}     when over capacity
 *   {'already'}                                   when reservationId collides
 */
export const ACQUIRE_RESERVATION_LUA = `
local now = tonumber(ARGV[1])
local rid = ARGV[2]
local amount = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]
local capacity = tonumber(ARGV[6])
local metadata = ARGV[7]

-- 1. Clean expired entries up to now
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. now)

-- 2. Idempotency / collision: if a reservation with this id already exists
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {'already'}
end

-- 3. Sum active reservations for the pool
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
local sum = 0
for i = 1, #members do
  local entry = members[i]
  local sep = string.find(entry, '|', 1, true)
  if sep then
    local n = tonumber(string.sub(entry, sep + 1))
    if n then sum = sum + n end
  end
end

-- 4. Capacity check
if sum + amount > capacity then
  return {'insufficient', tostring(sum), tostring(capacity)}
end

-- 5. Commit
local expiresAt = now + ttl * 1000
redis.call('ZADD', KEYS[1], expiresAt, member)
redis.call('SET', KEYS[2], metadata, 'EX', ttl)
redis.call('SET', KEYS[3], rid, 'EX', ttl)
return {'ok', rid, tostring(sum + amount)}
`;

/**
 * Release a reservation atomically.
 *
 * KEYS:
 *   [1] = pool active ZSET
 *   [2] = metadata key
 *   [3] = by-loan key
 *
 * ARGV:
 *   [1] reservationId
 *   [2] amountStr
 *   [3] nowMs
 *
 * Returns:
 *   1 if released, 0 if not found / already released
 */
export const RELEASE_RESERVATION_LUA = `
local rid = ARGV[1]
local amount = tonumber(ARGV[2])
local member = rid .. '|' .. tostring(amount)

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[3])

local removed = redis.call('ZREM', KEYS[1], member)
local metaGone = redis.call('DEL', KEYS[2]) == 1
local idxGone = redis.call('DEL', KEYS[3]) == 1

if removed == 1 or metaGone or idxGone then
  return 1
end
return 0
`;

/**
 * Resolve reservationId by loanId.
 *
 * KEYS:
 *   [1] = by-loan key
 *
 * ARGV: none
 *
 * Returns the stored reservationId or nil.
 */
export const LOOKUP_RESERVATION_BY_LOAN_LUA = `
return redis.call('GET', KEYS[1])
`;

/**
 * Sum the active reservations in a pool's ZSET, removing expired first.
 *
 * KEYS:
 *   [1] = pool active ZSET
 * ARGV:
 *   [1] = nowMs
 *
 * Returns the sum (as a string of integer stroops).
 */
export const SUM_ACTIVE_RESERVATIONS_LUA = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. now)
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
local sum = 0
for i = 1, #members do
  local entry = members[i]
  local sep = string.find(entry, '|', 1, true)
  if sep then
    local n = tonumber(string.sub(entry, sep + 1))
    if n then sum = sum + n end
  end
end
return tostring(sum)
`;
