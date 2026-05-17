export type TransactionStatus = "pending" | "completed" | "failed";

export interface CachedTransaction {
  status: TransactionStatus;
  timestamp: string;
}

const cache = new Map<string, CachedTransaction>();

export function setTransactionStatus(
  transactionId: string,
  status: TransactionStatus
): void {
  cache.set(transactionId, {
    status,
    timestamp: new Date().toISOString(),
  });
}

export function getTransactionStatus(
  transactionId: string
): CachedTransaction | undefined {
  return cache.get(transactionId);
}
