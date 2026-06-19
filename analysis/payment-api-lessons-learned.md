# Payment API Incident — Lessons Learned Summary

**Incident ID:** INC-2024-1129-001  
**Audience:** Globalmatics engineering organisation  
**Source:** [payment-api-incident-diagnostic-report.md](./payment-api-incident-diagnostic-report.md)

---

## 1. CONTEXT PARAGRAPH

On November 29, 2024, Globalmatics' payment API — a Node.js service on AWS EKS that processes card payments by calling an internal upstream called `processor-gateway` — experienced a cascading failure lasting approximately four minutes on one of two production replicas. The incident began with isolated upstream processor timeouts, escalated into concurrent connection failures and a 34.2% error rate, and ended when the affected pod exhausted its 256 MiB memory limit and was killed by the kernel (OOMKill). Seven payment transactions failed with HTTP 5xx responses; five successful payments still completed during the window, indicating intermittent rather than total upstream failure. A separate refund bug and several client-side errors (bad API keys, missing fields) occurred concurrently but did not cause the cascade. This document captures transferable lessons for engineering teams beyond the payment API squad.

---

## 2. TECHNICAL LESSONS

### Upstream dependency degradation follows a latency-then-failure pattern

Three payments returned HTTP 200 but exceeded the 1000 ms slow-response threshold (1843–2489 ms) in the 0.7 s immediately before four concurrent `ETIMEDOUT` failures. The team learned that slow successful responses during partial upstream degradation are a reliable precursor to hard timeouts — not a sign that the system is "mostly fine."

**Watch for this signal:** P99 latency climbing toward upstream timeout values (5000 ms in this incident) while error rate remains near zero.

### Retry logic without circuit breaking amplifies load during degradation

One transaction (`txn_4v8nt61k`) logged two retry attempts before HTTP 502, holding upstream connections for ~10 s. When upstream was already degraded, retries increased concurrent in-flight connections on an already stressed pod, contributing to the 34.2% error-rate spike.

**Watch for this signal:** Retry attempt logs (`retry_attempt: 1`, `retry_attempt: 2`) appearing during upstream timeout bursts with no corresponding circuit-breaker-open log or metric.

### Memory limits must account for worst-case connection accumulation, not steady-state heap

The pod OOMKilled at exactly the 256 MiB Kubernetes limit after memory warnings at 221 and 244 MiB in 18 s. Steady-state memory appeared manageable for ~3 minutes of normal operation; the failure mode required headroom for timeout-held connections and retry accumulation that steady-state profiling would not reveal.

**Watch for this signal:** `Memory usage high` application logs with heap >85% of limit during elevated error rates or upstream timeouts.

### Unbounded in-process caches create latent OOM risk under stress

The diagnostic report identifies an unbounded `Map` in the transaction cache. Under normal traffic the cache size is invisible; under connection accumulation it becomes a contributing memory pressure source.

**Watch for this signal:** Application caches implemented as unbounded in-memory maps with no TTL or size cap in code review.

### Application-log degraded status is not a substitute for Prometheus alerting

The 34.2% error-rate breach was logged by the application at 14:06:10.781Z, but business metrics referenced in `k8s/prometheusrule.yaml` (`payment_transactions_total`) are not exported, and memory/OOM conditions were logged but likely unalerted.

**Watch for this signal:** PrometheusRule references metrics that do not appear in `/metrics` scrape targets.

---

## 3. PROCESS LESSONS

### Error-path integration tests must cover "resource not found" scenarios

The refund `TypeError` on `original_amount` reached production because the lookup path for a missing transaction was not tested. The failure was isolated (one request) but demonstrates that happy-path-only test coverage leaves unhandled 500s in infrequent routes.

**Watch for this signal:** Service methods that dereference nested properties on lookup results without a preceding null/undefined guard and no negative-case integration test.

### Single-pod log analysis is insufficient for replica-scoped incidents

The diagnostic report covers one pod on a 2-replica deployment where ~50% capacity was lost. Centralized observability should default to namespace-level queries, not single-pod log exports, to determine fleet vs. isolated impact.

**Watch for this signal:** Incident investigation begins from a single pod name with no cross-pod comparison in the first 15 minutes.

### Release gates should include fault-injection against upstream dependencies

Permanent fixes in the analysis require staging validation with `PAYMENT_PROCESSOR_MODE=degraded` and load tests via `/internal/exhaust-pool`. Without this gate, circuit-breaker and memory-boundary behaviour under degradation cannot be verified before production.

