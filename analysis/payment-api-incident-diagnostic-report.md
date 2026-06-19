# Payment API Incident Diagnostic Report

**Service:** payment-api  
**Environment:** prod (AWS EKS, namespace `payment-api`)  
**Pod:** `payment-api-7d9f8b-xkp2q`  
**Version:** `a3f9c12`  
**Log window:** 2024-11-29T14:03:12.441Z → 2024-11-29T14:07:02.119Z (~3 min 50 sec)  
**Prepared by:** SRE on-call analysis  
**Status at end of window:** Pod **OOMKilled** (SIGKILL)

---

## Executive Summary

A single payment-api pod experienced a cascading failure over ~4 minutes. The incident began with isolated upstream processor-gateway timeouts, escalated into a burst of connection timeouts and a **34.2% error rate**, and terminated with **memory exhaustion and OOMKill**. Several concurrent but non-causal issues (auth failures, validation errors, refund bug, v2 route 404) appear client-side or isolated and did not drive the cascade.

**Primary root cause (most likely):** Degradation or unavailability of the upstream `processor-gateway`, causing payment timeouts, retry amplification, connection buildup, and eventual pod OOM under the **256Mi memory limit**.

---

## 1. Pattern Recognition

Patterns are ordered by severity (most critical first).

---

### 1.1 Pod OOM / Memory Exhaustion — **CRITICAL**

| Timestamp | Message |
|-----------|---------|
| 2024-11-29T14:06:44.221Z | Memory usage high — heap 221/256 MiB, RSS 289 MiB |
| 2024-11-29T14:06:58.003Z | Memory usage high — heap 244/256 MiB, RSS 301 MiB |
| 2024-11-29T14:07:02.119Z | Process OOMKilled — heap 256/256 MiB, RSS 312 MiB, SIGKILL |

- **Occurrences:** 2 warnings + 1 fatal event  
- **Time window:** 18 seconds (14:06:44 → 14:07:02)  
- **Severity:** **Critical** — pod terminated; traffic to this replica lost until Kubernetes restarts it

---

### 1.2 Upstream Processor Timeout & Connection Failures — **CRITICAL**

| Timestamp | Message | Status |
|-----------|---------|--------|
| 2024-11-29T14:05:17.225Z | Upstream processor timeout (retry 1) | 504 |
| 2024-11-29T14:05:17.441Z | Upstream processor timeout (retry 2) | 504 |
| 2024-11-29T14:05:17.669Z | Payment failed after max retries | 502 |
| 2024-11-29T14:06:10.118Z | Payment processing error — ETIMEDOUT | 500 |
| 2024-11-29T14:06:10.334Z | Payment processing error — ETIMEDOUT | 500 |
| 2024-11-29T14:06:10.559Z | Payment processing error — ETIMEDOUT | 500 |
| 2024-11-29T14:06:11.002Z | Payment processing error — ETIMEDOUT | 500 |

- **Occurrences:** 7 errors (1 transaction with retry chain + 4 concurrent timeouts)  
- **Time window:** Two bursts — isolated at 14:05:17 (~0.4 s), cluster at 14:06:10 (~0.9 s)  
- **Severity:** **Critical** — failed payments, customer-visible 502/504/500 responses  
- **Affected transaction IDs:** `txn_4v8nt61k`, `txn_2n8qc77f`, `txn_3t1mp88h`, `txn_9a4ru55q`, `txn_7c2sw19j`

---

### 1.3 Service Degradation — Error Rate Threshold Breached — **CRITICAL**

| Timestamp | Message |
|-----------|---------|
| 2024-11-29T14:06:10.781Z | Error rate threshold breached — 34.2% over 60 s window, status `degraded` |

- **Occurrences:** 1  
- **Time window:** Single evaluation at 14:06:10  
- **Severity:** **Critical** — aggregate SLO breach signal, likely triggered by upstream timeout burst

---

### 1.4 Unhandled Application Exception (Refund Path) — **CRITICAL** (isolated)

