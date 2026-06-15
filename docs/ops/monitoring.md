# Monitoring & Alerting Configuration

## Overview

StepFi API exposes three observability endpoints:

| Endpoint   | Purpose                       | Public | Route             |
|------------|-------------------------------|--------|-------------------|
| `/health`  | Comprehensive health check    | Yes    | `GET /health`     |
| `/metrics` | Prometheus metrics            | No     | `GET /metrics`    |
| `/docs`    | Swagger/OpenAPI documentation | Yes    | `GET /api/v1/docs`|

> **`/metrics` must never be exposed publicly.** Block it at the reverse proxy (Nginx,
> Cloudflare, or Render's network layer). Only the internal Prometheus server may
> scrape this endpoint.

---

## Prometheus Metrics

All metrics use the `stepfi_` prefix:

### HTTP Request Metrics
- `stepfi_http_requests_total` — Counter, labels: `method`, `status`, `path`
- `stepfi_http_request_duration_seconds` — Histogram, labels: `method`, `status`, `path`
  - Buckets: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s

### Application Metrics
- `stepfi_bullmq_queue_depth` — Gauge, labels: `queue`
- `stepfi_indexer_lag_ledgers` — Gauge (indexer ledger lag behind network tip)
- `stepfi_horizon_up` — Gauge (1 = reachable, 0 = down)
- `stepfi_db_pool_open` — Gauge (open database connections)

### Default Node.js Metrics
Provided by `prom-client` default metrics:
- `process_cpu_user_seconds_total`
- `process_resident_memory_bytes`
- `nodejs_heap_size_used_bytes`
- `nodejs_eventloop_lag_seconds`

---

## Uptime Monitors

### Recommended service (Render)

If deployed on Render, configure a **cron job** health check:

```yaml
healthCheckPath: /health
healthCheckInterval: 30   # seconds
```

### Recommended service (external — Pingdom / Better Uptime)

| Setting          | Value                          |
|------------------|--------------------------------|
| Check URL        | `https://api.stepfi.app/health`|
| Check interval   | 1 minute                       |
| Timeout          | 10 seconds                     |
| Retries          | 2                              |
| Regions          | US East, US West, EU West      |

**Alert triggers:**
- 2 consecutive failures → Pager (PagerDuty / Opsgenie)
- Any single 5xx response → Slack notification

---

## Prometheus & Alertmanager

### Scrape configuration (`prometheus.yml`)

```yaml
scrape_configs:
  - job_name: 'stepfi-api'
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: /metrics
    static_configs:
      - targets: ['api.stepfi.app:443']
    scheme: https
    authorization:
      credentials: '<bearer-token-if-used>'
```

### Alert rules (`alerts.yml`)

```yaml
groups:
  - name: stepfi
    rules:

      # API down
      - alert: StepFiAPIDown
        expr: probe_success{job="stepfi-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'StepFi API is unreachable'

      # HTTP 5xx rate
      - alert: StepFiHighErrorRate
        expr: |
          rate(stepfi_http_requests_total{status=~"5.."}[5m])
          /
          rate(stepfi_http_requests_total[5m])
          > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Error rate > 5% over 5m'

      # p99 latency
      - alert: StepFiHighLatency
        expr: |
          histogram_quantile(
            0.99,
            rate(stepfi_http_request_duration_seconds_bucket[5m])
          ) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'p99 latency > 3s over 5m'

      # Indexer lag
      - alert: StepFiIndexerStalled
        expr: stepfi_indexer_lag_ledgers > 500
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: 'Indexer lag > 500 ledgers'

      - alert: StepFiIndexerCritical
        expr: stepfi_indexer_lag_ledgers > 2000
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Indexer lag > 2000 ledgers — data may be stale'

      # BullMQ queue depth
      - alert: StepFiQueueBacklog
        expr: stepfi_bullmq_queue_depth > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'BullMQ queue {{ $labels.queue }} has > 1000 waiting jobs'

      # Horizon down
      - alert: StepFiHorizonDown
        expr: stepfi_horizon_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Stellar Horizon endpoint is unreachable'
```

### Alert thresholds summary

| Metric             | Warning        | Critical       |
|--------------------|----------------|----------------|
| Error rate         | > 5%           | > 10%          |
| p99 latency        | > 3s           | > 5s           |
| Indexer lag        | > 500 ledgers  | > 2000 ledgers |
| Queue depth        | > 1000 jobs    | > 5000 jobs    |
| Horizon up         | —              | 0 (down)       |

---

## Grafana

The dashboard JSON is at [`grafana/dashboard.json`](../grafana/dashboard.json).
Import it into Grafana via **Dashboards → Import**.

### Panels included

1. **Request rate** — Rate of HTTP requests per second by status class
2. **Error rate** — Percentage of 5xx responses
3. **Latency (p50 / p95 / p99)** — Request duration quantiles
4. **Indexer lag** — Ledger lag gauge & timeseries
5. **Queue depths** — BullMQ waiting job counts per queue
6. **Horizon health** — Up/down status
7. **Database pool** — Open connections
8. **Node.js resource usage** — Memory, CPU, event loop lag

---

## Logging

- **Format:** JSON structured logs in production, pretty-print in development
- **Levels:** `trace`, `info`, `warn`, `error`, `fatal`
- **Correlation:** Every log line includes a `correlationId` — pass the
  `x-correlation-id` or `x-request-id` header from the client
- **Redaction:** The following fields are automatically redacted:
  `authorization`, `cookie`, `x-api-key`, `password`, `secret`, `token`, `refreshToken`

**Log level configuration:**
```
LOG_LEVEL=info          # default: info in prod, trace in dev
LOG_PRETTY=false        # default: false in prod, true in dev
```

---

## Sentry (optional)

`@sentry/nestjs` is installed but not configured. To enable:

1. Set `SENTRY_DSN` in environment
2. Initialize Sentry in `main.ts`:

```typescript
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
});
```
