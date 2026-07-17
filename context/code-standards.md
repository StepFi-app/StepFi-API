# Code Standards — StepFi-API

## TypeScript

- Zero TypeScript errors: `npm run build` must pass.
- No `any` types anywhere in the codebase — enforced by ESLint
  (`@typescript-eslint/no-explicit-any` at `error` in `.eslintrc.js`),
  not just documentation. Third-party type gaps require an inline
  `eslint-disable-next-line` with a justification comment.
- All API responses typed with DTOs (`class-validator` decorated).

## API design

- Every new endpoint needs full Swagger decorators:
  `@ApiOperation`, `@ApiResponse`, `@ApiTags`.
- Services handle business logic only.
- Controllers handle HTTP only — no direct Supabase or contract calls
  in controllers.
- Every schema change needs a new migration file in `supabase/migrations/`
  (timestamp-prefixed filename; never edit an applied migration).

## Background jobs

- Use `@Cron` from `@nestjs/schedule` for all scheduled/polling work.
- Do not use BullMQ or any queue library (see architecture-context.md —
  removed July 2026 for Upstash free-tier reasons).
- Every cron job needs an `isRunning` guard to prevent overlapping
  executions.
- Every cron job must catch its own errors and log them — never let a
  cron throw unhandled.

## Testing

- `npm test` must pass with zero failures.
- Test count must not decrease in any PR.
- New service methods need unit tests.
- Mock Supabase and contract clients in tests — never hit real testnet
  in unit tests.

## Git

- Branch: `feat/description` or `fix/description`.
- Commit: conventional commits (`feat:`, `fix:`, `chore:`).
- Every PR references an issue number.
- Every change goes through a pull request. Direct pushes to `main` are
  for maintainer emergency fixes only, and must be documented in
  `context/progress-tracker.md` when they happen.
