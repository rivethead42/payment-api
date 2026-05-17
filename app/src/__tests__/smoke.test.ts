import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import "../lib/tracer";
import { createApp } from "../app";
import { initializePaymentProcessor } from "../lib/payment-processor-client";
import { setAppReady } from "../readiness";

beforeAll(async () => {
  process.env.PAYMENT_PROCESSOR_MODE = "healthy";
  process.env.SERVICE_NAME = "payment-api";
  await initializePaymentProcessor();
  setAppReady(true);
});

describe("payment-api smoke", () => {
  const app = createApp();

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.version).toBeDefined();
  });

  it("GET /ready returns 200 when ready", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("GET /metrics returns Prometheus text", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("http_requests_total");
    expect(res.text).toContain("nodejs_heap_size_used_bytes");
  });

  it("POST /api/checkout succeeds in healthy mode", async () => {
    const res = await request(app)
      .post("/api/checkout")
      .send({ amount: 12.34 })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(200);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.transactionId).toBeDefined();
    expect(res.body.status).toBe("completed");
    expect(res.body.amount).toBe(12.34);
  });

  it("GET /api/payment/status returns 200 without processor call", async () => {
    const res = await request(app).get("/api/payment/status");
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
  });
});
