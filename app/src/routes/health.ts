import { Router } from "express";
import { isAppReady } from "../readiness";
import packageJson from "../../package.json";

const router = Router();
const startTime = Date.now();

router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: packageJson.version,
  });
});

router.get("/ready", (_req, res) => {
  if (!isAppReady()) {
    res.status(503).json({ status: "not_ready" });
    return;
  }
  res.status(200).json({ status: "ready" });
});

export default router;
