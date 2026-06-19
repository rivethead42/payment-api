# Payment API Incident — Blameless Postmortem

**Incident ID:** INC-2024-1129-001  
**Service:** payment-api (prod, AWS EKS, namespace `payment-api`)  
**Source:** [payment-api-incident-diagnostic-report.md](./payment-api-incident-diagnostic-report.md)

---

## Incident Metadata

| Field | Value |
|-------|-------|
| **Incident ID** | INC-2024-1129-001 |
| **Detection time** | 2024-11-29T14:05:17.225Z (first upstream processor timeout) |
| **Resolution time** | [UNKNOWN — requires investigation] — log window ends at pod OOMKill (2024-11-29T14:07:02.119Z); Kubernetes auto-restart expected per `restartPolicy: Always` but not captured in logs |
| **Total duration** | ~1 min 45 sec (14:05:17 → 14:07:02, log window); full recovery duration [UNKNOWN — requires investigation] |
| **Severity** | P1 |
| **On-call engineer** | [PLACEHOLDER — Platform Engineer] |
| **Customers affected** | Minimum 5 transactions with confirmed failures (`txn_4v8nt61k`, `txn_2n8qc77f`, `txn_3t1mp88h`, `txn_9a4ru55q`, `txn_7c2sw19j`); broader count [UNKNOWN — requires investigation] |
| **Transactions lost** | 7 failed payments (5xx/502/504) per log analysis; revenue impact [PLACEHOLDER] |

---

## 1. INCIDENT SUMMARY

On November 29, 2024, customers attempting to complete card payments experienced failures over a period of approximately four minutes. Some payments were rejected with error responses after the system could not reach the payment processor in time. Others succeeded but took two to three times longer than normal. At the peak of the incident, more than one in three payment attempts on the affected server failed. One of the two servers running the payment service ran out of memory and was automatically restarted, temporarily reducing overall capacity by roughly half until it recovered.

The incident began when a single payment request to the upstream `processor-gateway` timed out after two retry attempts (~10 s total), returning HTTP 502 to the client. Upstream degradation continued intermittently—a successful payment at 14:05:33 occurred during the same window—before escalating at 14:06:08–14:06:11 with three slow-but-successful payments (1843–2489 ms), four concurrent `ETIMEDOUT` failures against `processor-gateway`, and a self-reported **34.2% error rate** over a 60 s window. Memory on pod `payment-api-7d9f8b-xkp2q` climbed from 221 MiB to 256 MiB heap in 18 seconds and the pod was **OOMKilled** (SIGKILL) at 14:07:02 under the **256 MiB** Kubernetes memory limit. The primary root cause is **degradation or unavailability of upstream `processor-gateway`**, which drove payment timeouts, retry amplification, connection buildup, and terminal memory exhaustion. A separate refund null-reference bug (`TypeError` on `original_amount`) and client-side issues (auth failures, validation errors) were present but did not drive the cascade. Resolution actions are not recorded in the log window; the diagnostic report proposes immediate remediation via processor-gateway restart and/or memory limit increase with deployment rollout (2–5 min estimated).

---

## 2. TIMELINE

**Impact start (customer-facing):** 2024-11-29T14:05:17.225Z — first upstream processor timeout (single transaction)  
**Impact end:** [UNKNOWN — requires investigation] — last log entry is OOMKill at 14:07:02.119Z; pod recovery not captured

