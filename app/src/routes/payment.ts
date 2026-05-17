import { Router } from "express";
import { paymentProcessorClient } from "../lib/payment-processor-client";
import {
  getTransactionStatus,
  setTransactionStatus,
} from "../lib/transaction-cache";

const router = Router();

router.post("/process", async (req, res, next) => {
  try {
    const amount = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "invalid_amount" });
      return;
    }

    const result = await paymentProcessorClient.charge(amount);
    setTransactionStatus(result.transactionId, "completed");

    res.status(200).json({
      transactionId: result.transactionId,
      status: result.status,
      processorResponse: result.processorResponse,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/status", (req, res) => {
  const transactionId =
    typeof req.query.transactionId === "string"
      ? req.query.transactionId
      : "";

  const cached = transactionId
    ? getTransactionStatus(transactionId)
    : undefined;

  const timestamp = cached?.timestamp ?? new Date().toISOString();
  const status = cached?.status ?? "unknown";

  res.status(200).json({
    transactionId: transactionId || "unknown",
    status,
    timestamp,
  });
});

export default router;