**Watch for this signal:** No staging load test stage in Jenkins pipeline for services with external HTTP dependencies.

### Deploy provenance must be machine-readable on running pods

The analysis could not correlate the incident with a recent deployment or Terraform change because deploy annotations were absent from pod metadata and logs.

**Watch for this signal:** `kubectl describe pod` lacks commit SHA, build ID, or deploy timestamp annotations.

---

## 4. WHAT SURPRISED US

1. **Successful payments continued during active degradation.** A payment succeeded at 14:05:33 — sixteen seconds after the first upstream timeout chain and eighteen seconds before the ETIMEDOUT burst. This challenged the assumption that upstream failure presents as a clean binary outage rather than intermittent partial degradation.

2. **Memory warnings appeared ~34 seconds after the timeout burst, not immediately.** Memory climbed from 221 MiB to OOMKill in 18 s starting at 14:06:44, but the four concurrent ETIMEDOUT errors occurred at 14:06:10–14:06:11. This suggests memory pressure accumulated over the full ~4-minute window — not only the final second — which was not obvious from the error-rate spike alone.

3. **The application detected and logged SLO breach before any confirmed Prometheus alert fired.** The 34.2% degraded status was visible in structured logs, yet the analysis identifies multiple alerting gaps (OOM, memory near limit, upstream timeout burst). The team assumed Prometheus rules would catch payment failures before application self-assessment — the logs show otherwise.

---

## 5. OPEN QUESTIONS

1. **What was the root state of `processor-gateway` at 14:05–14:06 UTC?** No processor-gateway logs, network trace data, or circuit-breaker state appear in the analysis. Was the upstream service degraded, unreachable, or was this a network path issue?

2. **When did the OOMKilled pod recover and when did customer impact end?** The log window ends at SIGKILL (14:07:02.119Z). Kubernetes restart timing and post-recovery error rates are not captured.

3. **Was OOM a Linux cgroup kill or V8 heap exhaustion?** Logs show heap 256/256 MiB at SIGKILL, but heap dump and GC telemetry were unavailable (Section 6).

4. **Did the circuit breaker ever open during the incident?** `payment_processor_circuit_state` was not present in logs or confirmed exported metrics.

5. **What was the connection pool utilization at 14:06:10?** Pool gauges exist in proposed Prometheus queries but were not available during the incident.

6. **Was node-level memory pressure a factor, or was this purely container-limit OOM?** Container Insights and node condition data were not in the log analysis.

7. **Who was client 203.0.113.42 and was the auth failure burst related to the payment cascade?** External client identity requires API gateway access logs or WAF data not present in the payment-api pod logs.

8. **Was a recent deployment or infrastructure change a contributing factor?** CI/CD deploy history and Terraform change correlation were unavailable (Section 6).

9. **How many customers were affected beyond the seven logged payment failures?** Cross-pod logs and ingress-level metrics were not analyzed.

10. **What was the refund transaction lookup source (DB vs. cache) for the `original_amount` failure?** APM trace and DB query logs were not available.

---

## 6. RECOMMENDED SHARING

| Team / audience | Why |
|-----------------|-----|
| **Processor-gateway team** | Primary hypothesized root cause; their service health, latency, and logs were absent from the incident analysis and are required to confirm H1 |
| **All EKS microservice teams** | The latency-then-failure pattern, retry amplification without circuit breaking, and 256 MiB OOM under connection accumulation apply to any HTTP-client service with low memory limits |
| **SRE / observability guild** | Nine alerting gaps identified; `payment_transactions_total` metric referenced in rules but not exported — likely a pattern in other services |
| **API platform / developer relations** | Client-side issues (auth failures from 203.0.113.42, missing `currency`, `/api/v2/payments` 404) indicate integration problems that increase log noise during incidents |
| **Jenkins / CI-CD owners** | Deploy annotation gap prevented infra-change correlation; load-test gate for degraded dependencies should be a pipeline standard |
| **Teams using in-memory caches in Node.js services** | Unbounded `Map` pattern in transaction cache is a transferable memory risk under stress |

---

*All claims trace to [payment-api-incident-diagnostic-report.md](./payment-api-incident-diagnostic-report.md). Values marked [UNKNOWN] or [REQUIRES FURTHER INVESTIGATION] reflect explicit gaps in that analysis.*