| Timestamp (UTC) | Phase | Event |
|-----------------|-------|-------|
| 2024-11-29T14:03:12.441Z | SIGNAL | Server started — pod `payment-api-7d9f8b-xkp2q`, version `a3f9c12` |
| 2024-11-29T14:03:14.882Z | SIGNAL | Health check passed |
| 2024-11-29T14:03:45.119Z | SIGNAL | Payment processed successfully (`txn_8f3kd92m`, 118 ms) |
| 2024-11-29T14:04:01.334Z | SIGNAL | Payment processed successfully (`txn_2p7qr41x`, 143 ms) |
| 2024-11-29T14:04:22.560Z | SIGNAL | Payment declined — insufficient funds, HTTP 402 (`txn_9c1ms73n`) — expected business outcome |
| 2024-11-29T14:04:45.772Z | SIGNAL | Authentication failure — invalid/expired API key (203.0.113.42) |
| 2024-11-29T14:04:46.003Z | SIGNAL | Authentication failure (203.0.113.42) |
| 2024-11-29T14:04:46.198Z | SIGNAL | Authentication failure (203.0.113.42) |
| 2024-11-29T14:04:46.441Z | SIGNAL | Rate limit threshold approaching — 58 req/min from 203.0.113.42 (limit 60) |
| 2024-11-29T14:05:03.881Z | SIGNAL | Request validation failure — missing `currency`, HTTP 400 |
| **2024-11-29T14:05:17.225Z** | **SIGNAL** | **— Impact start (single-customer) — Upstream processor timeout, retry 1, HTTP 504 (`txn_4v8nt61k`)** |
| 2024-11-29T14:05:17.441Z | SIGNAL | Upstream processor timeout, retry 2, HTTP 504 (`txn_4v8nt61k`) |
| 2024-11-29T14:05:17.669Z | SIGNAL | Payment failed after max retries, HTTP 502 (`txn_4v8nt61k`) |
| 2024-11-29T14:05:33.114Z | SIGNAL | Payment processed successfully (`txn_7h2wz88s`) — intermittent upstream degradation |
| 2024-11-29T14:05:51.009Z | SIGNAL | Unhandled exception on refund path — `TypeError: original_amount` undefined (`/api/v1/refunds`) — isolated defect |
| **2024-11-29T14:06:08.773Z** | **SIGNAL** | **Slow payment response — 1843 ms, HTTP 200 (`txn_6m3yk55b`) — latency precursor** |
| 2024-11-29T14:06:09.002Z | SIGNAL | Slow payment response — 2102 ms, HTTP 200 (`txn_0r9xd14c`) |
| 2024-11-29T14:06:09.441Z | SIGNAL | Slow payment response — 2489 ms, HTTP 200 (`txn_5k7lb32w`) |
| **2024-11-29T14:06:10.118Z** | **SIGNAL** | **— Impact start (service-wide) — Payment processing error ETIMEDOUT, HTTP 500 (`txn_2n8qc77f`)** |
| 2024-11-29T14:06:10.334Z | SIGNAL | Payment processing error ETIMEDOUT, HTTP 500 (`txn_3t1mp88h`) |
| 2024-11-29T14:06:10.559Z | SIGNAL | Payment processing error ETIMEDOUT, HTTP 500 (`txn_9a4ru55q`) |
| 2024-11-29T14:06:11.002Z | SIGNAL | Payment processing error ETIMEDOUT, HTTP 500 (`txn_7c2sw19j`) |
| 2024-11-29T14:06:10.781Z | SIGNAL | Error rate threshold breached — 34.2% over 60 s window, status `degraded` |
| 2024-11-29T14:06:29.667Z | SIGNAL | Route not found — `POST /api/v2/payments`, HTTP 404 — client-side, unrelated |
| 2024-11-29T14:06:44.221Z | SIGNAL | Memory usage high — heap 221/256 MiB, RSS 289 MiB |
| 2024-11-29T14:06:58.003Z | SIGNAL | Memory usage high — heap 244/256 MiB, RSS 301 MiB |
| 2024-11-29T14:07:02.119Z | SIGNAL | Process OOMKilled — heap 256/256 MiB, RSS 312 MiB, SIGKILL — pod terminated |
| [UNKNOWN] | TRIAGE | On-call response — not captured in logs |
| [UNKNOWN] | HYPOTHESIS | Root-cause investigation — diagnostic report identifies processor-gateway degradation (H1) and memory amplification (H2) |
| [UNKNOWN] | ACTION | Proposed immediate actions: processor-gateway rollout restart and/or memory limit patch to 512Mi — not confirmed executed in logs |
| [UNKNOWN] | VERIFY | Post-remediation health confirmation — not captured in logs |
| **[UNKNOWN]** | **RESOLVE** | **— Impact end — pod recovery and service restoration not captured in log window** |

---

## 3. ROOT CAUSE ANALYSIS — 5 WHYS

**Starting symptom:** Customers received HTTP 502/504/500 responses on payment requests; peak self-reported error rate reached 34.2%.