| Timestamp | Message |
|-----------|---------|
| 2024-11-29T14:05:51.009Z | Unhandled exception — `TypeError: Cannot read properties of undefined (reading 'original_amount')` at `RefundService.validate` |

- **Occurrences:** 1  
- **Time window:** Single request at 14:05:51  
- **Severity:** **Critical** for the affected refund request; **not** the driver of the pod-wide cascade  
- **Stack trace:** `/app/src/services/refund.service.js:142` → `/app/src/controllers/refund.controller.js:67`

---

### 1.5 Slow Payment Responses — **WARNING**

| Timestamp | Duration | Transaction |
|-----------|----------|-------------|
| 2024-11-29T14:06:08.773Z | 1843 ms | txn_6m3yk55b |
| 2024-11-29T14:06:09.002Z | 2102 ms | txn_0r9xd14c |
| 2024-11-29T14:06:09.441Z | 2489 ms | txn_5k7lb32w |

- **Occurrences:** 3 (all returned HTTP 200)  
- **Time window:** ~0.7 s (14:06:08 → 14:06:09)  
- **Severity:** **Warning** — early signal of upstream latency immediately preceding the ETIMEDOUT burst

---

### 1.6 Authentication Failures — **WARNING** (client-side)

| Timestamp | Client IP |
|-----------|-----------|
| 2024-11-29T14:04:45.772Z | 203.0.113.42 |
| 2024-11-29T14:04:46.003Z | 203.0.113.42 |
| 2024-11-29T14:04:46.198Z | 203.0.113.42 |

- **Occurrences:** 3 in ~0.4 s  
- **Time window:** 14:04:45 → 14:04:46  
- **Severity:** **Warning** — invalid/expired API key; no successful auth bypass implied

---

### 1.7 Rate Limit Threshold Approaching — **WARNING**

| Timestamp | Detail |
|-----------|--------|
| 2024-11-29T14:04:46.441Z | 58 req/min from 203.0.113.42 (limit 60) |

- **Occurrences:** 1  
- **Severity:** **Warning** — same client IP as auth failures; possible misconfigured or abusive client

---

### 1.8 Request Validation Failure — **WARNING** (client-side)

| Timestamp | Detail |
|-----------|--------|
| 2024-11-29T14:05:03.881Z | Missing required field: `currency` (HTTP 400) |

- **Occurrences:** 1  
- **Severity:** **Warning** — caller payload error, not a service defect

---

### 1.9 Payment Declined (Business Outcome) — **INFORMATIONAL**

| Timestamp | Detail |
|-----------|--------|
| 2024-11-29T14:04:22.560Z | Insufficient funds — HTTP 402, txn_9c1ms73n, $899.00 |

- **Occurrences:** 1  
- **Severity:** **Informational** — expected business rejection, not an infrastructure failure

---

### 1.10 Route Not Found — **INFORMATIONAL**

| Timestamp | Detail |
|-----------|--------|
| 2024-11-29T14:06:29.667Z | `POST /api/v2/payments` — HTTP 404 |

- **Occurrences:** 1  
- **Severity:** **Informational** — client calling unsupported API version

---

### 1.11 Normal Operations — **INFORMATIONAL**

| Timestamp | Message |
|-----------|---------|
| 2024-11-29T14:03:12.441Z | Server started |
| 2024-11-29T14:03:14.882Z | Health check passed |
| 2024-11-29T14:03:45.119Z | Payment processed (txn_8f3kd92m) |
| 2024-11-29T14:04:01.334Z | Payment processed (txn_2p7qr41x) |
| 2024-11-29T14:05:33.114Z | Payment processed (txn_7h2wz88s) |

- **Severity:** **Informational** — baseline healthy behavior before and during partial degradation

---

## 2. Timeline Reconstruction

### Phase 0 — Healthy startup (14:03:12 → 14:04:01)

The pod starts, passes `/health`, and successfully processes two card payments in 118–143 ms. No infrastructure anomalies.

