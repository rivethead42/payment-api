# Payment API Incident — Corrective Action Plan (CAP)

**Incident ID:** INC-2024-1129-001  
**Source:** [payment-api-postmortem.md](./payment-api-postmortem.md) / [payment-api-incident-diagnostic-report.md](./payment-api-incident-diagnostic-report.md)

---

## Theme: Application code fixes

### CAP-001 — Align upstream timeouts and harden circuit breaker

| Field | Value |
|-------|-------|
| **Title** | Configure upstream timeouts and ensure circuit breaker opens before retry storms |
| **Description** | Update `app/src/lib/payment-processor-client.ts` to make the upstream timeout (5000 ms observed in logs) configurable via `k8s/configmap.yaml` and aligned with the hardcoded 10000 ms request timeout. Verify the circuit breaker opens during upstream degradation and returns fast 503 instead of exhausting retries. Add processor dependency health to the readiness probe in `app/src/readiness.ts`. |
| **Theme** | Application code fixes |
| **Priority** | P1 |
| **Effort** | Medium (1–2 weeks) |
| **Owner role** | Platform Engineer |
| **File / system** | `app/src/lib/payment-processor-client.ts`, `app/src/readiness.ts`, `k8s/configmap.yaml` |
| **Success criteria** | Staging test with `PAYMENT_PROCESSOR_MODE=degraded`: circuit opens, 503 returned within expected bound, no OOM under load test |
| **Verification** | Merged PR; staging load-test report attached; readiness probe fails when processor unhealthy |

### CAP-002 — Bound in-memory caches and cap concurrent upstream requests

| Field | Value |
|-------|-------|
| **Title** | Cap concurrent upstream requests and bound transaction cache |
| **Description** | Modify `app/src/lib/transaction-cache.ts` to replace the unbounded `Map` with a bounded cache. Add concurrency limits on upstream HTTP requests in `payment-processor-client.ts` to prevent connection accumulation during timeout storms. |
| **Theme** | Application code fixes |
| **Priority** | P1 |
| **Effort** | Medium (1–2 weeks) |
| **Owner role** | Platform Engineer |
| **File / system** | `app/src/lib/transaction-cache.ts`, `app/src/lib/payment-processor-client.ts` |
| **Success criteria** | Load test with forced upstream latency: memory plateaus below 80% of pod limit; no OOMKill |
| **Verification** | Load-test report; memory metrics flat under sustained degraded upstream |

### CAP-003 — Fix refund null-reference and add error-path tests

| Field | Value |
|-------|-------|
| **Title** | Null-check refund transaction lookup; return structured 404/422 |
| **Description** | Fix `TypeError: Cannot read properties of undefined (reading 'original_amount')` at `RefundService.validate` by null-checking transaction lookup before property access. Return HTTP 404 or 422 instead of unhandled 500. Add unit and integration tests for refund against non-existent `transaction_id`. |
| **Theme** | Application code fixes |
| **Priority** | P2 |
| **Effort** | Small (1–2 days) |
| **Owner role** | Platform Engineer |
| **File / system** | Application source — `refund.service.js` / equivalent TypeScript |
| **Success criteria** | Unit test passes; staging refund against missing transaction returns 404/422, not 500 |
| **Verification** | CI green; staging curl test documented |

### CAP-004 — Export missing business metrics

| Field | Value |
|-------|-------|
| **Title** | Implement `payment_transactions_total` metric export |
| **Description** | Add `payment_transactions_total` to `app/src/lib/metrics.ts` so that `PaymentAPIHighFailureRate` and related rules in `k8s/prometheusrule.yaml` can evaluate against real data instead of referencing an unexported metric. |
| **Theme** | Application code fixes |
| **Priority** | P1 |
| **Effort** | Small (1–2 days) |
| **Owner role** | Platform Engineer |
| **File / system** | `app/src/lib/metrics.ts` |
| **Success criteria** | `payment_transactions_total` visible in Prometheus; prometheusrule queries return data |
| **Verification** | Prometheus target scrape shows metric; Grafana panel populated |

### CAP-005 — Structured logging for refund and auth paths