| # | Why | Answer (evidence-based) |
|---|-----|-------------------------|
| **1** | Why did customers receive payment failures? | Seven payment errors were logged: upstream processor timeouts (504), retry exhaustion (502), and four concurrent `ETIMEDOUT` connection failures (500) against `processor-gateway` (Section 1.2). |
| **2** | Why did upstream requests fail and time out? | Logs show explicit 5000 ms upstream timeouts with `upstream: processor-gateway` and `ETIMEDOUT: connection timed out` on four concurrent requests. Slow successful payments (1843–2489 ms) immediately preceded the failure burst — consistent with upstream latency-then-failure (Hypothesis 1, Section 3). |
| **3** | Why did upstream latency and timeouts cascade into a 34.2% error rate? | Multiple concurrent upstream timeouts occurred within ~0.9 s (14:06:10–14:06:11), implying high in-flight request load on a single pod. Retry attempts were logged (`retry_attempt: 1`, `retry_attempt: 2`) before 502, amplifying load during degradation (Hypothesis 2, Section 3). |
| **4** | Why did high concurrent load lead to pod termination? | Memory climbed 221 → 244 → 256 MiB heap in 18 s after the error burst; pod was OOMKilled at the **256 MiB** Kubernetes limit. Multiple concurrent upstream timeouts imply in-flight HTTP connections held until timeout, driving heap growth (Hypothesis 2, Section 3). |
| **5** | Why did the pod exhaust memory under this load? | The deployment memory limit is **256 MiB** (`k8s/deployment.yaml` per report). Contributing factors include: unbounded in-memory transaction cache (`Map`), no logged evidence of circuit breaker opening before retry storms, and no connection-pool utilization metrics in logs (Gaps: Section 6). Whether `processor-gateway` itself was degraded vs. a network issue: **[REQUIRES FURTHER INVESTIGATION — see instrumentation gaps]** — no processor-gateway logs or trace data in the analysis. |

---

## 4. CONTRIBUTING FACTORS

### Code / application behaviour

- **Gap:** Refund service lacks null-check before accessing `original_amount`, producing unhandled HTTP 500 on `/api/v1/refunds` (Section 1.4).  
  **Contribution:** One customer refund failed; defect is isolated and did not drive the cascade, but represents an unhandled exception path in production.

- **Gap:** Retry logic logged two attempts before 502 with no evidence in logs that a circuit breaker opened (Section 3, Hypothesis 2 gaps).  
  **Contribution:** Retries during upstream degradation held connections for ~10 s per transaction, amplifying concurrent load on an already stressed pod.

- **Gap:** Transaction cache is an unbounded `Map` (`app/src/lib/transaction-cache.ts` per proposed fixes).  
  **Contribution:** Under sustained in-flight request accumulation, unbounded in-memory state may contribute to heap growth toward the 256 MiB ceiling.

### Configuration (Kubernetes manifests, Terraform, Dockerfile)

- **Gap:** Pod memory limit set to **256 MiB** with heap warnings at 221 MiB before OOMKill (Sections 1.1, 5.2).  
  **Contribution:** Low headroom left insufficient buffer when upstream timeouts caused connection and retry accumulation; pod terminated with ~50% deployment capacity lost (2-replica deployment).

- **Gap:** Upstream timeout in logs (5000 ms) vs. 10000 ms hardcoded request timeout in code — misalignment noted in proposed fixes (Section 5.1).  
  **Contribution:** Longer-than-logged timeouts may hold resources longer during degradation, though exact behaviour **[REQUIRES FURTHER INVESTIGATION — see instrumentation gaps]**.

- **Gap:** `payment_transactions_total` metric referenced in `k8s/prometheusrule.yaml` is not exported by the application (`app/src/lib/metrics.ts`, Section 7 note).  
  **Contribution:** Business-level failure-rate alerts could not fire; SLO burn-rate alerting gap vs. application-log-only degraded status at 14:06:10.

### Observability (what alerts were missing or fired too late)

- **Gap:** OOM and memory pressure were logged at application level but likely **unalerted** (Section 7).  
  **Contribution:** Memory climbed from 221 MiB to OOMKill in 18 s without evidence of a Prometheus alert firing before SIGKILL.

- **Gap:** Error-rate breach (34.2%) was self-reported in application logs only; no upstream dependency alert in provided rules (Section 7).  
  **Contribution:** No automated alert on upstream processor timeout burst before the aggregate degraded status at 14:06:10.

- **Gap:** No processor-gateway health, latency, circuit-breaker state, or connection-pool metrics in incident logs (Section 6).  
  **Contribution:** On-call could not confirm upstream root cause from payment-api logs alone; cross-service investigation required.

### Process (what workflow gap allowed this to reach production)

- **Gap:** Refund null-reference path reached production without integration test coverage for missing transaction (Section 5.3 proposed validation).  
  **Contribution:** Unhandled 500 on refund route; separate from cascade but indicates test gap on error paths.

- **Gap:** No deploy annotations or Terraform/infra change correlation in logs (Section 6).  
  **Contribution:** **[REQUIRES FURTHER INVESTIGATION — see instrumentation gaps]** — cannot determine whether a recent deployment or infra change preceded the incident.