### Phase 1 — Client-side noise (14:04:22 → 14:05:03)

- One legitimate payment decline (insufficient funds).
- Three rapid auth failures and a rate-limit warning from `203.0.113.42` — likely a misconfigured integration retrying with a bad key.
- One validation error (missing `currency`).

These events increase log volume but do not correlate with pod health degradation.

### Phase 2 — First upstream signal (14:05:17)

Transaction `txn_4v8nt61k` hits `processor-gateway` twice with 5 s timeouts, then fails with 502 after retries exhausted (~10 s total). This is the **earliest infrastructure-level signal** that the payment processor dependency is unhealthy.

A successful payment at 14:05:33 suggests intermittent or partial upstream degradation rather than total outage at this point.

### Phase 3 — Isolated application bug (14:05:51)

A refund for `txn_1q5jp29r` crashes with an unhandled `TypeError` on `original_amount`. This is a separate code defect; one failed refund does not explain the later payment storm.

### Phase 4 — Escalation to customer impact (14:06:08 → 14:06:11)

1. Three payments complete but exceed the 1000 ms slow-response threshold (1843–2489 ms).
2. Within ~1 second, four concurrent payments fail with `ETIMEDOUT` against `processor-gateway`.
3. The pod self-reports **34.2% error rate** and enters `degraded` status.

**Customer impact begins in earnest at 14:06:10** when multiple concurrent payment failures occur and the error-rate gate trips. The earlier single-transaction timeout at 14:05:17 was customer-impacting for one user but not service-wide.

### Phase 5 — Memory cascade and pod death (14:06:44 → 14:07:02)

Memory warnings escalate (221 → 244 → 256 MiB heap). The pod is **OOMKilled** with SIGKILL. Likely cascade:

```
processor-gateway degradation
  → hung / slow upstream connections
  → in-flight request and retry accumulation
  → heap growth under 256 MiB limit
  → OOMKill
```

### Final pod state

**Dead.** Kubernetes will restart the container per `restartPolicy: Always`, but this replica was unavailable at 14:07:02. With a 2-replica deployment, ~50% capacity was lost until the pod recovered.

---

## 3. Root Cause Analysis

### Top 3 hypotheses (most → least likely)

#### Hypothesis 1: Upstream `processor-gateway` degradation or outage (PRIMARY)

**Supporting evidence:**
- Explicit upstream timeouts at exactly 5000 ms with `upstream: processor-gateway`
- `ETIMEDOUT: connection timed out` on four concurrent requests
- Slow successful payments (1.8–2.5 s) immediately before the timeout burst — classic latency-then-failure pattern
- Retry attempts logged (`retry_attempt: 1`, `retry_attempt: 2`) before 502

**Gaps:** No processor-gateway logs, no network/trace data, no circuit-breaker state in these logs.

**Inconsistent entries:** Successful payment at 14:05:33 during the same window suggests intermittent failure, not a hard cutover — consistent with partial degradation, not inconsistent with this hypothesis.

---

#### Hypothesis 2: Retry/connection amplification causing memory exhaustion under low memory limits (CONTRIBUTING / TERMINAL)

**Supporting evidence:**
- Memory climbs from 221 → 244 → 256 MiB in 18 s after the error burst
- OOMKill at heap ceiling matching the **256Mi** Kubernetes memory limit (see `k8s/deployment.yaml`)
- Multiple concurrent upstream timeouts imply in-flight HTTP connections held until timeout
- Error rate spike (34.2%) implies high concurrent request load on a single pod

**Gaps:** No heap dump, no connection-pool metrics in logs, no GC telemetry.

**Inconsistent entries:** Memory warnings start ~34 s after the timeout burst — could indicate delayed GC pressure or accumulated state from the full 4-minute window, not just the last second.

---

#### Hypothesis 3: Refund service null-reference bug (ISOLATED DEFECT, NOT INCIDENT ROOT)

