import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const serviceName = process.env.SERVICE_NAME ?? "payment-api";
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318";

const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint.replace(/\/$/, "")}/v1/traces`,
});

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

try {
  sdk.start();
} catch (err) {
  console.error("OpenTelemetry SDK failed to start:", err);
}

export async function shutdownTracer(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch {
    // ignore
  }
}
