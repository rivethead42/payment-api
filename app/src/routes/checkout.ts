import { Router } from "express";
import { randomUUID } from "node:crypto";
import { paymentProcessorClient } from "../lib/payment-processor-client";
import {
  setTransactionStatus,
} from "../lib/transaction-cache";

const router = Router();

async function mockCreateOrder(_amount: number): Promise<{ orderId: string }> {
  await new Promise((r) => setTimeout(r, 5));
  return { orderId: `ord_${randomUUID()}` };
}

router.post("/checkout", async (req, res, next) => {
  try {
    const amount = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "invalid_amount" });
      return;
    }

    const { orderId } = await mockCreateOrder(amount);
    const charge = await paymentProcessorClient.charge(amount);

    setTransactionStatus(charge.transactionId, "completed");

    res.status(200).json({
      orderId,
      status: "completed",
      transactionId: charge.transactionId,
      amount,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
