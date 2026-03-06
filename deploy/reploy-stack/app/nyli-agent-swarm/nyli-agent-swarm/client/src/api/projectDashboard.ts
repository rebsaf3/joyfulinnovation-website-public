export type DashboardFilters = {
  agent?: string;
  milestone?: string;
  status?: "assigned" | "in-progress" | "completed" | "blocked";
  period?: "1h" | "24h" | "7d" | "30d" | "all";
  from?: string;
  to?: string;
};

export type ProjectDashboardData = {
  filtersApplied: {
    agent: string;
    milestone: string;
    status: string;
    period: string;
    from: string | null;
    to: string | null;
  };
  filterOptions: {
    agents: string[];
    milestones: string[];
    statuses: string[];
    periods: string[];
  };
  summary: {
    agentStates: {
      totalTracked: number;
      online?: number;
      offline?: number;
      active: number;
      stale: number;
      idle: number;
      error: number;
      activelyWorkingOnTasks?: number;
      withBacklog?: number;
      withRecentExecution?: number;
      activityWindowMinutes?: number;
      errorWindowMinutes?: number;
    };
    taskCounts: {
      total: number;
      assigned: number;
      inProgress: number;
      completed: number;
      blocked: number;
      backlog?: number;
      liveInFlight?: number;
      completionRatePct: number;
      completedWithObservedDuration?: number;
      completedWithReliableDuration?: number;
      completedWithBackfilledDurationEstimate?: number;
      completedExcludedAsSynthetic?: number;
      completedWithoutDuration?: number;
      reclassifiedInProgressAsBlocked?: number;
      taskProgressStaleMinutes?: number;
    };
    live?: {
      windowMinutes: number;
      received: number;
      dispatched: number;
      started: number;
      completed: number;
      failed: number;
      throughputPerHour: number;
      failureRatePct: number;
    };
    consistency?: {
      scorePct: number;
      totalChecks: number;
      failedChecks: number;
      checks: Array<{
        id: string;
        label: string;
        ok: boolean;
        detail: string;
      }>;
      flags: string[];
    };
    errors: {
      total: number;
      byCategory?: Array<{ category: string; count: number }>;
      topCategory?: string | null;
    };
    freshness: {
      lastLogTs: string | null;
      secondsSinceLastLog: number | null;
      lastTaskUpdateTs: string | null;
      secondsSinceLastTaskUpdate: number | null;
    };
  };
  grouped: {
    byMilestone: Array<{
      key: string;
      counts: {
        total: number;
        assigned: number;
        inProgress: number;
        completed: number;
        blocked: number;
      };
      completionRatePct: number;
      avgTimeToCompleteMs: number | null;
    }>;
    byAgent: Array<{
      key: string;
      counts: {
        total: number;
        assigned: number;
        inProgress: number;
        completed: number;
        blocked: number;
      };
      completionRatePct: number;
      avgTimeToCompleteMs: number | null;
    }>;
  };
  milestones: Array<{
    key: string;
    counts: {
      total: number;
      assigned: number;
      inProgress: number;
      completed: number;
      blocked: number;
    };
    completionRatePct: number;
    avgTimeToCompleteMs: number | null;
  }>;
  tasks: Array<{
    taskKey: string;
    project: string;
    taskId: number;
    description: string;
    milestone: string;
    owner: string;
    status: "assigned" | "in-progress" | "completed" | "blocked";
    startTime: string | null;
    completionTime: string | null;
    durationMs: number | null;
    updatedTime: string | null;
    resultPreview: string | null;
  }>;
  errors: {
    total: number;
    countByAgent: Array<{ agent: string; count: number }>;
    countByCategory?: Array<{ category: string; count: number }>;
    topCategory?: string | null;
    items: Array<{
      ts: string | null;
      agent: string;
      level: string | null;
      event: string | null;
      category?: string;
      detail: string;
      project: string | null;
      taskId: string | number | null;
      logLink: string;
    }>;
    logsPath: string;
  };
  recentActivity: Array<{
    ts: string | null;
    type: string;
    event: string;
    agent: string;
    project: string | null;
    taskId: string | number | null;
    message: string;
  }>;
  export: {
    jsonUrl: string;
    csvUrl: string;
    pdfUrl: string;
  };
};

function toQuery(filters?: DashboardFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.agent && filters.agent !== "all") params.set("agent", filters.agent);
  if (filters.milestone && filters.milestone !== "all") params.set("milestone", filters.milestone);
  if (filters.status) params.set("status", filters.status);
  if (filters.period && filters.period !== "all") params.set("period", filters.period);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchProjectDashboard(filters?: DashboardFilters): Promise<ProjectDashboardData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(`/api/project-dashboard${toQuery(filters)}`, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );

  const raw = await res.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Dashboard API returned invalid JSON (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    const apiError =
      payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : null;
    throw new Error(apiError ?? `Failed to fetch project dashboard (HTTP ${res.status})`);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Dashboard API returned an empty response");
  }
  return payload as ProjectDashboardData;
}

export function buildProjectDashboardExportUrl(format: "json" | "csv" | "pdf", filters?: DashboardFilters): string {
  const qs = toQuery(filters);
  if (!qs) return `/api/project-dashboard/export?format=${format}`;
  return `/api/project-dashboard/export?format=${format}&${qs.replace(/^\?/, "")}`;
}