**Supporting evidence:**
- Clear stack trace: undefined object when reading `original_amount`
- HTTP 500 on `/api/v1/refunds`

**Why it ranks lower:** Single occurrence, different route, no temporal correlation with payment timeout burst or memory growth. Should be fixed but is not the cascade root cause.

---

### Log entries inconsistent with a single root cause

| Entry | Why it doesn't fit the primary cascade |
|-------|----------------------------------------|
| Auth failures (14:04:45) | Client credential issue; predates upstream failures by ~90 s |
| Payment declined 402 | Normal business logic |
| Missing currency 400 | Client validation error |
| `/api/v2/payments` 404 | Wrong API version on client |
| Successful payments during incident | Indicates partial/intermittent upstream failure, not total code regression |

---

## 4. Immediate Diagnostic Steps

Run these now to confirm or rule out each hypothesis.

### 4.1 Kubernetes — pod state and OOM confirmation

```bash
kubectl -n payment-api get pod payment-api-7d9f8b-xkp2q -o wide
kubectl -n payment-api describe pod payment-api-7d9f8b-xkp2q
kubectl -n payment-api get events -n payment-api --field-selector involvedObject.name=payment-api-7d9f8b-xkp2q --sort-by='.lastTimestamp'
kubectl -n payment-api top pod payment-api-7d9f8b-xkp2q
kubectl -n payment-api logs payment-api-7d9f8b-xkp2q --previous --tail=200
```

| Confirms H1/H2 if | Rules out if |
|-------------------|--------------|
| `describe` shows `Last State: Terminated, Reason: OOMKilled` | Pod shows `Running` with no restart and no OOM in events |
| Events show `Memory limit exceeded` or container restart | Pod never restarted; errors were logged but process stayed healthy |
| `--previous` logs show same timeout → memory → SIGKILL sequence | Previous container exited cleanly (e.g. rollout, not OOM) |

---

### 4.2 Kubernetes — deployment-wide health

```bash
kubectl -n payment-api get pods -l app=payment-api -o wide
kubectl -n payment-api rollout status deployment/payment-api
kubectl -n payment-api get hpa payment-api
kubectl -n payment-api describe deployment payment-api
```

| Confirms H2 if | Rules out if |
|----------------|--------------|
| Only one pod OOM'd while others healthy — partial outage | All pods OOM/restarting — cluster-wide config or traffic issue |
| HPA not scaled despite high error rate | HPA maxed at 5 replicas and all pods stressed |

---

### 4.3 Processor-gateway dependency

```bash
kubectl -n payment-api get svc,endpoints
kubectl -n processor-gateway get pods 2>/dev/null || kubectl get pods -A | grep processor
kubectl -n processor-gateway logs -l app=processor-gateway --since=10m --tail=100 2>/dev/null
kubectl -n payment-api exec -it deploy/payment-api -- wget -qO- --timeout=5 http://processor-gateway/charge 2>&1 || true
```

| Confirms H1 if | Rules out if |
|----------------|--------------|
| Processor pods unhealthy, high restart count, or endpoints empty | Processor pods healthy; direct probe responds in <500 ms |
| Processor logs show latency spikes or 5xx at 14:05–14:06 UTC | Processor logs clean; no correlation with payment-api errors |

---

### 4.4 Prometheus queries

```promql
# 5xx error rate (matches prometheusrule PaymentAPICriticalErrorRate)
100 * sum(rate(http_requests_total{namespace="payment-api", status_code=~"5..", route!~"/health|/metrics|/ready"}[2m]))
  / clamp_min(sum(rate(http_requests_total{namespace="payment-api", route!~"/health|/metrics|/ready"}[2m])), 0.001)

# P99 latency spike
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{namespace="payment-api", route!~"/health|/metrics|/ready"}[5m])) by (le))

# Memory at limit (container metrics)
max by (pod) (container_memory_working_set_bytes{namespace="payment-api", container="payment-api"})
  / max by (pod) (kube_pod_container_resource_limits{namespace="payment-api", resource="memory", container="payment-api"})

# OOM events
kube_pod_container_status_last_terminated_reason{namespace="payment-api", reason="OOMKilled"}

# Payment processor circuit breaker (if exported)
payment_processor_circuit_state{namespace="payment-api"}

# Connection pool pressure (if exported)
payment_processor_connection_pool_active{namespace="payment-api"}
  / payment_processor_connection_pool_size{namespace="payment-api"}
```