| Field | Value |
|-------|-------|
| **Title** | Add structured logs for refund lookup failures and auth identity |
| **Description** | Log `transaction_found: false` in the refund path when lookup fails. Include hashed `client_id` or `api_key_id` in authentication failure logs to enable correlation without exposing secrets. |
| **Theme** | Application code fixes |
| **Priority** | P3 |
| **Effort** | Small (1–2 days) |
| **Owner role** | Platform Engineer |
| **File / system** | Refund service, auth middleware |
| **Success criteria** | Log queries return structured fields on staging failure scenarios |
| **Verification** | Sample log lines reviewed in staging |

---

## Theme: Kubernetes configuration changes

### CAP-006 — Increase pod memory limits with headroom

| Field | Value |
|-------|-------|
| **Title** | Raise memory requests/limits to 512Mi–1Gi with operational headroom |
| **Description** | Update `k8s/deployment.yaml` to increase memory limits from 256 MiB (confirmed OOMKill ceiling) to 512 MiB minimum with requests at 256 MiB, providing buffer during upstream timeout accumulation while CAP-002 reduces root memory pressure. |
| **Theme** | Kubernetes configuration changes |
| **Priority** | P1 |
| **Effort** | Small (1–2 days) |
| **Owner role** | Platform Engineer |
| **File / system** | `k8s/deployment.yaml` |
| **Success criteria** | Deployed limits ≥512 MiB; no OOMKill under staging degraded-upstream load test |
| **Verification** | `kubectl describe pod` shows new limits; load test passes |

### CAP-007 — Tune HPA memory scaling target

| Field | Value |
|-------|-------|
| **Title** | Adjust HPA memory target for early scale-out |
| **Description** | Update `k8s/hpa.yaml` memory utilization target so HPA scales replicas before pods approach memory limits during upstream degradation, reducing single-pod load concentration (34.2% error rate on one replica). |
| **Theme** | Kubernetes configuration changes |
| **Priority** | P2 |
| **Effort** | Small (1–2 days) |
| **Owner role** | SRE Lead |
| **File / system** | `k8s/hpa.yaml` |
| **Success criteria** | HPA adds replica when memory exceeds configured target in staging load test |
| **Verification** | `kubectl get hpa` events show scale-up during test |

### CAP-008 — Add processor health to readiness probe

| Field | Value |
|-------|-------|
| **Title** | Extend readiness probe to exclude pods when processor unhealthy |
| **Description** | Update readiness configuration (via `app/src/readiness.ts` and deployment probe config) so pods failing processor health checks are removed from service endpoints, preventing traffic to degraded replicas. |
| **Theme** | Kubernetes configuration changes |
| **Priority** | P1 |
| **Effort** | Small (1–2 days) |
| **Owner role** | Platform Engineer |
| **File / system** | `app/src/readiness.ts`, `k8s/deployment.yaml` |
| **Success criteria** | Pod goes NotReady when processor unreachable in staging |
| **Verification** | Endpoints list excludes NotReady pod during staging fault injection |

---

## Theme: Terraform / infrastructure changes

### CAP-009 — Edge rate limiting and auth-failure alerting at WAF/ingress

| Field | Value |
|-------|-------|
| **Title** | Enforce rate limits at edge; block/alert on auth failure bursts |
| **Description** | Update Ingress/WAF Terraform to enforce rate limits before internal 58/60 req/min threshold. Add alerting on auth failure bursts per IP (203.0.113.42 pattern: 3 failures in 0.4 s). |
| **Theme** | Terraform / infrastructure changes |
| **Priority** | P3 |
| **Effort** | Medium (1–2 weeks) |
| **Owner role** | Platform Engineer |
| **File / system** | Ingress/WAF Terraform modules |
| **Success criteria** | Pen-test with invalid API key receives 429 at edge before internal rate-limit warning |
| **Verification** | Pen-test report; WAF rule deployed in staging |

### CAP-010 — Deploy annotations for CI/CD correlation

