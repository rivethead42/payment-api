import pino from "pino";

const service = process.env.SERVICE_NAME ?? "payment-api";
const pod = process.env.POD_NAME ?? "";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    return {
      service,
      pod,
    };
  },
});