| Confirms H1 if | Rules out if |
|----------------|--------------|
| Error rate >5% and P99 >1 s at 14:06 UTC | Flat error rate and latency during incident window |
| Circuit breaker = 1 (open) or pool utilization near 100% | Circuit closed, pool utilization low |

| Confirms H2 if | Rules out if |
|----------------|--------------|
| Memory working set ≥95% of limit on affected pod before restart | Memory stayed below 70% of limit |

---

### 4.5 AWS CLI — EKS node and cluster context

```bash
aws eks describe-cluster --name <cluster-name> --query 'cluster.status'
aws cloudwatch get-metric-statistics \
  --namespace ContainerInsights \
  --metric-name pod_memory_utilization \
  --dimensions Name=PodName,Value=payment-api-7d9f8b-xkp2q Name=Namespace,Value=payment-api \
  --start-time 2024-11-29T14:00:00Z \
  --end-time 2024-11-29T14:10:00Z \
  --period 60 \
  --statistics Maximum
kubectl get nodes -o custom-columns=NAME:.metadata.name,MEMORY:.status.allocatable.memory,CONDITION:.status.conditions[-1].type
```

| Confirms H2 if | Rules out if |
|----------------|--------------|
| CloudWatch shows memory pegged at 100% before pod restart | Memory utilization normal at OOM timestamp |
| Node not under memory pressure (isolates to container limit) | Node-level memory pressure evicted pods |

---

## 5. Proposed Fixes

### 5.1 Upstream processor-gateway degradation (Hypothesis 1)

#### IMMEDIATE

**Action:** Shift traffic away from unhealthy processor instances or restart processor-gateway pods.

```bash
# Identify processor-gateway pods
kubectl get pods -A -l app=processor-gateway

# Rolling restart (if processor is the fault)
kubectl -n processor-gateway rollout restart deployment/processor-gateway
kubectl -n processor-gateway rollout status deployment/processor-gateway --timeout=120s
```

Alternatively, if payment-api supports a degraded mode via ConfigMap:

```bash
kubectl -n payment-api patch configmap payment-api-config --type merge \
  -p '{"data":{"PAYMENT_PROCESSOR_MODE":"healthy"}}'
kubectl -n payment-api rollout restart deployment/payment-api
```

| Attribute | Value |
|-----------|-------|
| **Time to effect** | 1–3 min (rollout) |
| **Risk** | Restarting processor during active traffic may briefly increase failures; ConfigMap change depends on app support |
| **Rollback** | `kubectl rollout undo deployment/processor-gateway` or restore prior ConfigMap and restart payment-api |

#### PERMANENT

| Item | Detail |
|------|--------|
| **Files** | `app/src/lib/payment-processor-client.ts`, `k8s/configmap.yaml`, `k8s/prometheusrule.yaml` |
| **Changes** | Ensure upstream timeout (5000 ms in logs vs 10000 ms hardcoded request timeout in code) is configurable and aligned; verify circuit breaker opens before retry storms; add processor health to readiness probe (`app/src/readiness.ts`) |
| **Validation** | Set `PAYMENT_PROCESSOR_MODE=degraded` in staging; confirm circuit opens, 503 returned fast, no OOM under load test |

---

### 5.2 Memory exhaustion / OOMKill (Hypothesis 2)

#### IMMEDIATE

**Action:** Raise memory limit and restart affected deployment to restore capacity.

```bash
kubectl -n payment-api patch deployment payment-api --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"512Mi"},
       {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"256Mi"}]'
kubectl -n payment-api rollout status deployment/payment-api --timeout=180s
```

