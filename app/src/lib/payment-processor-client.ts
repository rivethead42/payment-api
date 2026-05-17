import http from "node:http";
import { randomUUID } from "node:crypto";
import CircuitBreaker from "opossum";
import got from "got";
import {
  setPaymentProcessorCircuitStateMetric,
  setPaymentProcessorPoolMetrics,
} from "./metrics";

export interface ChargeResult {
  transactionId: string;
  status: "approved" | "declined" | "error";
  processorResponse: Record<string, unknown>;
}

const DEFAULT_POOL = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

let mockBaseUrl = "";
let poolSize = Number(process.env.PAYMENT_PROCESSOR_POOL_SIZE ?? DEFAULT_POOL);
let activeConnections = 0;

let flapInterval: ReturnType<typeof setInterval> | undefined;
let flapHealthy = true;

function getTimeoutMsFromEnv(): number {
  const raw = process.env.PAYMENT_PROCESSOR_TIMEOUT;
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_TIMEOUT_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function buildAgent(): http.Agent {
  return new http.Agent({
    keepAlive: true,
    maxSockets: poolSize,
    maxFreeSockets: Math.min(10, poolSize),
  });
}

let httpAgent = buildAgent();

export function setProcessorPoolSizeForDemo(size: number): void {
  poolSize = Math.max(1, Math.floor(size));
  httpAgent.destroy();
  httpAgent = buildAgent();
  setPaymentProcessorPoolMetrics(activeConnections, poolSize);
}

function updatePoolMetrics(): void {
  setPaymentProcessorPoolMetrics(activeConnections, poolSize);
}

function effectiveMode(): string {
  const mode = process.env.PAYMENT_PROCESSOR_MODE ?? "healthy";
  if (mode === "flapping") {
    return flapHealthy ? "healthy" : "degraded";
  }
  return mode;
}

function randomFail(rate: number): boolean {
  return Math.random() * 100 < rate;
}

function startFlapTimer(): void {
  if (flapInterval) return;
  flapInterval = setInterval(() => {
    flapHealthy = !flapHealthy;
  }, 30_000);
}

function stopFlapTimer(): void {
  if (flapInterval) {
    clearInterval(flapInterval);
    flapInterval = undefined;
  }
}

function createMockServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/charge") {
        const mode = process.env.PAYMENT_PROCESSOR_MODE ?? "healthy";
        if (mode === "flapping") {
          startFlapTimer();
        } else {
          stopFlapTimer();
        }

        if (mode === "down") {
          req.socket?.destroy();
          return;
        }

        const eff = effectiveMode();

        const run = async (): Promise<void> => {
          if (eff === "healthy") {
            await delay(180);
            if (randomFail(0.1)) {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "simulated_upstream_error" }));
              return;
            }
          } else if (eff === "degraded") {
            await delay(8000);
            if (randomFail(15)) {
              res.statusCode = 503;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "simulated_maintenance" }));
              return;
            }
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              reference: randomUUID(),
            })
          );
        };

        void run().catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end();
          }
        });
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("mock server bind failed"));
        return;
      }
      const port = addr.port;
      mockBaseUrl = `http://127.0.0.1:${port}`;
      resolve(mockBaseUrl);
    });

    server.on("error", reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function chargeOnce(amount: number): Promise<{ body: Record<string, unknown> }> {
  activeConnections += 1;
  updatePoolMetrics();
  try {
    const connectTimeout = getTimeoutMsFromEnv();
    const response = await got(`${mockBaseUrl}/charge`, {
      agent: { http: httpAgent },
      method: "POST",
      json: { amount },
      responseType: "json",
      retry: { limit: 0 },
      timeout: {
        connect: connectTimeout,
        // PLANTED ISSUE: hardcoded-timeout
        request: 10000,
      },
    });
    const body = response.body as Record<string, unknown>;
    return { body };
  } finally {
    activeConnections -= 1;
    updatePoolMetrics();
  }
}

const breaker = new CircuitBreaker(
  async (amount: number) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await chargeOnce(amount);
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await delay(100 * 2 ** attempt);
        }
      }
    }
    throw lastErr;
  },
  {
    timeout: Math.max(120_000, getTimeoutMsFromEnv() * 12),
    errorThresholdPercentage: 50,
    resetTimeout: 30_000,
    rollingCountTimeout: 10_000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
  }
);

breaker.on("open", () => setPaymentProcessorCircuitStateMetric(1));
breaker.on("halfOpen", () => setPaymentProcessorCircuitStateMetric(2));
breaker.on("close", () => setPaymentProcessorCircuitStateMetric(0));

setPaymentProcessorCircuitStateMetric(0);

export class PaymentProcessorClient {
  async charge(amount: number): Promise<ChargeResult> {
    const result = await breaker.fire(amount);
    const ref = String(result.body.reference ?? randomUUID());
    return {
      transactionId: ref,
      status: "approved",
      processorResponse: result.body,
    };
  }
}

export const paymentProcessorClient = new PaymentProcessorClient();

export async function initializePaymentProcessor(): Promise<void> {
  await createMockServer();
  poolSize = Number(process.env.PAYMENT_PROCESSOR_POOL_SIZE ?? DEFAULT_POOL);
  if (!Number.isFinite(poolSize) || poolSize < 1) poolSize = DEFAULT_POOL;
  httpAgent.destroy();
  httpAgent = buildAgent();
  setPaymentProcessorPoolMetrics(activeConnections, poolSize);
}
