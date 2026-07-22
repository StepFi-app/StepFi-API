# Progress Tracker — StepFi-API

Format: date, commit hash, what changed, why.
Update this file in every PR that changes functionality (not needed for
pure chore/docs commits). Direct pushes to main must also be logged here.

---

## 2026-07-22

- Synchronized the vendor-registry client with the deployed contract by using
  the current function names and Stellar `Address` arguments.
- Replaced the stale vendor `active` flag with the contract's typed status,
  added strict status decoding, and limited missing-vendor handling to contract
  error code 4 so integration drift now fails loudly.
- Added client-level tests for exact function names, argument encoding, status
  validation, and contract error handling (#96).

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
