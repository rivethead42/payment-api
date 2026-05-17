import { Router } from "express";
import { setForceErrorWindow } from "../middleware/forceError";
import { setProcessorPoolSizeForDemo } from "../lib/payment-processor-client";

const router = Router();

router.post("/force-error", (req, res) => {
  const durationSeconds = Number(req.body?.durationSeconds ?? 0);
  const errorRate = Number(req.body?.errorRate ?? 0);
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(errorRate)) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setForceErrorWindow(durationSeconds, errorRate);
  res.status(200).json({
    ok: true,
    durationSeconds,
    errorRate,
  });
});

router.post("/exhaust-pool", (req, res) => {
  const connections = Number(req.body?.connections ?? 1);
  if (!Number.isFinite(connections) || connections < 1) {
    res.status(400).json({ error: "invalid_connections" });
    return;
  }
  setProcessorPoolSizeForDemo(connections);
  res.status(200).json({ ok: true, connections });
});

export default router;
