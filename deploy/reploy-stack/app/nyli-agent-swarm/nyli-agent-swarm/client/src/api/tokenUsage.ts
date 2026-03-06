export type TokenUsageFilters = {
  agent?: string;
  project?: string;
  provider?: string;
  model?: string;
  event?: string;
  period?: "1h" | "24h" | "7d" | "30d" | "all";
  from?: string;
  to?: string;
  limit?: number;
};

export type TokenUsageBreakdownRow = {
  key: string;
  count: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerEvent: number;
  sharePct: number;
  estimatedCostUsd: number;
  pricedEventCount: number;
  unpricedEventCount: number;
  shareCostPct: number;
};

export type TokenUsageData = {
  filtersApplied: {
    agent: string;
    project: string;
    provider: string;
    model: string;
    event: string;
    period: string;
    from: string | null;
    to: string | null;
    limit: number;
  };
  summary: {
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgTokensPerEvent: number;
    avgInputTokensPerEvent: number;
    avgOutputTokensPerEvent: number;
    estimatedCostUsd: number;
    avgCostPerEventUsd: number;
    pricedEventCount: number;
    unpricedEventCount: number;
    pricingCoveragePct: number;
    firstEventTs: string | null;
    lastEventTs: string | null;
  };
  grouped: {
    byAgent: TokenUsageBreakdownRow[];
    byProject: TokenUsageBreakdownRow[];
    byProvider: TokenUsageBreakdownRow[];
    byModel: TokenUsageBreakdownRow[];
  };
  timeline: Array<{
    bucketStart: string;
    count: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  pricing: {
    currency: string;
    unit: string;
    pricingType: string;
    notes: string;
    modelRates: Array<{
      id: string;
      inputUsdPer1M: number;
      outputUsdPer1M: number;
    }>;
    providerDefaults: Array<{
      id: string;
      inputUsdPer1M: number;
      outputUsdPer1M: number;
    }>;
  };
  events: Array<{
    ts: string | null;
    agent: string;
    project: string | null;
    taskId: string | number | null;
    event: string;
    provider: string | null;
    model: string | null;
    endpoint: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    pricingRateId: string | null;
    pricingSource: string;
    durationMs: number | null;
    resultPreview: string | null;
  }>;
};

function toQuery(filters?: TokenUsageFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.agent && filters.agent !== "all") params.set("agent", filters.agent);
  if (filters.project && filters.project !== "all") params.set("project", filters.project);
  if (filters.provider && filters.provider !== "all") params.set("provider", filters.provider);
  if (filters.model && filters.model !== "all") params.set("model", filters.model);
  if (filters.event && filters.event !== "all") params.set("event", filters.event);
  if (filters.period && filters.period !== "all") params.set("period", filters.period);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (typeof filters.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(Math.trunc(filters.limit)));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchTokenUsage(filters?: TokenUsageFilters): Promise<TokenUsageData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(`/api/token-usage${toQuery(filters)}`, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );

  const raw = await res.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Token usage API returned invalid JSON (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    const apiError =
      payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : null;
    throw new Error(apiError ?? `Failed to fetch token usage analytics (HTTP ${res.status})`);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Token usage API returned an empty response");
  }
  return payload as TokenUsageData;
}
