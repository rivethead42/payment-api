import { shutdownTracer } from "./lib/tracer";
import http from "node:http";
import { createApp } from "./app";
import { logger } from "./lib/logger";
import { initializePaymentProcessor } from "./lib/payment-processor-client";
import { setAppReady } from "./readiness";

const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  await initializePaymentProcessor();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(port, () => {
    setAppReady(true);
    logger.info({ port }, "payment-api listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutdown signal received");
    setAppReady(false);

    const forceExit = setTimeout(() => {
      logger.error("forced exit after shutdown timeout");
      process.exit(1);
    }, 25_000);

    server.close((err) => {
      if (err) {
        logger.error({ err }, "error closing HTTP server");
      }
      void shutdownTracer().finally(() => {
        clearTimeout(forceExit);
        process.exit(0);
      });
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { main };
