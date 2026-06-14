import { Router } from "express";
import {
  armForceErrorClusterWide,
  isForceErrorBroadcastRequest,
} from "../lib/force-error-broadcast";
import { setProcessorPoolSizeForDemo } from "../lib/payment-processor-client";

const router = Router();

router.post("/force-error", async (req, res, next) => {
  try {
    const durationSeconds = Number(req.body?.durationSeconds ?? 0);
    const errorRate = Number(req.body?.errorRate ?? 0);
    if (!Number.isFinite(durationSeconds) || !Number.isFinite(errorRate)) {
      res.status(400).json({
        error: "invalid_body",
        message:
          'Send JSON: {"durationSeconds":60,"errorRate":0.8} with Content-Type: application/json',
      });
      return;
    }
    if (durationSeconds <= 0) {
      res.status(400).json({
        error: "invalid_duration",
        message: "durationSeconds must be greater than 0",
      });
      return;
    }
    if (errorRate <= 0 || errorRate > 1) {
      res.status(400).json({
        error: "invalid_error_rate",
        message: "errorRate must be between 0 and 1 (exclusive of 0)",
      });
      return;
    }

    const isBroadcast = isForceErrorBroadcastRequest(
      req.header("x-force-error-broadcast")
    );
    const result = await armForceErrorClusterWide(
      durationSeconds,
      errorRate,
      isBroadcast
    );

    res.status(200).json({
      ok: true,
      ...result,
      armedPodCount: result.armedPods.length,
      hint:
        "This endpoint always returns 200. Call POST /api/checkout or POST /api/payment/process to observe forced 500 responses.",
    });
  } catch (err) {
    next(err);
  }
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