- **Gap:** Analysis covers a single pod (`payment-api-7d9f8b-xkp2q`); cross-pod impact not fully characterized (Section 6).  
  **Contribution:** Incident scope (one replica vs. fleet-wide) was unclear from centralized observability at time of response.

---

## 5. WHAT WENT WELL

1. **Structured application logging captured the full failure chain** — upstream timeouts, retry attempts, ETIMEDOUT errors, error-rate self-assessment, and memory warnings through OOMKill were all present in 28 log lines (Appendix), enabling timeline reconstruction without external tools.

2. **Application degraded-status signal fired at 34.2% error rate** — the pod self-reported breach of the error-rate threshold at 14:06:10.781Z (Section 1.3), providing an aggregate SLO breach signal during the timeout burst even though Prometheus alerting on this condition is not confirmed.

3. **Health checks and baseline payments confirmed partial service availability** — `/health` passed at startup and five successful payments were processed during the incident window, including one at 14:05:33 during upstream degradation (Sections 1.10, 1.11), helping distinguish intermittent upstream failure from total code regression.

4. **Kubernetes restart policy provides self-healing** — `restartPolicy: Always` ensures the OOMKilled container will be restarted (Section 2, Phase 5), limiting permanent pod death though ~50% capacity was temporarily lost on the 2-replica deployment.

5. **Memory watchdog logging preceded fatal OOMKill** — two "Memory usage high" warnings at 14:06:44 and 14:06:58 gave 18 s of observable escalation before SIGKILL (Section 1.1), useful for post-incident analysis even if unalerted.

---

## 6. ACTION ITEMS (seed for CAP)

| ID | Action | Source | Priority |
|----|--------|--------|----------|
| AI-001 | Align upstream timeout configuration; verify circuit breaker opens before retry storms; add processor health to readiness probe | fix (5.1 permanent) | P1 |
| AI-002 | Increase memory limits with headroom (512Mi–1Gi); cap concurrent upstream requests; bound transaction cache | fix (5.2 permanent) | P1 |
| AI-003 | Null-check transaction lookup in refund path; return 404/422; add integration test | fix (5.3 permanent) | P2 |
| AI-004 | Enforce rate limit at edge; alert on auth failure bursts per IP | fix (5.4 permanent) | P3 |
| AI-005 | Export `payment_transactions_total` to close business-monitoring gap in prometheusrule | gap (Section 7 note) | P1 |
| AI-006 | Add distributed trace span for `processor-gateway` with status and duration | gap (Section 6) | P1 |
| AI-007 | Log circuit-breaker state transitions at warn level | gap (Section 6) | P2 |
| AI-008 | Export and alert on connection pool utilization (`active/size > 0.9`) | gap (Section 6) | P2 |
| AI-009 | Add per-pod aggregate error-rate alerts | gap (Section 6) | P2 |
| AI-010 | Export heap metrics via prom-client; memory watchdog before fatal | gap (Section 6) | P2 |
| AI-011 | Structured log `transaction_found: false` in refund path | gap (Section 6) | P3 |
| AI-012 | Include hashed `client_id`/`api_key_id` in auth failure logs | gap (Section 6) | P3 |
| AI-013 | Deploy annotations on pods for CI/CD correlation | gap (Section 6) | P3 |
| AI-014 | Alert: PaymentAPIPodOOMKilled | alert (Section 7 #1) | P1 |
| AI-015 | Alert: PaymentAPIMemoryNearLimit (>85% for 2m) | alert (Section 7 #2) | P1 |
| AI-016 | Alert: PaymentAPIProcessorTimeoutBurst (>3 in 1m) | alert (Section 7 #3) | P1 |
| AI-017 | Alert: PaymentAPIUpstreamConnectionTimeout (>2 ETIMEDOUT in 30s) | alert (Section 7 #4) | P1 |
| AI-018 | Alert: PaymentProcessorCircuitOpen | alert (Section 7 #5) | P2 |
| AI-019 | Alert: PaymentAPIPoolExhaustion (>0.9 for 2m) | alert (Section 7 #6) | P2 |
| AI-020 | Alert: PaymentAPIAuthFailureBurst | alert (Section 7 #7) | P3 |
| AI-021 | Alert: PaymentAPIRefundUnhandledException | alert (Section 7 #8) | P2 |
| AI-022 | Tune HPA memory target in `k8s/hpa.yaml` | fix (5.2 permanent) | P2 |

---

*All claims trace to [payment-api-incident-diagnostic-report.md](./payment-api-incident-diagnostic-report.md). Values marked [UNKNOWN], [PLACEHOLDER], or [REQUIRES FURTHER INVESTIGATION] reflect explicit gaps in that analysis.*
