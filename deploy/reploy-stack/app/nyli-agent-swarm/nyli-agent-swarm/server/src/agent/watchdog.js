// NyLi Agent Watchdog — Automatically resets stalled agents
// Scans agent_activity.log for agents with no activity in 30 minutes
// Run as a background process or cron job

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const LOG_FILE = process.env.SWARM_LOG_DIR
  ? path.resolve(process.env.SWARM_LOG_DIR, 'agent_activity.log')
  : path.resolve(__dirname, '../../../logs/agent_activity.log');
const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function getAgentLastActivity() {
  if (!fs.existsSync(LOG_FILE)) return {};
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const lastActivity = {};
  for (const line of lines) {
    try {
      const log = JSON.parse(line);
      const agent = log.agent || log.agentName;
      const ts = log.timestamp || log.time || log.date || log.createdAt;
      if (agent && ts) {
        const t = new Date(ts).getTime();
        if (!lastActivity[agent] || t > lastActivity[agent]) {
          lastActivity[agent] = t;
        }
      }
    } catch {}
  }
  return lastActivity;
}

function resetAgent(agentName) {
  // Replace with your agent process manager logic
  // Example: kill and restart by name (requires agentName-to-PID mapping)
  console.log(`[Watchdog] Resetting agent: ${agentName}`);
  // TODO: Implement actual reset logic (e.g., pm2 restart, spawn process, etc.)
}

function watchdog() {
  const now = Date.now();
  const lastActivity = getAgentLastActivity();
  for (const [agent, ts] of Object.entries(lastActivity)) {
    if (now - ts > STALL_THRESHOLD_MS) {
      resetAgent(agent);
    }
  }
}

setInterval(watchdog, CHECK_INTERVAL_MS);
console.log('[Watchdog] Agent stall monitor started.');
