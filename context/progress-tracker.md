# Progress Tracker — StepFi-API

Format: date, commit hash, what changed, why.
Update this file in every PR that changes functionality.

## 2026-08-25

- Commit hash: pending.
- Added a server-side `AdminGuard` for the `/admin` module tree that reads the current `users` row from Supabase on every request, instead of trusting the JWT role claim alone.
- Applied the guard to `GET /admin/audit-logs`, added explicit 401/403 responses, and logged denied admin attempts with the same audit log shape used by the audit interceptor.
- Expanded the `users.role` constraint to allow a real server-side `admin` role and updated the user profile DTO to reflect that role.
- Added unit coverage for admin, blocked admin, unauthenticated, and stale-token authorization branches.

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

- Added scheduled state reconciliation across indexed on-chain loan, liquidity, reputation, and transaction state. The idempotent Cron job resolves provisional loan IDs, repairs stale database state, backfills missed transaction records, marks orphaned pending transactions, exports drift metrics, and logs a structured report without making on-chain writes.

## 2026-07-16

- Added wallet-bound user roles (sponsor/vendor/mentor): `role` column migration, one-time `POST /users/me/role` (409 once set), role claim in JWT, `RolesGuard` on vendor/liquidity endpoints
- Enforced `@typescript-eslint/no-explicit-any` at error via new `.eslintrc.js`
- Replaced all 32 explicit `any` usages in `src/` with real types
- Fixed liquidity overview endpoint to expose `lockedLiquidity`, `availableLiquidity`, `totalShares`, `sharePrice`
- Fixed indexer cursor not persisting after the BullMQ→Cron migration
- Removed BullMQ entirely; all jobs now use `@Cron` or `setInterval`

## 2026-07-15

- Replaced BullMQ polling jobs with `@Cron` and `setInterval`, cutting Redis usage by ~90%

## 2026-07-02

- Added Supabase keep-alive cron job to prevent free-tier project pausing
- Indexer: self-healing reset of stale ledger checkpoint and jump-to-recent-ledger instead of incrementing by 1
- Fixed learner profile migration — quoted the reserved word `current_role`
- Resolved npm audit vulnerabilities
- Repo hygiene: PR template + CODEOWNERS, issue template with test requirements

## 2026-06-27

- API Key authentication system for vendor service-to-service integration (#60, commit 7524888)
- Extended learner onboarding profile endpoint — richer profile fields, completion tracking (#59, commit be6ac8b)

## 2026-06-21

- Two-step repayment flow: `buildRepaymentXdr()` + submit endpoint so wallets sign server-built XDR (#51, commit 4224bb6)

## 2026-06-19

- Integrated Sentry for error tracking; fixed MetricsModule dependency injection startup error (#55, commit 58848c1)
- Added `GET /api/v1/vouching/requests` for incoming vouch requests (#54, commit cb60433)
- End-to-end loan lifecycle test with in-memory mock infrastructure (#52, commit 5a4efa0)

## 2026-06-18

- Audit log for admin operations (#49, commit 760d459)
- SponsorsService: `getPool()`, `buildDepositXdr()`, `buildWithdrawXdr()` with unit tests (#48, commit 1793032)
