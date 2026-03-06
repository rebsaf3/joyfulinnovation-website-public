// Local agent orchestration mesh launcher
import { fileURLToPath } from 'url';
import path from 'path';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const LOG_DIR = process.env.SWARM_LOG_DIR
  ? path.resolve(process.env.SWARM_LOG_DIR)
  : path.resolve(__dirname, '../../../logs');
const LOG_FILE = path.join(LOG_DIR, 'agent_activity.log');

// Ensure log directory exists before any log() calls
if (!fs.existsSync(LOG_DIR)) { fs.mkdirSync(LOG_DIR, { recursive: true }); }

function log(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
  console.log(`[mesh] ${event}`, data);
}

const STATIC_AGENTS = [
  'UIDesignerAgent', 'LLMMLAgent', 'IntegrationsAgent', 'LoggingAgent', 'OrchestratorAgent',
  'AuditDocumentationAgent', 'SecurityAgent', 'TestAgent', 'DocumentationAgent',
  'ErrorBoundaryAgent', 'BridgeAgent',
  'RegistryAgent', 'TaskManagerAgent', 'ConfigAgent', 'PackagingAgent',
  'InsightsAgent', 'MigrationAgent', 'DependencyAgent', 'CIAgent', 'ReleaseAgent',
];

const AGENTS_DIR = path.join(__dirname, 'agents');

