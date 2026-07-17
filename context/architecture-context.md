# Architecture Context — StepFi-API

## What this is

NestJS backend API for the StepFi BNPL protocol. Bridges the mobile app
(StepFi-App), web app (StepFi-Web), and 5 deployed Soroban smart contracts
on Stellar. Live on Render at `https://stepfi-api.onrender.com/api/v1`.

The API is the only layer that talks to Soroban RPC / Horizon. Clients never
call the chain directly — they receive unsigned XDR from this API, sign it
with their wallet, and submit the signed XDR back.

---

## Stack

| Layer | Technology | Role |
|---|---|---|
| Framework | NestJS v11 + Fastify adapter | HTTP server |
| Database | Supabase (PostgreSQL) | Off-chain data, RLS enabled |
| Cache | Redis (Upstash) via cache-manager + ioredis | Caching only — no job queues |
| Scheduling | @nestjs/schedule (@Cron) + setInterval | All background jobs |
| Blockchain | Stellar SDK | Horizon + Soroban RPC calls, XDR building |
| Auth | JWT (@nestjs/jwt + passport-jwt) | Wallet-signature-based authentication |
| Validation | class-validator + class-transformer | DTO validation at every boundary |
| Docs | @nestjs/swagger | Live Swagger UI |
| Observability | Sentry (@sentry/nestjs), nestjs-pino, Prometheus (@willsoto/nestjs-prometheus) | Errors, structured logs, metrics |
| Rate limiting | @nestjs/throttler | 100 req / 60 s global guard |

---

## Key architectural decision: no BullMQ

As of July 2026, all background jobs (indexer, transaction status checker,
loan payment reminders, nonce cleanup, Supabase keep-alive) run via NestJS
`@Cron` or `setInterval`, not BullMQ. This was a deliberate removal
(commits d908c52, c9cfbd0) after BullMQ's Redis polling exceeded the Upstash
free-tier request limit (500k/month).

**Do not reintroduce BullMQ or any job-queue library without explicit
approval.** Polling and scheduled tasks belong in `@Cron`. Only genuinely
queue-worthy work (retryable, priority-based, concurrent workers) would
justify a queue library.

---

## Modules

Feature modules under `src/modules/`:

| Module | Purpose |
|---|---|
| `auth` | Nonce issue/verify, JWT issue/refresh, registration, API keys |
| `admin` | Admin operations with audit logging |
| `blockchain` | Soroban contract client wrappers |
| `credit-scoring` | Credit tier / limit computation |
| `health` | Health checks, Horizon/indexer-lag probes, stellar.toml |
| `learners` | Learner profiles and onboarding completion |
| `liquidity` | Pool overview, deposit/withdraw XDR building |
| `loans` | Loan lifecycle, two-step repayment (buildRepaymentXdr → submit) |
| `metrics` | Prometheus metrics + updater |
| `notifications` | Payment reminders and notifications |
| `reputation` | On-chain reputation score reads |
| `sponsors` | Sponsor pool stats, deposit/withdraw XDR |
| `transactions` | Transaction records and status |
| `users` | User records, avatar upload |
| `vendors` | Vendor registry integration |
| `vouching` | Mentor vouching (vouch requests, boosts) |

Infrastructure outside `src/modules/`:

- `src/indexer/` — ledger event indexer with self-healing checkpoint cursor
- `src/jobs/` — cron job modules: `loan-payment-reminder`,
  `transaction-status-checker`, `nonce-cleanup`, `supabase-keepalive`
- `src/stellar/` — Stellar SDK integration layer
- `src/common/` — guards, interceptors, logger (correlation-id middleware)
- `src/database/` — Supabase client + repositories

---

## Auth flow

Wallet address → `POST /auth/nonce` → client signs nonce with wallet →
`POST /auth/verify` → JWT (access + refresh) issued.
`POST /auth/refresh` rotates tokens.

- SEP-0043 message signing supported for browser wallets (Freighter)
- Raw Ed25519 signature verification for mobile (WalletConnect wallets)
- Nonces are single-use and expired by the `nonce-cleanup` cron

---

## Database

Supabase Postgres. ~22 tables across 30 migration files, RLS enabled.
Migrations live in `supabase/migrations/` and run in chronological order by
filename timestamp. Every schema change requires a new migration file —
never edit an applied migration.

---

## Contracts integration

5 Soroban contracts on Stellar testnet (creditline, reputation,
liquidity-pool, vendor-registry, parameters), called via contract client
wrappers in `src/modules/blockchain/`. Contract IDs come from
config/environment variables only — never hardcoded in service files.
