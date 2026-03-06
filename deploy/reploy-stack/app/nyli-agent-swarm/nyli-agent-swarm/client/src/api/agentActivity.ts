// API client for agent activity logs

// AgentLog type moved here for robustness and to avoid import error
export type AgentLog = {
  agent?: string;
  agentName?: string;
  event?: string;
  status?: string;
  ts: string;
  lastTask?: string;
  level?: string;
  exitCode?: number;
  raw?: string;
  [key: string]: any;
};

export async function fetchAgentActivity(): Promise<AgentLog[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch('/api/agent-activity?limit=300', { signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error('Failed to fetch agent activity logs');
  const logs = await res.json();
  if (!Array.isArray(logs)) return [];
  const normalizeStatus = (log: any): string => {
    if (typeof log?.status === "string" && log.status) return log.status;
    if (log?.level === "ERROR") return "error";
    if (log?.level === "INFO") return "active";
    if (typeof log?.level === "string" && log.level) return log.level;
    return "idle";
  };
  // Normalize log format for dashboard compatibility
  return logs.map((log: any) => ({
    agent: log.agent || log.agentName || null,
    event: log.event || null,
    status: normalizeStatus(log),
    ts: log.ts,
    lastTask: log.lastTask || log.raw || null,
    level: log.level || null,
    exitCode: log.exitCode,
    raw: log.raw,
    ...log
  }));
}
