// API client for swarm key metrics (agent activity log)
export async function fetchSwarmMetrics() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch('/api/swarm-metrics', { signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error('Failed to fetch swarm metrics');
  return res.json();
}