| Field | Value |
|-------|-------|
| **Title** | Annotate pods with deploy metadata from Jenkins pipeline |
| **Description** | Configure Jenkins EKS deployment stage to annotate pods with commit SHA, build number, and deploy timestamp, closing the gap where Terraform/infra change correlation was unavailable during incident analysis. |
| **Theme** | Terraform / infrastructure changes |
| **Priority** | P3 |
| **Effort** | Small (1–2 days) |
| **Owner role** | SRE Lead |
| **File / system** | Jenkins pipeline, Kubernetes deployment annotations |
| **Success criteria** | `kubectl describe pod` shows deploy annotation matching ECR image tag |
| **Verification** | Post-deploy spot check on any payment-api pod |

---

## Theme: Observability and alerting improvements

### CAP-011 — OOMKill and memory-near-limit alerts

| Field | Value |
|-------|-------|
| **Title** | Alert on OOMKill and memory >85% of limit |
| **Description** | Add PrometheusRule alerts `PaymentAPIPodOOMKilled` (`kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}`) and `PaymentAPIMemoryNearLimit` (working set / limit >0.85 for 2m) to `k8s/prometheusrule.yaml`. Addresses gap where memory warnings at 221 MiB were logged but unalerted. |
| **Theme** | Observability and alerting improvements |
| **Priority** | P1 |
| **Effort** | Small (1–2 days) |
| **Owner role** | SRE Lead |
| **File / system** | `k8s/prometheusrule.yaml` |
| **Success criteria** | Alert fires in staging when memory limit approached or pod OOMKilled |
| **Verification** | Alertmanager test notification received |

### CAP-012 — Upstream timeout and connection-timeout alerts

| Field | Value |
|-------|-------|
| **Title** | Alert on processor timeout burst and ETIMEDOUT rate |
| **Description** | Add alerts for `Upstream processor timeout` log rate (>3 in 1m) and ETIMEDOUT error rate (>2 in 30s) to fire before aggregate 34.2% error-rate breach. |
| **Theme** | Observability and alerting improvements |
| **Priority** | P1 |
| **Effort** | Small (1–2 days) |
| **Owner role** | SRE Lead |
| **File / system** | `k8s/prometheusrule.yaml`, log-based alert rules |
| **Success criteria** | Alerts fire in staging during `PAYMENT_PROCESSOR_MODE=degraded` before error-rate threshold log |
| **Verification** | Staging fault injection timeline shows alert precedes degraded log |

### CAP-013 — Circuit breaker, pool exhaustion, and dependency tracing

| Field | Value |
|-------|-------|
| **Title** | Instrument circuit breaker, connection pool, and distributed traces |
| **Description** | Export and alert on `payment_processor_circuit_state` and pool utilization (`active/size >0.9`). Add distributed trace spans for `processor-gateway` with status and duration. Log circuit state transitions at warn level. |
| **Theme** | Observability and alerting improvements |
| **Priority** | P2 |
| **Effort** | Medium (1–2 weeks) |
| **Owner role** | SRE Lead |
| **File / system** | `app/src/lib/payment-processor-client.ts`, `k8s/prometheusrule.yaml`, tracing config |
| **Success criteria** | Grafana dependency dashboard shows processor latency; circuit-open alert fires in staging |
| **Verification** | Dashboard populated; alert test in staging |

### CAP-014 — Per-pod error rate and refund exception alerts

| Field | Value |
|-------|-------|
| **Title** | Per-pod error rate aggregation and refund unhandled exception alert |
| **Description** | Add aggregate per-pod error rate alerts (request logs include `pod` field). Add `PaymentAPIRefundUnhandledException` alert on `/api/v1/refunds` error logs. |
| **Theme** | Observability and alerting improvements |
| **Priority** | P2 |
| **Effort** | Small (1–2 days) |
| **Owner role** | SRE Lead |
| **File / system** | `k8s/prometheusrule.yaml` |
| **Success criteria** | Single-pod error spike alert fires in staging when one replica stressed |
| **Verification** | Fault injection on single pod triggers alert |

### CAP-015 — Heap metrics and node memory pressure alerts

