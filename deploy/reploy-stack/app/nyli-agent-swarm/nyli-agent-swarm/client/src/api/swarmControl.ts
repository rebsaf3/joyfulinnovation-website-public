export function startSwarm(reason = "dashboard_swarm_start"): Promise<SwarmControlResponse> {
  return postControl("/api/swarm-control/start", reason);
}
export type SwarmControlResponse = {
  ok: boolean;
  status?: string;
  message?: string;
  reason?: string;
  error?: string;
};

async function postControl(path: string, reason: string): Promise<SwarmControlResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  const raw = await res.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Control endpoint returned invalid JSON (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    const apiError =
      payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : null;
    throw new Error(apiError ?? `Control request failed (HTTP ${res.status})`);
  }

  if (!payload || typeof payload !== "object") {
    return { ok: true, status: "accepted" };
  }
  return payload as SwarmControlResponse;
}

export function shutdownBridge(reason = "dashboard_bridge_shutdown"): Promise<SwarmControlResponse> {
  return postControl("/api/swarm-control/bridge/shutdown", reason);
}

export function shutdownSwarm(reason = "dashboard_swarm_shutdown"): Promise<SwarmControlResponse> {
  return postControl("/api/swarm-control/shutdown", reason);
}
