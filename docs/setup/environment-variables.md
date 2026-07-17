# Environment Variables

This document describes all environment variables used in the StepFi API.

## Overview

Environment variables are stored in a `.env` file at the root of the project. Never commit this file to version control. Use `.env.example` as a template.

## Required Variables

### Application

```env
# Application environment (development, staging, production)
NODE_ENV=development

# Port for the API server
PORT=3000

# Base URL of the API (for CORS and redirects)
API_URL=http://localhost:3000
```

### Database (Supabase)

```env
# Supabase project URL
SUPABASE_URL=https://your-project.supabase.co

# Supabase anonymous/public API key
SUPABASE_ANON_KEY=your-anon-key

# Supabase service role key (server-side only, never expose to client)
SUPABASE_SERVICE_KEY=your-service-role-key

# Direct PostgreSQL connection string (optional, for migrations)
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

### Stellar / Soroban

```env
# Stellar network (testnet or public)
STELLAR_NETWORK=testnet

# Horizon API URL
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Soroban RPC URL
STELLAR_SOROBAN_URL=https://soroban-testnet.stellar.org

# Network passphrase
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Contract addresses (deployed smart contracts)
REPUTATION_CONTRACT_ID=CA...
CREDITLINE_CONTRACT_ID=CA...
MERCHANT_REGISTRY_CONTRACT_ID=CA...
LIQUIDITY_POOL_CONTRACT_ID=CA...
```

### Authentication (JWT)

```env
# Secret key for signing JWT tokens (use a strong random string)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# JWT access token expiration (e.g., 15m, 1h, 1d)
JWT_ACCESS_EXPIRATION=15m

# JWT refresh token expiration
JWT_REFRESH_EXPIRATION=7d

# Nonce expiration for wallet authentication (in seconds)
NONCE_EXPIRATION=300
```

### Redis (Caching)

```env
# Redis connection URL
REDIS_URL=redis://localhost:6379

# Redis password (if required)
REDIS_PASSWORD=

# Redis database number (0-15)
REDIS_DB=0

# Cache TTL for reputation scores (in seconds)
REPUTATION_CACHE_TTL=300
```

## Optional Variables

### Logging

```env
# Log level (error, warn, info, debug, verbose)
LOG_LEVEL=info

# Enable pretty-printed logs (true for development, false for production)
LOG_PRETTY=true
```

### CORS

```env
# Allowed origins for CORS (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Allow credentials in CORS
CORS_CREDENTIALS=true
```

### Rate Limiting

```env
# Enable rate limiting
RATE_LIMIT_ENABLED=true

# Max requests per window
RATE_LIMIT_MAX=100

# Time window in milliseconds
RATE_LIMIT_WINDOW_MS=60000
```

### Jobs & Indexer

```env
# Enable background jobs
JOBS_ENABLED=true

# Chain indexer interval (in seconds)
INDEXER_INTERVAL=30

# Transaction status check interval (in seconds)
TX_STATUS_INTERVAL=15

# Loan reminder job cron expression
REMINDER_CRON=0 9 * * *
```

### Server-signed Stellar submissions (sequence manager)

These variables let the API itself submit Stellar transactions for loan
funding, default detection, and admin operations. Without the source
account secret, `BlockchainService.submitServerTransaction` is disabled
and the API can still run in read-only / frontend-only mode.

```env
# Secret key (S…) of the protocol source account that signs server txs.
# REQUIRED — leave unset only for read-only deployments.
STELLAR_SOURCE_ACCOUNT_SECRET=S...

# Optional comma-separated list of channel-account secret keys (S…) for
# concurrent in-flight submissions. Each channel maintains its own
# sequence number so they never collide. Funded separately.
STELLAR_CHANNEL_ACCOUNTS=S...,S...

# Max attempts (re-syncs from Horizon) before the manager gives up on
# tx_bad_seq. Default 3 (one initial attempt + three retries).
STELLAR_BAD_SEQ_MAX_RETRIES=3
```

### Monitoring (Optional)

```env
# Sentry DSN for error tracking
SENTRY_DSN=https://...@sentry.io/...

# Enable APM/metrics
APM_ENABLED=false
```

## Environment-Specific Configurations

### Development (.env.development)

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
LOG_PRETTY=true
STELLAR_NETWORK=testnet
JOBS_ENABLED=false
```

### Production (.env.production)

```env
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
LOG_PRETTY=false
STELLAR_NETWORK=public
JOBS_ENABLED=true
RATE_LIMIT_ENABLED=true
```

## Security Best Practices

1. **Never commit `.env` files**: Always add `.env` to `.gitignore`
2. **Use strong secrets**: Generate random strings for `JWT_SECRET`
   ```bash
   openssl rand -base64 32
   ```
3. **Rotate secrets regularly**: Change JWT secrets periodically in production
4. **Environment separation**: Use different credentials for dev/staging/prod
5. **Principle of least privilege**: Use Supabase service key only where necessary
6. **Encrypt at rest**: Use secret management tools (AWS Secrets Manager, Vault)

## Validation

The API validates required environment variables at startup. If any critical variable is missing, the application will fail to start with a descriptive error.

## Getting Values

### Supabase Credentials

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Select your project
3. Navigate to Settings → API
4. Copy:
   - URL: `SUPABASE_URL`
   - anon/public key: `SUPABASE_ANON_KEY`
   - service_role key: `SUPABASE_SERVICE_KEY`

### Stellar Contract IDs

After deploying contracts to testnet/mainnet, copy the contract IDs:

```bash
# Example output from deployment
Reputation Contract: CAXYZ...
CreditLine Contract: CABCD...
```

## Example .env File

```env
# Application
NODE_ENV=development
PORT=3000
API_URL=http://localhost:3000

# Database
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DATABASE_URL=postgresql://postgres:password@db.abcdefgh.supabase.co:5432/postgres

# Stellar
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOROBAN_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Contracts
REPUTATION_CONTRACT_ID=CAXYZ123...
CREDITLINE_CONTRACT_ID=CABCD456...
MERCHANT_REGISTRY_CONTRACT_ID=CAEFG789...
LIQUIDITY_POOL_CONTRACT_ID=CAHIJ012...

# Auth
JWT_SECRET=super-secret-key-change-in-production
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
NONCE_EXPIRATION=300

# Redis
REDIS_URL=redis://localhost:6379
REDIS_DB=0
REPUTATION_CACHE_TTL=300

# Logging
LOG_LEVEL=debug
LOG_PRETTY=true

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
CORS_CREDENTIALS=true

# Jobs
JOBS_ENABLED=true
INDEXER_INTERVAL=30
TX_STATUS_INTERVAL=15
REMINDER_CRON=0 9 * * *
```

## Related Documentation

- [Installation Guide](./installation.md)
- [Supabase Setup](./supabase-setup.md)

---

*Last Updated: 2026-02-13*