| Attribute | Value |
|-----------|-------|
| **Time to effect** | 2–5 min (rolling update across 2 replicas) |
| **Risk** | Masks underlying leak; higher per-pod memory on nodes |
| **Rollback** | `kubectl rollout undo deployment/payment-api -n payment-api` |

#### PERMANENT

| Item | Detail |
|------|--------|
| **Files** | `k8s/deployment.yaml`, `app/src/lib/payment-processor-client.ts`, `app/src/lib/transaction-cache.ts` |
| **Changes** | Increase limits with headroom (512Mi–1Gi); cap concurrent upstream requests; bound in-memory caches (transaction cache is unbounded `Map`); export `process_resident_memory_bytes` alerts; tune HPA memory target in `k8s/hpa.yaml` |
| **Validation** | Load test with forced upstream latency (`POST /internal/exhaust-pool` or `PAYMENT_PROCESSOR_MODE=degraded`); verify memory plateaus below 80% of limit |

---

### 5.3 Refund null-reference bug (Hypothesis 3)

#### IMMEDIATE

**Action:** No kubectl fix. Mitigate by blocking refund route at ingress or feature-flag if available.

```bash
# If using a feature flag ConfigMap key (example — adjust to actual flag name)
kubectl -n payment-api patch configmap payment-api-config --type merge \
  -p '{"data":{"REFUNDS_ENABLED":"false"}}'
kubectl -n payment-api rollout restart deployment/payment-api
```

| Attribute | Value |
|-----------|-------|
| **Time to effect** | 2–5 min |
| **Risk** | Refunds unavailable until fix deployed |
| **Rollback** | Set `REFUNDS_ENABLED=true` and restart |

#### PERMANENT

| Item | Detail |
|------|--------|
| **Files** | Application code — `refund.service.js` (or equivalent TypeScript source) |
| **Changes** | Null-check transaction lookup before accessing `original_amount`; return 404/422 instead of unhandled 500; add integration test for missing transaction |
| **Validation** | Unit test + staging refund against non-existent `transaction_id` |

---

### 5.4 Client abuse / bad API key (Patterns 1.6–1.7)

#### IMMEDIATE

```bash
# Block abusive IP at ingress/WAF (example AWS WAF — adjust ACL ID)
aws wafv2 update-ip-set --name blocked-clients --scope REGIONAL \
  --id <ip-set-id> --addresses 203.0.113.42/32 --lock-token <token>
```

| Attribute | Value |
|-----------|-------|
| **Time to effect** | Seconds to minutes |
| **Risk** | False positive if IP is shared NAT |
| **Rollback** | Remove IP from block list |

#### PERMANENT

| Item | Detail |
|------|--------|
| **Files** | Ingress/WAF Terraform, rate-limit middleware in application |
| **Changes** | Enforce rate limit at edge; alert on auth failure bursts per IP |
| **Validation** | Pen-test with invalid key; confirm 429 before 58/60 internal threshold |

---

## 6. What the Logs Do Not Tell Us

| Missing information | Typical source | Future instrumentation |
|---------------------|----------------|------------------------|
| Processor-gateway health, latency, error rate | Processor pods logs, Grafana dependency dashboard | Distributed trace span for `processor-gateway` with status and duration |
| Whether circuit breaker opened | Prometheus `payment_processor_circuit_state` | Log circuit state transitions at `warn` level |
| Connection pool utilization during incident | Prometheus pool gauges | Alert when `active/size > 0.9` for 1 m |
| Which replica received traffic after OOM | Ingress/service mesh metrics, kube-proxy logs | Request logs include `pod` (present) + aggregate per-pod error rate alerts |
| Node-level memory pressure vs container limit | `kubectl describe node`, Container Insights | Alert `container_memory_working_set / limit > 0.9` |
| Heap dump / GC behavior | Node.js `--heapsnapshot`, APM | Periodic heap metrics via `prom-client` default metrics |
| Whether OOM was Linux cgroup kill vs V8 heap | `kubectl describe pod` OOMKilled reason | Explicit log before fatal on `uncaughtException` / memory watchdog |
| Refund transaction lookup source (DB vs cache) | APM trace, DB query logs | Structured log: `transaction_found: false` in refund path |
| External client identity for 203.0.113.42 | API gateway access logs, WAF | Include `client_id` or `api_key_id` (hashed) in auth failure logs |
| Cross-pod impact (only one pod in logs) | All pod logs, deployment events | Centralized log query by `namespace` not single `pod` |
| Terraform/infra change correlation | CI/CD deploy history, Terraform Cloud | Deploy annotations on pods (`kubectl annotate`) |