function discoverSeries(prefix) {
  return fs.readdirSync(AGENTS_DIR)
    .filter((file) => new RegExp(`^${prefix}(\\d+)?\\.js$`).test(file))
    .map((file) => file.replace(/\.js$/, ''))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const AVAILABLE_AGENTS = Array.from(new Set([
  ...discoverSeries('ClaudeAgent'),
  ...discoverSeries('CodexAgent'),
  ...STATIC_AGENTS,
]));

const AGENT_LIST = (process.env.AGENT_LIST || AVAILABLE_AGENTS.join(','))
  .split(',')
  .filter(name => AVAILABLE_AGENTS.includes(name));

let supervisorProc = null;
let dispatchServer = null;
let meshShutdownStarted = false;

// Restart tracking: count crashes per agent within a rolling window to prevent
// infinite crash loops while still recovering from transient failures.
const RESTART_WINDOW_MS  = Number(process.env.AGENT_RESTART_WINDOW_MS)  || 10 * 60_000; // 10 min
const RESTART_MAX        = Number(process.env.AGENT_RESTART_MAX)        || 3;
const RESTART_BACKOFF_MS = Number(process.env.AGENT_RESTART_BACKOFF_MS) || 5_000;
const agentRestartTimes  = {};  // { agentName: [timestamp, ...] }

function recordCrash(agentName) {
  const now = Date.now();
  const times = (agentRestartTimes[agentName] || []).filter(t => now - t < RESTART_WINDOW_MS);
  times.push(now);
  agentRestartTimes[agentName] = times;
  return times.length;
}

function startAgent(agentName) {
  const agentFile = path.join(AGENTS_DIR, `${agentName}.js`);
  if (!fs.existsSync(agentFile)) {
    log('WARN', 'agent_file_missing', { agentName, agentFile });
    return null;
  }

  log('INFO', 'agent_starting', { agentName });

  const proc = spawn('node', [agentFile], {
    cwd: AGENTS_DIR,
    // pipe stdin so the mesh holds it open (keeps agent alive for heartbeats + tasks)
    // inherit stdout/stderr so agent logs print to the terminal
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, AGENT_NAME: agentName }
  });

  proc.on('exit', code => {
    log(code === 0 ? 'INFO' : 'WARN', 'agent_exited', { agentName, exitCode: code });

    if (meshShutdownStarted) return;  // intentional shutdown — do not restart
    if (code === 0) return;           // clean exit — no restart needed

    const crashCount = recordCrash(agentName);
    if (crashCount > RESTART_MAX) {
      log('ERROR', 'agent_restart_limit_reached', {
        agentName, crashCount, windowMs: RESTART_WINDOW_MS, maxRestarts: RESTART_MAX,
      });
      return;
    }

    log('WARN', 'agent_restarting', { agentName, exitCode: code, crashCount, backoffMs: RESTART_BACKOFF_MS });
    setTimeout(() => {
      if (meshShutdownStarted) return;
      const newProc = startAgent(agentName);
      if (newProc) agentProcs[agentName] = newProc;
    }, RESTART_BACKOFF_MS);
  });

  proc.on('error', err => {
    log('ERROR', 'agent_spawn_failed', { agentName, error: err.message });
  });

  return proc;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function keyConfigured(value) {
  return Boolean(value && !/placeholder|your_|changeme|<|>/i.test(String(value)));
}

function getMeshHealthPayload() {
  const status = {};
  for (const [name, proc] of Object.entries(agentProcs)) {
    status[name] = proc.exitCode === null ? 'alive' : `exited(${proc.exitCode})`;
  }
  const deadAgents = Object.entries(status).filter(([, s]) => s !== 'alive').map(([n]) => n);
  const hasAnthropic = keyConfigured(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = keyConfigured(process.env.OPENAI_API_KEY);
  let mode = String(process.env.SWARM_RUNTIME_MODE || 'auto').toLowerCase();
  if (mode === 'auto') mode = hasAnthropic || hasOpenAI ? 'normal' : 'minimal';
  return {
    status: 'ok',
    mode,
    keyPresence: {
      anthropic: hasAnthropic,
      openai: hasOpenAI,
    },
    agentCount: Object.keys(agentProcs).length,
    activeAgents: Object.values(status).filter((value) => value === 'alive').length,
    deadAgents,
    uptimeSeconds: Math.round(process.uptime()),
    agents: status,
  };
}

function isControlAuthorized(req, parsed) {
  const expected = process.env.SWARM_CONTROL_TOKEN;
  if (!expected) return true;
  const headerToken = req.headers['x-swarm-control-token'];
  const bodyToken = parsed?.token;
  return headerToken === expected || bodyToken === expected;
}

function stopAgentProcess(agentName, reason = 'manual_stop') {
  const proc = agentProcs[agentName];
  if (!proc) return { ok: false, code: 'not_found', message: `agent ${agentName} not found` };
  if (proc.exitCode !== null) return { ok: false, code: 'already_stopped', message: `agent ${agentName} already stopped` };

  try {
    if (proc.stdin && !proc.stdin.destroyed) proc.stdin.end();
  } catch {
    // no-op
  }

  const killed = proc.kill('SIGTERM');
  log('INFO', 'agent_stop_requested', { agentName, reason, killed });
  return { ok: true, code: 'stopping', message: `agent ${agentName} stop requested`, killed };
}

function shutdownMesh(reason = 'manual_shutdown') {
  if (meshShutdownStarted) return;
  meshShutdownStarted = true;

  log('WARN', 'mesh_shutdown_requested', { reason, agentCount: Object.keys(agentProcs).length });

  for (const agentName of Object.keys(agentProcs)) {
    stopAgentProcess(agentName, reason);
  }

  if (supervisorProc && supervisorProc.exitCode === null) {
    try {
      supervisorProc.kill('SIGTERM');
      log('INFO', 'supervisor_stop_requested', { reason, pid: supervisorProc.pid });
    } catch (err) {
      log('WARN', 'supervisor_stop_failed', { reason, error: err.message });
    }
  }

  if (dispatchServer) {
    dispatchServer.close(() => {
      log('INFO', 'dispatch_server_closed', { reason });
      process.exit(0);
    });
  }

  // Fallback to ensure shutdown even if the server close callback never fires.
  setTimeout(() => {
    log('WARN', 'mesh_forced_exit', { reason });
    process.exit(0);
  }, 3_000).unref();
}

log('INFO', 'mesh_starting', { agents: AGENT_LIST });

// Track procs by name for health checks
const agentProcs = {};
AGENT_LIST.forEach(name => {
  const proc = startAgent(name);
  if (proc) agentProcs[name] = proc;
});

const count = Object.keys(agentProcs).length;
log('INFO', 'mesh_started', { count });

// ── Dispatch HTTP server ────────────────────────────────────────────────────
// Agents (e.g. OrchestratorAgent) POST { agent, task } here to send a task
// to another agent's stdin. Binds only to localhost.
const MESH_PORT = Number(process.env.MESH_PORT) || 3099;

dispatchServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, getMeshHealthPayload());
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 404, { error: 'not found', method: req.method, path: req.url });
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let parsed = {};
    if (body.trim().length > 0) {
      try {
        parsed = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: 'bad json' });
        return;
      }
    }

    if (req.url === '/dispatch') {
      const { agent, task } = parsed;
      const proc = agentProcs[agent];
      if (!proc || proc.exitCode !== null) {
        const msg = `agent ${agent} not running`;
        log('WARN', 'dispatch_failed', { agent, reason: msg });
        sendJson(res, 404, { error: msg });
        return;
      }
      try {
        proc.stdin.write(JSON.stringify({ task }) + '\n');
      } catch (err) {
        log('ERROR', 'dispatch_failed', { agent, reason: err.message });
        sendJson(res, 500, { error: `failed to dispatch to ${agent}` });
        return;
      }
      log('INFO', 'task_dispatched', { agent, task: String(task).slice(0, 120) });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.url === '/control/bridge/shutdown') {
      if (!isControlAuthorized(req, parsed)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'dashboard_bridge_shutdown';
      const result = stopAgentProcess('BridgeAgent', reason);
      if (!result.ok) {
        const status = result.code === 'not_found' ? 404 : 409;
        sendJson(res, status, { ok: false, error: result.message, code: result.code });
        return;
      }
      sendJson(res, 200, { ok: true, status: result.code, message: result.message });
      return;
    }

    if (req.url === '/control/swarm/shutdown') {
      if (!isControlAuthorized(req, parsed)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'dashboard_swarm_shutdown';
      sendJson(res, 202, { ok: true, status: 'shutting_down', reason });
      setTimeout(() => shutdownMesh(reason), 50);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
});

dispatchServer.listen(MESH_PORT, '127.0.0.1', () => {
  log('INFO', 'dispatch_server_ready', { port: MESH_PORT });
});

dispatchServer.on('error', err => {
  log('ERROR', 'dispatch_server_failed', { port: MESH_PORT, error: err.message });
  process.exit(1);
});

// ── Project supervisor ──────────────────────────────────────────────────────
// Launch supervisor.js alongside the mesh so it monitors projects.json
// and periodically feeds status updates to OrchestratorAgent.
const SUPERVISOR_FILE = path.join(__dirname, 'supervisor.js');
if (process.env.AUTO_START_SUPERVISOR !== 'false' && fs.existsSync(SUPERVISOR_FILE)) {
  supervisorProc = spawn('node', [SUPERVISOR_FILE], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env },
  });
  supervisorProc.on('exit', code => log('WARN', 'supervisor_exited', { exitCode: code }));
  supervisorProc.on('error', err => log('ERROR', 'supervisor_spawn_failed', { error: err.message }));
  log('INFO', 'supervisor_launched', { pid: supervisorProc.pid, file: SUPERVISOR_FILE });
} else {
  log('DEBUG', 'supervisor_skipped', { AUTO_START_SUPERVISOR: process.env.AUTO_START_SUPERVISOR });
}

// Health check — log which agents are alive or dead every interval
const HEALTH_CHECK_MS = Number(process.env.HEALTH_CHECK_INTERVAL_MS) || 60_000;
if (process.env.SUPPRESS_HEALTH_LOGS !== 'true') {
  setInterval(() => {
    const status = {};
    for (const [name, proc] of Object.entries(agentProcs)) {
      status[name] = proc.exitCode === null ? 'alive' : `exited(${proc.exitCode})`;
    }
    const dead = Object.entries(status).filter(([, s]) => s !== 'alive').map(([n]) => n);
    log(dead.length > 0 ? 'WARN' : 'INFO', 'mesh_health_check', { status, deadAgents: dead });
  }, HEALTH_CHECK_MS).unref();
} else {
  log('INFO', 'health_logs_suppressed', { HEALTH_CHECK_MS });
}
