import type { Request, Response, NextFunction } from "express";

let forceErrorUntil = 0;
let forceErrorRate = 0;

export function setForceErrorWindow(
  durationSeconds: number,
  errorRate: number
): void {
  const durationMs = Math.max(0, durationSeconds) * 1000;
  forceErrorUntil = Date.now() + durationMs;
  forceErrorRate = Math.min(1, Math.max(0, errorRate));
}

function shouldSkipForceError(path: string): boolean {
  if (path === "/health" || path === "/ready" || path === "/metrics") {
    return true;
  }
  if (path.startsWith("/internal/")) {
    return true;
  }
  return false;
}

export function forceErrorMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (shouldSkipForceError(req.path)) {
    next();
    return;
  }
  if (Date.now() < forceErrorUntil && Math.random() < forceErrorRate) {
    res.status(500).json({ error: "forced_error", message: "demo force-error active" });
    return;
  }
  next();
}
