# Progress Tracker — StepFi-API

Format: date, commit hash, what changed, why.
Update this file in every PR that changes functionality (not needed for
pure chore/docs commits). Direct pushes to main must also be logged here.

---

## 2026-08-24

- **Session families + refresh-token replay detection** (`sessions.family_id`
  migration, `fam` claim in refresh JWTs). Replaying an already-rotated
  refresh token now revokes every session in the family and writes a
  `auth.refresh_token_reuse` audit log entry — previously the first
  presenter of a stolen token won silently. Legacy tokens without a `fam`
  claim keep the old `AUTH_SESSION_NOT_FOUND` response.
- **Blocked-user enforcement on every request**: new
  `UserStatusService` (in-memory TTL cache) consulted by `JwtStrategy`.
  Documented staleness bound: **30 seconds** — a blocked wallet loses API
  access within ~30s of being blocked instead of retaining access until its
  access token expires (up to 15 minutes). Cache is per-instance and fails
  open on DB errors to avoid locking out all users during a DB blip.
- **Session cleanup cron** (`src/jobs/session-cleanup/`, hourly,
  mirrors nonce-cleanup): deletes only rows with `expires_at` older than
  1 hour; sessions no longer accumulate forever.
- Tests: refresh-family rotation, replay → family-wide revocation + audit
  event, blocked-user denial within TTL bound, cache expiry re-query,
  cleanup job deletes-only-expired.

## 2026-08-26

- Fixed registration race conditions in `AuthService.register()` by eliminating application-side pre-checks (`findByWallet`, `checkUsernameExists`) and relying directly on DB-level UNIQUE constraints (`users.wallet_address`, `users.username`).
- Added idempotent migration `20260826130000_ensure_users_unique_constraints.sql` to ensure unique indexes exist on `users.wallet_address` and `users.username`.
- Updated `UsersRepository.createProfile()` to catch PostgreSQL unique constraint violation error `23505` and map to structured 409 `ConflictException` (`AUTH_WALLET_EXISTS`, `AUTH_USERNAME_TAKEN`).
- Added cleanup handlers (`deleteAvatar`, `deleteUserById`) in `AuthService.register()` and `UsersRepository` to ensure failed registrations do not leave orphaned avatar files or partial user records.
- Added unit tests covering DB unique constraint error mapping, parallel race conditions for duplicate wallet and username registrations, sequential re-registration compatibility, and avatar/user cleanup on failure.

## 2026-07-23

- Added GitHub Actions health check workflow (`health-check.yml`) to ping the Render API every 6 hours to prevent the free tier instance from sleeping. Auto-creates or comments on issues with the `incident` label if the ping fails, preventing silent outages.
- Documented the ping URL and incident label in README.

## 2026-07-19

- Wired `LiquidityContractClient` (restored under `src/blockchain/contracts/liquidity-contract.client.ts`) into `LiquidityService` constructor.
- Read contract ID from `ConfigService` under `LIQUIDITY_POOL_CONTRACT_ID`.
- Replaced placeholder deposit/withdraw XDR strings in `LiquidityService` with real transaction simulation and assembly (`buildUnsignedXdr`).
- Mapped smart contract simulation errors (e.g., custom error codes like 100-104) to HTTP 400 (`BadRequestException`) with typed error codes.
- Added E2E test `test/e2e/liquidity.e2e-spec.ts` asserting transaction XDR parsing and contract simulation error mapping.
- Updated existing `test/e2e/modules/liquidity/liquidity-flow.e2e-spec.ts` to mock the new `LiquidityContractClient` structure.
- Updated `test/unit/modules/liquidity/liquidity.service.spec.ts` unit tests.

## 2026-07-18

- Added scheduled state reconciliation across indexed on-chain loan,
  liquidity, reputation, and transaction state. The idempotent Cron job
  resolves provisional loan IDs, repairs stale database state, backfills
  missed transaction records, marks orphaned pending transactions, exports
  drift metrics, and logs a structured report without making on-chain writes.
  Cron is used instead of BullMQ per the API's post-Upstash architecture.

## 2026-07-16

- Added wallet-bound user roles (sponsor/vendor/mentor): `role` column
  migration, one-time `POST /users/me/role` (409 once set), role claim
  in JWT, `RolesGuard` on vendor/liquidity endpoints (direct push,
  parallel session)
- Enforced `@typescript-eslint/no-explicit-any` at error via new
  `.eslintrc.js` (repo previously had a lint script but no ESLint
  config); replaced all 32 explicit `any` usages in src/ with real
  types (direct push, documented here per new git standards)
- Fixed liquidity overview endpoint to expose `lockedLiquidity`,
  `availableLiquidity`, `totalShares`, `sharePrice` — the web sponsor
  dashboard needed the locked vs available breakdown (commit 3961123)
- Fixed indexer cursor not persisting after the BullMQ→Cron migration
  (commit c74a05f)
- Removed BullMQ entirely; all jobs now use `@Cron` or `setInterval`
  (commit c9cfbd0)
- Migrated to a new Upstash Redis database after hitting the 500k
  free-tier request limit (ops change, no commit)

## 2026-07-15

- Replaced BullMQ polling jobs with `@Cron` and `setInterval`, cutting
  Redis usage by ~90% (commit d908c52)

## 2026-07-02

- Added Supabase keep-alive cron job to prevent free-tier project
  pausing (commit 0ff9928)
- Indexer: self-healing reset of stale ledger checkpoint (commit b7f418c)
  and jump-to-recent-ledger instead of incrementing by 1 (commit 4130db2)
- Fixed learner profile migration — quoted the reserved word
  `current_role` (commit 422992b)
- Resolved npm audit vulnerabilities (commit 1bf7372)
- Repo hygiene: PR template + CODEOWNERS (b2bdfa4), issue template with
  test requirements (78b76bb)

## 2026-06-27

- API Key authentication system for vendor service-to-service
  integration (#60, commit 7524888)
- Extended learner onboarding profile endpoint — richer profile fields,
  completion tracking (#59, commit be6ac8b)

## 2026-06-21

- Two-step repayment flow: `buildRepaymentXdr()` + submit endpoint so
  wallets sign server-built XDR (#51, commit 4224bb6)

## 2026-06-19

- Integrated Sentry for error tracking; fixed MetricsModule dependency
  injection startup error (#55, commit 58848c1)
- Added `GET /api/v1/vouching/requests` for incoming vouch requests
  (#54, commit cb60433)
- End-to-end loan lifecycle test with in-memory mock infrastructure
  (#52, commit 5a4efa0)

## 2026-06-18

- Audit log for admin operations (#49, commit 760d459)
- SponsorsService: `getPool()`, `buildDepositXdr()`, `buildWithdrawXdr()`
  with unit tests (#48, commit 1793032)

---

> Note (2026-07-16): this file previously contained StepFi-Contracts
> content copied from the wrong repo. Replaced with real StepFi-API
> history backfilled from `git log`. Entries older than 2026-06-18 are
> in git history but were never tracked here.
