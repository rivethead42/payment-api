import dns from "node:dns/promises";
import { setForceErrorWindow } from "../middleware/forceError";

const BROADCAST_HEADER = "x-force-error-broadcast";

function isInKubernetes(): boolean {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

function headlessServiceHost(): string {
  const namespace = process.env.POD_NAMESPACE ?? "payment-api";
  const service = process.env.PAYMENT_API_HEADLESS_SERVICE ?? "payment-api-headless";
  return `${service}.${namespace}.svc.cluster.local`;
}

async function resolvePodIps(): Promise<string[]> {
  try {
    const records = await dns.resolve4(headlessServiceHost());
    return [...new Set(records)];
  } catch {
    return [];
  }
}

async function armPod(
  ip: string,
  durationSeconds: number,
  errorRate: number
): Promise<boolean> {
  try {
    const response = await fetch(`http://${ip}:3000/internal/force-error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [BROADCAST_HEADER]: "1",
      },
      body: JSON.stringify({ durationSeconds, errorRate }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface ForceErrorResult {
  pod: string;
  durationSeconds: number;
  errorRate: number;
  broadcast: boolean;
  armedPods: string[];
}

export async function armForceErrorClusterWide(
  durationSeconds: number,
  errorRate: number,
  isBroadcast: boolean
): Promise<ForceErrorResult> {
  setForceErrorWindow(durationSeconds, errorRate);

  const pod = process.env.POD_NAME ?? process.env.HOSTNAME ?? "local";
  const armedPods = [pod];

  if (!isBroadcast && isInKubernetes()) {
    const ips = await resolvePodIps();
    const otherIps = ips.filter((ip) => ip.length > 0);
    const results = await Promise.all(
      otherIps.map(async (ip) => ({ ip, ok: await armPod(ip, durationSeconds, errorRate) }))
    );
    for (const { ip, ok } of results) {
      if (ok) {
        armedPods.push(ip);
      }
    }
  }

  return {
    pod,
    durationSeconds,
    errorRate,
    broadcast: !isBroadcast && isInKubernetes(),
    armedPods,
  };
}

export function isForceErrorBroadcastRequest(headerValue: string | undefined): boolean {
  return headerValue === "1";
}
