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

describe("force-error demo endpoint", () => {
  const app = createApp();

  it("returns 400 when JSON body is missing", async () => {
    const res = await request(app).post("/internal/force-error");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_duration");
  });

  it("returns 200 on /internal/force-error but forces 500 on business routes", async () => {
    const arm = await request(app)
      .post("/internal/force-error")
      .send({ durationSeconds: 60, errorRate: 1 })
      .set("Content-Type", "application/json");
    expect(arm.status).toBe(200);
    expect(arm.body.ok).toBe(true);
    expect(arm.body.hint).toContain("/api/checkout");

    const checkout = await request(app)
      .post("/api/checkout")
      .send({ amount: 10 })
      .set("Content-Type", "application/json");
    expect(checkout.status).toBe(500);
    expect(checkout.body.error).toBe("forced_error");
  });

  it("does not force errors on /health or /internal routes", async () => {
    await request(app)
      .post("/internal/force-error")
      .send({ durationSeconds: 60, errorRate: 1 });

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);

    const internal = await request(app)
      .post("/internal/force-error")
      .send({ durationSeconds: 60, errorRate: 1 });
    expect(internal.status).toBe(200);
  });
});