| Field | Value |
|-------|-------|
| **Title** | Export Node.js heap metrics; alert on node memory pressure |
| **Description** | Enable periodic heap metrics via prom-client default metrics. Add `PaymentAPINodeMemoryPressure` alert on `kube_node_status_condition{condition="MemoryPressure"}`. Closes gap on heap/GC behaviour and node vs. container limit distinction. |
| **Theme** | Observability and alerting improvements |
| **Priority** | P2 |
| **Effort** | Small (1–2 days) |
| **Owner role** | SRE Lead |
| **File / system** | `app/src/lib/metrics.ts`, `k8s/prometheusrule.yaml` |
| **Success criteria** | Heap metrics visible in Prometheus; node pressure alert configured |
| **Verification** | Metrics scrape confirmed; rule lint passes |

---

## Theme: Process and workflow changes

### CAP-016 — Staging load test for degraded upstream scenarios

| Field | Value |
|-------|-------|
| **Title** | Mandate degraded-upstream load test before payment-api releases |
| **Description** | Add a release gate load test using `POST /internal/exhaust-pool` or `PAYMENT_PROCESSOR_MODE=degraded` in staging to verify memory plateaus and circuit breaker behaviour. Directly validates permanent fixes from Sections 5.1 and 5.2 of the diagnostic report. |
| **Theme** | Process and workflow changes |
| **Priority** | P1 |
| **Effort** | Medium (1–2 weeks) |
| **Owner role** | SRE Lead |
| **File / system** | Jenkins pipeline, staging test suite |
| **Success criteria** | Load test runs automatically on payment-api PRs touching processor client or deployment resources |
| **Verification** | Jenkins stage green on test PR |

### CAP-017 — Integration test coverage for refund error paths

| Field | Value |
|-------|-------|
| **Title** | Require integration tests for refund missing-transaction scenario |
| **Description** | Add CI requirement for integration test covering refund against non-existent transaction_id, preventing unhandled 500 paths like the 14:05:51 `original_amount` TypeError from reaching production. |
| **Theme** | Process and workflow changes |
| **Priority** | P2 |
| **Effort** | Small (1–2 days) |
| **Owner role** | Platform Engineer |
| **File / system** | CI test suite, refund service tests |
| **Success criteria** | CI fails if refund error-path test removed; test passes on CAP-003 branch |
| **Verification** | CI pipeline configuration reviewed |

---

## COMPLETION TIMELINE

| CAP ID | Week 1 | Week 2 | Week 3 | Week 4 |
|--------|--------|--------|--------|--------|
| CAP-001 | IN PROGRESS | COMPLETE | — | — |
| CAP-002 | IN PROGRESS | COMPLETE | — | — |
| CAP-003 | COMPLETE | — | — | — |
| CAP-004 | COMPLETE | — | — | — |
| CAP-005 | NOT STARTED | IN PROGRESS | COMPLETE | — |
| CAP-006 | COMPLETE | — | — | — |
| CAP-007 | NOT STARTED | IN PROGRESS | COMPLETE | — |
| CAP-008 | IN PROGRESS | COMPLETE | — | — |
| CAP-009 | NOT STARTED | NOT STARTED | IN PROGRESS | COMPLETE |
| CAP-010 | NOT STARTED | IN PROGRESS | COMPLETE | — |
| CAP-011 | COMPLETE | — | — | — |
| CAP-012 | IN PROGRESS | COMPLETE | — | — |
| CAP-013 | NOT STARTED | IN PROGRESS | COMPLETE | — |
| CAP-014 | NOT STARTED | IN PROGRESS | COMPLETE | — |
| CAP-015 | NOT STARTED | IN PROGRESS | COMPLETE | — |
| CAP-016 | IN PROGRESS | COMPLETE | — | — |
| CAP-017 | COMPLETE | — | — | — |

*Timeline reflects recommended P1-first sequencing; all P1 items targeted complete by Week 2.*

---

## SIGN-OFF BLOCK

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Platform Lead | | | |
| Engineering Lead | | | |
| VP Engineering | | | |

---

*All actions trace to findings in [payment-api-incident-diagnostic-report.md](./payment-api-incident-diagnostic-report.md).*
