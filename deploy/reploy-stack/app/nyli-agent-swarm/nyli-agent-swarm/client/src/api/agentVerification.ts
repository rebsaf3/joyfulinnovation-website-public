// API client for agent verification report
export async function fetchAgentVerification() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch('/api/agent-verification?limit=200', { signal: controller.signal })
    .finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error('Failed to fetch agent verification report');
  return res.json();
}
