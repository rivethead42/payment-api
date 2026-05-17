import type { Request, Response, NextFunction } from "express";
import {
  httpRequestsTotal,
  httpRequestDurationSeconds,
  metricsPodLabel,
} from "../lib/metrics";

export function normalizeRoute(req: Request): string {
  if (req.route?.path) {
    const base = req.baseUrl ?? "";
    return `${base}${req.route.path}`.replace(/\/+/g, "/") || req.path;
  }
  return req.path || "unknown";
}

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = process.hrtime.bigint();
  req.startTimeMs = Date.now();

  res.on("finish", () => {
    const route = normalizeRoute(req);
    const method = req.method;
    const status = String(res.statusCode);
    const pod = metricsPodLabel;
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;

    httpRequestsTotal.inc({ method, route, status_code: status, pod });
    httpRequestDurationSeconds.observe(
      { method, route, status_code: status, pod },
      durationSec
    );
  });

  next();
}
