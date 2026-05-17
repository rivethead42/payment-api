import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const log = logger.child({
    requestId: req.requestId,
    route: req.path,
  });
  log.error({ err }, "request failed");

  if (res.headersSent) {
    return;
  }

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err instanceof Error
        ? err.message
        : "Internal Server Error";

  res.status(500).json({ error: "internal_error", message });
}