---

## 7. Alerting Recommendations

Gaps identified: OOM and memory pressure were logged but likely **unalerted**; error-rate breach was application-log-only; upstream dependency has no alert in provided rules.

| # | Alert | Metric / log pattern | Threshold | Severity | Fires earlier than |
|---|-------|---------------------|-----------|----------|---------------------|
| 1 | **PaymentAPIPodOOMKilled** | `kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}` | `> 0` for 0 m | Critical | OOMKill (fires on restart) |
| 2 | **PaymentAPIMemoryNearLimit** | `container_memory_working_set_bytes / kube_pod_container_resource_limits{resource="memory"}` | `> 0.85` for 2 m | Warning | Memory high warnings (221 MiB) |
| 3 | **PaymentAPIProcessorTimeoutBurst** | Log: `msg="Upstream processor timeout"` or metric rate | `> 3` in 1 m | Critical | Error rate breach at 14:06:10 |
| 4 | **PaymentAPIUpstreamConnectionTimeout** | Log: `error=~".*ETIMEDOUT.*"` rate | `> 2` in 30 s | Critical | 34.2% degraded status |
| 5 | **PaymentProcessorCircuitOpen** | `payment_processor_circuit_state == 1` | 1 m sustained | Warning | Retry exhaustion 502s |
| 6 | **PaymentAPIPoolExhaustion** | `payment_processor_connection_pool_active / payment_processor_connection_pool_size` | `> 0.9` for 2 m | Warning | Upstream timeouts |
| 7 | **PaymentAPIAuthFailureBurst** | Log: `msg="Authentication failed"` by `client_ip` | `> 5` in 1 m from same IP | Warning | Rate limit warning at 58/60 |
| 8 | **PaymentAPIRefundUnhandledException** | Log: `route="/api/v1/refunds" level="error"` | `> 0` in 5 m | Warning | Customer-reported refund failures |
| 9 | **PaymentAPISLOBurnRateFast** | Already in `k8s/prometheusrule.yaml` | 14× burn, 2 m | Critical | Manual "degraded" log line |
| 10 | **PaymentAPINodeMemoryPressure** | `kube_node_status_condition{condition="MemoryPressure",status="true"}` | true for 2 m | Critical | Pod OOM on constrained nodes |

**Note:** `PaymentAPIHighFailureRate` and related business alerts in `k8s/prometheusrule.yaml` reference `payment_transactions_total`, which is **not yet exported** by the application (`app/src/lib/metrics.ts`). Implementing that metric would close a significant business-monitoring gap.

---

## Appendix: Incident Metrics Summary

| Metric | Value |
|--------|-------|
| Total log lines (incident window) | 28 |
| Critical/error events | 13 |
| Warning events | 8 |
| Successful payments | 5 |
| Failed payments (5xx/502/504) | 7 |
| Peak error rate (self-reported) | 34.2% / 60 s |
| Memory limit (K8s + heap) | 256 MiB |
| Pod outcome | OOMKilled (SIGKILL) |

---

*Report generated from structured JSON logs for pod `payment-api-7d9f8b-xkp2q`. Cross-reference with Prometheus, processor-gateway telemetry, and `kubectl describe pod` for definitive root-cause confirmation.*
