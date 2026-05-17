import express from "express";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { register } from "./lib/metrics";
import { requestIdMiddleware } from "./middleware/requestId";
import { forceErrorMiddleware } from "./middleware/forceError";
import { metricsMiddleware, normalizeRoute } from "./middleware/metricsMiddleware";
import { errorHandler } from "./middleware/errorHandler";
import checkoutRouter from "./routes/checkout";
import paymentRouter from "./routes/payment";
import internalRouter from "./routes/internal";
import healthRouter from "./routes/health";

export function createApp(): express.Application {
  const app = express();

  app.disable("x-powered-by");

  app.use(requestIdMiddleware);
  app.use(forceErrorMiddleware);
  app.use(metricsMiddleware);

  app.use(
    pinoHttp({
      logger,
      customProps: (req, _res) => ({
        route: normalizeRoute(req),
        requestId: req.requestId ?? "",
      }),
    })
  );

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  app.use(express.json());

  app.use("/api", checkoutRouter);
  app.use("/api/payment", paymentRouter);
  app.use("/internal", internalRouter);
  app.use(healthRouter);

  app.use(errorHandler);

  return app;
}
