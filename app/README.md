# payment-api (Express)

A production-realistic Node.js/Express payment API used for GenAI + DevOps demos.

## What this service does

- Simulates checkout and payment processing workflows
- Exposes Prometheus metrics at `GET /metrics`
- Emits structured JSON logs via `pino`/`pino-http`
- Includes OpenTelemetry tracing bootstrap for OTLP HTTP export
- Provides internal demo endpoints to force errors and simulate pool exhaustion

## Prerequisites

- Node.js 20+
- npm 10+

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy env file:

```bash
cp .env.example .env
```

(Windows PowerShell)

```powershell
Copy-Item .env.example .env
```

3. Start in dev mode:

```bash
npm run dev
```

4. API base URL:

```text
http://localhost:3000
```

## Environment variables

Example values are in `.env.example`.

- `NODE_ENV` (default: `production`)
- `SERVICE_NAME` (default: `payment-api`)
- `POD_NAME` (Kubernetes pod label/context)
- `PAYMENT_PROCESSOR_MODE` (`healthy` | `degraded` | `down` | `flapping`)
- `PAYMENT_PROCESSOR_POOL_SIZE` (default: `50`)
- `PAYMENT_PROCESSOR_TIMEOUT` (default: `10000` ms)
- `OTEL_EXPORTER_OTLP_ENDPOINT` (default: `http://otel-collector:4318`)
- `LOG_LEVEL` (default: `info`)
- `PORT` (default: `3000`)

## Scripts

- `npm run dev` - run with `ts-node-dev`
- `npm run build` - compile TypeScript to `dist/`
- `npm run start` - run compiled server (`dist/server.js`)
- `npm run lint` - run ESLint
- `npm run type-check` - run TypeScript no-emit check
- `npm run test:ci` - run Vitest tests

## API endpoints and usage

Base URL used below:

```text
http://localhost:3000
```

### 1) Health check

**GET `/health`**

Returns service liveness info.

```bash
curl -s http://localhost:3000/health
```

Example response:

```json
{
  "status": "ok",
  "uptime": 42,
  "version": "1.0.0"
}
```

---

### 2) Readiness check

**GET `/ready`**

Returns `200` when app is ready, `503` during startup/unready state.

```bash
curl -i http://localhost:3000/ready
```

---

### 3) Checkout

**POST `/api/checkout`**

Creates a mock order and charges through the simulated payment processor.

Request body:

```json
{
  "amount": 49.99
}
```

```bash
curl -s -X POST http://localhost:3000/api/checkout \
  -H "Content-Type: application/json" \
  -d '{"amount":49.99}'
```

Example response:

```json
{
  "orderId": "ord_...",
  "status": "completed",
  "transactionId": "...",
  "amount": 49.99
}
```

---

### 4) Direct payment process

**POST `/api/payment/process`**

Charges directly without creating an order.

Request body:

```json
{
  "amount": 19.95
}
```

```bash
curl -s -X POST http://localhost:3000/api/payment/process \
  -H "Content-Type: application/json" \
  -d '{"amount":19.95}'
```

Example response:

```json
{
  "transactionId": "...",
  "status": "approved",
  "processorResponse": {
    "ok": true,
    "reference": "..."
  }
}
```

---

### 5) Payment status (cache-only)

**GET `/api/payment/status`**

Read-only status endpoint. Does not call the payment processor.

Optional query parameter:

- `transactionId` (string)

```bash
curl -s "http://localhost:3000/api/payment/status?transactionId=txn_123"
```

Example response:

```json
{
  "transactionId": "txn_123",
  "status": "unknown",
  "timestamp": "2026-04-30T12:00:00.000Z"
}
```

---

### 6) Prometheus metrics

**GET `/metrics`**

Prometheus scrape endpoint (no auth for demos).

```bash
curl -s http://localhost:3000/metrics
```

Look for key metrics such as:

- `http_requests_total`
- `http_request_duration_seconds`
- `nodejs_heap_size_used_bytes`
- `nodejs_heap_size_total_bytes`
- `nodejs_active_handles_total`
- `payment_processor_circuit_state`
- `payment_processor_connection_pool_active`
- `payment_processor_connection_pool_size`

---

### 7) Force application errors (demo endpoint)

**POST `/internal/force-error`**

Forces random `500` responses for a window of time.

Request body:

```json
{
  "durationSeconds": 60,
  "errorRate": 0.5
}
```

- `durationSeconds`: non-negative number
- `errorRate`: number between `0` and `1`

```bash
curl -s -X POST http://localhost:3000/internal/force-error \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds":60,"errorRate":0.5}'
```

---

### 8) Exhaust processor pool (demo endpoint)

**POST `/internal/exhaust-pool`**

Shrinks effective payment-processor client pool size.

Request body:

```json
{
  "connections": 3
}
```

```bash
curl -s -X POST http://localhost:3000/internal/exhaust-pool \
  -H "Content-Type: application/json" \
  -d '{"connections":3}'
```

---

## Testing failure modes

Set `PAYMENT_PROCESSOR_MODE` in `.env`:

- `healthy`: fast responses, near-zero error rate
- `degraded`: slower responses, elevated error rate
- `down`: immediate timeout/fail behavior
- `flapping`: alternates between healthy/degraded every 30 seconds

Then restart app:

```bash
npm run dev
```

## Observability notes

- Request logs are JSON and include request metadata + route/requestId fields.
- Tracing initializes from `src/lib/tracer.ts` and exports to OTLP HTTP endpoint.
- Metrics endpoint is ready for Prometheus scraping.

## Docker

Build image:

```bash
docker build -t payment-api:local .
```

Run image:

```bash
docker run --rm -p 3000:3000 --env-file .env payment-api:local
```

## Disclaimer for course demos

This repo intentionally contains planted issues for instructional use (clearly tagged in source comments and Dockerfile).
