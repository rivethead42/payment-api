import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from "prom-client";

export const register = new Registry();

collectDefaultMetrics({
  register,
  prefix: "",
});

const pod = process.env.POD_NAME ?? "unknown";

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code", "pod"],
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code", "pod"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const paymentProcessorCircuitState = new Gauge({
  name: "payment_processor_circuit_state",
  help: "Circuit breaker state: 0=closed, 1=open, 2=half-open",
  registers: [register],
});

export const paymentProcessorConnectionPoolActive = new Gauge({
  name: "payment_processor_connection_pool_active",
  help: "Active connections in the payment processor client pool",
  registers: [register],
});

export const paymentProcessorConnectionPoolSize = new Gauge({
  name: "payment_processor_connection_pool_size",
  help: "Configured max pool size for the payment processor client",
  registers: [register],
});

export function setPaymentProcessorCircuitStateMetric(value: 0 | 1 | 2): void {
  paymentProcessorCircuitState.set(value);
}

export function setPaymentProcessorPoolMetrics(active: number, size: number): void {
  paymentProcessorConnectionPoolActive.set(active);
  paymentProcessorConnectionPoolSize.set(size);
}

export { pod as metricsPodLabel };
