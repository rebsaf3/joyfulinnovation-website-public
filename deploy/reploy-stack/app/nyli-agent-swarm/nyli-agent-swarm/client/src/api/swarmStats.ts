type SwarmStats = {
  totalAgents: number;
  onlineAgents: number;
  totalTasks: number;
  errorCount: number;
  activeAgents: number;
  staleAgents: number;
  uptimePct: number;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// API client for swarm summary stats — no auth required
export async function fetchSwarmStats(): Promise<SwarmStats> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch('/api/swarm-stats', { signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error('Failed to fetch swarm stats');
  const data = await res.json() as Record<string, unknown>;

  const totalAgents = toNumber(data.totalAgents ?? data.totalUsers);
  const onlineAgents = toNumber(data.onlineAgents ?? data.activeAgents);
  const totalTasks = toNumber(data.totalTasks ?? data.totalTurns);
  const errorCount = toNumber(data.errorCount);
  const activeAgents = toNumber(
    data.activeAgents ??
    (data.uptimeMap && typeof data.uptimeMap === "object" ? Object.keys(data.uptimeMap).length : undefined)
  );
  const staleAgents = toNumber(
    data.staleAgents,
    Number.isFinite(onlineAgents) ? Math.max(0, onlineAgents - activeAgents) : Math.max(0, totalAgents - activeAgents)
  );

  let uptimePct = toNumber(data.uptimePct, Number.NaN);
  if (!Number.isFinite(uptimePct)) {
    const onlineForPct = Number.isFinite(onlineAgents) ? onlineAgents : activeAgents;
    uptimePct = totalAgents > 0 ? Math.round((onlineForPct / totalAgents) * 100) : 0;
  }

  return {
    totalAgents,
    onlineAgents,
    totalTasks,
    errorCount,
    activeAgents,
    staleAgents,
    uptimePct,
  };
}
